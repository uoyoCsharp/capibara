import type { IConversationWorkflowRepository } from '@main/core/interfaces/i-conversation-workflow.repository.js';
import type { IConversationWorkflowService } from '@main/core/interfaces/i-conversation-workflow.service.js';
import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
import type { IPendingWakeRepository } from '@main/core/interfaces/i-pending-wake.repository.js';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { ConversationEventLogger } from '@main/infrastructure/persistence/sqlite/conversation-event.logger.js';
import type { TimeoutConfig } from '@main/core/types/conversation.types.js';

const DEFAULT_TIMEOUT: TimeoutConfig = {
  normalTimeoutMs: 300_000,
  urgentTimeoutMs: 60_000,
  maxEscalationLevels: 3,
  scanIntervalMs: 15_000,
};

export class TimeoutEscalationService {
  private scanHandle: ReturnType<typeof setInterval> | null = null;
  private isScanning = false;

  constructor(
    private readonly workflowRepo: IConversationWorkflowRepository,
    private readonly workflowService: IConversationWorkflowService,
    private readonly roleRepo: IRoleRepository,
    private readonly pendingWakeRepo: IPendingWakeRepository,
    private readonly eventBus: IEventBus,
    private readonly logger: ILogger,
    private readonly eventLogger: ConversationEventLogger,
    private readonly timeoutConfig: TimeoutConfig = DEFAULT_TIMEOUT,
  ) {}

  start(): void {
    if (this.scanHandle) return;
    this.scanHandle = setInterval(() => void this.scan(), this.timeoutConfig.scanIntervalMs);
    this.logger.info('TimeoutEscalationService started', {
      scanIntervalMs: this.timeoutConfig.scanIntervalMs,
    });
  }

  stop(): void {
    if (this.scanHandle) {
      clearInterval(this.scanHandle);
      this.scanHandle = null;
      this.logger.info('TimeoutEscalationService stopped');
    }
  }

  /** Recover orphaned workflows after a crash/restart. Must run before orchestrator.start(). */
  async recoverOrphaned(): Promise<void> {
    const now = new Date().toISOString();

    // 1. Recover waiting_for_reply workflows whose timeout has passed
    const expired = await this.workflowRepo.findExpiredWorkflows(now);
    for (const wf of expired) {
      this.logger.info('Crash recovery: escalating expired workflow', { workflowId: wf.id });
      await this.escalateOrTimeout(wf);
    }

    // 2. Recover reply_received workflows — re-create lost PendingWakes (with dedup)
    const allWorkflows = await this.workflowRepo.findByState('reply_received');
    for (const wf of allWorkflows) {
      const existingWakes = await this.pendingWakeRepo.findByRoleId(wf.askingRoleId);
      const alreadyExists = existingWakes.some(
        (w) => w.taskNodeId === wf.taskNodeId && w.trigger === 'discussion_reply',
      );
      if (alreadyExists) {
        this.logger.info('Crash recovery: wake already exists, skipping', {
          workflowId: wf.id,
          askingRoleId: wf.askingRoleId,
        });
        continue;
      }
      this.logger.info('Crash recovery: re-arming wake for reply_received workflow', {
        workflowId: wf.id,
        askingRoleId: wf.askingRoleId,
      });
      await this.pendingWakeRepo.create({
        roleId: wf.askingRoleId,
        orgId: wf.orgId,
        trigger: 'discussion_reply',
        taskNodeId: wf.taskNodeId,
        priority: wf.priority,
      });
    }

    if (expired.length > 0 || allWorkflows.length > 0) {
      this.logger.info('Crash recovery complete', {
        expiredEscalated: expired.length,
        replyRecoveredWakes: allWorkflows.length,
      });
    }
  }

  private async scan(): Promise<void> {
    if (this.isScanning) return;
    this.isScanning = true;
    try {
      const now = new Date().toISOString();
      const expired = await this.workflowRepo.findExpiredWorkflows(now);
      if (expired.length === 0) return;

      this.logger.info('Timeout scan found expired workflows', { count: expired.length });

      for (const workflow of expired) {
        await this.escalateOrTimeout(workflow);
      }
    } catch (err) {
      this.logger.error('Timeout scan failed', { error: String(err) });
    } finally {
      this.isScanning = false;
    }
  }

