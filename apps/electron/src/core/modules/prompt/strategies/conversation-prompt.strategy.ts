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

  // Planning discussion scenario
  if (ctx.conversation.type === 'planning') {
    sections.push(buildPlanningDiscussionSections(ctx));
    return sections.join('\n\n---\n\n');
  }

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

function buildPlanningDiscussionSections(ctx: ConversationPromptContext): string {
  const parts: string[] = [];

  // Type schema table
  if (ctx.typeSchema && ctx.typeSchema.allTypes.length > 0) {
    const tableHeader = '| Type | Label | Leaf | Root? | Allowed Children |\n|------|-------|:----:|:----:|-----------------|';
    const rows = ctx.typeSchema.allTypes.map((t) => {
      const children = t.allowedChildren.length > 0 ? t.allowedChildren.join(', ') : '—';
      return `| ${t.name} | ${t.label} | ${t.isLeaf ? 'Yes' : 'No'} | ${t.allowedAtRoot ? 'Yes' : 'No'} | ${children} |`;
    }).join('\n');

    const rootTypes = ctx.typeSchema.allTypes.filter((t) => t.allowedAtRoot).map((t) => t.name);
    const rootLine = rootTypes.length > 0
      ? `\nThe tree root MUST be one of these types: ${rootTypes.map((n) => `\`${n}\``).join(', ')}.`
      : '';

    parts.push(`# Work Item Type Schema\n\n${tableHeader}\n${rows}${rootLine}`);
  }

  // Available roles for assignment
  if (ctx.orgRoles && ctx.orgRoles.length > 0) {
    const roleLines = ctx.orgRoles.map((r) => {
      const skills = r.skillDescriptions.length > 0 ? ` — Skills: ${r.skillDescriptions.join(', ')}` : '';
      return `- \`${r.id}\` — ${r.name}${skills}`;
    }).join('\n');
    parts.push(`# Available Roles\n\nAssign each tree node's \`assigneeRoleId\` using one of these role IDs:\n\n${roleLines}`);
  }

  // Pending feedback from previous tree (refine loop)
  if (ctx.pendingFeedback) {
    parts.push(
      `# User Feedback on Previous Tree\n\n` +
      `The user reviewed your previous submission and left this feedback. Incorporate it when re-submitting:\n\n` +
      `> ${ctx.pendingFeedback.replace(/\n/g, '\n> ')}`,
    );
  }

  // Main instructions
  parts.push(
    `# Instructions\n\n` +
    `You are guiding the user through a conversational planning session. The user has an idea or project to plan.\n\n` +
    `**Your approach:**\n` +
    `1. First, understand the user's goal. Ask clarifying questions about scope, constraints, target users, success criteria, and any existing context. Keep each question focused — don't ask too many at once.\n` +
    `2. Converge within 2-6 rounds of back-and-forth. Don't drag the conversation out.\n` +
    `3. When you have enough information to propose a concrete decomposition, submit a task tree via the \`capibara_plan_submit_tree\` MCP tool.\n\n` +
    `**When submitting the tree, use these parameters:**\n` +
    `- \`conversationId\`: \`${ctx.conversation.id}\`  (do NOT pass \`rootTaskId\`)\n` +
    `- \`tree\`: the full decomposition tree (root + all descendants)\n\n` +
    `**Tree structural rules:**\n` +
    `- The tree root MUST be a type with \`allowedAtRoot=Yes\` in the Type Schema above.\n` +
    `- Every node's \`type\` MUST appear in its parent's \`allowedChildren\` list.\n` +
    `- Every leaf (type with \`isLeaf=Yes\`) MUST have \`children: []\`.\n` +
    `- Every non-leaf MUST have at least one child.\n` +
    `- Every node MUST include a non-empty \`assigneeRoleId\` chosen from the Available Roles above.\n` +
    `- Do NOT nest a type under itself.\n` +
    `- Total node count ≤ 500; depth ≤ 10.\n\n` +
    `**Continue the conversation after submitting:** The user may approve, discard, or ask for refinements. If they refine, you'll receive their feedback and should re-submit an updated tree.\n\n` +
    `**Reply style:** Keep AI replies short, warm, and focused. When asking questions, ask one or two at a time. When submitting a tree, also send a brief summary message so the user knows what you proposed.`,
  );

  return parts.join('\n\n---\n\n');
}
