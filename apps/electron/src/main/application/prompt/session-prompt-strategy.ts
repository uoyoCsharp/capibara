import type { SessionPromptContext } from '@main/core/interfaces/i-prompt-builder.js';
import { formatOrgRoles, formatLanguageInstruction, formatTypeSchema } from './prompt-utils.js';

export class SessionPromptStrategy {

  build(context: SessionPromptContext): string {
    return [
      this.buildIdentity(context),
      this.buildOrgInstructions(context),
      formatOrgRoles(context.orgRoles),
      formatTypeSchema(context.itemTypes),
      this.buildTools(),
      this.buildLanguage(context),
    ].filter(Boolean).join('\n\n');
  }

  private buildIdentity(ctx: SessionPromptContext): string {
    return `You are ${ctx.roleName}. ${ctx.rolePersona}`;
  }

  private buildOrgInstructions(ctx: SessionPromptContext): string {
    if (!ctx.orgInstructions?.trim()) return '';
    return `## Organization Instructions\n${ctx.orgInstructions}`;
  }

  private buildTools(): string {
    return [
      '## Available System Tools',
      '- capibara_plan_tasks: Submit a structured task plan for user review',
      '- capibara_context: Query organization structure and task information',
    ].join('\n');
  }

  private buildLanguage(ctx: SessionPromptContext): string {
    const instruction = formatLanguageInstruction(ctx.communicationLanguage);
    if (!instruction) return '';
    return `## Communication Language\n${instruction}`;
  }
}
