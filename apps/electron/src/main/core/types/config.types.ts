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
    /** Model override for CLI (e.g., 'claude-sonnet-4-6') */
    model: string | null;
    /** Maximum turns per run (0 = unlimited) */
    maxTurnsPerRun: number;
    /** Thinking effort level */
    effort: 'low' | 'medium' | 'high';
    /** Per-run timeout in milliseconds (0 = no timeout) */
    timeoutMs: number;
    /** Additional CLI args passed through verbatim */
    extraArgs: string[];
  };
  logging: {
    level: string;
  };
}
