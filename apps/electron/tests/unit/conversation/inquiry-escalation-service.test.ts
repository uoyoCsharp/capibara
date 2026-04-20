import { describe, it, expect, beforeEach } from 'vitest';
import { InquiryEscalationService } from '@core/modules/conversation/services/inquiry-escalation.service';
import { MockEventBus } from '../../helpers/mock-event-bus';
import { MockLogger } from '../../helpers/mock-logger';
import { TEST_ORG_ID, TEST_ROLE_ID } from '../../helpers/fixtures';
import type { IConversationRepository } from '@core/modules/conversation/interfaces/i-conversation.repository';
import type { IRoleRepository } from '@core/modules/organization/interfaces/i-role.repository';
import type { Conversation } from '@core/modules/conversation/types/conversation.types';
import type { Role } from '@core/modules/organization/types/organization.types';

function createConv(overrides?: Partial<Conversation>): Conversation {
  return {
    id: 'conv-1',
    orgId: TEST_ORG_ID,
    type: 'inquiry',
    state: 'waiting',
    initiatorRoleId: 'role-initiator',
    respondentRoleId: TEST_ROLE_ID,
    respondentType: 'ai',
    taskId: 'task-1',
    parentConversationId: null,
    depth: 0,
    priority: 0,
    timeoutAt: '2026-01-01T00:00:00.000Z',
    externalSessionId: null,
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

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

describe('InquiryEscalationService', () => {
  let service: InquiryEscalationService;
  let convRepo: IConversationRepository;
  let roleRepo: IRoleRepository;
  let eventBus: MockEventBus;
  let logger: MockLogger;

  beforeEach(() => {
    convRepo = {
      findById: vi.fn(),
      findByOrgId: vi.fn(),
      findByTaskId: vi.fn(),
      findActiveByOrgId: vi.fn(),
      findByState: vi.fn(),
      findTimedOutInquiries: vi.fn().mockReturnValue([]),
      create: vi.fn(),
      updateState: vi.fn(),
      updateRespondent: vi.fn(),
      updateExternalSessionId: vi.fn(),
      delete: vi.fn(),
    };
    roleRepo = {
      findById: vi.fn().mockReturnValue(null),
      findByIds: vi.fn(),
      findByOrgId: vi.fn(),
      findChildren: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    eventBus = new MockEventBus();
    logger = new MockLogger();

    service = new InquiryEscalationService(convRepo, roleRepo, eventBus, logger);
  });

  it('returns 0 when no timed out conversations', () => {
    expect(service.scanAndEscalate()).toBe(0);
  });

  it('marks conversations as timed_out and emits event', () => {
    const conv = createConv();
    vi.mocked(convRepo.findTimedOutInquiries).mockReturnValue([conv]);

    service.scanAndEscalate();

    expect(convRepo.updateState).toHaveBeenCalledWith('conv-1', 'timed_out');
    eventBus.assertEmitted('conversation:timed-out');
  });

  it('escalates to parent role when available', () => {
    const conv = createConv({ respondentRoleId: 'role-child' });
    const childRole = createRole({ id: 'role-child', parentId: 'role-parent' });
    const parentRole = createRole({ id: 'role-parent', name: 'Lead', status: 'active' });
    vi.mocked(convRepo.findTimedOutInquiries).mockReturnValue([conv]);
    vi.mocked(roleRepo.findById).mockImplementation((id) => {
      if (id === 'role-child') return childRole;
      if (id === 'role-parent') return parentRole;
      return null;
    });

    const count = service.scanAndEscalate();

    expect(count).toBe(1);
    expect(convRepo.updateState).toHaveBeenCalledWith('conv-1', 'escalated');
    expect(convRepo.updateRespondent).toHaveBeenCalledWith('conv-1', 'role-parent', 'ai');
    eventBus.assertEmitted('conversation:escalated');
  });

  it('sets respondentType to human when parent requiresHumanApproval', () => {
    const conv = createConv({ respondentRoleId: 'role-child' });
    const childRole = createRole({ id: 'role-child', parentId: 'role-parent' });
    const parentRole = createRole({ id: 'role-parent', requiresHumanApproval: true, status: 'active' });
    vi.mocked(convRepo.findTimedOutInquiries).mockReturnValue([conv]);
    vi.mocked(roleRepo.findById).mockImplementation((id) => {
      if (id === 'role-child') return childRole;
      if (id === 'role-parent') return parentRole;
      return null;
    });

    service.scanAndEscalate();
    expect(convRepo.updateRespondent).toHaveBeenCalledWith('conv-1', 'role-parent', 'human');
  });

  it('does not escalate when respondentRoleId is null', () => {
    const conv = createConv({ respondentRoleId: null });
    vi.mocked(convRepo.findTimedOutInquiries).mockReturnValue([conv]);

    const count = service.scanAndEscalate();
    expect(count).toBe(0);
    expect(convRepo.updateRespondent).not.toHaveBeenCalled();
  });

  it('does not escalate when respondent has no parent', () => {
    const conv = createConv({ respondentRoleId: 'role-orphan' });
    const orphanRole = createRole({ id: 'role-orphan', parentId: null });
    vi.mocked(convRepo.findTimedOutInquiries).mockReturnValue([conv]);
    vi.mocked(roleRepo.findById).mockReturnValue(orphanRole);

    const count = service.scanAndEscalate();
    expect(count).toBe(0);
  });

  it('does not escalate when parent is not active', () => {
    const conv = createConv({ respondentRoleId: 'role-child' });
    const childRole = createRole({ id: 'role-child', parentId: 'role-parent' });
    const parentRole = createRole({ id: 'role-parent', status: 'paused' });
    vi.mocked(convRepo.findTimedOutInquiries).mockReturnValue([conv]);
    vi.mocked(roleRepo.findById).mockImplementation((id) => {
      if (id === 'role-child') return childRole;
      if (id === 'role-parent') return parentRole;
      return null;
    });

    const count = service.scanAndEscalate();
    expect(count).toBe(0);
  });

  it('handles multiple timed-out conversations', () => {
    const conv1 = createConv({ id: 'conv-1', respondentRoleId: 'role-a' });
    const conv2 = createConv({ id: 'conv-2', respondentRoleId: 'role-b' });
    const roleA = createRole({ id: 'role-a', parentId: 'role-parent' });
    const roleB = createRole({ id: 'role-b', parentId: null });
    const parentRole = createRole({ id: 'role-parent', status: 'active' });
    vi.mocked(convRepo.findTimedOutInquiries).mockReturnValue([conv1, conv2]);
    vi.mocked(roleRepo.findById).mockImplementation((id) => {
      if (id === 'role-a') return roleA;
      if (id === 'role-b') return roleB;
      if (id === 'role-parent') return parentRole;
      return null;
    });

    const count = service.scanAndEscalate();
    expect(count).toBe(1);
    expect(convRepo.updateState).toHaveBeenCalledTimes(3);
  });
});
