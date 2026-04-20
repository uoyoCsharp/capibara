import { describe, it, expect, beforeEach } from 'vitest';
import { WakeGateValidator } from '@core/modules/orchestrator/wake-gate.validator';
import { MockLogger } from '../../helpers/mock-logger';
import { createTestConfig, TEST_ORG_ID, TEST_ROLE_ID } from '../../helpers/fixtures';
import type { IRoleRepository } from '@core/modules/organization/interfaces/i-role.repository';
import type { IRunRepository } from '@core/modules/execution/interfaces/i-run.repository';
import type { CostTracker } from '@core/modules/execution/services/cost-tracker';
import type { Role } from '@core/modules/organization/types/organization.types';

function createRole(overrides?: Partial<Role>): Role {
  return {
    id: TEST_ROLE_ID,
    orgId: TEST_ORG_ID,
    name: 'Dev',
    parentId: null,
    persona: '',
    knowledgeBaseRefs: [],
    skillIds: [],
    canApprove: false,
    canDelegate: false,
    requiresHumanApproval: false,
    consecutiveWakeCount: 0,
    isSystemRole: false,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('WakeGateValidator', () => {
  let validator: WakeGateValidator;
  let roleRepo: IRoleRepository;
  let runRepo: IRunRepository;
  let costTracker: CostTracker;
  let config: ReturnType<typeof createTestConfig>;
  let logger: MockLogger;

  beforeEach(() => {
    roleRepo = {
      findById: vi.fn().mockReturnValue(createRole()),
      findByIds: vi.fn(),
      findByOrgId: vi.fn(),
      findChildren: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    runRepo = {
      findById: vi.fn(),
      findByOrgId: vi.fn(),
      findActiveByOrgId: vi.fn().mockReturnValue(null),
      create: vi.fn(),
      updateStatus: vi.fn(),
      finish: vi.fn(),
    } as unknown as IRunRepository;
    costTracker = {
      getBudgetUsage: vi.fn().mockReturnValue({ totalCost: 0, totalTokens: 0 }),
      recordCost: vi.fn(),
    } as unknown as CostTracker;
    config = createTestConfig();
    logger = new MockLogger();

    validator = new WakeGateValidator(
      roleRepo,
      runRepo,
      costTracker,
      config,
      logger,
    );
  });

  it('allows wake when all gates pass', () => {
    const result = validator.validate(TEST_ROLE_ID, TEST_ORG_ID);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('blocks when role not found', () => {
    vi.mocked(roleRepo.findById).mockReturnValue(null);
    const result = validator.validate('nonexistent', TEST_ORG_ID);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Role not found');
  });

  it('blocks when role is paused', () => {
    vi.mocked(roleRepo.findById).mockReturnValue(createRole({ status: 'paused' }));
    const result = validator.validate(TEST_ROLE_ID, TEST_ORG_ID);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Role is paused');
  });

  it('blocks when active run exists', () => {
    vi.mocked(runRepo.findActiveByOrgId).mockReturnValue({ id: 'run-active' } as any);
    const result = validator.validate(TEST_ROLE_ID, TEST_ORG_ID);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Active run exists');
  });

  it('blocks when budget exceeded', () => {
    vi.mocked(costTracker.getBudgetUsage).mockReturnValue({ totalCost: 200, totalTokens: 5000 });
    const result = validator.validate(TEST_ROLE_ID, TEST_ORG_ID);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Budget exceeded');
  });

  it('allows when budget limit is 0 (disabled)', () => {
    config.execution.budgetLimit = 0;
    vi.mocked(costTracker.getBudgetUsage).mockReturnValue({ totalCost: 9999, totalTokens: 0 });
    const result = validator.validate(TEST_ROLE_ID, TEST_ORG_ID);
    expect(result.allowed).toBe(true);
  });

  it('blocks when circuit breaker triggered (max consecutive wakes)', () => {
    vi.mocked(roleRepo.findById).mockReturnValue(createRole({ consecutiveWakeCount: 10 }));
    const result = validator.validate(TEST_ROLE_ID, TEST_ORG_ID);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Circuit breaker');
  });

  it('allows when consecutive wakes below limit', () => {
    vi.mocked(roleRepo.findById).mockReturnValue(createRole({ consecutiveWakeCount: 9 }));
    const result = validator.validate(TEST_ROLE_ID, TEST_ORG_ID);
    expect(result.allowed).toBe(true);
  });
});
