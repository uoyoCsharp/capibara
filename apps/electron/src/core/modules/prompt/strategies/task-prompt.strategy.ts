import type { PromptContext } from '../types/prompt.types';

export function buildTaskPrompt(ctx: PromptContext): string {
  const sections: string[] = [];

  sections.push(`# Role\n\nYou are ${ctx.role.name}.\n\n${ctx.role.persona}`);

  if (ctx.skills.length > 0) {
    const skillLines = ctx.skills.map((s) => `- \`${s.command}\` — ${s.description}`).join('\n');
    sections.push(`# Available Skills\n\n${skillLines}`);
  }

  const parentInfo = ctx.task.parentChain.length > 0
    ? `\nParent chain: ${ctx.task.parentChain.map((p) => `${p.type}:${p.title} [${p.status}]`).join(' → ')}`
    : '';

  const siblingInfo = ctx.task.siblings.length > 0
    ? `\nSiblings: ${ctx.task.siblings.map((s) => `${s.type}:${s.title} [${s.status}]`).join(', ')}`
    : '';

  sections.push(
    `# Current Task\n\n` +
    `Type: ${ctx.task.type}\n` +
    `Title: ${ctx.task.title}\n` +
    `Status: ${ctx.task.status}\n` +
    `Description: ${ctx.task.description}` +
    parentInfo +
    siblingInfo,
  );

  if (ctx.role.knowledgeBaseRefs.length > 0) {
    sections.push(`# Knowledge Base References\n\n${ctx.role.knowledgeBaseRefs.join('\n')}`);
  }

  return sections.join('\n\n---\n\n');
}
