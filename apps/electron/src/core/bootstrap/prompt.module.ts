import { container } from 'tsyringe';
import { PROMPT_BUILDER_TOKEN, RUN_CONTEXT_TOKEN } from '@core/foundation/tokens';
import type { ITaskRepository } from '@core/modules/workflow/interfaces/i-task.repository';
import type { IRoleRepository } from '@core/modules/organization/interfaces/i-role.repository';
import type { ISkillRepository } from '@core/modules/organization/interfaces/i-skill.repository';
import type { IConversationRepository } from '@core/modules/conversation/interfaces/i-conversation.repository';
import type { ConversationContextBuilder } from '@core/modules/conversation/context/conversation-context.builder';
import type { IProcessEngine } from '@core/modules/workflow/interfaces/i-process.engine';
import type { IOrganizationRepository } from '@core/modules/organization/interfaces/i-organization.repository';
import { RunContext } from '@core/modules/prompt/context/run.context';
import { PromptBuilder } from '@core/modules/prompt/builder/prompt.builder';

export interface PromptModule {
  promptBuilder: PromptBuilder;
  runContext: RunContext;
}

export function registerPromptModule(
  taskRepo: ITaskRepository,
  roleRepo: IRoleRepository,
  skillRepo: ISkillRepository,
  convRepo: IConversationRepository,
  convContextBuilder: ConversationContextBuilder,
  processEngine: IProcessEngine,
  orgRepo: IOrganizationRepository,
): PromptModule {
  const runContext = new RunContext(taskRepo, roleRepo, skillRepo, convRepo, convContextBuilder, processEngine, orgRepo);
  const promptBuilder = new PromptBuilder(runContext);

  container.register(RUN_CONTEXT_TOKEN, { useValue: runContext });
  container.register(PROMPT_BUILDER_TOKEN, { useValue: promptBuilder });

  return { promptBuilder, runContext };
}
