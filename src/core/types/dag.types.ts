/**
 * DAG Pipeline definition types
 * @module core/types/dag
 */

import type { Phase } from './phase.types.js';

/** Pipeline node type */
export type PipelineNodeType = 'worker' | 'evaluator' | 'aggregator' | 'gate';

/** Pipeline node definition */
export interface PipelineNodeDefinition {
  id: string;
  type: PipelineNodeType;
  name: string;
  phase?: Phase;
  /** Command executor type for this node (overrides global default) */
  executorType?: string;
  config: Record<string, unknown>;
}

/** Pipeline edge definition */
export interface PipelineEdgeDefinition {
  from: string;
  to: string;
  condition?: string;
}

/** Complete pipeline definition */
export interface PipelineDefinition {
  id: string;
  name: string;
  description?: string;
  nodes: PipelineNodeDefinition[];
  edges: PipelineEdgeDefinition[];
  settings?: {
    /** Default command executor type */
    defaultExecutorType?: string;
    budgetLimit?: number;
    maxRetriesPerNode?: number;
    mode?: 'auto' | 'semi-auto' | 'manual';
  };
}
