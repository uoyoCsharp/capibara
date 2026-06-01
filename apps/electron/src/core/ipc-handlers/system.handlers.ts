import { ipcMain, dialog, shell } from 'electron';
import type { ISqliteConnection } from '@core/foundation/interfaces/i-sqlite-connection';
import type { IRunRepository } from '@core/modules/execution/interfaces/i-run.repository';
import type { RunEngine } from '@core/modules/execution/engines/run.engine';
import type { WakeGateValidator } from '@core/modules/orchestrator/wake-gate.validator';
import type { TaskOrchestrator } from '@core/modules/orchestrator/orchestrators/task.orchestrator';
import type { IOrganizationRepository } from '@core/modules/organization/interfaces/i-organization.repository';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { AgentRegistryConfig, CollaborationConfig } from '@core/modules/acp/types/acp.types';
import type { AcpAgentSpawner } from '@core/modules/acp/client/acp-agent.spawner';
import type { IAcpSessionManager } from '@core/modules/acp/interfaces/i-acp-session.manager';
import type { IAcpSessionRepository } from '@core/modules/acp/interfaces/i-acp-session.repository';
import type { McpHttpTransportManager } from '@core/modules/mcp/mcp-http-transport';
import type { AcpMcpConfigBuilder } from '@core/modules/acp/mcp/acp-mcp.config';
import type { McpServerDeps } from '@core/modules/mcp/mcp-server.builder';
import type { DiagnosticSnapshot, AgentDiagnostic, SessionDiagnostic } from '@core/shared/types';
import { buildCapibaraMcpServer } from '@core/modules/mcp/mcp-server.builder';

function ok<T>(data: T) { return { ok: true as const, data }; }
function err(code: string, message: string) { return { ok: false as const, error: { code, message } }; }

export interface SystemHandlersDeps {
  connection: ISqliteConnection;
  runRepo: IRunRepository;
  runEngine: RunEngine;
  wakeGateValidator: WakeGateValidator;
  taskOrchestrator: TaskOrchestrator;
  orgRepo: IOrganizationRepository;
  logger: ILogger;
  agentConfig: AgentRegistryConfig;
  collaborationConfig: CollaborationConfig;
  spawner: AcpAgentSpawner;
  sessionManager: IAcpSessionManager;
  sessionRepo: IAcpSessionRepository;
  mcpTransportManager: McpHttpTransportManager;
  mcpConfigBuilder: AcpMcpConfigBuilder;
  mcpServerDeps: McpServerDeps;
}

