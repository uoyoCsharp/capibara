import { injectable } from 'tsyringe';
import type { ITaskRepository } from '@core/modules/workflow/interfaces/i-task.repository';
import type { IRoleRepository } from '@core/modules/organization/interfaces/i-role.repository';
import type { ISkillRepository } from '@core/modules/organization/interfaces/i-skill.repository';
import type { IOrganizationRepository } from '@core/modules/organization/interfaces/i-organization.repository';
import type { ConversationContextBuilder } from '@core/modules/conversation/context/conversation-context.builder';
import type { IConversationRepository } from '@core/modules/conversation/interfaces/i-conversation.repository';
import type { ProcessEngine } from '@core/modules/workflow/engines/process.engine';
import type { PromptContext, ConversationPromptContext, WakeReason } from '../types/prompt.types';

export interface IPlanTreeFeedbackProvider {
  consumePendingFeedback(rootTaskId: string): string | null;
  consumePendingFeedbackByConversation?(conversationId: string): string | null;
}

@injectable()
export class RunContext {
  private feedbackProvider: IPlanTreeFeedbackProvider | null = null;

  constructor(
    private readonly taskRepo: ITaskRepository,
    private readonly roleRepo: IRoleRepository,
    private readonly skillRepo: ISkillRepository,
    private readonly convRepo: IConversationRepository,
    private readonly convContextBuilder: ConversationContextBuilder,
    private readonly processEngine: ProcessEngine,
    private readonly orgRepo: IOrganizationRepository,
  ) {}

  setFeedbackProvider(provider: IPlanTreeFeedbackProvider): void {
    this.feedbackProvider = provider;
  }

  buildForTask(taskId: string, roleId: string, locale: string, wakeReason: WakeReason): PromptContext | null {
    const task = this.taskRepo.findById(taskId);
    if (!task) return null;
    const role = this.roleRepo.findById(roleId);
    if (!role) return null;

    const parentChain = this.getParentChain(taskId);
    const rawSiblings = task.parentId
      ? this.taskRepo.findChildren(task.parentId)
      : [];
    const siblings = rawSiblings.map((s) => {
      const assigneeRole = s.assigneeRoleId ? this.roleRepo.findById(s.assigneeRoleId) : null;
      return {
        id: s.id,
        type: s.type,
        title: s.title,
        status: s.status,
        assigneeRoleName: assigneeRole?.name ?? null,
        isCurrent: s.id === taskId,
      };
    });

    const skills = role.skillIds
      .map((id) => this.skillRepo.findById(id))
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .map((s) => ({ name: s.name, command: s.command, description: s.description }));

    const typeDef = this.processEngine.getWorkItemType(task.orgId, task.type);
    const statusCategory = this.processEngine.getStatusCategory(task.orgId, task.status);
    const children = this.taskRepo.findChildren(taskId);

    const org = this.orgRepo.findById(task.orgId);
    const organization = org ? { name: org.name, customInstructions: org.customInstructions } : undefined;

    const parentRole = role.parentId ? this.roleRepo.findById(role.parentId) : null;
    const subordinateRoles = this.roleRepo.findChildren(role.id);
    const peerRoles = role.parentId
      ? this.roleRepo.findChildren(role.parentId).filter((r) => r.id !== role.id)
      : [];

    const subordinates = subordinateRoles.map((sub) => ({
      id: sub.id,
      name: sub.name,
      skillDescriptions: sub.skillIds
        .map((id) => this.skillRepo.findById(id))
        .filter((s): s is NonNullable<typeof s> => s !== null)
        .map((s) => s.description),
    }));

    const orgHierarchy = {
      parentRole: parentRole ? { id: parentRole.id, name: parentRole.name } : null,
      subordinates,
      peers: peerRoles.map((r) => ({ id: r.id, name: r.name })),
    };

    const schema = this.processEngine.getSchema(task.orgId);
    const allTypes = schema?.workItemTypes ?? [];
    const typeSchema = allTypes.length > 0 ? {
      allTypes: allTypes.map((t) => ({
        name: t.name, label: t.label, isLeaf: t.isLeaf,
        canDecompose: t.canDecompose, allowedChildren: t.allowedChildren, allowedAtRoot: t.allowedAtRoot,
      })),
      currentTypeDef: typeDef ? {
        name: typeDef.name, label: typeDef.label, isLeaf: typeDef.isLeaf,
        canDecompose: typeDef.canDecompose, allowedChildren: typeDef.allowedChildren,
      } : null,
    } : undefined;

    const allStatuses = schema?.statuses ?? [];
    const allTransitions = schema?.transitions ?? [];
    const currentStatusDef = allStatuses.find((s) => s.name === task.status);
    const availableTransitions = allTransitions
      .filter((t) => t.from === task.status)
      .map((t) => {
        const targetDef = allStatuses.find((s) => s.name === t.to);
        return { targetStatus: t.to, targetLabel: targetDef?.label ?? t.to };
      });
    const terminalStatuses = allStatuses.filter((s) => s.category === 'terminal').map((s) => s.name);

    const workflowSchema = currentStatusDef ? {
      currentStatus: { name: currentStatusDef.name, label: currentStatusDef.label, category: currentStatusDef.category },
      availableTransitions,
      allStatuses: allStatuses.map((s) => ({ name: s.name, label: s.label, category: s.category })),
      allTransitions: allTransitions.map((t) => ({ from: t.from, to: t.to })),
      terminalStatuses,
    } : undefined;

    return {
      wakeReason,
      task: {
        id: task.id,
        type: task.type,
        title: task.title,
        description: task.description,
        status: task.status,
        orgId: task.orgId,
        hasChildren: children.length > 0,
        isDecomposable: typeDef?.canDecompose ?? false,
        planningMode: task.planningMode,
        pendingFeedback:
          (typeDef?.canDecompose && (task.planningMode === 'preview' || task.planningMode === 'eager'))
            ? (this.feedbackProvider?.consumePendingFeedback(task.id) ?? null)
            : null,
        allowedChildTypes: typeDef?.allowedChildren ?? [],
        isTerminal: statusCategory === 'terminal',
        parentChain: parentChain.map((t) => ({ id: t.id, type: t.type, title: t.title, status: t.status })),
        siblings,
      },
      role: {
        id: role.id,
        name: role.name,
        persona: role.persona,
        knowledgeBaseRefs: role.knowledgeBaseRefs,
      },
      skills,
      locale,
      organization,
      orgHierarchy,
      typeSchema,
      workflowSchema,
    };
  }

