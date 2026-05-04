import { injectable } from 'tsyringe';
import type { TaskService } from '@core/modules/workflow/services/task.service';
import type { TaskStateMachine } from '@core/modules/workflow/engines/task.state-machine';
import type { ProcessEngine } from '@core/modules/workflow/engines/process.engine';
import type { IEventBus } from '@core/foundation/interfaces/i-event-bus';
import type { IEventPublisher } from '@core/foundation/interfaces/i-event-publisher';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { DomainEvent, PlanTreeNode, PlanTreeMode } from '@core/foundation/events';
import type { BatchCreateTaskInput, Task } from '@core/modules/workflow/types/workflow.types';
import type { ConversationService } from '@core/modules/conversation/services/conversation.service';
import type { IPendingPlanTreeRepository } from './interfaces/i-pending-plan-tree.repository';
import type { PendingPlanTree } from './types/pending-plan-tree.types';

export interface IPlanTreeWaker {
  tryWake(roleId: string, orgId: string, reason: string, taskId: string | null): void;
}

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Owns the task-scoped preview/eager decomposition flow. Listens for
 * `plan-tree:submitted`, persists pending trees to the database, and exposes
 * approve / discard / refine operations. Creates plan_review conversations
 * in the inbox for human review.
 */
@injectable()
export class PlanningService {
  private waker: IPlanTreeWaker | null = null;

  constructor(
    private readonly taskService: TaskService,
    private readonly taskStateMachine: TaskStateMachine,
    private readonly processEngine: ProcessEngine,
    private readonly connection: ISqliteConnection,
    private readonly eventBus: IEventBus,
    private readonly eventPublisher: IEventPublisher,
    private readonly logger: ILogger,
    private readonly pendingPlanTreeRepo: IPendingPlanTreeRepository,
    private readonly conversationService: ConversationService,
  ) {}

  /** Wired at bootstrap after TaskOrchestrator is constructed. */
  setWaker(waker: IPlanTreeWaker): void {
    this.waker = waker;
  }

  init(): void {
    this.eventBus.on('plan-tree:submitted', (e) => this.onTreeSubmitted(e));
    this.logger.info('PlanningService initialized');
  }

  // ─── Plan tree (task-scoped) ─────────────────────────────────

  getPendingTree(rootTaskId: string): PendingPlanTree | undefined {
    const t = this.pendingPlanTreeRepo.findActiveByRootTaskId(rootTaskId);
    return t ?? undefined;
  }

