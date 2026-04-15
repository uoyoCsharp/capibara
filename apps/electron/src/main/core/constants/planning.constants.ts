import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** System-reserved task type for planning sessions. Not in WorkflowSchema. */
export const PLANNING_TASK_TYPE = 'plan';

/** Set of system-reserved task types that bypass WorkflowEngine schema validation. */
export const SYSTEM_TASK_TYPES = new Set([PLANNING_TASK_TYPE]);

/** Load the default planning role definition from resources/roles/plan-assistant.json. */
function loadPlanningRoleDefaults(): { name: string; persona: string } {
  try {
    const resourcePath = join(__dirname, '..', '..', '..', '..', '..', 'resources', 'roles', 'plan-assistant.json');
    const raw = readFileSync(resourcePath, 'utf-8');
    return JSON.parse(raw) as { name: string; persona: string };
  } catch {
    return {
      name: 'Plan Assistant',
      persona: 'You are a Planning Assistant. You help users explore ideas, define project scope, and create structured task plans.',
    };
  }
}

const PLANNING_ROLE_DEFAULTS = loadPlanningRoleDefaults();

/** Default name for the system-injected planning role. */
export const SYSTEM_PLANNING_ROLE_NAME = PLANNING_ROLE_DEFAULTS.name;

/** Default persona for the system planning role. */
export const SYSTEM_PLANNING_ROLE_PERSONA = PLANNING_ROLE_DEFAULTS.persona;
