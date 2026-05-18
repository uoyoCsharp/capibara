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

describe.skipIf(!canUseSqlite)('Organization SQLite Repositories', () => {
  let db: InstanceType<typeof Database>;

  beforeEach(async () => {
    const { runMigrations } = await import('@core/infrastructure/persistence/sqlite/migrations');
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
  });

  afterEach(() => {
    db?.close();
  });

  describe('SqliteOrganizationRepository', () => {
    let repo: import('@core/modules/organization/persistence/sqlite-organization.repository').SqliteOrganizationRepository;

    beforeEach(async () => {
      const { SqliteOrganizationRepository } = await import('@core/modules/organization/persistence/sqlite-organization.repository');
      repo = new SqliteOrganizationRepository({ getDb: () => db, close: () => db.close() });
    });

    it('creates organization with all fields', () => {
      const org = repo.create({ name: 'My Org', description: 'Desc', customInstructions: 'Do', orgTemplateId: null, workspacePath: '/workspace' });
      expect(org.id).toBeDefined();
      expect(org.name).toBe('My Org');
      expect(org.status).toBe('active');
    });

    it('findById returns org when exists', () => {
      const created = repo.create({ name: 'Org', description: '', customInstructions: '', orgTemplateId: null, workspacePath: '/tmp' });
      expect(repo.findById(created.id)).not.toBeNull();
    });

    it('findById returns null when not exists', () => {
      expect(repo.findById('nonexistent')).toBeNull();
    });

    it('findAll returns all organizations', () => {
      repo.create({ name: 'Org1', description: '', customInstructions: '', orgTemplateId: null, workspacePath: '/a' });
      repo.create({ name: 'Org2', description: '', customInstructions: '', orgTemplateId: null, workspacePath: '/b' });
      expect(repo.findAll()).toHaveLength(2);
    });

    it('update changes fields', () => {
      const org = repo.create({ name: 'Old', description: '', customInstructions: '', orgTemplateId: null, workspacePath: '/tmp' });
      const updated = repo.update({ id: org.id, name: 'New', status: 'paused' });
      expect(updated.name).toBe('New');
      expect(updated.status).toBe('paused');
    });

    it('delete removes organization', () => {
      const org = repo.create({ name: 'Del', description: '', customInstructions: '', orgTemplateId: null, workspacePath: '/tmp' });
      repo.delete(org.id);
      expect(repo.findById(org.id)).toBeNull();
    });
  });

  describe('SqliteRoleRepository', () => {
    let repo: import('@core/modules/organization/persistence/sqlite-role.repository').SqliteRoleRepository;
    let orgId: string;

    beforeEach(async () => {
      const { SqliteOrganizationRepository } = await import('@core/modules/organization/persistence/sqlite-organization.repository');
      const { SqliteRoleRepository } = await import('@core/modules/organization/persistence/sqlite-role.repository');
      const connection = { getDb: () => db, close: () => db.close() };
      const orgRepo = new SqliteOrganizationRepository(connection);
      repo = new SqliteRoleRepository(connection);
      const org = orgRepo.create({ name: 'Org', description: '', customInstructions: '', orgTemplateId: null, workspacePath: '/tmp' });
      orgId = org.id;
    });

    it('creates role with correct fields', () => {
      const role = repo.create({ orgId, name: 'Dev', parentId: null, persona: 'developer', knowledgeBaseRefs: ['api.md'], skillIds: ['s1'], canApprove: true, canDelegate: false, requiresHumanApproval: false });
      expect(role.id).toBeDefined();
      expect(role.name).toBe('Dev');
      expect(role.knowledgeBaseRefs).toEqual(['api.md']);
      expect(role.skillIds).toEqual(['s1']);
      expect(role.canApprove).toBe(true);
    });

    it('creates child role with parentId', () => {
      const parent = repo.create({ orgId, name: 'Lead', parentId: null, persona: '', knowledgeBaseRefs: [], skillIds: [], canApprove: false, canDelegate: false, requiresHumanApproval: false });
      const child = repo.create({ orgId, name: 'Dev', parentId: parent.id, persona: '', knowledgeBaseRefs: [], skillIds: [], canApprove: false, canDelegate: false, requiresHumanApproval: false });
      expect(child.parentId).toBe(parent.id);
    });

    it('findChildren returns direct children', () => {
      const parent = repo.create({ orgId, name: 'P', parentId: null, persona: '', knowledgeBaseRefs: [], skillIds: [], canApprove: false, canDelegate: false, requiresHumanApproval: false });
      repo.create({ orgId, name: 'C1', parentId: parent.id, persona: '', knowledgeBaseRefs: [], skillIds: [], canApprove: false, canDelegate: false, requiresHumanApproval: false });
      repo.create({ orgId, name: 'C2', parentId: parent.id, persona: '', knowledgeBaseRefs: [], skillIds: [], canApprove: false, canDelegate: false, requiresHumanApproval: false });
      expect(repo.findChildren(parent.id)).toHaveLength(2);
    });

    it('delete sets children parentId to null', () => {
      const parent = repo.create({ orgId, name: 'P', parentId: null, persona: '', knowledgeBaseRefs: [], skillIds: [], canApprove: false, canDelegate: false, requiresHumanApproval: false });
      const child = repo.create({ orgId, name: 'C', parentId: parent.id, persona: '', knowledgeBaseRefs: [], skillIds: [], canApprove: false, canDelegate: false, requiresHumanApproval: false });
      repo.delete(parent.id);
      const orphan = repo.findById(child.id);
      expect(orphan!.parentId).toBeNull();
    });
  });

  describe('SqliteSkillRepository', () => {
    let repo: import('@core/modules/organization/persistence/sqlite-skill.repository').SqliteSkillRepository;

    beforeEach(async () => {
      const { SqliteSkillRepository } = await import('@core/modules/organization/persistence/sqlite-skill.repository');
      repo = new SqliteSkillRepository({ getDb: () => db, close: () => db.close() });
    });

    it('creates skill with correct fields', () => {
      const skill = repo.create({ name: 'Review', command: '/review', description: 'Reviews', category: 'review', source: 'custom', orgTemplateId: null, customPromptContent: 'Do review' });
      expect(skill.id).toBeDefined();
      expect(skill.command).toBe('/review');
      expect(skill.category).toBe('review');
    });

    it('findByCommand returns skill when found', () => {
      repo.create({ name: 'S', command: '/find-me', description: '', category: 'general', source: 'custom', orgTemplateId: null, customPromptContent: null });
      expect(repo.findByCommand('/find-me')).not.toBeNull();
    });

    it('findByCommand returns null when not found', () => {
      expect(repo.findByCommand('/nope')).toBeNull();
    });

    it('findByCategory filters correctly', () => {
      repo.create({ name: 'A', command: '/a', description: '', category: 'analysis', source: 'custom', orgTemplateId: null, customPromptContent: null });
      repo.create({ name: 'B', command: '/b', description: '', category: 'review', source: 'custom', orgTemplateId: null, customPromptContent: null });
      repo.create({ name: 'C', command: '/c', description: '', category: 'analysis', source: 'custom', orgTemplateId: null, customPromptContent: null });
      expect(repo.findByCategory('analysis')).toHaveLength(2);
    });
  });
});

describe.skipIf(canUseSqlite)(SQLITE_SKIP_REASON, () => {
  it('SQLite tests skipped — native module not available for system Node.js', () => {
    expect(true).toBe(true);
  });
});
