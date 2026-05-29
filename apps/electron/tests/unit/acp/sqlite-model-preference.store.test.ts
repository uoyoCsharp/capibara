import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ModelState } from '@core/modules/acp/types/acp.types';

let Database: typeof import('better-sqlite3').default;
let canUseSqlite = false;

try {
  Database = (await import('better-sqlite3')).default;
  new Database(':memory:');
  canUseSqlite = true;
} catch {
  canUseSqlite = false;
}

const SAMPLE: ModelState = {
  models: [{ id: 'opus', name: 'Opus 4.8' }, { id: 'sonnet', name: 'Sonnet 4.6' }],
  currentModelId: 'opus',
  mechanism: 'config_option',
  configId: 'model',
};

describe.skipIf(!canUseSqlite)('SqliteModelPreferenceStore', () => {
  let db: InstanceType<typeof Database>;
  let store: import('@core/modules/acp/persistence/sqlite-model-preference.store').SqliteModelPreferenceStore;

  beforeEach(async () => {
    const { SqliteModelPreferenceStore } = await import('@core/modules/acp/persistence/sqlite-model-preference.store');
    const { runMigrations } = await import('@core/infrastructure/persistence/sqlite/migrations');

    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    runMigrations(db);

    const connection = { getDb: () => db, close: () => db.close() };
    store = new SqliteModelPreferenceStore(connection);
  });

  afterEach(() => {
    db?.close();
  });

  describe('selected model preference', () => {
    it('returns null when unset', () => {
      expect(store.getSelectedModelId()).toBeNull();
    });

    it('persists and reads back the selected model', () => {
      store.setSelectedModelId('opus');
      expect(store.getSelectedModelId()).toBe('opus');
    });

    it('overwrites a previously selected model', () => {
      store.setSelectedModelId('opus');
      store.setSelectedModelId('sonnet');
      expect(store.getSelectedModelId()).toBe('sonnet');
    });

    it('clears the preference when set to null', () => {
      store.setSelectedModelId('opus');
      store.setSelectedModelId(null);
      expect(store.getSelectedModelId()).toBeNull();
    });
  });

  describe('cached model state', () => {
    it('returns null for an agent with no cache', () => {
      expect(store.getCachedModelState('claude-agent')).toBeNull();
    });

    it('round-trips a ModelState through JSON per agent', () => {
      store.setCachedModelState('claude-agent', SAMPLE);
      expect(store.getCachedModelState('claude-agent')).toEqual(SAMPLE);
    });

    it('keeps caches isolated per agent id', () => {
      store.setCachedModelState('agent-a', SAMPLE);
      expect(store.getCachedModelState('agent-b')).toBeNull();
    });

    it('treats a corrupt cache entry as absent', () => {
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('acp:models-cache:bad', '{not json');
      expect(store.getCachedModelState('bad')).toBeNull();
    });
  });
});
