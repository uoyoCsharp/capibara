/**
 * Requirement Pool Interface - CRUD + consumption for requirement queue
 * @module core/interfaces/requirement-pool
 */

import type { Requirement, RequirementInput, RequirementStatus } from '../types/requirement.types.js';

export interface IRequirementPool {
  add(projectId: string, input: RequirementInput): Promise<Requirement>;
  get(id: string): Promise<Requirement | null>;
  list(projectId: string, filter?: { status?: RequirementStatus }): Promise<Requirement[]>;
  update(id: string, patch: Partial<Pick<Requirement, 'title' | 'description' | 'status' | 'priority'>>): Promise<Requirement>;
  remove(id: string): Promise<void>;
  nextPending(projectId: string): Promise<Requirement | null>;
}
