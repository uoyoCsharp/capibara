/**
 * Worker Node Handler - Worker -> Messenger routing -> Evaluator? -> Conductor feedback loop
 *
 * Messenger acts as the central hub:
 * 1. Worker executes
 * 2. Messenger decides if evaluation is needed (shouldEvaluate)
 * 3a. If yes: Evaluators run in parallel → Messenger synthesizes → prepareForConductor
 * 3b. If no: Messenger prepares worker output directly for Conductor
 * 4. Conductor decides: approve / revise / escalate
 *
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

    emitNodeEvent(this.eventBus, context.pipelineId, phase, 'phase:started', {
      nodeId: node.id,
      mode: context.mode,
    });

    while (!approved) {
      // 1. Worker executes
      const workerResult = await this.executeWorker(phase, node, context);
      stateMachine.setNodeOutput(node.id, workerResult.output);

      // 2. Messenger routing: should we evaluate?
      const needsEvaluation = await this.messenger.shouldEvaluate(workerResult, context);

      let conductorInput: string;

      if (needsEvaluation) {
        // 3a. Evaluators run in parallel → Messenger synthesizes
        const artifact = workerResult.artifact || workerResult.output;
        const evalContext = {
          pipelineId: context.pipelineId,
          phase,
          projectDir: this.config.cli.projectDir,
        };

        emitNodeEvent(
          this.eventBus,
          context.pipelineId,
          phase,
          'evaluator:started',
          {
            evaluatorCount: this.evaluators.length,
          },
          'evaluator',
        );

        const evalResults = await Promise.all(
          this.evaluators.map((e) => e.evaluate(artifact, evalContext)),
        );

        emitNodeEvent(
          this.eventBus,
          context.pipelineId,
          phase,
          'evaluator:completed',
          {
            resultCount: evalResults.length,
          },
          'evaluator',
        );

        const synthesized = await this.messenger.synthesize(evalResults, context);
        conductorInput = await this.messenger.prepareForConductor(synthesized, context);
      } else {
        // 3b. Skip evaluation, prepare worker output directly
        conductorInput = await this.messenger.prepareForConductor(
          workerResult.artifact || workerResult.output,
          context,
        );
      }

      // 4. Conductor decides
      const decision = await this.conductor.decide(conductorInput);

      this.logger.info({ phase, nodeId: node.id, action: decision.action }, 'Node decision');

      emitNodeEvent(
        this.eventBus,
        context.pipelineId,
        phase,
        'conductor:decided',
        {
          action: decision.action,
        },
        'conductor',
      );

      if (decision.action === 'approve') {
        approved = true;
        const updated = await this.messenger.updateContext(decision, context);
        Object.assign(context, updated);
      } else if (decision.action === 'escalate') {
        this.logger.warn({ phase, nodeId: node.id }, 'Escalated to human intervention');
        emitNodeEvent(this.eventBus, context.pipelineId, phase, 'human:intervention_requested', {
          reason: decision.reason,
        });
        break;
      } else {
        const shouldBreak = await this.handleRevision(phase, node, context, decision);
        if (shouldBreak) {
          approved = context.mode === 'auto';
          break;
        }
      }
    }

    emitNodeEvent(this.eventBus, context.pipelineId, phase, 'phase:completed', {
      attempts: context.phaseAttempts[phase] ?? 0,
    });

    return {
      attempts: context.phaseAttempts[phase] ?? 0,
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

    emitNodeEvent(
      this.eventBus,
      context.pipelineId,
      phase,
      'worker:completed',
      {
        success: workerResult.success,
        cost: costUsd,
      },
      'worker',
    );

    await this.artifactStore.save(
      context.changeId,
      phase,
      workerResult.artifact || workerResult.output,
    );

    return workerResult;
  }

  /** @returns true if max attempts reached and loop should break */
  private async handleRevision(
    phase: Phase,
    node: PipelineNodeDefinition,
    context: PipelineContext,
    decision: Awaited<ReturnType<IConductor['decide']>>,
  ): Promise<boolean> {
    const attempts = (context.phaseAttempts[phase] ?? 0) + 1;
    context.phaseAttempts[phase] = attempts;

    const maxRetries = this.config.conductor.maxAttemptsPerPhase;
    if (attempts >= maxRetries) {
      this.logger.warn({ phase, nodeId: node.id, attempts }, 'Max attempts reached');
      return true;
    }

    const updated = await this.messenger.updateContext(decision, context);
    Object.assign(context, updated);

    emitNodeEvent(this.eventBus, context.pipelineId, phase, 'phase:retry', {
      attempt: attempts,
    });

    return false;
  }
}
