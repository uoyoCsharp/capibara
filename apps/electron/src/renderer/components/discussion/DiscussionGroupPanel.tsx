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

  // Set up polling for real-time updates
  useEffect(() => {
    const interval = setInterval(onRefresh, 3000);
    return () => clearInterval(interval);
  }, [onRefresh]);

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="border-b border-gray-200 px-5 py-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <ChatCircleDots size={20} className="text-indigo-500" />
            <h3 className="text-base font-semibold text-gray-900 truncate">
              {task?.title ?? 'Discussion'}
            </h3>
            {isArchived && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                Archived
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X size={18} />
          </button>
        </div>

        {/* Task info */}
        {task && (
          <div className="flex items-center gap-3 text-xs text-gray-500 mb-2">
            <span className="capitalize font-medium text-gray-600">{task.type}</span>
            <span>•</span>
            <span className="capitalize">{task.status.replace('_', ' ')}</span>
          </div>
        )}

        {/* Vote stats */}
        {voteStats && <VoteStatsBar stats={voteStats} />}
      </div>

      {/* Messages */}
      <DiscussionMessageList messages={messages} roles={roles} />

      {/* Summary card if available */}
      {group.summary && (
        <div className="mx-5 mb-2 rounded-lg bg-indigo-50 border border-indigo-100 px-4 py-3">
          <p className="text-xs font-medium text-indigo-700 mb-1">Discussion Summary</p>
          <p className="text-xs text-indigo-600 whitespace-pre-wrap">{group.summary}</p>
        </div>
      )}

      {/* Human vote panel */}
      {!isArchived && (
        <HumanVotePanel groupId={group.id} onSubmit={onPostMessage} />
      )}
    </div>
  );
}
