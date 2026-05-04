import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLITE_SKIP_REASON } from '../../helpers/test-db';

let Database: typeof import('better-sqlite3').default;
let canUseSqlite = false;

try {
  Database = (await import('better-sqlite3')).default;
  new Database(':memory:');
  canUseSqlite = true;
} catch {
  canUseSqlite = false;
}

describe.skipIf(!canUseSqlite)('SqlitePendingPlanTreeRepository', () => {
  let db: InstanceType<typeof Database>;
  let repo: import('@core/modules/planning/persistence/sqlite-pending-plan-tree.repository').SqlitePendingPlanTreeRepository;

  const sampleTree = {
    type: 'epic',
    title: 'Test Epic',
    description: 'A test epic',
    assigneeRoleId: 'role-cto',
    children: [
      { type: 'story', title: 'Story 1', description: 'First story', assigneeRoleId: 'role-dev', children: [] },
    ],
  };

  beforeEach(async () => {
    const { runMigrations } = await import('@core/infrastructure/persistence/sqlite/migrations');
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    db.exec(`
      INSERT INTO organizations (id, name, workspace_path) VALUES ('org-1', 'Test Org', '/tmp');
      INSERT INTO roles (id, org_id, name) VALUES ('role-cto', 'org-1', 'CTO');
      INSERT INTO tasks (id, org_id, type, title, assignee_role_id) VALUES ('task-root', 'org-1', 'epic', 'Root', 'role-cto');
      INSERT INTO tasks (id, org_id, type, title, assignee_role_id) VALUES ('task-root-2', 'org-1', 'epic', 'Root 2', 'role-cto');
    `);

    const { SqlitePendingPlanTreeRepository } = await import(
      '@core/modules/planning/persistence/sqlite-pending-plan-tree.repository'
    );
    repo = new SqlitePendingPlanTreeRepository({ getDb: () => db, close: () => db.close() });
  });

  afterEach(() => {
    db?.close();
  });

  // ── Basic CRUD (R-01 ~ R-09) ──

  it('R-01: upsertByRootTaskId inserts with version=1 and status=active', () => {
    const result = repo.upsertByRootTaskId({
      rootTaskId: 'task-root',
      orgId: 'org-1',
      roleId: 'role-cto',
      mode: 'preview',
      tree: sampleTree,
      submittedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    expect(result.version).toBe(1);
    expect(result.status).toBe('active');
    expect(result.rootTaskId).toBe('task-root');
  });

  it('R-02: second upsert bumps version and overwrites tree', () => {
    const input = {
      rootTaskId: 'task-root',
      orgId: 'org-1',
      roleId: 'role-cto',
      mode: 'preview' as const,
      tree: sampleTree,
      submittedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    };
    repo.upsertByRootTaskId(input);
    const updatedTree = { ...sampleTree, title: 'Updated Epic' };
    const result = repo.upsertByRootTaskId({ ...input, tree: updatedTree });
    expect(result.version).toBe(2);
    expect(result.tree.title).toBe('Updated Epic');
  });

  it('R-03: findActiveByRootTaskId returns active record', () => {
    repo.upsertByRootTaskId({
      rootTaskId: 'task-root',
      orgId: 'org-1',
      roleId: 'role-cto',
      mode: 'preview',
      tree: sampleTree,
      submittedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const found = repo.findActiveByRootTaskId('task-root');
    expect(found).not.toBeNull();
    expect(found!.status).toBe('active');
  });

  it('R-04: findActiveByRootTaskId returns null for discarded/expired', () => {
    const pt = repo.upsertByRootTaskId({
      rootTaskId: 'task-root',
      orgId: 'org-1',
      roleId: 'role-cto',
      mode: 'preview',
      tree: sampleTree,
      submittedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    repo.updateStatus(pt.id, 'discarded');
    expect(repo.findActiveByRootTaskId('task-root')).toBeNull();
  });

  it('R-05: findByOrgId returns all records', () => {
    repo.upsertByRootTaskId({
      rootTaskId: 'task-root',
      orgId: 'org-1',
      roleId: 'role-cto',
      mode: 'preview',
      tree: sampleTree,
      submittedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const pt = repo.findActiveByRootTaskId('task-root')!;
    repo.updateStatus(pt.id, 'approved');
    // Insert another active one for a different task
    repo.upsertByRootTaskId({
      rootTaskId: 'task-root-2',
      orgId: 'org-1',
      roleId: 'role-cto',
      mode: 'preview',
      tree: sampleTree,
      submittedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const all = repo.findByOrgId('org-1');
    expect(all.length).toBe(2);
  });

  it('R-06: updateStatus writes status and reviewedAt', () => {
    const pt = repo.upsertByRootTaskId({
      rootTaskId: 'task-root',
      orgId: 'org-1',
      roleId: 'role-cto',
      mode: 'preview',
      tree: sampleTree,
      submittedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const reviewedAt = new Date().toISOString();
    repo.updateStatus(pt.id, 'approved', reviewedAt);
    const updated = repo.findById(pt.id)!;
    expect(updated.status).toBe('approved');
    expect(updated.reviewedAt).toBe(reviewedAt);
  });

  it('R-07: updateFeedback writes and clears feedback', () => {
    const pt = repo.upsertByRootTaskId({
      rootTaskId: 'task-root',
      orgId: 'org-1',
      roleId: 'role-cto',
      mode: 'preview',
      tree: sampleTree,
      submittedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    repo.updateFeedback(pt.id, 'Please add more detail');
    expect(repo.findById(pt.id)!.pendingFeedback).toBe('Please add more detail');
    repo.updateFeedback(pt.id, null);
    expect(repo.findById(pt.id)!.pendingFeedback).toBeNull();
  });

  it('R-08: delete removes record', () => {
    const pt = repo.upsertByRootTaskId({
      rootTaskId: 'task-root',
      orgId: 'org-1',
      roleId: 'role-cto',
      mode: 'preview',
      tree: sampleTree,
      submittedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    repo.delete(pt.id);
    expect(repo.findById(pt.id)).toBeNull();
  });

  it('R-09: findExpired returns only active/refining records past expires_at', () => {
    const pastExpiry = new Date(Date.now() - 1000).toISOString();
    const futureExpiry = new Date(Date.now() + 86400000).toISOString();
    const now = new Date().toISOString();

    // Expired active
    repo.upsertByRootTaskId({
      rootTaskId: 'task-root',
      orgId: 'org-1',
      roleId: 'role-cto',
      mode: 'preview',
      tree: sampleTree,
      submittedAt: new Date().toISOString(),
      expiresAt: pastExpiry,
    });

    // Not expired
    repo.upsertByRootTaskId({
      rootTaskId: 'task-root-2',
      orgId: 'org-1',
      roleId: 'role-cto',
      mode: 'preview',
      tree: sampleTree,
      submittedAt: new Date().toISOString(),
      expiresAt: futureExpiry,
    });

    const expired = repo.findExpired(now);
    expect(expired.length).toBe(1);
    expect(expired[0].rootTaskId).toBe('task-root');
  });

  // ── Edge Cases (R-E1 ~ R-E4) ──

  it('R-E1: unique index ensures only one active per rootTaskId', () => {
    repo.upsertByRootTaskId({
      rootTaskId: 'task-root',
      orgId: 'org-1',
      roleId: 'role-cto',
      mode: 'preview',
      tree: sampleTree,
      submittedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    // Second upsert for same rootTaskId should update, not duplicate
    repo.upsertByRootTaskId({
      rootTaskId: 'task-root',
      orgId: 'org-1',
      roleId: 'role-cto',
      mode: 'preview',
      tree: sampleTree,
      submittedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const all = repo.findByOrgId('org-1');
    const activeCount = all.filter((t) => t.status === 'active' && t.rootTaskId === 'task-root').length;
    expect(activeCount).toBe(1);
  });

  it('R-E2: large tree JSON is persisted correctly', () => {
    const largeTree = {
      ...sampleTree,
      children: Array.from({ length: 200 }, (_, i) => ({
        type: 'story',
        title: `Story ${i}`,
        description: `Description for story ${i} with extra padding ${'x'.repeat(500)}`,
        assigneeRoleId: 'role-cto',
        children: [],
      })),
    };
    const pt = repo.upsertByRootTaskId({
      rootTaskId: 'task-root',
      orgId: 'org-1',
      roleId: 'role-cto',
      mode: 'preview',
      tree: largeTree,
      submittedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const found = repo.findById(pt.id)!;
    expect(found.tree.children.length).toBe(200);
    expect(found.tree.children[199].title).toBe('Story 199');
  });

  it('R-E3: conversation_id FK with SET NULL does not break pending tree', () => {
    // Create a conversation first
    db.exec(`INSERT INTO conversations (id, org_id, type, state, initiator_role_id)
             VALUES ('conv-test', 'org-1', 'plan_review', 'active', 'role-cto')`);
    const pt = repo.upsertByRootTaskId({
      rootTaskId: 'task-root',
      orgId: 'org-1',
      roleId: 'role-cto',
      mode: 'preview',
      tree: sampleTree,
      submittedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      conversationId: 'conv-test',
    });
    expect(repo.findById(pt.id)!.conversationId).toBe('conv-test');

    // Delete the conversation
    db.exec(`DELETE FROM conversations WHERE id = 'conv-test'`);
    const after = repo.findById(pt.id)!;
    expect(after.conversationId).toBeNull();
    expect(after.status).toBe('active');
  });

  it('R-E4: expires_at exactly equal to now is not expired', () => {
    const exactNow = new Date().toISOString();
    repo.upsertByRootTaskId({
      rootTaskId: 'task-root',
      orgId: 'org-1',
      roleId: 'role-cto',
      mode: 'preview',
      tree: sampleTree,
      submittedAt: new Date().toISOString(),
      expiresAt: exactNow,
    });
    // Query with the same timestamp — strict less-than
    const expired = repo.findExpired(exactNow);
    expect(expired.length).toBe(0);
  });
});
