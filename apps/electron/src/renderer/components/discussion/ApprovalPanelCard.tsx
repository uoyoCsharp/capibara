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
    <div className="mx-5 mb-3 rounded-[var(--card-radius)] border-2 border-warning bg-warning-subtle shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-warning/15 border-b border-warning/30">
        <ShieldCheck size={18} weight="fill" className="text-warning" />
        <span className="text-sm font-semibold text-warning-text">Human Approval Required</span>
        {assigneeRole && (
          <span className="ml-auto text-xs text-warning-text/70">
            Reviewer: {assigneeRole.name}
          </span>
        )}
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Task summary */}
        <div>
          <p className="text-xs font-medium text-text-muted mb-1">Task</p>
          <p className="text-sm text-text-primary font-medium">{task.title}</p>
          {task.description && (
            <p className="text-xs text-text-secondary mt-1 line-clamp-2">{task.description}</p>
          )}
        </div>

        {/* Subtask progress */}
        {childTasks.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <TreeStructure size={14} className="text-text-muted" />
              <p className="text-xs font-medium text-text-muted">
                Subtasks: {completedChildren.length}/{childTasks.length} completed
              </p>
            </div>
            <div className="w-full bg-surface-sunken rounded-full h-1.5">
              <div
                className="bg-success h-1.5 rounded-full transition-all"
                style={{ width: `${childTasks.length > 0 ? (completedChildren.length / childTasks.length) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}

        {/* Vote statistics */}
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <ChartBar size={14} className="text-text-muted" />
            <p className="text-xs font-medium text-text-muted">Vote Summary</p>
          </div>
          <div className="flex gap-3 text-xs">
            <span className="text-success-text">Approve: {voteStats.APPROVE}</span>
            <span className="text-warning-text">Revise: {voteStats.REVISE}</span>
            <span className="text-danger-text">Concern: {voteStats.CONCERN}</span>
            <span className="text-info-text">Delegate: {voteStats.DELEGATE}</span>
          </div>
        </div>

        {/* Key concerns */}
        {concerns.length > 0 && (
          <div>
            <p className="text-xs font-medium text-danger-text mb-1">
              Open Concerns ({concerns.length})
            </p>
            <ul className="space-y-1">
              {concerns.slice(-3).map((c) => (
                <li key={c.id} className="text-xs text-text-secondary pl-2 border-l-2 border-danger/30">
                  {c.content.slice(0, 120)}{c.content.length > 120 ? '...' : ''}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Recent revisions */}
        {revisions.length > 0 && (
          <div>
            <p className="text-xs font-medium text-warning-text mb-1">
              Revision History ({revisions.length})
            </p>
            <p className="text-xs text-text-secondary pl-2 border-l-2 border-warning/30">
              Latest: {revisions[revisions.length - 1].content.slice(0, 120)}
            </p>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2 pt-2 border-t border-warning/30">
          <button
            onClick={onApprove}
            className="flex items-center gap-1.5 rounded-lg bg-success px-4 py-2 text-sm font-medium text-text-inverse hover:opacity-90 transition-colors"
          >
            <ShieldCheck size={16} />
            Approve
          </button>
          <button
            onClick={() => setMode(mode === 'revise' ? 'idle' : 'revise')}
            className={clsx(
              'flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              mode === 'revise'
                ? 'bg-warning text-text-inverse'
                : 'bg-surface-sunken text-text-secondary hover:bg-border-default',
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
                ? 'bg-info text-text-inverse'
                : 'bg-surface-sunken text-text-secondary hover:bg-border-default',
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
              className="w-full rounded-lg border border-warning/30 bg-surface-card px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-warning"
            />
            <button
              onClick={handleReviseSubmit}
              disabled={!feedback.trim()}
              className={clsx(
                'rounded-lg px-4 py-1.5 text-sm font-medium text-text-inverse transition-colors',
                feedback.trim() ? 'bg-warning hover:opacity-90' : 'bg-border-default cursor-not-allowed',
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
              className="w-full rounded-lg border border-info/30 bg-surface-card px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-info"
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
                'rounded-lg px-4 py-1.5 text-sm font-medium text-text-inverse transition-colors',
                selectedRoleId ? 'bg-info hover:opacity-90' : 'bg-border-default cursor-not-allowed',
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