export function registerSystemHandlers(deps: SystemHandlersDeps): void {
  const { connection, runRepo, runEngine, wakeGateValidator, taskOrchestrator, orgRepo, logger, agentConfig, collaborationConfig, spawner, sessionManager, sessionRepo, mcpTransportManager, mcpConfigBuilder, mcpServerDeps } = deps;

  // Restore persisted pause state on registration
  try {
    const row = connection.getDb()
      .prepare("SELECT value FROM settings WHERE key = 'scheduler_paused'")
      .get() as { value: string } | undefined;
    if (row?.value === 'true') {
      wakeGateValidator.setSchedulerPaused(true);
    }
  } catch { /* first run — table may not have the row */ }

  // Scheduler control (execution pause/resume)
  ipcMain.handle('capibara:scheduler:get-state', async () => {
    return ok({ paused: wakeGateValidator.isSchedulerPaused() });
  });

  ipcMain.handle('capibara:scheduler:pause', async () => {
    try {
      wakeGateValidator.setSchedulerPaused(true);
      connection.getDb()
        .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('scheduler_paused', 'true')")
        .run();

      let cancelledRunCount = 0;
      const orgs = orgRepo.findAll();
      for (const org of orgs) {
        const activeRun = runRepo.findActiveByOrgId(org.id);
        if (activeRun) {
          await runEngine.cancelRun(activeRun.id);
          cancelledRunCount++;
        }
      }

      logger.info('Scheduler paused', { cancelledRunCount });
      return ok({ cancelledRunCount });
    } catch (e) {
      return err('INTERNAL', String(e));
    }
  });

  ipcMain.handle('capibara:scheduler:resume', async () => {
    try {
      wakeGateValidator.setSchedulerPaused(false);
      connection.getDb()
        .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('scheduler_paused', 'false')")
        .run();

      const orgs = orgRepo.findAll();
      for (const org of orgs) {
        taskOrchestrator.scheduleNext(org.id);
      }

      logger.info('Scheduler resumed');
      return ok(null);
    } catch (e) {
      return err('INTERNAL', String(e));
    }
  });

  // Dialogs
  ipcMain.handle('capibara:dialog:select-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return ok(null);
    return ok(result.filePaths[0]);
  });

  ipcMain.handle('capibara:shell:open-folder', async (_ev, folderPath: string) => {
    try { await shell.openPath(folderPath); return ok(null); }
    catch (e) { return err('INTERNAL', String(e)); }
  });

  // Legacy snapshot — returns org list as snapshot
  ipcMain.handle('capibara:snapshot:load', async () => {
    try {
      const rows = connection.getDb()
        .prepare('SELECT * FROM organizations ORDER BY created_at DESC')
        .all();
      return ok({ organizations: rows, currentOrgId: (rows[0] as { id: string } | undefined)?.id ?? null });
    } catch (e) { return err('INTERNAL', String(e)); }
  });

  // Locale
  ipcMain.handle('capibara:settings:get-locale', async () => {
    try {
      const row = connection.getDb()
        .prepare("SELECT value FROM settings WHERE key = 'locale'")
        .get() as { value: string } | undefined;
      return ok(row?.value ?? 'en-US');
    } catch { return ok('en-US'); }
  });

  // System checks
  ipcMain.handle('capibara:system:check-deps', async () => {
    let agentOk = false;
    try {
      agentOk = agentConfig.registry.length > 0;
    } catch { /* resolve failed */ }
    return ok({ nodejs: { ok: true, version: process.version }, acpAgent: { ok: agentOk, version: null }, network: { ok: true, version: null } });
  });
  ipcMain.handle('capibara:settings:get', async (_ev, key: string) => {
    try {
      const row = connection.getDb()
        .prepare('SELECT value FROM settings WHERE key = ?')
        .get(key) as { value: string } | undefined;
      return ok(row?.value ?? null);
    } catch (e) { return err('INTERNAL', String(e)); }
  });

  ipcMain.handle('capibara:settings:set', async (_ev, key: string, value: string) => {
    try {
      connection.getDb()
        .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
        .run(key, value);
      return ok(null);
    } catch (e) { return err('INTERNAL', String(e)); }
  });

  ipcMain.handle('capibara:system:health', async () => {
    return ok({ status: 'ok', timestamp: new Date().toISOString() });
  });

  ipcMain.handle('capibara:system:agent-config', async () => {
    return ok({
      defaultAgent: agentConfig.defaultAgent,
      registry: agentConfig.registry.map((a) => ({
        id: a.id,
        name: a.name,
        command: a.command,
      })),
      globalFilePolicy: agentConfig.globalFilePolicy,
      collaboration: collaborationConfig,
    });
  });

  // ─── Dev Diagnostics (ADR-2) ──────────────────────────────────────
  ipcMain.handle('capibara:dev:diagnose', async () => {
    try {
      const snapshot: DiagnosticSnapshot = { agents: [], mcpTransport: { listening: false, port: 0, sseClientConnected: false, httpTransportReady: false }, sessions: [], scannedAt: new Date().toISOString() };

      // Shared session data for agent counts and session inventory
      let allSessions: import('@core/modules/acp/types/acp.types').AcpSessionRecord[] = [];
      try {
        allSessions = sessionRepo.findNonTerminal();
      } catch (e) {
        // If session query fails, both agent counts and session list will be empty
      }

      // Agent sub-scan (BR-1: independent failure isolation)
      try {
        const agentCounts = new Map<string, number>();
        for (const s of allSessions) {
          agentCounts.set(s.agentId, (agentCounts.get(s.agentId) ?? 0) + 1);
        }
        const agents: AgentDiagnostic[] = agentConfig.registry.map((entry) => {
          const proc = spawner.getProcess(entry.id);
          const alive = spawner.hasProcess(entry.id) && (proc ? !proc.exited : false);
          return {
            agentId: entry.id,
            name: entry.name,
            processAlive: alive,
            pid: proc?.child.pid ?? null,
            connectionEstablished: alive && proc?.connection !== null,
            capabilities: proc?.capabilities ?? null,
            mcpTransportType: entry.mcpTransport ?? 'sse',
            activeSessionCount: agentCounts.get(entry.id) ?? 0,
          };
        });
        snapshot.agents = agents;
      } catch (e) {
        snapshot.agents = { error: String(e) };
      }

      // MCP transport sub-scan
      try {
        snapshot.mcpTransport = mcpTransportManager.getDiagnostic();
      } catch (e) {
        snapshot.mcpTransport = { error: String(e) };
      }

      // Session inventory sub-scan
      try {
        snapshot.sessions = allSessions.map((s): SessionDiagnostic => ({
          id: s.id,
          acpSessionId: s.acpSessionId,
          agentId: s.agentId,
          roleId: s.roleId,
          orgId: s.orgId,
          runId: s.runId,
          status: s.status,
          suspendReason: s.suspendReason,
          resumeStrategy: s.resumeStrategy,
          resumeCount: s.resumeCount,
          lastActivityAt: s.lastActivityAt,
          hasLiveConnection: sessionManager.hasLiveConnection(s.id),
        }));
      } catch (e) {
        snapshot.sessions = { error: String(e) };
      }

      return ok(snapshot);
    } catch (e) {
      return err('INTERNAL', String(e));
    }
  });

  // ─── Dev: Restart MCP (ADR-5) ─────────────────────────────────────
  ipcMain.handle('capibara:dev:restart-mcp', async () => {
    try {
      mcpTransportManager.stop();
      const newServer = buildCapibaraMcpServer(mcpServerDeps);
      const newPort = await mcpTransportManager.start(newServer);
      mcpConfigBuilder.setHttpPort(newPort);
      logger.info('MCP server restarted', { newPort });
      return ok({ newPort });
    } catch (e) {
      return err('INTERNAL', String(e));
    }
  });
}
