import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RoleService } from '@core/modules/organization/services/role.service';
import type { IRoleRepository } from '@core/modules/organization/interfaces/i-role.repository';
import type { Role } from '@core/modules/organization/types/organization.types';
import { MockEventBus } from '../../helpers/mock-event-bus';
import { createRoleInput } from '../../helpers/fixtures';

function createMockRole(overrides?: Partial<Role>): Role {
  return {
    id: 'role-1',
    orgId: 'org-1',
    name: 'Test Role',
    parentId: null,
    persona: 'A helpful assistant',
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

describe('RoleService', () => {
  let service: RoleService;
  let repo: IRoleRepository;
  let eventBus: MockEventBus;

  const root = createMockRole({ id: 'role-root', name: 'Tech Lead', parentId: null });
  const child = createMockRole({ id: 'role-child', name: 'Frontend Dev', parentId: 'role-root' });
  const grandchild = createMockRole({ id: 'role-gc', name: 'UI Specialist', parentId: 'role-child' });

  beforeEach(() => {
    eventBus = new MockEventBus();
    repo = {
      findById: vi.fn((id: string) => {
        const map: Record<string, Role> = { 'role-root': root, 'role-child': child, 'role-gc': grandchild };
        return map[id] ?? null;
      }),
      findByIds: vi.fn().mockReturnValue([root, child]),
      findByOrgId: vi.fn().mockReturnValue([root, child, grandchild]),
      findChildren: vi.fn((parentId: string) => {
        if (parentId === 'role-root') return [child];
        if (parentId === 'role-child') return [grandchild];
        return [];
      }),
      create: vi.fn().mockReturnValue(createMockRole()),
      update: vi.fn().mockReturnValue(createMockRole({ name: 'Updated Role' })),
      delete: vi.fn(),
    };
    service = new RoleService(repo, eventBus);
  });

  describe('findById', () => {
    it('returns role when found', () => {
      const role = service.findById('role-root');
      expect(role).not.toBeNull();
      expect(role!.name).toBe('Tech Lead');
    });

    it('returns null when not found', () => {
      expect(service.findById('nonexistent')).toBeNull();
    });
  });

  describe('findByOrgId', () => {
    it('returns all roles for org', () => {
      const roles = service.findByOrgId('org-1');
      expect(roles).toHaveLength(3);
    });
  });

  describe('findChildren', () => {
    it('returns direct children of a role', () => {
      const children = service.findChildren('role-root');
      expect(children).toHaveLength(1);
      expect(children[0].id).toBe('role-child');
    });

    it('returns empty array for leaf role', () => {
      expect(service.findChildren('role-gc')).toEqual([]);
    });
  });

  describe('getParent', () => {
    it('returns parent role', () => {
      const parent = service.getParent('role-child');
      expect(parent).not.toBeNull();
      expect(parent!.id).toBe('role-root');
    });

    it('returns null for root role', () => {
      expect(service.getParent('role-root')).toBeNull();
    });

    it('returns null when role not found', () => {
      expect(service.getParent('nonexistent')).toBeNull();
    });
  });

  describe('getAncestors', () => {
    it('returns full ancestor chain from grandchild', () => {
      const ancestors = service.getAncestors('role-gc');
      expect(ancestors).toHaveLength(2);
      expect(ancestors[0].id).toBe('role-child');
      expect(ancestors[1].id).toBe('role-root');
    });

    it('returns single parent for child', () => {
      const ancestors = service.getAncestors('role-child');
      expect(ancestors).toHaveLength(1);
      expect(ancestors[0].id).toBe('role-root');
    });

    it('returns empty array for root role', () => {
      expect(service.getAncestors('role-root')).toEqual([]);
    });

    it('returns empty array for nonexistent role', () => {
      expect(service.getAncestors('nonexistent')).toEqual([]);
    });
  });

  describe('create', () => {
    it('creates role and emits role:created event', () => {
      const input = createRoleInput('org-1');
      const role = service.create(input);

      expect(role).toBeDefined();
      expect(repo.create).toHaveBeenCalledWith(input);
      eventBus.assertEmitted('role:created');
      const event = eventBus.getLastEmitted('role:created');
      expect(event?.payload).toEqual(expect.objectContaining({ roleId: 'role-1', orgId: 'org-1' }));
    });
  });

  describe('update', () => {
    it('updates role and emits role:updated event', () => {
      const input = { id: 'role-1', name: 'Updated Role' };
      service.update(input);

      expect(repo.update).toHaveBeenCalledWith(input);
      eventBus.assertEmitted('role:updated');
    });
  });

  describe('delete', () => {
    it('deletes role and emits role:deleted event', () => {
      service.delete('role-root');

      expect(repo.delete).toHaveBeenCalledWith('role-root');
      eventBus.assertEmitted('role:deleted');
      const event = eventBus.getLastEmitted('role:deleted');
      expect(event?.payload).toEqual(expect.objectContaining({ roleId: 'role-root', orgId: 'org-1' }));
    });

    it('does not emit event when role not found before delete', () => {
      service.delete('nonexistent');

      expect(repo.delete).toHaveBeenCalledWith('nonexistent');
      eventBus.assertNotEmitted('role:deleted');
    });
  });
});
