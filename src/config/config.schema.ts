/**
 * Zod Configuration Validation Schema - Defines validation rules and default values for all config items
 * @module config/config-schema
 */

import { z } from 'zod';

const cliSchema = z.object({
  cliPath: z.string().default('claude'),
  projectDir: z.string(),
  maxConcurrentProcesses: z.number().int().min(1).max(10).default(3),
});

const workerSchema = z.object({
  defaultMaxTurns: z.number().int().min(1).default(25),
  defaultTimeout: z.number().int().min(10_000).default(600_000), // 10 min
});

const evaluatorSchema = z.object({
  dimensions: z.array(z.enum(['quality', 'security', 'consistency'])).default(['quality']),
  maxTurns: z.number().int().default(3),
  parseRetries: z.number().int().default(2),
});

const messengerSchema = z.object({
  maxTurns: z.number().int().default(2),
  summarizeThreshold: z.number().int().default(5000),
  fallbackToRaw: z.boolean().default(true),
});

const conductorSchema = z.object({
  maxAttemptsPerPhase: z.number().int().min(1).default(3),
  autoApproveThreshold: z.number().min(0).max(100).default(80),
  escalateThreshold: z.number().int().default(2),
  maxTurns: z.number().int().default(1),
});

const githubTriggerSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  labels: z.array(z.string()).default(['auto-dev']),
  pollInterval: z.number().int().min(10).default(60),
  token: z.string(),
});

const triggerSchema = z.object({
  type: z.enum(['github_issues', 'manual']).default('manual'),
  github: githubTriggerSchema.optional(),
});

const pipelineSchema = z.object({
  mode: z.enum(['auto', 'semi-auto', 'manual']).default('semi-auto'),
  phases: z
    .array(z.enum(['analyze', 'design', 'implement', 'review', 'test']))
    .default(['analyze', 'design', 'implement', 'review', 'test']),
  budgetLimit: z.number().min(0).default(50),
});

const persistenceSchema = z.object({
  stateDir: z.string().default('.pipeline/state'),
  logDir: z.string().default('.pipeline/logs'),
});

const promptFrameworkSchema = z.object({
  type: z.string().default('ai-agents'),
  rootDir: z.string().optional(),
  customModule: z.string().optional(),
  options: z.record(z.unknown()).optional(),
});

/** Complete automation config Schema */
export const automationConfigSchema = z.object({
  cli: cliSchema,
  worker: workerSchema.default({}),
  evaluator: evaluatorSchema.default({}),
  messenger: messengerSchema.default({}),
  conductor: conductorSchema.default({}),
  trigger: triggerSchema.default({}),
  pipeline: pipelineSchema.default({}),
  persistence: persistenceSchema.default({}),
  promptFramework: promptFrameworkSchema.default({}),
});

/** Config input type (allows using default values) */
export type AutomationConfigInput = z.input<typeof automationConfigSchema>;
