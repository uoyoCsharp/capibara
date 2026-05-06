import { describe, it, expect } from 'vitest';
import { partitionConversations } from '@renderer/components/inbox/InboxPage';
import type { ConversationRecord } from '@core/shared/types';

function conv(id: string, overrides?: Partial<ConversationRecord>): ConversationRecord {
  return {
    id, orgId: 'org', type: 'inquiry', state: 'active', initiatorRoleId: 'r1',
    respondentRoleId: 'r2', respondentType: 'ai', taskId: null, parentConversationId: null,
    depth: 0, priority: 0, timeoutAt: null, externalSessionId: null, metadata: {},
    createdAt: '', updatedAt: '', ...overrides,
  };
}

describe('partitionConversations', () => {
  it('empty input yields empty buckets', () => {
    const { blocked, monitoring, resolved } = partitionConversations([]);
    expect(blocked).toEqual([]);
    expect(monitoring).toEqual([]);
    expect(resolved).toEqual([]);
  });

  it('inquiry with human respondent → blocked', () => {
    const { blocked, monitoring } = partitionConversations([
      conv('1', { state: 'waiting', respondentType: 'human' }),
    ]);
    expect(blocked).toHaveLength(1);
    expect(monitoring).toHaveLength(0);
  });

  it('inquiry with AI respondent → monitoring', () => {
    const { blocked, monitoring } = partitionConversations([
      conv('1', { state: 'waiting', respondentType: 'ai' }),
    ]);
    expect(blocked).toHaveLength(0);
    expect(monitoring).toHaveLength(1);
  });

  it('planning conversations are excluded from the inbox entirely (they have their own PlanningPage)', () => {
    const { blocked, monitoring, resolved } = partitionConversations([
      conv('1', { type: 'planning', respondentType: 'ai', state: 'active' }),
      conv('2', { type: 'planning', respondentType: 'ai', state: 'waiting' }),
      conv('3', { type: 'planning', respondentType: 'ai', state: 'resolved' }),
    ]);
    expect(blocked).toHaveLength(0);
    expect(monitoring).toHaveLength(0);
    expect(resolved).toHaveLength(0);
  });

  it('adhoc conversations always block for human', () => {
    const { blocked } = partitionConversations([
      conv('1', { type: 'adhoc', respondentType: 'ai', state: 'active' }),
    ]);
    expect(blocked).toHaveLength(1);
  });

  it('resolved/completed/cancelled/timed_out go to resolved bucket', () => {
    const { resolved } = partitionConversations([
      conv('1', { state: 'resolved' }),
      conv('2', { state: 'completed' }),
      conv('3', { state: 'cancelled' }),
      conv('4', { state: 'timed_out' }),
    ]);
    expect(resolved).toHaveLength(4);
  });

  it('escalated inquiry with AI respondent stays in monitoring', () => {
    const { blocked, monitoring } = partitionConversations([
      conv('1', { state: 'escalated', respondentType: 'ai' }),
    ]);
    expect(blocked).toHaveLength(0);
    expect(monitoring).toHaveLength(1);
  });

  it('escalated inquiry with human respondent goes to blocked', () => {
    const { blocked } = partitionConversations([
      conv('1', { state: 'escalated', respondentType: 'human' }),
    ]);
    expect(blocked).toHaveLength(1);
  });

  it('mixed workload partitions correctly (planning conversations are filtered out)', () => {
    const input: ConversationRecord[] = [
      conv('1', { state: 'waiting', respondentType: 'human' }),         // inquiry human-blocked → blocked
      conv('2', { state: 'waiting', respondentType: 'ai' }),             // inquiry AI respondent → monitoring
      conv('3', { type: 'planning', state: 'active' }),                  // planning → excluded entirely
      conv('4', { state: 'resolved' }),                                   // resolved → resolved
    ];
    const { blocked, monitoring, resolved } = partitionConversations(input);
    expect(blocked).toHaveLength(1);
    expect(monitoring).toHaveLength(1);
    expect(resolved).toHaveLength(1);
  });

  it('IP-01: plan_review with AI respondent → blocked', () => {
    const { blocked, monitoring } = partitionConversations([
      conv('1', { type: 'plan_review', respondentType: 'ai', state: 'active' }),
    ]);
    expect(blocked).toHaveLength(1);
    expect(monitoring).toHaveLength(0);
  });

  it('IP-02: plan_review with human respondent → blocked', () => {
    const { blocked } = partitionConversations([
      conv('1', { type: 'plan_review', respondentType: 'human', state: 'waiting' }),
    ]);
    expect(blocked).toHaveLength(1);
  });

  it('IP-03: completed plan_review → resolved', () => {
    const { resolved } = partitionConversations([
      conv('1', { type: 'plan_review', state: 'completed' }),
    ]);
    expect(resolved).toHaveLength(1);
  });

  it('IP-04: cancelled plan_review → resolved', () => {
    const { resolved } = partitionConversations([
      conv('1', { type: 'plan_review', state: 'cancelled' }),
    ]);
    expect(resolved).toHaveLength(1);
  });

  it('IP-05: mixed workload with plan_review partitions correctly', () => {
    const input: ConversationRecord[] = [
      conv('1', { type: 'plan_review', state: 'active', respondentType: 'human' }),
      conv('2', { state: 'waiting', respondentType: 'ai' }),
      conv('3', { type: 'plan_review', state: 'completed' }),
      conv('4', { type: 'adhoc', state: 'active' }),
    ];
    const { blocked, monitoring, resolved } = partitionConversations(input);
    expect(blocked).toHaveLength(2); // plan_review active + adhoc
    expect(monitoring).toHaveLength(1); // inquiry AI
    expect(resolved).toHaveLength(1); // completed plan_review
  });
});
