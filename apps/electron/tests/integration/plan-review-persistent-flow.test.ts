import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLITE_SKIP_REASON } from '../helpers/test-db';

let Database: typeof import('better-sqlite3').default;
let canUseSqlite = false;

try {
  Database = (await import('better-sqlite3')).default;
  new Database(':memory:');
  canUseSqlite = true;
} catch {
  canUseSqlite = false;
}

describe.skipIf(!canUseSqlite)('Planning flow (persistent) integration', () => {
  let db: InstanceType<typeof Database>;

  const SAMPLE_TREE = {
    type: 'epic', title: 'Root Epic', description: 'Test epic',
    assigneeRoleId: 'role-cto',
    children: [
      { type: 'story', title: 'S1', description: 'Story 1', assigneeRoleId: 'role-dev', children: [] },
      { type: 'story', title: 'S2', description: 'Story 2', assigneeRoleId: 'role-dev', children: [] },
    ],
  };

  async function buildTestService() {
    const { runMigrations } = await import('@core/infrastructure/persistence/sqlite/migrations');
    const { SqlitePendingPlanTreeRepository } = await import(
      '@core/modules/planning/persistence/sqlite-pending-plan-tree.repository'
    );
    const { MockEventBus } = await import('../helpers/mock-event-bus');
    const { MockLogger } = await import('../helpers/mock-logger');
    const { PlanningService } = await import('@core/modules/planning/planning.service');

    if (!db || !db.open) {
      db = new Database(':memory:');
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
      runMigrations(db);

      db.exec(`
        INSERT INTO organizations (id, name, workspace_path) VALUES ('org-1', 'Test Org', '/tmp');
        INSERT INTO roles (id, org_id, name) VALUES ('role-cto', 'org-1', 'CTO');
        INSERT INTO roles (id, org_id, name) VALUES ('role-dev', 'org-1', 'Developer');
        INSERT INTO tasks (id, org_id, type, title, assignee_role_id, planning_mode)
          VALUES ('task-root', 'org-1', 'epic', 'Root Epic', 'role-cto', 'preview');
      `);
    }

    const connection = { getDb: () => db, close: () => {} };
    const repo = new SqlitePendingPlanTreeRepository(connection);
    const bus = new MockEventBus();
    const logger = new MockLogger();

    const taskService = {
      findById: (id: string) => {
        const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        if (!row) return null;
        return { id: row.id, orgId: row.org_id, status: row.status, assigneeRoleId: row.assignee_role_id };
      },
      batchCreate: vi.fn().mockReturnValue([{ id: 't-1' }, { id: 't-2' }]),
    };

    const conversationService = {
      findById: vi.fn().mockReturnValue(null),
      createPlanReview: vi.fn().mockReturnValue({ id: 'conv-review-1' }),
      addMessage: vi.fn(),
      complete: vi.fn(),
      cancel: vi.fn(),
    };

    const taskStateMachine = {
      transition: vi.fn(),
    };

    const processEngine = {
      getAvailableTransitions: vi.fn().mockReturnValue([{ from: 'pending', to: 'in_progress' }]),
    };

    const service = new PlanningService(
      taskService as any,
      taskStateMachine as any,
      processEngine as any,
      connection as any,
      bus, bus, logger,
      repo,
      conversationService as any,
    );
    service.init();

    return { service, repo, bus, conversationService, taskService, taskStateMachine };
  }

  afterEach(() => {
    if (db?.open) db.close();
    db = undefined!;
  });

  it('INT-01: pending tree survives service re-creation', async () => {
    const { service, repo } = await buildTestService();

    // Submit a tree
    service['onTreeSubmitted']({
      type: 'plan-tree:submitted',
      timestamp: new Date().toISOString(),
      payload: {
        rootTaskId: 'task-root', orgId: 'org-1', roleId: 'role-cto',
        mode: 'preview', tree: SAMPLE_TREE, submittedAt: new Date().toISOString(),
      },
    });

    // Verify it's in DB
    const pt = repo.findActiveByRootTaskId('task-root');
    expect(pt).not.toBeNull();
    expect(pt!.version).toBe(1);

    // Re-create service (simulate restart) using same DB
    const { service: service2 } = await buildTestService();
    const found = service2.getPendingTree('task-root');
    expect(found).toBeDefined();
    expect(found!.version).toBe(1);
  });

  it('INT-02: submit → approve → children created + conversation completed', async () => {
    const { service, bus, conversationService, taskService } = await buildTestService();

    bus.publish('plan-tree:submitted', {
      rootTaskId: 'task-root', orgId: 'org-1', roleId: 'role-cto',
      mode: 'preview', tree: SAMPLE_TREE, submittedAt: new Date().toISOString(),
    });

    const result = service.approvePlanTree('task-root');
    expect(result.ok).toBe(true);
    expect(taskService.batchCreate).toHaveBeenCalled();
    expect(conversationService.complete).toHaveBeenCalled();
    bus.assertEmitted('plan-tree:approved');
  });

  it('INT-03: submit → refine → re-submit → approve uses new version', async () => {
    const { service, bus, repo } = await buildTestService();

    bus.publish('plan-tree:submitted', {
      rootTaskId: 'task-root', orgId: 'org-1', roleId: 'role-cto',
      mode: 'preview', tree: SAMPLE_TREE, submittedAt: new Date().toISOString(),
    });

    service.setWaker({ tryWake: vi.fn() });
    service.refinePlanTree('task-root', 'Add more stories');

    // AI re-submits with updated tree
    const updatedTree = { ...SAMPLE_TREE, title: 'Updated Root' };
    bus.publish('plan-tree:submitted', {
      rootTaskId: 'task-root', orgId: 'org-1', roleId: 'role-cto',
      mode: 'preview', tree: updatedTree, submittedAt: new Date().toISOString(),
    });

    const pt = repo.findActiveByRootTaskId('task-root');
    expect(pt!.version).toBe(2);
    expect(pt!.tree.title).toBe('Updated Root');

    const result = service.approvePlanTree('task-root');
    expect(result.ok).toBe(true);
  });

  it('INT-04: submit → discard → root reverted', async () => {
    const { service, bus, taskStateMachine } = await buildTestService();

    bus.publish('plan-tree:submitted', {
      rootTaskId: 'task-root', orgId: 'org-1', roleId: 'role-cto',
      mode: 'preview', tree: SAMPLE_TREE, submittedAt: new Date().toISOString(),
    });

    const result = service.discardPlanTree('task-root', 'not needed');
    expect(result.ok).toBe(true);
    bus.assertEmitted('plan-tree:discarded');
  });

  it('INT-05: submit → expire → auto-cleanup', async () => {
    const { service, repo, bus, conversationService } = await buildTestService();

    // Submit with already-expired time
    const pastExpiry = new Date(Date.now() - 1000).toISOString();
    repo.upsertByRootTaskId({
      rootTaskId: 'task-root', orgId: 'org-1', roleId: 'role-cto',
      mode: 'preview', tree: SAMPLE_TREE,
      submittedAt: new Date().toISOString(),
      expiresAt: pastExpiry,
      conversationId: 'conv-expired',
    });

    service.expireStale();
    const pt = repo.findActiveByRootTaskId('task-root');
    expect(pt).toBeNull();
    expect(conversationService.cancel).toHaveBeenCalledWith('conv-expired');
    bus.assertEmitted('plan-tree:discarded');
  });

  it('INT-06: double submit same rootTaskId → approve uses latest', async () => {
    const { service, bus, repo } = await buildTestService();

    bus.publish('plan-tree:submitted', {
      rootTaskId: 'task-root', orgId: 'org-1', roleId: 'role-cto',
      mode: 'preview', tree: SAMPLE_TREE, submittedAt: new Date().toISOString(),
    });

    const tree2 = { ...SAMPLE_TREE, title: 'Version 2' };
    bus.publish('plan-tree:submitted', {
      rootTaskId: 'task-root', orgId: 'org-1', roleId: 'role-cto',
      mode: 'preview', tree: tree2, submittedAt: new Date().toISOString(),
    });

    const pt = repo.findActiveByRootTaskId('task-root');
    expect(pt!.version).toBe(2);
    expect(pt!.tree.title).toBe('Version 2');
  });

  it('INT-07: eager mode creates children directly without plan_review', async () => {
    const { service, bus, conversationService, taskService } = await buildTestService();

    bus.publish('plan-tree:submitted', {
      rootTaskId: 'task-root', orgId: 'org-1', roleId: 'role-cto',
      mode: 'eager', tree: SAMPLE_TREE, submittedAt: new Date().toISOString(),
    });

    expect(taskService.batchCreate).toHaveBeenCalled();
    expect(conversationService.createPlanReview).not.toHaveBeenCalled();
    expect(service.getPendingTree('task-root')).toBeUndefined();
  });
});
