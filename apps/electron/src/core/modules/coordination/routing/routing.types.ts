import type { RespondentType } from '@core/modules/conversation/types/conversation.types';

export interface RoutingRequest {
  conversationId: string;
  askingRoleId: string;
  orgId: string;
  taskId: string;
  conversationDepth: number;
}

export interface RoutingDecision {
  respondentRoleId: string | null;
  respondentType: RespondentType;
  priority: number;
  auditReason: string;
}
