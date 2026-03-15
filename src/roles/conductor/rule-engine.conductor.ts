/**
 * Rule Engine Conductor - Rule-first + LLM fallback decision maker
 * @module roles/conductor/rule-engine-conductor
 */

import { inject, injectable } from 'tsyringe';
import type { IConductor } from '../../core/interfaces/conductor.interface.js';
import type { EvaluationResult } from '../../core/types/evaluation.types.js';
import type { ConductorDecision } from '../../core/types/conductor.types.js';
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
import { ROLE_PERMISSIONS } from '../../core/constants/permissions.js';

@injectable()
export class RuleEngineConductor implements IConductor {
  constructor(
    @inject(PROCESS_POOL_TOKEN) private processPool: CliProcessPool,
    @inject(OUTPUT_PARSER_TOKEN) private outputParser: CliOutputParser,
    @inject(CONFIG_TOKEN) private config: AutomationConfig,
    @inject(LOGGER_TOKEN) private logger: Logger,
  ) {}

  async decide(evaluations: EvaluationResult[]): Promise<ConductorDecision> {
    // Phase 1: Fast decision via rule engine
    const ruleDecision = this.applyRules(evaluations);
    if (ruleDecision) {
      this.logger.info({ action: ruleDecision.action }, 'Conductor decided by rules');
      return ruleDecision;
    }

    // Phase 2: CLI LLM fallback (handles ambiguous scenarios rules can't cover)
    this.logger.info('Conductor falling back to LLM');
    return this.llmDecide(evaluations);
  }

  /**
   * Rule engine: match rules by priority
   * 1. Has critical issues → revise
   * 2. All pass → approve
   * 3. All pass or pass_with_notes → approve (with suggestions)
   * 4. Average score ≥ threshold → approve
   * 5. No match → null (delegate to LLM)
   */
  private applyRules(evaluations: EvaluationResult[]): ConductorDecision | null {
    // Rule 1: Critical issues exist
    const criticalIssues = evaluations.flatMap((e) =>
      e.issues.filter((i) => i.severity === 'critical'),
    );
    if (criticalIssues.length > 0) {
      return {
        action: 'revise',
        reason: `Found ${criticalIssues.length} critical issues`,
        feedback: criticalIssues.map(
          (i) => `[${i.category}] ${i.description}${i.suggestion ? `: ${i.suggestion}` : ''}`,
        ),
        priority: 'critical',
      };
    }

    // Rule 2: All passed
    if (evaluations.every((e) => e.verdict === 'pass')) {
      return { action: 'approve', reason: 'All evaluations passed' };
    }

    // Rule 3: Pass with suggestions
    if (evaluations.every((e) => ['pass', 'pass_with_notes'].includes(e.verdict))) {
      const notes = evaluations.flatMap((e) => e.issues.filter((i) => i.severity === 'suggestion'));
      return { action: 'approve', reason: 'Passed with suggestions', notes };
    }

    // Rule 4: Average score above threshold
    const avgScore = evaluations.reduce((s, e) => s + e.score, 0) / evaluations.length;
    if (avgScore >= this.config.conductor.autoApproveThreshold) {
      return {
        action: 'approve',
        reason: `Average score ${avgScore.toFixed(0)} >= threshold ${this.config.conductor.autoApproveThreshold}`,
      };
    }

    return null; // Delegate to LLM
  }

  /** LLM fallback decision */
  private async llmDecide(evaluations: EvaluationResult[]): Promise<ConductorDecision> {
    const permissions = ROLE_PERMISSIONS.conductor;

    const result = await this.processPool.execute({
      prompt: [
        'Please analyze the following evaluation results and make a decision.',
        '',
        'Evaluation results:',
        JSON.stringify(evaluations, null, 2),
        '',
        'Output JSON:',
        '```json',
        '{"action":"approve|revise|escalate","reason":"...","feedback":["..."],"priority":"critical|normal"}',
        '```',
      ].join('\n'),
      systemPrompt:
        'You are a decision coordinator. Make comprehensive decisions based on multiple evaluation results. Analyze conflicts, weigh pros and cons, and provide clear action recommendations. Output must be in JSON format.',
      disallowedTools: permissions.disallowed,
      maxTurns: this.config.conductor.maxTurns,
      outputFormat: 'json',
    });

    try {
      return this.outputParser.extractJson<ConductorDecision>(result);
    } catch {
      // Final fallback when LLM parsing also fails
      this.logger.warn('LLM decision parse failed, defaulting to revise');
      return {
        action: 'revise',
        reason: 'Unable to make automatic decision, recommend revision and re-evaluation',
        priority: 'normal',
      };
    }
  }
}
