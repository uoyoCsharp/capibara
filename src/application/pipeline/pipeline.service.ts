/**
 * Pipeline Main Orchestration Service - Coordinates full phase execution flow
 * @module application/pipeline/pipeline-service
 */

import { inject, injectable } from 'tsyringe';
import type { IWorker } from '../../core/interfaces/worker.interface.js';
import type { IEvaluator } from '../../core/interfaces/evaluator.interface.js';
import type { IConductor } from '../../core/interfaces/conductor.interface.js';
import type { IMessenger } from '../../core/interfaces/messenger.interface.js';
import type { IStateStore } from '../../core/interfaces/state-store.interface.js';
import type { IArtifactStore } from '../../core/interfaces/artifact-store.interface.js';
import type { IEventBus } from '../../core/interfaces/event-bus.interface.js';
import type { AutomationConfig } from '../../core/types/config.types.js';
import type { Requirement } from '../../core/types/requirement.types.js';
import type { InteractionMode, Phase } from '../../core/types/phase.types.js';
import type {
  PipelineContext,
  PipelineResult,
  PipelineState,
  PhaseResult,
} from '../../core/types/pipeline.types.js';
import type { CostTracker } from '../../infrastructure/observability/cost-tracker.js';
import type { Logger } from 'pino';
import { StateMachine } from '../state-machine/state-machine.js';
import { PhaseExecutor } from './phase-executor.js';
import {
  WORKER_TOKEN,
  EVALUATOR_TOKEN,
  CONDUCTOR_TOKEN,
  MESSENGER_TOKEN,
  STATE_STORE_TOKEN,
  ARTIFACT_STORE_TOKEN,
  EVENT_BUS_TOKEN,
  CONFIG_TOKEN,
  LOGGER_TOKEN,
  COST_TRACKER_TOKEN,
} from '../../tokens.js';
import { BudgetExceededError } from '../../core/errors/pipeline.errors.js';
import { PipelineStateName } from '../state-machine/states.js';

@injectable()
export class PipelineService {
  private phaseExecutor: PhaseExecutor;

  constructor(
    @inject(WORKER_TOKEN) private worker: IWorker,
    @inject(EVALUATOR_TOKEN) private evaluators: IEvaluator[],
    @inject(CONDUCTOR_TOKEN) private conductor: IConductor,
    @inject(MESSENGER_TOKEN) private messenger: IMessenger,
    @inject(STATE_STORE_TOKEN) private stateStore: IStateStore,
    @inject(ARTIFACT_STORE_TOKEN) private artifactStore: IArtifactStore,
    @inject(EVENT_BUS_TOKEN) private eventBus: IEventBus,
    @inject(CONFIG_TOKEN) private config: AutomationConfig,
    @inject(LOGGER_TOKEN) private logger: Logger,
    @inject(COST_TRACKER_TOKEN) private costTracker: CostTracker,
  ) {
    this.phaseExecutor = new PhaseExecutor(
      worker,
      evaluators,
      conductor,
      messenger,
      artifactStore,
      eventBus,
      config,
      logger,
      costTracker,
    );
  }

  /**
   * Execute full Pipeline:
   * analyze -> design -> implement -> review -> test
   */
  async run(requirement: Requirement, mode?: InteractionMode): Promise<PipelineResult> {
    const startTime = Date.now();
    const pipelineMode = mode ?? this.config.pipeline.mode;
    const context = this.createInitialContext(requirement, pipelineMode);
    const stateMachine = new StateMachine(this.logger, this.eventBus);

    this.logger.info(
      { pipelineId: context.pipelineId, changeId: context.changeId, mode: pipelineMode },
      'Pipeline started',
    );

    this.eventBus.emit({
      timestamp: new Date().toISOString(),
      pipelineId: context.pipelineId,
      eventType: 'pipeline:started',
      data: { requirement: requirement.id, mode: pipelineMode },
    });

    // State machine starts
    stateMachine.transition('new_requirement');

    const phases = this.config.pipeline.phases;
    const phaseResults: Record<string, PhaseResult> = {};

    try {
      for (let i = 0; i < phases.length; i++) {
        const phase = phases[i];

        // Budget check
        if (this.costTracker.isOverBudget(this.config.pipeline.budgetLimit)) {
          throw new BudgetExceededError(this.config.pipeline.budgetLimit);
        }

        // First phase triggers start_analyze, subsequent phases driven by approve
        if (i === 0) {
          stateMachine.transition(`start_${phase}`);
        }

        this.logger.info({ phase, index: i + 1, total: phases.length }, 'Phase starting');

        const result = await this.phaseExecutor.execute(phase, context, stateMachine, pipelineMode);
        phaseResults[phase] = result;

        // Persist current state
        await this.stateStore.save(this.toState(context, stateMachine));
      }

      this.eventBus.emit({
        timestamp: new Date().toISOString(),
        pipelineId: context.pipelineId,
        eventType: 'pipeline:completed',
        data: { changeId: context.changeId, totalCost: this.costTracker.getTotalCost() },
      });

      this.logger.info(
        { changeId: context.changeId, cost: this.costTracker.getTotalCost() },
        'Pipeline completed',
      );

      return {
        success: true,
        changeId: context.changeId,
        phases: phaseResults as Record<Phase, PhaseResult>,
        totalCost: this.costTracker.getTotalCost(),
        totalDuration: Date.now() - startTime,
      };
    } catch (error) {
      this.eventBus.emit({
        timestamp: new Date().toISOString(),
        pipelineId: context.pipelineId,
        eventType: 'pipeline:failed',
        data: { error: error instanceof Error ? error.message : String(error) },
      });

      this.logger.error({ error }, 'Pipeline failed');
      throw error;
    }
  }

