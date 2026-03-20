/**
 * Conductor role decision types
 * @module core/types/conductor
 */

export type ConductorAction = 'approve' | 'revise' | 'escalate';

export interface ConductorDecision {
  action: ConductorAction;
  reason: string;
  feedback?: string[];
  priority?: 'critical' | 'normal';
}
