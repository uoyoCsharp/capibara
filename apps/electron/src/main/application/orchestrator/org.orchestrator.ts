import { injectable, inject } from 'tsyringe';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ITaskRepository } from '@main/core/interfaces/i-task.repository.js';
import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
import type { IRunRepository } from '@main/core/interfaces/i-run.repository.js';
import type { IPendingWakeRepository } from '@main/core/interfaces/i-pending-wake.repository.js';
import type { ICostEntryRepository } from '@main/core/interfaces/i-cost-entry.repository.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { IWorkflowEngine } from '@main/core/interfaces/i-workflow-engine.js';
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
import type { TaskRunCoordinator } from '../execution/task-run.coordinator.js';
import type { TaskStateMachine } from '../state-machine/task.state-machine.js';
import { WakeGateValidator } from './wake-gate.validator.js';
import { RetryScheduler } from './retry.scheduler.js';
import { BudgetGuard } from './budget.guard.js';

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
 * Delegates gate checks to WakeGateValidator, retry logic to RetryScheduler,
 * and budget management to BudgetGuard (P2-2 decomposition).
 *
 * See Architecture §6 — Event-Driven Wake-Up Loop.
 */
@injectable()
export class OrgOrchestrator {
  // Risk 8: per-org event serialization queue
  private orgQueues = new Map<string, Promise<void>>();
  private taskRunCoordinator!: TaskRunCoordinator;
  private workflowEngine!: IWorkflowEngine;

  /** Global execution pause flag. When true, no new runs will be dispatched. */
  private _paused = false;

  private readonly gateValidator: WakeGateValidator;
  private readonly retryScheduler: RetryScheduler;
  private readonly budgetGuard: BudgetGuard;

  constructor(
    @inject(CONFIG_TOKEN) private readonly config: CapibaraConfig,
    @inject(LOGGER_TOKEN) private readonly logger: ILogger,
    @inject(EVENT_BUS_TOKEN) private readonly eventBus: IEventBus,
    @inject(TASK_REPO_TOKEN) private readonly taskRepo: ITaskRepository,
    @inject(ROLE_REPO_TOKEN) private readonly roleRepo: IRoleRepository,
    @inject(RUN_REPO_TOKEN) private readonly runRepo: IRunRepository,
    @inject(PENDING_WAKE_REPO_TOKEN) private readonly pendingWakeRepo: IPendingWakeRepository,
    @inject(COST_ENTRY_REPO_TOKEN) private readonly costRepo: ICostEntryRepository,
  ) {
    this.gateValidator = new WakeGateValidator(
      config, logger, eventBus, roleRepo, runRepo, costRepo, pendingWakeRepo,
    );
    this.retryScheduler = new RetryScheduler(config, logger, eventBus, roleRepo);
    this.budgetGuard = new BudgetGuard(logger, roleRepo);
  }

  /** Inject TaskRunCoordinator after construction to break circular dependency. */
  setTaskRunCoordinator(coordinator: TaskRunCoordinator): void {
    this.taskRunCoordinator = coordinator;
  }

  /** Inject WorkflowEngine after construction. */
  setWorkflowEngine(engine: IWorkflowEngine): void {
    this.workflowEngine = engine;
  }

  /** Inject TaskStateMachine after construction. */
  setTaskStateMachine(sm: TaskStateMachine): void {
    this.retryScheduler.setTaskStateMachine(sm);
  }

  get paused(): boolean {
    return this._paused;
  }

  pause(): void {
    this._paused = true;
    this.logger.info('OrgOrchestrator paused — new runs will be blocked');
  }

  resume(): void {
    this._paused = false;
    this.logger.info('OrgOrchestrator resumed — runs can proceed');
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
    this.eventBus.on('budget:exceeded', (e) => void this.budgetGuard.handleBudgetExceeded(e));
    // Conversation system events
    this.eventBus.on('conversation:reply-posted', (e) => void this.handleEvent(e));
    this.eventBus.on('conversation:escalated', (e) => void this.handleEvent(e));
    this.eventBus.on('conversation:timed-out', (e) => void this.handleEvent(e));
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
            const parentApproved = await this.workflowEngine.isTerminalStatus(parentTask.orgId, parentTask.status);
            if (!parentApproved) {
              this.logger.debug('Wake skipped: parent task not yet approved', {
                taskId: task.id,
                parentId: task.parentId,
                parentStatus: parentTask.status,
              });
              return [];
            }
          }

