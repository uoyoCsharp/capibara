import { describe, it, expect } from 'vitest';
import {
  InquiryMetadataSchema,
  PlanningMetadataSchema,
  AdhocMetadataSchema,
  parseConversationMetadata,
  emptyMetadataFor,
} from '@core/modules/conversation/types/conversation-metadata.schema';
import { SqliteRunRepository } from '@core/modules/execution/persistence/sqlite-run.repository';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';

describe('Conversation metadata discriminated union', () => {
  it('InquiryMetadata fills defaults for empty input', () => {
    const meta = parseConversationMetadata('inquiry', {});
    expect(meta).toEqual({
      routingAttempts: 0,
      escalationPath: [],
    });
  });

  it('PlanningMetadata fills defaults for empty input', () => {
    expect(parseConversationMetadata('planning', {})).toEqual({
      pendingPlanId: null,
      confirmedAt: null,
    });
  });

  it('AdhocMetadata fills defaults for empty input', () => {
    expect(parseConversationMetadata('adhoc', {})).toEqual({ topic: null });
  });

  it('InquiryMetadataSchema rejects wrong-shape payloads (planning fields on inquiry)', () => {
    // Planning shape has pendingPlanId + confirmedAt. Inquiry schema has strict
    // types on its fields — passing an object with a wrong-typed required field
    // (e.g. escalationPath is a string instead of array) should fail.
    expect(() =>
      InquiryMetadataSchema.parse({ escalationPath: 'not-an-array' }),
    ).toThrow();
  });

  it('PlanningMetadataSchema rejects wrong-typed fields', () => {
    expect(() =>
      PlanningMetadataSchema.parse({ pendingPlanId: 42 }),
    ).toThrow();
  });

  it('AdhocMetadataSchema rejects wrong-typed fields', () => {
    expect(() => AdhocMetadataSchema.parse({ topic: 42 })).toThrow();
  });

  it('emptyMetadataFor returns a fresh default per type', () => {
    expect(emptyMetadataFor('inquiry')).toEqual({ routingAttempts: 0, escalationPath: [] });
    expect(emptyMetadataFor('planning')).toEqual({ pendingPlanId: null, confirmedAt: null });
    expect(emptyMetadataFor('adhoc')).toEqual({ topic: null });
  });

  it('parseConversationMetadata tolerates extra unknown keys (Zod strips by default)', () => {
    const meta = parseConversationMetadata('inquiry', {
      routingAttempts: 2,
      escalationPath: ['r-1'],
      unexpectedField: 'ignored',
    });
    expect(meta).toEqual({ routingAttempts: 2, escalationPath: ['r-1'] });
  });
});

describe('Run entity: toRun guard rejects invalid rows', () => {
  // Build a fake ISqliteConnection that yields a controlled row.
  function makeFakeConnection(row: Record<string, unknown> | null): ISqliteConnection {
    const stub = {
      prepare: () => ({
        get: () => row,
        all: () => (row ? [row] : []),
        run: () => ({ changes: 1, lastInsertRowid: 1 }),
      }),
      exec: () => undefined,
    } as unknown as ReturnType<ISqliteConnection['getDb']>;
    return {
      getDb: () => stub,
      close: () => undefined,
    };
  }

  it('throws when a row has both task_id AND conversation_id as NULL', () => {
    const row = {
      id: 'r-corrupt',
      org_id: 'org-1',
      task_id: null,
      conversation_id: null,
      role_id: 'role-1',
      status: 'queued',
      wake_reason: 'task_assigned',
      started_at: null,
      finished_at: null,
      cost_usd: 0,
      token_count: 0,
      summary: null,
      error_message: null,
      created_at: '2026-01-01T00:00:00.000Z',
    };
    const repo = new SqliteRunRepository(makeFakeConnection(row));
    expect(() => repo.findById('r-corrupt')).toThrow(/neither taskId nor conversationId/);
  });

  it('returns a well-formed Run (taskId-only) for a valid row', () => {
    const row = {
      id: 'r-1',
      org_id: 'org-1',
      task_id: 'task-1',
      conversation_id: null,
      role_id: 'role-1',
      status: 'succeeded',
      wake_reason: 'task_assigned',
      started_at: null,
      finished_at: null,
      cost_usd: 0,
      token_count: 0,
      summary: null,
      error_message: null,
      created_at: '2026-01-01T00:00:00.000Z',
    };
    const repo = new SqliteRunRepository(makeFakeConnection(row));
    const run = repo.findById('r-1');
    expect(run).not.toBeNull();
    expect(run?.taskId).toBe('task-1');
    expect(run?.conversationId).toBeNull();
  });

  it('returns Run with both IDs when row is an inquiry-response', () => {
    const row = {
      id: 'r-2',
      org_id: 'org-1',
      task_id: 'task-1',
      conversation_id: 'conv-1',
      role_id: 'role-1',
      status: 'succeeded',
      wake_reason: 'conversation_reply',
      started_at: null,
      finished_at: null,
      cost_usd: 0,
      token_count: 0,
      summary: null,
      error_message: null,
      created_at: '2026-01-01T00:00:00.000Z',
    };
    const repo = new SqliteRunRepository(makeFakeConnection(row));
    const run = repo.findById('r-2');
    expect(run?.taskId).toBe('task-1');
    expect(run?.conversationId).toBe('conv-1');
  });
});
