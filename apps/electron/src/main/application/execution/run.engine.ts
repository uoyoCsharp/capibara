import { injectable, inject } from 'tsyringe';
import type { IOrganizationRepository } from '@main/core/interfaces/i-organization.repository.js';
import type { IRunRepository } from '@main/core/interfaces/i-run.repository.js';
import type { ICostEntryRepository } from '@main/core/interfaces/i-cost-entry.repository.js';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { IExecutor } from '@main/core/interfaces/i-executor.js';
import type { CapibaraConfig } from '@main/core/types/config.types.js';
import type { Run, WakeTrigger } from '@main/core/types/domain.types.js';
import type { IRunEngine, RunExecutionParams, RunResult } from '@main/core/interfaces/i-run-engine.js';
import { TERMINAL_RUN_STATUSES } from '@main/core/constants/run.constants.js';
import {
  CONFIG_TOKEN,
  LOGGER_TOKEN,
  EVENT_BUS_TOKEN,
  ORGANIZATION_REPO_TOKEN,
  RUN_REPO_TOKEN,
  COST_ENTRY_REPO_TOKEN,
  EXECUTOR_TOKEN,
} from '@main/core/tokens.js';
import { BudgetExceededError, ExecutionError } from '@main/core/errors/capibara.errors.js';
import type { McpConfigGenerator } from '../../infrastructure/mcp/mcp-config-generator.js';
import type { McpIpcServer } from '../../infrastructure/mcp/mcp-ipc-server.js';
import type { FileLogService } from '../../infrastructure/logging/file-log.service.js';
import { StreamJsonParser } from '../../infrastructure/executors/stream-json-parser.js';

/**
 * Pure AI execution engine. Accepts a prompt + config, invokes the executor,
 * returns a result. No task lifecycle, no session messages, no orchestration.
 *
 * Replaces the execution-only responsibilities of the former ExecutionEngine.
 * See architecture-session-layer.md §6 (ADR-SESSION-02).
 */
@injectable()
export class RunEngine implements IRunEngine {
  private jwtSecrets = new Map<string, string>();

  /** Maps runId → { contextLabel, contextId } for log file path resolution */
  private runLogCtx = new Map<string, { contextLabel: string; contextId: string }>();

  /** Maps runId → sessionId for in-flight runs (before finish() persists to DB) */
  private runSessionIds = new Map<string, string>();

  /** Maps runId → StreamJsonParser for real-time assistant text extraction */
  private runStreamParsers = new Map<string, StreamJsonParser>();

  /** External log callbacks */
  private logCallbacks: Array<(runId: string, stream: 'stdout' | 'stderr', chunk: string) => void> = [];

  /** External assistant text callbacks */
  private assistantTextCallbacks: Array<(runId: string, text: string) => void> = [];

  constructor(
    @inject(CONFIG_TOKEN) private readonly config: CapibaraConfig,
    @inject(LOGGER_TOKEN) private readonly logger: ILogger,
    @inject(EVENT_BUS_TOKEN) private readonly eventBus: IEventBus,
    @inject(ORGANIZATION_REPO_TOKEN) private readonly orgRepo: IOrganizationRepository,
    @inject(RUN_REPO_TOKEN) private readonly runRepo: IRunRepository,
    @inject(COST_ENTRY_REPO_TOKEN) private readonly costRepo: ICostEntryRepository,
    @inject(EXECUTOR_TOKEN) private readonly executor: IExecutor,
    private readonly mcpConfigGen: McpConfigGenerator,
    private readonly mcpIpcServer: McpIpcServer,
    private readonly fileLogService: FileLogService,
  ) {
    // Register log callback to stream output to file and renderer
    this.executor.onLog((runId, stream, chunk) => {
      const ctx = this.runLogCtx.get(runId);
      if (ctx) {
        this.fileLogService.append(ctx.contextLabel, ctx.contextId, runId, chunk);
      }
      this.eventBus.emit({
        type: 'run:log',
        timestamp: new Date().toISOString(),
        payload: { runId, stream, chunk },
      });

      // Notify external log callbacks
      for (const cb of this.logCallbacks) {
        try { cb(runId, stream, chunk); } catch { /* ignore */ }
      }

      // Parse stdout for assistant text and emit streaming events
      if (stream === 'stdout') {
        let parser = this.runStreamParsers.get(runId);
        if (!parser) {
          parser = new StreamJsonParser(
            (text) => {
              this.eventBus.emit({
                type: 'run:assistant-text',
                timestamp: new Date().toISOString(),
                payload: { runId, text },
              });
              for (const cb of this.assistantTextCallbacks) {
                try { cb(runId, text); } catch { /* ignore */ }
              }
            },
            (status) => {
              this.eventBus.emit({
                type: 'run:status',
                timestamp: new Date().toISOString(),
                payload: { runId, status },
              });
            },
          );
          this.runStreamParsers.set(runId, parser);
        }
        parser.feed(chunk);
      }
    });
  }

