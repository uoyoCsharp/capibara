/**
 * Conductor Role Interface - Makes routing decisions based on Messenger-prepared input
 * @module core/interfaces/conductor
 */

import type { ConductorDecision } from '../types/conductor.types.js';

export interface IConductor {
  /** Make decision based on Messenger-synthesized plain text: approve / revise / escalate */
  decide(input: string): Promise<ConductorDecision>;
}