  buildForConversation(
    conversationId: string,
    roleId: string,
    locale: string,
    options?: { forceFullContext?: boolean },
  ): ConversationPromptContext | null {
    // On rebuild (ADR-6) the agent-side session is gone, so the recent-window summary is not
    // enough — reconstruct from the full message history (maxMessages = 0 means "no cap").
    const convContext = this.convContextBuilder.build(
      conversationId,
      options?.forceFullContext ? 0 : undefined,
    );
    if (!convContext) return null;
    const role = this.roleRepo.findById(roleId);
    if (!role) return null;

    let taskData: ConversationPromptContext['task'] = null;
    if (convContext.taskId) {
      const task = this.taskRepo.findById(convContext.taskId);
      if (task) {
        const typeDef = this.processEngine.getWorkItemType(task.orgId, task.type);
        taskData = {
          id: task.id,
          type: task.type,
          title: task.title,
          description: task.description,
          status: task.status,
          isDecomposable: typeDef?.canDecompose ?? false,
        };
      }
    }

    const skills = role.skillIds
      .map((id) => this.skillRepo.findById(id))
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .map((s) => ({ name: s.name, command: s.command, description: s.description }));

    const conv = this.convRepo.findById(conversationId);
    const orgId = conv?.orgId ?? '';

    const ctx: ConversationPromptContext = {
      conversation: {
        id: convContext.conversationId,
        type: convContext.type,
        state: convContext.state,
        orgId,
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

    // Planning conversations need type schema + roster of available roles so
    // the AI can submit a concrete tree with valid types and assignees.
    if (convContext.type === 'planning' && orgId) {
      const schema = this.processEngine.getSchema(orgId);
      if (schema) {
        ctx.typeSchema = {
          allTypes: schema.workItemTypes.map((t) => ({
            name: t.name,
            label: t.label,
            isLeaf: t.isLeaf,
            canDecompose: t.canDecompose,
            allowedChildren: t.allowedChildren,
            allowedAtRoot: t.allowedAtRoot,
          })),
        };
      }

      const orgRoles = this.roleRepo.findByOrgId(orgId).filter((r) => !r.isSystemRole);
      ctx.orgRoles = orgRoles.map((r) => ({
        id: r.id,
        name: r.name,
        skillDescriptions: r.skillIds
          .map((sid) => this.skillRepo.findById(sid))
          .filter((s): s is NonNullable<typeof s> => s !== null)
          .map((s) => s.description),
      }));

      if (this.feedbackProvider?.consumePendingFeedbackByConversation) {
        ctx.pendingFeedback = this.feedbackProvider.consumePendingFeedbackByConversation(conversationId);
      }
    }

    return ctx;
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
