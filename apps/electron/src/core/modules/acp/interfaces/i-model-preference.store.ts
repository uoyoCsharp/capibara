import type { ModelState } from '../types/acp.types';

/**
 * Persists the user's global default-model preference and a cache of each agent's last-advertised
 * model state (ADR-2/ADR-4). Backed by the SQLite `settings` key-value table — runtime config is
 * not written back to config.json, so this reuses the same store as locale/scheduler_paused.
 */
export interface IModelPreferenceStore {
  /** The user's persisted default-model preference, or null if none is set. */
  getSelectedModelId(): string | null;

  /** Persist (or, with null, clear) the user's default-model preference. */
  setSelectedModelId(modelId: string | null): void;

  /** The last-advertised model state for an agent, used to render Settings before a live session exists. */
  getCachedModelState(agentId: string): ModelState | null;

  /** Cache an agent's advertised model state (write-through on session creation). */
  setCachedModelState(agentId: string, state: ModelState): void;
}
