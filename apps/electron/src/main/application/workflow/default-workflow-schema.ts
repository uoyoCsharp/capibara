import type { WorkflowSchema } from '@main/core/types/workflow-schema.types.js';

/**
 * Default workflow schema matching the classic Capibara task hierarchy.
 * Auto-applied when a new organization is created.
 */
export const DEFAULT_WORKFLOW_SCHEMA: WorkflowSchema = {
  workItemTypes: [
    { name: 'epic', label: 'Epic', isLeaf: false, allowedChildren: ['story', 'spike'], allowedAtRoot: true, canDecompose: true, hasDiscussionGroup: true },
    { name: 'story', label: 'Story', isLeaf: false, allowedChildren: ['task', 'bug', 'chore', 'spike'], allowedAtRoot: true, canDecompose: true, hasDiscussionGroup: true },
    { name: 'task', label: 'Task', isLeaf: false, allowedChildren: ['subtask'], allowedAtRoot: false, canDecompose: false, hasDiscussionGroup: false },
    { name: 'subtask', label: 'Subtask', isLeaf: true, allowedChildren: [], allowedAtRoot: false, canDecompose: false, hasDiscussionGroup: false },
    { name: 'spike', label: 'Spike', isLeaf: true, allowedChildren: [], allowedAtRoot: false, canDecompose: false, hasDiscussionGroup: false },
    { name: 'bug', label: 'Bug', isLeaf: true, allowedChildren: [], allowedAtRoot: false, canDecompose: false, hasDiscussionGroup: false },
    { name: 'chore', label: 'Chore', isLeaf: true, allowedChildren: [], allowedAtRoot: false, canDecompose: false, hasDiscussionGroup: false },
  ],
  statuses: [
    { name: 'pending', label: 'Pending', category: 'initial' },
    { name: 'in_progress', label: 'In Progress', category: 'active' },
    { name: 'revision', label: 'Revision', category: 'active' },
    { name: 'blocked', label: 'Blocked', category: 'active' },
    { name: 'awaiting_review', label: 'Awaiting Review', category: 'review' },
    { name: 'approved', label: 'Approved', category: 'terminal' },
    { name: 'done', label: 'Done', category: 'terminal' },
    { name: 'cancelled', label: 'Cancelled', category: 'terminal' },
  ],
  transitions: [
    { from: 'pending', to: 'in_progress', trigger: 'manual' },
    { from: 'in_progress', to: 'awaiting_review', trigger: 'manual' },
    { from: 'in_progress', to: 'blocked', trigger: 'system' },
    { from: 'blocked', to: 'in_progress', trigger: 'manual' },
    { from: 'awaiting_review', to: 'approved', trigger: 'manual' },
    { from: 'awaiting_review', to: 'revision', trigger: 'manual' },
    { from: 'revision', to: 'in_progress', trigger: 'manual' },
    { from: 'revision', to: 'awaiting_review', trigger: 'manual' },
    { from: 'approved', to: 'done', trigger: 'auto' },
    { from: 'pending', to: 'cancelled', trigger: 'system' },
    { from: 'in_progress', to: 'cancelled', trigger: 'system' },
    { from: 'blocked', to: 'cancelled', trigger: 'system' },
  ],
  behaviorRules: [
    {
      id: 'default-auto-done-leaf',
      name: 'Auto-complete leaf on approval',
      priority: 10,
      trigger: { type: 'on_status_enter', status: 'approved' },
      condition: { type: 'item_is_leaf' },
      action: { type: 'auto_transition', targetStatus: 'done' },
    },
    {
      id: 'default-propagate-parent',
      name: 'Auto-transition parent when all children terminal',
      priority: 20,
      trigger: { type: 'on_all_children_terminal' },
      condition: { type: 'always' },
      action: { type: 'auto_transition', targetStatus: 'done' },
    },
    {
      id: 'default-discussion-group',
      name: 'Create discussion group on task creation',
      priority: 30,
      trigger: { type: 'on_task_created' },
      condition: { type: 'always' },
      action: { type: 'create_discussion_group' },
    },
  ],
};
