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
    lines.push(`- capibara_task_create_subtask: Create subtasks. Use parentTaskId="${context.task.id}"`);
    if (context.discussionSummary) {
      lines.push(`- capibara_discussion_post: Post to discussion group / vote. Use discussionGroupId="${context.discussionSummary.groupId}", authorRoleId="${context.role.id}"`);
    } else {
      lines.push('- capibara_discussion_post: Post to discussion group / vote');
    }
    lines.push('- capibara_context_get_task: Get details about any task');
    lines.push(`- capibara_context_get_org_tree: Get org tree. Use orgId="${context.task.orgId}"`);
    lines.push('- capibara_escalate: Escalate to your superior');
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

    // Instructions
    lines.push('## Instructions');
    lines.push(`IMPORTANT: When calling MCP tools, always use the exact IDs provided above. Your task ID is "${context.task.id}".`);
    lines.push('1. Complete your assigned task.');
    lines.push(`2. When done, call capibara_task_complete with taskId="${context.task.id}" and a summary of your work.`);
    lines.push('3. If you need to decompose work, use capibara_task_create_subtask.');
    lines.push('4. For review tasks, use capibara_discussion_post with the appropriate voteTag (APPROVE, REVISE, CONCERN, or DELEGATE).');

    return lines.join('\n');
  }
}
