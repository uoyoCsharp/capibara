/**
 * Prompt Framework Interface - Abstract interface for any prompt engineering framework
 * @module core/interfaces/prompt-framework
 */

import type { Phase } from '../types/phase.types.js';
import type {
  AgentDefinition,
  KnowledgeDefinition,
  EvaluationCriteria,
  PhaseConfig,
} from '../types/prompt-framework.types.js';

/**
 * Abstract interface for any prompt engineering framework
 *
 * This interface abstracts the prompt framework layer, allowing the system
 * to work with different prompt engineering implementations (e.g., .ai-agents,
 * GitHub Copilot prompts, custom frameworks).
 *
 * @example
 * ```typescript
 * // Using .ai-agents framework
 * const framework = new AiAgentsFramework('.ai-agents');
 * const agent = await framework.getAgent('analyze');
 *
 * // Using custom framework
 * const customFramework = new CustomFramework(config);
 * const agent = await customFramework.getAgent('design');
 * ```
 */
export interface IPromptFramework {
  /** Framework name/identifier */
  readonly name: string;

  /** Framework version (optional) */
  readonly version?: string;

  /**
   * Get agent definition for a specific phase
   * @param phase The phase to get agent for
   * @returns Agent definition containing role, command, and shared rules
   */
  getAgent(phase: Phase): Promise<AgentDefinition>;

  /**
   * Get knowledge base for a phase
   * @param phase The phase to get knowledge for
   * @returns Knowledge definition containing patterns and references
   */
  getKnowledge(phase: Phase): Promise<KnowledgeDefinition>;

  /**
   * Get evaluation criteria for a phase
   * @param phase The phase to get criteria for
   * @returns Evaluation criteria items
   */
  getEvaluationCriteria(phase: Phase): Promise<EvaluationCriteria>;

  /**
   * Get all supported phases in order
   * @returns Array of phase configurations
   */
  getSupportedPhases(): PhaseConfig[];

  /**
   * Check if a phase is supported
   * @param phase The phase to check
   */
  supportsPhase(phase: Phase): boolean;

  /**
   * Validate framework integrity
   * @returns true if all required resources exist
   */
  validate(): Promise<boolean>;
}
