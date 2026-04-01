import type { Organization } from '../types/domain.types.js';

export interface CreateOrganizationInput {
  name: string;
  description: string;
  budgetLimit: number;
  orgTemplateId: string | null;
  workspacePath: string;
}

export interface UpdateOrganizationInput {
  id: string;
  name?: string;
  description?: string;
  status?: Organization['status'];
  budgetLimit?: number;
  workspacePath?: string;
}

export interface IOrganizationRepository {
  findAll(): Promise<Organization[]>;
  findById(id: string): Promise<Organization | null>;
  create(input: CreateOrganizationInput): Promise<Organization>;
  update(input: UpdateOrganizationInput): Promise<Organization>;
  delete(id: string): Promise<void>;
}
