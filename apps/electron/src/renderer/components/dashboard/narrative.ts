import type { TaskRecord, RunRecord, ConversationRecord, RoleRecord } from '@core/shared/types';

export interface NarrativeInput {
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

/**
 * Template-based narrative builder — no AI call, just composed phrases.
 * Produces a human-readable project-status story from snapshot counts.
 */
export function buildNarrative(input: NarrativeInput): Narrative {
  const { orgName, tasks, runs, conversations, roles } = input;

  const activeTasks = tasks.filter((t) => !['done', 'cancelled'].includes(t.status));
  const completedTasks = tasks.filter((t) => t.status === 'done');
  const approvalTasks = tasks.filter((t) => t.status === 'awaiting_review');
  const blockedTasks = tasks.filter((t) => t.status === 'blocked');
  const inProgressTasks = tasks.filter((t) => t.status === 'in_progress');

  const activeRuns = runs.filter((r) => ['queued', 'running'].includes(r.status));
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
    heading: 'Where we are',
    body: activeTasks.length === 0
      ? `No active work. ${completedTasks.length} task(s) completed so far.`
      : summarizeActivity({
          inProgress: inProgressTasks.length,
          blocked: blockedTasks.length,
          awaitingReview: approvalTasks.length,
          activeRuns: activeRuns.length,
        }),
    tone: activeTasks.length === 0 ? 'neutral' : 'info',
  });

  // Team
  sections.push({
    heading: 'Team',
    body: aiRoles.length === 0
      ? 'No AI roles configured yet. Add roles in the Team page to start delegating work.'
      : `${aiRoles.length} AI role(s) available. ` + (aiRoles.length > 1 ? 'They can collaborate via inquiries and escalations.' : 'Consider adding more roles for richer collaboration.'),
    tone: aiRoles.length === 0 ? 'warning' : 'positive',
  });

  // Human attention needed
  if (humanWaitingInquiries.length > 0 || approvalTasks.length > 0) {
    const parts: string[] = [];
    if (humanWaitingInquiries.length > 0) {
      parts.push(`${humanWaitingInquiries.length} inquiry(ies) waiting for a human reply`);
    }
    if (approvalTasks.length > 0) {
      parts.push(`${approvalTasks.length} task(s) awaiting your approval`);
    }
    sections.push({
      heading: 'Needs your attention',
      body: `You have ${parts.join(' and ')}. Check the Inbox and Tasks pages.`,
      tone: 'warning',
    });
  }

  // Budget & reliability
  if (totalTokens > 0 || failedRuns.length > 0) {
    const budgetNote = `${totalTokens.toLocaleString()} token(s) used across ${runs.length} run(s), totalling $${totalCost.toFixed(2)}.`;
    const reliabilityNote = failedRuns.length > 0
      ? ` ${failedRuns.length} recent run(s) failed — review the Runs panel for details.`
      : '';
    sections.push({
      heading: 'Budget & reliability',
      body: budgetNote + reliabilityNote,
      tone: failedRuns.length > 0 ? 'warning' : 'info',
    });
  }

  const headline = buildHeadline({
    orgName,
    activeTasks: activeTasks.length,
    completedTasks: completedTasks.length,
    needsAttention: humanWaitingInquiries.length + approvalTasks.length,
  });

  return { headline, sections };
}

function summarizeActivity(counts: {
  inProgress: number;
  blocked: number;
  awaitingReview: number;
  activeRuns: number;
}): string {
  const parts: string[] = [];
  if (counts.inProgress > 0) parts.push(`${counts.inProgress} task(s) in progress`);
  if (counts.blocked > 0) parts.push(`${counts.blocked} blocked`);
  if (counts.awaitingReview > 0) parts.push(`${counts.awaitingReview} awaiting review`);
  if (counts.activeRuns > 0) parts.push(`${counts.activeRuns} active AI run(s)`);
  return parts.length === 0 ? 'Quiet moment — no immediate activity.' : parts.join(', ') + '.';
}

function buildHeadline(input: {
  orgName: string;
  activeTasks: number;
  completedTasks: number;
  needsAttention: number;
}): string {
  if (input.needsAttention > 0) {
    return `${input.orgName} — ${input.needsAttention} item(s) need your attention.`;
  }
  if (input.activeTasks > 0) {
    return `${input.orgName} — ${input.activeTasks} task(s) progressing, ${input.completedTasks} completed.`;
  }
  if (input.completedTasks > 0) {
    return `${input.orgName} — all clear. ${input.completedTasks} task(s) completed.`;
  }
  return `${input.orgName} — ready to start. Create a task to kick things off.`;
}
