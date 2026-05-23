import { injectable } from 'tsyringe';
import type { IRunEngine } from '@core/modules/execution/interfaces/i-run-engine';
import type { PromptBuilder } from '@core/modules/prompt/builder/prompt.builder';
import type { IConversationRepository } from '@core/modules/conversation/interfaces/i-conversation.repository';
import type { IOrganizationRepository } from '@core/modules/organization/interfaces/i-organization.repository';
import type { ConversationService } from '@core/modules/conversation/services/conversation.service';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { WakeReason } from '@core/modules/execution/types/execution.types';
import type { ResumeDecision } from '@core/modules/acp/collaboration/suspension.types';

@injectable()
export class RunCoordinator {
  constructor(
    private readonly runEngine: IRunEngine,
    private readonly promptBuilder: PromptBuilder,
    private readonly convRepo: IConversationRepository,
    private readonly conversationService: ConversationService,
    private readonly orgRepo: IOrganizationRepository,
    private readonly logger: ILogger,
  ) {}

  async executeForTask(
    taskId: string,
    roleId: string,
    orgId: string,
    wakeReason: WakeReason,
    locale: string,
  ): Promise<{ runId: string; status: string }> {
    const prompt = this.promptBuilder.buildForTask(taskId, roleId, locale, wakeReason);
    if (!prompt) {
      this.logger.error('Failed to build prompt for task', { taskId, roleId });
      return { runId: '', status: 'failed' };
    }

    const org = this.orgRepo.findById(orgId);
    const projectDir = org?.workspacePath || undefined;

    const result = await this.runEngine.execute({
      roleId,
      orgId,
      prompt,
      contextId: taskId,
      contextLabel: orgId,
      taskId,
      wakeReason,
      projectDir,
    });

    return { runId: result.runId, status: result.status };
  }

  async executeForConversation(
    conversationId: string,
    roleId: string,
    orgId: string,
    locale: string,
  ): Promise<{ runId: string; status: string }> {
    const conv = this.convRepo.findById(conversationId);
    if (!conv) {
      this.logger.error('Conversation not found', { conversationId });
      return { runId: '', status: 'failed' };
    }

    const prompt = this.promptBuilder.buildForConversation(conversationId, roleId, locale);
    if (!prompt) {
      this.logger.error('Failed to build prompt for conversation', { conversationId, roleId });
      return { runId: '', status: 'failed' };
    }

    const org = this.orgRepo.findById(orgId);
    const projectDir = org?.workspacePath || undefined;

    const result = await this.runEngine.execute({
      roleId,
      orgId,
      prompt,
      contextId: conversationId,
      contextLabel: orgId,
      conversationId,
      wakeReason: 'conversation_reply',
      sessionId: conv.externalSessionId ?? undefined,
      projectDir,
    });

    if (result.sessionId && !conv.externalSessionId) {
      this.conversationService.updateExternalSessionId(conversationId, result.sessionId);
    }

    if (result.status === 'succeeded' && result.summary) {
      this.conversationService.addMessage(conversationId, {
        conversationId,
        authorRoleId: roleId,
        authorType: 'ai',
        content: result.summary,
        intent: 'reply',
      });
    }

    return { runId: result.runId, status: result.status };
  }

  /**
   * Resume a previously suspended run with aggregated inquiry replies.
   */
  async executeResume(
    decision: ResumeDecision,
    locale: string,
  ): Promise<{ runId: string; status: string }> {
    const org = this.orgRepo.findById(decision.orgId);
    const projectDir = org?.workspacePath || undefined;

    const result = await this.runEngine.execute({
      roleId: decision.roleId,
      orgId: decision.orgId,
      prompt: decision.aggregatedReply,
      contextId: decision.taskId || decision.sessionId,
      contextLabel: decision.orgId,
      taskId: decision.taskId ?? undefined,
      wakeReason: 'conversation_reply',
      sessionId: decision.acpSessionId,
      projectDir,
    });

    return { runId: result.runId, status: result.status };
  }
}
