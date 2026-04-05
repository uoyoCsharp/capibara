export interface CapibaraConfig {
  organization: {
    template: string;
    customFile: string | null;
  };
  execution: {
    /** Maximum review-revise cycles before escalation */
    maxReviseAttempts: number;
    /** Maximum retry attempts on run failure before escalating to parent */
    maxRetryOnFailure: number;
    /** Circuit breaker threshold — max consecutive wakes before pausing a role */
    maxConsecutiveWakes: number;
    /** Organization token budget in millions of tokens (0 = unlimited) */
    budgetLimit: number;
    /** Maximum task decomposition tree depth to prevent runaway nesting */
    maxDecompositionDepth: number;
    /** Base retry backoff in milliseconds (doubles with each retry) */
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
    logDir: string;
  };
}
