import type { CapibaraConfig } from './config.types';

export const DEFAULT_CONFIG: CapibaraConfig = {
  organization: {
    template: 'software-team',
    customFile: null,
  },
  execution: {
    maxReviseAttempts: 3,
    maxRetryOnFailure: 3,
    maxConsecutiveWakes: 5,
    maxDecompositionDepth: 4,
    retryBackoffMs: 2000,
  },
  skills: {
    provider: 'bmad',
    bmadRoot: './_bmad',
  },
  database: {
    driver: 'sqlite',
    sqlitePath: '',
  },
  cli: {
    defaultExecutor: 'claude-agent',
    projectDir: './',
    model: null,
    maxTurnsPerRun: 0,
    effort: 'medium',
    timeoutMs: 0,
    extraArgs: [],
  },
  logging: {
    level: 'info',
    logDir: '',
  },
  collaboration: {
    maxChainDepth: 5,
    maxBroadcastTargets: 5,
    maxResumeCount: 10,
    inquiryTimeoutMs: 300_000,
  },
};
