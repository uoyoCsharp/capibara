/**
 * Configuration Default Values Constants
 * @module config/config-defaults
 */

import type { AutomationConfig } from '../core/types/config.types.js';

/**
 * Complete default config for documentation and test reference
 * Actual defaults are controlled by zod default() in config.schema.ts
 */
export const CONFIG_DEFAULTS: AutomationConfig = {
  cli: {
    cliPath: 'claude',
    projectDir: '.',
    maxConcurrentProcesses: 3,
  },
  worker: {
    defaultMaxTurns: 25,
    defaultTimeout: 600_000,
  },
  evaluator: {
    dimensions: ['quality'],
    maxTurns: 3,
    parseRetries: 2,
  },
  messenger: {
    maxTurns: 2,
    summarizeThreshold: 5000,
    fallbackToRaw: true,
  },
  conductor: {
    maxAttemptsPerPhase: 3,
    autoApproveThreshold: 80,
    escalateThreshold: 2,
    maxTurns: 1,
  },
  trigger: {
    type: 'manual',
  },
  pipeline: {
    mode: 'semi-auto',
    phases: ['analyze', 'design', 'implement', 'review', 'test'],
    budgetLimit: 50,
  },
  persistence: {
    stateDir: '.pipeline/state',
    logDir: '.pipeline/logs',
  },
  promptFramework: {
    type: 'ai-agents',
    rootDir: '.ai-agents',
  },
};
