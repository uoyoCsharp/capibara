/**
 * MVTT Evaluator Implementation
 *
 * Evaluates Worker artifacts via LLM and returns plain text assessment.
 * No structured parsing — raw LLM response is passed to Messenger for synthesis.
 * @module implementations/mvtt/mvtt-evaluator
 */

import type { IEvaluator } from '../../core/interfaces/evaluator.interface.js';
import type { ICommandExecutor } from '../../core/interfaces/command-executor.interface.js';
import type { EvaluationContext } from '../../core/types/evaluation.types.js';
import type { AutomationConfig } from '../../core/types/config.types.js';
import type { Logger } from 'pino';
import { ROLE_PERMISSIONS } from '../../core/constants/permissions.js';

const EVALUATOR_SYSTEM_PROMPT = `You are an expert code and design reviewer. Your task is to evaluate the provided artifact thoroughly.

Rules:
1. Identify any issues, risks, or areas of concern
2. Note positive aspects and strengths
3. Provide clear, actionable feedback
4. Be specific — reference concrete parts of the artifact
5. Output your evaluation as plain text (not JSON)`;

export class MvttEvaluator implements IEvaluator {
  constructor(
    private executor: ICommandExecutor,
    private config: AutomationConfig,
    private logger: Logger,
  ) {}

  async evaluate(artifact: string, context: EvaluationContext): Promise<string> {
    this.logger.info({ phase: context.phase }, 'MvttEvaluator starting');

    const response = await this.executor.execute({
      input: `Please evaluate the following artifact from the "${context.phase}" phase:\n\n${artifact}`,
      systemPrompt: EVALUATOR_SYSTEM_PROMPT,
      cwd: context.projectDir,
      timeout: this.config.worker.defaultTimeout,
      options: {
        disallowedTools: ROLE_PERMISSIONS.evaluator.disallowed,
        maxTurns: this.config.evaluator.maxTurns,
      },
    });

    this.logger.info(
      { phase: context.phase, outputLength: response.output.length },
      'MvttEvaluator completed',
    );
    return response.output;
  }
}
