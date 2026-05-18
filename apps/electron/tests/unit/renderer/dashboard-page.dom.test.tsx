// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderWithProviders } from './render-with-providers';
import { installMockCapibaraApi, type MockCapibaraApiController } from './mock-capibara-api';
import type {
  OrganizationRecord,
  TaskRecord,
  RunRecord,
  RoleRecord,
} from '@core/shared/types';

function org(): OrganizationRecord {
  return {
    id: 'org-1',
    name: 'Acme',
    description: '',
    customInstructions: '',
    status: 'active',
    autoStartOnCreate: true,
    orgTemplateId: null,
    planningRoleId: null,
    workspacePath: '/tmp',
    createdAt: '',
    updatedAt: '',
  };
}

function task(id: string, status: string): TaskRecord {
  return {
    id, orgId: 'org-1', parentId: null, type: 'task', title: `Task ${id}`,
    description: '', status, assigneeRoleId: 'role-1', depth: 0, artifactPaths: null,
    createdAt: '', updatedAt: '',
  };
}

function run(id: string, status: RunRecord['status']): RunRecord {
  return {
    id, orgId: 'org-1', taskId: 't', conversationId: null, roleId: 'role-1',
    status, wakeReason: 'task_assigned', startedAt: null, finishedAt: null,
    costUsd: 0, tokenCount: 0, summary: null, errorMessage: null, createdAt: '',
  };
}

function role(id: string, overrides?: Partial<RoleRecord>): RoleRecord {
  return {
    id, orgId: 'org-1', name: `Role ${id}`, parentId: null, persona: '',
    knowledgeBaseRefs: [], skillIds: [], canApprove: false, canDelegate: false,
    requiresHumanApproval: false, consecutiveWakeCount: 0, isSystemRole: false,
    status: 'active', createdAt: '', updatedAt: '', ...overrides,
  };
}

describe('<DashboardPage /> (DOM smoke)', () => {
  let controller: MockCapibaraApiController;

  beforeEach(async () => {
    vi.resetModules();
    controller = installMockCapibaraApi();
    vi.mocked(controller.api.getOrganizations).mockResolvedValue({ ok: true, data: [org()] });
  });

  async function mount() {
    const { DashboardPage } = await import('@renderer/components/dashboard/DashboardPage');
    const { useAppStore } = await import('@renderer/store/app.store');
    // Seed the app store so the Dashboard finds the org it needs.
    await useAppStore.getState().loadOrganizations();
    return renderWithProviders(<DashboardPage orgId="org-1" />, { controller });
  }

  it('shows a getting-started narrative when the org has no activity', async () => {
    vi.mocked(controller.api.getTasksByOrgId).mockResolvedValue({ ok: true, data: [] });
    vi.mocked(controller.api.getRunsByOrgId).mockResolvedValue({ ok: true, data: [] });
    vi.mocked(controller.api.getActiveConversations).mockResolvedValue({ ok: true, data: [] });
    vi.mocked(controller.api.getRolesByOrgId).mockResolvedValue({ ok: true, data: [] });

    const { findByText } = await mount();

    expect(await findByText(/ready to start/)).toBeInTheDocument();
  });

  it('reports active tasks in the headline when work is in progress', async () => {
    vi.mocked(controller.api.getTasksByOrgId).mockResolvedValue({
      ok: true,
      data: [task('1', 'in_progress'), task('2', 'in_progress')],
    });
    vi.mocked(controller.api.getRunsByOrgId).mockResolvedValue({ ok: true, data: [] });
    vi.mocked(controller.api.getActiveConversations).mockResolvedValue({ ok: true, data: [] });
    vi.mocked(controller.api.getRolesByOrgId).mockResolvedValue({ ok: true, data: [role('r1')] });

    const { findByText } = await mount();

    expect(await findByText(/task\(s\) progressing/)).toBeInTheDocument();
  });

  it('renders the four stat cards', async () => {
    vi.mocked(controller.api.getTasksByOrgId).mockResolvedValue({
      ok: true, data: [task('1', 'in_progress')],
    });
    vi.mocked(controller.api.getRunsByOrgId).mockResolvedValue({
      ok: true, data: [run('r1', 'running')],
    });
    vi.mocked(controller.api.getActiveConversations).mockResolvedValue({ ok: true, data: [] });
    vi.mocked(controller.api.getRolesByOrgId).mockResolvedValue({ ok: true, data: [role('r1'), role('sys', { isSystemRole: true })] });

    const { findByText } = await mount();

    expect(await findByText('Active Tasks')).toBeInTheDocument();
    expect(await findByText('AI Roles')).toBeInTheDocument();
    expect(await findByText('Active Conversations')).toBeInTheDocument();
    expect(await findByText('Active Runs')).toBeInTheDocument();
  });
});
