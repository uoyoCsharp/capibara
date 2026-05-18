import type { PromptContext } from '../types/prompt.types';
import { resolveScenario, type PromptScenario } from './scenario';

export function buildTaskPrompt(ctx: PromptContext): string {
  const scenario = resolveScenario(ctx);
  const sections: string[] = [];

  sections.push(`# Role\n\nYou are ${ctx.role.name}.\n\n${ctx.role.persona}`);

  if (ctx.skills.length > 0) {
    const skillLines = ctx.skills.map((s) => `- \`${s.command}\` — ${s.description}`).join('\n');
    sections.push(`# Available Skills\n\n${skillLines}`);
  }

  const orgInstructions = buildOrgInstructions(ctx);
  if (orgInstructions) sections.push(orgInstructions);

  const orgContext = buildOrgContext(ctx, scenario);
  if (orgContext) sections.push(orgContext);

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

  const execSequence = buildExecutionSequence(ctx);
  if (execSequence) sections.push(execSequence);

  const typeSchemaSection = buildTypeSchema(ctx, scenario);
  if (typeSchemaSection) sections.push(typeSchemaSection);

  if (ctx.role.knowledgeBaseRefs.length > 0) {
    sections.push(`# Knowledge Base References\n\n${ctx.role.knowledgeBaseRefs.join('\n')}`);
  }

  const workflowSection = buildWorkflowSchema(ctx);
  if (workflowSection) sections.push(workflowSection);

  sections.push(buildSystemModel());
  sections.push(buildIdBindings(ctx));
  sections.push(buildToolGuidance(scenario));
  sections.push(buildInstructions(ctx, scenario));

  const language = buildLanguage(ctx);
  if (language) sections.push(language);

  return sections.filter(Boolean).join('\n\n---\n\n');
}

function buildSystemModel(): string {
  return (
    `# System Context\n\n` +
    `You are an AI agent in an automated task execution system.\n` +
    `- **Stateless runs**: Each activation is independent. You have no memory of previous runs — all context is in this prompt.\n` +
    `- **Sequential execution**: Sibling tasks under the same parent execute one at a time, in order.\n` +
    `- **Automatic review**: When you transition a task to an approval status, the system automatically notifies your supervisor.\n` +
    `- **Parent propagation**: When all sibling tasks complete, the system automatically advances the parent task.\n` +
    `- **Focus**: Work solely on YOUR current task. Do not attempt to coordinate sibling tasks.`
  );
}

function buildIdBindings(ctx: PromptContext): string {
  return (
    `# Your IDs\n\n` +
    `- taskId: \`${ctx.task.id}\`\n` +
    `- roleId: \`${ctx.role.id}\`\n` +
    `- orgId: \`${ctx.task.orgId}\`\n\n` +
    `When calling tools, use these exact IDs.`
  );
}

function buildToolGuidance(scenario: PromptScenario): string {
  const tools: Record<PromptScenario, string[]> = {
    terminal_noop: ['capibara_context'],
    preview_decomposition: ['capibara_plan_submit_tree', 'capibara_ask_question', 'capibara_context'],
    eager_decomposition: ['capibara_plan_submit_tree', 'capibara_ask_question', 'capibara_context'],
    execute_leaf: ['capibara_task_transition', 'capibara_ask_question', 'capibara_context'],
    revision: ['capibara_task_transition', 'capibara_ask_question', 'capibara_context'],
    review_approve: ['capibara_task_transition', 'capibara_context'],
    task_completed: ['capibara_task_transition', 'capibara_context'],
    conversation_reply: ['capibara_task_transition', 'capibara_ask_question', 'capibara_context'],
    retry_failed: ['capibara_task_transition', 'capibara_ask_question', 'capibara_context'],
  };

  const toolDescriptions: Record<string, string> = {
    capibara_task_transition: 'Transition the current task to a new status (see Workflow Status section for available transitions)',
    capibara_plan_submit_tree: 'Submit the full decomposition tree for this task in a single call (root + all descendants). The tool validates structure server-side.',
    capibara_ask_question: 'Open an inquiry conversation with your supervisor or a peer role. The system routes the question, wakes the respondent, and resumes you with their reply.',
    capibara_context: 'Query additional context about tasks, roles, or the organization',
  };

  const lines = tools[scenario].map((t) => `- \`mcp__capibara__${t}\` — ${toolDescriptions[t]}`).join('\n');
  return `# Tool Guidance\n\nUse the following MCP tools (provided by the \`capibara\` server):\n\n${lines}`;
}

