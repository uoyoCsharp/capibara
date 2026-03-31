import { injectable, inject } from 'tsyringe';
import type { INarrativeRepository } from '@main/core/interfaces/i-narrative.repository.js';
import type { IOrganizationRepository } from '@main/core/interfaces/i-organization.repository.js';
import type { ITaskRepository } from '@main/core/interfaces/i-task.repository.js';
import type { IRunRepository } from '@main/core/interfaces/i-run.repository.js';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { Narrative } from '@main/core/types/domain.types.js';
import {
  NARRATIVE_REPO_TOKEN,
  ORGANIZATION_REPO_TOKEN,
  TASK_REPO_TOKEN,
  RUN_REPO_TOKEN,
  EVENT_BUS_TOKEN,
  LOGGER_TOKEN,
} from '@main/core/tokens.js';

/**
 * Generates human-readable narrative status reports.
 * See Architecture §1.2 Pillar 3 — Narrative Engine.
 *
 * Flow: DB query → template data → (future: LLM polish) → store + emit.
 */
@injectable()
export class NarrativeEngine {
  constructor(
    @inject(NARRATIVE_REPO_TOKEN) private readonly narrativeRepo: INarrativeRepository,
    @inject(ORGANIZATION_REPO_TOKEN) private readonly orgRepo: IOrganizationRepository,
    @inject(TASK_REPO_TOKEN) private readonly taskRepo: ITaskRepository,
    @inject(RUN_REPO_TOKEN) private readonly runRepo: IRunRepository,
    @inject(EVENT_BUS_TOKEN) private readonly eventBus: IEventBus,
    @inject(LOGGER_TOKEN) private readonly logger: ILogger,
  ) {}

  async generate(orgId: string): Promise<Narrative> {
    const org = await this.orgRepo.findById(orgId);
    const tasks = await this.taskRepo.findByOrgId(orgId);
    const runs = await this.runRepo.findByOrgId(orgId);

    const statusCounts: Record<string, number> = {};
    for (const t of tasks) {
      statusCounts[t.status] = (statusCounts[t.status] ?? 0) + 1;
    }

    const activeRuns = runs.filter((r) => r.status === 'running').length;
    const completedRuns = runs.filter((r) => r.status === 'succeeded').length;

    const templateData = {
      orgName: org?.name ?? 'Unknown',
      totalTasks: tasks.length,
      statusCounts,
      activeRuns,
      completedRuns,
    };

    // MVP: template-based rendering (no LLM polish yet)
    const renderedText = this.renderTemplate(templateData);

    const narrative = await this.narrativeRepo.create({
      orgId,
      templateData,
      renderedText,
    });

    this.eventBus.emit({
      type: 'narrative:updated',
      timestamp: new Date().toISOString(),
      payload: { orgId, narrativeId: narrative.id },
    });

    this.logger.info('Narrative generated', { orgId, narrativeId: narrative.id });
    return narrative;
  }

  private renderTemplate(data: Record<string, unknown>): string {
    const orgName = data.orgName as string;
    const totalTasks = data.totalTasks as number;
    const statusCounts = data.statusCounts as Record<string, number>;
    const activeRuns = data.activeRuns as number;
    const completedRuns = data.completedRuns as number;

    const statusSummary = Object.entries(statusCounts)
      .map(([status, count]) => `${status}: ${count}`)
      .join(', ');

    return [
      `# Project Status: ${orgName}`,
      '',
      `Total tasks: ${totalTasks} (${statusSummary})`,
      `Active runs: ${activeRuns} | Completed runs: ${completedRuns}`,
    ].join('\n');
  }
}
