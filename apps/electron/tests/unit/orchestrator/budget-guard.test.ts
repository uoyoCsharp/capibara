import { describe, it, expect, beforeEach } from 'vitest';
import { BudgetGuard } from '@core/modules/orchestrator/budget.guard';
import { createTestConfig, TEST_ORG_ID } from '../../helpers/fixtures';
import type { CostTracker } from '@core/modules/execution/services/cost-tracker';

describe('BudgetGuard', () => {
  let guard: BudgetGuard;
  let costTracker: CostTracker;
  let config: ReturnType<typeof createTestConfig>;

  beforeEach(() => {
    costTracker = {
      getBudgetUsage: vi.fn().mockReturnValue({ totalCost: 0, totalTokens: 0 }),
      recordCost: vi.fn(),
    } as unknown as CostTracker;
    config = createTestConfig();
    guard = new BudgetGuard(costTracker, config);
  });

  it('reports within budget when cost is below limit', () => {
    vi.mocked(costTracker.getBudgetUsage).mockReturnValue({ totalCost: 50, totalTokens: 1000 });
    const result = guard.check(TEST_ORG_ID);
    expect(result.withinBudget).toBe(true);
    expect(result.totalCost).toBe(50);
    expect(result.limit).toBe(100);
  });

  it('reports over budget when cost meets limit', () => {
    vi.mocked(costTracker.getBudgetUsage).mockReturnValue({ totalCost: 100, totalTokens: 5000 });
    const result = guard.check(TEST_ORG_ID);
    expect(result.withinBudget).toBe(false);
  });

  it('reports over budget when cost exceeds limit', () => {
    vi.mocked(costTracker.getBudgetUsage).mockReturnValue({ totalCost: 150, totalTokens: 8000 });
    const result = guard.check(TEST_ORG_ID);
    expect(result.withinBudget).toBe(false);
    expect(result.totalCost).toBe(150);
  });

  it('always within budget when limit is 0 (disabled)', () => {
    config.execution.budgetLimit = 0;
    vi.mocked(costTracker.getBudgetUsage).mockReturnValue({ totalCost: 9999, totalTokens: 0 });
    const result = guard.check(TEST_ORG_ID);
    expect(result.withinBudget).toBe(true);
    expect(result.limit).toBe(0);
  });

  it('within budget at cost just below limit', () => {
    vi.mocked(costTracker.getBudgetUsage).mockReturnValue({ totalCost: 99.99, totalTokens: 0 });
    const result = guard.check(TEST_ORG_ID);
    expect(result.withinBudget).toBe(true);
  });
});
