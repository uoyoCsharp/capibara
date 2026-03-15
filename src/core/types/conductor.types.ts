/**
 * Conductor role decision types
 * @module core/types/conductor
 */

import type { EvaluationIssue } from './evaluation.types.js';

export type ConductorAction = 'approve' | 'revise' | 'escalate';

export interface ConductorDecision {
  action: ConductorAction;
  reason: string;
  feedback?: string[];
  notes?: EvaluationIssue[];
  priority?: 'critical' | 'normal';
}
