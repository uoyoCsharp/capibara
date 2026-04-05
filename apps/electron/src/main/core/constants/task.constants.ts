import type { TaskStatus } from '../types/domain.types.js';

// Valid task state transitions: from → to[]
// Using Record<TaskStatus, ...> ensures compile-time coverage of all statuses.
export const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  pending: ['in_progress', 'cancelled'],
  in_progress: ['awaiting_review', 'blocked', 'cancelled'],
  awaiting_review: ['approved', 'revision', 'blocked', 'cancelled'],
  revision: ['in_progress', 'cancelled'],
  approved: ['done', 'cancelled'],
  done: [],
  blocked: ['pending', 'in_progress', 'cancelled'],
  cancelled: [],
};
