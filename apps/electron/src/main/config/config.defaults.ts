import type { CapibaraConfig } from '@main/core/types/config.types.js';

export const DEFAULT_CONFIG: CapibaraConfig = {
  organization: {
    template: 'software-team',
    customFile: null,
  },
  execution: {
    maxReviseAttempts: 3,
    maxRetryOnFailure: 3,
    maxConsecutiveWakes: 5,
    budgetLimit: 50.0,
    maxDecompositionDepth: 4,
  },
  skills: {
    provider: 'bmad',
    bmadRoot: './_bmad',
  },
  database: {
    driver: 'sqlite',
    sqlitePath: '',  // resolved at runtime: ~/.capibara/capibara.sqlite
  },
  cli: {
    defaultExecutor: 'claude-cli',
    projectDir: './',
  },
  logging: {
    level: 'info',
  },
};
