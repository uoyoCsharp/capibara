/**
 * Requirement source and structure definitions
 * @module core/types/requirement
 */

export type RequirementSource = 'github_issue' | 'notion' | 'manual';

export interface Requirement {
  id: string;
  title: string;
  description: string;
  source: RequirementSource;
  metadata: Record<string, unknown>;
  createdAt: string;
}
