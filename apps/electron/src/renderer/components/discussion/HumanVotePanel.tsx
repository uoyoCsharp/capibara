import { useState } from 'react';
import { clsx } from 'clsx';
import type { VoteTag } from '@shared/contracts';

interface HumanVotePanelProps {
  groupId: string;
  onSubmit: (content: string, voteTag: VoteTag) => void;
}

const VOTE_OPTIONS: Array<{ tag: NonNullable<VoteTag>; label: string; color: string; hoverColor: string }> = [
  { tag: 'APPROVE', label: '✓ Approve', color: 'bg-green-600', hoverColor: 'hover:bg-green-700' },
  { tag: 'REVISE', label: '↻ Revise', color: 'bg-orange-500', hoverColor: 'hover:bg-orange-600' },
  { tag: 'CONCERN', label: '⚠ Concern', color: 'bg-red-500', hoverColor: 'hover:bg-red-600' },
  { tag: 'DELEGATE', label: '→ Delegate', color: 'bg-blue-500', hoverColor: 'hover:bg-blue-600' },
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
    <div className="border-t border-gray-200 px-5 py-3">
      {/* Vote buttons */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-gray-500 mr-1">Vote:</span>
        {VOTE_OPTIONS.map((opt) => (
          <button
            key={opt.tag}
            onClick={() => setSelectedVote(selectedVote === opt.tag ? null : opt.tag)}
            className={clsx(
              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              selectedVote === opt.tag
                ? `${opt.color} text-white`
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
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
          className="flex-1 resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
        <button
          onClick={handleSend}
          disabled={!content.trim()}
          className={clsx(
            'rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors',
            content.trim()
              ? 'bg-indigo-600 hover:bg-indigo-700'
              : 'bg-gray-300 cursor-not-allowed',
          )}
        >
          Send
        </button>
      </div>
    </div>
  );
}
