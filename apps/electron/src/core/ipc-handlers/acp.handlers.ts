import { ipcMain } from 'electron';
import type { AcpAuditRepository } from '@core/modules/acp/persistence/acp-audit.repository';
import type { SqliteSuspensionRepository } from '@core/modules/acp/persistence/sqlite-suspension.repository';
import type { IAcpSessionManager } from '@core/modules/acp/interfaces/i-acp-session.manager';
import type { IAcpSessionRepository } from '@core/modules/acp/interfaces/i-acp-session.repository';
import type { AcpAgentSpawner } from '@core/infrastructure/acp-protocol/acp-agent.spawner';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { AgentRegistryConfig } from '@core/modules/acp/types/acp.types';
import type { SuspensionRecord, SuspensionAwaitingRecord } from '@core/shared/types';

function ok<T>(data: T) { return { ok: true as const, data }; }
function err(code: string, message: string) { return { ok: false as const, error: { code, message } }; }

export function registerAcpHandlers(
  auditRepo: AcpAuditRepository,
  suspensionRepo: SqliteSuspensionRepository,
  sessionManager: IAcpSessionManager,
  agentConfig: AgentRegistryConfig,
  spawner: AcpAgentSpawner,
  sessionRepo: IAcpSessionRepository,
  logger: ILogger,
): void {
  // ─── Audit: tool call logs ────────────────────────────────────────
  ipcMain.handle('capibara:audit:tool-calls', async (_ev, runId: string) => {
    try { return ok(auditRepo.findToolCallsByRunId(runId)); }
    catch (e) { return err('INTERNAL', String(e)); }
  });

  ipcMain.handle('capibara:audit:tool-calls-by-org', async (_ev, orgId: string, limit?: number) => {
    try { return ok(auditRepo.findRecentToolCallsByOrgId(orgId, limit)); }
    catch (e) { return err('INTERNAL', String(e)); }
  });

  // ─── Audit: file access logs ──────────────────────────────────────
  ipcMain.handle('capibara:audit:file-access', async (_ev, runId: string) => {
    try { return ok(auditRepo.findFileAccessByRunId(runId)); }
    catch (e) { return err('INTERNAL', String(e)); }
  });

  ipcMain.handle('capibara:audit:file-access-by-org', async (_ev, orgId: string, limit?: number) => {
    try { return ok(auditRepo.findRecentFileAccessByOrgId(orgId, limit)); }
    catch (e) { return err('INTERNAL', String(e)); }
  });

  // ─── Suspensions ──────────────────────────────────────────────────
  ipcMain.handle('capibara:suspension:active', async (_ev, orgId: string) => {
    try {
      const suspensions = suspensionRepo.findActiveByOrg(orgId);
      const result: Array<SuspensionRecord & { awaiting: SuspensionAwaitingRecord[] }> = [];
      for (const s of suspensions) {
        const awaiting = suspensionRepo.findAwaitingBySuspensionId(s.id);
        result.push({
          ...s,
          awaiting: awaiting.map(a => ({
            id: a.id,
            suspensionId: a.suspensionId,
            conversationId: a.conversationId,
            respondentRoleId: a.respondentRoleId,
            status: a.status,
            response: a.response,
            resolvedAt: a.resolvedAt,
            createdAt: a.createdAt,
          })),
        });
      }
      return ok(result);
    } catch (e) { return err('INTERNAL', String(e)); }
  });

  // ─── Model Selection (ADR-5) ─────────────────────────────────────
  ipcMain.handle('capibara:acp:model-state', async () => {
    try { return ok(sessionManager.getModelState(agentConfig.defaultAgent)); }
    catch (e) { return err('INTERNAL', String(e)); }
  });

  ipcMain.handle('capibara:acp:set-model', async (_ev, modelId: string) => {
    try {
      return ok(sessionManager.setSelectedModel(agentConfig.defaultAgent, modelId));
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'ValidationError') {
        return err('VALIDATION', e.message);
      }
      return err('INTERNAL', String(e));
    }
  });

  ipcMain.handle('capibara:acp:probe-models', async () => {
    try {
      return ok(await sessionManager.probeModels(agentConfig.defaultAgent));
    } catch (e) { return err('INTERNAL', String(e)); }
  });

  // ─── Dev: Restart Agent (ADR-4) ───────────────────────────────────
  ipcMain.handle('capibara:dev:restart-agent', async (_ev, agentId: string) => {
    try {
      // Expire all non-terminal sessions for this agent
      const sessions = sessionRepo.findNonTerminal().filter(s => s.agentId === agentId);
      let expiredSessionCount = 0;
      for (const s of sessions) {
        try {
          await sessionManager.expire(s.id);
          expiredSessionCount++;
        } catch (e) {
          logger.warn('Failed to expire session during restart', { sessionId: s.id, error: String(e) });
        }
      }
      spawner.killAgent(agentId);
      return ok({ expiredSessionCount });
    } catch (e) {
      return err('INTERNAL', String(e));
    }
  });

  // ─── Dev: Close Session ───────────────────────────────────────────
  ipcMain.handle('capibara:dev:close-session', async (_ev, sessionId: string) => {
    try {
      await sessionManager.close(sessionId, 'user_closed');
      return ok(null);
    } catch (e) {
      return err('INTERNAL', String(e));
    }
  });
}
