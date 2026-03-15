/**
 * State Transition Rules Table - Defines all valid (from, event) -> to mappings
 * @module application/state-machine/transitions
 */

import { PipelineStateName as S } from './states.js';

export interface Transition {
  from: S;
  event: string;
  to: S;
}

/**
 * Complete state transition rules table
 * Add entries here when adding new states/events
 */
export const TRANSITIONS: Transition[] = [
  // Startup
  { from: S.Idle, event: 'new_requirement', to: S.Triggered },
  { from: S.Triggered, event: 'start_analyze', to: S.Analyzing },

  // analyze phase
  { from: S.Analyzing, event: 'phase_complete', to: S.AnalyzeEvaluating },
  { from: S.AnalyzeEvaluating, event: 'evaluations_complete', to: S.AnalyzeDecision },
  { from: S.AnalyzeDecision, event: 'revise', to: S.Analyzing },
  { from: S.AnalyzeDecision, event: 'approve', to: S.Designing },

  // design phase
  { from: S.Designing, event: 'phase_complete', to: S.DesignEvaluating },
  { from: S.DesignEvaluating, event: 'evaluations_complete', to: S.DesignDecision },
  { from: S.DesignDecision, event: 'revise', to: S.Designing },
  { from: S.DesignDecision, event: 'approve', to: S.Implementing },

  // implement phase
  { from: S.Implementing, event: 'phase_complete', to: S.ImplementEvaluating },
  { from: S.ImplementEvaluating, event: 'evaluations_complete', to: S.ImplementDecision },
  { from: S.ImplementDecision, event: 'revise', to: S.Implementing },
  { from: S.ImplementDecision, event: 'approve', to: S.Reviewing },

  // review phase
  { from: S.Reviewing, event: 'phase_complete', to: S.ReviewEvaluating },
  { from: S.ReviewEvaluating, event: 'evaluations_complete', to: S.ReviewDecision },
  { from: S.ReviewDecision, event: 'revise', to: S.Reviewing },
  { from: S.ReviewDecision, event: 'approve', to: S.Testing },

  // test phase
  { from: S.Testing, event: 'phase_complete', to: S.TestEvaluating },
  { from: S.TestEvaluating, event: 'evaluations_complete', to: S.TestDecision },
  { from: S.TestDecision, event: 'revise', to: S.Testing },
  { from: S.TestDecision, event: 'approve', to: S.Completed },

  // Human intervention (can be triggered from any working state)
  { from: S.Analyzing, event: 'needs_human', to: S.HumanIntervention },
  { from: S.Designing, event: 'needs_human', to: S.HumanIntervention },
  { from: S.Implementing, event: 'needs_human', to: S.HumanIntervention },
  { from: S.Reviewing, event: 'needs_human', to: S.HumanIntervention },
  { from: S.Testing, event: 'needs_human', to: S.HumanIntervention },

  // Reset
  { from: S.Completed, event: 'reset', to: S.Idle },
  { from: S.Failed, event: 'reset', to: S.Idle },
];
