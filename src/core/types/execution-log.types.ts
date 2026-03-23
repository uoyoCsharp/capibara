/**
 * Execution log types for progress feedback
 * @module core/types/execution-log
 */

import type { Phase } from './phase.types.js';
import type { PipelineEventType } from './events.types.js';

export type ExecutionLogLevel = 'info' | 'warn' | 'error';

export interface ExecutionLogEntry {
  id: string;
  timestamp: string;
  pipelineId: string;
  changeId: string;
  phase: Phase;
  eventType: PipelineEventType;
  level: ExecutionLogLevel;
  /** Event-specific payload */
  payload: Record<string, unknown>;
  /** LLM output (for worker:completed events), truncated if too long */
  output?: string;
  /** Output truncation flag */
  outputTruncated?: boolean;
}

export interface ExecutionLogQuery {
  pipelineId?: string;
  changeId?: string;
  phase?: Phase;
  eventTypes?: PipelineEventType[];
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

/** Maximum output size in bytes (10KB) */
export const MAX_OUTPUT_SIZE = 10240;

/**
 * Truncate output to maximum size
 */
export function truncateOutput(output: string, maxSize: number = MAX_OUTPUT_SIZE): {
  output: string;
  truncated: boolean;
} {
  if (output.length <= maxSize) {
    return { output, truncated: false };
  }
  return {
    output: output.slice(0, maxSize) + '\n... [truncated]',
    truncated: true,
  };
}
