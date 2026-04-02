import { injectable, inject } from 'tsyringe';
import type { INarrativeRepository } from '@main/core/interfaces/i-narrative.repository.js';
import type { IOrganizationRepository } from '@main/core/interfaces/i-organization.repository.js';
import type { ITaskRepository } from '@main/core/interfaces/i-task.repository.js';
import type { IRunRepository } from '@main/core/interfaces/i-run.repository.js';
import type { ICostEntryRepository } from '@main/core/interfaces/i-cost-entry.repository.js';
import type { IDiscussionRepository } from '@main/core/interfaces/i-discussion.repository.js';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { Narrative } from '@main/core/types/domain.types.js';
import {
  NARRATIVE_REPO_TOKEN,
  ORGANIZATION_REPO_TOKEN,
  TASK_REPO_TOKEN,
  RUN_REPO_TOKEN,
  COST_ENTRY_REPO_TOKEN,
  DISCUSSION_REPO_TOKEN,
  EVENT_BUS_TOKEN,
  LOGGER_TOKEN,
} from '@main/core/tokens.js';

export interface NarrativeTemplateData {
  orgName: string;
  orgStatus: string;
  budgetLimit: number;
  budgetUsed: number;
  tokensUsed: number;
  budgetPercent: number;
  totalTasks: number;
  statusCounts: Record<string, number>;
  activeRuns: number;
  completedRuns: number;
  failedRuns: number;
  blockedTasks: Array<{ id: string; title: string }>;
  recentCompletions: Array<{ id: string; title: string }>;
  activeWork: Array<{ id: string; title: string; status: string }>;
  discussionCount: number;
}

export interface ApprovalSummaryData {
  taskTitle: string;
  taskDescription: string;
  childSummaries: Array<{ title: string; status: string }>;
  voteStats: { APPROVE: number; REVISE: number; CONCERN: number; DELEGATE: number };
  concerns: string[];
  revisionHistory: string[];
}

/**
 * Three-Layer Narrative Engine.
 * Layer 1: Deterministic DB queries → structured data
 * Layer 2: Template rendering → Markdown
 * Layer 3: (Future) LLM polish → natural language prose
 *
 * See Architecture §1.2 Pillar 3 — Narrative Engine.
 */
@injectable()
export class NarrativeEngine {
  constructor(
    @inject(NARRATIVE_REPO_TOKEN) private readonly narrativeRepo: INarrativeRepository,
    @inject(ORGANIZATION_REPO_TOKEN) private readonly orgRepo: IOrganizationRepository,
    @inject(TASK_REPO_TOKEN) private readonly taskRepo: ITaskRepository,
    @inject(RUN_REPO_TOKEN) private readonly runRepo: IRunRepository,
    @inject(COST_ENTRY_REPO_TOKEN) private readonly costRepo: ICostEntryRepository,
    @inject(DISCUSSION_REPO_TOKEN) private readonly discussionRepo: IDiscussionRepository,
    @inject(EVENT_BUS_TOKEN) private readonly eventBus: IEventBus,
    @inject(LOGGER_TOKEN) private readonly logger: ILogger,
  ) {}

  // ─── Layer 1: Data Query ──────────────────────────────────────

  async queryTemplateData(orgId: string): Promise<NarrativeTemplateData> {
    const org = await this.orgRepo.findById(orgId);
    const tasks = await this.taskRepo.findByOrgId(orgId);
    const runs = await this.runRepo.findByOrgId(orgId);
    const budgetUsed = await this.costRepo.getTotalCostByOrgId(orgId);
    const tokensUsed = await this.costRepo.getTotalTokensByOrgId(orgId);
    const discussions = await this.discussionRepo.findGroupsByOrgId(orgId);

    const statusCounts: Record<string, number> = {};
    for (const t of tasks) {
      statusCounts[t.status] = (statusCounts[t.status] ?? 0) + 1;
    }

    const blockedTasks = tasks
      .filter((t) => t.status === 'blocked')
      .map((t) => ({ id: t.id, title: t.title }));

    const recentCompletions = tasks
      .filter((t) => t.status === 'done' || t.status === 'approved')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 5)
      .map((t) => ({ id: t.id, title: t.title }));

    const activeWork = tasks
      .filter((t) => t.status === 'in_progress' || t.status === 'awaiting_review' || t.status === 'revision')
      .map((t) => ({ id: t.id, title: t.title, status: t.status }));

    const budgetLimit = org?.budgetLimit ?? 50;

