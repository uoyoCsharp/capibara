import { useState } from 'react';
import { clsx } from 'clsx';
import type { VoteTag } from '@shared/contracts';

interface HumanVotePanelProps {
  groupId: string;
  onSubmit: (content: string, voteTag: VoteTag) => void;
}

const VOTE_OPTIONS: Array<{ tag: NonNullable<VoteTag>; label: string; color: string; hoverColor: string }> = [
  { tag: 'APPROVE', label: '✓ Approve', color: 'bg-success', hoverColor: 'hover:opacity-90' },
  { tag: 'REVISE', label: '↻ Revise', color: 'bg-warning', hoverColor: 'hover:opacity-90' },
  { tag: 'CONCERN', label: '⚠ Concern', color: 'bg-danger', hoverColor: 'hover:opacity-90' },
  { tag: 'DELEGATE', label: '→ Delegate', color: 'bg-info', hoverColor: 'hover:opacity-90' },
];

export function HumanVotePanel({ groupId, onSubmit }: HumanVotePanelProps) {
  const [content, setContent] = useState('');
  const [selectedVote, setSelectedVote] = useState<VoteTag>(null);

  const handleSend = () => {
    if (!content.trim()) return;
    onSubmit(content.trim(), selectedVote);
    setContent('');
    setSelectedVote(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-border-default px-5 py-4">
      {/* Vote buttons */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-text-tertiary mr-1">Vote:</span>
        {VOTE_OPTIONS.map((opt) => (
          <button
            key={opt.tag}
            onClick={() => setSelectedVote(selectedVote === opt.tag ? null : opt.tag)}
            className={clsx(
              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              selectedVote === opt.tag
                ? `${opt.color} text-text-inverse`
                : 'bg-surface-sunken text-text-secondary hover:bg-border-default',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Message input */}
      <div className="flex items-end gap-2">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            selectedVote
              ? `Add ${selectedVote.toLowerCase()} feedback...`
              : 'Type a message...'
          }
          rows={2}
          className="flex-1 resize-none rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
        />
        <button
          onClick={handleSend}
          disabled={!content.trim()}
          className={clsx(
            'rounded-lg px-4 py-2 text-sm font-medium text-text-inverse transition-colors',
            content.trim()
              ? 'bg-accent hover:bg-accent-hover'
              : 'bg-border-default cursor-not-allowed',
          )}
        >
          Send
        </button>
      </div>
    </div>
  );
}
