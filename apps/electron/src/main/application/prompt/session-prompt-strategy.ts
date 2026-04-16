import type { SessionPromptContext } from '@main/core/interfaces/i-prompt-builder.js';
import type { WorkItemTypeDefinition } from '@main/core/types/workflow-schema.types.js';
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
      this.buildPlanningInstructions(context),
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

  private buildPlanningInstructions(ctx: SessionPromptContext): string {
    const lines: string[] = [
      '## Planning Instructions',
      'You are guiding a user through a conversational planning process to create a structured task plan.',
      'Your goal is to understand what the user wants to build, help them think through the problem, and produce a concrete plan.',
      '',
      '- **When ready to submit the plan**, call `capibara_plan_tasks` with a structured JSON payload.',
      '- Ask questions using `capibara_context` or by responding directly to the user.',
    ];

    // Task type selection guidance (schema-driven)
    if (ctx.itemTypes && ctx.itemTypes.length > 0) {
      const topLevel = this.findTopLevelType(ctx.itemTypes);
      if (topLevel) {
        lines.push('');
        lines.push('**Task type guidance**:');
        lines.push(`- You MUST only create **${topLevel.label}** (\`${topLevel.name}\`) items. Do NOT create child items (stories, tasks, subtasks, etc.).`);
        lines.push(`- Each ${topLevel.label.toLowerCase()} should represent a high-level work area or phase, assigned to the role responsible for it.`);
        lines.push(`- The assigned role will decompose each ${topLevel.label.toLowerCase()} into smaller items after the plan is approved. You do NOT need to break down further.`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Find the highest-level decomposable root type in the schema.
   * This is the type that is allowedAtRoot, canDecompose, and is NOT
   * listed as a child of any other type (i.e., it's the true top of the hierarchy).
   */
  private findTopLevelType(itemTypes: WorkItemTypeDefinition[]): WorkItemTypeDefinition | null {
    const decomposers = itemTypes.filter(t => t.canDecompose && t.allowedAtRoot);
    if (decomposers.length === 0) return null;
    const allChildTypes = new Set(itemTypes.flatMap(t => t.allowedChildren));
    return decomposers.find(t => !allChildTypes.has(t.name)) ?? decomposers[0];
  }
}
