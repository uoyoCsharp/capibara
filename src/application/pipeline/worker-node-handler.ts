/**
 * Worker Node Handler - Worker -> Evaluator -> Conductor feedback loop
 *
 * Extracted from the original monolithic NodeExecutor.
 * Handles nodes of type 'worker'.
 * @module application/pipeline/worker-node-handler
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
import type { Phase } from '../../core/types/phase.types.js';
import type { GenericStateMachine } from '../state-machine/generic-state-machine.js';
import type { CostTracker } from '../../infrastructure/observability/cost-tracker.js';
import type { Logger } from 'pino';
import type { INodeHandler } from './node-handler.js';
import { emitNodeEvent } from './node-handler.js';

export class WorkerNodeHandler implements INodeHandler {
  readonly nodeType = 'worker' as const;

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

  async handle(
    node: PipelineNodeDefinition,
    context: PipelineContext,
    stateMachine: GenericStateMachine,
  ): Promise<PhaseResult> {
    const phase = node.phase ?? node.id;
    const startTime = Date.now();
    context.currentPhase = phase;
    let approved = false;
    let lastScore = 0;

    emitNodeEvent(this.eventBus, context.pipelineId, phase, 'phase:started', {
      nodeId: node.id,
      mode: context.mode,
    });

    while (!approved) {
      const workerResult = await this.executeWorker(phase, node, context);
      stateMachine.setNodeOutput(node.id, workerResult.output);

      const evaluations = await this.runEvaluations(phase, context, workerResult);
      lastScore = evaluations.reduce((s, e) => s + e.score, 0) / evaluations.length;

      const decision = await this.decide(phase, node, context, evaluations, lastScore);

      if (decision.action === 'approve') {
        approved = true;
        const updated = this.messenger.updateContext(decision, context);
        Object.assign(context, updated);
      } else if (decision.action === 'escalate') {
        this.logger.warn({ phase, nodeId: node.id }, 'Escalated to human intervention');
        emitNodeEvent(this.eventBus, context.pipelineId, phase, 'human:intervention_requested', {
          reason: decision.reason,
        });
        break;
      } else {
        const shouldBreak = this.handleRevision(phase, node, context, decision);
        if (shouldBreak) {
          approved = context.mode === 'auto';
          break;
        }
      }
    }

    emitNodeEvent(this.eventBus, context.pipelineId, phase, 'phase:completed', {
      score: lastScore,
      attempts: context.phaseAttempts[phase] ?? 0,
    });

    return {
      attempts: context.phaseAttempts[phase] ?? 0,
      finalScore: lastScore,
      duration: Date.now() - startTime,
      tokenCost: 0,
    };
  }

  private async executeWorker(
    phase: Phase,
    node: PipelineNodeDefinition,
    context: PipelineContext,
  ) {
    emitNodeEvent(this.eventBus, context.pipelineId, phase, 'worker:started', {}, 'worker');

    const workerCommand = await this.messenger.formatForWorker(phase, context);
    const workerResult = await this.worker.executeCommand(workerCommand);
    const costUsd = (workerResult.metadata.costUsd as number) ?? 0;
    this.costTracker.add(costUsd);

    emitNodeEvent(this.eventBus, context.pipelineId, phase, 'worker:completed', {
      success: workerResult.success,
      cost: costUsd,
    }, 'worker');

    await this.artifactStore.save(
      context.changeId,
      phase,
      workerResult.artifact || workerResult.output,
    );

    return workerResult;
  }

  private async runEvaluations(
    phase: Phase,
    context: PipelineContext,
    workerResult: Awaited<ReturnType<IWorker['executeCommand']>>,
  ) {
    emitNodeEvent(this.eventBus, context.pipelineId, phase, 'evaluator:started', {
      dimensions: this.evaluators.map((e) => e.getDimension()),
    }, 'evaluator');

    const evalInput = await this.messenger.formatForEvaluator(workerResult, context);
    const evaluations = await Promise.all(this.evaluators.map((e) => e.evaluate(evalInput)));

    emitNodeEvent(this.eventBus, context.pipelineId, phase, 'evaluator:completed', {
      results: evaluations.map((e) => ({
        dimension: e.dimension,
        verdict: e.verdict,
        score: e.score,
      })),
    }, 'evaluator');

    return evaluations;
  }

  private async decide(
    phase: Phase,
    node: PipelineNodeDefinition,
    context: PipelineContext,
    evaluations: Awaited<ReturnType<IEvaluator['evaluate']>>[],
    score: number,
  ) {
    await this.messenger.synthesizeFeedback(evaluations, context);
    const decision = await this.conductor.decide(evaluations);

    this.logger.info(
      { phase, nodeId: node.id, action: decision.action, score: score.toFixed(1) },
      'Node decision',
    );

    emitNodeEvent(this.eventBus, context.pipelineId, phase, 'conductor:decided', {
      action: decision.action,
      score,
    }, 'conductor');

    return decision;
  }

  /** @returns true if max attempts reached and loop should break */
  private handleRevision(
    phase: Phase,
    node: PipelineNodeDefinition,
    context: PipelineContext,
    decision: Awaited<ReturnType<IConductor['decide']>>,
  ): boolean {
    const attempts = (context.phaseAttempts[phase] ?? 0) + 1;
    context.phaseAttempts[phase] = attempts;

    const maxRetries = this.config.conductor.maxAttemptsPerPhase;
    if (attempts >= maxRetries) {
      this.logger.warn({ phase, nodeId: node.id, attempts }, 'Max attempts reached');
      return true;
    }

    const updated = this.messenger.updateContext(decision, context);
    Object.assign(context, updated);

    emitNodeEvent(this.eventBus, context.pipelineId, phase, 'phase:retry', {
      attempt: attempts,
    });

    return false;
  }
}
