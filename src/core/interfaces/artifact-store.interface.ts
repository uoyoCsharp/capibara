/**
 * Artifact Store Interface - Manages files/content produced by each phase
 * @module core/interfaces/artifact-store
 */

import type { Phase } from '../types/phase.types.js';

export interface Artifact {
  phase: Phase;
  path: string;
  content: string;
}

export interface IArtifactStore {
  /** Save phase artifact, return storage path */
  save(changeId: string, phase: Phase, content: string): Promise<string>;

  /** Load artifact from specified phase */
  load(changeId: string, phase: Phase): Promise<Artifact | null>;

  /** Load all artifacts for a changeId */
  loadAll(changeId: string): Promise<Artifact[]>;

  /** Detect files changed since specified time */
  detectChangedFiles(since?: string): Promise<string[]>;
}
