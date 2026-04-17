import type { Organization, CreateOrganizationInput, UpdateOrganizationInput } from '../types/organization.types';

export interface IOrganizationRepository {
  findAll(): Organization[];
  findById(id: string): Organization | null;
  create(input: CreateOrganizationInput): Organization;
  update(input: UpdateOrganizationInput): Organization;
  delete(id: string): void;
}
