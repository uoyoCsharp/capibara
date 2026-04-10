import { useState, useEffect, useCallback } from 'react';
import { PaperPlaneRight, UserCircle, ChatCircle } from '@phosphor-icons/react';
import type { ConversationWorkflowRecord, DiscussionMessageRecord, DesktopEvent } from '@shared/contracts';
import { useT } from '../../hooks/useLocale';
import { toast } from '../../store/toast.store';
import { Textarea } from '../ui/textarea';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

interface ConversationReplyPanelProps {
  workflow: ConversationWorkflowRecord;
  onReplied: () => void;
}

export function ConversationReplyPanel({ workflow, onReplied }: ConversationReplyPanelProps) {
  const t = useT();
  const [replyContent, setReplyContent] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [messages, setMessages] = useState<DiscussionMessageRecord[]>([]);

  const loadHistory = useCallback(async () => {
    const result = await window.capibara.getConversationHistory(workflow.id);
    if (result.ok) setMessages(result.data);
  }, [workflow.id]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  // Refresh on discussion message events
  useEffect(() => {
    if (typeof window.capibara?.subscribe !== 'function') return;
    const unsub = window.capibara.subscribe((event: DesktopEvent) => {
      if (event.type === 'discussion:message-added') {
        void loadHistory();
      }
    });
    return unsub;
  }, [loadHistory]);

  const handleSend = async () => {
    if (!replyContent.trim() || isSending) return;
    setIsSending(true);
    try {
      const result = await window.capibara.replyToConversation({
        workflowId: workflow.id,
        content: replyContent.trim(),
      });
      if (result.ok) {
        toast.success(t.conversations.replySuccess);
        setReplyContent('');
        onReplied();
      } else {
        toast.error(result.error?.message ?? t.conversations.replyFailed);
      }
    } catch {
      toast.error(t.conversations.replyFailed);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleSend();
    }
  };

  const isWaiting = workflow.state === 'waiting_for_reply';

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <UserCircle className="h-5 w-5 text-yellow-500" weight="fill" />
          <h3 className="text-sm font-semibold">{t.conversations.needsHumanReply}</h3>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {t.conversations.questionFrom} {workflow.askingRoleId.slice(0, 8)}...
        </p>
      </div>

      {/* Message history */}
      <div className="flex-1 overflow-auto px-4 py-3 space-y-3">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              'rounded-lg px-3 py-2 text-sm',
              msg.authorType === 'human'
                ? 'ml-8 bg-primary/10 border border-primary/20'
                : 'mr-8 bg-muted',
            )}
          >
            <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              {msg.authorType === 'human' ? (
                <UserCircle className="h-3.5 w-3.5" weight="fill" />
              ) : (
                <ChatCircle className="h-3.5 w-3.5" />
              )}
              <span className="font-medium">
                {msg.authorType === 'human'
                  ? 'You'
                  : msg.authorRoleId
                    ? msg.authorRoleId.slice(0, 8) + '...'
                    : 'System'}
              </span>
              <span>·</span>
              <span>{formatTime(msg.createdAt)}</span>
              {msg.intent && (
                <>
                  <span>·</span>
                  <span className="rounded bg-muted-foreground/10 px-1 py-0.5 text-[10px]">{msg.intent}</span>
                </>
              )}
            </div>
            <div className="whitespace-pre-wrap break-words">{msg.content}</div>
          </div>
        ))}
      </div>

      {/* Reply input */}
      {isWaiting && (
        <div className="border-t px-4 py-3">
          <Textarea
            value={replyContent}
            onChange={(e) => setReplyContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t.conversations.replyPlaceholder}
            className="min-h-[80px] resize-none"
            disabled={isSending}
            autoFocus
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Ctrl+Enter</span>
            <Button
              size="sm"
              onClick={handleSend}
              disabled={!replyContent.trim() || isSending}
            >
              <PaperPlaneRight className="mr-1.5 h-4 w-4" />
              {isSending ? '...' : t.conversations.replySend}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
