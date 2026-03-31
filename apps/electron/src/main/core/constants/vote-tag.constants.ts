import type { VoteTag } from '../types/domain.types.js';

export const VOTE_TAGS = ['APPROVE', 'REVISE', 'CONCERN', 'DELEGATE'] as const;

export const VOTE_TAG_LABELS: Record<NonNullable<VoteTag>, string> = {
  APPROVE: 'Approve',
  REVISE: 'Request Revision',
  CONCERN: 'Raise Concern',
  DELEGATE: 'Delegate',
};
