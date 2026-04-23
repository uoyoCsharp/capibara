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
    propose_decomposition: ['capibara_ask_question', 'capibara_context'],
    execute_decomposition: ['capibara_task_create_child', 'capibara_task_transition', 'capibara_context'],
    execute_leaf: ['capibara_task_transition', 'capibara_ask_question', 'capibara_context'],
    revision: ['capibara_task_transition', 'capibara_ask_question', 'capibara_context'],
    review_approve: ['capibara_task_transition', 'capibara_context'],
    task_completed: ['capibara_task_transition', 'capibara_context'],
    conversation_reply: ['capibara_task_transition', 'capibara_ask_question', 'capibara_context'],
    retry_failed: ['capibara_task_transition', 'capibara_ask_question', 'capibara_context'],
  };

  const toolDescriptions: Record<string, string> = {
    capibara_task_transition: 'Transition the current task to a new status (see Workflow Status section for available transitions)',
    capibara_task_create_child: 'Create a child task under the current task',
    capibara_ask_question: 'Ask a question to your supervisor or a peer',
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

function buildInstructions(_ctx: PromptContext, scenario: PromptScenario): string {
  const instructions: Record<PromptScenario, string> = {
    propose_decomposition:
      'Analyze the task requirements and create a decomposition proposal. ' +
      'Use `capibara_ask_question` to submit your proposal to your supervisor for review. ' +
      'In the proposal, describe the sub-tasks you plan to create: their types, titles, assigned roles, and execution order. ' +
      'Do NOT create child tasks yet — wait for approval.',
    execute_decomposition:
      'Your decomposition proposal has been approved. ' +
      'Use `capibara_task_create_child` to create all planned child tasks. ' +
      'Then use `capibara_task_transition` to advance this task to the next appropriate status (refer to the Workflow Status section for available transitions).',
    execute_leaf:
      'Execute this task directly. ' +
      'When finished, use `capibara_task_transition` to advance to the next status (refer to the Workflow Status section). ' +
      'If the description is unclear or missing details, use `capibara_ask_question` to clarify with your supervisor first.',
    revision:
      'Your previous work needs revision. ' +
      'Review the latest feedback, address each point, then use `capibara_task_transition` to advance to the next status. ' +
      'If the feedback is unclear, use `capibara_ask_question` to clarify first.',
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
      'If you need more information, continue the conversation; otherwise, use `capibara_task_transition` to advance.',
    retry_failed:
      'Your previous execution failed. ' +
      'Review the error, simplify your approach or try a different strategy, and retry. ' +
      'Use `capibara_task_transition` to advance when ready.',
  };

  return `# Instructions\n\n${instructions[scenario]}`;
}

function buildOrgInstructions(ctx: PromptContext): string | null {
  if (!ctx.organization?.customInstructions) return null;
  return `# Organization Instructions\n\n${ctx.organization.customInstructions}`;
}

function buildOrgContext(ctx: PromptContext, scenario: PromptScenario): string | null {
  if (!ctx.orgHierarchy) return null;

  const { parentRole, subordinates, peers } = ctx.orgHierarchy;
  if (!parentRole && subordinates.length === 0 && peers.length === 0) return null;

  const showSkills = scenario === 'propose_decomposition' || scenario === 'execute_decomposition';
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
  if (scenario !== 'propose_decomposition' && scenario !== 'execute_decomposition') return null;
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

  return `# Work Item Type Schema\n\n${tableHeader}\n${rows}${currentInfo}`;
}

function buildLanguage(ctx: PromptContext): string | null {
  if (!ctx.locale.startsWith('zh')) return null;
  return `# Communication Language\n\nRespond in Chinese (中文). All output including task titles, descriptions, and plans should also be in Chinese.`;
}
