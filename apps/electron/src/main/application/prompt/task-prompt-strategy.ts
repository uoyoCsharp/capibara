import type { PromptContext } from '@main/core/interfaces/i-prompt-builder.js';
import { resolveScenario, type PromptScenario } from './prompt-scenario.js';
import { formatTypeSchema, formatLanguageInstruction } from './prompt-utils.js';

interface PromptIds {
  task: string;
  role: string;
  org: string;
  discussion: string | null;
}

export class TaskPromptStrategy {

  build(context: PromptContext): string {
    const scenario = resolveScenario(context);
    const ids = this.extractIds(context);

    // OPT-06: Reordered sections — context block then action block
    return [
      this.buildIdentity(context),
      this.buildOrgContext(context, scenario),
      this.buildOrgInstructions(context),
      this.buildTaskContext(context),
      this.buildTypeSchema(context),
      this.buildSystemContext(context, scenario),
      this.buildDiscussionContext(context, scenario),
      this.buildConversationContext(context),
      this.buildPriorWorkContext(context, scenario),
      this.buildSkills(context),
      this.buildTools(context, scenario, ids),
      this.buildLanguage(context),
      this.buildInstructions(context, scenario, ids),
    ].filter(Boolean).join('\n\n');
  }

  // ── ID extraction ───────────────────────────────────────

  private extractIds(ctx: PromptContext): PromptIds {
    return {
      task: ctx.task.id,
      role: ctx.role.id,
      org: ctx.task.orgId,
      discussion: ctx.discussionSummary?.groupId ?? null,
    };
  }

  // ── Section builders ────────────────────────────────────

  private buildIdentity(ctx: PromptContext): string {
    return `You are ${ctx.role.name}. ${ctx.role.persona}`;
  }

  // OPT-04: Inject subordinate skill descriptions for decomposition/assignment scenarios
  private buildOrgContext(ctx: PromptContext, scenario: PromptScenario): string {
    const lines: string[] = ['## Organization Context'];

    if (ctx.parentRole) {
      lines.push(`- Your superior: ${ctx.parentRole.name} (roleId: ${ctx.parentRole.id})`);
    } else {
      lines.push('- You are the top-level role (no superior).');
    }

    if (ctx.subordinates.length > 0) {
      lines.push('- Your subordinates:');
      const needSkills: PromptScenario[] = [
        'propose_decomposition', 'execute_decomposition', 'escalation_failure',
      ];
      const showSkills = needSkills.includes(scenario);

      for (const r of ctx.subordinates) {
        if (showSkills && ctx.subordinateSkills?.has(r.id)) {
          const skills = ctx.subordinateSkills.get(r.id)!;
          lines.push(`  - ${r.name} (roleId: ${r.id}) — Skills: ${skills.join(', ')}`);
        } else {
          lines.push(`  - ${r.name} (roleId: ${r.id})`);
        }
      }
    }

    if (ctx.peers.length > 0) {
      lines.push('- Your peers:');
      for (const r of ctx.peers) {
        lines.push(`  - ${r.name} (roleId: ${r.id})`);
      }
    }

    return lines.join('\n');
  }

  private buildOrgInstructions(ctx: PromptContext): string {
    const instructions = ctx.organization?.customInstructions?.trim();
    if (!instructions) return '';
    return `## Organization Instructions\n${instructions}`;
  }

  private buildTaskContext(ctx: PromptContext): string {
    const desc = ctx.task.description?.trim();
    return [
      '## Current Task',
      `- Task ID: ${ctx.task.id}`,
      `- Task: ${ctx.task.title}`,
      `- Type: ${ctx.task.type}`,
      `- Description: ${desc || '(none provided — work from the title and discussion context)'}`,
      `- Status: ${ctx.task.status}`,
      `- Organization ID: ${ctx.task.orgId}`,
      `- Your Role ID: ${ctx.role.id}`,
    ].join('\n');
  }

