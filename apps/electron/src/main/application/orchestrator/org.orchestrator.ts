import { injectable, inject } from 'tsyringe';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ITaskRepository } from '@main/core/interfaces/i-task.repository.js';
import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
import type { IRunRepository } from '@main/core/interfaces/i-run.repository.js';
import type { IPendingWakeRepository } from '@main/core/interfaces/i-pending-wake.repository.js';
import type { ICostEntryRepository } from '@main/core/interfaces/i-cost-entry.repository.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { DomainEvent } from '@main/core/types/event.types.js';
import type { WakeTrigger } from '@main/core/types/domain.types.js';
import type { CapibaraConfig } from '@main/core/types/config.types.js';
import {
  CONFIG_TOKEN,
  LOGGER_TOKEN,
  EVENT_BUS_TOKEN,
  TASK_REPO_TOKEN,
  ROLE_REPO_TOKEN,
  RUN_REPO_TOKEN,
  PENDING_WAKE_REPO_TOKEN,
  COST_ENTRY_REPO_TOKEN,
} from '@main/core/tokens.js';
import type { ExecutionEngine } from '../execution/execution.engine.js';
import type { TaskStateMachine } from '../state-machine/task.state-machine.js';

interface WakeTarget {
  roleId: string;
  orgId: string;
  taskNodeId: string;
  trigger: WakeTrigger;
}

/**
 * Central orchestration engine. Listens for domain events and coordinates
 * wake-up calls to roles based on event triggers.
 *
 * See Architecture §6 — Event-Driven Wake-Up Loop.
 */
@injectable()
export class OrgOrchestrator {
  // Risk 9: selfWakeCounts replaced by roles.consecutive_wake_count in DB
  private retryCounts = new Map<string, number>(); // key: taskNodeId
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Risk 8: per-org event serialization queue
  private orgQueues = new Map<string, Promise<void>>();
  private executionEngine!: ExecutionEngine;
  private taskStateMachine!: TaskStateMachine;

  constructor(
    @inject(CONFIG_TOKEN) private readonly config: CapibaraConfig,
    @inject(LOGGER_TOKEN) private readonly logger: ILogger,
    @inject(EVENT_BUS_TOKEN) private readonly eventBus: IEventBus,
    @inject(TASK_REPO_TOKEN) private readonly taskRepo: ITaskRepository,
    @inject(ROLE_REPO_TOKEN) private readonly roleRepo: IRoleRepository,
    @inject(RUN_REPO_TOKEN) private readonly runRepo: IRunRepository,
    @inject(PENDING_WAKE_REPO_TOKEN) private readonly pendingWakeRepo: IPendingWakeRepository,
    @inject(COST_ENTRY_REPO_TOKEN) private readonly costRepo: ICostEntryRepository,
  ) {}

  /** Inject ExecutionEngine after construction to break circular dependency. */
  setExecutionEngine(engine: ExecutionEngine): void {
    this.executionEngine = engine;
  }

  /** Inject TaskStateMachine after construction. */
  setTaskStateMachine(sm: TaskStateMachine): void {
    this.taskStateMachine = sm;
  }

  start(): void {
    this.eventBus.on('task:created', (e) => void this.handleEvent(e));
    this.eventBus.on('task:completed', (e) => void this.handleEvent(e));
    this.eventBus.on('task:status-changed', (e) => void this.handleEvent(e));
    this.eventBus.on('discussion:vote-added', (e) => void this.handleEvent(e));
    this.eventBus.on('run:succeeded', (e) => void this.handleEvent(e));
    this.eventBus.on('run:failed', (e) => void this.handleEvent(e));
    this.eventBus.on('run:timed-out', (e) => void this.handleEvent(e));
    this.eventBus.on('wake:triggered', (e) => void this.handleEvent(e));
    this.eventBus.on('dispute:detected', (e) => void this.handleEvent(e));
    this.eventBus.on('budget:exceeded', (e) => void this.handleBudgetExceeded(e));
    this.logger.info('OrgOrchestrator started — listening for domain events');
  }

  // ─── Story 7.1: Core Event Loop ──────────────────────────────

  async handleEvent(event: DomainEvent): Promise<void> {
    // Risk 8: extract orgId and serialize event handling per org
    const orgId = (event.payload as Record<string, unknown>)?.orgId as string | undefined;
    if (orgId) {
      this.enqueueForOrg(orgId, () => this.processEvent(event));
    } else {
      // Events without orgId are processed immediately (rare edge case)
      await this.processEvent(event);
    }
  }

