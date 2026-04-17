export type TaskType = string;
export type TaskStatus = string;
export type StatusCategory = 'initial' | 'active' | 'approval' | 'terminal';
export type TransitionMode = 'manual' | 'auto' | 'system';

export interface Task {
  id: string;
  orgId: string;
  parentId: string | null;
  type: TaskType;
  title: string;
  description: string;
  status: TaskStatus;
  assigneeRoleId: string | null;
  depth: number;
  artifactPaths: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkItemTypeDefinition {
  name: string;
  label: string;
  icon?: string;
  color?: string;
  isLeaf: boolean;
  allowedChildren: string[];
  allowedAtRoot: boolean;
  canDecompose: boolean;
}

export interface StatusDefinition {
  name: string;
  label: string;
  category: StatusCategory;
}

export interface TransitionDefinition {
  from: string;
  to: string;
  mode: TransitionMode;
}

export type BehaviorTrigger =
  | 'on_status_enter'
  | 'on_status_exit'
  | 'on_task_created'
  | 'on_task_completed'
  | 'on_approval_confirmed'
  | 'on_approval_rejected';

export interface BehaviorCondition {
  field: string;
  operator: 'equals' | 'not_equals' | 'in' | 'not_in';
  value: unknown;
}

export type BehaviorActionType =
  | 'transition'
  | 'wake_role'
  | 'create_child_task'
  | 'notify';

export interface BehaviorAction {
  type: BehaviorActionType;
  params: Record<string, unknown>;
}

export interface BehaviorRule {
  id: string;
  name: string;
  priority: number;
  trigger: BehaviorTrigger;
  condition: BehaviorCondition | null;
  action: BehaviorAction;
}

export interface ProcessSchema {
  workItemTypes: WorkItemTypeDefinition[];
  statuses: StatusDefinition[];
  transitions: TransitionDefinition[];
  behaviorRules: BehaviorRule[];
}

export interface ProcessSchemaRecord {
  id: string;
  orgId: string;
  schemaJson: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  orgId: string;
  parentId: string | null;
  type: TaskType;
  title: string;
  description: string;
  assigneeRoleId: string | null;
}

export interface BatchCreateTaskInput {
  type: TaskType;
  title: string;
  description: string;
  assigneeRoleId: string | null;
  children?: BatchCreateTaskInput[];
}
