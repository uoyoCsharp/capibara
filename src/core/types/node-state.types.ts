/**
 * Generic node state types for DAG pipeline execution
 * @module core/types/node-state
 */

export type NodeStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'evaluating'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface NodeState {
  nodeId: string;
  status: NodeStatus;
  attempts: number;
  output?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface PipelineExecutionState {
  pipelineId: string;
  definitionId: string;
  nodes: Record<string, NodeState>;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  updatedAt: string;
}
