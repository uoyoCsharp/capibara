/**
 * MVTT Quality Evaluator
 * @module implementations/mvtt/mvtt-quality-evaluator
 */

import type { EvaluationDimension } from '../../core/types/evaluation.types.js';
import type { ICommandExecutor } from '../../core/interfaces/command-executor.interface.js';
import type { MvttOutputParser } from './mvtt-output-parser.js';
import type { AutomationConfig } from '../../core/types/config.types.js';
import type { Logger } from 'pino';
import { MvttEvaluator } from './mvtt-evaluator.js';

export class MvttQualityEvaluator extends MvttEvaluator {
  protected readonly dimension: EvaluationDimension = 'quality';

  constructor(
    executor: ICommandExecutor,
    outputParser: MvttOutputParser,
    config: AutomationConfig,
    logger: Logger,
  ) {
    super(executor, outputParser, config, logger);
  }

  protected buildSystemPrompt(): string {
    return `You are a code quality evaluation expert. Focus on: code design rationality, readability, maintainability, pattern adherence.

Rules:
1. Only evaluate, never modify any files
2. You can use Read tool to read project files to verify artifact authenticity
3. Output must be in the following JSON format (using \`\`\`json code block):
\`\`\`json
{
  "verdict": "pass|pass_with_notes|needs_revision|critical_issues",
  "score": 0-100,
  "issues": [{"severity": "critical|major|minor|suggestion", "category": "...", "description": "...", "suggestion": "..."}],
  "summary": "One-line summary"
}
\`\`\``;
  }
}
