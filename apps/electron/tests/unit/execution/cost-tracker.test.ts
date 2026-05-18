import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CostTracker } from '@core/modules/execution/services/cost-tracker';
import type { ICostEntryRepository } from '@core/modules/execution/interfaces/i-cost-entry.repository';

describe('CostTracker', () => {
  let tracker: CostTracker;
  let repo: ICostEntryRepository;

  beforeEach(() => {
    repo = {
      create: vi.fn().mockReturnValue({ id: 'cost-1', runId: 'run-1', roleId: 'role-1', orgId: 'org-1', tokenCount: 100, costUsd: 0.01, createdAt: '' }),
      findByRunId: vi.fn().mockReturnValue([]),
      findByOrgId: vi.fn().mockReturnValue([]),
      getTotalTokensByOrgId: vi.fn().mockReturnValue(5000),
      getTotalCostByOrgId: vi.fn().mockReturnValue(1.5),
    };
    tracker = new CostTracker(repo);
  });

  describe('recordCost', () => {
    it('creates cost entry when tokenCount > 0', () => {
      tracker.recordCost('run-1', 'role-1', 'org-1', 1500, 0.015);

      expect(repo.create).toHaveBeenCalledWith({
        runId: 'run-1',
        roleId: 'role-1',
        orgId: 'org-1',
        tokenCount: 1500,
        costUsd: 0.015,
      });
    });

    it('skips creation when tokenCount is 0', () => {
      tracker.recordCost('run-1', 'role-1', 'org-1', 0, 0);

      expect(repo.create).not.toHaveBeenCalled();
    });

    it('skips creation when tokenCount is negative', () => {
      tracker.recordCost('run-1', 'role-1', 'org-1', -100, 0);

      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('getCostUsage', () => {
    it('returns aggregated tokens and cost for org', () => {
      const usage = tracker.getCostUsage('org-1');

      expect(usage.totalTokens).toBe(5000);
      expect(usage.totalCost).toBe(1.5);
      expect(repo.getTotalTokensByOrgId).toHaveBeenCalledWith('org-1');
      expect(repo.getTotalCostByOrgId).toHaveBeenCalledWith('org-1');
    });
  });
});
