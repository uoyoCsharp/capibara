import { useRef, useEffect } from 'react';
import { clsx } from 'clsx';
import type { DiscussionMessageRecord, RoleRecord, VoteTag } from '@shared/contracts';

interface DiscussionMessageListProps {
  messages: DiscussionMessageRecord[];
  roles: RoleRecord[];
}

const VOTE_TAG_STYLES: Record<string, string> = {
  APPROVE: 'bg-success-subtle border-success/30 text-success-text',
  REVISE: 'bg-warning-subtle border-warning/30 text-warning-text',
  CONCERN: 'bg-danger-subtle border-danger/30 text-danger-text',
  DELEGATE: 'bg-info-subtle border-info/30 text-info-text',
};

const VOTE_TAG_LABELS: Record<string, string> = {
  APPROVE: '✓ APPROVE',
  REVISE: '↻ REVISE',
  CONCERN: '⚠ CONCERN',
  DELEGATE: '→ DELEGATE',
};

function getAuthorName(msg: DiscussionMessageRecord, roles: RoleRecord[]): string {
  if (msg.authorType === 'system') return 'System';
  if (msg.authorType === 'human') {
    if (msg.authorRoleId) {
      const role = roles.find((r) => r.id === msg.authorRoleId);
      return role ? `${role.name} (Human)` : 'Human';
    }
    return 'Human';
  }
  if (msg.authorRoleId) {
    const role = roles.find((r) => r.id === msg.authorRoleId);
    return role?.name ?? 'Unknown Role';
  }
  return 'Unknown';
}

function getAuthorColor(authorType: string): string {
  switch (authorType) {
    case 'ai':
      return 'bg-accent';
    case 'human':
      return 'bg-success';
    case 'system':
      return 'bg-neutral';
    default:
      return 'bg-neutral';
  }
}

export function DiscussionMessageList({ messages, roles }: DiscussionMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-text-muted">No messages yet in this discussion.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto px-5 py-4 space-y-3">
      {messages.map((msg) => {
        const authorName = getAuthorName(msg, roles);
        const isVote = msg.voteTag !== null;

        return (
          <div key={msg.id} className="group">
            {isVote ? (
              <VoteCard
                authorName={authorName}
                authorType={msg.authorType}
                voteTag={msg.voteTag!}
                content={msg.content}
                createdAt={msg.createdAt}
              />
            ) : (
              <MessageBubble
                authorName={authorName}
                authorType={msg.authorType}
                content={msg.content}
                createdAt={msg.createdAt}
              />
            )}
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}

function AuthorAvatar({ authorName, authorType }: { authorName: string; authorType: string }) {
  return (
    <div className="relative shrink-0">
      <div
        className={clsx(
          'w-7 h-7 rounded-full flex items-center justify-center text-text-inverse text-xs font-bold',
          getAuthorColor(authorType),
        )}
      >
        {authorName.charAt(0).toUpperCase()}
      </div>
      {authorType === 'human' && (
        <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-warning border-2 border-surface-card flex items-center justify-center text-[7px] font-bold text-text-inverse">
          H
        </span>
      )}
      {authorType === 'ai' && (
        <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-accent/60 border-2 border-surface-card flex items-center justify-center text-[7px] font-bold text-text-inverse">
          AI
        </span>
      )}
    </div>
  );
}

function MessageBubble({
  authorName,
  authorType,
  content,
  createdAt,
}: {
  authorName: string;
  authorType: string;
  content: string;
  createdAt: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <AuthorAvatar authorName={authorName} authorType={authorType} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className="text-sm font-medium text-text-primary">{authorName}</span>
          <span className="text-xs text-text-muted">
            {new Date(createdAt).toLocaleTimeString()}
          </span>
        </div>
        <p className="text-sm text-text-secondary whitespace-pre-wrap break-words">{content}</p>
      </div>
    </div>
  );
}

function VoteCard({
  authorName,
  authorType,
  voteTag,
  content,
  createdAt,
}: {
  authorName: string;
  authorType: string;
  voteTag: NonNullable<VoteTag>;
  content: string;
  createdAt: string;
}) {
  const style = VOTE_TAG_STYLES[voteTag] ?? 'bg-neutral-subtle border-border-default text-neutral-text';
  const label = VOTE_TAG_LABELS[voteTag] ?? voteTag;

  return (
    <div className="flex items-start gap-3">
      <AuthorAvatar authorName={authorName} authorType={authorType} />
      <div className={clsx('flex-1 rounded-lg border p-3', style)}>
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{label}</span>
            <span className="text-xs opacity-70">by {authorName}</span>
          </div>
          <span className="text-xs opacity-60">
            {new Date(createdAt).toLocaleTimeString()}
          </span>
        </div>
        {content && (
          <p className="text-sm whitespace-pre-wrap break-words opacity-90">{content}</p>
        )}
      </div>
    </div>
  );
}
