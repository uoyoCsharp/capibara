import type { IConversationWorkflowService, CreateWorkflowInput } from '@main/core/interfaces/i-conversation-workflow.service.js';
import type { IConversationWorkflowRepository } from '@main/core/interfaces/i-conversation-workflow.repository.js';
import type { IRoutingPolicyEngine } from '@main/core/interfaces/i-routing-policy-engine.js';
import type { IDiscussionRepository } from '@main/core/interfaces/i-discussion.repository.js';
import type { IPendingWakeRepository } from '@main/core/interfaces/i-pending-wake.repository.js';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { ConversationWorkflow, ConversationWorkflowState, TimeoutConfig } from '@main/core/types/conversation.types.js';
import { canTransition } from '@main/core/types/conversation.types.js';
import type { ConversationEventLogger } from '@main/infrastructure/persistence/sqlite/conversation-event.logger.js';

const DEFAULT_TIMEOUT: TimeoutConfig = {
  normalTimeoutMs: 300_000,
  urgentTimeoutMs: 60_000,
  maxEscalationLevels: 3,
  scanIntervalMs: 15_000,
};

export class ConversationWorkflowService implements IConversationWorkflowService {
  constructor(
    private readonly workflowRepo: IConversationWorkflowRepository,
    private readonly routingEngine: IRoutingPolicyEngine,
    private readonly discussionRepo: IDiscussionRepository,
    private readonly pendingWakeRepo: IPendingWakeRepository,
    private readonly eventBus: IEventBus,
    private readonly logger: ILogger,
    private readonly eventLogger: ConversationEventLogger,
    private readonly timeoutConfig: TimeoutConfig = DEFAULT_TIMEOUT,
  ) {}

  async createWorkflow(input: CreateWorkflowInput): Promise<ConversationWorkflow> {
    // 1. Find or create discussion group
    let group = await this.discussionRepo.findGroupByTaskNodeId(input.taskNodeId);
    if (!group) {
      group = await this.discussionRepo.createGroup({
        taskNodeId: input.taskNodeId,
        orgId: input.orgId,
      });
    }

    // 2. Post question as DiscussionMessage
    const questionMsg = await this.discussionRepo.postMessage({
      groupId: group.id,
      authorRoleId: input.askingRoleId,
      authorType: 'ai',
      content: input.question,
      voteTag: null,
      intent: 'question',
    });

    // 3. Route the question
    const routingDecision = await this.routingEngine.resolve({
      askingRoleId: input.askingRoleId,
      orgId: input.orgId,
      taskNodeId: input.taskNodeId,
      recipientTarget: input.recipientTarget,
      questionContent: input.question,
      conversationDepth: 0,
    });

    // 4. Calculate timeout
    const timeoutMs = input.urgency === 'urgent'
      ? this.timeoutConfig.urgentTimeoutMs
      : this.timeoutConfig.normalTimeoutMs;
    const timeoutAt = new Date(Date.now() + timeoutMs).toISOString();

    // 5. Create workflow
    const workflow = await this.workflowRepo.create({
      orgId: input.orgId,
      taskNodeId: input.taskNodeId,
      discussionGroupId: group.id,
      askingRoleId: input.askingRoleId,
      askingRunId: input.askingRunId,
      askingSessionId: input.askingSessionId,
      questionMessageId: questionMsg.id,
      respondentRoleId: routingDecision.respondentRoleId,
      respondentType: routingDecision.respondentType,
      state: 'waiting_for_reply',
      depth: 0,
      parentWorkflowId: null,
      priority: routingDecision.priority,
      timeoutAt,
      auditReason: routingDecision.auditReason,
    });

    // 6. Create PendingWake for respondent (if AI)
    if (routingDecision.respondentType === 'ai' && routingDecision.respondentRoleId) {
      await this.pendingWakeRepo.create({
        roleId: routingDecision.respondentRoleId,
        orgId: input.orgId,
        trigger: 'discussion_reply',
        taskNodeId: input.taskNodeId,
        priority: routingDecision.priority,
      });
    }

    // 7. Emit event (include notification-relevant fields for EventBroadcaster)
    this.eventBus.emit({
      type: 'conversation:question-posted',
      timestamp: new Date().toISOString(),
      payload: {
        workflowId: workflow.id,
        orgId: input.orgId,
        taskNodeId: input.taskNodeId,
        askingRoleId: input.askingRoleId,
        askingRoleName: input.askingRoleId, // UI resolves actual name
        questionPreview: input.question.slice(0, 100),
        urgency: input.urgency,
        respondentRoleId: routingDecision.respondentRoleId,
        respondentType: routingDecision.respondentType,
        priority: routingDecision.priority,
      },
    });

    // 8. Log audit events
    this.eventLogger.log(workflow.id, 'question_posted', {
      questionContent: input.question,
      recipientTarget: input.recipientTarget,
    });
    this.eventLogger.log(workflow.id, 'routing_decided', {
      decision: routingDecision,
    });

    // 9. Log human gate enforcement audit (Story 12.1)
    if (input.recipientTarget.type === 'human' && routingDecision.wasRewritten) {
      this.eventLogger.log(workflow.id, 'human_gate_enforced', {
        originalTarget: input.recipientTarget,
        rewrittenTarget: { type: routingDecision.respondentType === 'human' ? 'human' : 'supervisor' },
        requiresHumanApproval: false,
        auditReason: routingDecision.auditReason,
      });
    }

    this.logger.info('Conversation workflow created', {
      workflowId: workflow.id,
      askingRoleId: input.askingRoleId,
      respondentRoleId: routingDecision.respondentRoleId,
      respondentType: routingDecision.respondentType,
      auditReason: routingDecision.auditReason,
    });

    return workflow;
  }