    return {
      orgName: org?.name ?? 'Unknown',
      orgStatus: org?.status ?? 'unknown',
      budgetLimit,
      budgetUsed,
      tokensUsed,
      budgetPercent: budgetLimit > 0 ? Math.round((budgetUsed / budgetLimit) * 100) : 0,
      totalTasks: tasks.length,
      statusCounts,
      activeRuns: runs.filter((r) => r.status === 'running').length,
      completedRuns: runs.filter((r) => r.status === 'succeeded').length,
      failedRuns: runs.filter((r) => r.status === 'failed').length,
      blockedTasks,
      recentCompletions,
      activeWork,
      discussionCount: discussions.length,
    };
  }

  // ─── Layer 2: Template Rendering ──────────────────────────────

  renderDashboardNarrative(data: NarrativeTemplateData): string {
    const lines: string[] = [];

    // Health summary
    const healthEmoji = data.budgetPercent >= 95 ? '🔴' : data.budgetPercent >= 80 ? '🟡' : '🟢';
    lines.push(`## ${data.orgName} — Project Status`);
    lines.push('');
    lines.push(`**Overall Health:** ${healthEmoji} ${data.orgStatus === 'active' ? 'Active' : data.orgStatus}`);
    lines.push(`**Tokens Used:** ${(data.tokensUsed / 1_000_000).toFixed(4)}M (${data.budgetPercent}%)`);
    lines.push('');

    // Task overview
    const done = (data.statusCounts['done'] ?? 0) + (data.statusCounts['approved'] ?? 0);
    const inProgress = data.statusCounts['in_progress'] ?? 0;
    const pending = data.statusCounts['pending'] ?? 0;
    const blocked = data.statusCounts['blocked'] ?? 0;
    lines.push(`### Tasks: ${data.totalTasks} total`);
    lines.push(`- ✅ Completed: ${done}`);
    lines.push(`- 🔄 In Progress: ${inProgress}`);
    lines.push(`- ⏳ Pending: ${pending}`);
    if (blocked > 0) lines.push(`- 🚫 Blocked: ${blocked}`);
    lines.push('');

    // Execution
    lines.push(`### Execution`);
    lines.push(`- Active runs: ${data.activeRuns}`);
    lines.push(`- Completed runs: ${data.completedRuns}`);
    if (data.failedRuns > 0) lines.push(`- Failed runs: ${data.failedRuns}`);
    lines.push(`- Discussion groups: ${data.discussionCount}`);
    lines.push('');

    // Active work
    if (data.activeWork.length > 0) {
      lines.push('### Active Work');
      for (const w of data.activeWork.slice(0, 8)) {
        const statusLabel = w.status.replace('_', ' ');
        lines.push(`- **${w.title}** (${statusLabel})`);
      }
      if (data.activeWork.length > 8) {
        lines.push(`- ... and ${data.activeWork.length - 8} more`);
      }
      lines.push('');
    }

    // Blocked items
    if (data.blockedTasks.length > 0) {
      lines.push('### ⚠️ Blocked Items');
      for (const b of data.blockedTasks) {
        lines.push(`- **${b.title}**`);
      }
      lines.push('');
    }

    // Recent completions
    if (data.recentCompletions.length > 0) {
      lines.push('### Recent Completions');
      for (const c of data.recentCompletions) {
        lines.push(`- ✅ ${c.title}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  // ─── Story 9.3: Approval Summary Template ─────────────────────

  renderApprovalSummary(data: ApprovalSummaryData): string {
    const lines: string[] = [];

    lines.push('### Approval Summary');
    lines.push('');
    lines.push(`**What was requested:** ${data.taskDescription || data.taskTitle}`);
    lines.push('');

    if (data.childSummaries.length > 0) {
      lines.push('**What was done:**');
      for (const child of data.childSummaries) {
        const icon = child.status === 'done' || child.status === 'approved' ? '✅' : '🔄';
        lines.push(`- ${icon} ${child.title} (${child.status})`);
      }
      lines.push('');
    }

    lines.push('**Voting:**');
    lines.push(`- Approve: ${data.voteStats.APPROVE} | Revise: ${data.voteStats.REVISE} | Concern: ${data.voteStats.CONCERN} | Delegate: ${data.voteStats.DELEGATE}`);
    lines.push('');

    if (data.concerns.length > 0) {
      lines.push('**Remaining Concerns:**');
      for (const c of data.concerns) {
        lines.push(`- ⚠️ ${c}`);
      }
      lines.push('');
    }

    if (data.revisionHistory.length > 0) {
      lines.push(`**Revision rounds:** ${data.revisionHistory.length}`);
      lines.push('');
    }

    // Recommended action
    if (data.concerns.length === 0 && data.voteStats.REVISE === 0) {
      lines.push('**Recommended action:** APPROVE — all AI roles agree, no open concerns.');
    } else if (data.concerns.length > 0) {
      lines.push('**Recommended action:** Review concerns before deciding.');
    } else {
      lines.push('**Recommended action:** Review revision feedback before deciding.');
    }

    return lines.join('\n');
  }

  // ─── Story 9.3: Generate Approval Summary for a Task ──────────

  async generateApprovalSummary(taskId: string): Promise<string> {
    const task = await this.taskRepo.findById(taskId);
    if (!task) return '';

    const children = await this.taskRepo.findByParentId(taskId);
    const childSummaries = children.map((c) => ({ title: c.title, status: c.status }));

    const group = await this.discussionRepo.findGroupByTaskNodeId(taskId);
    let voteStats = { APPROVE: 0, REVISE: 0, CONCERN: 0, DELEGATE: 0 };
    let concerns: string[] = [];
    let revisionHistory: string[] = [];

    if (group) {
      voteStats = await this.discussionRepo.getVoteStats(group.id);
      const messages = await this.discussionRepo.findMessagesByGroupId(group.id);
      concerns = messages.filter((m) => m.voteTag === 'CONCERN').map((m) => m.content.slice(0, 200));
      revisionHistory = messages.filter((m) => m.voteTag === 'REVISE').map((m) => m.content.slice(0, 200));
    }

    return this.renderApprovalSummary({
      taskTitle: task.title,
      taskDescription: task.description,
      childSummaries,
      voteStats,
      concerns,
      revisionHistory,
    });
  }

  // ─── Full generate + persist ──────────────────────────────────

  async generate(orgId: string): Promise<Narrative> {
    const templateData = await this.queryTemplateData(orgId);
    const renderedText = this.renderDashboardNarrative(templateData);

    const narrative = await this.narrativeRepo.create({
      orgId,
      templateData: templateData as unknown as Record<string, unknown>,
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

  async getLatest(orgId: string): Promise<Narrative | null> {
    return this.narrativeRepo.findLatestByOrgId(orgId);
  }
}