  // OPT-09: Full Work Item Type Schema as independent shared context
  private buildTypeSchema(ctx: PromptContext): string {
    return formatTypeSchema(ctx.allItemTypes, ctx.taskTypeDef);
  }

  // OPT-10: System Context — execution model + execution sequence
  private buildSystemContext(ctx: PromptContext, scenario: PromptScenario): string {
    const lines: string[] = ['## System Context'];

    // Part 1: Execution model (static, shared across all task scenarios)
    lines.push(
      '',
      '### How This System Works',
      'You are an AI agent in an automated task execution system. Key behaviors:',
      '- **Stateless runs**: Each time you are activated is an independent run. You have no memory of previous runs — all context is provided in this prompt.',
      '- **Sequential execution**: Sibling tasks under the same parent execute one at a time, in order. The system automatically starts the next task when the current one completes.',
      '- **Automatic review**: When you call capibara_task_complete, the system automatically notifies your supervisor for review. You do NOT need to manually request a review.',
      '- **Revision cycle**: If a reviewer requests revision, you will be re-activated with the feedback. Address the feedback and call capibara_task_complete again.',
      '- **Parent propagation**: When all sibling tasks complete, the system automatically advances the parent task. You do not manage parent task status.',
      '- **Your responsibility**: Focus solely on YOUR current task. Do not attempt to start, coordinate, or communicate with sibling tasks.',
    );

    // Part 2: Execution sequence (dynamic, only when siblings exist)
    if (ctx.siblingTasks && ctx.siblingTasks.length > 0 && ctx.parentTask) {
      const currentIndex = ctx.siblingTasks.findIndex(s => s.isCurrent);
      const total = ctx.siblingTasks.length;
      const position = currentIndex >= 0 ? currentIndex + 1 : '?';

      lines.push(
        '',
        '### Execution Sequence',
        `Parent task: **${ctx.parentTask.title}** (${ctx.parentTask.type}, ${ctx.parentTask.status})`,
        '',
        `You are task **${position} of ${total}** in the execution sequence:`,
        '',
        '| # | Type | Title | Assigned To | Status | Summary |',
        '|---|------|-------|-------------|--------|---------|',
      );

      for (let i = 0; i < ctx.siblingTasks.length; i++) {
        const s = ctx.siblingTasks[i];
        const num = i + 1;
        const assignee = s.assigneeRoleName ?? '—';
        const summary = s.isCurrent
          ? '**(you are here)**'
          : (s.workSummary ?? '—');

        if (s.isCurrent) {
          lines.push(`| **${num}** | **${s.type}** | **${s.title}** | **${assignee}** | **${s.status}** | ${summary} |`);
        } else {
          lines.push(`| ${num} | ${s.type} | ${s.title} | ${assignee} | ${s.status} | ${summary} |`);
        }
      }
    }

    return lines.join('\n');
  }

  private buildSkills(ctx: PromptContext): string {
    if (ctx.skills.length === 0) return '';
    const lines = ['## Available Skills (invoke via / command)'];
    for (const skill of ctx.skills) {
      lines.push(`- ${skill.command}: ${skill.description}`);
    }
    lines.push('You can invoke these skills when you want to perform actions related to their descriptions. Always use the exact command to invoke a skill.');
    return lines.join('\n');
  }

  private buildLanguage(ctx: PromptContext): string {
    const instruction = formatLanguageInstruction(ctx.communicationLanguage);
    if (!instruction) return '';
    return `## Communication Language\n${instruction}`;
  }

