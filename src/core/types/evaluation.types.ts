/**
 * Evaluation related type definitions
 * @module core/types/evaluation
 */

import type { Phase } from './phase.types.js';

export type EvaluationDimension = 'quality' | 'security' | 'consistency';

export type EvaluationVerdict = 'pass' | 'pass_with_notes' | 'needs_revision' | 'critical_issues';

export type IssueSeverity = 'critical' | 'major' | 'minor' | 'suggestion';

export interface EvaluationIssue {
  severity: IssueSeverity;
  category: string;
  description: string;
  suggestion?: string;
}

export interface EvaluationInput {
  projectSummary: string;
  phaseSummary: string;
  artifact: string;
  evaluationCriteria: string;
  pipelineId: string;
  phase: Phase;
  projectDir: string;
}

export interface EvaluationResult {
  dimension: EvaluationDimension;
  verdict: EvaluationVerdict;
  score: number;
  issues: EvaluationIssue[];
  summary: string;
}