  private enqueueForOrg(orgId: string, fn: () => Promise<void>): void {
    const prev = this.orgQueues.get(orgId) ?? Promise.resolve();
    const next = prev.then(fn).catch((err) => {
      this.logger.error('OrgOrchestrator queued event error', { orgId, error: String(err) });
      this.eventBus.emit({
        type: 'orchestrator:error',
        timestamp: new Date().toISOString(),
        payload: { orgId, error: String(err) },
      });
    }).finally(() => {
      // P1: clean up resolved queue entries to prevent memory leak
      if (this.orgQueues.get(orgId) === next) {
        this.orgQueues.delete(orgId);
      }
    });
    this.orgQueues.set(orgId, next);
  }

  private async processEvent(event: DomainEvent): Promise<void> {
    this.logger.debug('OrgOrchestrator handling event', { type: event.type });

    try {
      const targets = await this.calculateWakeTargets(event);
      for (const target of targets) {
        await this.wakeRoleIfPossible(target.roleId, target.orgId, target.taskNodeId, target.trigger);
      }
    } catch (err) {
      this.logger.error('OrgOrchestrator event handling error', {
        type: event.type,
        error: String(err),
      });
    }
  }

  async calculateWakeTargets(event: DomainEvent): Promise<WakeTarget[]> {
    const payload = event.payload as Record<string, unknown>;

    switch (event.type) {
      // task_assigned → assignee role (only if first pending sibling AND parent is approved)
      case 'task:created': {
        const task = await this.taskRepo.findById(payload.taskId as string);
        if (!task?.assigneeRoleId) return [];

        // Parent approval gate: if the parent task exists and is not yet approved,
        // do not wake the child. Children wait until parent's decomposition is approved.
        if (task.parentId) {
          const parentTask = await this.taskRepo.findById(task.parentId);
          if (parentTask) {
            const parentApproved = parentTask.status === 'approved' || parentTask.status === 'done';
            if (!parentApproved) {
              this.logger.debug('Wake skipped: parent task not yet approved', {
                taskId: task.id,
                parentId: task.parentId,
                parentStatus: parentTask.status,
              });
              return [];
            }
          }

          // Sequential sibling gate: only wake if it's the first pending sibling
          const siblings = await this.taskRepo.findByParentId(task.parentId);
          const firstPending = siblings.find(
            (s) => s.status === 'pending' || s.status === 'in_progress' || s.status === 'revision',
          );
          if (firstPending && firstPending.id !== task.id) {
            this.logger.debug('Wake skipped: not the first pending sibling', {
              taskId: task.id,
              firstPendingId: firstPending.id,
            });
            return [];
          }
        }

        return [{
          roleId: task.assigneeRoleId,
          orgId: task.orgId,
          taskNodeId: task.id,
          trigger: 'task_assigned',
        }];
      }

      // task:completed is no longer emitted by checkAutoPropagate.
      // Parent status advancement is handled directly by TaskService.checkAutoPropagate.
      case 'task:completed': {
        return [];
      }

      // Sequential execution & parent approval propagation:
      // 1. When a sibling reaches terminal status → wake next pending sibling
      // 2. When a parent task is approved → wake its first pending child (decomposition gate)
      case 'task:status-changed': {
        const { taskId, newStatus } = payload as { taskId: string; newStatus: string };
        const terminalStatuses = ['approved', 'done', 'cancelled'];
        if (!terminalStatuses.includes(newStatus)) return [];

        const task = await this.taskRepo.findById(taskId);
        if (!task) return [];

        const targets: WakeTarget[] = [];

        // Check 1: When a task is approved, wake its first pending child.
        // This handles the decomposition gate: children wait until parent is approved.
        if (newStatus === 'approved') {
          const children = await this.taskRepo.findByParentId(taskId);
          const firstPendingChild = children.find((c) => c.status === 'pending');
          if (firstPendingChild?.assigneeRoleId) {
            this.logger.info('Parent approved, waking first pending child', {
              parentTaskId: taskId,
              childTaskId: firstPendingChild.id,
            });
            targets.push({
              roleId: firstPendingChild.assigneeRoleId,
              orgId: task.orgId,
              taskNodeId: firstPendingChild.id,
              trigger: 'task_assigned',
            });
          }
        }

        // Check 2: Sequential sibling execution
        if (!task.parentId) return targets;

        // When a decomposition task (epic/story) becomes 'approved', its children
        // still need to execute. Do NOT wake the next sibling yet — wait until
        // this task reaches 'done' (via checkAutoPropagate after all children complete).
        // Risk 14 fix: only skip sibling progression if there are active (non-terminal) children
        if (newStatus === 'approved') {
          const children = await this.taskRepo.findByParentId(taskId);
          const hasActiveChildren = children.some(
            (c) => c.status !== 'done' && c.status !== 'cancelled',
          );
          if (children.length > 0 && hasActiveChildren) {
            this.logger.debug('Skipping sibling progression: approved task has active children', {
              taskId, childCount: children.length,
            });
            return targets;
          }
        }

        const siblings = await this.taskRepo.findByParentId(task.parentId);
        const allDone = siblings.every((s) => {
          if (s.status === 'done' || s.status === 'cancelled') return true;
          // An 'approved' task with unfinished children is NOT complete
          if (s.status === 'approved') {
            return true; // Leaf approved tasks are complete for sibling progression
          }
          return false;
        });

        if (allDone) {
          // All siblings complete → checkAutoPropagate handles parent advancement
          return targets;
        }

        // Not all done → wake the next pending sibling (sequential gate)
        const nextPending = siblings.find((s) => s.status === 'pending');
        if (nextPending?.assigneeRoleId) {
          this.logger.info('Waking next sequential sibling', {
            completedTaskId: taskId,
            nextTaskId: nextPending.id,
          });
          targets.push({
            roleId: nextPending.assigneeRoleId,
            orgId: task.orgId,
            taskNodeId: nextPending.id,
            trigger: 'task_assigned',
          });
        }

        return targets;
      }

      // Run succeeded → reset counters, consume pending wakes
      case 'run:succeeded': {
        const roleId = payload.roleId as string;
        const orgId = payload.orgId as string;
        const taskNodeId = payload.taskNodeId as string;

        await this.resetSelfWakeCount(roleId);
        this.retryCounts.delete(taskNodeId);

        await this.consumePendingWakes(roleId, orgId);
        return [];
      }

      // Run failed → retry with exponential backoff or escalate (Story 10.1 + 10.2)
      case 'run:failed':
      case 'run:timed-out': {
        const roleId = payload.roleId as string;
        const orgId = payload.orgId as string;
        const taskNodeId = payload.taskNodeId as string;

        await this.resetSelfWakeCount(roleId);

        const retryCount = this.retryCounts.get(taskNodeId) ?? 0;
        const maxRetries = this.config.execution.maxRetryOnFailure;

        if (retryCount < maxRetries) {
          // Schedule retry with exponential backoff
          const backoff = this.config.execution.retryBackoffMs * Math.pow(2, retryCount);
          this.retryCounts.set(taskNodeId, retryCount + 1);
          this.logger.info('Scheduling retry with backoff', {
            roleId, taskNodeId, retryCount: retryCount + 1, maxRetries, backoffMs: backoff,
          });

          this.scheduleRetry(roleId, orgId, taskNodeId, backoff);
        } else {
          // Retries exhausted → escalate to parent role (Story 10.2)
          this.logger.warn('Retries exhausted, escalating', { roleId, taskNodeId, retryCount });
          this.retryCounts.delete(taskNodeId);
          await this.escalateToParent(roleId, orgId, taskNodeId);
        }
        return [];
      }

      // Explicit wake trigger from discussion service or other subsystems
      // Bug 6 fix: prefer taskNodeId from payload, fallback to findByAssignee
      case 'wake:triggered': {
        const { roleId, orgId, trigger, taskNodeId: explicitTaskId } = payload as {
          roleId: string;
          orgId: string;
          trigger: WakeTrigger;
          taskNodeId?: string;
        };

        // If the event carries a specific taskNodeId, use it directly
        if (explicitTaskId) {
          return [{
            roleId,
            orgId,
            taskNodeId: explicitTaskId,
            trigger,
          }];
        }

        // Fallback: find the task associated with this role
        const roleTasks = await this.taskRepo.findByAssignee(roleId);

        const eligibleStatuses = (trigger === 'review_requested' || trigger === 'review_approve')
          ? ['pending', 'in_progress', 'revision', 'approved']
          : ['pending', 'in_progress', 'revision'];

        const activeTask = roleTasks.find(
          (t) => eligibleStatuses.includes(t.status),
        );
        if (activeTask) {
          return [{
            roleId,
            orgId,
            taskNodeId: activeTask.id,
            trigger,
          }];
        }
        return [];
      }

      // Dispute detected → parent role intervention
      case 'dispute:detected': {
        const { parentRoleId, orgId: disputeOrgId, taskId: disputeTaskId } = payload as {
          parentRoleId: string;
          orgId: string;
          taskId: string;
        };
        return [{
          roleId: parentRoleId,
          orgId: disputeOrgId,
          taskNodeId: disputeTaskId,
          trigger: 'dispute_detected',
        }];
      }

      default:
        return [];
    }
  }

