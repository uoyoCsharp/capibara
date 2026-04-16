import type { Organization, Role, TaskNode, TaskType, TaskStatus, Skill, WakeTrigger } from '../types/domain.types.js';
import type { ConversationWorkflow } from '../types/conversation.types.js';
import type { WorkItemTypeDefinition } from '../types/workflow-schema.types.js';
import type { VoteStats } from './i-discussion.repository.js';

/** A decomposition task's deliverable: the child tasks it created. */
export interface DecompositionDeliverable {
  kind: 'decomposition';
  grandchildren: Array<{
    title: string;
    type: TaskType;
    status: TaskStatus;
    assigneeRoleName: string | null;
  }>;
}

/** A leaf task's deliverable: the artifact files it produced. */
export interface LeafDeliverable {
  kind: 'leaf';
  artifactPaths: string[];
}

/** A child task enriched with deliverable context for review scenarios. */
export interface ReviewableChild {
  task: TaskNode;
  assigneeRoleName: string | null;
  deliverable: DecompositionDeliverable | LeafDeliverable;
  workSummary: string | null;
}

export interface PromptContext {
  organization?: Organization;
  role: Role;
  task: TaskNode;
  trigger: WakeTrigger;
  parentRole: Role | null;
  subordinates: Role[];
  peers: Role[];
  skills: Skill[];
  discussionSummary: DiscussionSummary | null;
  /** Child tasks awaiting review, enriched with deliverable context (populated when trigger is 'review_requested') */
  childrenAwaitingReview: ReviewableChild[];
  /** Whether the current task has any child tasks (for revision sub-mode detection) */
  hasChildren: boolean;
  /** Conversation context text (populated when trigger is 'discussion_reply' or 'conversation_escalation') */
  conversationContext?: string;
  /** Active conversation workflow (populated for conversation triggers) */
  conversationWorkflow?: ConversationWorkflow;
  /** WorkItemTypeDefinition for the current task's type (from WorkflowEngine) */
  taskTypeDef?: WorkItemTypeDefinition | null;
  /** All item types defined in the schema (for dynamic hierarchy descriptions) */
  allItemTypes?: WorkItemTypeDefinition[];
  /** Whether the task's current status is a terminal status (schema-driven) */
  isTaskTerminal?: boolean;
  /** Planning mode context — present only for Conversational Task Planning runs */
  planningContext?: PlanningPromptContext;
  /** Prior work context for revision scenarios (summary + artifacts from previous run) */
  priorWork?: PriorWorkContext;
  /** Subordinate skill descriptions keyed by roleId (for decomposition assignment guidance) */
  subordinateSkills?: Map<string, string[]>;
  /** Communication language preference (e.g., 'zh-CN', 'en-US') */
  communicationLanguage?: string;
  /** Execution sequence context: sibling tasks under the same parent (ordered by creation) */
  siblingTasks?: SiblingTaskInfo[];
  /** Parent task title and type (for execution sequence header) */
  parentTask?: { title: string; type: TaskType; status: TaskStatus };
}

/** Context specific to Conversational Task Planning runs. */
export interface PlanningPromptContext {
  /** All roles in the organization with their names and skill descriptions */
  orgRoles: Array<{ id: string; name: string; skillDescriptions: string[] }>;
  /** The user's initial message that started the planning session */
  initialMessage?: string;
  /** The user's communication language preference (e.g., 'zh-CN', 'en-US') */
  communicationLanguage?: string;
}

/** Prior work context injected during revision scenarios. */
export interface PriorWorkContext {
  /** Summary text from the previous capibara_task_complete call */
  lastRunSummary: string | null;
  /** Artifact file paths produced in the previous run */
  artifactPaths: string[];
  /** For decomposer tasks: the proposed plan text (from discussion post) */
  proposedPlan: string | null;
}

/** A sibling task in the execution sequence (for execution sequence context). */
export interface SiblingTaskInfo {
  id: string;
  type: TaskType;
  title: string;
  status: TaskStatus;
  assigneeRoleName: string | null;
  /** Work summary from the last completed run (null if not yet executed) */
  workSummary: string | null;
  /** Whether this is the current task being executed */
  isCurrent: boolean;
}

export interface DiscussionSummary {
  groupId: string;
  recentMessages: Array<{ authorName: string; content: string; voteTag: string | null }>;
  voteStats: VoteStats;
  latestReviseFeedback: string | null;
  /** Dispute summary stored by discussion service when dispute is detected */
  disputeSummary: string | null;
}

/** Context for session-based prompt construction (no task dependency). */
export interface SessionPromptContext {
  roleName: string;
  rolePersona: string;
  /** Organization roles for assignment guidance */
  orgRoles: Array<{ id: string; name: string; skillDescriptions: string[] }>;
  /** Communication language preference */
  communicationLanguage?: string;
  /** Organization custom instructions */
  orgInstructions?: string;
  /** Work item type definitions from the organization's workflow schema */
  itemTypes?: import('../types/workflow-schema.types.js').WorkItemTypeDefinition[];
}

export interface IPromptBuilder {
  build(context: PromptContext): string;
  /** Build a prompt for session-based execution (no task context). */
  buildForSession(context: SessionPromptContext): string;
}
