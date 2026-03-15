/**
 * CLI Output Parser - Multi-strategy extraction of structured data from CLI output
 * @module infrastructure/cli-adapter/output-parser
 */

import { injectable, inject } from 'tsyringe';
import { LOGGER_TOKEN } from '../../tokens.js';
import type { Logger } from 'pino';
import type { ClaudeCliResult, ClaudeCliJsonOutput } from '../../core/types/cli.types.js';
import { CliParseError } from '../../core/errors/cli.errors.js';

@injectable()
export class CliOutputParser {
  constructor(@inject(LOGGER_TOKEN) private logger: Logger) {}

  /**
   * Parse CLI JSON output metadata
   * When CLI uses --output-format json, output conforms to ClaudeCliJsonOutput structure
   */
  parseCliMeta(raw: string): ClaudeCliJsonOutput {
    return JSON.parse(raw) as ClaudeCliJsonOutput;
  }

  /**
   * Multi-strategy extraction of structured JSON
   * Strategy order: JSON code block -> whole JSON -> result field JSON
   * @param cliResult CLI execution result
   * @param validator Optional type validation function
   */
  extractJson<T>(cliResult: ClaudeCliResult, validator?: (data: unknown) => data is T): T {
    const strategies = [
      () => this.tryJsonCodeBlock(cliResult.output),
      () => this.tryDirectParse(cliResult.output),
      () => this.tryResultFieldParse(cliResult.output),
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

    this.logger.warn({ output: cliResult.output.slice(0, 500) }, 'All parse strategies failed');
    throw new CliParseError('Failed to extract JSON from CLI output');
  }

  /** Strategy 1: Extract ```json ... ``` code block */
  private tryJsonCodeBlock(output: string): unknown | null {
    const match = output.match(/```json\n([\s\S]*?)\n```/);
    return match ? JSON.parse(match[1]) : null;
  }

  /** Strategy 2: Direct parse whole output */
  private tryDirectParse(output: string): unknown | null {
    const parsed = JSON.parse(output);
    // If CLI JSON output, recursively parse result field
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
