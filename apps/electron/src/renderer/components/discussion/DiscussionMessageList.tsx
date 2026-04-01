import { useRef, useEffect } from 'react';
import { cn } from '../../lib/utils';
import { Avatar, AvatarFallback } from '../ui/avatar';
import type { DiscussionMessageRecord, RoleRecord, VoteTag } from '@shared/contracts';

interface DiscussionMessageListProps {
  messages: DiscussionMessageRecord[];
  roles: RoleRecord[];
}

const VOTE_TAG_STYLES: Record<string, string> = {
  APPROVE: 'bg-green-500/10 border-green-500/30 text-green-600',
  REVISE: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-600',
  CONCERN: 'bg-destructive/10 border-destructive/30 text-destructive',
  DELEGATE: 'bg-blue-500/10 border-blue-500/30 text-blue-600',
};

const VOTE_TAG_LABELS: Record<string, string> = {
  APPROVE: 'APPROVE',
  REVISE: 'REVISE',
  CONCERN: 'CONCERN',
  DELEGATE: 'DELEGATE',
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
      return 'bg-primary';
    case 'human':
      return 'bg-green-500';
    case 'system':
      return 'bg-muted-foreground';
    default:
      return 'bg-muted-foreground';
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
        <p className="text-sm text-muted-foreground">No messages yet in this discussion.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto px-5 py-5 space-y-4">
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
      <Avatar className="w-7 h-7">
        <AvatarFallback className={cn('text-xs font-bold text-primary-foreground', getAuthorColor(authorType))}>
          {authorName.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      {authorType === 'human' && (
        <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-yellow-500 border-2 border-card flex items-center justify-center text-[7px] font-bold text-primary-foreground">
          H
        </span>
      )}
      {authorType === 'ai' && (
        <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-primary/60 border-2 border-card flex items-center justify-center text-[7px] font-bold text-primary-foreground">
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
          <span className="text-sm font-medium text-foreground">{authorName}</span>
          <span className="text-xs text-muted-foreground">
            {new Date(createdAt).toLocaleTimeString()}
          </span>
        </div>
        <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">{content}</p>
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
  const style = VOTE_TAG_STYLES[voteTag] ?? 'bg-muted border-border text-muted-foreground';
  const label = VOTE_TAG_LABELS[voteTag] ?? voteTag;

  return (
    <div className="flex items-start gap-3">
      <AuthorAvatar authorName={authorName} authorType={authorType} />
      <div className={cn('flex-1 rounded-lg border p-3', style)}>
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
