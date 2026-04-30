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

export interface IPlanTreeWaker {
  tryWake(roleId: string, orgId: string, reason: string, taskId: string | null): void;
}

export interface PendingTree {
  rootTaskId: string;
  orgId: string;
  roleId: string;
  mode: PlanTreeMode;
  tree: PlanTreeNode;
  submittedAt: string;
  version: number;
  pendingFeedback: string | null;
}

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Owns the task-scoped preview/eager decomposition flow. Listens for
 * `plan-tree:submitted`, holds pending trees in memory, and exposes
 * approve / discard / refine operations.
 */
@injectable()
export class PlanningService {
  private readonly pendingTrees = new Map<string /* rootTaskId */, PendingTree>();
  private waker: IPlanTreeWaker | null = null;

  constructor(
    private readonly taskService: TaskService,
    private readonly taskStateMachine: TaskStateMachine,
    private readonly processEngine: ProcessEngine,
    private readonly connection: ISqliteConnection,
    private readonly eventBus: IEventBus,
    private readonly eventPublisher: IEventPublisher,
    private readonly logger: ILogger,
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

  getPendingTree(rootTaskId: string): PendingTree | undefined {
    const t = this.pendingTrees.get(rootTaskId);
    if (!t) return undefined;
    if (Date.now() - new Date(t.submittedAt).getTime() > MAX_AGE_MS) {
      this.pendingTrees.delete(rootTaskId);
      const root = this.taskService.findById(rootTaskId);
      if (root) {
        this.eventPublisher.publish('plan-tree:discarded', {
          rootTaskId,
          orgId: root.orgId,
          reason: 'ttl_expired',
        });
      }
      return undefined;
    }
    return t;
  }

  /**
   * Approve a pending tree and persist its children to the database.
   * Returns false if no pending entry exists (caller may have raced with
   * discard or ttl expiry). Uses the version field for optimistic locking
   * so a concurrent refine submit cannot silently replace the tree between
   * the user seeing "approve" and the write.
   */
  approvePlanTree(rootTaskId: string, expectedVersion?: number): { ok: boolean; code?: string; message?: string } {
    const pending = this.getPendingTree(rootTaskId);
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
      this.pendingTrees.delete(rootTaskId);
      this.advanceRootAfterDecomposition(rootTaskId);
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
    const existed = this.pendingTrees.delete(rootTaskId);
    const root = this.taskService.findById(rootTaskId);
    if (!root) return { ok: false, code: 'ROOT_TASK_NOT_FOUND', message: `Root task "${rootTaskId}" not found.` };

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

    this.logger.info('Plan tree discarded', { rootTaskId, existed, reason });
    return { ok: true };
  }

  /**
   * Record feedback for a pending tree and wake the AI to re-submit.
   * The feedback is threaded into the next run's prompt via
   * `pendingFeedback` on the pending entry; `run.context` reads it.
   */
  refinePlanTree(rootTaskId: string, feedback: string): { ok: boolean; code?: string; message?: string } {
    if (!feedback || feedback.trim().length === 0) {
      return { ok: false, code: 'EMPTY_FEEDBACK', message: 'Feedback must not be empty.' };
    }

    const pending = this.getPendingTree(rootTaskId);
    if (!pending) return { ok: false, code: 'NO_PENDING_TREE', message: `No pending tree for task "${rootTaskId}".` };

    pending.pendingFeedback = feedback.trim();
    this.pendingTrees.set(rootTaskId, pending);

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
   * feedback so it is only injected into one run. Returns null if no
   * tree pending or no feedback queued.
   */
  consumePendingFeedback(rootTaskId: string): string | null {
    const pending = this.pendingTrees.get(rootTaskId);
    if (!pending || !pending.pendingFeedback) return null;
    const fb = pending.pendingFeedback;
    pending.pendingFeedback = null;
    this.pendingTrees.set(rootTaskId, pending);
    return fb;
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

    // preview: overwrite previous pending (refine semantics). Bump version.
    const prev = this.pendingTrees.get(rootTaskId);
    const nextVersion = (prev?.version ?? 0) + 1;
    this.pendingTrees.set(rootTaskId, {
      rootTaskId, orgId, roleId, mode, tree, submittedAt,
      version: nextVersion,
      pendingFeedback: null,
    });
    const nodeCount = this.countNodes(tree);
    const maxDepth = this.measureDepth(tree);
    this.eventPublisher.publish('plan-tree:ready', { rootTaskId, orgId, nodeCount, maxDepth });
    this.logger.info('Plan tree recorded (preview)', { rootTaskId, nodeCount, maxDepth, version: nextVersion });
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
