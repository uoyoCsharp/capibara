import { describe, it, expect, beforeEach } from 'vitest';
import { InquiryRouter } from '@core/modules/coordination/routing/inquiry.router';
import type { ConversationService } from '@core/modules/conversation/services/conversation.service';
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

describe('InquiryRouter', () => {
  let router: InquiryRouter;
  let roleRepo: IRoleRepository;
  let bus: MockEventBus;
  let conversationService: ConversationService;
  let assignRespondent: ReturnType<typeof vi.fn>;

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
    assignRespondent = vi.fn();
    conversationService = { assignRespondent } as unknown as ConversationService;
    router = new InquiryRouter(roleRepo, conversationService, bus, new MockLogger());
    router.start();
  });

  it('routes to human when asking role requiresHumanApproval', () => {
    vi.mocked(roleRepo.findById).mockReturnValue(
      createRole({ requiresHumanApproval: true, parentId: 'role-parent' }),
    );

    emitNeedsRouting(bus);

    expect(assignRespondent).toHaveBeenCalledWith(
      'conv-1',
      null,
      'human',
      expect.stringContaining('requires human approval'),
    );
  });

  it('routes to parent role when available and active', () => {
    const parent = createRole({ id: 'role-parent', name: 'Lead' });
    vi.mocked(roleRepo.findById).mockImplementation((id) => {
      if (id === TEST_ROLE_ID) return createRole({ parentId: 'role-parent' });
      if (id === 'role-parent') return parent;
      return null;
    });

    emitNeedsRouting(bus);

    expect(assignRespondent).toHaveBeenCalledWith(
      'conv-1',
      'role-parent',
      'ai',
      expect.stringContaining('parent'),
    );
  });

  it('routes to parent as ai even when parent has requiresHumanApproval', () => {
    const parent = createRole({ id: 'role-parent', name: 'Manager', requiresHumanApproval: true });
    vi.mocked(roleRepo.findById).mockImplementation((id) => {
      if (id === TEST_ROLE_ID) return createRole({ parentId: 'role-parent' });
      if (id === 'role-parent') return parent;
      return null;
    });

    emitNeedsRouting(bus);

    expect(assignRespondent).toHaveBeenCalledWith('conv-1', 'role-parent', 'ai', expect.any(String));
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

    expect(assignRespondent).toHaveBeenCalledWith(
      'conv-1',
      'role-grand',
      'ai',
      expect.stringContaining('ancestor'),
    );
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

    expect(assignRespondent).toHaveBeenCalledWith('conv-1', 'role-grand', 'ai', expect.any(String));
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

    expect(assignRespondent).toHaveBeenCalledWith(
      'conv-1',
      null,
      'human',
      expect.stringContaining('Human fallback'),
    );
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

    expect(assignRespondent).toHaveBeenCalledWith(
      'conv-1',
      'role-peer',
      'ai',
      expect.stringContaining('peer'),
    );
  });

  it('routes to peer sibling when no parent', () => {
    const peer = createRole({ id: 'role-peer', name: 'Peer' });
    vi.mocked(roleRepo.findById).mockReturnValue(createRole({ parentId: null }));
    vi.mocked(roleRepo.findByOrgId).mockReturnValue([createRole(), peer]);

    emitNeedsRouting(bus);

    expect(assignRespondent).toHaveBeenCalledWith('conv-1', 'role-peer', 'ai', expect.any(String));
  });

  it('skips system roles when finding peers', () => {
    const systemRole = createRole({ id: 'role-system', isSystemRole: true });
    const normalPeer = createRole({ id: 'role-normal', name: 'Normal' });
    vi.mocked(roleRepo.findById).mockReturnValue(createRole({ parentId: null }));
    vi.mocked(roleRepo.findByOrgId).mockReturnValue([createRole(), systemRole, normalPeer]);

    emitNeedsRouting(bus);

    expect(assignRespondent).toHaveBeenCalledWith('conv-1', 'role-normal', 'ai', expect.any(String));
  });

  it('skips paused peers', () => {
    const pausedPeer = createRole({ id: 'role-paused', status: 'paused' });
    const activePeer = createRole({ id: 'role-active', name: 'Active' });
    vi.mocked(roleRepo.findById).mockReturnValue(createRole({ parentId: null }));
    vi.mocked(roleRepo.findByOrgId).mockReturnValue([createRole(), pausedPeer, activePeer]);

    emitNeedsRouting(bus);

    expect(assignRespondent).toHaveBeenCalledWith('conv-1', 'role-active', 'ai', expect.any(String));
  });

  it('falls back to human when no AI roles available', () => {
    vi.mocked(roleRepo.findById).mockReturnValue(createRole({ parentId: null }));
    vi.mocked(roleRepo.findByOrgId).mockReturnValue([createRole()]);

    emitNeedsRouting(bus);

    expect(assignRespondent).toHaveBeenCalledWith(
      'conv-1',
      null,
      'human',
      expect.stringContaining('Human fallback'),
    );
  });

  it('falls back to human when asking role not found', () => {
    vi.mocked(roleRepo.findById).mockReturnValue(null);

    emitNeedsRouting(bus, 'nonexistent');

    expect(assignRespondent).toHaveBeenCalledWith(
      'conv-1',
      null,
      'human',
      expect.stringContaining('not found'),
    );
  });

  it('logs and swallows errors from assignRespondent', () => {
    assignRespondent.mockImplementation(() => {
      throw new Error('boom');
    });

    expect(() => emitNeedsRouting(bus)).not.toThrow();
  });
});
