/**
 * Prompt Framework Type Definitions
 * @module core/types/prompt-framework
 */

import type { Phase } from './phase.types.js';

/** Agent definition for a phase */
export interface AgentDefinition {
  /** Role definition prompt (e.g., "You are an analyst...") */
  rolePrompt: string;

  /** Command/task prompt (e.g., "#analyze instructions") */
  commandPrompt: string;

  /** Shared rules across all agents */
  sharedRules?: string;
}

/** Knowledge base for a phase */
export interface KnowledgeDefinition {
  /** Pattern documents */
  patterns: string[];

  /** Reference documents */
  references: string[];
}

/** Evaluation criteria item */
export interface EvaluationCriteriaItem {
  description: string;
  severity?: 'critical' | 'major' | 'minor';
  category?: string;
}

/** Evaluation criteria for a phase */
export interface EvaluationCriteria {
  items: EvaluationCriteriaItem[];
  rawContent?: string;
}

/** Phase configuration from framework */
export interface PhaseConfig {
  /** Phase identifier */
  id: Phase;

  /** Human-readable name */
  name: string;

  /** Phase description */
  description?: string;

  /** Prerequisite phases */
  dependencies?: Phase[];
}
