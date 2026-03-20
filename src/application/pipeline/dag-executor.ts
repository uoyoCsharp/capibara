/**
 * DAG Orchestration Engine
 *
 * Core algorithm:
 * 1. Validate DAG is acyclic (Kahn's algorithm)
 * 2. Initialize GenericStateMachine
 * 3. Main loop:
 *    a. Get ready nodes -> execute in parallel
 *    b. Any node failure -> cancelAllPending + throw (fail-fast)
 *    c. All nodes completed -> return result
 * @module application/pipeline/dag-executor
 */

import type { PipelineDefinition, PipelineNodeDefinition } from '../../core/types/dag.types.js';
import type {
  PipelineContext,
  PipelineResult,
  PhaseResult,
} from '../../core/types/pipeline.types.js';
import type { IEventBus } from '../../core/interfaces/event-bus.interface.js';
import type { CostTracker } from '../../infrastructure/observability/cost-tracker.js';
import type { Logger } from 'pino';
import type { GenericStateMachine } from '../state-machine/generic-state-machine.js';
import type { NodeExecutor } from './node-executor.js';
import type { Phase } from '../../core/types/phase.types.js';

export class DAGExecutor {
  constructor(
    private nodeExecutor: NodeExecutor,
    private stateMachine: GenericStateMachine,
    private eventBus: IEventBus,
    private costTracker: CostTracker,
    private logger: Logger,
  ) {}

  async execute(definition: PipelineDefinition, context: PipelineContext): Promise<PipelineResult> {
    const startTime = Date.now();
    this.validateDAG(definition);
    this.stateMachine.initialize(definition, context.pipelineId);

    this.logger.info(
      {
        pipelineId: context.pipelineId,
        nodes: definition.nodes.length,
        edges: definition.edges.length,
      },
      'DAG execution started',
    );

    const phaseResults: Record<string, PhaseResult> = {};

    while (!this.stateMachine.isTerminal()) {
      const readyNodes = this.stateMachine.getReadyNodes(definition.edges);

      if (readyNodes.length === 0) {
        throw new Error('DAG deadlock: no ready nodes but pipeline not terminal');
      }

      this.logger.info({ readyNodes }, 'Executing ready nodes');

      // Parallel execution with fail-fast
      const results = await Promise.allSettled(
        readyNodes.map((nodeId) => this.executeNode(nodeId, definition, context)),
      );

      // Collect results and check for failures
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const nodeId = readyNodes[i];
        const node = definition.nodes.find((n) => n.id === nodeId)!;
        const phase = node.phase ?? node.id;

        if (result.status === 'fulfilled') {
          phaseResults[phase] = result.value;
        } else {
          // Fail-fast: cancel all pending and throw
          this.logger.error({ nodeId, error: result.reason }, 'Node execution failed');
          this.stateMachine.cancelAllPending();

          this.eventBus.emit({
            timestamp: new Date().toISOString(),
            pipelineId: context.pipelineId,
            eventType: 'pipeline:failed',
            data: { failedNode: nodeId, error: String(result.reason) },
          });

          throw result.reason instanceof Error ? result.reason : new Error(String(result.reason));
        }
      }
    }

    this.stateMachine.markCompleted();

    return {
      success: true,
      changeId: context.changeId,
      phases: phaseResults as Record<Phase, PhaseResult>,
      totalCost: this.costTracker.getTotalCost(),
      totalDuration: Date.now() - startTime,
    };
  }

  /**
   * Validate DAG has no cycles using Kahn's algorithm
   */
  private validateDAG(definition: PipelineDefinition): void {
    const nodeIds = new Set(definition.nodes.map((n) => n.id));
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const id of nodeIds) {
      inDegree.set(id, 0);
      adjacency.set(id, []);
    }

    for (const edge of definition.edges) {
      if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
        throw new Error(`Edge references unknown node: ${edge.from} -> ${edge.to}`);
      }
      inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
      adjacency.get(edge.from)!.push(edge.to);
    }

    const queue = [...nodeIds].filter((id) => inDegree.get(id) === 0);
    let visited = 0;

    while (queue.length > 0) {
      const current = queue.shift()!;
      visited++;
      for (const neighbor of adjacency.get(current)!) {
        const newDegree = (inDegree.get(neighbor) ?? 0) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) queue.push(neighbor);
      }
    }

    if (visited !== nodeIds.size) {
      throw new Error('Pipeline definition contains a cycle');
    }
  }

  private async executeNode(
    nodeId: string,
    definition: PipelineDefinition,
    context: PipelineContext,
  ): Promise<PhaseResult> {
    this.stateMachine.transitionNode(nodeId, 'running');
    const node = definition.nodes.find((n) => n.id === nodeId)!;

    try {
      const result = await this.nodeExecutor.execute(node, context, this.stateMachine);
      this.stateMachine.transitionNode(nodeId, 'completed');
      return result;
    } catch (error) {
      this.stateMachine.transitionNode(nodeId, 'failed');
      this.stateMachine.setNodeError(
        nodeId,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }
}
