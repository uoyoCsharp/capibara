/**
 * MVTT Output Parser - Extracts structured data from CLI/executor output
 *
 * Extracted from CliOutputParser, adapted to work with CommandResponse
 * instead of ClaudeCliResult.
 * @module implementations/mvtt/mvtt-output-parser
 */

import type { CommandResponse } from '../../core/types/command-executor.types.js';
import type { EvaluationResult, EvaluationDimension } from '../../core/types/evaluation.types.js';
import type { ConductorDecision } from '../../core/types/conductor.types.js';
import type { ClaudeCliJsonOutput } from '../../core/types/cli.types.js';
import type { Logger } from 'pino';

function isEvaluationOutput(data: unknown): data is Omit<EvaluationResult, 'dimension'> {
  return (
    typeof data === 'object' &&
    data !== null &&
    'verdict' in data &&
    'score' in data &&
    'issues' in data
  );
}

export class MvttOutputParser {
  constructor(private logger: Logger) {}

  /**
   * Multi-strategy extraction of structured JSON from executor output
   * Strategy order: JSON code block -> whole JSON -> result field JSON
   */
  extractJson<T>(response: CommandResponse, validator?: (data: unknown) => data is T): T {
    const strategies = [
      () => this.tryJsonCodeBlock(response.output),
      () => this.tryDirectParse(response.output),
      () => this.tryResultFieldParse(response.output),
    ];

    for (const strategy of strategies) {
      try {
        const parsed = strategy();
        if (parsed !== null) {
          if (validator && !validator(parsed)) continue;
          return parsed as T;
        }
      } catch {
        // Continue to next strategy
      }
    }

    this.logger.warn({ output: response.output.slice(0, 500) }, 'All parse strategies failed');
    throw new Error('Failed to extract JSON from executor output');
  }

  /** Parse evaluation result from executor response */
  parseEvaluationResult(response: CommandResponse, dimension: EvaluationDimension): EvaluationResult {
    try {
      const parsed = this.extractJson(response, isEvaluationOutput);
      return { ...parsed, dimension };
    } catch {
      this.logger.warn({ dimension }, 'Evaluation parse failed, returning fallback');
      return {
        dimension,
        verdict: 'needs_revision',
        score: 0,
        issues: [
          {
            severity: 'major',
            category: 'parse_error',
            description: 'Evaluation result parsing failed, requires manual review',
          },
        ],
        summary: 'Evaluation output format abnormal, cannot auto-parse',
      };
    }
  }

  /** Parse conductor decision from executor response */
  parseConductorDecision(response: CommandResponse): ConductorDecision {
    try {
      return this.extractJson<ConductorDecision>(response);
    } catch {
      this.logger.warn('Conductor decision parse failed, defaulting to revise');
      return {
        action: 'revise',
        reason: 'Unable to make automatic decision, recommend revision and re-evaluation',
        priority: 'normal',
      };
    }
  }

  /** Strategy 1: Extract ```json ... ``` code block */
  private tryJsonCodeBlock(output: string): unknown | null {
    const match = output.match(/```json\n([\s\S]*?)\n```/);
    return match ? JSON.parse(match[1]) : null;
  }

  /** Strategy 2: Direct parse whole output */
  private tryDirectParse(output: string): unknown | null {
    const parsed = JSON.parse(output);
    if (typeof parsed === 'object' && parsed !== null && 'result' in parsed) {
      return this.tryDirectParse((parsed as ClaudeCliJsonOutput).result);
    }
    return parsed;
  }

  /** Strategy 3: Parse JSON in CLI JSON's result field */
  private tryResultFieldParse(output: string): unknown | null {
    try {
      const meta = JSON.parse(output) as ClaudeCliJsonOutput;
      return JSON.parse(meta.result);
    } catch {
      return null;
    }
  }
}
