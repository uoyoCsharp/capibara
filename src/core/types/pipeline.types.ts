/**
 * Pipeline orchestration core types: context, result, persistence state
 * @module core/types/pipeline
 */

import type { Phase, InteractionMode } from './phase.types.js';
import type { Requirement } from './requirement.types.js';
import type { ConductorDecision, ConductorAction } from './conductor.types.js';

export type PipelineStatus = 'running' | 'paused' | 'completed' | 'failed';

/** Interaction record for human intervention context display */
export interface InteractionRecord {
  round: number;
  phase: Phase;
  timestamp: string;
  /** Worker output (truncated) */
  workerOutput: string;
  workerOutputTruncated: boolean;
  /** Evaluator results summary (if evaluated) */
  evaluatorSummary?: string;
  /** Conductor decision */
  conductorDecision: ConductorAction;
  conductorReason: string;
  /** Feedback given (if revised) */
  feedback?: string;
}

/** Pipeline execution runtime context */
export interface PipelineContext {
  pipelineId: string;
  requirement: Requirement;
  changeId: string;
  currentPhase: Phase;
  completedPhases: Phase[];
  phaseAttempts: Record<Phase, number>;
  workerSessionId: string;
  revisionFeedback?: string[];
  artifacts: Record<Phase, string>;
  mode: InteractionMode;
  /** Current round number (increments per worker execution in a phase) */
  currentRound: number;
  /** Last N interaction records (max 3), stored in reverse chronological order */
  interactionHistory: InteractionRecord[];
}

/** Pipeline final execution result */
export interface PipelineResult {
  success: boolean;
  changeId: string;
  phases: Record<Phase, PhaseResult>;
  totalCost: number;
  totalDuration: number;
}

/** Single phase execution result */
export interface PhaseResult {
  attempts: number;
  duration: number;
  tokenCost: number;
}

/** Complete state snapshot for persistence */
export interface PipelineState {
  id: string;
  requirementId: string;
  changeId: string;
  currentState: string;
  currentPhase: Phase;
  phaseAttempts: Record<Phase, number>;
  context: {
    requirement: Requirement;
    artifacts: Record<Phase, string>;
    evaluations: Record<Phase, string[]>;
    decisions: Record<Phase, ConductorDecision[]>;
    /** W2 fix: Persist interaction history for human intervention context */
    interactionHistory: InteractionRecord[];
    /** Current round number */
    currentRound: number;
  };
  sessions: {
    workerSessionId: string;
    workerSessionPhase: Phase;
  };
  metadata: {
    createdAt: string;
    updatedAt: string;
    status: PipelineStatus;
    mode: InteractionMode;
    totalTokensUsed: number;
    totalCost: number;
  };
}
