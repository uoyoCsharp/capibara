import type { IDiscussionRepository } from '@main/core/interfaces/i-discussion.repository.js';
import type { IConversationWorkflowRepository } from '@main/core/interfaces/i-conversation-workflow.repository.js';
import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
import type { ConversationWorkflow, ContextBudgetConfig } from '@main/core/types/conversation.types.js';
import type { DiscussionMessage, WakeTrigger } from '@main/core/types/domain.types.js';

const DEFAULT_CONFIG: ContextBudgetConfig = {
  maxConversationTokens: 8000,
  truncationStrategy: 'oldest_first',
};

export class ConversationContextBuilder {
  constructor(
    private readonly discussionRepo: IDiscussionRepository,
    private readonly workflowRepo: IConversationWorkflowRepository,
    private readonly roleRepo: IRoleRepository,
    private readonly config: ContextBudgetConfig = DEFAULT_CONFIG,
  ) {}

  async build(
    workflow: ConversationWorkflow,
    trigger: WakeTrigger,
  ): Promise<string> {
    // Collect messages from the full cascade chain (walk parentWorkflowId)
    const cascadeChain = await this.collectCascadeChain(workflow);
    const allMessages: DiscussionMessage[] = [];
    const seenMessageIds = new Set<string>();

    for (const wf of cascadeChain) {
      const messages = await this.discussionRepo.findMessagesByGroupId(wf.discussionGroupId);
      const conversationMessages = messages.filter(
        (m) => m.intent === 'question' || m.intent === 'reply' || m.intent === 'escalation',
      );
      for (const msg of conversationMessages) {
        if (!seenMessageIds.has(msg.id)) {
          seenMessageIds.add(msg.id);
          allMessages.push(msg);
        }
      }
    }

    if (allMessages.length === 0) {
      return '';
    }

    // Sort by creation time for correct chronological order
    allMessages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    // Build role name lookup (batch query instead of N individual queries)
    const uniqueRoleIds = [...new Set(
      allMessages.map((m) => m.authorRoleId).filter((id): id is string => id != null),
    )];
    const roles = await this.roleRepo.findByIds(uniqueRoleIds);
    const roleNames = new Map<string, string>(
      roles.map((r) => [r.id, r.name]),
    );
    // Ensure all referenced roleIds have an entry (fallback to ID if not found in DB)
    for (const id of uniqueRoleIds) {
      if (!roleNames.has(id)) roleNames.set(id, id);
    }

    // Format messages
    let formattedMessages: string;
    const tokenEstimate = this.estimateTokens(allMessages);

    if (tokenEstimate <= this.config.maxConversationTokens) {
      formattedMessages = this.formatAllMessages(allMessages, roleNames, workflow.askingRoleId);
    } else {
      formattedMessages = this.formatTruncatedMessages(allMessages, roleNames, workflow.askingRoleId);
    }

    // Build wake reason
    const isCascade = cascadeChain.length > 1;
    const wakeReason = trigger === 'discussion_reply'
      ? `- Trigger: discussion_reply\n- You are resuming your previous session. Your prior work context is preserved.${isCascade ? `\n- This conversation spans ${cascadeChain.length} hops in the escalation chain.` : ''}\n- Continue from where you left off, incorporating the reply above.`
      : `- Trigger: conversation_escalation\n- A conversation has been escalated to you.${isCascade ? `\n- This conversation spans ${cascadeChain.length} hops in the escalation chain.` : ''}\n- Review the conversation history and provide your response.`;

    return [
      '## Conversation Context',
      '',
      'You previously asked a question and have received a reply. Continue your work based on this conversation.',
      '',
      '### Conversation History',
      formattedMessages,
      '',
      '### Wake Reason',
      wakeReason,
    ].join('\n');
  }

  /**
   * Walk the parentWorkflowId chain to collect the full cascade in order:
   * root → child → grandchild → ... → current workflow.
   */
  private async collectCascadeChain(workflow: ConversationWorkflow): Promise<ConversationWorkflow[]> {
    const chain: ConversationWorkflow[] = [workflow];
    const visited = new Set<string>([workflow.id]);
    let current = workflow;

    while (current.parentWorkflowId) {
      if (visited.has(current.parentWorkflowId)) break;
      const parent = await this.workflowRepo.findById(current.parentWorkflowId);
      if (!parent) break;
      visited.add(parent.id);
      chain.unshift(parent); // prepend so root is first
      current = parent;
    }

    return chain;
  }

