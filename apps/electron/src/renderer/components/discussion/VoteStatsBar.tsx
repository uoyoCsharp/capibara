import type { VoteStatsRecord } from '@shared/contracts';

interface VoteStatsBarProps {
  stats: VoteStatsRecord;
}

const VOTE_COLORS = {
  APPROVE: 'bg-green-500',
  REVISE: 'bg-orange-500',
  CONCERN: 'bg-red-500',
  DELEGATE: 'bg-blue-500',
};

const VOTE_TEXT_COLORS = {
  APPROVE: 'text-green-700',
  REVISE: 'text-orange-700',
  CONCERN: 'text-red-700',
  DELEGATE: 'text-blue-700',
};

export function VoteStatsBar({ stats }: VoteStatsBarProps) {
  const total = stats.APPROVE + stats.REVISE + stats.CONCERN + stats.DELEGATE;
  const entries = (
    ['APPROVE', 'REVISE', 'CONCERN', 'DELEGATE'] as const
  ).filter((tag) => stats[tag] > 0);

  return (
    <div className="flex items-center gap-4 text-xs">
      {entries.length === 0 && (
        <span className="text-gray-400">No votes yet</span>
      )}
      {entries.map((tag) => (
        <span key={tag} className={`flex items-center gap-1.5 font-medium ${VOTE_TEXT_COLORS[tag]}`}>
          <span className={`w-2 h-2 rounded-full ${VOTE_COLORS[tag]}`} />
          {tag}: {stats[tag]}
        </span>
      ))}
      {total > 0 && (
        <span className="text-gray-400 ml-auto">{total} total</span>
      )}
    </div>
  );
}
