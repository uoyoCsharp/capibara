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
  };
  logging: {
    level: string;
  };
}
