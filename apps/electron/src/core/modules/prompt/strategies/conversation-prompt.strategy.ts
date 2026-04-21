import type { ConversationPromptContext } from '../types/prompt.types';

export function buildConversationPrompt(ctx: ConversationPromptContext): string {
  const sections: string[] = [];

  sections.push(`# Role\n\nYou are ${ctx.role.name}.\n\n${ctx.role.persona}`);

  if (ctx.skills.length > 0) {
    const skillLines = ctx.skills.map((s) => `- \`${s.command}\` — ${s.description}`).join('\n');
    sections.push(`# Available Skills\n\n${skillLines}`);
  }

  if (ctx.task) {
    sections.push(
      `# Task Context\n\n` +
      `Type: ${ctx.task.type}\n` +
      `Title: ${ctx.task.title}\n` +
      `Status: ${ctx.task.status}\n` +
      `Description: ${ctx.task.description}`,
    );
  }

  if (ctx.conversation.messageHistory.length > 0) {
    const msgLines = ctx.conversation.messageHistory.map((m) => {
      const author = m.authorRoleId ?? m.authorType;
      return `[${author}] (${m.intent}): ${m.content}`;
    }).join('\n\n');
    sections.push(`# Conversation History\n\n${msgLines}`);
  }

  const typeLabel = ctx.conversation.type === 'inquiry' ? 'Inquiry'
    : ctx.conversation.type === 'planning' ? 'Planning Session'
    : 'Conversation';
  sections.push(`# Context\n\nThis is a ${typeLabel} (state: ${ctx.conversation.state}).`);

  if (ctx.task?.isDecomposable) {
    sections.push(
      `# Instructions\n\n` +
      `You previously submitted a decomposition proposal for this task. ` +
      `The reviewer has requested changes. Review the feedback in the conversation history above ` +
      `and submit a revised proposal in this conversation.`,
    );
  }

  return sections.join('\n\n---\n\n');
}
