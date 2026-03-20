/**
 * MVTT Conductor Implementation
 *
 * Retains "rule engine first + LLM fallback" decision pattern.
 * LLM calls go through ICommandExecutor, no direct CLI dependency.
 * @module implementations/mvtt/mvtt-conductor
 */

import type { IConductor } from '../../core/interfaces/conductor.interface.js';
import type { ICommandExecutor } from '../../core/interfaces/command-executor.interface.js';
import type { EvaluationResult } from '../../core/types/evaluation.types.js';
import type { ConductorDecision } from '../../core/types/conductor.types.js';
import type { MvttOutputParser } from './mvtt-output-parser.js';
import type { AutomationConfig } from '../../core/types/config.types.js';
import type { Logger } from 'pino';
import { ROLE_PERMISSIONS } from '../../core/constants/permissions.js';

export class MvttConductor implements IConductor {
  constructor(
    private executor: ICommandExecutor,
    private outputParser: MvttOutputParser,
    private config: AutomationConfig,
    private logger: Logger,
  ) {}

  async decide(evaluations: EvaluationResult[]): Promise<ConductorDecision> {
    const ruleDecision = this.applyRules(evaluations);
    if (ruleDecision) {
      this.logger.info({ action: ruleDecision.action }, 'Conductor decided by rules');
      return ruleDecision;
    }

    this.logger.info('Conductor falling back to LLM');
    return this.llmDecide(evaluations);
  }

  /**
   * Rule engine: match rules by priority
   * 1. Has critical issues -> revise
   * 2. All pass -> approve
   * 3. All pass or pass_with_notes -> approve (with suggestions)
   * 4. Average score >= threshold -> approve
   * 5. No match -> null (delegate to LLM)
   */
  private applyRules(evaluations: EvaluationResult[]): ConductorDecision | null {
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

    if (evaluations.every((e) => e.verdict === 'pass')) {
      return { action: 'approve', reason: 'All evaluations passed' };
    }

    if (evaluations.every((e) => ['pass', 'pass_with_notes'].includes(e.verdict))) {
      const notes = evaluations.flatMap((e) => e.issues.filter((i) => i.severity === 'suggestion'));
      return { action: 'approve', reason: 'Passed with suggestions', notes };
    }

    const avgScore = evaluations.reduce((s, e) => s + e.score, 0) / evaluations.length;
    if (avgScore >= this.config.conductor.autoApproveThreshold) {
      return {
        action: 'approve',
        reason: `Average score ${avgScore.toFixed(0)} >= threshold ${this.config.conductor.autoApproveThreshold}`,
      };
    }

    return null;
  }

  private async llmDecide(evaluations: EvaluationResult[]): Promise<ConductorDecision> {
    const permissions = ROLE_PERMISSIONS.conductor;

    const response = await this.executor.execute({
      input: [
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
      options: {
        disallowedTools: permissions.disallowed,
        maxTurns: this.config.conductor.maxTurns,
        outputFormat: 'json',
      },
    });

    return this.outputParser.parseConductorDecision(response);
  }
}
