// ─── Workflow Schema Types ──────────────────────────────────────────
// Schema-driven workflow definitions at the organization level.
// See: architecture-workflow-engine.md ADR-WE-01 ~ ADR-WE-07

export interface WorkItemTypeDefinition {
  name: string;
  label: string;
  icon?: string;
  color?: string;
  isLeaf: boolean;
  allowedChildren: string[];
  allowedAtRoot: boolean;
  canDecompose: boolean;
  hasDiscussionGroup: boolean;
}

export type StatusCategory = 'initial' | 'active' | 'review' | 'terminal';

export interface StatusDefinition {
  name: string;
  label: string;
  category: StatusCategory;
}

export type TransitionTrigger = 'manual' | 'auto' | 'system';

export interface TransitionDefinition {
  from: string;
  to: string;
  trigger: TransitionTrigger;
}

export interface WorkflowSchema {
  workItemTypes: WorkItemTypeDefinition[];
  statuses: StatusDefinition[];
  transitions: TransitionDefinition[];
  behaviorRules: import('./behavior.types.js').BehaviorRule[];
}

export interface SchemaImpactReport {
  affectedTaskCount: number;
  details: Array<{ taskId: string; type: string; status: string }>;
}
