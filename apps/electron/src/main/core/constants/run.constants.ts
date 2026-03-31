import type { RunStatus } from '../types/domain.types.js';

export const TERMINAL_RUN_STATUSES: ReadonlySet<RunStatus> = new Set([
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
]);

export const MAX_RUN_OUTPUT_BYTES = 1024 * 1024; // 1 MB log cap per run
