import type { VoteTag } from '../types/domain.types.js';

export const VOTE_TAG_LABELS: Record<NonNullable<VoteTag>, string> = {
  APPROVE: 'Approve',
  REVISE: 'Request Revision',
  CONCERN: 'Raise Concern',
  DELEGATE: 'Delegate',
};

/** Derived from VOTE_TAG_LABELS to avoid redundant maintenance */
export const VOTE_TAGS = Object.keys(VOTE_TAG_LABELS) as NonNullable<VoteTag>[];
