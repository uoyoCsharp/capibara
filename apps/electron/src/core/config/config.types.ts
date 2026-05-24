export interface CapibaraConfig {
  organization: {
    template: string;
    customFile: string | null;
  };
  execution: {
    maxReviseAttempts: number;
    maxRetryOnFailure: number;
    maxConsecutiveWakes: number;
    maxDecompositionDepth: number;
    retryBackoffMs: number;
    maxTurnsPerRun: number;
  };
  skills: {
    provider: string;
    bmadRoot: string;
  };
  database: {
    driver: 'sqlite';
    sqlitePath: string;
  };
  agents: {
    defaultAgent: string;
  };
  logging: {
    level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
    logDir: string;
  };
  collaboration: {
    maxChainDepth: number;
    maxBroadcastTargets: number;
    maxResumeCount: number;
    inquiryTimeoutMs: number;
  };
}
