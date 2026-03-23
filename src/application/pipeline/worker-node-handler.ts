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
 * Human intervention:
 * - manual mode: Intervention after each worker execution
 * - semi-auto mode: Intervention on Conductor escalate
 *
 * @module application/pipeline/worker-node-handler
 */

import type { IWorker } from '../../core/interfaces/worker.interface.js';
import type { IEvaluator } from '../../core/interfaces/evaluator.interface.js';
import type { IConductor } from '../../core/interfaces/conductor.interface.js';
import type { IMessenger } from '../../core/interfaces/messenger.interface.js';
import type { IArtifactStore } from '../../core/interfaces/artifact-store.interface.js';
import type { IEventBus } from '../../core/interfaces/event-bus.interface.js';
import type { IExecutionLogStore } from '../../core/interfaces/execution-log-store.interface.js';
import type { AutomationConfig } from '../../core/types/config.types.js';
import type {
  PipelineContext,
  PhaseResult,
  InteractionRecord,
} from '../../core/types/pipeline.types.js';
import type { PipelineNodeDefinition } from '../../core/types/dag.types.js';
import type { Phase } from '../../core/types/phase.types.js';
import type { GenericStateMachine } from '../state-machine/generic-state-machine.js';
import type { CostTracker } from '../../infrastructure/observability/cost-tracker.js';
import type { Logger } from 'pino';
import type { INodeHandler } from './node-handler.js';
import type { HumanInteractionHandler } from '../human-interaction/human-interaction.handler.js';
import type { WorkerResult } from '../../core/types/worker.types.js';
import { emitNodeEvent } from './node-handler.js';
import {
  truncateOutput,
  ExecutionLogEntry,
} from '../../core/types/execution-log.types.js';
import crypto from 'node:crypto';