function buildWorkflowSchema(ctx: PromptContext): string | null {
  if (!ctx.workflowSchema) return null;

  const { currentStatus, availableTransitions, allStatuses, allTransitions, terminalStatuses } = ctx.workflowSchema;

  const currentLine = `Current status: **${currentStatus.label}** (\`${currentStatus.name}\`, category: ${currentStatus.category})`;

  let availableSection: string;
  if (availableTransitions.length > 0) {
    const header = '| Target Status | Label |\n|---------------|-------|';
    const rows = availableTransitions
      .map((t) => `| \`${t.targetStatus}\` | ${t.targetLabel} |`)
      .join('\n');
    availableSection = `**Available transitions from current status:**\n\n${header}\n${rows}`;
  } else {
    availableSection = '**No transitions available from current status.** This is a terminal state.';
  }

  const stHeader = '| Status | Label | Category |\n|--------|-------|----------|';
  const stRows = allStatuses.map((s) => `| \`${s.name}\` | ${s.label} | ${s.category} |`).join('\n');
  const statusTable = `**All statuses:**\n\n${stHeader}\n${stRows}`;

  const trHeader = '| From | To |\n|------|-----|';
  const trRows = allTransitions.map((t) => `| \`${t.from}\` | \`${t.to}\` |`).join('\n');
  const transitionTable = `**All transitions:**\n\n${trHeader}\n${trRows}`;

  const terminalLine = `**Terminal statuses:** ${terminalStatuses.map((s) => `\`${s}\``).join(', ')}`;

  return (
    `# Workflow Status\n\n` +
    `${currentLine}\n\n` +
    `${availableSection}\n\n` +
    `${statusTable}\n\n` +
    `${transitionTable}\n\n` +
    `${terminalLine}\n\n` +
    `> When calling \`capibara_task_transition\`, use an exact status name from the table above. ` +
    `If the transition fails, the tool will return your current status and available transitions.`
  );
}

