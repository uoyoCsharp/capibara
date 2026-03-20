/**
 * Project entity and input types
 * @module core/types/project
 */

import type { AutomationConfig } from './config.types.js';

export interface Project {
  id: string;
  name: string;
  projectDir: string;
  config: Partial<AutomationConfig>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectInput {
  name: string;
  projectDir: string;
  config?: Partial<AutomationConfig>;
}
