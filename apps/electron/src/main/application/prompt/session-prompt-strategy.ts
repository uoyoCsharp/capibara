import type { SessionPromptContext } from '@main/core/interfaces/i-prompt-builder.js';

export class SessionPromptStrategy {

  build(context: SessionPromptContext): string {
    return [
      this.buildIdentity(context),
      this.buildOrgInstructions(context),
      this.buildOrgRoles(context),
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

  private buildOrgRoles(ctx: SessionPromptContext): string {
    if (!ctx.orgRoles || ctx.orgRoles.length === 0) return '';
    const lines: string[] = ['## Available Roles for Task Assignment'];
    for (const r of ctx.orgRoles) {
      const skills = r.skillDescriptions.length > 0
        ? ` — Skills: ${r.skillDescriptions.join(', ')}`
        : '';
      lines.push(`- ${r.name} (roleId: ${r.id})${skills}`);
    }
    return lines.join('\n');
  }

  private buildTools(): string {
    return [
      '## Available System Tools',
      '- capibara_plan_tasks: Submit a structured task plan for user review',
      '- capibara_context: Query organization structure and task information',
    ].join('\n');
  }

  private buildLanguage(ctx: SessionPromptContext): string {
    if (!ctx.communicationLanguage) return '';
    const langName = ctx.communicationLanguage.startsWith('zh') ? 'Chinese (中文)' : 'English';
    return `## Communication Language\nRespond in ${langName}. Task titles and descriptions in the final plan should be in English regardless of conversation language.`;
  }
}
