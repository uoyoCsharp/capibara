import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrganizationService } from '@core/modules/organization/services/organization.service';
import type { IOrganizationRepository } from '@core/modules/organization/interfaces/i-organization.repository';
import type { Organization } from '@core/modules/organization/types/organization.types';
import { MockEventBus } from '../../helpers/mock-event-bus';
import { createOrgInput } from '../../helpers/fixtures';

function createMockOrg(overrides?: Partial<Organization>): Organization {
  return {
    id: 'org-1',
    name: 'Test Org',
    description: 'Test description',
    customInstructions: '',
    status: 'active',
    budgetLimit: 50,
    orgTemplateId: null,
    planningRoleId: null,
    workspacePath: '/tmp/test',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('OrganizationService', () => {
  let service: OrganizationService;
  let repo: IOrganizationRepository;
  let eventBus: MockEventBus;

  beforeEach(() => {
    eventBus = new MockEventBus();
    repo = {
      findAll: vi.fn().mockReturnValue([createMockOrg()]),
      findById: vi.fn().mockReturnValue(createMockOrg()),
      create: vi.fn().mockReturnValue(createMockOrg()),
      update: vi.fn().mockReturnValue(createMockOrg({ name: 'Updated' })),
      delete: vi.fn(),
    };
    service = new OrganizationService(repo, eventBus);
  });

  describe('findAll', () => {
    it('delegates to repository', () => {
      const result = service.findAll();

      expect(result).toHaveLength(1);
      expect(repo.findAll).toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('returns org when found', () => {
      const org = service.findById('org-1');

      expect(org).not.toBeNull();
      expect(org!.id).toBe('org-1');
    });

    it('returns null when not found', () => {
      (repo.findById as ReturnType<typeof vi.fn>).mockReturnValue(null);

      expect(service.findById('nonexistent')).toBeNull();
    });
  });

  describe('create', () => {
    it('creates org and emits org:created event', () => {
      const input = createOrgInput();

      const org = service.create(input);

      expect(org.id).toBe('org-1');
      expect(repo.create).toHaveBeenCalledWith(input);
      eventBus.assertEmitted('org:created');
      const event = eventBus.getLastEmitted('org:created');
      expect(event?.payload).toEqual(expect.objectContaining({ orgId: 'org-1', name: 'Test Org' }));
    });
  });

  describe('update', () => {
    it('updates org and emits org:updated event', () => {
      const input = { id: 'org-1', name: 'Updated' };

      const org = service.update(input);

      expect(org.name).toBe('Updated');
      expect(repo.update).toHaveBeenCalledWith(input);
      eventBus.assertEmitted('org:updated');
      const event = eventBus.getLastEmitted('org:updated');
      expect(event?.payload).toEqual(expect.objectContaining({ orgId: 'org-1' }));
    });
  });

  describe('delete', () => {
    it('deletes org and emits org:deleted event', () => {
      service.delete('org-1');

      expect(repo.delete).toHaveBeenCalledWith('org-1');
      eventBus.assertEmitted('org:deleted');
      const event = eventBus.getLastEmitted('org:deleted');
      expect(event?.payload).toEqual(expect.objectContaining({ orgId: 'org-1' }));
    });
  });
});