  // OPT-01 + OPT-02: Streamlined tools — ID bindings declared once, no redundant descriptions
  private buildTools(ctx: PromptContext, scenario: PromptScenario, ids: PromptIds): string {
    const lines: string[] = ['## Available Tools & ID Bindings'];

    // Centralized ID bindings — declared once, referenced by all instructions
    lines.push(`Your IDs: taskId="${ids.task}", roleId="${ids.role}", orgId="${ids.org}"${
      ids.discussion ? `, discussionGroupId="${ids.discussion}"` : ''
    }`);
    lines.push('');
    lines.push('Tools available in this scenario:');

    // capibara_context — always available
    lines.push('- capibara_context');

    // capibara_discussion_post
    const showDiscussionPost: PromptScenario[] = [
      'escalation_reply', 'review_children', 'revision', 'delegation_received',
      'escalation_failure', 'dispute_arbitration', 'propose_decomposition',
      'execute_decomposition', 'execute_leaf',
    ];
    if (showDiscussionPost.includes(scenario)) {
      lines.push('- capibara_discussion_post (NOT for task reviews)');
    }

    // capibara_task_complete
    const showComplete: PromptScenario[] = ['revision', 'execute_decomposition', 'execute_leaf'];
    if (showComplete.includes(scenario)) {
      lines.push('- capibara_task_complete');
    }

    // capibara_task_create_child
    const showCreateChild: PromptScenario[] = ['escalation_failure', 'execute_decomposition', 'execute_leaf'];
    if (showCreateChild.includes(scenario)) {
      lines.push('- capibara_task_create_child (see "Work Item Type Schema" above for allowed types)');
    }

    // capibara_task_review
    const showReview: PromptScenario[] = ['review_children', 'dispute_arbitration'];
    if (showReview.includes(scenario)) {
      lines.push('- capibara_task_review (decision: "approve" or "revise")');
    }

    // capibara_plan_tasks — only for planning scenario
    if (scenario === 'planning') {
      lines.push('- capibara_plan_tasks');
    }

    // capibara_conversation
    const showConversation: PromptScenario[] = [
      'conversation_resume', 'escalation_reply', 'revision', 'delegation_received',
      'escalation_failure', 'dispute_arbitration', 'propose_decomposition',
      'execute_decomposition', 'execute_leaf', 'planning',
    ];
    if (showConversation.includes(scenario)) {
      lines.push('- capibara_conversation (action: "ask" | "resolve")');
    }

    return lines.join('\n');
  }

  private buildDiscussionContext(ctx: PromptContext, scenario: PromptScenario): string {
    if (!ctx.discussionSummary) return '';

    const ds = ctx.discussionSummary;
    const { voteStats } = ds;
    const lines: string[] = [
      '## Discussion Context',
      `- Discussion Group ID: ${ds.groupId}`,
      `Vote statistics: APPROVE=${voteStats.APPROVE}, REVISE=${voteStats.REVISE}, CONCERN=${voteStats.CONCERN}, DELEGATE=${voteStats.DELEGATE}`,
    ];

    if (ds.recentMessages.length > 0) {
      lines.push('Recent messages:');
      for (const msg of ds.recentMessages) {
        const tag = msg.voteTag ? ` [${msg.voteTag}]` : '';
        lines.push(`  - ${msg.authorName}${tag}: ${msg.content}`);
      }
    }

    if (ds.latestReviseFeedback) {
      lines.push(`Latest REVISE feedback: ${ds.latestReviseFeedback}`);
    }

    if (scenario === 'dispute_arbitration' && ds.disputeSummary) {
      lines.push(`\n**Dispute Summary**: ${ds.disputeSummary}`);
    }

    return lines.join('\n');
  }

  private buildConversationContext(ctx: PromptContext): string {
    return ctx.conversationContext ?? '';
  }

  // OPT-03: Prior work context for revision scenarios
  private buildPriorWorkContext(ctx: PromptContext, scenario: PromptScenario): string {
    if (scenario !== 'revision' || !ctx.priorWork) return '';

    const lines: string[] = ['## Your Previous Work'];

    if (ctx.priorWork.lastRunSummary) {
      lines.push(`**Run summary**: ${ctx.priorWork.lastRunSummary}`);
    }

    if (ctx.priorWork.artifactPaths.length > 0) {
      lines.push(`**Artifacts produced**: ${ctx.priorWork.artifactPaths.join(', ')}`);
    }

    if (ctx.priorWork.proposedPlan) {
      const MAX_PLAN_TOKENS = 1000;
      const plan = ctx.priorWork.proposedPlan;
      // Rough char-based truncation (~4 chars per token)
      const maxChars = MAX_PLAN_TOKENS * 4;
      const truncated = plan.length > maxChars
        ? plan.slice(0, maxChars) + '\n\n(plan truncated)'
        : plan;
      lines.push(`**Your proposed plan**:\n${truncated}`);
    }

    return lines.length > 1 ? lines.join('\n') : '';
  }

