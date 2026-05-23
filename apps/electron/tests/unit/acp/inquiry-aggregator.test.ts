import { describe, it, expect } from 'vitest';
import { InquiryAggregator } from '@core/modules/acp/collaboration/inquiry-aggregator';
import type { SuspensionAwaiting } from '@core/modules/acp/collaboration/suspension.types';

function makeAwaiting(overrides: Partial<SuspensionAwaiting> = {}): SuspensionAwaiting {
  return {
    id: 'aw-1',
    suspensionId: 'susp-1',
    conversationId: 'conv-1',
    respondentRoleId: 'role-b',
    status: 'resolved',
    response: 'This is the reply',
    resolvedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('InquiryAggregator', () => {
  const aggregator = new InquiryAggregator();

  it('returns empty string when no resolved entries', () => {
    const result = aggregator.buildAggregatedReply([
      makeAwaiting({ status: 'pending', response: null }),
    ]);
    expect(result).toBe('');
  });

  it('formats single resolved reply', () => {
    const result = aggregator.buildAggregatedReply([
      makeAwaiting({ respondentRoleId: 'architect', response: 'Use microservices' }),
    ]);
    expect(result).toBe(
      'The role you previously asked (architect) has replied:\n\nUse microservices',
    );
  });

  it('formats multiple resolved replies with structured headings', () => {
    const result = aggregator.buildAggregatedReply([
      makeAwaiting({ id: 'aw-1', respondentRoleId: 'role-b', response: 'Answer from B' }),
      makeAwaiting({ id: 'aw-2', respondentRoleId: 'role-c', response: 'Answer from C' }),
    ]);
    expect(result).toContain('## Reply from role-b');
    expect(result).toContain('Answer from B');
    expect(result).toContain('## Reply from role-c');
    expect(result).toContain('Answer from C');
  });

  it('skips unresolved entries in a mixed list', () => {
    const result = aggregator.buildAggregatedReply([
      makeAwaiting({ id: 'aw-1', respondentRoleId: 'role-b', status: 'resolved', response: 'Got it' }),
      makeAwaiting({ id: 'aw-2', respondentRoleId: 'role-c', status: 'pending', response: null }),
    ]);
    // Only one resolved, so single-reply format
    expect(result).toContain('role-b');
    expect(result).toContain('Got it');
    expect(result).not.toContain('role-c');
  });

  it('handles entries with null response gracefully', () => {
    const result = aggregator.buildAggregatedReply([
      makeAwaiting({ status: 'resolved', response: null }),
    ]);
    expect(result).toBe('');
  });
});
