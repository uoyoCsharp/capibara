import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionSuspensionManager } from '@core/modules/acp/collaboration/session-suspension.manager';
import type { ISuspensionRepository } from '@core/modules/acp/interfaces/i-suspension.repository';
import type { SessionSuspension, SuspensionAwaiting, SuspendParams } from '@core/modules/acp/collaboration/suspension.types';
import type { CollaborationConfig } from '@core/modules/acp/types/acp.types';
import { MockLogger } from '../../helpers/mock-logger';

// ── Factories ────────────────────────────────────────────

let idCounter = 0;

function makeSuspension(overrides: Partial<SessionSuspension> = {}): SessionSuspension {
  return {
    id: `susp-${++idCounter}`,
    sessionId: 'sess-1',
    acpSessionId: 'acp-sess-1',
    runId: 'run-1',
    roleId: 'role-a',
    orgId: 'org-1',
    taskId: 'task-1',
    aggregationMode: 'all',
    parentSuspensionId: null,
    chainDepth: 0,
    status: 'suspended',
    suspendedAt: '2026-01-01T00:00:00.000Z',
    resumedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeAwaiting(overrides: Partial<SuspensionAwaiting> = {}): SuspensionAwaiting {
  return {
    id: `aw-${++idCounter}`,
    suspensionId: 'susp-1',
    conversationId: 'conv-1',
    respondentRoleId: 'role-b',
    status: 'pending',
    response: null,
    resolvedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createMockRepo(): ISuspensionRepository {
  return {
    createSuspension: vi.fn().mockImplementation((input) => makeSuspension({
      sessionId: input.sessionId,
      acpSessionId: input.acpSessionId,
      runId: input.runId,
      roleId: input.roleId,
      orgId: input.orgId,
      taskId: input.taskId,
      aggregationMode: input.aggregationMode,
      parentSuspensionId: input.parentSuspensionId ?? null,
      chainDepth: input.chainDepth ?? 0,
    })),
    createAwaiting: vi.fn().mockImplementation((input) => makeAwaiting({
      suspensionId: input.suspensionId,
      conversationId: input.conversationId,
      respondentRoleId: input.respondentRoleId,
    })),
    findById: vi.fn().mockReturnValue(null),
    findByConversationId: vi.fn().mockReturnValue(null),
    findAwaitingBySuspensionId: vi.fn().mockReturnValue([]),
    findActiveByOrg: vi.fn().mockReturnValue([]),
    findActiveByRole: vi.fn().mockReturnValue(null),
    findSuspensionAwaitingRole: vi.fn().mockReturnValue(null),
    updateSuspensionStatus: vi.fn(),
    updateAwaitingStatus: vi.fn(),
  };
}

const defaultConfig: CollaborationConfig = {
  maxChainDepth: 5,
  maxBroadcastTargets: 5,
  maxResumeCount: 10,
  inquiryTimeoutMs: 300_000,
};

function createSuspendParams(overrides: Partial<SuspendParams> = {}): SuspendParams {
  return {
    sessionId: 'sess-1',
    acpSessionId: 'acp-sess-1',
    runId: 'run-1',
    roleId: 'role-a',
    orgId: 'org-1',
    taskId: 'task-1',
    awaitingInquiries: [{ conversationId: 'conv-1', respondentRoleId: 'role-b' }],
    aggregationMode: 'all',
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────

describe('SessionSuspensionManager', () => {
  let repo: ISuspensionRepository;
  let logger: MockLogger;
  let manager: SessionSuspensionManager;

  beforeEach(() => {
    idCounter = 0;
    repo = createMockRepo();
    logger = new MockLogger();
    manager = new SessionSuspensionManager(repo, logger, defaultConfig);
  });

  describe('suspend', () => {
    it('creates suspension and awaiting entries', () => {
      const suspension = manager.suspend(createSuspendParams());

      expect(repo.createSuspension).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'sess-1',
          acpSessionId: 'acp-sess-1',
          runId: 'run-1',
          roleId: 'role-a',
          orgId: 'org-1',
          taskId: 'task-1',
          aggregationMode: 'all',
          parentSuspensionId: null,
          chainDepth: 0,
        }),
      );
      expect(repo.createAwaiting).toHaveBeenCalledWith({
        suspensionId: suspension.id,
        conversationId: 'conv-1',
        respondentRoleId: 'role-b',
      });
    });

    it('creates multiple awaiting entries for broadcast', () => {
      manager.suspend(createSuspendParams({
        awaitingInquiries: [
          { conversationId: 'conv-1', respondentRoleId: 'role-b' },
          { conversationId: 'conv-2', respondentRoleId: 'role-c' },
        ],
      }));

      expect(repo.createAwaiting).toHaveBeenCalledTimes(2);
    });

    it('auto-detects parent suspension when in chain', () => {
      const parentSusp = makeSuspension({ id: 'parent-susp', chainDepth: 1 });
      vi.mocked(repo.findSuspensionAwaitingRole).mockReturnValue(parentSusp);

      manager.suspend(createSuspendParams());

      expect(repo.createSuspension).toHaveBeenCalledWith(
        expect.objectContaining({
          parentSuspensionId: 'parent-susp',
          chainDepth: 2,
        }),
      );
    });

    it('uses explicit parentSuspensionId when provided', () => {
      const parentSusp = makeSuspension({ id: 'explicit-parent', chainDepth: 2 });
      vi.mocked(repo.findById).mockReturnValue(parentSusp);

      manager.suspend(createSuspendParams({ parentSuspensionId: 'explicit-parent' }));

      expect(repo.createSuspension).toHaveBeenCalledWith(
        expect.objectContaining({
          parentSuspensionId: 'explicit-parent',
          chainDepth: 3,
        }),
      );
      // Should NOT call findSuspensionAwaitingRole when explicit parent given
      expect(repo.findSuspensionAwaitingRole).not.toHaveBeenCalled();
    });

    it('throws when chain depth exceeds max', () => {
      const parentSusp = makeSuspension({ id: 'deep-parent', chainDepth: 4 });
      vi.mocked(repo.findSuspensionAwaitingRole).mockReturnValue(parentSusp);

      expect(() => manager.suspend(createSuspendParams())).toThrow(
        /Chain depth 5 exceeds max 5/,
      );
    });

    it('logs suspension creation', () => {
      manager.suspend(createSuspendParams());

      expect(logger.logs.some(l => l.level === 'info' && l.msg === 'Session suspended')).toBe(true);
    });
  });

  describe('onInquiryResolved', () => {
    it('returns null when no suspension found for conversation', () => {
      vi.mocked(repo.findByConversationId).mockReturnValue(null);
      const result = manager.onInquiryResolved('conv-unknown', 'response');
      expect(result).toBeNull();
    });

    it('returns null when suspension is not in suspended state', () => {
      vi.mocked(repo.findByConversationId).mockReturnValue(
        makeSuspension({ status: 'resumed' }),
      );
      const result = manager.onInquiryResolved('conv-1', 'response');
      expect(result).toBeNull();
    });

    it('returns null when awaiting entry is already resolved', () => {
      const susp = makeSuspension({ id: 'susp-x' });
      vi.mocked(repo.findByConversationId).mockReturnValue(susp);
      vi.mocked(repo.findAwaitingBySuspensionId).mockReturnValue([
        makeAwaiting({ conversationId: 'conv-1', status: 'resolved' }),
      ]);

      const result = manager.onInquiryResolved('conv-1', 'response');
      expect(result).toBeNull();
    });

    it('marks awaiting as resolved and returns ResumeDecision when all resolved (mode=all)', () => {
      const susp = makeSuspension({ id: 'susp-x', aggregationMode: 'all' });
      vi.mocked(repo.findByConversationId).mockReturnValue(susp);

      const aw = makeAwaiting({ id: 'aw-target', conversationId: 'conv-1', status: 'pending' });
      vi.mocked(repo.findAwaitingBySuspensionId)
        .mockReturnValueOnce([aw]) // first call: before resolve
        .mockReturnValueOnce([ // second call: after resolve (refreshed)
          { ...aw, status: 'resolved', response: 'Reply text' },
        ]);

      const result = manager.onInquiryResolved('conv-1', 'Reply text');

      expect(repo.updateAwaitingStatus).toHaveBeenCalledWith(
        'aw-target', 'resolved', 'Reply text', expect.any(String),
      );
      expect(repo.updateSuspensionStatus).toHaveBeenCalledWith(
        'susp-x', 'resumed', expect.any(String),
      );
      expect(result).not.toBeNull();
      expect(result!.suspensionId).toBe('susp-x');
      expect(result!.aggregatedReply).toContain('Reply text');
    });

    it('returns null when not all resolved (mode=all)', () => {
      const susp = makeSuspension({ id: 'susp-x', aggregationMode: 'all' });
      vi.mocked(repo.findByConversationId).mockReturnValue(susp);

      const aw1 = makeAwaiting({ id: 'aw-1', conversationId: 'conv-1', status: 'pending' });
      const aw2 = makeAwaiting({ id: 'aw-2', conversationId: 'conv-2', status: 'pending', respondentRoleId: 'role-c' });
      vi.mocked(repo.findAwaitingBySuspensionId)
        .mockReturnValueOnce([aw1, aw2]) // first call
        .mockReturnValueOnce([ // after resolving aw-1
          { ...aw1, status: 'resolved', response: 'Reply 1' },
          aw2, // still pending
        ]);

      const result = manager.onInquiryResolved('conv-1', 'Reply 1');
      expect(result).toBeNull();
    });

    it('resumes on first resolved entry (mode=any)', () => {
      const susp = makeSuspension({ id: 'susp-x', aggregationMode: 'any' });
      vi.mocked(repo.findByConversationId).mockReturnValue(susp);

      const aw1 = makeAwaiting({ id: 'aw-1', conversationId: 'conv-1', status: 'pending' });
      const aw2 = makeAwaiting({ id: 'aw-2', conversationId: 'conv-2', status: 'pending', respondentRoleId: 'role-c' });
      vi.mocked(repo.findAwaitingBySuspensionId)
        .mockReturnValueOnce([aw1, aw2])
        .mockReturnValueOnce([
          { ...aw1, status: 'resolved', response: 'First reply' },
          aw2,
        ]);

      const result = manager.onInquiryResolved('conv-1', 'First reply');
      expect(result).not.toBeNull();
      expect(result!.aggregatedReply).toContain('First reply');
    });
  });

  describe('findSuspensionByInquiry', () => {
    it('delegates to repo findByConversationId', () => {
      const susp = makeSuspension();
      vi.mocked(repo.findByConversationId).mockReturnValue(susp);

      const result = manager.findSuspensionByInquiry('conv-1');
      expect(result).toBe(susp);
      expect(repo.findByConversationId).toHaveBeenCalledWith('conv-1');
    });
  });

  describe('findActiveByRole', () => {
    it('delegates to repo findActiveByRole', () => {
      const susp = makeSuspension();
      vi.mocked(repo.findActiveByRole).mockReturnValue(susp);

      const result = manager.findActiveByRole('role-a', 'org-1');
      expect(result).toBe(susp);
      expect(repo.findActiveByRole).toHaveBeenCalledWith('role-a', 'org-1');
    });
  });

  describe('findSuspensionAwaitingRole', () => {
    it('delegates to repo findSuspensionAwaitingRole', () => {
      const susp = makeSuspension();
      vi.mocked(repo.findSuspensionAwaitingRole).mockReturnValue(susp);

      const result = manager.findSuspensionAwaitingRole('role-b', 'org-1');
      expect(result).toBe(susp);
      expect(repo.findSuspensionAwaitingRole).toHaveBeenCalledWith('role-b', 'org-1');
    });
  });

  describe('getChainDepth', () => {
    it('returns 0 when no active suspensions await the role', () => {
      vi.mocked(repo.findActiveByOrg).mockReturnValue([]);
      expect(manager.getChainDepth('org-1', 'role-a')).toBe(0);
    });

    it('returns depth from active suspensions', () => {
      vi.mocked(repo.findActiveByOrg).mockReturnValue([
        makeSuspension({ id: 'susp-1', chainDepth: 2 }),
      ]);
      vi.mocked(repo.findAwaitingBySuspensionId).mockReturnValue([
        makeAwaiting({ respondentRoleId: 'role-a', status: 'pending' }),
      ]);

      expect(manager.getChainDepth('org-1', 'role-a')).toBe(3);
    });
  });
});