  onLog(callback: (runId: string, stream: 'stdout' | 'stderr', chunk: string) => void): void {
    this.logCallbacks.push(callback);
  }

  onAssistantText(callback: (runId: string, text: string) => void): void {
    this.assistantTextCallbacks.push(callback);
  }

  getRunSessionId(runId: string): string | null {
    return this.runSessionIds.get(runId) ?? null;
  }

  async execute(params: RunExecutionParams): Promise<RunResult> {
    const { roleId, orgId, prompt, contextId, contextLabel, taskNodeId, sessionId, mcpContext: mcpCtx, trigger, userMessage } = params;
    const execT0 = Date.now();
    console.log(`[run-engine] Starting execute`, { contextId: contextId.slice(0, 8), roleId: roleId.slice(0, 8), mcpContext: mcpCtx ?? 'none', promptLength: prompt.length });

    // ─── Budget Check ──────────────────────────────────────────
    const budgetLimit = this.config.execution.budgetLimit;
    if (budgetLimit > 0) {
      const totalTokens = await this.costRepo.getTotalTokensByOrgId(orgId);
      const totalTokensM = totalTokens / 1_000_000;
      if (totalTokensM >= budgetLimit) {
        throw new BudgetExceededError(orgId, budgetLimit, totalTokensM);
      }
    }

    // ─── Per-Org Serial Execution ──────────────────────────────
    const activeRun = await this.runRepo.findActiveByOrgId(orgId);
    if (activeRun) {
      throw new ExecutionError('', `Org ${orgId} already has an active run: ${activeRun.id}`);
    }

    // ─── Create Run Record ─────────────────────────────────────
    const run = await this.runRepo.create({
      orgId,
      taskNodeId: taskNodeId ?? null, // null for session runs (no task association)
      roleId,
      trigger: (trigger ?? 'task_assigned') as WakeTrigger,
    });
    const runId = run.id;
    console.log(`[run-engine] [${runId.slice(0, 8)}] Run record created at +${Date.now() - execT0}ms`);
    this.logger.info('Run created', { runId, roleId, contextId });

    this.eventBus.emit({
      type: 'run:queued',
      timestamp: new Date().toISOString(),
      payload: { runId, roleId, orgId, taskNodeId: taskNodeId ?? null },
    });

    // ─── Store log context ─────────────────────────────────────
    this.runLogCtx.set(runId, { contextLabel, contextId });

    // ─── Resolve session for --resume ──────────────────────────
    let resumeSessionId = sessionId ?? null;
    if (resumeSessionId) {
      this.runSessionIds.set(runId, resumeSessionId);
      this.logger.info('Resuming previous session', { runId, sessionId: resumeSessionId.slice(0, 8) });
    }

    try {
      // ─── Generate MCP Config ─────────────────────────────────
      const token = this.generateRunToken(runId);
      this.mcpIpcServer.registerToken(runId, token);
      const bridgePath = this.mcpConfigGen.getBridgePath();
      const mcpConfigPath = this.mcpConfigGen.generate(runId, bridgePath, token, mcpCtx);

      // ─── Update to Running ───────────────────────────────────
      await this.runRepo.updateStatus(runId, 'running');
      this.eventBus.emit({
        type: 'run:started',
        timestamp: new Date().toISOString(),
        payload: { runId, roleId, orgId },
      });

      // ─── Resolve Workspace Path ──────────────────────────────
      const org = await this.orgRepo.findById(orgId);
      const projectDir = org?.workspacePath || this.config.cli.projectDir;

      // ─── Log Input Prompt ────────────────────────────────────
      this.fileLogService.writeInput(contextLabel, contextId, runId, {
        prompt,
        trigger: trigger ?? 'session',
        roleId,
        executor: this.config.cli.defaultExecutor,
        projectDir,
        sessionId: resumeSessionId ?? undefined,
        cliConfig: {
          model: this.config.cli.model,
          maxTurnsPerRun: this.config.cli.maxTurnsPerRun,
          effort: this.config.cli.effort,
          timeoutMs: this.config.cli.timeoutMs,
        },
      });

      // ─── Invoke Executor ─────────────────────────────────────
      console.log(`[run-engine] [${runId.slice(0, 8)}] Dispatching to executor at +${Date.now() - execT0}ms`);
      this.logger.info('Dispatching run to worker', { runId, executor: this.config.cli.defaultExecutor, projectDir });

      // When resuming with a user message, send that as stdin instead of the system prompt.
      // The system prompt is already in the CLI session context from the first run.
      const stdinContent = (resumeSessionId && userMessage) ? userMessage : prompt;

      const result = await this.executor.execute({
        runId,
        roleId,
        orgId,
        taskNodeId: taskNodeId ?? contextId, // executor uses this as context key, not DB FK
        trigger: trigger ?? 'session',
        prompt: stdinContent,
        mcpConfigPath,
        projectDir,
        executor: this.config.cli.defaultExecutor,
        sessionId: resumeSessionId ?? undefined,
        cliConfig: {
          model: this.config.cli.model ?? undefined,
          maxTurnsPerRun: this.config.cli.maxTurnsPerRun,
          effort: this.config.cli.effort,
          timeoutMs: this.config.cli.timeoutMs,
          extraArgs: this.config.cli.extraArgs,
        },
      });

      console.log(`[run-engine] [${runId.slice(0, 8)}] Executor completed at +${Date.now() - execT0}ms`, { status: result.status, inputTokens: result.inputTokens, outputTokens: result.outputTokens });

      // ─── Cache sessionId from result ─────────────────────────
      if (result.sessionId) {
        this.runSessionIds.set(runId, result.sessionId);
      }

      // ─── Process Result ──────────────────────────────────────
      const tokenCount = (result.inputTokens ?? 0) + (result.outputTokens ?? 0);

      if (result.status === 'succeeded') {
        await this.runRepo.finish(runId, 'succeeded', tokenCount, result.sessionId);
        this.logger.info('Run succeeded', {
          runId, tokenCount, model: result.model,
          inputTokens: result.inputTokens, outputTokens: result.outputTokens,
        });

        if (tokenCount > 0) {
          await this.costRepo.create({ runId, roleId, orgId, tokenCount });
        }

        this.eventBus.emit({
          type: 'run:succeeded',
          timestamp: new Date().toISOString(),
          payload: {
            runId, roleId, orgId, taskNodeId: taskNodeId ?? null, tokenCount,
            summary: result.summary,
          },
        });
      } else if (result.status === 'cancelled') {
        await this.runRepo.finish(runId, 'cancelled', tokenCount, result.sessionId);
        this.logger.info('Run cancelled by worker', { runId });

        this.eventBus.emit({
          type: 'run:cancelled',
          timestamp: new Date().toISOString(),
          payload: { runId, roleId, orgId },
        });
      } else {
        // failed or interrupted
        await this.runRepo.finish(runId, result.status, tokenCount, result.sessionId);
        this.logger.warn('Run failed', {
          runId, exitCode: result.exitCode, error: result.errorMessage,
        });

        if (tokenCount > 0) {
          await this.costRepo.create({ runId, roleId, orgId, tokenCount });
        }

        this.eventBus.emit({
          type: 'run:failed',
          timestamp: new Date().toISOString(),
          payload: {
            runId, roleId, orgId, taskNodeId: taskNodeId ?? null,
            exitCode: result.exitCode, error: result.errorMessage,
          },
        });
      }

      // ─── Cleanup ─────────────────────────────────────────────
      await this.cleanupRun(runId);

      return {
        runId,
        status: result.status,
        sessionId: result.sessionId,
        summary: result.summary,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        model: result.model,
        exitCode: result.exitCode,
        errorMessage: result.errorMessage,
      };
    } catch (err) {
      this.logger.error('Run execution error', { runId, error: String(err) });

      try {
        await this.runRepo.finish(runId, 'failed', 0, null);
      } catch {
        // Best-effort status update
      }

      this.eventBus.emit({
        type: 'run:failed',
        timestamp: new Date().toISOString(),
        payload: { runId, roleId, orgId, taskNodeId: taskNodeId ?? null, error: String(err) },
      });

      await this.cleanupRun(runId);

      return {
        runId,
        status: 'failed',
        sessionId: null,
        summary: null,
        inputTokens: 0,
        outputTokens: 0,
        model: null,
        exitCode: null,
        errorMessage: String(err),
      };
    }
  }