  // ─── Story 7.2: Wake-Up Gate Checks and Role Activation ───────

  async wakeRoleIfPossible(
    roleId: string,
    orgId: string,
    taskNodeId: string,
    trigger: WakeTrigger,
  ): Promise<boolean> {
    // Gate 1: Role status check
    const role = await this.roleRepo.findById(roleId);
    if (!role || role.status !== 'active') {
      this.logger.debug('Wake skipped: role inactive or not found', { roleId });
      return false;
    }

    // Gate 2: Budget check
    const totalCost = await this.costRepo.getTotalCostByOrgId(orgId);
    if (totalCost >= this.config.execution.budgetLimit) {
      this.logger.warn('Wake skipped: budget exceeded', { orgId, totalCost });
      this.eventBus.emit({
        type: 'budget:exceeded',
        timestamp: new Date().toISOString(),
        payload: { orgId, totalCost, limit: this.config.execution.budgetLimit },
      });
      return false;
    }

    // Gate 3: Per-org serial execution — only one run at a time per organization
    const activeRun = await this.runRepo.findActiveByOrgId(orgId);
    if (activeRun) {
      this.logger.debug('Wake deferred: org has active run, enqueuing pending wake', { roleId, orgId, trigger, activeRunId: activeRun.id });
      await this.pendingWakeRepo.create({ roleId, orgId, trigger, taskNodeId });
      this.eventBus.emit({
        type: 'wake:pending-enqueued',
        timestamp: new Date().toISOString(),
        payload: { roleId, trigger },
      });
      return false;
    }

    // Gate 4: Self-wake circuit breaker (Risk 9: persisted in roles table)
    const selfWakeCount = role.consecutiveWakeCount;
    if (selfWakeCount >= this.config.execution.maxConsecutiveWakes) {
      this.logger.warn('Circuit breaker: self-wake limit reached', { roleId, selfWakeCount });
      this.eventBus.emit({
        type: 'circuit-breaker:self-wake',
        timestamp: new Date().toISOString(),
        payload: { roleId, count: selfWakeCount },
      });

      // Escalate to parent role
      if (role.parentId) {
        const parentRole = await this.roleRepo.findById(role.parentId);
        if (parentRole) {
          this.eventBus.emit({
            type: 'wake:triggered',
            timestamp: new Date().toISOString(),
            payload: { roleId: role.parentId, orgId, trigger: 'retry_failed' as WakeTrigger },
          });
        }
      } else {
        this.logger.error('Escalation reached top-level role with no parent', { roleId, orgId, taskNodeId });
        this.eventBus.emit({
          type: 'escalation:top-level',
          timestamp: new Date().toISOString(),
          payload: {
            roleId,
            roleName: role.name,
            orgId,
            taskId: taskNodeId,
            taskTitle: taskNodeId,
            escalationChain: [roleId],
            failureReason: `Self-wake circuit breaker triggered after ${selfWakeCount} consecutive wakes`,
          },
        });
      }
      return false;
    }

    // All gates passed — increment persistent wake count and dispatch run
    await this.roleRepo.update({ id: roleId, consecutiveWakeCount: selfWakeCount + 1 });
    this.logger.info('Waking role', { roleId, trigger, taskNodeId });

    try {
      await this.executionEngine.startRun(roleId, taskNodeId, orgId, trigger);
      return true;
    } catch (err) {
      this.logger.error('Failed to start run for wake', {
        roleId,
        taskNodeId,
        error: String(err),
      });
      return false;
    }
  }

