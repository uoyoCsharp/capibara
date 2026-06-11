import { container } from 'tsyringe';
import {
  TASK_REPO_TOKEN,
  TASK_SERVICE_TOKEN,
  TASK_STATE_MACHINE_TOKEN,
  PROCESS_ENGINE_TOKEN,
  BEHAVIOR_ENGINE_TOKEN,
  PROCESS_SCHEMA_REPO_TOKEN,
  PROCESS_TEMPLATE_SERVICE_TOKEN,
} from '@core/foundation/tokens';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';
import type { IEventPublisher } from '@core/foundation/interfaces/i-event-publisher';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { IRoleRepository } from '@core/modules/organization/interfaces/i-role.repository';
import { SqliteTaskRepository } from '@core/modules/workflow/persistence/sqlite-task.repository';
import { SqliteProcessSchemaRepository } from '@core/modules/workflow/persistence/sqlite-process-schema.repository';
import { ProcessEngine } from '@core/modules/workflow/engines/process.engine';
import { TaskStateMachine } from '@core/modules/workflow/engines/task.state-machine';
import { BehaviorEngine } from '@core/modules/workflow/engines/behavior.engine';
import { TaskService } from '@core/modules/workflow/services/task.service';
import { ProcessTemplateService } from '@core/modules/workflow/services/process-template.service';

export interface WorkflowModule {
  taskRepo: SqliteTaskRepository;
  taskService: TaskService;
  processEngine: ProcessEngine;
  taskStateMachine: TaskStateMachine;
  behaviorEngine: BehaviorEngine;
  processTemplateService: ProcessTemplateService;
}

export function registerWorkflowModule(
  connection: ISqliteConnection,
  eventPublisher: IEventPublisher,
  logger: ILogger,
  workflowsDir: string,
  roleRepo: IRoleRepository,
): WorkflowModule {
  const taskRepo = new SqliteTaskRepository(connection);
  const schemaRepo = new SqliteProcessSchemaRepository(connection);
  const processEngine = new ProcessEngine(schemaRepo, logger);
  const taskStateMachine = new TaskStateMachine(taskRepo, roleRepo, processEngine, eventPublisher, logger);
  const behaviorEngine = new BehaviorEngine(taskRepo, processEngine, taskStateMachine, logger);
  taskStateMachine.setBehaviorEngine(behaviorEngine);
  const taskService = new TaskService(taskRepo, processEngine, eventPublisher);
  const processTemplateService = new ProcessTemplateService(logger, workflowsDir);

  container.register(TASK_REPO_TOKEN, { useValue: taskRepo });
  container.register(TASK_SERVICE_TOKEN, { useValue: taskService });
  container.register(TASK_STATE_MACHINE_TOKEN, { useValue: taskStateMachine });
  container.register(PROCESS_ENGINE_TOKEN, { useValue: processEngine });
  container.register(BEHAVIOR_ENGINE_TOKEN, { useValue: behaviorEngine });
  container.register(PROCESS_SCHEMA_REPO_TOKEN, { useValue: schemaRepo });
  container.register(PROCESS_TEMPLATE_SERVICE_TOKEN, { useValue: processTemplateService });

  return { taskRepo, taskService, processEngine, taskStateMachine, behaviorEngine, processTemplateService };
}
