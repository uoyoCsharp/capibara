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
}
