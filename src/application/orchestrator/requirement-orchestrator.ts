/**
 * Requirement Orchestrator - Consumes requirements from pool, executes pipelines, manages standby
 * @module application/orchestrator/requirement-orchestrator
 */

import type { IRequirementPool } from '../../core/interfaces/requirement-pool.interface.js';
import type { IProjectRegistry } from '../../core/interfaces/project-registry.interface.js';
import type { IEventBus } from '../../core/interfaces/event-bus.interface.js';
import type { AutomationConfig } from '../../core/types/config.types.js';
import type { Requirement } from '../../core/types/requirement.types.js';
import type { PipelineService } from '../pipeline/pipeline.service.js';
import type { Logger } from 'pino';

export type OrchestratorState = 'idle' | 'consuming' | 'running' | 'standby';

export class RequirementOrchestrator {
  private state: OrchestratorState = 'idle';
  private stopRequested = false;
  private activeProjectId: string | null = null;
  private pipeline: PipelineService | null = null;
  private runningPromise: Promise<void> | null = null;
  private sleepResolve: (() => void) | null = null;

  constructor(
    private pool: IRequirementPool,
    private registry: IProjectRegistry,
    private bootstrapFn: (config: AutomationConfig) => PipelineService,
    private baseConfig: AutomationConfig,
    private logger: Logger,
    private eventBus: IEventBus,
    private pollInterval: number = 10_000,
  ) {}

  getState(): OrchestratorState {
    return this.state;
  }

  /**
   * Request graceful stop. Returns a Promise that resolves when the
   * orchestrator loop has fully exited (including any in-flight pipeline).
   */
  async stop(): Promise<void> {
    this.stopRequested = true;
    // Wake up from standby sleep immediately
    if (this.sleepResolve) {
      this.sleepResolve();
      this.sleepResolve = null;
    }
    this.logger.info('Orchestrator stop requested (will finish current pipeline if running)');
    // Wait for the loop to actually finish
    if (this.runningPromise) {
      await this.runningPromise;
    }
  }

  async start(): Promise<void> {
    if (this.state !== 'idle') {
      throw new Error(`Orchestrator is already in state: ${this.state}`);
    }

    const project = await this.registry.getActive();
    if (!project) {
      throw new Error(
        'No active project. Run `cpbr project add` then `cpbr project switch` first.',
      );
    }

    this.activeProjectId = project.id;
    this.stopRequested = false;

    const config = this.mergeConfig(this.baseConfig, project.config, project.projectDir);
    this.pipeline = this.bootstrapFn(config);

    this.logger.info(
      { projectId: project.id, projectName: project.name, projectDir: project.projectDir },
      'Orchestrator started',
    );

    this.eventBus.emit({
      timestamp: new Date().toISOString(),
      pipelineId: '',
      eventType: 'orchestrator:started',
      data: { projectId: project.id },
    });

    this.runningPromise = this.consumeLoop();
    try {
      await this.runningPromise;
    } finally {
      this.runningPromise = null;
      this.state = 'idle';
      this.pipeline = null;
      this.activeProjectId = null;
      this.logger.info('Orchestrator stopped');
    }
  }

  private async consumeLoop(): Promise<void> {
    while (!this.stopRequested) {
      this.state = 'consuming';

      // Check if active project has changed
      const currentActive = await this.registry.getActive();
      if (currentActive && currentActive.id !== this.activeProjectId) {
        this.logger.info(
          { from: this.activeProjectId, to: currentActive.id },
          'Active project changed, re-bootstrapping',
        );
        this.activeProjectId = currentActive.id;
        const config = this.mergeConfig(
          this.baseConfig,
          currentActive.config,
          currentActive.projectDir,
        );
        this.pipeline = this.bootstrapFn(config);
      }

      if (!this.activeProjectId) break;

      const req = await this.pool.nextPending(this.activeProjectId);

      if (!req) {
        this.state = 'standby';
        this.logger.debug(
          { pollInterval: this.pollInterval },
          'No pending requirements, entering standby',
        );
        await this.sleep(this.pollInterval);
        continue;
      }

      await this.executeRequirement(req);
    }
  }

  private async executeRequirement(req: Requirement): Promise<void> {
    this.state = 'running';

    this.logger.info({ requirementId: req.id, title: req.title }, 'Processing requirement');

    await this.pool.update(req.id, { status: 'in-progress' });

    try {
      const result = await this.pipeline!.run(
        {
          id: req.id,
          title: req.title,
          description: req.description,
          source: req.source ?? 'manual',
          metadata: req.metadata ?? {},
          createdAt: req.createdAt,
        },
        this.baseConfig.pipeline.mode,
      );

      const status = result.success ? ('completed' as const) : ('failed' as const);
      await this.pool.update(req.id, { status });

      this.logger.info(
        { requirementId: req.id, success: result.success, cost: result.totalCost },
        'Requirement processing finished',
      );
    } catch (error) {
      await this.pool.update(req.id, { status: 'failed' });

      this.logger.error(
        { requirementId: req.id, error: error instanceof Error ? error.message : String(error) },
        'Requirement processing failed',
      );
    }
  }

  private mergeConfig(
    base: AutomationConfig,
    projectConfig: Partial<AutomationConfig>,
    projectDir: string,
  ): AutomationConfig {
    return {
      ...base,
      cli: {
        ...base.cli,
        ...(projectConfig.cli ?? {}),
        projectDir,
      },
      worker: { ...base.worker, ...(projectConfig.worker ?? {}) },
      evaluator: { ...base.evaluator, ...(projectConfig.evaluator ?? {}) },
      messenger: { ...base.messenger, ...(projectConfig.messenger ?? {}) },
      conductor: { ...base.conductor, ...(projectConfig.conductor ?? {}) },
      trigger: { ...base.trigger, ...(projectConfig.trigger ?? {}) },
      pipeline: { ...base.pipeline, ...(projectConfig.pipeline ?? {}) },
      persistence: { ...base.persistence, ...(projectConfig.persistence ?? {}) },
      promptFramework: { ...base.promptFramework, ...(projectConfig.promptFramework ?? {}) },
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.sleepResolve = resolve;
      setTimeout(() => {
        this.sleepResolve = null;
        resolve();
      }, ms);
    });
  }
}