  private async escalateOrTimeout(
    workflow: import('@main/core/types/conversation.types.js').ConversationWorkflow,
  ): Promise<void> {
    try {
      const elapsed = Date.now() - new Date(workflow.createdAt).getTime();

      // Log timeout event
      this.eventLogger.log(workflow.id, 'timeout_triggered', {
        elapsedMs: elapsed,
        depth: workflow.depth,
        respondentRoleId: workflow.respondentRoleId,
      });

      // Check if we've reached max escalation levels
      if (workflow.depth >= this.timeoutConfig.maxEscalationLevels) {
        await this.forceHumanEscalation(workflow, 'max_escalation_depth_reached');
        return;
      }

      // Find the respondent's parent role for escalation
      if (!workflow.respondentRoleId) {
        await this.forceHumanEscalation(workflow, 'no_respondent_role');
        return;
      }

      const respondentRole = await this.roleRepo.findById(workflow.respondentRoleId);
      if (!respondentRole || !respondentRole.parentId) {
        // Top of hierarchy — force human escalation
        await this.forceHumanEscalation(workflow, 'top_of_hierarchy');
        return;
      }

      const parentRole = await this.roleRepo.findById(respondentRole.parentId);
      if (!parentRole || parentRole.status !== 'active') {
        await this.forceHumanEscalation(workflow, 'parent_role_unavailable');
        return;
      }

      // Transition current workflow to escalated
      await this.workflowRepo.updateState(workflow.id, 'escalated', 'Timed out — escalating to parent role');

      // Create escalated workflow targeting the parent role
      let escalated;
      try {
        escalated = await this.workflowService.createEscalatedWorkflow(workflow, parentRole.id);
      } catch (createErr) {
        // Rollback: revert to waiting_for_reply so the next scan can retry
        this.logger.error('Failed to create escalated workflow, reverting state', {
          workflowId: workflow.id,
          error: String(createErr),
        });
        await this.workflowRepo.updateState(workflow.id, 'waiting_for_reply', 'Escalation failed — reverted for retry');
        throw createErr;
      }

      this.eventLogger.log(workflow.id, 'escalation_created', {
        parentWorkflowId: workflow.id,
        newRespondentRoleId: parentRole.id,
        newWorkflowId: escalated.id,
        depth: escalated.depth,
        escalationTarget: parentRole.name,
      });

      this.logger.info('Timeout escalation: created escalated workflow', {
        originalWorkflowId: workflow.id,
        escalatedWorkflowId: escalated.id,
        newRespondentRole: parentRole.name,
        depth: escalated.depth,
      });
    } catch (err) {
      this.logger.error('Failed to escalate timed-out workflow', {
        workflowId: workflow.id,
        error: String(err),
      });
    }
  }

  private async forceHumanEscalation(
    workflow: import('@main/core/types/conversation.types.js').ConversationWorkflow,
    reason: string,
  ): Promise<void> {
    // Transition to timed_out
    await this.workflowRepo.updateState(workflow.id, 'timed_out', `Forced human escalation: ${reason}`);

    // Emit top-level escalation event for mandatory human notification
    this.eventBus.emit({
      type: 'escalation:top-level',
      timestamp: new Date().toISOString(),
      payload: {
        workflowId: workflow.id,
        orgId: workflow.orgId,
        taskNodeId: workflow.taskNodeId,
        askingRoleId: workflow.askingRoleId,
        respondentRoleId: workflow.respondentRoleId,
        depth: workflow.depth,
        reason,
      },
    });

    // Also emit conversation:timed-out
    this.eventBus.emit({
      type: 'conversation:timed-out',
      timestamp: new Date().toISOString(),
      payload: {
        workflowId: workflow.id,
        orgId: workflow.orgId,
        reason,
      },
    });

    this.eventLogger.log(workflow.id, 'forced_human_escalation', {
      reason,
      depth: workflow.depth,
    });

    this.logger.warn('Conversation reached top-level escalation — human notification required', {
      workflowId: workflow.id,
      reason,
      depth: workflow.depth,
    });
  }
}
