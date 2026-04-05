import type { RoutingRequest, RoutingDecision } from '../types/conversation.types.js';

export interface IRoutingPolicyEngine {
  resolve(request: RoutingRequest): Promise<RoutingDecision>;
}
