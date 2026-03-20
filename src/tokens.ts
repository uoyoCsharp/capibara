/**
 * DI Token Definitions - All dependency injection identifiers are managed here
 * Uses string tokens for ESM compatibility
 * @module tokens
 */

// ---------- Core Roles ----------
export const WORKER_TOKEN = 'IWorker';
export const EVALUATOR_TOKEN = 'IEvaluator[]';
export const CONDUCTOR_TOKEN = 'IConductor';
export const MESSENGER_TOKEN = 'IMessenger';
export const TRIGGER_TOKEN = 'ITrigger';

// ---------- Infrastructure ----------
export const CLI_ADAPTER_TOKEN = 'ClaudeCliAdapter';
export const COMMAND_EXECUTOR_TOKEN = 'ICommandExecutor';
export const STATE_STORE_TOKEN = 'IStateStore';
export const ARTIFACT_STORE_TOKEN = 'IArtifactStore';
export const EVENT_BUS_TOKEN = 'IEventBus';
export const COST_TRACKER_TOKEN = 'CostTracker';
export const PIPELINE_DEFINITION_LOADER_TOKEN = 'PipelineDefinitionLoader';

// ---------- Persistence ----------
export const SQLITE_STORE_TOKEN = 'SqliteStore';
export const REQUIREMENT_POOL_TOKEN = 'IRequirementPool';
export const PROJECT_REGISTRY_TOKEN = 'IProjectRegistry';

// ---------- Cross-Cutting Concerns ----------
export const CONFIG_TOKEN = 'AutomationConfig';
export const LOGGER_TOKEN = 'Logger';
