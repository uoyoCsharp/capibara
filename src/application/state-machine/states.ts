/**
 * Pipeline State Enum - Defines all valid states for state machine
 * @module application/state-machine/states
 */

export enum PipelineStateName {
  Idle = 'idle',
  Triggered = 'triggered',

  // analyze phase
  Analyzing = 'analyzing',
  AnalyzeEvaluating = 'analyze_evaluating',
  AnalyzeDecision = 'analyze_decision',

  // design phase
  Designing = 'designing',
  DesignEvaluating = 'design_evaluating',
  DesignDecision = 'design_decision',

  // implement phase
  Implementing = 'implementing',
  ImplementEvaluating = 'implement_evaluating',
  ImplementDecision = 'implement_decision',

  // review phase
  Reviewing = 'reviewing',
  ReviewEvaluating = 'review_evaluating',
  ReviewDecision = 'review_decision',

  // test phase
  Testing = 'testing',
  TestEvaluating = 'test_evaluating',
  TestDecision = 'test_decision',

  // terminal states
  HumanIntervention = 'human_intervention',
  Completed = 'completed',
  Failed = 'failed',
}
