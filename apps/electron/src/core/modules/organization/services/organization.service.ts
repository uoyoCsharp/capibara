import { injectable } from 'tsyringe';
import type { IOrganizationRepository } from '../interfaces/i-organization.repository';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { Organization, CreateOrganizationInput, UpdateOrganizationInput } from '../types/organization.types';

@injectable()
export class OrganizationService {
  constructor(
    private readonly orgRepo: IOrganizationRepository,
    private readonly eventBus: IEventBus,
  ) {}

  findAll(): Organization[] {
    return this.orgRepo.findAll();
  }

  findById(id: string): Organization | null {
    return this.orgRepo.findById(id);
  }

  create(input: CreateOrganizationInput): Organization {
    const org = this.orgRepo.create(input);
    this.emitEvent('org:created', { orgId: org.id, name: org.name });
    return org;
  }

  update(input: UpdateOrganizationInput): Organization {
    const org = this.orgRepo.update(input);
    this.emitEvent('org:updated', { orgId: org.id, changes: Object.keys(input).filter((k) => k !== 'id') });
    return org;
  }

  delete(id: string): void {
    this.orgRepo.delete(id);
    this.emitEvent('org:deleted', { orgId: id });
  }

  private emitEvent(type: string, payload: Record<string, unknown>): void {
    this.eventBus.emit({
      type: type as import('@core/foundation/events').DomainEventType,
      timestamp: new Date().toISOString(),
      payload,
    });
  }
}