  /** Resume Pipeline from persisted state */
  async resume(pipelineId: string): Promise<PipelineResult> {
    const state = await this.stateStore.load(pipelineId);
    if (!state) {
      throw new Error(`Pipeline ${pipelineId} not found`);
    }

    this.logger.info(
      { pipelineId, currentPhase: state.currentPhase, currentState: state.currentState },
      'Resuming pipeline',
    );

    // Restore context from state
    const context: PipelineContext = {
      pipelineId: state.id,
      requirement: state.context.requirement,
      changeId: state.changeId,
      currentPhase: state.currentPhase,
      completedPhases: Object.keys(state.context.artifacts) as Phase[],
      phaseAttempts: state.phaseAttempts,
      workerSessionId: state.sessions.workerSessionId,
      artifacts: state.context.artifacts,
      mode: state.metadata.mode,
    };

    // Restore state machine
    const stateMachine = new StateMachine(this.logger, this.eventBus);
    stateMachine.setState(state.currentState as PipelineStateName);

    // Find phases to continue
    const phases = this.config.pipeline.phases;
    const currentIdx = phases.indexOf(state.currentPhase);
    const remainingPhases = phases.slice(currentIdx);
    const phaseResults: Record<string, PhaseResult> = {};
    const startTime = Date.now();

    for (const phase of remainingPhases) {
      if (this.costTracker.isOverBudget(this.config.pipeline.budgetLimit)) {
        throw new BudgetExceededError(this.config.pipeline.budgetLimit);
      }

      const result = await this.phaseExecutor.execute(phase, context, stateMachine, context.mode);
      phaseResults[phase] = result;

      await this.stateStore.save(this.toState(context, stateMachine));
    }

    return {
      success: true,
      changeId: context.changeId,
      phases: phaseResults as Record<Phase, PhaseResult>,
      totalCost: this.costTracker.getTotalCost(),
      totalDuration: Date.now() - startTime,
    };
  }

  /** Create Pipeline initial context */
  private createInitialContext(requirement: Requirement, mode: InteractionMode): PipelineContext {
    const now = new Date();
    const slug = requirement.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 30);
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const changeId = `${dateStr}-${slug}`;

    return {
      pipelineId: crypto.randomUUID(),
      requirement,
      changeId,
      currentPhase: 'analyze',
      completedPhases: [],
      phaseAttempts: { analyze: 0, design: 0, implement: 0, review: 0, test: 0 },
      workerSessionId: `worker-${changeId}`,
      artifacts: {} as Record<Phase, string>,
      mode,
    };
  }

  /** Convert runtime context to persistable state snapshot */
  private toState(context: PipelineContext, sm: StateMachine): PipelineState {
    return {
      id: context.pipelineId,
      requirementId: context.requirement.id,
      changeId: context.changeId,
      currentState: sm.getState(),
      currentPhase: context.currentPhase,
      phaseAttempts: context.phaseAttempts,
      context: {
        requirement: context.requirement,
        artifacts: context.artifacts,
        evaluations: {} as Record<Phase, never[]>,
        decisions: {} as Record<Phase, never[]>,
      },
      sessions: {
        workerSessionId: context.workerSessionId,
        workerSessionPhase: context.currentPhase,
      },
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'running',
        mode: context.mode,
        totalTokensUsed: 0,
        totalCost: this.costTracker.getTotalCost(),
      },
    };
  }
}