function buildInstructions(ctx: PromptContext, scenario: PromptScenario): string {
  const collaborationGuide =
    '\n\n## Collaboration via `capibara_ask_question`\n\n' +
    'You are part of a multi-role organization, not a solo agent. When another role is better positioned to answer or decide, ' +
    'PREFER asking over guessing. Calling `capibara_ask_question` opens an inquiry conversation, the system routes it to ' +
    'your supervisor or a peer, that role wakes up and replies, and you are resumed with the answer.\n\n' +
    '**Ask proactively when ANY of the following hold:**\n' +
    '- A decision crosses role boundaries (e.g. an implementer needs an architecture call, a designer needs a product call).\n' +
    '- Acceptance criteria, scope, or priorities are ambiguous and a wrong guess would cost rework.\n' +
    '- You depend on an artifact, contract, or convention owned by another role (API shape, schema, design token, naming).\n' +
    '- You hit a constraint (budget, deadline, compliance) and cannot independently judge the trade-off.\n' +
    '- A peer\'s recent output conflicts with your task and you need them to confirm or reconcile.\n\n' +
    '**Do NOT ask** for things you can determine yourself by reading code, running a search, or following the spec already in this prompt. ' +
    'A well-formed question states: (1) what you are trying to do, (2) what is blocking you, (3) what answer would unblock you.';
  const instructions: Record<PromptScenario, string> = {
    terminal_noop:
      'This task is already in a terminal status. ' +
      'Do NOT call `capibara_plan_submit_tree` or `capibara_task_transition`. ' +
      'Treat this run as a no-op and provide a brief completion note only.',
    preview_decomposition:
      'Produce the complete decomposition tree for this task in a single call, then submit via `capibara_plan_submit_tree`. ' +
      'Structural rules:\n' +
      '- The tree root MUST match the current task (same type).\n' +
      '- Every node\'s `type` MUST appear in its parent\'s `allowedChildren` (see Type Schema). A type whose name does NOT appear in the parent\'s Allowed Children list is INVALID, even if it is non-leaf.\n' +
      '- Every leaf node\'s type MUST have `isLeaf=true`; every non-leaf MUST have at least one child.\n' +
      '- Every node MUST include a non-empty `assigneeRoleId` selected from the subordinates listed in Org Hierarchy.\n' +
      '- Total node count MUST NOT exceed 500 and depth MUST NOT exceed 10.\n' +
      '- IMPORTANT: Do NOT nest a type under itself. Check the Allowed Children column for each parent before adding a child.\n' +
      'Granularity guidance: Each leaf is consumed by an AI agent, NOT a human. Prefer COARSE granularity — a leaf should represent a meaningful unit of work an AI agent can complete in one execution turn. Do NOT split into human-checklist-sized micro-steps (e.g. "open file", "write line", "save"). Produce the smallest tree that still respects the type hierarchy and assignment rules; only split further when a single agent genuinely cannot handle the scope or when different leaves require different roles.\n' +
      'The user will review the tree and approve it before any task is persisted.\n' +
      'If the parent goal, scope, or assignee selection is genuinely ambiguous (not just under-specified detail you can decide), call `capibara_ask_question` to clarify with your supervisor before submitting the tree.' +
      collaborationGuide,
    eager_decomposition:
      'Produce the complete decomposition tree for this task in a single call, then submit via `capibara_plan_submit_tree`. ' +
      'Structural rules:\n' +
      '- The tree root MUST match the current task (same type).\n' +
      '- Every node\'s `type` MUST appear in its parent\'s `allowedChildren` (see Type Schema). A type whose name does NOT appear in the parent\'s Allowed Children list is INVALID, even if it is non-leaf.\n' +
      '- Every leaf node\'s type MUST have `isLeaf=true`; every non-leaf MUST have at least one child.\n' +
      '- Every node MUST include a non-empty `assigneeRoleId` selected from the subordinates listed in Org Hierarchy.\n' +
      '- Total node count MUST NOT exceed 500 and depth MUST NOT exceed 10.\n' +
      '- IMPORTANT: Do NOT nest a type under itself. Check the Allowed Children column for each parent before adding a child.\n' +
      'Granularity guidance: Each leaf is consumed by an AI agent, NOT a human. Prefer COARSE granularity — a leaf should represent a meaningful unit of work an AI agent can complete in one execution turn. Do NOT split into human-checklist-sized micro-steps (e.g. "open file", "write line", "save"). Produce the smallest tree that still respects the type hierarchy and assignment rules; only split further when a single agent genuinely cannot handle the scope or when different leaves require different roles.\n' +
      'The tree will be persisted immediately with NO human review. Every node must be directly actionable and every assignee must be correct.\n' +
      'Because there is no human review, the cost of guessing is high — if scope, ownership, or acceptance is genuinely ambiguous, call `capibara_ask_question` to confirm with your supervisor before submitting.' +
      collaborationGuide,
    execute_leaf:
      'Execute this task directly. ' +
      'When finished, use `capibara_task_transition` to advance to the next status (refer to the Workflow Status section).' +
      collaborationGuide,
    revision:
      'Your previous work needs revision. ' +
      'Review the latest feedback, address each point, then use `capibara_task_transition` to advance to the next status. ' +
      'If any feedback point is ambiguous or appears to conflict with a peer\'s output, use `capibara_ask_question` to clarify before reworking.' +
      collaborationGuide,
    review_approve:
      'Your previous work has been approved. ' +
      'Continue with any remaining steps or use `capibara_task_transition` to advance to the next status.',
    task_completed:
      'A child task has completed. ' +
      'Check if there are other child tasks still pending. ' +
      'If all children are done, use `capibara_task_transition` to advance the parent task.',
    conversation_reply:
      'You previously started a conversation and have received a reply. ' +
      'Read the reply, then continue your work. ' +
      'If the reply leaves a follow-up unanswered, ask again via `capibara_ask_question`; otherwise use `capibara_task_transition` to advance.' +
      collaborationGuide,
    retry_failed:
      'Your previous execution failed. ' +
      'Review the error, simplify your approach or try a different strategy, and retry. ' +
      'If the failure points to a cross-role decision (unclear contract, missing artifact from a peer, supervisor-level trade-off), use `capibara_ask_question` instead of looping on the same approach. ' +
      'Use `capibara_task_transition` to advance when ready.' +
      collaborationGuide,
  };

  const feedback = ctx.task.pendingFeedback;
  const feedbackSection =
    feedback && (scenario === 'preview_decomposition' || scenario === 'eager_decomposition')
      ? `\n\n## User Feedback on Previous Tree\n\nThe user reviewed your previous submission and left this feedback. Incorporate it when you re-submit:\n\n> ${feedback.replace(/\n/g, '\n> ')}\n\nSubmit a revised tree via \`capibara_plan_submit_tree\`.`
      : '';

  return `# Instructions\n\n${instructions[scenario]}${feedbackSection}`;
}

function buildOrgInstructions(ctx: PromptContext): string | null {
  if (!ctx.organization?.customInstructions) return null;
  return `# Organization Instructions\n\n${ctx.organization.customInstructions}`;
}

