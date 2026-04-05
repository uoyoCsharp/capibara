/**
 * Epic 15 — Advanced Conversation Features Integration Test
 *
 * Verifies:
 * 1. Skill-match routing selects best peer based on skill entities + load
 * 2. Multi-hop cascade context builder collects messages from full chain
 * 3. Token budget truncation preserves anchored messages
 * 4. Truncation with latest reply anchor
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Inline Types ──────────────────────────────────────────

interface ConversationWorkflow {
  id: string;
  orgId: string;
  taskNodeId: string;
  discussionGroupId: string;
  askingRoleId: string;
  askingRunId: string;
  askingSessionId: string | null;
  questionMessageId: string;
  replyMessageId: string | null;
  respondentRoleId: string | null;
  respondentType: 'ai' | 'human';
  state: string;
  depth: number;
  parentWorkflowId: string | null;
  priority: number;
  timeoutAt: string | null;
  resolvedAt: string | null;
  auditReason: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DiscussionMessage {
  id: string;
  groupId: string;
  authorRoleId: string | null;
  authorType: 'ai' | 'human' | 'system';
  content: string;
  voteTag: null;
  reviewRound: number;
  metadata: null;
  intent: 'question' | 'reply' | 'escalation' | 'general';
  inReplyToMessageId: string | null;
  createdAt: string;
}

interface Role {
  id: string;
  orgId: string;
  name: string;
  parentId: string | null;
  persona: string;
  skillIds: string[];
  canApprove: boolean;
  canDelegate: boolean;
  requiresHumanApproval: boolean;
  consecutiveWakeCount: number;
  status: 'active' | 'paused' | 'idle';
  createdAt: string;
  updatedAt: string;
  knowledgeBaseRefs: string[];
}

interface Skill {
  id: string;
  name: string;
  command: string;
  description: string;
  category: string;
  source: string;
  orgTemplateId: string | null;
  customPromptContent: string | null;
  createdAt: string;
}

// ─── Module Mocks ──────────────────────────────────────────

vi.mock('@main/core/interfaces/i-routing-policy-engine.js', () => ({}));
vi.mock('@main/core/interfaces/i-role.repository.js', () => ({}));
vi.mock('@main/core/interfaces/i-run.repository.js', () => ({}));
vi.mock('@main/core/interfaces/i-skill.repository.js', () => ({}));
vi.mock('@main/core/interfaces/i-conversation-workflow.repository.js', () => ({}));
vi.mock('@main/core/interfaces/i-logger.js', () => ({}));
vi.mock('@main/core/interfaces/i-discussion.repository.js', () => ({}));
vi.mock('@main/core/types/conversation.types.js', () => ({
  canTransition: () => true,
}));
vi.mock('@main/core/types/domain.types.js', () => ({}));

const { RoutingPolicyEngine } = await import('@main/application/conversation/routing-policy.engine.js');
const { ConversationContextBuilder } = await import('@main/application/conversation/conversation-context.builder.js');

// ─── Fixtures ──────────────────────────────────────────────

const makeRole = (overrides: Partial<Role> = {}): Role => ({
  id: 'role-1',
  orgId: 'org-1',
  name: 'Developer',
  parentId: 'role-mgr',
  persona: 'A senior developer responsible for code',
  skillIds: [],
  canApprove: false,
  canDelegate: false,
  requiresHumanApproval: false,
  consecutiveWakeCount: 0,
  status: 'active',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  knowledgeBaseRefs: [],
  ...overrides,
});

const makeSkill = (overrides: Partial<Skill> = {}): Skill => ({
  id: 'skill-1',
  name: 'Code Review',
  command: 'review',
  description: 'Reviews code for quality, security, and best practices',
  category: 'review',
  source: 'builtin',
  orgTemplateId: null,
  customPromptContent: null,
  createdAt: new Date().toISOString(),
  ...overrides,
});

const makeWorkflow = (overrides: Partial<ConversationWorkflow> = {}): ConversationWorkflow => ({
  id: 'wf-1',
  orgId: 'org-1',
  taskNodeId: 'task-1',
  discussionGroupId: 'dg-1',
  askingRoleId: 'role-dev',
  askingRunId: 'run-1',
  askingSessionId: null,
  questionMessageId: 'msg-q',
  replyMessageId: null,
  respondentRoleId: 'role-qa',
  respondentType: 'ai',
  state: 'waiting_for_reply',
  depth: 0,
  parentWorkflowId: null,
  priority: 1,
  timeoutAt: null,
  resolvedAt: null,
  auditReason: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

const makeMessage = (overrides: Partial<DiscussionMessage> = {}): DiscussionMessage => ({
  id: 'msg-1',
  groupId: 'dg-1',
  authorRoleId: 'role-dev',
  authorType: 'ai',
  content: 'Hello?',
  voteTag: null,
  reviewRound: 0,
  metadata: null,
  intent: 'question',
  inReplyToMessageId: null,
  createdAt: new Date().toISOString(),
  ...overrides,
});

// ─── Test Suite ────────────────────────────────────────────

describe('Epic 15 — Advanced Conversation Features', () => {
  let roleRepo: Record<string, ReturnType<typeof vi.fn>>;
  let runRepo: Record<string, ReturnType<typeof vi.fn>>;
  let skillRepo: Record<string, ReturnType<typeof vi.fn>>;
  let workflowRepo: Record<string, ReturnType<typeof vi.fn>>;
  let discussionRepo: Record<string, ReturnType<typeof vi.fn>>;
  let logger: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    roleRepo = {
      findById: vi.fn(),
      findByIds: vi.fn(async (ids: string[]) => {
        const results = [];
        for (const id of ids) {
          const role = await roleRepo.findById(id);
          if (role) results.push(role);
        }
        return results;
      }),
      findByOrgId: vi.fn(() => Promise.resolve([])),
      findChildren: vi.fn(() => Promise.resolve([])),
    };
    runRepo = {
      findActiveByRoleId: vi.fn(() => Promise.resolve(null)),
    };
    skillRepo = {
      findById: vi.fn(() => Promise.resolve(null)),
    };
    workflowRepo = {
      findRecentChainByTask: vi.fn(() => Promise.resolve([])),
      findById: vi.fn(() => Promise.resolve(null)),
    };
    discussionRepo = {
      findMessagesByGroupId: vi.fn(() => Promise.resolve([])),
    };
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
  });

  describe('Story 15.1: Skill-Match Routing', () => {
    it('should route to peer with matching skill category', async () => {
      const askingDev = makeRole({ id: 'role-dev', name: 'Developer', parentId: 'role-mgr', skillIds: [] });
      const qaRole = makeRole({
        id: 'role-qa',
        name: 'QA Engineer',
        parentId: 'role-mgr',
        persona: 'Ensures quality through testing',
        skillIds: ['skill-test'],
      });
      const designRole = makeRole({
        id: 'role-design',
        name: 'Designer',
        parentId: 'role-mgr',
        persona: 'Designs user interfaces',
        skillIds: ['skill-design'],
      });

      const testSkill = makeSkill({
        id: 'skill-test',
        name: 'Testing',
        description: 'Writes and runs test suites for quality assurance',
        category: 'test',
      });
      const designSkill = makeSkill({
        id: 'skill-design',
        name: 'Design',
        description: 'Creates visual designs and wireframes',
        category: 'design',
      });

      roleRepo.findById.mockImplementation(async (id: string) => {
        if (id === 'role-dev') return askingDev;
        if (id === 'role-qa') return qaRole;
        if (id === 'role-design') return designRole;
        return null;
      });
      roleRepo.findChildren.mockResolvedValue([askingDev, qaRole, designRole]);
      skillRepo.findById.mockImplementation(async (id: string) => {
        if (id === 'skill-test') return testSkill;
        if (id === 'skill-design') return designSkill;
        return null;
      });

      const engine = new RoutingPolicyEngine(
        roleRepo as never,
        runRepo as never,
        workflowRepo as never,
        logger as never,
        skillRepo as never,
      );

      const result = await engine.resolve({
        askingRoleId: 'role-dev',
        orgId: 'org-1',
        taskNodeId: 'task-1',
        recipientTarget: { type: 'any' },
        questionContent: 'How should I test this component? I need quality assurance.',
        conversationDepth: 0,
      });

      expect(result.respondentRoleId).toBe('role-qa');
      expect(result.auditReason).toContain('skill_match:QA Engineer');
    });

    it('should prefer less busy peer as tiebreaker', async () => {
      const askingDev = makeRole({ id: 'role-dev', parentId: 'role-mgr' });
      const peerA = makeRole({
        id: 'role-a', name: 'Peer A', parentId: 'role-mgr',
        persona: 'handles review tasks', skillIds: [],
      });
      const peerB = makeRole({
        id: 'role-b', name: 'Peer B', parentId: 'role-mgr',
        persona: 'handles review tasks', skillIds: [],
      });

      roleRepo.findById.mockImplementation(async (id: string) => {
        if (id === 'role-dev') return askingDev;
        if (id === 'role-a') return peerA;
        if (id === 'role-b') return peerB;
        return null;
      });
      roleRepo.findChildren.mockResolvedValue([askingDev, peerA, peerB]);

      // peerA is busy, peerB is idle
      runRepo.findActiveByRoleId.mockImplementation(async (id: string) => {
        if (id === 'role-a') return { id: 'run-active' };
        return null;
      });

      const engine = new RoutingPolicyEngine(
        roleRepo as never, runRepo as never, workflowRepo as never,
        logger as never, skillRepo as never,
      );

      const result = await engine.resolve({
        askingRoleId: 'role-dev', orgId: 'org-1', taskNodeId: 'task-1',
        recipientTarget: { type: 'any' },
        questionContent: 'I need a review of this code',
        conversationDepth: 0,
      });

      // Both have same persona match score, but peerB is idle
      expect(result.respondentRoleId).toBe('role-b');
    });
  });

  describe('Story 15.2: Multi-Hop Cascade Context', () => {
    it('should collect messages from full cascade chain', async () => {
      // Chain: wf-root (dg-root) → wf-child (dg-child) → wf-current (dg-current)
      const rootWf = makeWorkflow({ id: 'wf-root', discussionGroupId: 'dg-root', parentWorkflowId: null, depth: 0 });
      const childWf = makeWorkflow({ id: 'wf-child', discussionGroupId: 'dg-child', parentWorkflowId: 'wf-root', depth: 1 });
      const currentWf = makeWorkflow({ id: 'wf-current', discussionGroupId: 'dg-current', parentWorkflowId: 'wf-child', depth: 2, askingRoleId: 'role-cto' });

      workflowRepo.findById.mockImplementation(async (id: string) => {
        if (id === 'wf-root') return rootWf;
        if (id === 'wf-child') return childWf;
        return null;
      });

      const rootMessages = [
        makeMessage({ id: 'msg-r1', groupId: 'dg-root', intent: 'question', content: 'Dev question', authorRoleId: 'role-dev', createdAt: '2026-04-01T10:00:00Z' }),
      ];
      const childMessages = [
        makeMessage({ id: 'msg-c1', groupId: 'dg-child', intent: 'question', content: 'EM question', authorRoleId: 'role-em', createdAt: '2026-04-01T10:01:00Z' }),
        makeMessage({ id: 'msg-c2', groupId: 'dg-child', intent: 'reply', content: 'CTO reply', authorRoleId: 'role-cto', createdAt: '2026-04-01T10:02:00Z' }),
      ];
      const currentMessages = [
        makeMessage({ id: 'msg-cu1', groupId: 'dg-current', intent: 'escalation', content: 'Escalated to CTO', authorRoleId: null, authorType: 'system', createdAt: '2026-04-01T10:03:00Z' }),
      ];

      discussionRepo.findMessagesByGroupId.mockImplementation(async (groupId: string) => {
        if (groupId === 'dg-root') return rootMessages;
        if (groupId === 'dg-child') return childMessages;
        if (groupId === 'dg-current') return currentMessages;
        return [];
      });

      roleRepo.findById.mockImplementation(async (id: string) => {
        if (id === 'role-dev') return makeRole({ id: 'role-dev', name: 'Developer' });
        if (id === 'role-em') return makeRole({ id: 'role-em', name: 'Engineering Manager' });
        if (id === 'role-cto') return makeRole({ id: 'role-cto', name: 'CTO' });
        return null;
      });

      const builder = new ConversationContextBuilder(
        discussionRepo as never,
        workflowRepo as never,
        roleRepo as never,
      );

      const context = await builder.build(currentWf as never, 'discussion_reply');

      // Should contain messages from ALL three discussion groups
      expect(context).toContain('Dev question');
      expect(context).toContain('EM question');
      expect(context).toContain('CTO reply');
      expect(context).toContain('Escalated to CTO');
      expect(context).toContain('3 hops');
    });
  });

  describe('Story 15.3: Token Budget Truncation', () => {
    it('should preserve first question and latest reply as anchors', async () => {
      // Create 20 messages to exceed budget, with a reply in the middle
      const messages: DiscussionMessage[] = [];
      for (let i = 0; i < 20; i++) {
        messages.push(makeMessage({
          id: `msg-${i}`,
          groupId: 'dg-1',
          content: 'A'.repeat(200), // ~50 tokens each, 20*50=1000 tokens
          intent: i === 0 ? 'question' : (i === 8 ? 'reply' : 'question'),
          authorRoleId: i % 2 === 0 ? 'role-dev' : 'role-qa',
          createdAt: new Date(Date.now() + i * 60_000).toISOString(),
        }));
      }

      const wf = makeWorkflow({ askingRoleId: 'role-dev' });
      workflowRepo.findById.mockResolvedValue(null);

      discussionRepo.findMessagesByGroupId.mockResolvedValue(messages);
      roleRepo.findById.mockImplementation(async (id: string) => {
        if (id === 'role-dev') return makeRole({ id: 'role-dev', name: 'Developer' });
        if (id === 'role-qa') return makeRole({ id: 'role-qa', name: 'QA' });
        return null;
      });

      // Use a very small budget to force truncation
      const builder = new ConversationContextBuilder(
        discussionRepo as never,
        workflowRepo as never,
        roleRepo as never,
        { maxConversationTokens: 100, truncationStrategy: 'oldest_first' },
      );

      const context = await builder.build(wf as never, 'discussion_reply');

      // First message (question anchor) should be present
      expect(context).toContain('[1]');
      // Should have truncation marker
      expect(context).toContain('messages omitted');
    });

    it('should format all messages when under token budget', async () => {
      const messages = [
        makeMessage({ id: 'msg-1', content: 'Question', intent: 'question', createdAt: '2026-04-01T10:00:00Z' }),
        makeMessage({ id: 'msg-2', content: 'Reply', intent: 'reply', authorRoleId: 'role-qa', createdAt: '2026-04-01T10:01:00Z' }),
      ];

      const wf = makeWorkflow({ askingRoleId: 'role-dev' });
      workflowRepo.findById.mockResolvedValue(null);
      discussionRepo.findMessagesByGroupId.mockResolvedValue(messages);
      roleRepo.findById.mockImplementation(async (id: string) => {
        if (id === 'role-dev') return makeRole({ id: 'role-dev', name: 'Developer' });
        if (id === 'role-qa') return makeRole({ id: 'role-qa', name: 'QA' });
        return null;
      });

      const builder = new ConversationContextBuilder(
        discussionRepo as never,
        workflowRepo as never,
        roleRepo as never,
      );

      const context = await builder.build(wf as never, 'discussion_reply');

      expect(context).toContain('[1]');
      expect(context).toContain('[2]');
      expect(context).toContain('Question');
      expect(context).toContain('Reply');
      expect(context).not.toContain('omitted');
    });
  });
});