  // ── Instructions router ─────────────────────────────────

  // OPT-02: IDs no longer repeated inline — instructions reference the ID bindings section
  private buildInstructions(ctx: PromptContext, scenario: PromptScenario, ids: PromptIds): string {
    const lines: string[] = [
      '## Instructions',
      'When calling tools, use the IDs declared in the "Available Tools & ID Bindings" section above.',
    ];

    // OPT-07: Explain review_requested with no children fall-through
    if (ctx.trigger === 'review_requested' && ctx.childrenAwaitingReview.length === 0) {
      lines.push('');
      lines.push('Note: A review was requested but no child tasks are currently awaiting review. '
        + 'This may mean reviews were already processed. Continue with normal task execution.');
    }

    // Warn when task has no description
    const needsRequirements: PromptScenario[] = ['execute_leaf', 'execute_decomposition', 'propose_decomposition'];
    if (!ctx.task.description?.trim() && needsRequirements.includes(scenario)) {
      lines.push('');
      lines.push('**WARNING**: This task has no description. You SHOULD use capibara_conversation (action="ask") to ask your supervisor for requirements before proceeding. Do not guess at requirements.');
    }

    switch (scenario) {
      case 'conversation_resume':
        lines.push(this.instructConversationResume());
        break;
      case 'escalation_reply':
        lines.push(this.instructEscalationReply());
        break;
      case 'review_children':
        lines.push(this.instructReviewChildren(ctx));
        break;
      case 'revision':
        lines.push(this.instructRevision(ctx));
        break;
      case 'delegation_received':
        lines.push(this.instructDelegation());
        break;
      case 'escalation_failure':
        lines.push(this.instructEscalationFailure());
        break;
      case 'dispute_arbitration':
        lines.push(this.instructDisputeArbitration());
        break;
      case 'propose_decomposition':
        lines.push(this.instructDecompose(ctx, 'propose'));
        break;
      case 'execute_decomposition':
        lines.push(this.instructDecompose(ctx, 'execute'));
        break;
      case 'execute_leaf':
        lines.push(this.instructLeaf());
        break;
      case 'planning':
        lines.push(this.instructPlanning(ctx));
        break;
    }

    // Append collaboration hint for scenarios with discussion access
    const noCollabHint: PromptScenario[] = ['conversation_resume', 'escalation_reply'];
    if (!noCollabHint.includes(scenario) && ctx.discussionSummary) {
      lines.push('');
      lines.push('For review/collaboration, use capibara_discussion_post with the appropriate voteTag (APPROVE, REVISE, CONCERN, or DELEGATE).');
    }

    return lines.join('\n');
  }

  // ── Instruction sub-methods ─────────────────────────────
  // OPT-02: IDs removed from inline instructions — tools resolve IDs from bindings section

  private instructConversationResume(): string {
    return [
      '### Conversation Resume',
      'You were previously working on this task and asked a question. A reply has been received.',
      '',
      '1. Review the Conversation Context above.',
      '2. Continue your work, incorporating the reply.',
      '3. If the reply is sufficient, proceed with task completion.',
      '4. If you need further clarification, use capibara_conversation (action="ask") to ask a follow-up.',
      '5. When done with the conversation, use capibara_conversation (action="resolve").',
    ].join('\n');
  }

