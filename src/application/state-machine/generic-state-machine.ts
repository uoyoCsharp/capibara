/**
 * Generic State Machine
 *
 * Replaces hardcoded PipelineStateName enum and TRANSITIONS array.
 * States are dynamically generated from PipelineDefinition node list.
 * @module application/state-machine/generic-state-machine
 */

import type {
  NodeStatus,
  NodeState,
  PipelineExecutionState,
} from '../../core/types/node-state.types.js';
import type { PipelineDefinition, PipelineEdgeDefinition } from '../../core/types/dag.types.js';
import type { IEventBus } from '../../core/interfaces/event-bus.interface.js';
import type { Logger } from 'pino';

export class GenericStateMachine {
  private state!: PipelineExecutionState;

  constructor(
    private logger: Logger,
    private eventBus: IEventBus,
  ) {}

  /** Initialize from PipelineDefinition */
  initialize(definition: PipelineDefinition, pipelineId: string): void {
    const nodes: Record<string, NodeState> = {};
    for (const node of definition.nodes) {
      nodes[node.id] = { nodeId: node.id, status: 'pending', attempts: 0 };
    }
    this.state = {
      pipelineId,
      definitionId: definition.id,
      nodes,
      status: 'running',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  /** Get all ready nodes (all dependencies completed) */
  getReadyNodes(edges: PipelineEdgeDefinition[]): string[] {
    return Object.values(this.state.nodes)
      .filter((n) => n.status === 'pending')
      .filter((n) => {
        const deps = edges.filter((e) => e.to === n.nodeId).map((e) => e.from);
        return deps.every((d) => this.state.nodes[d]?.status === 'completed');
      })
      .map((n) => n.nodeId);
  }

  /** Transition a node's status */
  transitionNode(nodeId: string, newStatus: NodeStatus): void {
    const node = this.state.nodes[nodeId];
    if (!node) {
      throw new Error(`Node ${nodeId} not found in state machine`);
    }

    const oldStatus = node.status;
    node.status = newStatus;
    this.state.updatedAt = new Date().toISOString();

    if (newStatus === 'running') {
      node.startedAt = new Date().toISOString();
      node.attempts++;
    }
    if (newStatus === 'completed' || newStatus === 'failed') {
      node.completedAt = new Date().toISOString();
    }

    this.logger.info({ nodeId, from: oldStatus, to: newStatus }, 'Node state transition');
  }

  /** Cancel all non-terminal nodes */
  cancelAllPending(): void {
    for (const node of Object.values(this.state.nodes)) {
      if (node.status === 'pending' || node.status === 'ready' || node.status === 'running') {
        node.status = 'cancelled';
      }
    }
    this.state.status = 'failed';
    this.state.updatedAt = new Date().toISOString();
  }

  /** Check if pipeline execution has terminated */
  isTerminal(): boolean {
    return Object.values(this.state.nodes).every((n) =>
      ['completed', 'failed', 'cancelled'].includes(n.status),
    );
  }

  /** Mark pipeline as completed */
  markCompleted(): void {
    this.state.status = 'completed';
    this.state.updatedAt = new Date().toISOString();
  }

  /** Get a node's state */
  getNodeState(nodeId: string): NodeState | undefined {
    return this.state.nodes[nodeId];
  }

  /** Get a node's output */
  setNodeOutput(nodeId: string, output: string): void {
    const node = this.state.nodes[nodeId];
    if (node) node.output = output;
  }

  /** Set a node's error */
  setNodeError(nodeId: string, error: string): void {
    const node = this.state.nodes[nodeId];
    if (node) node.error = error;
  }

  /** Export snapshot for persistence */
  snapshot(): PipelineExecutionState {
    return structuredClone(this.state);
  }

  /** Restore from snapshot */
  restore(snapshot: PipelineExecutionState): void {
    this.state = structuredClone(snapshot);
  }
}
