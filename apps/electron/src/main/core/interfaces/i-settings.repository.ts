import type { Setting } from '../types/domain.types.js';

export interface ISettingsRepository {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  getAll(): Promise<Setting[]>;
  delete(key: string): Promise<void>;
}
