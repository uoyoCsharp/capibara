/**
 * Pipeline State Persistence Interface
 * @module core/interfaces/state-store
 */

import type { PipelineState } from '../types/pipeline.types.js';

export interface IStateStore {
  /** Save Pipeline state snapshot */
  save(state: PipelineState): Promise<void>;

  /** Load Pipeline state by ID */
  load(pipelineId: string): Promise<PipelineState | null>;

  /** List all saved Pipeline states */
  list(): Promise<PipelineState[]>;

  /** Delete specified Pipeline state */
  delete(pipelineId: string): Promise<void>;
}
