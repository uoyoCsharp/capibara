// ─── Behavior Rule Types (TCA Model) ───────────────────────────────
// Trigger-Condition-Action rule engine types.
// See: architecture-workflow-engine.md ADR-WE-08, ADR-WE-09

// ─── Triggers ──────────────────────────────────────────────────────

export type BehaviorTrigger =
  | { type: 'on_status_enter'; status: string }
  | { type: 'on_task_created' }
  | { type: 'on_all_children_terminal' }
  | { type: 'on_children_of_type_terminal'; childTypes: string[] };

// ─── Conditions ────────────────────────────────────────────────────

export type BehaviorCondition =
  | { type: 'always' }
  | { type: 'item_is_leaf' }
  | { type: 'item_has_no_children' }
  | { type: 'item_type_in'; types: string[] }
  | { type: 'item_in_status'; statuses: string[] }
  | { type: 'parent_in_status'; statuses: string[] }
  | { type: 'and'; conditions: BehaviorCondition[] }
  | { type: 'or'; conditions: BehaviorCondition[] }
  | { type: 'not'; condition: BehaviorCondition };

// ─── Actions ───────────────────────────────────────────────────────

export type BehaviorAction =
  | { type: 'auto_transition'; targetStatus: string }
  | { type: 'wake_assignee'; trigger: string }
  | { type: 'wake_parent_assignee'; trigger: string }
  | { type: 'skip_propagation' }
  | { type: 'create_discussion_group' };

// ─── Rule ──────────────────────────────────────────────────────────

export interface BehaviorRule {
  id: string;
  name: string;
  priority: number;
  trigger: BehaviorTrigger;
  condition: BehaviorCondition;
  action: BehaviorAction;
}

// ─── Context (passed to condition evaluators) ──────────────────────

export interface BehaviorContext {
  taskId: string;
  orgId: string;
  taskType: string;
  taskStatus: string;
  parentTaskId: string | null;
  parentTaskType: string | null;
  parentTaskStatus: string | null;
  childCount: number;
  childTypes: string[];
  childStatuses: string[];
}
