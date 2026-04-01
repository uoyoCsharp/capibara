import { useState } from 'react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import type { VoteTag } from '@shared/contracts';

interface HumanVotePanelProps {
  groupId: string;
  onSubmit: (content: string, voteTag: VoteTag) => void;
}

const VOTE_OPTIONS: Array<{ tag: NonNullable<VoteTag>; label: string; activeClass: string }> = [
  { tag: 'APPROVE', label: 'Approve', activeClass: 'bg-green-500 text-white hover:bg-green-500/90' },
  { tag: 'REVISE', label: 'Revise', activeClass: 'bg-yellow-500 text-white hover:bg-yellow-500/90' },
  { tag: 'CONCERN', label: 'Concern', activeClass: 'bg-destructive text-white hover:bg-destructive/90' },
  { tag: 'DELEGATE', label: 'Delegate', activeClass: 'bg-blue-500 text-white hover:bg-blue-500/90' },
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
    <div className="border-t border-border px-5 py-4">
      {/* Vote buttons */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-muted-foreground mr-1">Vote:</span>
        {VOTE_OPTIONS.map((opt) => (
          <Button
            key={opt.tag}
            variant={selectedVote === opt.tag ? 'default' : 'secondary'}
            size="sm"
            onClick={() => setSelectedVote(selectedVote === opt.tag ? null : opt.tag)}
            className={cn(
              'text-xs h-7',
              selectedVote === opt.tag && opt.activeClass,
            )}
          >
            {opt.label}
          </Button>
        ))}
      </div>

      {/* Message input */}
      <div className="flex items-end gap-2">
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            selectedVote
              ? `Add ${selectedVote.toLowerCase()} feedback...`
              : 'Type a message...'
          }
          rows={2}
          className="flex-1 resize-none"
        />
        <Button
          onClick={handleSend}
          disabled={!content.trim()}
        >
          Send
        </Button>
      </div>
    </div>
  );
}