  private formatAllMessages(
    messages: DiscussionMessage[],
    roleNames: Map<string, string>,
    askingRoleId: string,
  ): string {
    return messages.map((msg, idx) => {
      const roleName = this.formatAuthorName(msg, roleNames, askingRoleId);
      return `[${idx + 1}] ${roleName} [${msg.intent}]: ${msg.content}\n    -- ${msg.createdAt}`;
    }).join('\n\n');
  }

  private formatTruncatedMessages(
    messages: DiscussionMessage[],
    roleNames: Map<string, string>,
    askingRoleId: string,
  ): string {
    const recentCount = messages.length > 15 ? 5 : 10;

    // Guard: if message count fits within recent window + 2 anchors, format all
    if (messages.length <= recentCount + 2) {
      return this.formatAllMessages(messages, roleNames, askingRoleId);
    }

    const firstQuestion = messages[0];
    // Anchor: latest reply (last message with intent 'reply')
    const lastReplyIdx = this.findLastReplyIndex(messages);
    const recentMessages = messages.slice(-recentCount);
    const recentStartIdx = messages.length - recentCount;

    const lines: string[] = [];

    // Always include first question (anchor 1)
    const firstName = this.formatAuthorName(firstQuestion, roleNames, askingRoleId);
    lines.push(`[1] ${firstName} [${firstQuestion.intent}]: ${firstQuestion.content}\n    -- ${firstQuestion.createdAt}`);

    // Determine omitted range
    const anchorIndices = new Set<number>([0]);
    if (lastReplyIdx >= 0 && lastReplyIdx < recentStartIdx) {
      anchorIndices.add(lastReplyIdx);
    }

    // Count truly omitted messages (between first question and recent window, excluding anchored reply)
    let truncatedCount = 0;
    for (let i = 1; i < recentStartIdx; i++) {
      if (!anchorIndices.has(i)) truncatedCount++;
    }

    // Insert anchored latest reply if it falls outside the recent window
    if (lastReplyIdx >= 0 && lastReplyIdx > 0 && lastReplyIdx < recentStartIdx) {
      if (truncatedCount > 0) {
        const beforeReply = lastReplyIdx - 1; // messages between first and reply
        const afterReply = recentStartIdx - lastReplyIdx - 1;
        if (beforeReply > 0) {
          lines.push(`\n[${beforeReply} earlier messages omitted]\n`);
        }
      }
      const replyMsg = messages[lastReplyIdx];
      const replyName = this.formatAuthorName(replyMsg, roleNames, askingRoleId);
      lines.push(`[${lastReplyIdx + 1}] ${replyName} [${replyMsg.intent}]: ${replyMsg.content}\n    -- ${replyMsg.createdAt}`);
      const afterCount = recentStartIdx - lastReplyIdx - 1;
      if (afterCount > 0) {
        lines.push(`\n[${afterCount} messages omitted]\n`);
      }
    } else if (truncatedCount > 0) {
      lines.push(`\n[${truncatedCount} earlier messages omitted]\n`);
    }

    // Recent messages
    for (let i = 0; i < recentMessages.length; i++) {
      const msg = recentMessages[i];
      const roleName = this.formatAuthorName(msg, roleNames, askingRoleId);
      lines.push(`[${recentStartIdx + i + 1}] ${roleName} [${msg.intent}]: ${msg.content}\n    -- ${msg.createdAt}`);
    }

    return lines.join('\n\n');
  }

  private findLastReplyIndex(messages: DiscussionMessage[]): number {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].intent === 'reply') return i;
    }
    return -1;
  }

  private formatAuthorName(
    msg: DiscussionMessage,
    roleNames: Map<string, string>,
    askingRoleId: string,
  ): string {
    if (!msg.authorRoleId) return 'System';
    return msg.authorRoleId === askingRoleId
      ? `You (${roleNames.get(msg.authorRoleId) ?? msg.authorRoleId})`
      : roleNames.get(msg.authorRoleId) ?? msg.authorRoleId;
  }

  private estimateTokens(messages: DiscussionMessage[]): number {
    let totalChars = 0;
    for (const msg of messages) {
      totalChars += msg.content.length + 50; // overhead for formatting
    }
    return Math.ceil(totalChars / 4); // rough char/4 heuristic
  }
}
