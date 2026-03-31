import { z } from 'zod';

export const configSchema = z.object({
  organization: z.object({
    template: z.string().default('software-team'),
    customFile: z.string().nullable().default(null),
  }).default({}),
  execution: z.object({
    maxReviseAttempts: z.number().int().min(1).default(3),
    maxRetryOnFailure: z.number().int().min(1).default(3),
    maxConsecutiveWakes: z.number().int().min(1).default(5),
    budgetLimit: z.number().min(0).default(50.0),
    maxDecompositionDepth: z.number().int().min(1).max(10).default(4),
  }).default({}),
  skills: z.object({
    provider: z.string().default('bmad'),
    bmadRoot: z.string().default('./_bmad'),
  }).default({}),
  database: z.object({
    driver: z.literal('sqlite').default('sqlite'),
    sqlitePath: z.string().default(''),
  }).default({}),
  cli: z.object({
    defaultExecutor: z.string().default('claude-cli'),
    projectDir: z.string().default('./'),
  }).default({}),
  logging: z.object({
    level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  }).default({}),
});

export type ValidatedConfig = z.infer<typeof configSchema>;
