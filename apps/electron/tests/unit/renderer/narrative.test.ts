import { describe, it, expect } from 'vitest';
import { buildNarrative } from '@renderer/components/dashboard/narrative';
import { enUS } from '@shared/locale/en-US';
import type { TaskRecord, RunRecord, ConversationRecord, RoleRecord } from '@core/shared/types';

const t = enUS;

function task(id: string, overrides?: Partial<TaskRecord>): TaskRecord {
  return {
    id, orgId: 'org', parentId: null, type: 'task', title: `T${id}`, description: '',
    status: 'pending', assigneeRoleId: null, depth: 0, artifactPaths: null,
    createdAt: '', updatedAt: '', ...overrides,
  };
}
function run(id: string, overrides?: Partial<RunRecord>): RunRecord {
  return {
    id, orgId: 'org', taskId: 't', conversationId: null, roleId: 'r', status: 'succeeded',
    wakeReason: 'task_assigned', startedAt: null, finishedAt: null, costUsd: 0, tokenCount: 0,
    summary: null, errorMessage: null, createdAt: '', ...overrides,
  };
}
function conv(id: string, overrides?: Partial<ConversationRecord>): ConversationRecord {
  return {
    id, orgId: 'org', type: 'inquiry', state: 'active', initiatorRoleId: 'r1',
    respondentRoleId: null, respondentType: null, taskId: null, parentConversationId: null,
    depth: 0, priority: 0, timeoutAt: null, externalSessionId: null, metadata: {},
    createdAt: '', updatedAt: '', ...overrides,
  };
}
function role(id: string, overrides?: Partial<RoleRecord>): RoleRecord {
  return {
    id, orgId: 'org', name: id, parentId: null, persona: '', knowledgeBaseRefs: [],
    skillIds: [], canApprove: false, canDelegate: false, requiresHumanApproval: false,
    consecutiveWakeCount: 0, isSystemRole: false, status: 'active',
    createdAt: '', updatedAt: '', ...overrides,
  };
}

describe('buildNarrative', () => {
  it('produces a getting-started headline when project is empty', () => {
    const n = buildNarrative({ t, orgName: 'Acme', tasks: [], runs: [], conversations: [], roles: [] });
    expect(n.headline).toContain('ready to start');
  });

  it('reports active work when tasks are in progress', () => {
    const n = buildNarrative({
      t,
      orgName: 'Acme',
      tasks: [task('1', { status: 'in_progress' }), task('2', { status: 'in_progress' })],
      runs: [],
      conversations: [],
      roles: [role('r1')],
    });
    expect(n.headline).toMatch(/task\(s\) progressing/);
    const whereWeAre = n.sections.find((s) => s.heading === t.narrative.sections.whereWeAre);
    expect(whereWeAre?.body).toContain('in progress');
  });

  it('surfaces attention when inquiry waits for a human', () => {
    const n = buildNarrative({
      t,
      orgName: 'Acme',
      tasks: [],
      runs: [],
      conversations: [conv('c1', { state: 'waiting', respondentType: 'human' })],
      roles: [role('r1')],
    });
    expect(n.headline).toContain('attention');
    const attention = n.sections.find((s) => s.heading === t.narrative.sections.attention);
    expect(attention).toBeDefined();
    expect(attention?.tone).toBe('warning');
  });

  it('combines awaiting-review tasks and human-waiting inquiries', () => {
    const n = buildNarrative({
      t,
      orgName: 'Acme',
      tasks: [task('1', { status: 'awaiting_review' })],
      runs: [],
      conversations: [conv('c1', { state: 'waiting', respondentType: 'human' })],
      roles: [role('r1')],
    });
    const attention = n.sections.find((s) => s.heading === t.narrative.sections.attention);
    expect(attention?.body).toContain('inquiry');
    expect(attention?.body).toContain('approval');
  });

  it('warns when no AI roles exist', () => {
    const n = buildNarrative({ t, orgName: 'Acme', tasks: [], runs: [], conversations: [], roles: [] });
    const team = n.sections.find((s) => s.heading === t.narrative.sections.team);
    expect(team?.tone).toBe('warning');
    expect(team?.body).toContain('No AI roles');
  });

  it('ignores system roles in the AI role count', () => {
    const n = buildNarrative({
      t,
      orgName: 'Acme', tasks: [], runs: [], conversations: [],
      roles: [role('sys', { isSystemRole: true })],
    });
    const team = n.sections.find((s) => s.heading === t.narrative.sections.team);
    expect(team?.tone).toBe('warning');
  });

  it('reports failed runs in the usage section', () => {
    const n = buildNarrative({
      t,
      orgName: 'Acme',
      tasks: [],
      runs: [run('1', { status: 'failed' }), run('2', { tokenCount: 1000, costUsd: 0.05 })],
      conversations: [],
      roles: [role('r1')],
    });
    const usage = n.sections.find((s) => s.heading === t.narrative.sections.usage);
    expect(usage).toBeDefined();
    expect(usage?.tone).toBe('warning');
    expect(usage?.body).toContain('failed');
  });

  it('does not produce a usage section when no runs have been made', () => {
    const n = buildNarrative({
      t,
      orgName: 'Acme', tasks: [task('1')], runs: [], conversations: [], roles: [role('r1')],
    });
    const usage = n.sections.find((s) => s.heading === t.narrative.sections.usage);
    expect(usage).toBeUndefined();
  });

  it('reports completed tasks in headline when nothing active', () => {
    const n = buildNarrative({
      t,
      orgName: 'Acme',
      tasks: [task('1', { status: 'done' }), task('2', { status: 'done' })],
      runs: [],
      conversations: [],
      roles: [role('r1')],
    });
    expect(n.headline).toContain('all clear');
    expect(n.headline).toContain('2');
  });
});
