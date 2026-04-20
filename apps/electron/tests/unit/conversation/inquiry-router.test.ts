import { describe, it, expect, beforeEach } from 'vitest';
import { InquiryRouter } from '@core/modules/conversation/routing/inquiry.router';
import { MockLogger } from '../../helpers/mock-logger';
import { TEST_ORG_ID, TEST_ROLE_ID, TEST_TASK_ID } from '../../helpers/fixtures';
import type { IRoleRepository } from '@core/modules/organization/interfaces/i-role.repository';
import type { Role } from '@core/modules/organization/types/organization.types';

function createRole(overrides?: Partial<Role>): Role {
  return {
    id: TEST_ROLE_ID,
    orgId: TEST_ORG_ID,
    name: 'Dev',
    parentId: null,
    persona: '',
    knowledgeBaseRefs: [],
    skillIds: [],
    canApprove: false,
    canDelegate: false,
    requiresHumanApproval: false,
    consecutiveWakeCount: 0,
    isSystemRole: false,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('InquiryRouter', () => {
  let router: InquiryRouter;
  let roleRepo: IRoleRepository;
  let logger: MockLogger;

  beforeEach(() => {
    roleRepo = {
      findById: vi.fn().mockReturnValue(createRole()),
      findByIds: vi.fn(),
      findByOrgId: vi.fn().mockReturnValue([]),
      findChildren: vi.fn().mockReturnValue([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    logger = new MockLogger();
    router = new InquiryRouter(roleRepo, logger);
  });

  it('routes to parent role when available and active', () => {
    const parent = createRole({ id: 'role-parent', name: 'Lead' });
    vi.mocked(roleRepo.findById).mockImplementation((id) => {
      if (id === TEST_ROLE_ID) return createRole({ parentId: 'role-parent' });
      if (id === 'role-parent') return parent;
      return null;
    });

    const decision = router.route({
      askingRoleId: TEST_ROLE_ID,
      orgId: TEST_ORG_ID,
      taskId: TEST_TASK_ID,
      questionContent: 'Need help',
      conversationDepth: 0,
    });

    expect(decision.respondentRoleId).toBe('role-parent');
    expect(decision.respondentType).toBe('ai');
    expect(decision.auditReason).toContain('parent');
  });

  it('routes to parent as human when requiresHumanApproval', () => {
    const parent = createRole({ id: 'role-parent', name: 'Manager', requiresHumanApproval: true });
    vi.mocked(roleRepo.findById).mockImplementation((id) => {
      if (id === TEST_ROLE_ID) return createRole({ parentId: 'role-parent' });
      if (id === 'role-parent') return parent;
      return null;
    });

    const decision = router.route({
      askingRoleId: TEST_ROLE_ID,
      orgId: TEST_ORG_ID,
      taskId: TEST_TASK_ID,
      questionContent: 'Approval needed',
      conversationDepth: 0,
    });

    expect(decision.respondentType).toBe('human');
  });

  it('falls back to peer when parent is paused', () => {
    const parent = createRole({ id: 'role-parent', status: 'paused' });
    const peer = createRole({ id: 'role-peer', name: 'Peer' });
    vi.mocked(roleRepo.findById).mockImplementation((id) => {
      if (id === TEST_ROLE_ID) return createRole({ parentId: 'role-parent' });
      if (id === 'role-parent') return parent;
      return null;
    });
    vi.mocked(roleRepo.findChildren).mockReturnValue([createRole(), peer]);

    const decision = router.route({
      askingRoleId: TEST_ROLE_ID,
      orgId: TEST_ORG_ID,
      taskId: TEST_TASK_ID,
      questionContent: 'Help',
      conversationDepth: 0,
    });

    expect(decision.respondentRoleId).toBe('role-peer');
    expect(decision.auditReason).toContain('peer');
  });

  it('routes to peer sibling when no parent', () => {
    const peer = createRole({ id: 'role-peer', name: 'Peer' });
    vi.mocked(roleRepo.findById).mockReturnValue(createRole({ parentId: null }));
    vi.mocked(roleRepo.findByOrgId).mockReturnValue([createRole(), peer]);

    const decision = router.route({
      askingRoleId: TEST_ROLE_ID,
      orgId: TEST_ORG_ID,
      taskId: TEST_TASK_ID,
      questionContent: 'Help',
      conversationDepth: 0,
    });

    expect(decision.respondentRoleId).toBe('role-peer');
  });

  it('skips system roles when finding peers', () => {
    const systemRole = createRole({ id: 'role-system', isSystemRole: true });
    const normalPeer = createRole({ id: 'role-normal', name: 'Normal' });
    vi.mocked(roleRepo.findById).mockReturnValue(createRole({ parentId: null }));
    vi.mocked(roleRepo.findByOrgId).mockReturnValue([createRole(), systemRole, normalPeer]);

    const decision = router.route({
      askingRoleId: TEST_ROLE_ID,
      orgId: TEST_ORG_ID,
      taskId: TEST_TASK_ID,
      questionContent: 'Help',
      conversationDepth: 0,
    });

    expect(decision.respondentRoleId).toBe('role-normal');
  });

  it('skips paused peers', () => {
    const pausedPeer = createRole({ id: 'role-paused', status: 'paused' });
    const activePeer = createRole({ id: 'role-active', name: 'Active' });
    vi.mocked(roleRepo.findById).mockReturnValue(createRole({ parentId: null }));
    vi.mocked(roleRepo.findByOrgId).mockReturnValue([createRole(), pausedPeer, activePeer]);

    const decision = router.route({
      askingRoleId: TEST_ROLE_ID,
      orgId: TEST_ORG_ID,
      taskId: TEST_TASK_ID,
      questionContent: 'Help',
      conversationDepth: 0,
    });

    expect(decision.respondentRoleId).toBe('role-active');
  });

  it('falls back to human when no AI roles available', () => {
    vi.mocked(roleRepo.findById).mockReturnValue(createRole({ parentId: null }));
    vi.mocked(roleRepo.findByOrgId).mockReturnValue([createRole()]);

    const decision = router.route({
      askingRoleId: TEST_ROLE_ID,
      orgId: TEST_ORG_ID,
      taskId: TEST_TASK_ID,
      questionContent: 'Help',
      conversationDepth: 0,
    });

    expect(decision.respondentRoleId).toBeNull();
    expect(decision.respondentType).toBe('human');
    expect(decision.priority).toBe(10);
    expect(decision.auditReason).toContain('Human fallback');
  });

  it('falls back to human when asking role not found', () => {
    vi.mocked(roleRepo.findById).mockReturnValue(null);

    const decision = router.route({
      askingRoleId: 'nonexistent',
      orgId: TEST_ORG_ID,
      taskId: TEST_TASK_ID,
      questionContent: 'Help',
      conversationDepth: 0,
    });

    expect(decision.respondentRoleId).toBeNull();
    expect(decision.respondentType).toBe('human');
    expect(decision.auditReason).toContain('not found');
  });
});
