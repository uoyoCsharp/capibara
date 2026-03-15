/**
 * Role permission constants - Controls CLI tools available to each role
 * @module core/constants/permissions
 */

import type { Phase } from '../types/phase.types.js';

export interface ToolPermissions {
  allowed?: string[];
  disallowed?: string[];
}

/**
 * Worker tool permissions by phase
 */
export const WORKER_PHASE_PERMISSIONS: Record<Phase, ToolPermissions> = {
  analyze: {
    disallowed: [],
  },
  design: {
    disallowed: [],
  },
  implement: {
    // Full tool set, no restrictions
  },
  review: {
    disallowed: [],
  },
  test: {
    disallowed: [],
  },
};

/**
 * Non-Worker role tool permissions
 * Evaluator/Conductor/Messenger: All read-only, disallow modifying project files
 */
export const ROLE_PERMISSIONS: Record<string, ToolPermissions> = {
  evaluator: {
    disallowed: ['Write', 'Edit', 'MultiEdit', 'Bash'],
  },
  conductor: {
    disallowed: ['Write', 'Edit', 'MultiEdit', 'Bash', 'Read'],
  },
  messenger: {
    disallowed: ['Write', 'Edit', 'MultiEdit', 'Bash', 'Read'],
  },
};
