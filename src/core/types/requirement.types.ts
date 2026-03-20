/**
 * Requirement source and structure definitions
 * @module core/types/requirement
 */

export type RequirementSource = 'github_issue' | 'notion' | 'manual';

export type RequirementStatus = 'pending' | 'in-progress' | 'completed' | 'failed';

export interface Requirement {
  id: string;
  projectId?: string;
  title: string;
  description: string;
  status?: RequirementStatus;
  source: RequirementSource;
  priority?: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt?: string;
}

export interface RequirementInput {
  title: string;
  description: string;
  source?: RequirementSource;
  priority?: number;
  metadata?: Record<string, unknown>;
}