  private instructEscalationReply(): string {
    return [
      '### Escalated Question',
      'A conversation has been escalated to you because the original respondent could not reply in time.',
      '',
      '1. Review the Conversation Context above.',
      '2. Answer the escalated question to the best of your ability.',
      '3. Use capibara_discussion_post to post your reply.',
      '4. If you cannot answer, use capibara_conversation (action="ask") to escalate further.',
    ].join('\n');
  }

  private instructReviewChildren(ctx: PromptContext): string {
    const lines: string[] = [
      '### Your role: Review completed child tasks',
      `You are the owner of "${ctx.task.title}" (${ctx.task.type}). One or more child tasks have been completed and need your review.`,
      '',
      '**Child tasks awaiting your review:**',
    ];

    for (const child of ctx.childrenAwaitingReview) {
      const { task: t, assigneeRoleName, deliverable, workSummary } = child;
      const assigneeInfo = assigneeRoleName ? ` — assigned to ${assigneeRoleName}` : '';
      lines.push(`- **[${t.type}] ${t.title}** (ID: ${t.id})${assigneeInfo}`);

      if (t.description) {
        lines.push(`  Description: ${t.description}`);
      }

      // Type-aware deliverable display
      if (deliverable.kind === 'decomposition') {
        if (deliverable.grandchildren.length > 0) {
          lines.push(`  **Decomposition result** (${deliverable.grandchildren.length} child tasks created):`);
          for (const gc of deliverable.grandchildren) {
            const gcAssignee = gc.assigneeRoleName ? ` → ${gc.assigneeRoleName}` : '';
            lines.push(`    - [${gc.type}] ${gc.title} (${gc.status})${gcAssignee}`);
          }
        } else {
          lines.push('  **Warning**: This is a decomposition task (epic/story) but no child tasks were created.');
        }
      } else if (deliverable.kind === 'leaf') {
        if (deliverable.artifactPaths.length > 0) {
          lines.push(`  **Artifacts produced**: ${deliverable.artifactPaths.join(', ')}`);
        }
      }

      if (workSummary) {
        lines.push(`  **Latest run summary**: ${workSummary}`);
      }
    }

    lines.push('');
    lines.push('**Review the recent discussion messages above** for additional execution context.');
    lines.push('');
    lines.push('For EACH child task awaiting review, use capibara_task_review:');
    lines.push('- **APPROVE**: decision="approve" with optional feedback.');
    lines.push('- **REVISE**: decision="revise" with feedback describing what needs to change.');
    lines.push('');

    // Type-aware review criteria
    const hasDecomposition = ctx.childrenAwaitingReview.some(
      (c) => c.deliverable.kind === 'decomposition',
    );
    const hasLeaf = ctx.childrenAwaitingReview.some(
      (c) => c.deliverable.kind === 'leaf',
    );

    lines.push('**Review criteria:**');

    if (hasDecomposition) {
      lines.push('');
      lines.push('For **decomposition tasks**, evaluate the decomposition plan:');
      lines.push('- Are the child tasks well-structured and comprehensive? Do they cover the full scope?');
      lines.push('- Are tasks assigned to appropriate roles with the right expertise?');
      lines.push('- Is the sequencing logical? Are dependencies properly ordered?');
      lines.push('- Is the granularity appropriate? (not too coarse, not too fine)');
    }

    if (hasLeaf) {
      lines.push('');
      lines.push('For **implementation tasks**, evaluate the work output:');
      lines.push('- Does the completed work align with the task description and acceptance criteria?');
      lines.push('- Are there any obvious issues, missing pieces, or quality concerns?');
      lines.push('- Are artifacts produced and paths recorded?');
    }

    lines.push('');
    lines.push('- Is the work consistent with the overall goals of your parent task?');

    return lines.join('\n');
  }

