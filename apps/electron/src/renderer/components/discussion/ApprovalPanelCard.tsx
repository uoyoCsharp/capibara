import { useState } from 'react';
import { ShieldCheck, ArrowsClockwise, UserSwitch, TreeStructure, ChartBar } from '@phosphor-icons/react';
import { clsx } from 'clsx';
import type {
  TaskRecord,
  VoteStatsRecord,
  RoleRecord,
  VoteTag,
  DiscussionMessageRecord,
} from '@shared/contracts';

interface ApprovalPanelCardProps {
  task: TaskRecord;
  childTasks: TaskRecord[];
  voteStats: VoteStatsRecord;
  roles: RoleRecord[];
  messages: DiscussionMessageRecord[];
  onApprove: () => void;
  onRevise: (feedback: string) => void;
  onDelegate: (targetRoleId: string) => void;
}

export function ApprovalPanelCard({
  task,
  childTasks,
  voteStats,
  roles,
  messages,
  onApprove,
  onRevise,
  onDelegate,
}: ApprovalPanelCardProps) {
  const [mode, setMode] = useState<'idle' | 'revise' | 'delegate'>('idle');
  const [feedback, setFeedback] = useState('');
  const [selectedRoleId, setSelectedRoleId] = useState('');

  const assigneeRole = roles.find((r) => r.id === task.assigneeRoleId);
  const completedChildren = childTasks.filter(
    (t) => t.status === 'approved' || t.status === 'done',
  );
  const concerns = messages.filter((m) => m.voteTag === 'CONCERN');
  const revisions = messages.filter((m) => m.voteTag === 'REVISE');
  const delegatableRoles = roles.filter(
    (r) => r.id !== task.assigneeRoleId && r.status === 'active',
  );

  const handleReviseSubmit = () => {
    if (!feedback.trim()) return;
    onRevise(feedback.trim());
    setFeedback('');
    setMode('idle');
  };

  const handleDelegateSubmit = () => {
    if (!selectedRoleId) return;
    onDelegate(selectedRoleId);
    setSelectedRoleId('');
    setMode('idle');
  };

  return (
    <div className="mx-5 mb-3 rounded-xl border-2 border-amber-300 bg-amber-50 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-amber-100 border-b border-amber-200">
        <ShieldCheck size={18} weight="fill" className="text-amber-600" />
        <span className="text-sm font-semibold text-amber-800">Human Approval Required</span>
        {assigneeRole && (
          <span className="ml-auto text-xs text-amber-600">
            Reviewer: {assigneeRole.name}
          </span>
        )}
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Task summary */}
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1">Task</p>
          <p className="text-sm text-gray-900 font-medium">{task.title}</p>
          {task.description && (
            <p className="text-xs text-gray-600 mt-1 line-clamp-2">{task.description}</p>
          )}
        </div>

        {/* Subtask progress */}
        {childTasks.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <TreeStructure size={14} className="text-gray-400" />
              <p className="text-xs font-medium text-gray-500">
                Subtasks: {completedChildren.length}/{childTasks.length} completed
              </p>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-1.5">
              <div
                className="bg-green-500 h-1.5 rounded-full transition-all"
                style={{ width: `${childTasks.length > 0 ? (completedChildren.length / childTasks.length) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}

        {/* Vote statistics */}
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <ChartBar size={14} className="text-gray-400" />
            <p className="text-xs font-medium text-gray-500">Vote Summary</p>
          </div>
          <div className="flex gap-3 text-xs">
            <span className="text-green-700">Approve: {voteStats.APPROVE}</span>
            <span className="text-orange-600">Revise: {voteStats.REVISE}</span>
            <span className="text-red-600">Concern: {voteStats.CONCERN}</span>
            <span className="text-blue-600">Delegate: {voteStats.DELEGATE}</span>
          </div>
        </div>

        {/* Key concerns */}
        {concerns.length > 0 && (
          <div>
            <p className="text-xs font-medium text-red-600 mb-1">
              Open Concerns ({concerns.length})
            </p>
            <ul className="space-y-1">
              {concerns.slice(-3).map((c) => (
                <li key={c.id} className="text-xs text-gray-600 pl-2 border-l-2 border-red-200">
                  {c.content.slice(0, 120)}{c.content.length > 120 ? '...' : ''}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Recent revisions */}
        {revisions.length > 0 && (
          <div>
            <p className="text-xs font-medium text-orange-600 mb-1">
              Revision History ({revisions.length})
            </p>
            <p className="text-xs text-gray-600 pl-2 border-l-2 border-orange-200">
              Latest: {revisions[revisions.length - 1].content.slice(0, 120)}
            </p>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2 pt-2 border-t border-amber-200">
          <button
            onClick={onApprove}
            className="flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors"
          >
            <ShieldCheck size={16} />
            Approve
          </button>
          <button
            onClick={() => setMode(mode === 'revise' ? 'idle' : 'revise')}
            className={clsx(
              'flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              mode === 'revise'
                ? 'bg-orange-500 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200',
            )}
          >
            <ArrowsClockwise size={16} />
            Revise
          </button>
          <button
            onClick={() => setMode(mode === 'delegate' ? 'idle' : 'delegate')}
            className={clsx(
              'flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              mode === 'delegate'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200',
            )}
          >
            <UserSwitch size={16} />
            Delegate
          </button>
        </div>

        {/* Revise feedback input */}
        {mode === 'revise' && (
          <div className="space-y-2">
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Describe what needs to be revised..."
              rows={3}
              className="w-full rounded-lg border border-orange-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
            <button
              onClick={handleReviseSubmit}
              disabled={!feedback.trim()}
              className={clsx(
                'rounded-lg px-4 py-1.5 text-sm font-medium text-white transition-colors',
                feedback.trim() ? 'bg-orange-500 hover:bg-orange-600' : 'bg-gray-300 cursor-not-allowed',
              )}
            >
              Submit Revision
            </button>
          </div>
        )}

        {/* Delegate role selector */}
        {mode === 'delegate' && (
          <div className="space-y-2">
            <select
              value={selectedRoleId}
              onChange={(e) => setSelectedRoleId(e.target.value)}
              className="w-full rounded-lg border border-blue-200 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <option value="">Select a role to delegate to...</option>
              {delegatableRoles.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <button
              onClick={handleDelegateSubmit}
              disabled={!selectedRoleId}
              className={clsx(
                'rounded-lg px-4 py-1.5 text-sm font-medium text-white transition-colors',
                selectedRoleId ? 'bg-blue-500 hover:bg-blue-600' : 'bg-gray-300 cursor-not-allowed',
              )}
            >
              Confirm Delegation
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
