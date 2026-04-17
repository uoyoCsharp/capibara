import { injectable } from 'tsyringe';
import type { ITaskRepository } from '@core/modules/workflow/interfaces/i-task.repository';
import type { IRoleRepository } from '@core/modules/organization/interfaces/i-role.repository';
import type { ISkillRepository } from '@core/modules/organization/interfaces/i-skill.repository';
import type { ConversationContextBuilder } from '@core/modules/conversation/context/conversation-context.builder';
import type { IConversationRepository } from '@core/modules/conversation/interfaces/i-conversation.repository';
import type { PromptContext, ConversationPromptContext } from '../types/prompt.types';

@injectable()
export class RunContext {
  constructor(
    private readonly taskRepo: ITaskRepository,
    private readonly roleRepo: IRoleRepository,
    private readonly skillRepo: ISkillRepository,
    private readonly convRepo: IConversationRepository,
    private readonly convContextBuilder: ConversationContextBuilder,
  ) {}

  buildForTask(taskId: string, roleId: string, locale: string): PromptContext | null {
    const task = this.taskRepo.findById(taskId);
    if (!task) return null;
    const role = this.roleRepo.findById(roleId);
    if (!role) return null;

    const parentChain = this.getParentChain(taskId);
    const siblings = task.parentId
      ? this.taskRepo.findChildren(task.parentId).filter((t) => t.id !== taskId)
      : [];

    const skills = role.skillIds
      .map((id) => this.skillRepo.findById(id))
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .map((s) => ({ name: s.name, command: s.command, description: s.description }));

    return {
      task: {
        id: task.id,
        type: task.type,
        title: task.title,
        description: task.description,
        status: task.status,
        parentChain: parentChain.map((t) => ({ id: t.id, type: t.type, title: t.title, status: t.status })),
        siblings: siblings.map((t) => ({ id: t.id, type: t.type, title: t.title, status: t.status })),
      },
      role: {
        id: role.id,
        name: role.name,
        persona: role.persona,
        knowledgeBaseRefs: role.knowledgeBaseRefs,
      },
      skills,
      locale,
    };
  }

  buildForConversation(conversationId: string, roleId: string, locale: string): ConversationPromptContext | null {
    const convContext = this.convContextBuilder.build(conversationId);
    if (!convContext) return null;
    const role = this.roleRepo.findById(roleId);
    if (!role) return null;

    let taskData: ConversationPromptContext['task'] = null;
    if (convContext.taskId) {
      const task = this.taskRepo.findById(convContext.taskId);
      if (task) {
        taskData = { id: task.id, type: task.type, title: task.title, description: task.description, status: task.status };
      }
    }

    const skills = role.skillIds
      .map((id) => this.skillRepo.findById(id))
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .map((s) => ({ name: s.name, command: s.command, description: s.description }));

    return {
      conversation: {
        id: convContext.conversationId,
        type: convContext.type,
        state: convContext.state,
        messageHistory: convContext.messageHistory,
      },
      task: taskData,
      role: {
        id: role.id,
        name: role.name,
        persona: role.persona,
        knowledgeBaseRefs: role.knowledgeBaseRefs,
      },
      skills,
      locale,
    };
  }

  private getParentChain(taskId: string): Array<{ id: string; type: string; title: string; status: string }> {
    const chain: Array<{ id: string; type: string; title: string; status: string }> = [];
    let current = this.taskRepo.findById(taskId);
    while (current?.parentId) {
      const parent = this.taskRepo.findById(current.parentId);
      if (!parent) break;
      chain.push(parent);
      current = parent;
    }
    return chain;
  }
}
