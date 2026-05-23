import type { CreateOrganizationInput, CreateRoleInput, CreateSkillInput } from '@core/modules/organization/types/organization.types';
import type { CreateRunInput, RunExecutionParams } from '@core/modules/execution/types/execution.types';
import type { CapibaraConfig } from '@core/config/config.types';

export const TEST_ORG_ID = 'org-test-1';
export const TEST_ROLE_ID = 'role-test-1';
export const TEST_TASK_ID = 'task-test-1';

export function createOrgInput(overrides?: Partial<CreateOrganizationInput>): CreateOrganizationInput {
  return {
    name: 'Test Organization',
    description: 'A test org',
    customInstructions: '',
    orgTemplateId: null,
    workspacePath: '/tmp/test',
    ...overrides,
  };
}

export function createRoleInput(orgId: string, overrides?: Partial<CreateRoleInput>): CreateRoleInput {
  return {
    orgId,
    name: 'Test Role',
    parentId: null,
    persona: 'A helpful assistant',
    knowledgeBaseRefs: [],
    skillIds: [],
    canApprove: false,
    canDelegate: false,
    requiresHumanApproval: false,
    ...overrides,
  };
}

export function createSkillInput(overrides?: Partial<CreateSkillInput>): CreateSkillInput {
  return {
    name: 'Test Skill',
    command: '/test-skill',
    description: 'A test skill',
    category: 'general',
    source: 'custom',
    orgTemplateId: null,
    customPromptContent: null,
    ...overrides,
  };
}

export function createRunInput(overrides?: Partial<CreateRunInput>): CreateRunInput {
  return {
    orgId: TEST_ORG_ID,
    taskId: TEST_TASK_ID,
    conversationId: null,
    roleId: TEST_ROLE_ID,
    wakeReason: 'task_assigned',
    ...overrides,
  };
}

export function createRunExecutionParams(overrides?: Partial<RunExecutionParams>): RunExecutionParams {
  return {
    roleId: TEST_ROLE_ID,
    orgId: TEST_ORG_ID,
    prompt: 'Test prompt for AI execution',
    contextId: 'ctx-1',
    contextLabel: 'test',
    taskId: TEST_TASK_ID,
    wakeReason: 'task_assigned',
    ...overrides,
  };
}

export function createTestConfig(overrides?: Partial<CapibaraConfig>): CapibaraConfig {
  return {
    organization: { template: 'default', customFile: null },
    execution: {
      maxReviseAttempts: 3,
      maxRetryOnFailure: 3,
      maxConsecutiveWakes: 10,
      maxDecompositionDepth: 4,
      retryBackoffMs: 5000,
    },
    skills: { provider: 'bmad', bmadRoot: '' },
    database: { driver: 'sqlite', sqlitePath: ':memory:' },
    cli: {
      defaultExecutor: 'claude-agent',
      projectDir: '/tmp/project',
      model: 'sonnet',
      maxTurnsPerRun: 5,
      effort: 'medium',
      timeoutMs: 60000,
      extraArgs: [],
    },
    logging: { level: 'info', logDir: '/tmp/logs' },
    ...overrides,
  };
}
