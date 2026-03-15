/**
 * Pipeline orchestration core types: context, result, persistence state
 * @module core/types/pipeline
 */

import type { Phase, InteractionMode } from './phase.types.js';
import type { Requirement } from './requirement.types.js';
import type { EvaluationResult } from './evaluation.types.js';
import type { ConductorDecision } from './conductor.types.js';

export type PipelineStatus = 'running' | 'paused' | 'completed' | 'failed';

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
  finalScore: number;
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
    evaluations: Record<Phase, EvaluationResult[]>;
    decisions: Record<Phase, ConductorDecision[]>;
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
