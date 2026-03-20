/**
 * Complete type definitions for automation config (pure types, no zod)
 * @module core/types/config
 */

import type { InteractionMode } from './phase.types.js';

export interface CliConfig {
  cliPath: string;
  projectDir: string;
  maxConcurrentProcesses: number;
}

export interface WorkerConfig {
  defaultMaxTurns: number;
  defaultTimeout: number;
}

export interface EvaluatorConfig {
  maxTurns: number;
}

export interface MessengerConfig {
  maxTurns: number;
}

export interface ConductorConfig {
  maxAttemptsPerPhase: number;
  maxTurns: number;
}

export interface GitHubTriggerConfig {
  owner: string;
  repo: string;
  labels: string[];
  pollInterval: number;
  token: string;
}

export interface TriggerConfig {
  type: 'github_issues' | 'manual';
  github?: GitHubTriggerConfig;
}

export interface PipelineConfig {
  mode: InteractionMode;
  /** Path to pipeline definition YAML/JSON file (optional, defaults to linear pipeline) */
  definitionFile?: string;
  budgetLimit: number;
}

export interface ExecutorRegistryConfig {
  /** Default executor type */
  defaultType: string;
}

export interface PersistenceConfig {
  stateDir: string;
  logDir: string;
}

/** Prompt framework configuration */
export interface PromptFrameworkConfig {
  /** Framework type: 'ai-agents' | 'custom' | future types */
  type: string;

  /** Framework root directory (for file-based frameworks) */
  rootDir?: string;

  /** Custom framework module path (for type='custom') */
  customModule?: string;

  /** Framework-specific options */
  options?: Record<string, unknown>;
}

export interface AutomationConfig {
  cli: CliConfig;
  worker: WorkerConfig;
  evaluator: EvaluatorConfig;
  messenger: MessengerConfig;
  conductor: ConductorConfig;
  trigger: TriggerConfig;
  pipeline: PipelineConfig;
  persistence: PersistenceConfig;
  promptFramework: PromptFrameworkConfig;
  executor?: ExecutorRegistryConfig;
}
