// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { installMockCapibaraApi, type MockCapibaraApiController } from './mock-capibara-api';
import type { ConversationRecord, PendingTreeRecord } from '@core/shared/types';

let ctrl: MockCapibaraApiController;
let InboxPage: typeof import('@renderer/components/inbox/InboxPage').InboxPage;

const PLAN_REVIEW_CONV: ConversationRecord = {
  id: 'conv-plan-1',
  orgId: 'org-1',
  type: 'plan_review',
  state: 'active',
  initiatorRoleId: 'role-cto',
  respondentRoleId: null,
  respondentType: 'human',
  taskId: null,
  parentConversationId: null,
  depth: 0,
  priority: 0,
  timeoutAt: null,
  externalSessionId: null,
  metadata: { rootTaskId: 'task-root', pendingPlanId: 'pt-1', currentVersion: 1 },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const PENDING_TREE: PendingTreeRecord = {
  id: 'pt-1',
  rootTaskId: 'task-root',
  orgId: 'org-1',
  roleId: 'role-cto',
  mode: 'preview',
  tree: {
    type: 'epic', title: 'Root Epic', description: 'Test', assigneeRoleId: 'role-cto',
    children: [
      { type: 'story', title: 'Story 1', description: 'S1', assigneeRoleId: 'role-dev', children: [] },
    ],
  },
  submittedAt: new Date().toISOString(),
  version: 1,
  status: 'active',
  pendingFeedback: null,
  conversationId: 'conv-plan-1',
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  reviewedAt: null,
};

describe('Inbox + Plan Review integration', () => {
  beforeEach(async () => {
    vi.resetModules();
    ctrl = installMockCapibaraApi();
    InboxPage = (await import('@renderer/components/inbox/InboxPage')).InboxPage;
  });

  afterEach(() => {
    cleanup();
  });

  it('INB-01: plan_review conversation appears in blocked section', async () => {
    vi.mocked(ctrl.api.getConversations).mockResolvedValue({
      ok: true,
      data: [PLAN_REVIEW_CONV],
    });
    vi.mocked(ctrl.api.getRolesByOrgId).mockResolvedValue({ ok: true, data: [] });

    render(<InboxPage orgId="org-1" />);

    await waitFor(() => {
      expect(screen.getByText(/blocked/i)).toBeDefined();
    });

    // Should show Plan Review label
    await waitFor(() => {
      expect(screen.getByText('Plan Review')).toBeDefined();
    });
  });

  it('INB-02: completed plan_review appears in resolved section', async () => {
    const completedConv = { ...PLAN_REVIEW_CONV, state: 'completed' as const };
    vi.mocked(ctrl.api.getConversations).mockResolvedValue({
      ok: true,
      data: [completedConv],
    });
    vi.mocked(ctrl.api.getRolesByOrgId).mockResolvedValue({ ok: true, data: [] });

    render(<InboxPage orgId="org-1" />);

    await waitFor(() => {
      expect(screen.getByText(/resolved/i)).toBeDefined();
    });
  });
});
