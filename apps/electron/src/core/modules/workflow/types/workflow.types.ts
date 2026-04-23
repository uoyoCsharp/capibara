export type TaskType = string;
export type TaskStatus = string;
export type StatusCategory = 'initial' | 'active' | 'approval' | 'terminal';

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
}

export type BehaviorTrigger = 'on_status_enter' | 'on_all_children_terminal';

export interface FieldCondition {
  field: string;
  op: 'eq' | 'neq' | 'in' | 'not_in' | 'gt' | 'lt';
  value: unknown;
}

export interface AllCondition {
  all: BehaviorCondition[];
}

export interface AnyCondition {
  any: BehaviorCondition[];
}

export interface NotCondition {
  not: BehaviorCondition;
}

export type BehaviorCondition = FieldCondition | AllCondition | AnyCondition | NotCondition;

export type BehaviorActionType = 'transition';

export interface BehaviorAction {
  type: BehaviorActionType;
  params?: Record<string, unknown>;
}

export interface BehaviorRule {
  id: string;
  name: string;
  priority: number;
  trigger: BehaviorTrigger;
  condition?: BehaviorCondition | null;
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