  /**
   * Approve a pending tree and persist its children to the database.
   * Uses the version field for optimistic locking so a concurrent refine
   * submit cannot silently replace the tree between the user seeing
   * "approve" and the write.
   */
  approvePlanTree(rootTaskId: string, expectedVersion?: number): { ok: boolean; code?: string; message?: string } {
    const pending = this.pendingPlanTreeRepo.findActiveByRootTaskId(rootTaskId);
    if (!pending) return { ok: false, code: 'NO_PENDING_TREE', message: `No pending tree for task "${rootTaskId}".` };

    if (expectedVersion !== undefined && pending.version !== expectedVersion) {
      return {
        ok: false,
        code: 'VERSION_MISMATCH',
        message: `Plan tree was updated (v${pending.version}) while you were reviewing v${expectedVersion}. Re-fetch and retry.`,
      };
    }

    try {
      this.applyTree(pending.orgId, rootTaskId, pending.tree);
      const now = new Date().toISOString();
      this.pendingPlanTreeRepo.updateStatus(pending.id, 'approved', now);
      this.advanceRootAfterDecomposition(rootTaskId);

      // Complete the associated plan_review conversation
      if (pending.conversationId) {
        try {
          this.conversationService.complete(pending.conversationId);
        } catch (err) {
          this.logger.warn('Could not complete plan_review conversation', {
            conversationId: pending.conversationId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      this.eventPublisher.publish('plan-tree:approved', {
        rootTaskId,
        orgId: pending.orgId,
        nodeCount: this.countNodes(pending.tree),
      });
      this.logger.info('Plan tree approved', { rootTaskId, nodeCount: this.countNodes(pending.tree) });
      return { ok: true };
    } catch (err) {
      this.logger.error('Plan tree approve failed', {
        rootTaskId,
        error: err instanceof Error ? err.message : String(err),
      });
      return { ok: false, code: 'APPLY_FAILED', message: err instanceof Error ? err.message : String(err) };
    }
  }

  discardPlanTree(rootTaskId: string, reason: string | null): { ok: boolean; code?: string; message?: string } {
    const pending = this.pendingPlanTreeRepo.findActiveByRootTaskId(rootTaskId);
    const root = this.taskService.findById(rootTaskId);
    if (!root) return { ok: false, code: 'ROOT_TASK_NOT_FOUND', message: `Root task "${rootTaskId}" not found.` };

    if (pending) {
      const now = new Date().toISOString();
      this.pendingPlanTreeRepo.updateStatus(pending.id, 'discarded', now);

      // Cancel the associated plan_review conversation
      if (pending.conversationId) {
        try {
          this.conversationService.cancel(pending.conversationId);
        } catch (err) {
          this.logger.warn('Could not cancel plan_review conversation', {
            conversationId: pending.conversationId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    this.eventPublisher.publish('plan-tree:discarded', {
      rootTaskId,
      orgId: root.orgId,
      reason: reason ?? 'user_discard',
    });

    if (root.status !== 'pending') {
      try {
        this.taskStateMachine.transition(rootTaskId, 'pending');
      } catch (err) {
        this.logger.warn('Could not revert root to pending on discard', {
          rootTaskId,
          from: root.status,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.logger.info('Plan tree discarded', { rootTaskId, existed: !!pending, reason });
    return { ok: true };
  }

  /**
   * Record feedback for a pending tree and wake the AI to re-submit.
   */
  refinePlanTree(rootTaskId: string, feedback: string): { ok: boolean; code?: string; message?: string } {
    if (!feedback || feedback.trim().length === 0) {
      return { ok: false, code: 'EMPTY_FEEDBACK', message: 'Feedback must not be empty.' };
    }

    const pending = this.pendingPlanTreeRepo.findActiveByRootTaskId(rootTaskId);
    if (!pending) return { ok: false, code: 'NO_PENDING_TREE', message: `No pending tree for task "${rootTaskId}".` };

    const trimmed = feedback.trim();
    this.pendingPlanTreeRepo.updateFeedback(pending.id, trimmed);
    this.pendingPlanTreeRepo.updateStatus(pending.id, 'refining');

    // Add human feedback message to the plan_review conversation
    if (pending.conversationId) {
      try {
        this.conversationService.addMessage(pending.conversationId, {
          conversationId: pending.conversationId,
          authorRoleId: null,
          authorType: 'human',
          content: trimmed,
          intent: 'reply',
        });
      } catch (err) {
        this.logger.warn('Could not add feedback message to plan_review conversation', {
          conversationId: pending.conversationId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (!this.waker) {
      this.logger.error('Refine requested but no waker wired', { rootTaskId });
      return { ok: false, code: 'INTERNAL', message: 'Wake service unavailable.' };
    }

    const root = this.taskService.findById(rootTaskId);
    if (!root) return { ok: false, code: 'ROOT_TASK_NOT_FOUND', message: `Root task "${rootTaskId}" not found.` };
    if (!root.assigneeRoleId) {
      return { ok: false, code: 'NO_ASSIGNEE', message: 'Root task has no assignee role.' };
    }

    this.waker.tryWake(root.assigneeRoleId, root.orgId, 'conversation_reply', rootTaskId);
    this.logger.info('Plan tree refine requested', { rootTaskId, feedbackLength: feedback.length });
    return { ok: true };
  }

  /**
   * Read-side helper for the prompt layer: returns and clears pending
   * feedback so it is only injected into one run.
   */
  consumePendingFeedback(rootTaskId: string): string | null {
    const pending = this.pendingPlanTreeRepo.findActiveByRootTaskId(rootTaskId);
    if (!pending || !pending.pendingFeedback) return null;
    const fb = pending.pendingFeedback;
    this.pendingPlanTreeRepo.updateFeedback(pending.id, null);
    return fb;
  }

  /**
   * Scan for expired pending trees and mark them as expired.
   * Should be called periodically (e.g. on a timer or at startup).
   */
  expireStale(): void {
    const now = new Date().toISOString();
    const expired = this.pendingPlanTreeRepo.findExpired(now);
    for (const tree of expired) {
      this.pendingPlanTreeRepo.updateStatus(tree.id, 'expired', now);

      if (tree.conversationId) {
        try {
          this.conversationService.cancel(tree.conversationId);
        } catch (err) {
          this.logger.warn('Could not cancel expired plan_review conversation', {
            conversationId: tree.conversationId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      this.eventPublisher.publish('plan-tree:discarded', {
        rootTaskId: tree.rootTaskId,
        orgId: tree.orgId,
        reason: 'ttl_expired',
      });
      this.logger.info('Pending plan tree expired', { rootTaskId: tree.rootTaskId, id: tree.id });
    }
  }

  private onTreeSubmitted(event: DomainEvent<'plan-tree:submitted'>): void {
    const { rootTaskId, orgId, roleId, mode, tree, submittedAt } = event.payload;

    if (mode === 'eager') {
      try {
        const created = this.applyTree(orgId, rootTaskId, tree);
        this.advanceRootAfterDecomposition(rootTaskId);
        this.logger.info('Plan tree applied (eager)', {
          rootTaskId,
          nodeCount: created.length,
        });
      } catch (err) {
        this.logger.error('Eager plan tree apply failed', {
          rootTaskId,
          error: err instanceof Error ? err.message : String(err),
        });
        this.eventPublisher.publish('plan-tree:discarded', {
          rootTaskId,
          orgId,
          reason: `eager_apply_failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    // preview: persist to DB, create/update plan_review conversation
    try {
      const expiresAt = new Date(Date.now() + MAX_AGE_MS).toISOString();
      const pendingTree = this.pendingPlanTreeRepo.upsertByRootTaskId({
        rootTaskId, orgId, roleId, mode, tree, submittedAt, expiresAt,
      });

      // Create or update plan_review conversation
      this.ensurePlanReviewConversation(pendingTree, rootTaskId, orgId, roleId);

      const nodeCount = this.countNodes(tree);
      const maxDepth = this.measureDepth(tree);
      this.eventPublisher.publish('plan-tree:ready', { rootTaskId, orgId, nodeCount, maxDepth });
      this.logger.info('Plan tree recorded (preview)', { rootTaskId, nodeCount, maxDepth, version: pendingTree.version });
    } catch (err) {
      this.logger.error('Preview plan tree persist failed', {
        rootTaskId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private ensurePlanReviewConversation(
    pendingTree: PendingPlanTree,
    rootTaskId: string,
    orgId: string,
    roleId: string,
  ): void {
    if (pendingTree.conversationId) {
      // Existing conversation — check if still usable
      const existing = this.conversationService.findById(pendingTree.conversationId);
      if (existing && (existing.state === 'active' || existing.state === 'waiting')) {
        // Add system message about version update
        this.conversationService.addMessage(existing.id, {
          conversationId: existing.id,
          authorRoleId: null,
          authorType: 'system',
          content: `Plan updated to version ${pendingTree.version}.`,
          intent: 'general',
        });
        return;
      }
    }

    // Create new plan_review conversation
    const conv = this.conversationService.createPlanReview(
      orgId, roleId, rootTaskId, pendingTree.id, pendingTree.version,
    );
    this.pendingPlanTreeRepo.updateConversationId(pendingTree.id, conv.id);
  }

  private applyTree(orgId: string, rootTaskId: string, tree: PlanTreeNode): Task[] {
    const children = tree.children as BatchCreateTaskInput[];
    const txn = this.connection.getDb().transaction((): Task[] =>
      this.taskService.batchCreate(orgId, rootTaskId, children),
    );
    return txn();
  }

  private advanceRootAfterDecomposition(rootTaskId: string): void {
    const root = this.taskService.findById(rootTaskId);
    if (!root) return;

    const transitions = this.processEngine.getAvailableTransitions(root.orgId, root.status);
    const preferred = transitions.find((t) => t.to === 'in_progress') ?? transitions[0];
    if (!preferred) return;

    try {
      this.taskStateMachine.transition(rootTaskId, preferred.to);
    } catch (err) {
      this.logger.warn('Could not advance root after decomposition', {
        rootTaskId,
        from: root.status,
        to: preferred.to,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private countNodes(tree: PlanTreeNode): number {
    let count = 1;
    for (const child of tree.children) count += this.countNodes(child);
    return count;
  }

  private measureDepth(tree: PlanTreeNode, depth = 1): number {
    if (tree.children.length === 0) return depth;
    return Math.max(...tree.children.map((c) => this.measureDepth(c, depth + 1)));
  }
}
