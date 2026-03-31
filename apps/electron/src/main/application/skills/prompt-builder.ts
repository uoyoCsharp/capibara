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
    lines.push(`- Task: ${context.task.title}`);
    lines.push(`- Type: ${context.task.type}`);
    lines.push(`- Description: ${context.task.description}`);
    lines.push(`- Status: ${context.task.status}`);
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
    lines.push('- capibara_task_complete: Mark your task as completed');
    lines.push('- capibara_task_create_subtask: Decompose work to subordinates');
    lines.push('- capibara_discussion_post: Post to discussion group / vote');
    lines.push('- capibara_escalate: Escalate to your superior');
    lines.push('');

    // Discussion Context
    if (context.discussionSummary) {
      lines.push('## Discussion Context');
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
    lines.push('Complete your task, then use capibara_task_complete to submit results.');
    lines.push('If you need to decompose work, use capibara_task_create_subtask.');
    lines.push('For review tasks, use capibara_discussion_post with the appropriate voteTag.');

    return lines.join('\n');
  }
}