  private instructRevision(ctx: PromptContext): string {
    const isDecomposer = ctx.taskTypeDef?.canDecompose ?? false;
    const isProposalRevision = isDecomposer && !ctx.hasChildren;

    if (isProposalRevision) {
      const label = ctx.taskTypeDef?.label ?? ctx.task.type;
      return [
        `### Your role: Revise your decomposition plan for this ${label}`,
        'Your previous decomposition plan was reviewed and revision has been requested.',
        '',
        '1. Read the **Latest REVISE feedback** in the Discussion Context above carefully.',
        ctx.priorWork?.proposedPlan
          ? '2. Review **Your Previous Work** above to see your original proposal.'
          : '2. Review your previous proposal in the discussion messages.',
        '3. Revise your decomposition plan to address the feedback.',
        '4. Post the revised plan using capibara_discussion_post.',
        '5. Your run will end naturally after posting the revised plan. A reviewer will re-evaluate.',
      ].join('\n');
    }

    return [
      '### Your role: Address revision feedback',
      'Your previous work was reviewed and revision has been requested.',
      '',
      '1. Read the **Latest REVISE feedback** in the Discussion Context above carefully.',
      ctx.priorWork
        ? '2. Review **Your Previous Work** above to understand what you did last time.'
        : '2. Review your previous work context.',
      '3. If the feedback is unclear, contradictory, or you disagree with it, use capibara_conversation (action="ask") to discuss with the reviewer BEFORE making changes.',
      '4. Address each point raised in the feedback.',
      '5. When done, call capibara_task_complete with a summary of changes made.',
    ].join('\n');
  }

  private instructDelegation(): string {
    return [
      '### Your role: Respond to delegation request',
      'A discussion consensus has delegated a question to you for your expertise.',
      '',
      '1. Review the Discussion Context above to understand the delegation context.',
      '2. Analyze the issue and formulate your response.',
      '3. Post your findings/recommendation using capibara_discussion_post.',
      '4. If you need clarification, use capibara_conversation (action="ask") to ask the delegating team.',
    ].join('\n');
  }

  private instructEscalationFailure(): string {
    return [
      '### Your role: Resolve escalated failure',
      "A subordinate role's task has exceeded its retry or revision limits and requires your intervention.",
      '',
      '1. Review the Discussion Context above to understand the failure history.',
      '2. Assess the situation and decide on a resolution:',
      '   - Simplify the task scope and re-assign by creating new child tasks',
      '   - Provide additional guidance via capibara_discussion_post',
      '   - Take over the work directly',
      '3. Take action using the appropriate tools above.',
    ].join('\n');
  }

  private instructDisputeArbitration(): string {
    return [
      '### Your role: Arbitrate a dispute',
      "A dispute has been detected in a subordinate's task discussion. Multiple reviewers have conflicting opinions that could not be resolved through consensus.",
      '',
      '1. Review the Discussion Context above — pay attention to CONCERN and REVISE votes and their reasoning.',
      '2. Make a final decision:',
      '   - If the work is acceptable: use capibara_task_review with decision="approve"',
      '   - If changes are needed: use capibara_task_review with decision="revise" and clear guidance',
      '3. Post your reasoning to the discussion group for transparency.',
    ].join('\n');
  }

