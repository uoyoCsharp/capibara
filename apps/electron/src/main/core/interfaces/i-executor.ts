export interface ExecutorInput {
  runId: string;
  prompt: string;
  mcpConfigPath: string;
  projectDir: string;
  executor: string;
}

export interface ExecutorOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface IExecutor {
  execute(input: ExecutorInput): Promise<ExecutorOutput>;
  abort(runId: string): void;
}
