import { injectable } from 'tsyringe';
import type { IPromptBuilder, PromptContext } from '@main/core/interfaces/i-prompt-builder.js';

/**
 * Lightweight prompt builder. Constructs the system prompt for Agent execution.
 * Does NOT inject knowledge base content — BMAD handles that autonomously.
 * See Architecture §7.4 — Prompt Construction (ADR-02).
 */
@injectable()
export class PromptBuilder implements IPromptBuilder {
  build(context: PromptContext): string {
    const lines: string[] = [];

    lines.push(`You are ${context.role.name}. ${context.role.persona}`);
    lines.push('');

    // Organization Context
    lines.push('## Organization Context');
    if (context.parentRole) {
      lines.push(`- Your superior: ${context.parentRole.name}`);
    } else {
      lines.push('- You are the top-level role (no superior).');
    }
    if (context.subordinates.length > 0) {
      lines.push(`- Your subordinates: ${context.subordinates.map((r) => r.name).join(', ')}`);
    }
    if (context.peers.length > 0) {
      lines.push(`- Your peers: ${context.peers.map((r) => r.name).join(', ')}`);
    }
    lines.push('');

    // Current Task
    lines.push('## Current Task');
    lines.push(`- Task ID: ${context.task.id}`);
    lines.push(`- Task: ${context.task.title}`);
    lines.push(`- Type: ${context.task.type}`);
    lines.push(`- Description: ${context.task.description}`);
    lines.push(`- Status: ${context.task.status}`);
    lines.push(`- Organization ID: ${context.task.orgId}`);
    lines.push(`- Your Role ID: ${context.role.id}`);
    lines.push('');

    // Available Skills
    if (context.skills.length > 0) {
      lines.push('## Available Skills (invoke via / command)');
      for (const skill of context.skills) {
        lines.push(`- ${skill.command}: ${skill.description}`);
      }
      lines.push('');
    }

    // System Tools
    lines.push('## System Tools (available as MCP tools)');
    lines.push(`- capibara_task_complete: Mark your task as completed. Use taskId="${context.task.id}"`);
    lines.push(`- capibara_task_create_child: Create child tasks. Use parentTaskId="${context.task.id}". Type hierarchy: epic→story|spike, story→task|bug|chore|spike, task→subtask`);
    if (context.discussionSummary) {
      lines.push(`- capibara_discussion_post: Post to discussion group / vote. Use discussionGroupId="${context.discussionSummary.groupId}", authorRoleId="${context.role.id}"`);
    } else {
      lines.push('- capibara_discussion_post: Post to discussion group / vote');
    }
    lines.push('- capibara_context_get_task: Get details about any task');
    lines.push(`- capibara_context_get_org_tree: Get org tree. Use orgId="${context.task.orgId}"`);
    lines.push(`- capibara_task_review: Review a child task. Use decision="approve" or "revise", reviewerRoleId="${context.role.id}"`);
    lines.push('- capibara_escalate: Escalate to your superior');
    lines.push(`- capibara_ask_question: Ask a question and wait for a reply. Use taskId="${context.task.id}"`);
    lines.push(`- capibara_mark_conversation_resolved: Mark conversation resolved. Use taskId="${context.task.id}"`);
    lines.push('');

    // Discussion Context
    if (context.discussionSummary) {
      lines.push('## Discussion Context');
      lines.push(`- Discussion Group ID: ${context.discussionSummary.groupId}`);
      const ds = context.discussionSummary;
      const { voteStats } = ds;
      lines.push(
        `Vote statistics: APPROVE=${voteStats.APPROVE}, REVISE=${voteStats.REVISE}, CONCERN=${voteStats.CONCERN}, DELEGATE=${voteStats.DELEGATE}`,
      );
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
      lines.push('');
    }

    // Conversation Context (injected when trigger is discussion_reply or conversation_escalation)
    if (context.conversationContext) {
      lines.push(context.conversationContext);
      lines.push('');
    }

    // Instructions (type-specific)
    lines.push('## Instructions');
    lines.push(`IMPORTANT: When calling MCP tools, always use the exact IDs provided above. Your task ID is "${context.task.id}".`);

    // ─── Conversation Resume Mode ──────────────────────────────────
    if (context.trigger === 'discussion_reply' && context.conversationContext) {
      lines.push('### Conversation Resume');
      lines.push('You were previously working on this task and asked a question. A reply has been received.');
      lines.push('');
      lines.push('1. Review the Conversation Context above.');
      lines.push('2. Continue your work, incorporating the reply.');
      lines.push('3. If the reply is sufficient, proceed with task completion.');
      lines.push('4. If you need further clarification, use capibara_ask_question to ask a follow-up.');
      lines.push('5. When done with the conversation, use capibara_mark_conversation_resolved.');
      return lines.join('\n');
    }

    if (context.trigger === 'conversation_escalation' && context.conversationContext) {
      lines.push('### Escalated Question');
      lines.push('A conversation has been escalated to you because the original respondent could not reply in time.');
      lines.push('');
      lines.push('1. Review the Conversation Context above.');
      lines.push('2. Answer the escalated question to the best of your ability.');
      lines.push('3. Use capibara_discussion_post to post your reply.');
      lines.push('4. If you cannot answer, use capibara_ask_question to escalate further.');
      return lines.join('\n');
    }

    // ─── Review Mode: woken to review child task results ─────────────
    if (context.trigger === 'review_requested' && context.childrenAwaitingReview.length === 0) {
      // No children in awaiting_review (may have been approved/transitioned already).
      // Fall through to normal execution instructions rather than generating an empty review prompt.
    } else if (context.trigger === 'review_requested' && context.childrenAwaitingReview.length > 0) {
      lines.push('### Your role: Review completed child tasks');
      lines.push(`You are the owner of "${context.task.title}" (${context.task.type}). One or more child tasks have been completed and need your review.`);
      lines.push('');
      lines.push('**Child tasks awaiting your review:**');
      for (const child of context.childrenAwaitingReview) {
        lines.push(`- **[${child.type}] ${child.title}** (ID: ${child.id})`);
        if (child.description) {
          lines.push(`  Description: ${child.description}`);
        }
      }
      lines.push('');
      lines.push('**Review the recent discussion messages above** for execution summaries and context.');
      lines.push('');
      lines.push('For EACH child task awaiting review, use capibara_task_review:');
      lines.push(`- **APPROVE**: capibara_task_review with taskId="<child_task_id>", decision="approve", reviewerRoleId="${context.role.id}", and optional feedback.`);
      lines.push(`- **REVISE**: capibara_task_review with taskId="<child_task_id>", decision="revise", reviewerRoleId="${context.role.id}", and feedback describing what needs to change.`);
      lines.push('');
      lines.push('Review criteria:');
      lines.push('- Does the completed work align with the task description and acceptance criteria?');
      lines.push('- Are there any obvious issues, missing pieces, or quality concerns?');
      lines.push('- Is the work consistent with the overall goals of your parent task?');

      return lines.join('\n');
    }

    // ─── Normal execution instructions ──────────────────────────────
    const taskType = context.task.type;
    const requiresHumanApproval = context.role.requiresHumanApproval === true;

    // For decomposition tasks (epic/story), check if human approval has already been granted
    // either via discussion APPROVE vote OR by the task already being in 'approved' status
    // (e.g., human clicked approve button in UI directly).
    const hasHumanApproval = context.task.status === 'approved'
      || (context.discussionSummary?.voteStats
        ? context.discussionSummary.voteStats.APPROVE > 0
        : false);

    if (taskType === 'epic' && requiresHumanApproval && !hasHumanApproval) {
      // Phase 1: Propose decomposition plan (do NOT create children yet)
      lines.push('### Your role: Propose a decomposition plan for this Epic');
      lines.push('Your work requires human approval BEFORE creating child tasks.');
      lines.push('1. Analyze the epic requirements thoroughly.');
      lines.push('2. Design a decomposition plan: list the stories you would create, their titles, descriptions, and which subordinate role should handle each.');
      lines.push(`3. Post your proposed plan to the discussion group using capibara_discussion_post with discussionGroupId="${context.discussionSummary?.groupId ?? ''}" and authorRoleId="${context.role.id}".`);
      lines.push('4. **Do NOT create child tasks yet.** Do NOT call capibara_task_create_child.');
      lines.push('5. **Do NOT call capibara_task_complete.** Your run will end naturally after posting the plan.');
      lines.push('6. A human reviewer will approve or revise your plan. You will be re-awakened after approval.');
    } else if (taskType === 'epic') {
      // Phase 2 (after approval) or no human approval needed: Create children
      lines.push('### Your role: Decompose this Epic into Stories');
      if (hasHumanApproval) {
        lines.push('Your decomposition plan has been approved. Now create the child tasks.');
      }
      lines.push('1. Analyze the epic requirements and break them down into user stories.');
      lines.push(`2. Create each story using capibara_task_create_child with parentTaskId="${context.task.id}" and type="story".`);
      lines.push('3. Assign each story to the most appropriate subordinate role using their role ID.');
      lines.push('4. Stories will be executed sequentially in the order you create them.');
      lines.push(`5. After creating all stories, call capibara_task_complete with taskId="${context.task.id}" and a summary of the decomposition plan.`);
    } else if (taskType === 'story' && requiresHumanApproval && !hasHumanApproval) {
      // Phase 1: Propose decomposition plan (do NOT create children yet)
      lines.push('### Your role: Propose a decomposition plan for this Story');
      lines.push('Your work requires human approval BEFORE creating child tasks.');
      lines.push('1. Analyze the story requirements thoroughly.');
      lines.push('2. Design a decomposition plan: list the tasks you would create, their titles, descriptions, and which role should handle each.');
      lines.push(`3. Post your proposed plan to the discussion group using capibara_discussion_post with discussionGroupId="${context.discussionSummary?.groupId ?? ''}" and authorRoleId="${context.role.id}".`);
      lines.push('4. **Do NOT create child tasks yet.** Do NOT call capibara_task_create_child.');
      lines.push('5. **Do NOT call capibara_task_complete.** Your run will end naturally after posting the plan.');
      lines.push('6. A human reviewer will approve or revise your plan. You will be re-awakened after approval.');
    } else if (taskType === 'story') {
      // Phase 2 (after approval) or no human approval needed: Create children
      lines.push('### Your role: Decompose this Story into Tasks');
      if (hasHumanApproval) {
        lines.push('Your decomposition plan has been approved. Now create the child tasks.');
      }
      lines.push('1. Analyze the story requirements and break them down into concrete implementation tasks.');
      lines.push(`2. Create each task using capibara_task_create_child with parentTaskId="${context.task.id}" and type="task" (or "bug", "chore", "spike" as appropriate).`);
      lines.push('3. Assign each task to the most appropriate role (yourself or a subordinate) using their role ID.');
      lines.push('4. Tasks will be executed sequentially in the order you create them.');
      lines.push(`5. After creating all tasks, call capibara_task_complete with taskId="${context.task.id}" and a summary of the decomposition plan.`);
    } else {
      lines.push('### Your role: Execute this task directly');
      lines.push('1. Complete the assigned task by doing the actual implementation work.');
      lines.push(`2. When done, call capibara_task_complete with taskId="${context.task.id}" and a detailed summary of your work.`);
      lines.push('3. If the task is too large, you may create subtasks using capibara_task_create_child with type="subtask".');
    }

    if (context.discussionSummary) {
      lines.push('');
      lines.push('For review/collaboration, use capibara_discussion_post with the appropriate voteTag (APPROVE, REVISE, CONCERN, or DELEGATE).');
    }

    return lines.join('\n');
  }
}
