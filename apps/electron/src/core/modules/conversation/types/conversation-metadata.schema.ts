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

export type InquiryMetadata = z.infer<typeof InquiryMetadataSchema>;
export type PlanningMetadata = z.infer<typeof PlanningMetadataSchema>;
export type AdhocMetadata = z.infer<typeof AdhocMetadataSchema>;

// ─── Discriminated parser keyed by ConversationType ─────────────

import type { ConversationType } from './conversation.types';

export function parseConversationMetadata(
  type: ConversationType,
  raw: unknown,
): InquiryMetadata | PlanningMetadata | AdhocMetadata {
  const value = raw ?? {};
  switch (type) {
    case 'inquiry':
      return InquiryMetadataSchema.parse(value);
    case 'planning':
      return PlanningMetadataSchema.parse(value);
    case 'adhoc':
      return AdhocMetadataSchema.parse(value);
  }
}

export function emptyMetadataFor(type: ConversationType): InquiryMetadata | PlanningMetadata | AdhocMetadata {
  return parseConversationMetadata(type, {});
}
