export interface PromptContext {
  task: {
    id: string;
    type: string;
    title: string;
    description: string;
    status: string;
    parentChain: Array<{ id: string; type: string; title: string; status: string }>;
    siblings: Array<{ id: string; type: string; title: string; status: string }>;
  };
  role: {
    id: string;
    name: string;
    persona: string;
    knowledgeBaseRefs: string[];
  };
  skills: Array<{ name: string; command: string; description: string }>;
  locale: string;
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
