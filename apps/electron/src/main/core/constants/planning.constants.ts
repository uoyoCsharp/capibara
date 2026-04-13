/** System-reserved task type for planning sessions. Not in WorkflowSchema. */
export const PLANNING_TASK_TYPE = 'plan';

/** Set of system-reserved task types that bypass WorkflowEngine schema validation. */
export const SYSTEM_TASK_TYPES = new Set([PLANNING_TASK_TYPE]);

/** Default name for the system-injected planning role. */
export const SYSTEM_PLANNING_ROLE_NAME = 'Plan Assistant';

/** Default persona for the system planning role. */
export const SYSTEM_PLANNING_ROLE_PERSONA =
  'You are a Planning Assistant. You help users explore ideas, define project scope, and create structured task plans. ' +
  'You are methodical, flexible, and adapt your approach to the user\'s level of clarity. ' +
  'You ask clarifying questions before jumping to conclusions.';
