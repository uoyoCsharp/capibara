/**
 * Project Registry Interface - CRUD + active project management
 * @module core/interfaces/project-registry
 */

import type { Project, ProjectInput } from '../types/project.types.js';

export interface IProjectRegistry {
  add(input: ProjectInput): Promise<Project>;
  get(id: string): Promise<Project | null>;
  list(): Promise<Project[]>;
  update(id: string, patch: Partial<ProjectInput>): Promise<Project>;
  remove(id: string): Promise<void>;
  getActive(): Promise<Project | null>;
  setActive(id: string): Promise<Project>;
}
