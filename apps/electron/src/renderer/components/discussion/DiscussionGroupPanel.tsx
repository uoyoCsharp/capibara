import { useEffect, useCallback, useState } from 'react';
import {
  X,
  ChatCircleDots,
  Lightbulb,
  Lightning,
  CheckCircle,
  ThumbsUp,
  PencilSimple,
  UserSwitch,
  PaperPlaneRight,
} from '@phosphor-icons/react';
import type {
  DiscussionGroupRecord,
  DiscussionMessageRecord,
  VoteStatsRecord,
  RoleRecord,
  TaskRecord,
  VoteTag,
  ConversationWorkflowRecord,
} from '@shared/contracts';
import { DiscussionMessageList } from './DiscussionMessageList';
import { VoteStatsBar } from './VoteStatsBar';
import { ApprovalPanelCard } from './ApprovalPanelCard';
import { MarkdownContent } from '../shared/MarkdownContent';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Textarea } from '../ui/textarea';
import { Separator } from '../ui/separator';
import { useT } from '../../hooks/useLocale';
import { cn } from '../../lib/utils';
import { toast } from '../../store/toast.store';

interface DiscussionGroupPanelProps {
  group: DiscussionGroupRecord;
  messages: DiscussionMessageRecord[];
  voteStats: VoteStatsRecord | null;
  roles: RoleRecord[];
  tasks: TaskRecord[];
  isReviewStatus: (status: string) => boolean;
  isTerminalStatus?: (status: string) => boolean;
  onClose: () => void;
  onPostMessage: (content: string, voteTag: VoteTag) => void;
  onRefresh: () => void;
  /** Active conversation workflow linked to this discussion group (if any) */
  activeConversation?: ConversationWorkflowRecord | null;
}

const VOTE_OPTIONS: Array<{ tag: NonNullable<VoteTag>; icon: typeof ThumbsUp; color: string }> = [
  { tag: 'APPROVE', icon: ThumbsUp, color: 'bg-green-500/10 border-green-500/40 text-green-600 hover:bg-green-500/20' },
  { tag: 'REVISE', icon: PencilSimple, color: 'bg-yellow-500/10 border-yellow-500/40 text-yellow-600 hover:bg-yellow-500/20' },
  { tag: 'CONCERN', icon: ChatCircleDots, color: 'bg-orange-500/10 border-orange-500/40 text-orange-600 hover:bg-orange-500/20' },
  { tag: 'DELEGATE', icon: UserSwitch, color: 'bg-blue-500/10 border-blue-500/40 text-blue-600 hover:bg-blue-500/20' },
];