  async handleReply(workflowId: string, messageId: string): Promise<void> {
    const workflow = await this.workflowRepo.findById(workflowId);
    if (!workflow) {
      this.logger.warn('handleReply: workflow not found', { workflowId });
      return;
    }
    if (workflow.state !== 'waiting_for_reply') {
      this.logger.warn('handleReply: workflow not in waiting_for_reply state', {
        workflowId,
        state: workflow.state,
      });
      return;
    }

    // 1. Update reply message
    await this.workflowRepo.updateReply(workflowId, messageId);

    // 2. Create PendingWake for asking role BEFORE state transition
    //    so if wake creation fails, workflow stays in waiting_for_reply
    await this.pendingWakeRepo.create({
      roleId: workflow.askingRoleId,
      orgId: workflow.orgId,
      trigger: 'discussion_reply',
      taskNodeId: workflow.taskNodeId,
      priority: workflow.priority,
    });

    // 3. Transition state after wake is guaranteed
    await this.workflowRepo.updateState(workflowId, 'reply_received');

    // 3. Emit event
    const message = (await this.discussionRepo.findMessagesByGroupId(workflow.discussionGroupId))
      .find((m) => m.id === messageId);

    this.eventBus.emit({
      type: 'conversation:reply-posted',
      timestamp: new Date().toISOString(),
      payload: {
        workflowId: workflow.id,
        orgId: workflow.orgId,
        askingRoleId: workflow.askingRoleId,
        messageId,
        replierRoleId: message?.authorRoleId ?? null,
        replierType: message?.authorType ?? 'ai',
        workflow: { ...workflow, state: 'reply_received', replyMessageId: messageId },
      },
    });

    // 4. Log audit event
    this.eventLogger.log(workflowId, 'reply_posted', {
      messageId,
      replierRoleId: message?.authorRoleId ?? null,
    });

    this.logger.info('Conversation reply handled', {
      workflowId,
      askingRoleId: workflow.askingRoleId,
      messageId,
    });
  }

