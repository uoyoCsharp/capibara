import { ipcMain } from 'electron';
import type { ConversationService } from '@core/modules/conversation/services/conversation.service';

function ok<T>(data: T) { return { ok: true as const, data }; }
function err(code: string, message: string) { return { ok: false as const, error: { code, message } }; }

export function registerConversationHandlers(
  conversationService: ConversationService,
): void {
  ipcMain.handle('capibara:conversation:list', async (_ev, orgId: string) => {
    try { return ok(conversationService.findByOrgId(orgId)); }
    catch (e) { return err('INTERNAL', String(e)); }
  });

  ipcMain.handle('capibara:conversation:active', async (_ev, orgId: string) => {
    try { return ok(conversationService.findActiveByOrgId(orgId)); }
    catch (e) { return err('INTERNAL', String(e)); }
  });

  ipcMain.handle('capibara:conversation:get', async (_ev, id: string) => {
    try {
      const conv = conversationService.findById(id);
      return conv ? ok(conv) : err('NOT_FOUND', `Conversation not found: ${id}`);
    } catch (e) { return err('INTERNAL', String(e)); }
  });

  ipcMain.handle('capibara:conversation:messages', async (_ev, conversationId: string) => {
    try { return ok(conversationService.getMessages(conversationId)); }
    catch (e) { return err('INTERNAL', String(e)); }
  });

  ipcMain.handle('capibara:conversation:add-message', async (_ev, input: unknown) => {
    try { return ok(conversationService.addMessage((input as { conversationId: string }).conversationId, input as Parameters<typeof conversationService.addMessage>[1])); }
    catch (e) { return err('VALIDATION_ERROR', String(e)); }
  });

  ipcMain.handle('capibara:conversation:resolve', async (_ev, id: string) => {
    try { conversationService.resolve(id); return ok(null); }
    catch (e) { return err('INVALID_TRANSITION', String(e)); }
  });

  ipcMain.handle('capibara:conversation:cancel', async (_ev, id: string) => {
    try { conversationService.cancel(id); return ok(null); }
    catch (e) { return err('INVALID_TRANSITION', String(e)); }
  });

  ipcMain.handle('capibara:conversation:create-inquiry', async (_ev, orgId: string, initiatorRoleId: string, taskId: string, question: string) => {
    try { return ok(conversationService.createInquiry(orgId, initiatorRoleId, taskId, question)); }
    catch (e) { return err('VALIDATION_ERROR', String(e)); }
  });

  ipcMain.handle('capibara:conversation:create-adhoc', async (_ev, orgId: string, roleId: string, message: string) => {
    try { return ok(conversationService.createPlanningOrAdhoc(orgId, 'adhoc', 'human', roleId, message)); }
    catch (e) { return err('VALIDATION_ERROR', String(e)); }
  });

  /**
   * Start a conversational planning session. Creates a type='planning'
   * conversation with taskId=null and the agent role as respondent. The
   * emitted `conversation:response-needed` event drives the first AI run
   * automatically via ConversationOrchestrator.
   */
  ipcMain.handle('capibara:planning:start', async (_ev, orgId: string, agentRoleId: string, firstMessage: string) => {
    try { return ok(conversationService.createPlanning(orgId, agentRoleId, firstMessage)); }
    catch (e) { return err('VALIDATION_ERROR', String(e)); }
  });

  /**
   * Find the active (non-resolved) planning conversation for an org, if any.
   * Used by the Planning page's resume logic: only one active planning
   * conversation is allowed per org in MVP.
   */
  ipcMain.handle('capibara:planning:active', async (_ev, orgId: string) => {
    try {
      const active = conversationService.findActiveByOrgId(orgId)
        .find((c) => c.type === 'planning');
      return ok(active ?? null);
    } catch (e) { return err('INTERNAL', String(e)); }
  });

  /**
   * List past planning conversations for an org (REQ-P2), newest first. Sourced from the
   * conversation table; the renderer's history view resumes a selected entry by id.
   */
  ipcMain.handle('capibara:planning:history', async (_ev, orgId: string) => {
    try { return ok(conversationService.findPlanningHistory(orgId)); }
    catch (e) { return err('INTERNAL', String(e)); }
  });
}
