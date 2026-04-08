import { injectable } from 'tsyringe';
import type { IPromptBuilder, PromptContext } from '@main/core/interfaces/i-prompt-builder.js';
import { resolveScenario, type PromptScenario } from './prompt-scenario.js';

interface PromptIds {
  task: string;
  role: string;
  org: string;
  discussion: string | null;
}

/**
 * Scenario-driven prompt builder. Constructs the system prompt for Agent execution.
 * Does NOT inject knowledge base content — BMAD handles that autonomously.
 * See Architecture §7.4 — Prompt Construction (ADR-02).
 */
@injectable()
export class PromptBuilder implements IPromptBuilder {

  build(context: PromptContext): string {
    const scenario = resolveScenario(context);
    const ids = this.extractIds(context);

    return [
      this.buildIdentity(context),
      this.buildOrgContext(context),
      this.buildOrgInstructions(context),
      this.buildTaskContext(context),
      this.buildSkills(context),
      this.buildTools(context, scenario, ids),
      this.buildDiscussionContext(context, scenario),
      this.buildConversationContext(context),
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

  private buildOrgContext(ctx: PromptContext): string {
    const lines: string[] = ['## Organization Context'];

    if (ctx.parentRole) {
      lines.push(`- Your superior: ${ctx.parentRole.name} (roleId: ${ctx.parentRole.id})`);
    } else {
      lines.push('- You are the top-level role (no superior).');
    }

    if (ctx.subordinates.length > 0) {
      lines.push('- Your subordinates:');
      for (const r of ctx.subordinates) {
        lines.push(`  - ${r.name} (roleId: ${r.id})`);
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

  private buildSkills(ctx: PromptContext): string {
    if (ctx.skills.length === 0) return '';
    const lines = ['## Available Skills (invoke via / command)'];
    for (const skill of ctx.skills) {
      lines.push(`- ${skill.command}: ${skill.description}`);
    }
    lines.push('You can invoke these skills when you want to perform actions related to their descriptions. Always use the exact command to invoke a skill.');
    return lines.join('\n');
  }

  private buildTools(ctx: PromptContext, scenario: PromptScenario, ids: PromptIds): string {
    const lines: string[] = ['## System Tools (available as MCP tools)'];

    // capibara_context — always available
    lines.push(`- capibara_context: Query context. Use query="task" + id=<taskId>, query="org_tree" + id="${ids.org}", or query="discussion_summary" + id=<groupId>`);

    // capibara_discussion_post
    const showDiscussionPost: PromptScenario[] = [
      'escalation_reply', 'review_children', 'revision', 'delegation_received',
      'escalation_failure', 'dispute_arbitration', 'propose_decomposition',
      'execute_decomposition', 'execute_leaf',
    ];
    if (showDiscussionPost.includes(scenario)) {
      if (ids.discussion) {
        lines.push(`- capibara_discussion_post: Post to discussion group / vote. Use discussionGroupId="${ids.discussion}", authorRoleId="${ids.role}". Do NOT use for task reviews.`);
      } else {
        lines.push('- capibara_discussion_post: Post to discussion group / vote. Do NOT use for task reviews.');
      }
    }

    // capibara_task_complete
    const showComplete: PromptScenario[] = ['revision', 'execute_decomposition', 'execute_leaf'];
    if (showComplete.includes(scenario)) {
      lines.push(`- capibara_task_complete: Mark your task as completed. Use taskId="${ids.task}"`);
    }

    // capibara_task_create_child
    const showCreateChild: PromptScenario[] = ['escalation_failure', 'execute_decomposition', 'execute_leaf'];
    if (showCreateChild.includes(scenario)) {
      const isDecomposer = ctx.task.type === 'epic' || ctx.task.type === 'story';
      if (isDecomposer) {
        lines.push(`- capibara_task_create_child: Create child tasks. Use parentTaskId="${ids.task}". Type hierarchy: epic→story|spike, story→task|bug|chore|spike, task→subtask`);
      } else {
        lines.push(`- capibara_task_create_child: Create subtasks if needed. Use parentTaskId="${ids.task}", type="subtask"`);
      }
    }

    // capibara_task_review
    const showReview: PromptScenario[] = ['review_children', 'dispute_arbitration'];
    if (showReview.includes(scenario)) {
      lines.push(`- capibara_task_review: Review a child task. Use decision="approve" or "revise", reviewerRoleId="${ids.role}". Automatically posts to discussion.`);
    }

    // capibara_conversation
    const showConversation: PromptScenario[] = [
      'conversation_resume', 'escalation_reply', 'revision', 'delegation_received',
      'escalation_failure', 'dispute_arbitration', 'execute_decomposition', 'execute_leaf',
    ];
    if (showConversation.includes(scenario)) {
      lines.push(`- capibara_conversation: Ask a question (action="ask") or resolve a conversation (action="resolve"). Use taskId="${ids.task}"`);
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

  // ── Instructions router ─────────────────────────────────

  private buildInstructions(ctx: PromptContext, scenario: PromptScenario, ids: PromptIds): string {
    const lines: string[] = [
      '## Instructions',
      `IMPORTANT: When calling MCP tools, always use the exact IDs from the sections above. Your task ID is "${ids.task}".`,
    ];

    switch (scenario) {
      case 'conversation_resume':
        lines.push(this.instructConversationResume());
        break;
      case 'escalation_reply':
        lines.push(this.instructEscalationReply());
        break;
      case 'review_children':
        lines.push(this.instructReviewChildren(ctx, ids));
        break;
      case 'revision':
        lines.push(this.instructRevision(ctx, ids));
        break;
      case 'delegation_received':
        lines.push(this.instructDelegation(ids));
        break;
      case 'escalation_failure':
        lines.push(this.instructEscalationFailure());
        break;
      case 'dispute_arbitration':
        lines.push(this.instructDisputeArbitration(ids));
        break;
      case 'propose_decomposition':
        lines.push(this.instructDecompose(ctx, ids, 'propose'));
        break;
      case 'execute_decomposition':
        lines.push(this.instructDecompose(ctx, ids, 'execute'));
        break;
      case 'execute_leaf':
        lines.push(this.instructLeaf(ids));
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

  private instructReviewChildren(ctx: PromptContext, ids: PromptIds): string {
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
    lines.push(`- **APPROVE**: capibara_task_review with taskId="<child_task_id>", decision="approve", reviewerRoleId="${ids.role}", and optional feedback.`);
    lines.push(`- **REVISE**: capibara_task_review with taskId="<child_task_id>", decision="revise", reviewerRoleId="${ids.role}", and feedback describing what needs to change.`);
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
      lines.push('For **decomposition tasks** (epic/story), evaluate the decomposition plan:');
      lines.push('- Are the child tasks well-structured and comprehensive? Do they cover the full scope?');
      lines.push('- Are tasks assigned to appropriate roles with the right expertise?');
      lines.push('- Is the sequencing logical? Are dependencies properly ordered?');
      lines.push('- Is the granularity appropriate? (not too coarse, not too fine)');
    }

    if (hasLeaf) {
      lines.push('');
      lines.push('For **implementation tasks** (task/subtask/bug/chore/spike), evaluate the work output:');
      lines.push('- Does the completed work align with the task description and acceptance criteria?');
      lines.push('- Are there any obvious issues, missing pieces, or quality concerns?');
      lines.push('- Are artifacts produced and paths recorded?');
    }

    lines.push('');
    lines.push('- Is the work consistent with the overall goals of your parent task?');

    return lines.join('\n');
  }

  private instructRevision(ctx: PromptContext, ids: PromptIds): string {
    const isDecomposer = ctx.task.type === 'epic' || ctx.task.type === 'story';
    const isProposalRevision = isDecomposer && !ctx.hasChildren;

    if (isProposalRevision) {
      const label = ctx.task.type === 'epic' ? 'Epic' : 'Story';
      const postStep = ids.discussion
        ? `3. Post the revised plan using capibara_discussion_post with discussionGroupId="${ids.discussion}", authorRoleId="${ids.role}".`
        : '3. Post the revised plan using capibara_discussion_post (use the Discussion Group ID from the context above).';
      return [
        `### Your role: Revise your decomposition plan for this ${label}`,
        'Your previous decomposition plan was reviewed and revision has been requested.',
        '',
        '1. Read the **Latest REVISE feedback** in the Discussion Context above carefully.',
        '2. Revise your decomposition plan to address the feedback.',
        postStep,
        '4. Your run will end naturally after posting the revised plan. A reviewer will re-evaluate.',
      ].join('\n');
    }

    return [
      '### Your role: Address revision feedback',
      'Your previous work was reviewed and revision has been requested.',
      '',
      '1. Read the **Latest REVISE feedback** in the Discussion Context above carefully.',
      '2. Address each point raised in the feedback.',
      `3. When done, call capibara_task_complete with taskId="${ids.task}" and a summary of changes made.`,
      `4. If the feedback is unclear or you need more context, use capibara_conversation (action="ask", taskId="${ids.task}") to ask the reviewer for clarification.`,
    ].join('\n');
  }

  private instructDelegation(ids: PromptIds): string {
    return [
      '### Your role: Respond to delegation request',
      'A discussion consensus has delegated a question to you for your expertise.',
      '',
      '1. Review the Discussion Context above to understand the delegation context.',
      '2. Analyze the issue and formulate your response.',
      ids.discussion
        ? `3. Post your findings/recommendation to the discussion group using capibara_discussion_post with discussionGroupId="${ids.discussion}", authorRoleId="${ids.role}".`
        : '3. Post your findings/recommendation to the discussion group using capibara_discussion_post (use the Discussion Group ID from the context above).',
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

  private instructDisputeArbitration(ids: PromptIds): string {
    return [
      '### Your role: Arbitrate a dispute',
      "A dispute has been detected in a subordinate's task discussion. Multiple reviewers have conflicting opinions that could not be resolved through consensus.",
      '',
      '1. Review the Discussion Context above — pay attention to CONCERN and REVISE votes and their reasoning.',
      '2. Make a final decision:',
      `   - If the work is acceptable: use capibara_task_review with decision="approve", reviewerRoleId="${ids.role}"`,
      `   - If changes are needed: use capibara_task_review with decision="revise", reviewerRoleId="${ids.role}", with clear guidance`,
      '3. Post your reasoning to the discussion group for transparency.',
    ].join('\n');
  }

  private instructDecompose(ctx: PromptContext, ids: PromptIds, phase: 'propose' | 'execute'): string {
    const isEpic = ctx.task.type === 'epic';
    const parentLabel = isEpic ? 'Epic' : 'Story';
    const childLabel = isEpic ? 'stories' : 'tasks';
    const childType = isEpic ? 'story' : 'task';
    const childTypeHint = isEpic
      ? 'type="story"'
      : 'type="task" (or "bug", "chore", "spike" as appropriate)';

    if (phase === 'propose') {
      return [
        `### Your role: Propose a decomposition plan for this ${parentLabel}`,
        'Your work requires human approval BEFORE creating child tasks.',
        `1. Analyze the ${parentLabel.toLowerCase()} requirements thoroughly.`,
        `2. Design a decomposition plan: list the ${childLabel} you would create, their titles, descriptions, and which subordinate role should handle each.`,
        ids.discussion
          ? `3. Post your proposed plan using capibara_discussion_post with discussionGroupId="${ids.discussion}", authorRoleId="${ids.role}".`
          : '3. Post your proposed plan using capibara_discussion_post (use the Discussion Group ID from the context above).',
        '4. Your run will end naturally after posting the plan.',
        '5. A human reviewer will approve or revise your plan. You will be re-awakened after approval.',
      ].join('\n');
    }

    // phase === 'execute'
    const hasApproval = ctx.task.status === 'approved'
      || (ctx.discussionSummary?.voteStats?.APPROVE ?? 0) > 0;
    const approvalNote = hasApproval
      ? 'Your decomposition plan has been approved. Now create the child tasks.'
      : '';
    const ChildLabel = childLabel.charAt(0).toUpperCase() + childLabel.slice(1);

    return [
      `### Your role: Decompose this ${parentLabel} into ${ChildLabel}`,
      approvalNote,
      `1. Analyze the ${parentLabel.toLowerCase()} requirements and break them down into ${childLabel}.`,
      `2. Create each ${childType} using capibara_task_create_child with parentTaskId="${ids.task}" and ${childTypeHint}.`,
      `3. Assign each ${childType} to the most appropriate subordinate role using their role ID.`,
      `4. ${ChildLabel} will be executed sequentially in the order you create them.`,
      `5. After creating all ${childLabel}, call capibara_task_complete with taskId="${ids.task}" and a summary of the decomposition plan.`,
      `6. If requirements are ambiguous or you need clarification on scope/priorities, use capibara_conversation (action="ask", taskId="${ids.task}") to ask your supervisor before decomposing.`,
    ].filter(Boolean).join('\n');
  }

  private instructLeaf(ids: PromptIds): string {
    return [
      '### Your role: Execute this task directly',
      '1. Complete the assigned task by doing the actual implementation work.',
      `2. When done, call capibara_task_complete with taskId="${ids.task}" and a detailed summary of your work.`,
      '3. If the task is too large, you may create subtasks using capibara_task_create_child with type="subtask".',
      `4. If you are blocked, unsure about requirements, or need clarification, use capibara_conversation (action="ask", taskId="${ids.task}") to ask your supervisor BEFORE guessing or proceeding blindly.`,
    ].join('\n');
  }
}
