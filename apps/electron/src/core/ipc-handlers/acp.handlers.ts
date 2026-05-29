import { ipcMain } from 'electron';
import type { AcpAuditRepository } from '@core/modules/acp/persistence/acp-audit.repository';
import type { SqliteSuspensionRepository } from '@core/modules/acp/persistence/sqlite-suspension.repository';
import type { IAcpSessionManager } from '@core/modules/acp/interfaces/i-acp-session.manager';
import type { SuspensionRecord, SuspensionAwaitingRecord } from '@core/shared/types';

function ok<T>(data: T) { return { ok: true as const, data }; }
function err(code: string, message: string) { return { ok: false as const, error: { code, message } }; }

export function registerAcpHandlers(
  auditRepo: AcpAuditRepository,
  suspensionRepo: SqliteSuspensionRepository,
  sessionManager: IAcpSessionManager,
  defaultAgentId: string,
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
    try { return ok(sessionManager.getModelState(defaultAgentId)); }
    catch (e) { return err('INTERNAL', String(e)); }
  });

  ipcMain.handle('capibara:acp:set-model', async (_ev, modelId: string) => {
    try {
      return ok(sessionManager.setSelectedModel(defaultAgentId, modelId));
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'ValidationError') {
        return err('VALIDATION', e.message);
      }
      return err('INTERNAL', String(e));
    }
  });
}
