import type { WakeReason } from '@core/modules/execution/types/execution.types';
import type { PlanningMode } from '@core/modules/workflow/types/workflow.types';

export type { WakeReason };

export interface PromptContext {
  wakeReason: WakeReason;
  task: {
    id: string;
    type: string;
    title: string;
    description: string;
    status: string;
    orgId: string;
    hasChildren: boolean;
    isDecomposable: boolean;
    planningMode: PlanningMode;
    pendingFeedback: string | null;
    allowedChildTypes: string[];
    isTerminal: boolean;
    parentChain: Array<{ id: string; type: string; title: string; status: string }>;
    siblings: Array<{
      id: string;
      type: string;
      title: string;
      status: string;
      assigneeRoleName: string | null;
      isCurrent: boolean;
    }>;
  };
  role: {
    id: string;
    name: string;
    persona: string;
    knowledgeBaseRefs: string[];
  };
  skills: Array<{ name: string; command: string; description: string }>;
  locale: string;
  organization?: {
    name: string;
    customInstructions: string;
  };
  orgHierarchy?: {
    parentRole: { id: string; name: string } | null;
    subordinates: Array<{ id: string; name: string; skillDescriptions: string[] }>;
    peers: Array<{ id: string; name: string }>;
  };
  typeSchema?: {
    allTypes: Array<{
      name: string;
      label: string;
      isLeaf: boolean;
      canDecompose: boolean;
      allowedChildren: string[];
      allowedAtRoot: boolean;
    }>;
    currentTypeDef: {
      name: string;
      label: string;
      isLeaf: boolean;
      canDecompose: boolean;
      allowedChildren: string[];
    } | null;
  };
  workflowSchema?: {
    currentStatus: {
      name: string;
      label: string;
      category: string;
    };
    availableTransitions: Array<{
      targetStatus: string;
      targetLabel: string;
    }>;
    allStatuses: Array<{
      name: string;
      label: string;
      category: string;
    }>;
    allTransitions: Array<{
      from: string;
      to: string;
    }>;
    terminalStatuses: string[];
  };
}

export interface ConversationPromptContext {
  conversation: {
    id: string;
    type: string;
    state: string;
    messageHistory: Array<{
      authorRoleId: string | null;
      authorType: string;
      content: string;
      intent: string;
    }>;
  };
  task: {
    id: string;
    type: string;
    title: string;
    description: string;
    status: string;
    isDecomposable?: boolean;
  } | null;
  role: {
    id: string;
    name: string;
    persona: string;
    knowledgeBaseRefs: string[];
  };
  skills: Array<{ name: string; command: string; description: string }>;
  locale: string;
}