function buildOrgContext(ctx: PromptContext, scenario: PromptScenario): string | null {
  if (!ctx.orgHierarchy) return null;

  const { parentRole, subordinates, peers } = ctx.orgHierarchy;
  if (!parentRole && subordinates.length === 0 && peers.length === 0) return null;

  const showSkills =
    scenario === 'preview_decomposition' ||
    scenario === 'eager_decomposition';
  const lines: string[] = [];

  if (parentRole) {
    lines.push(`- Your superior: ${parentRole.name} (roleId: ${parentRole.id})`);
  }

  if (subordinates.length > 0) {
    lines.push('- Your subordinates:');
    for (const sub of subordinates) {
      const skills = showSkills && sub.skillDescriptions.length > 0
        ? ` — Skills: ${sub.skillDescriptions.join(', ')}`
        : '';
      lines.push(`  - ${sub.name} (roleId: ${sub.id})${skills}`);
    }
  }

  if (peers.length > 0) {
    lines.push('- Your peers:');
    for (const peer of peers) {
      lines.push(`  - ${peer.name} (roleId: ${peer.id})`);
    }
  }

  return `# Organization Context\n\n${lines.join('\n')}`;
}

function buildExecutionSequence(ctx: PromptContext): string | null {
  if (ctx.task.parentChain.length === 0) return null;
  if (ctx.task.siblings.length === 0) return null;

  const parent = ctx.task.parentChain[0];
  const allSiblings = ctx.task.siblings;
  const currentIndex = allSiblings.findIndex((s) => s.isCurrent);

  const header = `Parent: **${parent.title}** (${parent.type}, ${parent.status})\nYou are task **${currentIndex + 1} of ${allSiblings.length}**:`;

  const tableHeader = '| # | Type | Title | Assigned To | Status |\n|---|------|-------|-------------|--------|';
  const rows = allSiblings.map((s, i) => {
    const num = i + 1;
    if (s.isCurrent) {
      return `| **${num}** | **${s.type}** | **${s.title}** | **${s.assigneeRoleName ?? '—'}** | **${s.status}** |`;
    }
    return `| ${num} | ${s.type} | ${s.title} | ${s.assigneeRoleName ?? '—'} | ${s.status} |`;
  }).join('\n');

  return `# Execution Sequence\n\n${header}\n\n${tableHeader}\n${rows}`;
}

function buildTypeSchema(ctx: PromptContext, scenario: PromptScenario): string | null {
  const needsSchema =
    scenario === 'preview_decomposition' ||
    scenario === 'eager_decomposition';
  if (!needsSchema) return null;
  if (!ctx.typeSchema || ctx.typeSchema.allTypes.length === 0) return null;

  const tableHeader = '| Type | Label | Leaf | Allowed Children |\n|------|-------|:----:|-----------------|';
  const rows = ctx.typeSchema.allTypes.map((t) => {
    const children = t.allowedChildren.length > 0 ? t.allowedChildren.join(', ') : '—';
    return `| ${t.name} | ${t.label} | ${t.isLeaf ? 'Yes' : 'No'} | ${children} |`;
  }).join('\n');

  let currentInfo = '';
  if (ctx.typeSchema.currentTypeDef) {
    const def = ctx.typeSchema.currentTypeDef;
    const childTypes = def.allowedChildren.length > 0 ? def.allowedChildren.join(', ') : 'none';
    currentInfo = `\n\nYour current task type is **${def.label}** (\`${def.name}\`). You can decompose it into: ${childTypes}.`;
  }

  // Build explicit nesting chain to prevent models from guessing invalid hierarchies
  const nonLeafTypes = ctx.typeSchema.allTypes.filter((t) => !t.isLeaf);
  let nestingNote = '';
  if (nonLeafTypes.length > 0) {
    const chains: string[] = [];
    for (const t of nonLeafTypes) {
      const childrenStr = t.allowedChildren.join(', ');
      chains.push(`${t.name} → [${childrenStr}]`);
    }
    nestingNote =
      `\n\n**Nesting rules (strict):** ${chains.join(' | ')}. ` +
      `A type NOT listed in its parent's Allowed Children column is FORBIDDEN — even if it is non-leaf.`;
  }

  return `# Work Item Type Schema\n\n${tableHeader}\n${rows}${currentInfo}${nestingNote}`;
}

function buildLanguage(ctx: PromptContext): string | null {
  if (!ctx.locale.startsWith('zh')) return null;
  return `# Communication Language\n\nRespond in Chinese (中文). All output including task titles, descriptions, and plans should also be in Chinese.`;
}