  // ─── Story 10.3: Budget Auto-Pause ──────────────────────────────

  private async handleBudgetExceeded(event: DomainEvent): Promise<void> {
    const { orgId, totalCost, limit } = event.payload as {
      orgId: string; totalCost: number; limit: number;
    };

    this.logger.warn('Budget exceeded — pausing all org roles', { orgId, totalCost, limit });

    const roles = await this.roleRepo.findByOrgId(orgId);
    let pausedCount = 0;
    for (const role of roles) {
      if (role.status === 'active') {
        await this.roleRepo.update({ id: role.id, status: 'paused' });
        pausedCount++;
      }
    }

    this.logger.info('Paused org roles due to budget', { orgId, pausedCount });
  }

  async resumeOrgRoles(orgId: string): Promise<number> {
    const roles = await this.roleRepo.findByOrgId(orgId);
    let resumedCount = 0;
    for (const role of roles) {
      if (role.status === 'paused') {
        await this.roleRepo.update({ id: role.id, status: 'active' });
        resumedCount++;
      }
    }

    this.logger.info('Resumed org roles', { orgId, resumedCount });

    // Risk 10 fix: trigger pending wake consumption after resume
    if (resumedCount > 0) {
      await this.consumePendingWakes('', orgId);
    }

    return resumedCount;
  }

