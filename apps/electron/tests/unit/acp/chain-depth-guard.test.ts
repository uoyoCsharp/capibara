import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChainDepthGuard } from '@core/modules/acp/collaboration/chain-depth.guard';
import type { ISuspensionRepository } from '@core/modules/acp/interfaces/i-suspension.repository';
import type { SessionSuspension, SuspensionAwaiting } from '@core/modules/acp/collaboration/suspension.types';

function makeSuspension(overrides: Partial<SessionSuspension> = {}): SessionSuspension {
  return {
    id: 'susp-1',
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
    id: 'aw-1',
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
    createSuspension: vi.fn(),
    createAwaiting: vi.fn(),
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

describe('ChainDepthGuard', () => {
  let repo: ISuspensionRepository;
  let guard: ChainDepthGuard;

  beforeEach(() => {
    repo = createMockRepo();
    guard = new ChainDepthGuard(repo, 3);
  });

  describe('validateDepth', () => {
    it('allows when no active suspensions exist', () => {
      vi.mocked(repo.findActiveByOrg).mockReturnValue([]);
      const result = guard.validateDepth('org-1', 'role-a');
      expect(result).toEqual({ allowed: true, currentDepth: 0, maxDepth: 3 });
    });

    it('allows when depth is below max', () => {
      vi.mocked(repo.findActiveByOrg).mockReturnValue([
        makeSuspension({ id: 'susp-1', chainDepth: 1 }),
      ]);
      vi.mocked(repo.findAwaitingBySuspensionId).mockReturnValue([
        makeAwaiting({ respondentRoleId: 'role-a', status: 'pending' }),
      ]);

      const result = guard.validateDepth('org-1', 'role-a');
      // currentDepth = 1 + 1 = 2, maxDepth = 3, so allowed
      expect(result).toEqual({ allowed: true, currentDepth: 2, maxDepth: 3 });
    });

    it('rejects when depth equals max', () => {
      vi.mocked(repo.findActiveByOrg).mockReturnValue([
        makeSuspension({ id: 'susp-1', chainDepth: 2 }),
      ]);
      vi.mocked(repo.findAwaitingBySuspensionId).mockReturnValue([
        makeAwaiting({ respondentRoleId: 'role-a', status: 'pending' }),
      ]);

      const result = guard.validateDepth('org-1', 'role-a');
      // currentDepth = 2 + 1 = 3, equals maxDepth 3, not allowed
      expect(result).toEqual({ allowed: false, currentDepth: 3, maxDepth: 3 });
    });

    it('ignores resolved awaiting entries', () => {
      vi.mocked(repo.findActiveByOrg).mockReturnValue([
        makeSuspension({ id: 'susp-1', chainDepth: 2 }),
      ]);
      vi.mocked(repo.findAwaitingBySuspensionId).mockReturnValue([
        makeAwaiting({ respondentRoleId: 'role-a', status: 'resolved' }),
      ]);

      const result = guard.validateDepth('org-1', 'role-a');
      expect(result).toEqual({ allowed: true, currentDepth: 0, maxDepth: 3 });
    });

    it('picks the maximum depth across multiple suspensions', () => {
      vi.mocked(repo.findActiveByOrg).mockReturnValue([
        makeSuspension({ id: 'susp-1', chainDepth: 0 }),
        makeSuspension({ id: 'susp-2', chainDepth: 1 }),
      ]);
      vi.mocked(repo.findAwaitingBySuspensionId).mockImplementation((sid: string) => {
        if (sid === 'susp-1') return [makeAwaiting({ respondentRoleId: 'role-a', status: 'pending' })];
        if (sid === 'susp-2') return [makeAwaiting({ respondentRoleId: 'role-a', status: 'pending' })];
        return [];
      });

      const result = guard.validateDepth('org-1', 'role-a');
      // max(0+1, 1+1) = 2
      expect(result).toEqual({ allowed: true, currentDepth: 2, maxDepth: 3 });
    });
  });

  describe('detectCycle', () => {
    it('returns no cycle when no active suspensions exist', () => {
      vi.mocked(repo.findActiveByOrg).mockReturnValue([]);
      const result = guard.detectCycle('org-1', 'role-a', ['role-b']);
      expect(result).toEqual({ hasCycle: false });
    });

    it('detects direct cycle: target is waiting for fromRole', () => {
      // role-b is suspended and waiting for role-a to respond
      vi.mocked(repo.findActiveByOrg).mockReturnValue([
        makeSuspension({ id: 'susp-1', roleId: 'role-b' }),
      ]);
      vi.mocked(repo.findAwaitingBySuspensionId).mockReturnValue([
        makeAwaiting({ respondentRoleId: 'role-a', status: 'pending' }),
      ]);

      // role-a tries to ask role-b → direct cycle
      const result = guard.detectCycle('org-1', 'role-a', ['role-b']);
      expect(result).toEqual({ hasCycle: true, cycleRoleId: 'role-b' });
    });

    it('skips resolved awaiting in direct cycle check', () => {
      vi.mocked(repo.findActiveByOrg).mockReturnValue([
        makeSuspension({ id: 'susp-1', roleId: 'role-b' }),
      ]);
      vi.mocked(repo.findAwaitingBySuspensionId).mockReturnValue([
        makeAwaiting({ respondentRoleId: 'role-a', status: 'resolved' }),
      ]);

      const result = guard.detectCycle('org-1', 'role-a', ['role-b']);
      expect(result).toEqual({ hasCycle: false });
    });

    it('detects indirect cycle via parent chain', () => {
      // Chain: role-c suspended (susp-3, parent=susp-2),
      //        role-b suspended (susp-2, parent=susp-1, roleId=role-c's target),
      //        role-a suspended (susp-1, roleId=role-b's target)
      // role-a wants to ask role-c, but role-c is in the parent chain
      const suspA = makeSuspension({ id: 'susp-1', roleId: 'role-a', parentSuspensionId: null, chainDepth: 0 });
      const suspB = makeSuspension({ id: 'susp-2', roleId: 'role-b', parentSuspensionId: 'susp-1', chainDepth: 1 });

      vi.mocked(repo.findActiveByOrg).mockReturnValue([suspA, suspB]);
      vi.mocked(repo.findAwaitingBySuspensionId).mockReturnValue([]);
      // role-a is being awaited by susp-2 → findSuspensionAwaitingRole returns the parent
      vi.mocked(repo.findSuspensionAwaitingRole).mockReturnValue(suspB);
      // Walk parent chain: susp-2 → roleId='role-b' (not target), parent=susp-1
      vi.mocked(repo.findById).mockImplementation((id: string) => {
        if (id === 'susp-1') return suspA;
        if (id === 'susp-2') return suspB;
        return null;
      });

      // role-a tries to ask role-b → role-b is in parent chain
      const result = guard.detectCycle('org-1', 'role-a', ['role-b']);
      expect(result).toEqual({ hasCycle: true, cycleRoleId: 'role-b' });
    });

    it('returns no cycle when target is not in parent chain', () => {
      const suspA = makeSuspension({ id: 'susp-1', roleId: 'role-a', parentSuspensionId: null });
      vi.mocked(repo.findActiveByOrg).mockReturnValue([suspA]);
      vi.mocked(repo.findAwaitingBySuspensionId).mockReturnValue([]);
      vi.mocked(repo.findSuspensionAwaitingRole).mockReturnValue(suspA);
      vi.mocked(repo.findById).mockReturnValue(null);

      const result = guard.detectCycle('org-1', 'role-a', ['role-d']);
      // role-d is not in any parent chain
      expect(result).toEqual({ hasCycle: false });
    });

    it('checks multiple targets and returns first cyclic one', () => {
      vi.mocked(repo.findActiveByOrg).mockReturnValue([
        makeSuspension({ id: 'susp-1', roleId: 'role-b' }),
      ]);
      vi.mocked(repo.findAwaitingBySuspensionId).mockReturnValue([
        makeAwaiting({ respondentRoleId: 'role-a', status: 'pending' }),
      ]);

      const result = guard.detectCycle('org-1', 'role-a', ['role-c', 'role-b']);
      // role-c is fine, role-b has direct cycle
      expect(result).toEqual({ hasCycle: true, cycleRoleId: 'role-b' });
    });
  });
});
