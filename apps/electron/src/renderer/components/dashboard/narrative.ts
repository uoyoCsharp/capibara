import type { TaskRecord, RunRecord, ConversationRecord, RoleRecord } from '@core/shared/types';
import type { LocaleMessages } from '@shared/locale/types';

export interface NarrativeInput {
  t: LocaleMessages;
  orgName: string;
  tasks: TaskRecord[];
  runs: RunRecord[];
  conversations: ConversationRecord[];
  roles: RoleRecord[];
}

export interface NarrativeSection {
  heading: string;
  body: string;
  tone: 'info' | 'positive' | 'warning' | 'neutral';
}

export interface Narrative {
  headline: string;
  sections: NarrativeSection[];
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

/**
 * Template-based narrative builder — no AI call, just composed phrases.
 * Produces a human-readable project-status story from snapshot counts.
 */
export function buildNarrative(input: NarrativeInput): Narrative {
  const { t, orgName, tasks, runs, conversations, roles } = input;
  const nt = t.narrative;

  const activeTasks = tasks.filter((x) => !['done', 'cancelled'].includes(x.status));
  const completedTasks = tasks.filter((x) => x.status === 'done');
  const approvalTasks = tasks.filter((x) => x.status === 'awaiting_review');
  const blockedTasks = tasks.filter((x) => x.status === 'blocked');
  const inProgressTasks = tasks.filter((x) => x.status === 'in_progress');

  const activeRuns = runs.filter((r) => r.status === 'running');
  const failedRuns = runs.filter((r) => r.status === 'failed').slice(0, 5);
  const totalTokens = runs.reduce((sum, r) => sum + (r.tokenCount ?? 0), 0);
  const totalCost = runs.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);

  const waitingInquiries = conversations.filter(
    (c) => c.type === 'inquiry' && c.state === 'waiting',
  );
  const humanWaitingInquiries = waitingInquiries.filter((c) => c.respondentType === 'human');

  const aiRoles = roles.filter((r) => !r.isSystemRole);

  // ─── Compose sections ─────────────────────────────────────────

  const sections: NarrativeSection[] = [];

  // Current state
  sections.push({
    heading: nt.sections.whereWeAre,
    body: activeTasks.length === 0
      ? interpolate(nt.whereWeAre.noActiveWork, { completed: completedTasks.length })
      : summarizeActivity(nt, {
          inProgress: inProgressTasks.length,
          blocked: blockedTasks.length,
          awaitingReview: approvalTasks.length,
          activeRuns: activeRuns.length,
        }),
    tone: activeTasks.length === 0 ? 'neutral' : 'info',
  });

  // Team
  sections.push({
    heading: nt.sections.team,
    body: aiRoles.length === 0
      ? nt.team.noRoles
      : interpolate(
          aiRoles.length > 1 ? nt.team.multipleRoles : nt.team.singleRole,
          { n: aiRoles.length },
        ),
    tone: aiRoles.length === 0 ? 'warning' : 'positive',
  });

  // Human attention needed
  if (humanWaitingInquiries.length > 0 || approvalTasks.length > 0) {
    const parts: string[] = [];
    if (humanWaitingInquiries.length > 0) {
      parts.push(interpolate(nt.attention.inquiriesWaiting, { n: humanWaitingInquiries.length }));
    }
    if (approvalTasks.length > 0) {
      parts.push(interpolate(nt.attention.tasksAwaitingApproval, { n: approvalTasks.length }));
    }
    sections.push({
      heading: nt.sections.attention,
      body: interpolate(nt.attention.body, { parts: parts.join(nt.attention.separator) }),
      tone: 'warning',
    });
  }

  // Usage & reliability
  if (totalTokens > 0 || failedRuns.length > 0) {
    const usage = interpolate(nt.usage.summary, {
      tokens: totalTokens.toLocaleString(),
      runs: runs.length,
      cost: totalCost.toFixed(2),
    });
    const reliability = failedRuns.length > 0
      ? interpolate(nt.usage.failedRuns, { n: failedRuns.length })
      : '';
    sections.push({
      heading: nt.sections.usage,
      body: usage + reliability,
      tone: failedRuns.length > 0 ? 'warning' : 'info',
    });
  }

  const headline = buildHeadline(nt, {
    orgName,
    activeTasks: activeTasks.length,
    completedTasks: completedTasks.length,
    needsAttention: humanWaitingInquiries.length + approvalTasks.length,
  });

  return { headline, sections };
}

function summarizeActivity(nt: LocaleMessages['narrative'], counts: {
  inProgress: number;
  blocked: number;
  awaitingReview: number;
  activeRuns: number;
}): string {
  const parts: string[] = [];
  if (counts.inProgress > 0) parts.push(interpolate(nt.whereWeAre.inProgress, { n: counts.inProgress }));
  if (counts.blocked > 0) parts.push(interpolate(nt.whereWeAre.blocked, { n: counts.blocked }));
  if (counts.awaitingReview > 0) parts.push(interpolate(nt.whereWeAre.awaitingReview, { n: counts.awaitingReview }));
  if (counts.activeRuns > 0) parts.push(interpolate(nt.whereWeAre.activeRuns, { n: counts.activeRuns }));
  return parts.length === 0 ? nt.whereWeAre.quietMoment : parts.join(', ') + '.';
}

function buildHeadline(nt: LocaleMessages['narrative'], input: {
  orgName: string;
  activeTasks: number;
  completedTasks: number;
  needsAttention: number;
}): string {
  if (input.needsAttention > 0) {
    return interpolate(nt.headline.needsAttention, { orgName: input.orgName, n: input.needsAttention });
  }
  if (input.activeTasks > 0) {
    return interpolate(nt.headline.activeProgress, {
      orgName: input.orgName,
      active: input.activeTasks,
      completed: input.completedTasks,
    });
  }
  if (input.completedTasks > 0) {
    return interpolate(nt.headline.allClear, {
      orgName: input.orgName,
      completed: input.completedTasks,
    });
  }
  return interpolate(nt.headline.readyToStart, { orgName: input.orgName });
}
