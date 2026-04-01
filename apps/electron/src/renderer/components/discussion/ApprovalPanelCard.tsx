import { useState } from 'react';
import { ShieldCheck, ArrowsClockwise, UserSwitch, TreeStructure, ChartBar } from '@phosphor-icons/react';
import { cn } from '../../lib/utils';
import type {
  TaskRecord,
  VoteStatsRecord,
  RoleRecord,
  VoteTag,
  DiscussionMessageRecord,
} from '@shared/contracts';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Progress } from '../ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

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

  const subtaskPercent = childTasks.length > 0 ? (completedChildren.length / childTasks.length) * 100 : 0;

  return (
    <div className="mx-5 mb-3 rounded-[var(--card-radius)] border-2 border-yellow-500 bg-yellow-500/10 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-yellow-500/15 border-b border-yellow-500/30">
        <ShieldCheck size={18} weight="fill" className="text-yellow-500" />
        <span className="text-sm font-semibold text-yellow-600">Human Approval Required</span>
        {assigneeRole && (
          <span className="ml-auto text-xs text-yellow-600/70">
            Reviewer: {assigneeRole.name}
          </span>
        )}
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Task summary */}
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Task</p>
          <p className="text-sm text-foreground font-medium">{task.title}</p>
          {task.description && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{task.description}</p>
          )}
        </div>

        {/* Subtask progress */}
        {childTasks.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <TreeStructure size={14} className="text-muted-foreground" />
              <p className="text-xs font-medium text-muted-foreground">
                Subtasks: {completedChildren.length}/{childTasks.length} completed
              </p>
            </div>
            <Progress value={subtaskPercent} className="h-1.5 [&>div]:bg-green-500" />
          </div>
        )}

        {/* Vote statistics */}
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <ChartBar size={14} className="text-muted-foreground" />
            <p className="text-xs font-medium text-muted-foreground">Vote Summary</p>
          </div>
          <div className="flex gap-3 text-xs">
            <span className="text-green-600">Approve: {voteStats.APPROVE}</span>
            <span className="text-yellow-600">Revise: {voteStats.REVISE}</span>
            <span className="text-destructive">Concern: {voteStats.CONCERN}</span>
            <span className="text-blue-600">Delegate: {voteStats.DELEGATE}</span>
          </div>
        </div>

        {/* Key concerns */}
        {concerns.length > 0 && (
          <div>
            <p className="text-xs font-medium text-destructive mb-1">
              Open Concerns ({concerns.length})
            </p>
            <ul className="space-y-2">
              {concerns.slice(-3).map((c) => (
                <li key={c.id} className="text-xs text-muted-foreground pl-2 border-l-2 border-destructive/30">
                  {c.content.slice(0, 120)}{c.content.length > 120 ? '...' : ''}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Recent revisions */}
        {revisions.length > 0 && (
          <div>
            <p className="text-xs font-medium text-yellow-600 mb-1">
              Revision History ({revisions.length})
            </p>
            <p className="text-xs text-muted-foreground pl-2 border-l-2 border-yellow-500/30">
              Latest: {revisions[revisions.length - 1].content.slice(0, 120)}
            </p>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2 pt-4 border-t border-yellow-500/30">
          <Button
            onClick={onApprove}
            className="bg-green-500 hover:bg-green-500/90 text-white"
          >
            <ShieldCheck size={16} />
            Approve
          </Button>
          <Button
            variant={mode === 'revise' ? 'default' : 'secondary'}
            onClick={() => setMode(mode === 'revise' ? 'idle' : 'revise')}
            className={cn(mode === 'revise' && 'bg-yellow-500 hover:bg-yellow-500/90 text-white')}
          >
            <ArrowsClockwise size={16} />
            Revise
          </Button>
          <Button
            variant={mode === 'delegate' ? 'default' : 'secondary'}
            onClick={() => setMode(mode === 'delegate' ? 'idle' : 'delegate')}
            className={cn(mode === 'delegate' && 'bg-blue-500 hover:bg-blue-500/90 text-white')}
          >
            <UserSwitch size={16} />
            Delegate
          </Button>
        </div>

        {/* Revise feedback input */}
        {mode === 'revise' && (
          <div className="space-y-2">
            <Textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Describe what needs to be revised..."
              rows={3}
              className="border-yellow-500/30 focus-visible:ring-yellow-500"
            />
            <Button
              onClick={handleReviseSubmit}
              disabled={!feedback.trim()}
              className={cn(
                feedback.trim()
                  ? 'bg-yellow-500 hover:bg-yellow-500/90 text-white'
                  : '',
              )}
            >
              Submit Revision
            </Button>
          </div>
        )}

        {/* Delegate role selector */}
        {mode === 'delegate' && (
          <div className="space-y-2">
            <Select
              value={selectedRoleId || '_none'}
              onValueChange={(value) => setSelectedRoleId(value === '_none' ? '' : value)}
            >
              <SelectTrigger className="border-blue-500/30 focus:ring-blue-500">
                <SelectValue placeholder="Select a role to delegate to..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">Select a role to delegate to...</SelectItem>
                {delegatableRoles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={handleDelegateSubmit}
              disabled={!selectedRoleId}
              className={cn(
                selectedRoleId
                  ? 'bg-blue-500 hover:bg-blue-500/90 text-white'
                  : '',
              )}
            >
              Confirm Delegation
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
