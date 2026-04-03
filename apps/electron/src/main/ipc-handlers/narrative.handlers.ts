import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/contracts.js';
import type { DesktopResult } from '@shared/contracts.js';
import type { NarrativeEngine } from '@main/application/progress/narrative.engine.js';
import type { ICostEntryRepository } from '@main/core/interfaces/i-cost-entry.repository.js';
import type { IOrganizationRepository } from '@main/core/interfaces/i-organization.repository.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';

function ok<T>(data: T): DesktopResult<T> {
  return { ok: true, data };
}

function fail<T>(code: string, message: string): DesktopResult<T> {
  return { ok: false, error: { code, message } };
}

export function registerNarrativeHandlers(
  narrativeEngine: NarrativeEngine,
  costRepo: ICostEntryRepository,
  orgRepo: IOrganizationRepository,
  logger: ILogger,
): void {
  ipcMain.handle(IPC_CHANNELS.getNarrative, async (_event, orgId: unknown) => {
    try {
      if (typeof orgId !== 'string' || !orgId) {
        return fail('VALIDATION_ERROR', 'orgId must be a non-empty string');
      }
      const narrative = await narrativeEngine.getLatest(orgId);
      if (!narrative) return ok(null);
      return ok({
        id: narrative.id,
        orgId: narrative.orgId,
        templateData: narrative.templateData,
        renderedText: narrative.renderedText,
        generatedAt: narrative.generatedAt,
      });
    } catch (err) {
      logger.error('Failed to get narrative', { error: String(err) });
      return fail('INTERNAL', 'Failed to get narrative');
    }
  });

  ipcMain.handle(IPC_CHANNELS.generateNarrative, async (_event, orgId: unknown) => {
    try {
      if (typeof orgId !== 'string' || !orgId) {
        return fail('VALIDATION_ERROR', 'orgId must be a non-empty string');
      }
      const narrative = await narrativeEngine.generate(orgId);
      return ok({
        id: narrative.id,
        orgId: narrative.orgId,
        templateData: narrative.templateData,
        renderedText: narrative.renderedText,
        generatedAt: narrative.generatedAt,
      });
    } catch (err) {
      logger.error('Failed to generate narrative', { error: String(err) });
      return fail('INTERNAL', 'Failed to generate narrative');
    }
  });

  ipcMain.handle(IPC_CHANNELS.getApprovalSummary, async (_event, taskId: unknown) => {
    try {
      if (typeof taskId !== 'string' || !taskId) {
        return fail('VALIDATION_ERROR', 'taskId must be a non-empty string');
      }
      const summary = await narrativeEngine.generateApprovalSummary(taskId);
      return ok(summary);
    } catch (err) {
      logger.error('Failed to generate approval summary', { error: String(err) });
      return fail('INTERNAL', 'Failed to generate approval summary');
    }
  });

  ipcMain.handle(IPC_CHANNELS.getCostSummary, async (_event, orgId: unknown) => {
    try {
      if (typeof orgId !== 'string' || !orgId) {
        return fail('VALIDATION_ERROR', 'orgId must be a non-empty string');
      }
      const org = await orgRepo.findById(orgId);
      const totalTokens = await costRepo.getTotalTokensByOrgId(orgId);
      const entries = await costRepo.findByOrgId(orgId);
      const budgetLimit = org?.budgetLimit ?? 50;
      const totalTokensM = totalTokens / 1_000_000;
      return ok({
        orgId,
        totalTokens,
        budgetLimit,
        budgetPercent: budgetLimit > 0 ? Math.round((totalTokensM / budgetLimit) * 100) : 0,
        entries: entries.map((e) => ({
          id: e.id,
          runId: e.runId,
          roleId: e.roleId,
          orgId: e.orgId,
          tokenCount: e.tokenCount,
          createdAt: e.createdAt,
        })),
      });
    } catch (err) {
      logger.error('Failed to get cost summary', { error: String(err) });
      return fail('INTERNAL', 'Failed to get cost summary');
    }
  });

  ipcMain.handle(IPC_CHANNELS.getCostEntries, async (_event, orgId: unknown) => {
    try {
      if (typeof orgId !== 'string' || !orgId) {
        return fail('VALIDATION_ERROR', 'orgId must be a non-empty string');
      }
      const entries = await costRepo.findByOrgId(orgId);
      return ok(entries.map((e) => ({
        id: e.id,
        runId: e.runId,
        roleId: e.roleId,
        orgId: e.orgId,
        tokenCount: e.tokenCount,
        createdAt: e.createdAt,
      })));
    } catch (err) {
      logger.error('Failed to get cost entries', { error: String(err) });
      return fail('INTERNAL', 'Failed to get cost entries');
    }
  });
}