/** Maximum output size for logging (10KB) */
const MAX_OUTPUT_LOG_SIZE = 10240;

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
    private executionLogStore: IExecutionLogStore,
    private humanInteractionHandler: HumanInteractionHandler,
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

    // Initialize round if not present
    if (context.currentRound === undefined) {
      context.currentRound = 0;
    }
    if (context.interactionHistory === undefined) {
      context.interactionHistory = [];
    }

    await this.emitLogEvent(context.pipelineId, context.changeId, phase, 'phase:started', 'info', {
      nodeId: node.id,
      mode: context.mode,
    });

    while (!approved) {
      // Increment round counter
      context.currentRound++;

      // 1. Worker executes
      const workerResult = await this.executeWorker(phase, node, context);
      stateMachine.setNodeOutput(node.id, workerResult.output);

      // Store evaluation results for potential human intervention
      let evalResults: string[] | undefined;

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

        await this.emitLogEvent(
          context.pipelineId,
          context.changeId,
          phase,
          'evaluator:started',
          'info',
          { evaluatorCount: this.evaluators.length },
          'evaluator',
        );

        evalResults = await Promise.all(
          this.evaluators.map((e) => e.evaluate(artifact, evalContext)),
        );

        await this.emitLogEvent(
          context.pipelineId,
          context.changeId,
          phase,
          'evaluator:completed',
          'info',
          {
            resultCount: evalResults.length,
            evaluatorResults: evalResults.map((r) => r.slice(0, 500)),
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

      // MANUAL MODE: Human intervention after worker completes (before Conductor)
      if (context.mode === 'manual') {
        const humanResponse = await this.humanInteractionHandler.requestApproval(
          context,
          'Manual mode: Review worker output',
          workerResult.output,
          evalResults,
        );

        if (!humanResponse.approved) {
          // Treat as revise with human feedback
          const revisedContext = await this.messenger.updateContext(
            {
              action: 'revise',
              reason: 'Human rejected',
              feedback: [humanResponse.feedback],
            },
            context,
          );
          Object.assign(context, revisedContext);

          // Record interaction
          this.recordInteraction(context, phase, workerResult, evalResults, {
            action: 'revise',
            reason: 'Human rejected',
          });

          const shouldBreak = await this.handleRevision(phase, node, context, {
            action: 'revise',
            reason: 'Human rejected',
            feedback: [humanResponse.feedback],
          });
          if (shouldBreak) {
            approved = true; // Break out of loop, treat as completed
            break;
          }
          continue; // Skip Conductor, go to next worker iteration
        }

        // Human approved - record and proceed
        this.recordInteraction(context, phase, workerResult, evalResults, {
          action: 'approve',
          reason: 'Human approved',
        });
      }

      // 4. Conductor decides
      const decision = await this.conductor.decide(conductorInput);

      this.logger.info({ phase, nodeId: node.id, action: decision.action }, 'Node decision');

      await this.emitLogEvent(
        context.pipelineId,
        context.changeId,
        phase,
        'conductor:decided',
        'info',
        {
          action: decision.action,
          reason: decision.reason,
          feedback: decision.feedback,
        },
        'conductor',
      );

      if (decision.action === 'approve') {
        approved = true;
        this.recordInteraction(context, phase, workerResult, evalResults, decision);
        const updated = await this.messenger.updateContext(decision, context);
        Object.assign(context, updated);
      } else if (decision.action === 'escalate') {
        // SEMI-AUTO MODE: Human intervention on escalate
        if (context.mode === 'semi-auto') {
          const humanResponse = await this.humanInteractionHandler.requestApproval(
            context,
            decision.reason,
            workerResult.output,
            evalResults,
          );

          if (humanResponse.approved) {
            // Human overrides escalate -> approve
            approved = true;
            this.recordInteraction(context, phase, workerResult, evalResults, decision, true);
            const updated = await this.messenger.updateContext(
              { action: 'approve', reason: 'Human override' },
              context,
            );
            Object.assign(context, updated);
          } else {
            // Human provides feedback -> revise
            this.recordInteraction(context, phase, workerResult, evalResults, decision);
            const revisedContext = await this.messenger.updateContext(
              {
                action: 'revise',
                reason: 'Human feedback after escalate',
                feedback: [humanResponse.feedback],
              },
              context,
            );
            Object.assign(context, revisedContext);

            const shouldBreak = await this.handleRevision(phase, node, context, {
              action: 'revise',
              reason: 'Human feedback',
              feedback: [humanResponse.feedback],
            });
            if (shouldBreak) {
              approved = true; // Break out of loop, treat as completed
              break;
            }
          }
        } else {
          // AUTO mode: escalate breaks the loop
          this.logger.warn({ phase, nodeId: node.id }, 'Escalated to human intervention');
          this.recordInteraction(context, phase, workerResult, evalResults, decision);
          await this.emitLogEvent(
            context.pipelineId,
            context.changeId,
            phase,
            'human:intervention_requested',
            'warn',
            { reason: decision.reason },
          );
          break;
        }
      } else {
        // revise
        this.recordInteraction(context, phase, workerResult, evalResults, decision);
        const shouldBreak = await this.handleRevision(phase, node, context, decision);
        if (shouldBreak) {
          approved = true; // Break out of loop, treat as completed
          break;
        }
      }
    }

    await this.emitLogEvent(
      context.pipelineId,
      context.changeId,
      phase,
      'phase:completed',
      'info',
      {
        attempts: context.phaseAttempts[phase] ?? 0,
        approved,
      },
    );

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
  ): Promise<WorkerResult> {
    await this.emitLogEvent(
      context.pipelineId,
      context.changeId,
      phase,
      'worker:started',
      'info',
      {},
      'worker',
    );

    const workerCommand = await this.messenger.formatForWorker(phase, context);
    const workerResult = await this.worker.executeCommand(workerCommand);
    const costUsd = (workerResult.metadata.costUsd as number) ?? 0;
    this.costTracker.add(costUsd);

    const { output: truncatedOutput, truncated } = truncateOutput(
      workerResult.output,
      MAX_OUTPUT_LOG_SIZE,
    );

    await this.emitLogEvent(
      context.pipelineId,
      context.changeId,
      phase,
      'worker:completed',
      workerResult.success ? 'info' : 'error',
      {
        success: workerResult.success,
        cost: costUsd,
        duration: workerResult.duration,
      },
      'worker',
      truncatedOutput,
      truncated,
    );

    await this.artifactStore.save(
      context.changeId,
      phase,
      workerResult.artifact || workerResult.output,
    );

    return workerResult;
  }

  /** Record interaction for human intervention context */
  private recordInteraction(
    context: PipelineContext,
    phase: Phase,
    workerResult: WorkerResult,
    evalResults: string[] | undefined,
    decision: { action: string; reason: string; feedback?: string[] },
    humanOverride?: boolean,
  ): void {
    const { output: truncatedOutput, truncated } = truncateOutput(
      workerResult.output,
      MAX_OUTPUT_LOG_SIZE,
    );

    const record: InteractionRecord = {
      round: context.currentRound,
      phase,
      timestamp: new Date().toISOString(),
      workerOutput: truncatedOutput,
      workerOutputTruncated: truncated,
      evaluatorSummary: evalResults?.map((r) => r.slice(0, 200)).join('\n'),
      conductorDecision: decision.action as 'approve' | 'revise' | 'escalate',
      conductorReason: humanOverride ? 'Human override' : decision.reason,
      feedback: decision.feedback?.join('\n'),
    };

    // Keep only last 3 records (most recent first)
    context.interactionHistory.unshift(record);
    if (context.interactionHistory.length > 3) {
      context.interactionHistory.pop();
    }
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

    await this.emitLogEvent(context.pipelineId, context.changeId, phase, 'phase:retry', 'warn', {
      attempt: attempts,
    });

    return false;
  }

  /** Emit event and persist to execution log */
  private async emitLogEvent(
    pipelineId: string,
    changeId: string,
    phase: Phase,
    eventType: string,
    level: 'info' | 'warn' | 'error',
    data: Record<string, unknown>,
    role?: string,
    output?: string,
    outputTruncated?: boolean,
  ): Promise<void> {
    const event = {
      timestamp: new Date().toISOString(),
      pipelineId,
      phase,
      eventType,
      data,
    };

    // Emit to event bus
    this.eventBus.emit({
      ...event,
      role,
    } as any);

    // Persist to execution log store
    const logEntry: ExecutionLogEntry = {
      id: crypto.randomUUID(),
      timestamp: event.timestamp,
      pipelineId,
      changeId,
      phase,
      eventType: eventType as any,
      level,
      payload: data,
      output,
      outputTruncated,
    };

    await this.executionLogStore.append(logEntry);
  }
}
