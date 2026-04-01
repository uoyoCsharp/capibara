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
  private selfWakeCounts = new Map<string, number>();
  private retryCounts = new Map<string, number>(); // key: taskNodeId
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private executionEngine!: ExecutionEngine;

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
      // task_assigned → assignee role
      case 'task:created': {
        const task = await this.taskRepo.findById(payload.taskId as string);
        if (task?.assigneeRoleId) {
          return [{
            roleId: task.assigneeRoleId,
            orgId: task.orgId,
            taskNodeId: task.id,
            trigger: 'task_assigned',
          }];
        }
        return [];
      }

      // task_completed → parent role (reviewer)
      case 'task:completed': {
        const task = await this.taskRepo.findById(payload.taskId as string);
        if (!task?.parentId) return [];

        const parentTask = await this.taskRepo.findById(task.parentId);
        if (!parentTask?.assigneeRoleId) return [];

        return [{
          roleId: parentTask.assigneeRoleId,
          orgId: task.orgId,
          taskNodeId: parentTask.id,
          trigger: 'task_completed',
        }];
      }

      // review_approve → parent task assignee (if all siblings done)
      case 'task:status-changed': {
        const { taskId, newStatus } = payload as { taskId: string; newStatus: string };
        if (newStatus !== 'approved' && newStatus !== 'done') return [];

        const task = await this.taskRepo.findById(taskId);
        if (!task?.parentId) return [];

        // Check all siblings
        const siblings = await this.taskRepo.findByParentId(task.parentId);
        const allDone = siblings.every(
          (s) => s.status === 'approved' || s.status === 'done' || s.status === 'cancelled',
        );

        if (!allDone) return [];

        const parentTask = await this.taskRepo.findById(task.parentId);
        if (!parentTask?.assigneeRoleId) return [];

        return [{
          roleId: parentTask.assigneeRoleId,
          orgId: task.orgId,
          taskNodeId: parentTask.id,
          trigger: 'review_approve',
        }];
      }

      // Run succeeded → reset counters, consume pending wakes
      case 'run:succeeded': {
        const roleId = payload.roleId as string;
        const orgId = payload.orgId as string;
        const taskNodeId = payload.taskNodeId as string;

        this.resetSelfWakeCount(roleId);
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

        this.resetSelfWakeCount(roleId);

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
      case 'wake:triggered': {
        const { roleId, orgId, trigger } = payload as {
          roleId: string;
          orgId: string;
          trigger: WakeTrigger;
        };
        // Find the task associated with this role
        const roleTasks = await this.taskRepo.findByAssignee(roleId);
        const activeTask = roleTasks.find(
          (t) => t.status === 'pending' || t.status === 'in_progress' || t.status === 'revision',
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

    // Gate 3: No active run (serial execution)
    const activeRun = await this.runRepo.findActiveByRoleId(roleId);
    if (activeRun) {
      this.logger.debug('Wake deferred: role busy, enqueuing pending wake', { roleId, trigger });
      await this.pendingWakeRepo.create({ roleId, orgId, trigger });
      this.eventBus.emit({
        type: 'wake:pending-enqueued',
        timestamp: new Date().toISOString(),
        payload: { roleId, trigger },
      });
      return false;
    }

    // Gate 4: Self-wake circuit breaker
    const selfWakeCount = this.selfWakeCounts.get(roleId) ?? 0;
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
        // Story 8.5: Top-level safety valve — mandatory human notification
        this.logger.error('Escalation reached top-level role with no parent', { roleId, orgId, taskNodeId });
        this.eventBus.emit({
          type: 'escalation:top-level',
          timestamp: new Date().toISOString(),
          payload: {
            roleId,
            roleName: role.name,
            orgId,
            taskId: taskNodeId,
            taskTitle: taskNodeId, // Will be resolved by notification service if needed
            escalationChain: [roleId],
            failureReason: `Self-wake circuit breaker triggered after ${selfWakeCount} consecutive wakes`,
          },
        });
      }
      return false;
    }

    // All gates passed — create and dispatch run
    this.selfWakeCounts.set(roleId, selfWakeCount + 1);
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
    const pendingWakes = await this.pendingWakeRepo.findByRoleId(roleId);
    if (pendingWakes.length === 0) return;

    this.logger.info('Consuming pending wakes', { roleId, count: pendingWakes.length });

    // FIFO: process oldest first (already sorted by created_at)
    const oldest = pendingWakes[0];
    await this.pendingWakeRepo.consume(oldest.id);

    // Find the task to wake for
    const roleTasks = await this.taskRepo.findByAssignee(roleId);
    const activeTask = roleTasks.find(
      (t) => t.status === 'pending' || t.status === 'in_progress' || t.status === 'revision',
    );

    if (activeTask) {
      await this.wakeRoleIfPossible(roleId, orgId, activeTask.id, oldest.trigger);
    }
  }

  resetSelfWakeCount(roleId: string): void {
    this.selfWakeCounts.delete(roleId);
  }

  stop(): void {
    for (const timer of this.retryTimers.values()) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();
    this.retryCounts.clear();
    this.selfWakeCounts.clear();
    this.logger.info('OrgOrchestrator stopped');
  }
}
