import type {
  SessionSuspension,
  SuspensionAwaiting,
  CreateSuspensionInput,
  CreateAwaitingInput,
  SuspensionStatus,
  AwaitingStatus,
} from '../collaboration/suspension.types';

export interface ISuspensionRepository {
  createSuspension(input: CreateSuspensionInput): SessionSuspension;
  createAwaiting(input: CreateAwaitingInput): SuspensionAwaiting;
  findById(id: string): SessionSuspension | null;
  findByConversationId(conversationId: string): SessionSuspension | null;
  findAwaitingBySuspensionId(suspensionId: string): SuspensionAwaiting[];
  findActiveByOrg(orgId: string): SessionSuspension[];
  findActiveByRole(roleId: string, orgId: string): SessionSuspension | null;
  /** Find the active suspension that has an awaiting entry for the given respondent role. */
  findSuspensionAwaitingRole(roleId: string, orgId: string): SessionSuspension | null;
  updateSuspensionStatus(id: string, status: SuspensionStatus, resumedAt?: string): void;
  updateAwaitingStatus(id: string, status: AwaitingStatus, response?: string, resolvedAt?: string): void;
}
