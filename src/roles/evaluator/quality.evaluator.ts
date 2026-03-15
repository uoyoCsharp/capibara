/**
 * Code Quality Evaluator
 * @module roles/evaluator/quality-evaluator
 */

import { injectable, inject } from 'tsyringe';
import { ClaudeCliEvaluator } from './claude-cli.evaluator.js';
import type { EvaluationDimension } from '../../core/types/evaluation.types.js';
import {
  PROCESS_POOL_TOKEN,
  OUTPUT_PARSER_TOKEN,
  CONFIG_TOKEN,
  LOGGER_TOKEN,
} from '../../tokens.js';
import type { CliProcessPool } from '../../infrastructure/cli-adapter/process-pool.js';
import type { CliOutputParser } from '../../infrastructure/cli-adapter/output-parser.js';
import type { AutomationConfig } from '../../core/types/config.types.js';
import type { Logger } from 'pino';

@injectable()
export class QualityEvaluator extends ClaudeCliEvaluator {
  protected readonly dimension: EvaluationDimension = 'quality';

  constructor(
    @inject(PROCESS_POOL_TOKEN) processPool: CliProcessPool,
    @inject(OUTPUT_PARSER_TOKEN) outputParser: CliOutputParser,
    @inject(CONFIG_TOKEN) config: AutomationConfig,
    @inject(LOGGER_TOKEN) logger: Logger,
  ) {
    super(processPool, outputParser, config, logger);
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
