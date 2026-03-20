/**
 * Node Executor - Executes a single DAG node
 *
 * Handles the Worker -> Evaluator -> Conductor feedback loop for a node.
 * Replaces the old PhaseExecutor's hardcoded loop logic.
 * @module application/pipeline/node-executor
 */

import type { IWorker } from '../../core/interfaces/worker.interface.js';
import type { IEvaluator } from '../../core/interfaces/evaluator.interface.js';
import type { IConductor } from '../../core/interfaces/conductor.interface.js';
import type { IMessenger } from '../../core/interfaces/messenger.interface.js';
import type { IArtifactStore } from '../../core/interfaces/artifact-store.interface.js';
import type { IEventBus } from '../../core/interfaces/event-bus.interface.js';
import type { AutomationConfig } from '../../core/types/config.types.js';
import type { PipelineContext, PhaseResult } from '../../core/types/pipeline.types.js';
import type { PipelineNodeDefinition } from '../../core/types/dag.types.js';
import type { GenericStateMachine } from '../state-machine/generic-state-machine.js';
import type { CostTracker } from '../../infrastructure/observability/cost-tracker.js';
import type { Logger } from 'pino';

export class NodeExecutor {
  constructor(
    private worker: IWorker,
    private evaluators: IEvaluator[],
    private conductor: IConductor,
    private messenger: IMessenger,
    private artifactStore: IArtifactStore,
    private eventBus: IEventBus,
    private config: AutomationConfig,
    private logger: Logger,
    private costTracker: CostTracker,
  ) {}

  /**
   * Execute a single node with the Worker -> Evaluator -> Conductor feedback loop.
   * For 'worker' nodes, runs the full loop.
   * Other node types can be extended in the future.
   */
  async execute(
    node: PipelineNodeDefinition,
    context: PipelineContext,
    stateMachine: GenericStateMachine,
  ): Promise<PhaseResult> {
    const phase = node.phase ?? node.id;
    const startTime = Date.now();
    context.currentPhase = phase;
    let approved = false;
    let lastScore = 0;

    this.eventBus.emit({
      timestamp: new Date().toISOString(),
      pipelineId: context.pipelineId,
      phase,
      eventType: 'phase:started',
      data: { nodeId: node.id, mode: context.mode },
    });

    while (!approved) {
      // 1. Worker execution
      this.eventBus.emit({
        timestamp: new Date().toISOString(),
        pipelineId: context.pipelineId,
        phase,
        role: 'worker',
        eventType: 'worker:started',
        data: {},
      });

      const workerCommand = await this.messenger.formatForWorker(phase, context);
      const workerResult = await this.worker.executeCommand(workerCommand);
      const costUsd = (workerResult.metadata.costUsd as number) ?? 0;
      this.costTracker.add(costUsd);

      this.eventBus.emit({
        timestamp: new Date().toISOString(),
        pipelineId: context.pipelineId,
        phase,
        role: 'worker',
        eventType: 'worker:completed',
        data: { success: workerResult.success, cost: costUsd },
      });

      // Save artifact
      await this.artifactStore.save(
        context.changeId,
        phase,
        workerResult.artifact || workerResult.output,
      );

      stateMachine.setNodeOutput(node.id, workerResult.output);

      // 2. Evaluator parallel evaluation
      this.eventBus.emit({
        timestamp: new Date().toISOString(),
        pipelineId: context.pipelineId,
        phase,
        role: 'evaluator',
        eventType: 'evaluator:started',
        data: { dimensions: this.evaluators.map((e) => e.getDimension()) },
      });

      const evalInput = await this.messenger.formatForEvaluator(workerResult, context);
      const evaluations = await Promise.all(this.evaluators.map((e) => e.evaluate(evalInput)));

      this.eventBus.emit({
        timestamp: new Date().toISOString(),
        pipelineId: context.pipelineId,
        phase,
        role: 'evaluator',
        eventType: 'evaluator:completed',
        data: {
          results: evaluations.map((e) => ({
            dimension: e.dimension,
            verdict: e.verdict,
            score: e.score,
          })),
        },
      });

      // 3. Messenger synthesize feedback + Conductor decide
      await this.messenger.synthesizeFeedback(evaluations, context);
      const decision = await this.conductor.decide(evaluations);

      lastScore = evaluations.reduce((s, e) => s + e.score, 0) / evaluations.length;

      this.logger.info(
        { phase, nodeId: node.id, action: decision.action, score: lastScore.toFixed(1) },
        'Node decision',
      );

      this.eventBus.emit({
        timestamp: new Date().toISOString(),
        pipelineId: context.pipelineId,
        phase,
        role: 'conductor',
        eventType: 'conductor:decided',
        data: { action: decision.action, score: lastScore },
      });

      // 4. Process decision
      if (decision.action === 'approve') {
        approved = true;
        const updated = this.messenger.updateContext(decision, context);
        Object.assign(context, updated);
      } else if (decision.action === 'escalate') {
        this.logger.warn({ phase, nodeId: node.id }, 'Escalated to human intervention');
        this.eventBus.emit({
          timestamp: new Date().toISOString(),
          pipelineId: context.pipelineId,
          phase,
          eventType: 'human:intervention_requested',
          data: { reason: decision.reason },
        });
        break;
      } else {
        // revise
        const attempts = (context.phaseAttempts[phase] ?? 0) + 1;
        context.phaseAttempts[phase] = attempts;

        const maxRetries = this.config.conductor.maxAttemptsPerPhase;
        if (attempts >= maxRetries) {
          this.logger.warn({ phase, nodeId: node.id, attempts }, 'Max attempts reached');
          if (context.mode === 'auto') {
            approved = true;
            this.logger.warn({ phase }, 'Auto-approving after max retries');
          }
          break;
        }

        const updated = this.messenger.updateContext(decision, context);
        Object.assign(context, updated);

        this.eventBus.emit({
          timestamp: new Date().toISOString(),
          pipelineId: context.pipelineId,
          phase,
          eventType: 'phase:retry',
          data: { attempt: attempts },
        });
      }
    }

    this.eventBus.emit({
      timestamp: new Date().toISOString(),
      pipelineId: context.pipelineId,
      phase,
      eventType: 'phase:completed',
      data: { score: lastScore, attempts: context.phaseAttempts[phase] ?? 0 },
    });

    return {
      attempts: context.phaseAttempts[phase] ?? 0,
      finalScore: lastScore,
      duration: Date.now() - startTime,
      tokenCost: 0,
    };
  }
}