          // Sequential sibling gate: only wake if it's the first non-terminal sibling.
          // Tasks in review status (e.g. awaiting_review) block subsequent siblings.
          const siblings = await this.taskRepo.findByParentId(task.parentId);
          const siblingChecks = await Promise.all(
            siblings.map(async (s) => ({
              sibling: s,
              isTerminal: await this.workflowEngine.isTerminalStatus(s.orgId, s.status),
            })),
          );
          const firstPending = siblingChecks.find((sc) => !sc.isTerminal)?.sibling;
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
        const task = await this.taskRepo.findById(taskId);
        if (!task) return [];
        const isTerminal = await this.workflowEngine.isTerminalStatus(task.orgId, newStatus);
        if (!isTerminal) return [];

        const targets: WakeTarget[] = [];

        // Check 1: When a task reaches a terminal status, wake its first pending child.
        // This handles the decomposition gate: children wait until parent is approved/done.
        // Also handles Phase 1→2 transition: if epic/story has no children yet,
        // wake the assignee to execute Phase 2 (create children).
        {
          const children = await this.taskRepo.findByParentId(taskId);
          const initialStatus = await this.workflowEngine.getInitialStatus(task.orgId);
          const firstPendingChild = children.find((c) => c.status === initialStatus);
          if (firstPendingChild?.assigneeRoleId) {
            this.logger.info('Parent terminal, waking first pending child', {
              parentTaskId: taskId,
              childTaskId: firstPendingChild.id,
            });
            targets.push({
              roleId: firstPendingChild.assigneeRoleId,
              orgId: task.orgId,
              taskNodeId: firstPendingChild.id,
              trigger: 'task_assigned',
            });
          } else if (children.length === 0 && task.assigneeRoleId) {
            const typeDef = await this.workflowEngine.getItemTypeDefinition(task.orgId, task.type);
            if (typeDef?.canDecompose) {
              // Terminal but no children yet → wake assignee for Phase 2 decomposition
              this.logger.info('Phase 1 approved (no children), waking assignee for Phase 2', {
                taskId,
                roleId: task.assigneeRoleId,
                type: task.type,
              });
              targets.push({
                roleId: task.assigneeRoleId,
                orgId: task.orgId,
                taskNodeId: task.id,
                trigger: 'review_approve',
              });
            }
          }
        }

        // Check 2: Sequential sibling execution
        if (!task.parentId) return targets;

        // When a decomposition task reaches a terminal status but has active children,
        // do NOT wake the next sibling yet — wait until all children complete.
        {
          const children = await this.taskRepo.findByParentId(taskId);
          if (children.length > 0) {
            const childTerminalResults = await Promise.allSettled(
              children.map((c) => this.workflowEngine.isTerminalStatus(task.orgId, c.status)),
            );
            const hasActiveChildren = childTerminalResults.some(
              (r) => r.status === 'rejected' || !r.value,
            );
            if (hasActiveChildren) {
              this.logger.debug('Skipping sibling progression: terminal task has active children', {
                taskId, childCount: children.length,
              });
              return targets;
            }
          }
        }

        const siblings = await this.taskRepo.findByParentId(task.parentId);
        const siblingTerminalResults = await Promise.allSettled(
          siblings.map((s) => this.workflowEngine.isTerminalStatus(task.orgId, s.status)),
        );
        const allDone = siblingTerminalResults.length > 0
          && siblingTerminalResults.every((r) => r.status === 'fulfilled' && r.value);

        if (allDone) {
          // All siblings complete → checkAutoPropagate handles parent advancement
          return targets;
        }

        // Not all done → wake the next pending sibling (sequential gate)
        const initialStatus = await this.workflowEngine.getInitialStatus(task.orgId);
        const nextPending = siblings.find((s) => s.status === initialStatus);
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

        await this.gateValidator.resetWakeCount(roleId);
        this.retryScheduler.clearRetryState(taskNodeId);

