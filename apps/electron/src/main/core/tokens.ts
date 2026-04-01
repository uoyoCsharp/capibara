// ─── DI Tokens ──────────────────────────────────────────────────────
// All tokens use Symbol + SCREAMING_SNAKE_CASE_TOKEN convention.
// Registered exclusively in composition-root.ts via tsyringe.

// Infrastructure
export const CONFIG_TOKEN = Symbol('CONFIG_TOKEN');
export const LOGGER_TOKEN = Symbol('LOGGER_TOKEN');
export const SQLITE_CONNECTION_TOKEN = Symbol('SQLITE_CONNECTION_TOKEN');
export const EVENT_BUS_TOKEN = Symbol('EVENT_BUS_TOKEN');

// Repositories
export const ORGANIZATION_REPO_TOKEN = Symbol('ORGANIZATION_REPO_TOKEN');
export const ROLE_REPO_TOKEN = Symbol('ROLE_REPO_TOKEN');
export const TASK_REPO_TOKEN = Symbol('TASK_REPO_TOKEN');
export const DISCUSSION_REPO_TOKEN = Symbol('DISCUSSION_REPO_TOKEN');
export const RUN_REPO_TOKEN = Symbol('RUN_REPO_TOKEN');
export const SKILL_REPO_TOKEN = Symbol('SKILL_REPO_TOKEN');
export const COST_ENTRY_REPO_TOKEN = Symbol('COST_ENTRY_REPO_TOKEN');
export const NARRATIVE_REPO_TOKEN = Symbol('NARRATIVE_REPO_TOKEN');
export const PENDING_WAKE_REPO_TOKEN = Symbol('PENDING_WAKE_REPO_TOKEN');
export const SETTINGS_REPO_TOKEN = Symbol('SETTINGS_REPO_TOKEN');

// Application Services
export const ORG_ORCHESTRATOR_TOKEN = Symbol('ORG_ORCHESTRATOR_TOKEN');
export const TASK_SERVICE_TOKEN = Symbol('TASK_SERVICE_TOKEN');
export const TASK_STATE_MACHINE_TOKEN = Symbol('TASK_STATE_MACHINE_TOKEN');
export const CONSENSUS_DETECTOR_TOKEN = Symbol('CONSENSUS_DETECTOR_TOKEN');
export const DISCUSSION_SERVICE_TOKEN = Symbol('DISCUSSION_SERVICE_TOKEN');
export const PROMPT_BUILDER_TOKEN = Symbol('PROMPT_BUILDER_TOKEN');
export const SKILL_SELECTOR_TOKEN = Symbol('SKILL_SELECTOR_TOKEN');
export const NARRATIVE_ENGINE_TOKEN = Symbol('NARRATIVE_ENGINE_TOKEN');
export const EVENT_DIGESTER_TOKEN = Symbol('EVENT_DIGESTER_TOKEN');
export const DECOMPOSITION_ADVISOR_TOKEN = Symbol('DECOMPOSITION_ADVISOR_TOKEN');

// Executors
export const EXECUTOR_TOKEN = Symbol('EXECUTOR_TOKEN');
export const WORKER_SERVICE_TOKEN = Symbol('WORKER_SERVICE_TOKEN');
export const MCP_BRIDGE_TOKEN = Symbol('MCP_BRIDGE_TOKEN');
export const EXECUTION_ENGINE_TOKEN = Symbol('EXECUTION_ENGINE_TOKEN');
export const MCP_IPC_SERVER_TOKEN = Symbol('MCP_IPC_SERVER_TOKEN');
