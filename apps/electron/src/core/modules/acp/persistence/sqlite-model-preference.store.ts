import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';
import type { IModelPreferenceStore } from '../interfaces/i-model-preference.store';
import type { ModelState } from '../types/acp.types';

const SELECTED_MODEL_KEY = 'acp:default-model';
const modelsCacheKey = (agentId: string) => `acp:models-cache:${agentId}`;

/**
 * {@link IModelPreferenceStore} backed by the SQLite `settings` key-value table (ADR-2).
 * The cached model state is stored as JSON under a per-agent key.
 */
export class SqliteModelPreferenceStore implements IModelPreferenceStore {
  constructor(private readonly connection: ISqliteConnection) {}

  getSelectedModelId(): string | null {
    return this.get(SELECTED_MODEL_KEY);
  }

  setSelectedModelId(modelId: string | null): void {
    if (modelId === null) {
      this.connection.getDb().prepare('DELETE FROM settings WHERE key = ?').run(SELECTED_MODEL_KEY);
      return;
    }
    this.set(SELECTED_MODEL_KEY, modelId);
  }

  getCachedModelState(agentId: string): ModelState | null {
    const raw = this.get(modelsCacheKey(agentId));
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as ModelState;
    } catch {
      // Corrupt/legacy cache entry — treat as absent rather than throwing into the manager.
      return null;
    }
  }

  setCachedModelState(agentId: string, state: ModelState): void {
    this.set(modelsCacheKey(agentId), JSON.stringify(state));
  }

  private get(key: string): string | null {
    const row = this.connection.getDb()
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  private set(key: string, value: string): void {
    this.connection.getDb()
      .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run(key, value);
  }
}
