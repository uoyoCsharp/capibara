/**
 * Pipeline Main Orchestration Service - Coordinates DAG-based pipeline execution
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
  PhaseResult,
} from '../../core/types/pipeline.types.js';
import type { CostTracker } from '../../infrastructure/observability/cost-tracker.js';
import type { PipelineDefinitionLoader } from '../../infrastructure/pipeline/pipeline-definition.loader.js';
import type { Logger } from 'pino';
import { GenericStateMachine } from '../state-machine/generic-state-machine.js';
import { DAGExecutor } from './dag-executor.js';
import { NodeExecutor } from './node-executor.js';
import { WorkerNodeHandler } from './worker-node-handler.js';
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
  PIPELINE_DEFINITION_LOADER_TOKEN,
} from '../../tokens.js';
import { BudgetExceededError } from '../../core/errors/pipeline.errors.js';

@injectable()
export class PipelineService {
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
    @inject(PIPELINE_DEFINITION_LOADER_TOKEN) private definitionLoader: PipelineDefinitionLoader,
  ) {}

  /**
   * Execute full Pipeline using DAG definition
   */
  async run(requirement: Requirement, mode?: InteractionMode): Promise<PipelineResult> {
    const pipelineMode = mode ?? this.config.pipeline.mode;
    const context = this.createInitialContext(requirement, pipelineMode);

    // Load pipeline definition
    const definition = await this.definitionLoader.load(this.config.pipeline.definitionFile);

    this.logger.info(
      {
        pipelineId: context.pipelineId,
        changeId: context.changeId,
        mode: pipelineMode,
        definitionId: definition.id,
        nodeCount: definition.nodes.length,
      },
      'Pipeline started',
    );

    this.eventBus.emit({
      timestamp: new Date().toISOString(),
      pipelineId: context.pipelineId,
      eventType: 'pipeline:started',
      data: { requirement: requirement.id, mode: pipelineMode, definitionId: definition.id },
    });

    // Budget check
    if (this.costTracker.isOverBudget(this.config.pipeline.budgetLimit)) {
      throw new BudgetExceededError(this.config.pipeline.budgetLimit);
    }

    // Create execution components
    const stateMachine = new GenericStateMachine(this.logger, this.eventBus);
    const workerHandler = new WorkerNodeHandler(
      this.worker,
      this.evaluators,
      this.conductor,
      this.messenger,
      this.artifactStore,
      this.eventBus,
      this.config,
      this.logger,
      this.costTracker,
    );
    const nodeExecutor = new NodeExecutor([workerHandler]);
    const dagExecutor = new DAGExecutor(
      nodeExecutor,
      stateMachine,
      this.eventBus,
      this.costTracker,
      this.logger,
    );

    try {
      const result = await dagExecutor.execute(definition, context);

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

      return result;
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

  /** Resume Pipeline from persisted state (TODO: implement for DAG) */
  async resume(pipelineId: string): Promise<PipelineResult> {
    this.logger.warn({ pipelineId }, 'Pipeline resume attempted but not yet implemented for DAG');
    throw new Error(
      `Pipeline resume is not yet implemented for DAG-based pipelines. ` +
        `Pipeline ID: ${pipelineId}. Please start a new pipeline run instead.`,
    );
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
      phaseAttempts: {},
      workerSessionId: crypto.randomUUID(),
      artifacts: {} as Record<Phase, string>,
      mode,
    };
  }
}