  async transitionState(workflowId: string, targetState: ConversationWorkflowState): Promise<void> {
    const workflow = await this.workflowRepo.findById(workflowId);
    if (!workflow) {
      this.logger.warn('transitionState: workflow not found', { workflowId });
      return;
    }

    const previousState = workflow.state;

    // Validate transition against the state machine
    if (!canTransition(previousState, targetState)) {
      this.logger.warn('transitionState: invalid transition', {
        workflowId,
        from: previousState,
        to: targetState,
      });
      return;
    }

    await this.workflowRepo.updateState(workflowId, targetState);

    // Emit event
    this.eventBus.emit({
      type: 'conversation:state-changed',
      timestamp: new Date().toISOString(),
      payload: {
        workflowId,
        orgId: workflow.orgId,
        previousState,
        newState: targetState,
        reason: `transition:${previousState}->${targetState}`,
      },
    });

    // Log audit
    this.eventLogger.log(workflowId, 'state_changed', {
      from: previousState,
      to: targetState,
    });

    this.logger.info('Conversation state transitioned', {
      workflowId,
      from: previousState,
      to: targetState,
    });
  }

  async createEscalatedWorkflow(
    parentWorkflow: ConversationWorkflow,
    newRespondentRoleId: string,
  ): Promise<ConversationWorkflow> {
    // Guard: enforce max escalation depth
    if (parentWorkflow.depth >= this.timeoutConfig.maxEscalationLevels) {
      throw new Error(
        `Max escalation depth (${this.timeoutConfig.maxEscalationLevels}) exceeded for workflow ${parentWorkflow.id}`,
      );
    }

    // Calculate new timeout
    const timeoutMs = this.timeoutConfig.normalTimeoutMs;
    const timeoutAt = new Date(Date.now() + timeoutMs).toISOString();

    // Create escalated workflow
    const escalatedWorkflow = await this.workflowRepo.create({
      orgId: parentWorkflow.orgId,
      taskNodeId: parentWorkflow.taskNodeId,
      discussionGroupId: parentWorkflow.discussionGroupId,
      askingRoleId: parentWorkflow.askingRoleId,
      askingRunId: parentWorkflow.askingRunId,
      askingSessionId: parentWorkflow.askingSessionId,
      questionMessageId: parentWorkflow.questionMessageId,
      respondentRoleId: newRespondentRoleId,
      respondentType: 'ai',
      state: 'waiting_for_reply',
      depth: parentWorkflow.depth + 1,
      parentWorkflowId: parentWorkflow.id,
      priority: 2,
      timeoutAt,
      auditReason: `escalated from workflow ${parentWorkflow.id} (depth ${parentWorkflow.depth})`,
    });

    // Post escalation message
    await this.discussionRepo.postMessage({
      groupId: parentWorkflow.discussionGroupId,
      authorRoleId: null,
      authorType: 'system',
      content: `Conversation escalated due to timeout. Original question has been forwarded to a higher-level role.`,
      voteTag: null,
      intent: 'escalation',
    });

    // Create PendingWake for new respondent
    await this.pendingWakeRepo.create({
      roleId: newRespondentRoleId,
      orgId: parentWorkflow.orgId,
      trigger: 'conversation_escalation',
      taskNodeId: parentWorkflow.taskNodeId,
      priority: 2,
    });

    // Emit event
    this.eventBus.emit({
      type: 'conversation:escalated',
      timestamp: new Date().toISOString(),
      payload: {
        workflowId: escalatedWorkflow.id,
        orgId: parentWorkflow.orgId,
        parentWorkflowId: parentWorkflow.id,
        respondentRoleId: newRespondentRoleId,
        depth: escalatedWorkflow.depth,
        workflow: escalatedWorkflow,
      },
    });

    // Log audit
    this.eventLogger.log(escalatedWorkflow.id, 'escalation_created', {
      parentWorkflowId: parentWorkflow.id,
      newRespondentRoleId,
      depth: escalatedWorkflow.depth,
    });

    this.logger.info('Escalated conversation workflow created', {
      workflowId: escalatedWorkflow.id,
      parentWorkflowId: parentWorkflow.id,
      newRespondentRoleId,
      depth: escalatedWorkflow.depth,
    });

    return escalatedWorkflow;
  }
}
