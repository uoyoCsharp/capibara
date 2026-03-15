/**
 * Trigger Role Interface - Responsible for listening to external requirement sources and triggering Pipeline
 * @module core/interfaces/trigger
 */

import type { Requirement } from '../types/requirement.types.js';

export interface ITrigger {
  /** Listen to requirement source, async iterator yields new requirements */
  watch(): AsyncIterable<Requirement>;

  /** Mark requirement as started processing (e.g., add label to GitHub Issue) */
  acknowledge(requirementId: string): Promise<void>;

  /** Mark requirement processing as complete */
  close(requirementId: string, status: string): Promise<void>;
}
