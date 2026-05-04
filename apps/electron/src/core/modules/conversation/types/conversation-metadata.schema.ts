import { z } from 'zod';

// ─── Per-type metadata ──────────────────────────────────────────

export const InquiryMetadataSchema = z.object({
  questionIntent: z.enum(['clarification', 'approval', 'delegation']).optional(),
  routingAttempts: z.number().int().nonnegative().default(0),
  escalationPath: z.array(z.string()).default([]),
});

export const PlanningMetadataSchema = z.object({
  pendingPlanId: z.string().nullable().default(null),
  confirmedAt: z.string().nullable().default(null),
});

export const AdhocMetadataSchema = z.object({
  topic: z.string().nullable().default(null),
});

export const PlanReviewMetadataSchema = z.object({
  pendingPlanId: z.string(),
  rootTaskId: z.string(),
  currentVersion: z.number().int().nonnegative().default(0),
});

export type InquiryMetadata = z.infer<typeof InquiryMetadataSchema>;
export type PlanningMetadata = z.infer<typeof PlanningMetadataSchema>;
export type AdhocMetadata = z.infer<typeof AdhocMetadataSchema>;
export type PlanReviewMetadata = z.infer<typeof PlanReviewMetadataSchema>;

// ─── Discriminated parser keyed by ConversationType ─────────────

import type { ConversationType } from './conversation.types';

export function parseConversationMetadata(
  type: ConversationType,
  raw: unknown,
): InquiryMetadata | PlanningMetadata | AdhocMetadata | PlanReviewMetadata {
  const value = raw ?? {};
  switch (type) {
    case 'inquiry':
      return InquiryMetadataSchema.parse(value);
    case 'planning':
      return PlanningMetadataSchema.parse(value);
    case 'adhoc':
      return AdhocMetadataSchema.parse(value);
    case 'plan_review':
      return PlanReviewMetadataSchema.parse(value);
  }
}

export function emptyMetadataFor(type: ConversationType): InquiryMetadata | PlanningMetadata | AdhocMetadata | PlanReviewMetadata {
  return parseConversationMetadata(type, {});
}
