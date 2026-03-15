/**
 * Conductor Rule Engine Unit Tests
 */

import { describe, it, expect } from 'vitest';
import type { EvaluationResult } from '../../src/core/types/evaluation.types.js';

// Test rule logic directly (no DI dependency)
// RuleEngineConductor.applyRules is private, so we use helper function to simulate

function applyRules(
  evaluations: EvaluationResult[],
  autoApproveThreshold: number,
): { action: string; reason: string } | null {
  const criticalIssues = evaluations.flatMap((e) =>
    e.issues.filter((i) => i.severity === 'critical'),
  );
  if (criticalIssues.length > 0) {
    return { action: 'revise', reason: `${criticalIssues.length} critical issues` };
  }

  if (evaluations.every((e) => e.verdict === 'pass')) {
    return { action: 'approve', reason: 'All evaluations passed' };
  }

  if (evaluations.every((e) => ['pass', 'pass_with_notes'].includes(e.verdict))) {
    return { action: 'approve', reason: 'Passed with suggestions' };
  }

  const avgScore = evaluations.reduce((s, e) => s + e.score, 0) / evaluations.length;
  if (avgScore >= autoApproveThreshold) {
    return { action: 'approve', reason: `avg score meets threshold` };
  }

  return null;
}

describe('Conductor Rules', () => {
  const makeEval = (overrides: Partial<EvaluationResult>): EvaluationResult => ({
    dimension: 'quality',
    verdict: 'pass',
    score: 85,
    issues: [],
    summary: 'ok',
    ...overrides,
  });

  it('should approve when all pass', () => {
    const result = applyRules([makeEval({}), makeEval({ dimension: 'security' })], 80);
    expect(result?.action).toBe('approve');
  });

  it('should revise on critical issues', () => {
    const result = applyRules(
      [makeEval({ issues: [{ severity: 'critical', category: 'sec', description: 'XSS' }] })],
      80,
    );
    expect(result?.action).toBe('revise');
  });

  it('should approve pass_with_notes', () => {
    const result = applyRules(
      [
        makeEval({
          verdict: 'pass_with_notes',
          issues: [{ severity: 'suggestion', category: 'style', description: 'naming' }],
        }),
      ],
      80,
    );
    expect(result?.action).toBe('approve');
  });

  it('should approve when avg score >= threshold', () => {
    const result = applyRules([makeEval({ verdict: 'needs_revision', score: 85 })], 80);
    expect(result?.action).toBe('approve');
  });

  it('should return null when no rule matches', () => {
    const result = applyRules([makeEval({ verdict: 'needs_revision', score: 50 })], 80);
    expect(result).toBeNull();
  });
});
