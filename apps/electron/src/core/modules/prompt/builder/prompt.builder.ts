import { injectable } from 'tsyringe';
import type { RunContext } from '../context/run.context';
import type { PromptContext, ConversationPromptContext } from '../types/prompt.types';
import { buildTaskPrompt } from '../strategies/task-prompt.strategy';
import { buildConversationPrompt } from '../strategies/conversation-prompt.strategy';

@injectable()
export class PromptBuilder {
  constructor(private readonly runContext: RunContext) {}

  buildForTask(taskId: string, roleId: string, locale: string): string | null {
    const ctx = this.runContext.buildForTask(taskId, roleId, locale);
    if (!ctx) return null;
    return buildTaskPrompt(ctx);
  }

  buildForConversation(conversationId: string, roleId: string, locale: string): string | null {
    const ctx = this.runContext.buildForConversation(conversationId, roleId, locale);
    if (!ctx) return null;
    return buildConversationPrompt(ctx);
  }

  buildFromContext(ctx: PromptContext): string {
    return buildTaskPrompt(ctx);
  }

  buildFromConversationContext(ctx: ConversationPromptContext): string {
    return buildConversationPrompt(ctx);
  }
}
