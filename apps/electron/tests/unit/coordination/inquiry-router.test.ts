import { describe, it, expect, beforeEach } from 'vitest';
import { InquiryOrchestrator } from '@core/modules/coordination/routing/inquiry.orchestrator';
import { MockEventBus } from '../../helpers/mock-event-bus';
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

function emitNeedsRouting(bus: MockEventBus, askingRoleId = TEST_ROLE_ID): void {
  bus.emit({
    type: 'conversation:needs-routing',
    timestamp: new Date().toISOString(),
    payload: {
      conversationId: 'conv-1',
      orgId: TEST_ORG_ID,
      askingRoleId,
      taskId: TEST_TASK_ID,
      conversationDepth: 0,
    },
  });
}

describe('InquiryOrchestrator', () => {
  let router: InquiryOrchestrator;
  let roleRepo: IRoleRepository;
  let bus: MockEventBus;

  function expectResolvedRoute(expected: Record<string, unknown>): void {
    const event = bus.getLastEmitted('conversation:route-resolved');
    expect(event).toBeDefined();
    expect(event?.payload).toEqual(
      expect.objectContaining({
        conversationId: 'conv-1',
        ...expected,
      }),
    );
  }

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
    bus = new MockEventBus();
    router = new InquiryOrchestrator(roleRepo, bus, bus, new MockLogger());
    router.start();
  });

  it('routes to human when asking role requiresHumanApproval', () => {
    vi.mocked(roleRepo.findById).mockReturnValue(
      createRole({ requiresHumanApproval: true, parentId: 'role-parent' }),
    );

    emitNeedsRouting(bus);

    expectResolvedRoute({
      respondentRoleId: null,
      respondentType: 'human',
      auditReason: expect.stringContaining('requires human approval'),
    });
  });

  it('routes to parent role when available and active', () => {
    const parent = createRole({ id: 'role-parent', name: 'Lead' });
    vi.mocked(roleRepo.findById).mockImplementation((id) => {
      if (id === TEST_ROLE_ID) return createRole({ parentId: 'role-parent' });
      if (id === 'role-parent') return parent;
      return null;
    });

    emitNeedsRouting(bus);

    expectResolvedRoute({
      respondentRoleId: 'role-parent',
      respondentType: 'ai',
      auditReason: expect.stringContaining('parent'),
    });
  });

  it('routes to parent as ai even when parent has requiresHumanApproval', () => {
    const parent = createRole({ id: 'role-parent', name: 'Manager', requiresHumanApproval: true });
    vi.mocked(roleRepo.findById).mockImplementation((id) => {
      if (id === TEST_ROLE_ID) return createRole({ parentId: 'role-parent' });
      if (id === 'role-parent') return parent;
      return null;
    });

    emitNeedsRouting(bus);

    expectResolvedRoute({ respondentRoleId: 'role-parent', respondentType: 'ai' });
  });

  it('walks up to grandparent when direct parent is paused', () => {
    const parent = createRole({ id: 'role-parent', status: 'paused', parentId: 'role-grand' });
    const grand = createRole({ id: 'role-grand', name: 'Director' });
    vi.mocked(roleRepo.findById).mockImplementation((id) => {
      if (id === TEST_ROLE_ID) return createRole({ parentId: 'role-parent' });
      if (id === 'role-parent') return parent;
      if (id === 'role-grand') return grand;
      return null;
    });
    vi.mocked(roleRepo.findChildren).mockReturnValue([]);

    emitNeedsRouting(bus);

    expectResolvedRoute({
      respondentRoleId: 'role-grand',
      respondentType: 'ai',
      auditReason: expect.stringContaining('ancestor'),
    });
  });

  it('skips system-role ancestors when walking up', () => {
    const parent = createRole({ id: 'role-parent', status: 'paused', parentId: 'role-system' });
    const systemAncestor = createRole({ id: 'role-system', isSystemRole: true, parentId: 'role-grand' });
    const grand = createRole({ id: 'role-grand', name: 'Director' });
    vi.mocked(roleRepo.findById).mockImplementation((id) => {
      if (id === TEST_ROLE_ID) return createRole({ parentId: 'role-parent' });
      if (id === 'role-parent') return parent;
      if (id === 'role-system') return systemAncestor;
      if (id === 'role-grand') return grand;
      return null;
    });
    vi.mocked(roleRepo.findChildren).mockReturnValue([]);

    emitNeedsRouting(bus);

    expectResolvedRoute({ respondentRoleId: 'role-grand', respondentType: 'ai' });
  });

  it('breaks ancestor cycles without infinite loop', () => {
    const parent = createRole({ id: 'role-parent', status: 'paused', parentId: TEST_ROLE_ID });
    vi.mocked(roleRepo.findById).mockImplementation((id) => {
      if (id === TEST_ROLE_ID) return createRole({ parentId: 'role-parent', status: 'paused' });
      if (id === 'role-parent') return parent;
      return null;
    });
    vi.mocked(roleRepo.findChildren).mockReturnValue([]);

    emitNeedsRouting(bus);

    expectResolvedRoute({
      respondentRoleId: null,
      respondentType: 'human',
      auditReason: expect.stringContaining('Human fallback'),
    });
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

    emitNeedsRouting(bus);

    expectResolvedRoute({
      respondentRoleId: 'role-peer',
      respondentType: 'ai',
      auditReason: expect.stringContaining('peer'),
    });
  });

  it('routes to peer sibling when no parent', () => {
    const peer = createRole({ id: 'role-peer', name: 'Peer' });
    vi.mocked(roleRepo.findById).mockReturnValue(createRole({ parentId: null }));
    vi.mocked(roleRepo.findByOrgId).mockReturnValue([createRole(), peer]);

    emitNeedsRouting(bus);

    expectResolvedRoute({ respondentRoleId: 'role-peer', respondentType: 'ai' });
  });

  it('skips system roles when finding peers', () => {
    const systemRole = createRole({ id: 'role-system', isSystemRole: true });
    const normalPeer = createRole({ id: 'role-normal', name: 'Normal' });
    vi.mocked(roleRepo.findById).mockReturnValue(createRole({ parentId: null }));
    vi.mocked(roleRepo.findByOrgId).mockReturnValue([createRole(), systemRole, normalPeer]);

    emitNeedsRouting(bus);

    expectResolvedRoute({ respondentRoleId: 'role-normal', respondentType: 'ai' });
  });

  it('skips paused peers', () => {
    const pausedPeer = createRole({ id: 'role-paused', status: 'paused' });
    const activePeer = createRole({ id: 'role-active', name: 'Active' });
    vi.mocked(roleRepo.findById).mockReturnValue(createRole({ parentId: null }));
    vi.mocked(roleRepo.findByOrgId).mockReturnValue([createRole(), pausedPeer, activePeer]);

    emitNeedsRouting(bus);

    expectResolvedRoute({ respondentRoleId: 'role-active', respondentType: 'ai' });
  });

  it('falls back to human when no AI roles available', () => {
    vi.mocked(roleRepo.findById).mockReturnValue(createRole({ parentId: null }));
    vi.mocked(roleRepo.findByOrgId).mockReturnValue([createRole()]);

    emitNeedsRouting(bus);

    expectResolvedRoute({
      respondentRoleId: null,
      respondentType: 'human',
      auditReason: expect.stringContaining('Human fallback'),
    });
  });

  it('falls back to human when asking role not found', () => {
    vi.mocked(roleRepo.findById).mockReturnValue(null);

    emitNeedsRouting(bus, 'nonexistent');

    expectResolvedRoute({
      respondentRoleId: null,
      respondentType: 'human',
      auditReason: expect.stringContaining('not found'),
    });
  });

  it('logs and swallows errors from event publication', () => {
    vi.spyOn(bus, 'publish').mockImplementation(() => {
      throw new Error('boom');
    });

    expect(() => emitNeedsRouting(bus)).not.toThrow();
  });
});