        await this.consumePendingWakes(roleId, orgId);
        return [];
      }

      // Run failed → retry with exponential backoff or escalate (Story 10.1 + 10.2)
      case 'run:failed':
      case 'run:timed-out': {
        const roleId = payload.roleId as string;
        const orgId = payload.orgId as string;
        const taskNodeId = payload.taskNodeId as string;

        await this.gateValidator.resetWakeCount(roleId);
        await this.retryScheduler.handleFailure(
          roleId, orgId, taskNodeId,
          (rId, oId, tId, trigger) => this.wakeRoleIfPossible(rId, oId, tId, trigger),
        );
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

        // Find a non-terminal task for this role
        let activeTask = null;
        for (const t of roleTasks) {
          const isTerminal = await this.workflowEngine.isTerminalStatus(t.orgId, t.status);
          if (!isTerminal) {
            activeTask = t;
            break;
          }
        }
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

      // Conversation: reply posted → wake asking role
      case 'conversation:reply-posted': {
        const workflow = (payload as Record<string, unknown>).workflow as {
          askingRoleId: string;
          orgId: string;
          taskNodeId: string;
        } | undefined;
        if (!workflow) return [];
        return [{
          roleId: workflow.askingRoleId,
          orgId: workflow.orgId,
          taskNodeId: workflow.taskNodeId,
          trigger: 'discussion_reply',
        }];
      }

      // Conversation: escalated → wake the new respondent
      case 'conversation:escalated': {
        const { respondentRoleId, orgId: escOrgId, workflow: escWorkflow } = payload as {
          respondentRoleId: string;
          orgId: string;
          workflow: { taskNodeId: string };
        };
        if (!respondentRoleId) return [];
        return [{
          roleId: respondentRoleId,
          orgId: escOrgId,
          taskNodeId: escWorkflow.taskNodeId,
          trigger: 'conversation_escalation',
        }];
      }

      // Conversation: timed out → already handled by TimeoutEscalationService
      case 'conversation:timed-out':
        return [];

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
    if (this._paused) {
      this.logger.debug('Wake blocked: execution is globally paused', { roleId, taskNodeId });
      return false;
    }

    // Review-sibling gate: if this task has a sibling in review status,
    // block the wake to preserve sequential execution discipline.
    const task = await this.taskRepo.findById(taskNodeId);
    if (task?.parentId) {
      const siblings = await this.taskRepo.findByParentId(task.parentId);
      for (const sibling of siblings) {
        if (sibling.id !== taskNodeId) {
          const isReview = await this.workflowEngine.isReviewStatus(sibling.orgId, sibling.status);
          if (isReview) {
            this.logger.debug('Wake blocked: sibling in review', {
              taskNodeId, siblingId: sibling.id, siblingStatus: sibling.status,
            });
            return false;
          }
        }
      }
    }

    const gate = await this.gateValidator.check(roleId, orgId, taskNodeId, trigger);
    if (!gate.allowed) return false;

    // All gates passed — increment persistent wake count and dispatch run
    const role = gate.role;
    await this.gateValidator.incrementWakeCount(roleId, role.consecutiveWakeCount);
    this.logger.info('Waking role', { roleId, trigger, taskNodeId });

    try {
      await this.taskRunCoordinator.executeForTask(roleId, taskNodeId, orgId, trigger);
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

  // ─── Story 10.3: Budget Auto-Pause (delegated to BudgetGuard) ──

  async resumeOrgRoles(orgId: string): Promise<number> {
    return this.budgetGuard.resumeOrgRoles(orgId, async (oId) => {
      await this.consumePendingWakes('', oId);
    });
  }

  // ─── Story 7.3: PendingWake Queue ────────────────────────────

  private async consumePendingWakes(roleId: string, orgId: string): Promise<void> {
    // With per-org serial execution, consume the highest-priority pending wake for the entire org
    // Priority ordering: priority DESC, created_at ASC
    const pendingWakes = await this.pendingWakeRepo.findByOrgId(orgId);
    if (pendingWakes.length === 0) return;

    this.logger.info('Consuming pending wakes for org', { orgId, count: pendingWakes.length });

    // Priority-ordered: try each pending wake until one successfully starts a run.
    for (const wake of pendingWakes) {
      const wakeRoleId = wake.roleId;

      // Bug 6 fix: prefer stored taskNodeId from the pending wake
      let targetTaskId = wake.taskNodeId;
      if (!targetTaskId) {
        // Fallback: find non-terminal task by assignee
        const roleTasks = await this.taskRepo.findByAssignee(wakeRoleId);
        let activeTask = null;
        for (const t of roleTasks) {
          const isTerminal = await this.workflowEngine.isTerminalStatus(t.orgId, t.status);
          if (!isTerminal) {
            activeTask = t;
            break;
          }
        }
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
    await this.gateValidator.resetWakeCount(roleId);
  }

  stop(): void {
    this.retryScheduler.stop();
    this.orgQueues.clear();
    this.logger.info('OrgOrchestrator stopped');
  }
}
