import { injectable } from 'tsyringe';
import type { IRunEngine } from '@core/modules/execution/interfaces/i-run-engine';
import type { IRunRepository } from '@core/modules/execution/interfaces/i-run.repository';
import type { PromptBuilder } from '@core/modules/prompt/builder/prompt.builder';
import type { IConversationRepository } from '@core/modules/conversation/interfaces/i-conversation.repository';
import type { IOrganizationRepository } from '@core/modules/organization/interfaces/i-organization.repository';
import type { IConversationCommandService } from '@core/modules/conversation/interfaces/i-conversation-command.service';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { LifecycleIntent, WakeReason } from '@core/modules/execution/types/execution.types';
import type { ResumeDecision } from '@core/modules/acp/collaboration/suspension.types';
import type { ITaskRepository } from '@core/modules/workflow/interfaces/i-task.repository';
import type { IProcessEngine } from '@core/modules/workflow/interfaces/i-process.engine';
import type { ITaskStateMachine } from '@core/modules/workflow/interfaces/i-task.state-machine';

@injectable()
export class RunCoordinator {
  constructor(
    private readonly runEngine: IRunEngine,
    private readonly runRepo: IRunRepository,
    private readonly promptBuilder: PromptBuilder,
    private readonly convRepo: IConversationRepository,
    private readonly conversationService: IConversationCommandService,
    private readonly orgRepo: IOrganizationRepository,
    private readonly logger: ILogger,
    private readonly taskRepo: ITaskRepository,
    private readonly processEngine: IProcessEngine,
    private readonly taskStateMachine: ITaskStateMachine,
  ) {}

  async executeForTask(
    taskId: string,
    roleId: string,
    orgId: string,
    wakeReason: WakeReason,
    locale: string,
  ): Promise<{ runId: string; status: string }> {
    this.advanceTaskToActive(taskId, orgId);

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
      lifecycleIntent: 'close_on_complete',
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
      lifecycleIntent: 'keep_alive',
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
   * Cancel the active run associated with a conversation (if any).
   * Used when a conversation is cancelled to tear down in-flight agent execution.
   */
  async cancelForConversation(conversationId: string): Promise<void> {
    const run = this.runRepo.findByConversationId(conversationId);
    if (!run || run.status !== 'running') {
      this.logger.debug('No active run to cancel for conversation', { conversationId });
      return;
    }
    try {
      await this.runEngine.cancelRun(run.id);
      this.logger.info('Cancelled run for conversation', { conversationId, runId: run.id });
    } catch (err) {
      this.logger.warn('Failed to cancel run for conversation', {
        conversationId,
        runId: run.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
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

    // a suspended planning conversation resumes keeping the session alive.
    const lifecycleIntent: LifecycleIntent = decision.taskId ? 'close_on_complete' : 'keep_alive';

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
      lifecycleIntent,
    });

    return { runId: result.runId, status: result.status };
  }

  private advanceTaskToActive(taskId: string, orgId: string): void {
    const task = this.taskRepo.findById(taskId);
    if (!task) return;

    const currentCategory = this.processEngine.getStatusCategory(orgId, task.status);
    if (currentCategory === 'active') return;
    if (currentCategory !== 'initial') return;

    const transitions = this.processEngine.getAvailableTransitions(orgId, task.status);
    const target = transitions.find(
      (t) => this.processEngine.getStatusCategory(orgId, t.to) === 'active',
    );
    if (!target) return;

    try {
      this.taskStateMachine.transition(taskId, target.to, { triggeredBy: 'system' });
    } catch (err) {
      this.logger.error('Failed to advance task to active', {
        taskId, target: target.to, error: String(err),
      });
    }
  }
}
