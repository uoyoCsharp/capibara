import { container } from 'tsyringe';
import {
  TASK_REPO_TOKEN,
  TASK_SERVICE_TOKEN,
  TASK_STATE_MACHINE_TOKEN,
  PROCESS_ENGINE_TOKEN,
  BEHAVIOR_ENGINE_TOKEN,
  PROCESS_SCHEMA_REPO_TOKEN,
  PROCESS_TEMPLATE_SERVICE_TOKEN,
  TASK_DEPENDENCY_REPO_TOKEN,
  TASK_DEPENDENCY_SERVICE_TOKEN,
} from '@core/foundation/tokens';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';
import type { IEventPublisher } from '@core/foundation/interfaces/i-event-publisher';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { IRoleRepository } from '@core/modules/organization/interfaces/i-role.repository';
import { SqliteTaskRepository } from '@core/modules/workflow/persistence/sqlite-task.repository';
import { SqliteTaskDependencyRepository } from '@core/modules/workflow/persistence/sqlite-task-dependency.repository';
import { SqliteProcessSchemaRepository } from '@core/modules/workflow/persistence/sqlite-process-schema.repository';
import { ProcessEngine } from '@core/modules/workflow/engines/process.engine';
import { TaskStateMachine } from '@core/modules/workflow/engines/task.state-machine';
import { BehaviorEngine } from '@core/modules/workflow/engines/behavior.engine';
import { TaskService } from '@core/modules/workflow/services/task.service';
import { TaskDependencyService } from '@core/modules/workflow/services/task-dependency.service';
import { ProcessTemplateService } from '@core/modules/workflow/services/process-template.service';

export interface WorkflowModule {
  taskRepo: SqliteTaskRepository;
  taskDependencyRepo: SqliteTaskDependencyRepository;
  taskService: TaskService;
  taskDependencyService: TaskDependencyService;
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
  const taskDependencyRepo = new SqliteTaskDependencyRepository(connection);
  const schemaRepo = new SqliteProcessSchemaRepository(connection);
  const processEngine = new ProcessEngine(schemaRepo, logger);
  const taskStateMachine = new TaskStateMachine(taskRepo, roleRepo, processEngine, eventPublisher, logger);
  const behaviorEngine = new BehaviorEngine(taskRepo, processEngine, taskStateMachine, logger);
  taskStateMachine.setBehaviorEngine(behaviorEngine);
  taskStateMachine.setDependencyRepo(taskDependencyRepo);
  behaviorEngine.setDependencyRepo(taskDependencyRepo);
  const taskService = new TaskService(taskRepo, processEngine, eventPublisher);
  taskService.setDependencyRepo(taskDependencyRepo);
  const taskDependencyService = new TaskDependencyService(taskDependencyRepo, taskRepo);
  const processTemplateService = new ProcessTemplateService(logger, workflowsDir);

  container.register(TASK_REPO_TOKEN, { useValue: taskRepo });
  container.register(TASK_DEPENDENCY_REPO_TOKEN, { useValue: taskDependencyRepo });
  container.register(TASK_SERVICE_TOKEN, { useValue: taskService });
  container.register(TASK_DEPENDENCY_SERVICE_TOKEN, { useValue: taskDependencyService });
  container.register(TASK_STATE_MACHINE_TOKEN, { useValue: taskStateMachine });
  container.register(PROCESS_ENGINE_TOKEN, { useValue: processEngine });
  container.register(BEHAVIOR_ENGINE_TOKEN, { useValue: behaviorEngine });
  container.register(PROCESS_SCHEMA_REPO_TOKEN, { useValue: schemaRepo });
  container.register(PROCESS_TEMPLATE_SERVICE_TOKEN, { useValue: processTemplateService });

  return { taskRepo, taskDependencyRepo, taskService, taskDependencyService, processEngine, taskStateMachine, behaviorEngine, processTemplateService };
}