  // ─── Story 10.1: Retry with Exponential Backoff ─────────────────

  private scheduleRetry(roleId: string, orgId: string, taskNodeId: string, backoffMs: number): void {
    // Clear any existing retry timer for this task
    const existing = this.retryTimers.get(taskNodeId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.retryTimers.delete(taskNodeId);
      void this.wakeRoleIfPossible(roleId, orgId, taskNodeId, 'retry_failed');
    }, backoffMs);

    this.retryTimers.set(taskNodeId, timer);
  }

  // ─── Story 10.2: Escalation Chain ─────────────────────────────

  private async escalateToParent(roleId: string, orgId: string, taskNodeId: string): Promise<void> {
    const role = await this.roleRepo.findById(roleId);
    if (!role) return;

    // Mark the failed task as blocked so the escalation is visible
    try {
      await this.taskStateMachine.transition(taskNodeId, 'blocked');
      this.logger.info('Task marked as blocked due to escalation', { taskNodeId });
    } catch {
      // Task may already be in a state that doesn't allow blocked transition
    }

    if (role.parentId) {
      const parentRole = await this.roleRepo.findById(role.parentId);
      if (parentRole) {
        this.logger.info('Escalating to parent role', {
          fromRole: role.name, toRole: parentRole.name, taskNodeId,
        });
        this.eventBus.emit({
          type: 'wake:triggered',
          timestamp: new Date().toISOString(),
          payload: { roleId: role.parentId, orgId, trigger: 'retry_failed' as WakeTrigger },
        });
        return;
      }
    }

    // No parent — top-level escalation
    this.logger.error('Escalation reached top-level role after retries exhausted', {
      roleId, orgId, taskNodeId,
    });
    this.eventBus.emit({
      type: 'escalation:top-level',
      timestamp: new Date().toISOString(),
      payload: {
        roleId,
        roleName: role.name,
        orgId,
        taskId: taskNodeId,
        taskTitle: taskNodeId,
        escalationChain: [roleId],
        failureReason: `All ${this.config.execution.maxRetryOnFailure} retries exhausted for role "${role.name}"`,
      },
    });
  }

  // ─── Story 7.3: PendingWake Queue ────────────────────────────

  private async consumePendingWakes(roleId: string, orgId: string): Promise<void> {
    // With per-org serial execution, consume the oldest pending wake for the entire org
    // (not just for the completed role), since the org slot is now free.
    const pendingWakes = await this.pendingWakeRepo.findByOrgId(orgId);
    if (pendingWakes.length === 0) return;

    this.logger.info('Consuming pending wakes for org', { orgId, count: pendingWakes.length });

    // FIFO: try each pending wake until one successfully starts a run.
    // Only one run can start (per-org serial), so stop after the first success.
    for (const wake of pendingWakes) {
      const wakeRoleId = wake.roleId;

      // Bug 6 fix: prefer stored taskNodeId from the pending wake
      let targetTaskId = wake.taskNodeId;
      if (!targetTaskId) {
        // Fallback: find eligible task by assignee
        const roleTasks = await this.taskRepo.findByAssignee(wakeRoleId);
        const eligibleStatuses = (wake.trigger === 'review_requested' || wake.trigger === 'review_approve')
          ? ['pending', 'in_progress', 'revision', 'approved']
          : ['pending', 'in_progress', 'revision'];
        const activeTask = roleTasks.find((t) => eligibleStatuses.includes(t.status));
        targetTaskId = activeTask?.id ?? null;
      }

      if (!targetTaskId) {
        await this.pendingWakeRepo.consume(wake.id);
        this.logger.debug('Pending wake consumed with no eligible task', { wakeId: wake.id, roleId: wakeRoleId });
        continue;
      }

      await this.pendingWakeRepo.consume(wake.id);
      const started = await this.wakeRoleIfPossible(wakeRoleId, orgId, targetTaskId, wake.trigger);
      if (started) {
        return; // Run started — org slot is now occupied
      }
    }
  }

  async resetSelfWakeCount(roleId: string): Promise<void> {
    await this.roleRepo.update({ id: roleId, consecutiveWakeCount: 0 });
  }

  stop(): void {
    for (const timer of this.retryTimers.values()) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();
    this.retryCounts.clear();
    this.orgQueues.clear();
    this.logger.info('OrgOrchestrator stopped');
  }
}
