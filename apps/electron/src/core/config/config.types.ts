export interface CapibaraConfig {
  organization: {
    template: string;
    customFile: string | null;
  };
  execution: {
    maxReviseAttempts: number;
    maxRetryOnFailure: number;
    maxConsecutiveWakes: number;
    budgetLimit: number;
    maxDecompositionDepth: number;
    retryBackoffMs: number;
  };
  skills: {
    provider: string;
    bmadRoot: string;
  };
  database: {
    driver: 'sqlite';
    sqlitePath: string;
  };
  cli: {
    defaultExecutor: string;
    projectDir: string;
    model: string | null;
    maxTurnsPerRun: number;
    effort: 'low' | 'medium' | 'high';
    timeoutMs: number;
    extraArgs: string[];
  };
  logging: {
    level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
    logDir: string;
  };
}
