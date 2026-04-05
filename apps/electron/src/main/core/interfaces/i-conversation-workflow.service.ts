import type { ConversationWorkflow } from '../types/conversation.types.js';
import type { RecipientTarget } from '../types/conversation.types.js';

export interface CreateWorkflowInput {
  orgId: string;
  taskNodeId: string;
  askingRoleId: string;
  askingRunId: string;
  askingSessionId: string | null;
  question: string;
  recipientTarget: RecipientTarget;
  urgency: 'normal' | 'urgent';
}

export interface IConversationWorkflowService {
  createWorkflow(input: CreateWorkflowInput): Promise<ConversationWorkflow>;
  handleReply(workflowId: string, messageId: string): Promise<void>;
  transitionState(workflowId: string, targetState: ConversationWorkflow['state']): Promise<void>;
  createEscalatedWorkflow(parentWorkflow: ConversationWorkflow, newRespondentRoleId: string): Promise<ConversationWorkflow>;
}
