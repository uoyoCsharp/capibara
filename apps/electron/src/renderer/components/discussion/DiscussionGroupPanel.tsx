import { useEffect, useCallback } from 'react';
import { X, ChatCircleDots } from '@phosphor-icons/react';
import type {
  DiscussionGroupRecord,
  DiscussionMessageRecord,
  VoteStatsRecord,
  RoleRecord,
  TaskRecord,
  VoteTag,
} from '@shared/contracts';
import { DiscussionMessageList } from './DiscussionMessageList';
import { VoteStatsBar } from './VoteStatsBar';
import { HumanVotePanel } from './HumanVotePanel';
import { ApprovalPanelCard } from './ApprovalPanelCard';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';

interface DiscussionGroupPanelProps {
  group: DiscussionGroupRecord;
  messages: DiscussionMessageRecord[];
  voteStats: VoteStatsRecord | null;
  roles: RoleRecord[];
  tasks: TaskRecord[];
  onClose: () => void;
  onPostMessage: (content: string, voteTag: VoteTag) => void;
  onRefresh: () => void;
}

export function DiscussionGroupPanel({
  group,
  messages,
  voteStats,
  roles,
  tasks,
  onClose,
  onPostMessage,
  onRefresh,
}: DiscussionGroupPanelProps) {
  const task = tasks.find((t) => t.id === group.taskNodeId);
  const isArchived = group.status === 'archived';
  const assigneeRole = task?.assigneeRoleId ? roles.find((r) => r.id === task.assigneeRoleId) : null;
  const needsHumanApproval = task?.status === 'awaiting_review' && assigneeRole?.requiresHumanApproval;
  const childTasks = task ? tasks.filter((t) => t.parentId === task.id) : [];

  // Set up polling for real-time updates
  useEffect(() => {
    const interval = setInterval(onRefresh, 3000);
    return () => clearInterval(interval);
  }, [onRefresh]);

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Header */}
      <div className="border-b border-border px-5 py-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ChatCircleDots size={20} className="text-primary" />
            <h3 className="text-base font-semibold text-foreground truncate">
              {task?.title ?? 'Discussion'}
            </h3>
            {isArchived && (
              <Badge variant="secondary">Archived</Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
          >
            <X size={18} />
          </Button>
        </div>

        {/* Task info */}
        {task && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2">
            <span className="capitalize font-medium text-foreground">{task.type}</span>
            <span>-</span>
            <span className="capitalize">{task.status.replace('_', ' ')}</span>
          </div>
        )}

        {/* Vote stats */}
        {voteStats && <VoteStatsBar stats={voteStats} />}
      </div>

      {/* Messages */}
      <DiscussionMessageList messages={messages} roles={roles} />

      {/* Approval panel card (Story 8.2) */}
      {needsHumanApproval && task && voteStats && (
        <ApprovalPanelCard
          task={task}
          childTasks={childTasks}
          voteStats={voteStats}
          roles={roles}
          messages={messages}
          onApprove={() => onPostMessage('Human approved this task.', 'APPROVE')}
          onRevise={(feedback) => onPostMessage(feedback, 'REVISE')}
          onDelegate={(roleId) => onPostMessage(`Delegated to role ${roleId}`, 'DELEGATE')}
        />
      )}

      {/* Summary card if available */}
      {group.summary && (
        <div className="mx-5 mb-2 rounded-lg bg-primary/10 border border-primary/20 px-4 py-3">
          <p className="text-xs font-medium text-primary mb-1">Discussion Summary</p>
          <p className="text-xs text-primary/80 whitespace-pre-wrap">{group.summary}</p>
        </div>
      )}

      {/* Human vote panel */}
      {!isArchived && (
        <HumanVotePanel groupId={group.id} onSubmit={onPostMessage} />
      )}
    </div>
  );
}