  // OPT-05: Added defensive instructions for decomposition
  private instructDecompose(ctx: PromptContext, phase: 'propose' | 'execute'): string {
    const typeDef = ctx.taskTypeDef;
    const parentLabel = typeDef?.label ?? ctx.task.type;
    const allowedChildren = typeDef?.allowedChildren ?? [];
    const childLabel = allowedChildren.length > 0 ? allowedChildren.join('/') + 's' : 'tasks';
    const ChildLabel = childLabel.charAt(0).toUpperCase() + childLabel.slice(1);

    if (phase === 'propose') {
      return [
        `### Your role: Propose a decomposition plan for this ${parentLabel}`,
        'Your work requires human approval BEFORE creating child tasks.',
        `1. Analyze the ${parentLabel.toLowerCase()} requirements thoroughly.`,
        '2. If the requirements are incomplete, vague, or contain contradictions, use capibara_conversation (action="ask") to clarify with your supervisor BEFORE proposing a plan.',
        `3. Design a decomposition plan with 2-7 ${childLabel}. If you feel you need more, the granularity is likely too fine — group related work into fewer, larger items.`,
        `4. Each child should represent a meaningful, independently deliverable unit of work.`,
        '',
        'Present your plan in this format:',
        '',
        `| # | Type | Title | Assigned To | Description |`,
        `|---|------|-------|-------------|-------------|`,
        `| 1 | ... | ... | ... | ... |`,
        '',
        '**Rationale**: (explain your decomposition strategy and sequencing logic)',
        '',
        '5. Post your proposed plan using capibara_discussion_post.',
        '6. Your run will end naturally after posting the plan.',
        '7. A human reviewer will approve or revise your plan. You will be re-awakened after approval.',
      ].join('\n');
    }

    // phase === 'execute'
    const hasApproval = ctx.isTaskTerminal === true
      || (ctx.discussionSummary?.voteStats?.APPROVE ?? 0) > 0;
    const approvalNote = hasApproval
      ? 'Your decomposition plan has been approved. Now create the child tasks.'
      : '';

    return [
      `### Your role: Decompose this ${parentLabel} into ${ChildLabel}`,
      approvalNote,
      `1. Review the ${parentLabel.toLowerCase()} requirements. If any aspect is unclear or ambiguous, use capibara_conversation (action="ask") to ask your supervisor before decomposing.`,
      `2. Create 2-7 child tasks using capibara_task_create_child. Refer to the "Work Item Type Schema" above for allowed child types.`,
      `3. Assign each child to the most appropriate subordinate role using their role ID.`,
      `4. Each child should represent a meaningful, independently deliverable unit of work.`,
      `5. ${ChildLabel} will be executed sequentially in the order you create them.`,
      `6. After creating all ${childLabel}, call capibara_task_complete with a summary of the decomposition plan.`,
    ].filter(Boolean).join('\n');
  }

  // OPT-05: Added defensive instruction about subtask creation
  private instructLeaf(): string {
    return [
      '### Your role: Execute this task directly',
      '1. Review the task requirements. If the description is missing or ambiguous, use capibara_conversation (action="ask") to ask your supervisor for clarification BEFORE starting work.',
      '2. Complete the assigned task by doing the actual implementation work.',
      '3. When done, call capibara_task_complete with a detailed summary of your work.',
      '4. Only create subtasks if the task genuinely requires multiple distinct deliverables that cannot be completed in a single pass. Most tasks should be completed directly without subtasks.',
      '5. If you encounter a blocker or need to make a decision that could go either way, use capibara_conversation (action="ask") to ask your supervisor rather than guessing.',
    ].join('\n');
  }

  private instructPlanning(ctx: PromptContext): string {
    const pc = ctx.planningContext;
    const lines: string[] = [
      '### Your role: AI Planning Agent',
      'You are guiding a user through a conversational planning process to create a structured task plan.',
      'Your goal is to understand what the user wants to build, help them think through the problem, and produce a concrete plan of tasks.',
      '',
      '**When ready to submit the plan**, call `capibara_plan_tasks` with a structured JSON payload.',
      '- Ask questions using `capibara_conversation` (action="ask", recipientTarget={type:"human"}).',
    ];

    // Communication language instruction
    if (pc?.communicationLanguage) {
      const langName = pc.communicationLanguage.startsWith('zh') ? 'Chinese (中文)' : 'English';
      lines.push(`- Converse with the user in ${langName}. Task titles and descriptions in the final plan should be in English regardless of conversation language.`);
    }

    // Add org roles context
    if (pc?.orgRoles && pc.orgRoles.length > 0) {
      lines.push('');
      lines.push('**Available roles for task assignment:**');
      for (const r of pc.orgRoles) {
        const skills = r.skillDescriptions.length > 0
          ? ` — Skills: ${r.skillDescriptions.join(', ')}`
          : '';
        lines.push(`- ${r.name} (roleId: ${r.id})${skills}`);
      }
    }

    return lines.join('\n');
  }
}