  async cancelRun(runId: string): Promise<void> {
    const run = await this.runRepo.findById(runId);
    if (!run) {
      throw new ExecutionError(runId, 'Run not found');
    }
    if (TERMINAL_RUN_STATUSES.has(run.status)) {
      throw new ExecutionError(runId, `Run already in terminal state: ${run.status}`);
    }

    this.executor.abort(runId);
    await this.runRepo.finish(runId, 'cancelled', run.tokenCount);

    this.logger.info('Run cancelled', { runId });
    this.eventBus.emit({
      type: 'run:cancelled',
      timestamp: new Date().toISOString(),
      payload: { runId, roleId: run.roleId, orgId: run.orgId },
    });
  }

  /**
   * Cleanup all resources for a run. Each operation is isolated so
   * a failure in one does not prevent token revocation.
   */
  private async cleanupRun(runId: string): Promise<void> {
    const results = await Promise.allSettled([
      this.fileLogService.flush(runId),
      Promise.resolve(this.mcpConfigGen.cleanup(runId)),
    ]);

    for (const r of results) {
      if (r.status === 'rejected') {
        this.logger.warn('Run cleanup step failed', { runId, error: String(r.reason) });
      }
    }

    // Flush and clean up stream parser
    const parser = this.runStreamParsers.get(runId);
    if (parser) {
      parser.flush();
      this.runStreamParsers.delete(runId);
    }

    // Synchronous cleanup
    this.runLogCtx.delete(runId);
    this.runSessionIds.delete(runId);
    this.mcpIpcServer.revokeToken(runId);
    this.jwtSecrets.delete(runId);
  }

  private generateRunToken(runId: string): string {
    const { createHmac, randomBytes } = require('node:crypto') as typeof import('node:crypto');
    const secret = randomBytes(32).toString('hex');
    this.jwtSecrets.set(runId, secret);

    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      sub: runId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString('base64url');
    const signature = createHmac('sha256', secret)
      .update(`${header}.${payload}`)
      .digest('base64url');

    return `${header}.${payload}.${signature}`;
  }
}
