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
    maxDecompositionDepth: z.number().int().min(1).max(10).default(4),
    retryBackoffMs: z.number().int().min(100).default(2000),
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
    model: z.string().nullable().default(null),
    maxTurnsPerRun: z.number().int().min(0).default(0),
    effort: z.enum(['low', 'medium', 'high']).default('medium'),
    timeoutMs: z.number().int().min(0).default(0),
    extraArgs: z.array(z.string()).default([]),
  }).default({}),
  logging: z.object({
    level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    logDir: z.string().default(''),
  }).default({}),
  collaboration: z.object({
    maxChainDepth: z.number().int().min(1).max(20).default(5),
    maxBroadcastTargets: z.number().int().min(1).max(20).default(5),
    maxResumeCount: z.number().int().min(1).max(100).default(10),
    inquiryTimeoutMs: z.number().int().min(10_000).default(300_000),
  }).default({}),
});

export type ValidatedConfig = z.infer<typeof configSchema>;