export function DiscussionGroupPanel({
  group,
  messages,
  voteStats,
  roles,
  tasks,
  isReviewStatus,
  isTerminalStatus,
  onClose,
  onPostMessage,
  onRefresh,
  activeConversation,
}: DiscussionGroupPanelProps) {
  const t = useT();
  const task = tasks.find((t) => t.id === group.taskNodeId);
  const isArchived = group.status === 'archived';
  const assigneeRole = task?.assigneeRoleId ? roles.find((r) => r.id === task.assigneeRoleId) : null;
  const inReview = task ? isReviewStatus(task.status) : false;
  const needsHumanApproval = inReview && assigneeRole?.requiresHumanApproval;
  const childTasks = task ? tasks.filter((t) => t.parentId === task.id) : [];

  // Summary state — poll via IPC
  const [summary, setSummary] = useState<string | null>(group.summary);

  // Compose state
  const [replyText, setReplyText] = useState('');
  const [selectedVote, setSelectedVote] = useState<VoteTag>(null);
  const [sending, setSending] = useState(false);
  const [confirmResolve, setConfirmResolve] = useState(false);

  // Respondent role name for "Reply will wake" hint
  const respondentRole = activeConversation?.respondentRoleId
    ? roles.find((r) => r.id === activeConversation.respondentRoleId)
    : null;

  // Refresh summary when group changes
  useEffect(() => {
    setSummary(group.summary);
    window.capibara.getDiscussionSummary(group.id).then((res) => {
      if (res.ok) setSummary(res.data);
    });
  }, [group.id, group.summary]);

  // Poll for real-time updates + summary push events
  useEffect(() => {
    const interval = setInterval(onRefresh, 3000);

    const unsub = window.capibara.subscribe((event) => {
      if (event.type === 'discussion-summary:updated' && event.groupId === group.id) {
        setSummary(event.summary);
      }
    });

    return () => { clearInterval(interval); unsub(); };
  }, [onRefresh, group.id]);

  const handleSend = useCallback(async () => {
    const content = replyText.trim();
    if (!content) return;
    setSending(true);
    try {
      onPostMessage(content, selectedVote);
      setReplyText('');
      setSelectedVote(null);
    } catch {
      toast.error(t.errors.failedToUpdate);
    } finally {
      setSending(false);
    }
  }, [replyText, selectedVote, onPostMessage]);

  const handleResolve = useCallback(async () => {
    if (!activeConversation) return;
    try {
      const res = await window.capibara.resolveConversation({
        conversationWorkflowId: activeConversation.id,
      });
      if (res.ok) {
        toast.success(t.discussionPanel.resolved);
        setConfirmResolve(false);
        onRefresh();
      }
    } catch {
      toast.error(t.errors.failedToUpdate);
    }
  }, [activeConversation, t, onRefresh]);

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

      {/* Auto-Summary — sticky, doesn't scroll with messages */}
      {summary && (
        <div className="mx-4 mt-3 mb-1 rounded-lg bg-primary/5 border border-primary/20 px-4 py-3 shrink-0">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Lightbulb size={14} weight="fill" className="text-primary" />
            <span className="text-xs font-semibold text-primary">{t.discussionPanel.autoSummary}</span>
          </div>
          <MarkdownContent content={summary} className="text-xs text-muted-foreground leading-relaxed" />
        </div>
      )}

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
          isTerminalStatus={isTerminalStatus}
          onApprove={() => onPostMessage('Human approved this task.', 'APPROVE')}
          onRevise={(feedback) => onPostMessage(feedback, 'REVISE')}
          onDelegate={(roleId) => onPostMessage(`Delegated to role ${roleId}`, 'DELEGATE')}
        />
      )}

      {/* Compose area with vote tags */}
      {!isArchived && (
        <>
          <Separator />
          <div className="px-4 pt-3 pb-2 shrink-0 space-y-2">
            {/* Vote tag selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground mr-1">{t.discussionPanel.selectVoteTag}</span>
              {VOTE_OPTIONS.map(({ tag, icon: Icon, color }) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setSelectedVote((prev) => (prev === tag ? null : tag))}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all',
                    selectedVote === tag
                      ? color
                      : 'border-border text-muted-foreground hover:border-muted-foreground/40',
                  )}
                >
                  <Icon size={12} weight={selectedVote === tag ? 'fill' : 'regular'} />
                  {t.vote[tag]}
                </button>
              ))}
            </div>

            {/* Text input + send */}
            <div className="flex gap-2">
              <Textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder={t.discussions.typeMessagePlaceholder}
                className="min-h-[60px] max-h-[120px] resize-none text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend();
                }}
              />
              <div className="flex flex-col gap-1.5 shrink-0">
                <Button
                  size="sm"
                  disabled={!replyText.trim() || sending}
                  onClick={handleSend}
                  className="h-auto py-2 px-3"
                >
                  <PaperPlaneRight size={14} weight="fill" />
                </Button>
              </div>
            </div>

            {/* Wake hint + Mark Resolved */}
            <div className="flex items-center justify-between">
              {respondentRole && activeConversation?.state === 'waiting_for_reply' ? (
                <span className="text-[11px] text-muted-foreground">
                  <Lightning size={11} className="inline mr-0.5 text-amber-500" />
                  {t.discussionPanel.replyWillWake}: <strong>{respondentRole.name}</strong>
                </span>
              ) : (
                <span />
              )}
              {activeConversation && !confirmResolve && (
                <button
                  type="button"
                  onClick={() => setConfirmResolve(true)}
                  className="text-[11px] text-muted-foreground hover:text-destructive transition-colors"
                >
                  ({t.discussionPanel.markResolved})
                </button>
              )}
            </div>

            {/* Resolve confirmation */}
            {confirmResolve && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
                <p className="text-xs text-destructive font-medium">{t.discussionPanel.markResolvedMessage}</p>
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={() => setConfirmResolve(false)}>
                    {t.common.cancel}
                  </Button>
                  <Button variant="destructive" size="sm" onClick={handleResolve}>
                    <CheckCircle size={14} className="mr-1" />
                    {t.discussionPanel.markResolvedConfirm}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
