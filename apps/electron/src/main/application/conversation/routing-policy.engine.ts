import type { IRoutingPolicyEngine } from '@main/core/interfaces/i-routing-policy-engine.js';
import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
import type { IRunRepository } from '@main/core/interfaces/i-run.repository.js';
import type { ISkillRepository } from '@main/core/interfaces/i-skill.repository.js';
import type { IConversationWorkflowRepository } from '@main/core/interfaces/i-conversation-workflow.repository.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { RoutingRequest, RoutingDecision, CycleCheckResult } from '@main/core/types/conversation.types.js';

const MAX_CONVERSATION_DEPTH = 10;

export class RoutingPolicyEngine implements IRoutingPolicyEngine {
  constructor(
    private readonly roleRepo: IRoleRepository,
    private readonly runRepo: IRunRepository,
    private readonly workflowRepo: IConversationWorkflowRepository,
    private readonly logger: ILogger,
    private readonly skillRepo: ISkillRepository,
  ) {}

  async resolve(request: RoutingRequest): Promise<RoutingDecision> {
    const steps: string[] = [];
    let wasRewritten = false;
    let target = request.recipientTarget;

    // Step 1: Human Gate Check
    if (target.type === 'human') {
      const askingRole = await this.roleRepo.findById(request.askingRoleId);
      if (!askingRole?.requiresHumanApproval) {
        steps.push('human_target_blocked_by_role_gate -> rewrite to supervisor');
        target = { type: 'supervisor' };
        wasRewritten = true;
      } else {
        steps.push('human_gate_passed');
        return {
          respondentRoleId: null,
          respondentType: 'human',
          priority: 1,
          auditReason: steps.join(' | '),
          wasRewritten: false,
        };
      }
    }

    // Step 2: Specific Role Resolution
    if (target.type === 'role') {
      const specified = await this.roleRepo.findById(target.roleId);
      if (specified && specified.status === 'active') {
        // Step 5: Cycle Detection on specified role
        const cycleCheck = await this.detectCycle(request, specified.id);
        if (!cycleCheck.hasCycle) {
          steps.push(`routed_to_specified_role:${specified.name}`);
          return {
            respondentRoleId: specified.id,
            respondentType: 'ai',
            priority: 1,
            auditReason: steps.join(' | '),
            wasRewritten,
          };
        }
        steps.push(`specified_role_cycle_detected:${cycleCheck.reason}`);
        // Fall through to supervisor
      } else {
        steps.push('specified_role_unavailable -> fall through to supervisor');
      }
      target = { type: 'supervisor' };
      wasRewritten = wasRewritten || true;
    }

    // Step 4: Skill-Match Resolution (for target=any)
    if (target.type === 'any') {
      const askingRole = await this.roleRepo.findById(request.askingRoleId);
      if (askingRole?.parentId) {
        const peers = await this.roleRepo.findChildren(askingRole.parentId);
        const activePeers = peers.filter(
          (p) => p.id !== request.askingRoleId && p.status === 'active',
        );

        if (activePeers.length > 0) {
          const questionLower = request.questionContent.toLowerCase();
          const questionWords = new Set(questionLower.split(/\s+/).filter((w) => w.length > 2));
          const scored: Array<{ peer: typeof activePeers[0]; score: number; activeRuns: number }> = [];

          for (const peer of activePeers) {
            let score = 0;

            // Score from role name + persona (lightweight)
            const nameLower = peer.name.toLowerCase();
            if (questionLower.includes(nameLower)) score += 3;
            const personaWords = peer.persona.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
            for (const word of personaWords) {
              if (questionWords.has(word)) score += 1;
            }

            // Score from actual skill entities (category + description keywords)
            if (peer.skillIds.length > 0) {
              for (const skillId of peer.skillIds) {
                const skill = await this.skillRepo.findById(skillId);
                if (!skill) continue;
                // Category match: if question mentions the category name
                if (questionLower.includes(skill.category)) score += 2;
                // Skill name match
                if (questionLower.includes(skill.name.toLowerCase())) score += 3;
                // Description keyword overlap
                const descWords = skill.description.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
                for (const dw of descWords) {
                  if (questionWords.has(dw)) score += 1;
                }
              }
            }

            // Load tiebreaker: fewer active runs = better
            const activeRun = await this.runRepo.findActiveByRoleId(peer.id);
            scored.push({ peer, score, activeRuns: activeRun ? 1 : 0 });
          }

          // Sort by: score DESC, then activeRuns ASC (less busy first), then id for determinism
          scored.sort((a, b) => b.score - a.score || a.activeRuns - b.activeRuns || a.peer.id.localeCompare(b.peer.id));

          // Try candidates in ranked order until one passes cycle check
          let matched = false;
          for (const candidate of scored) {
            if (candidate.score <= 0) break;
            const cycleCheck = await this.detectCycle(request, candidate.peer.id);
            if (!cycleCheck.hasCycle) {
              steps.push(`skill_match:${candidate.peer.name}(score=${candidate.score},load=${candidate.activeRuns})`);
              return {
                respondentRoleId: candidate.peer.id,
                respondentType: 'ai',
                priority: 1,
                auditReason: steps.join(' | '),
                wasRewritten,
              };
            }
            steps.push(`skill_match_cycle:${candidate.peer.name}(${cycleCheck.reason})`);
            matched = true;
          }
          if (!matched) {
            steps.push('no_skill_match -> fall through to supervisor');
          }
        }
      }
      target = { type: 'supervisor' };
      wasRewritten = true;
    }

    // Step 3: Supervisor Resolution
    if (target.type === 'supervisor') {
      const askingRole = await this.roleRepo.findById(request.askingRoleId);
      if (askingRole?.parentId) {
        const parent = await this.roleRepo.findById(askingRole.parentId);
        if (parent && parent.status === 'active') {
          // Step 5: Cycle Detection on supervisor
          const cycleCheck = await this.detectCycle(request, parent.id);
          if (!cycleCheck.hasCycle) {
            steps.push(`routed_to_supervisor:${parent.name}`);
            return {
              respondentRoleId: parent.id,
              respondentType: 'ai',
              priority: 1,
              auditReason: steps.join(' | '),
              wasRewritten,
            };
          }

          steps.push(`supervisor_cycle_detected:${cycleCheck.reason}`);

          // Try supervisor's parent (escalate)
          if (cycleCheck.action === 'escalate_respondent_parent' && parent.parentId) {
            const grandparent = await this.roleRepo.findById(parent.parentId);
            if (grandparent && grandparent.status === 'active') {
              steps.push(`escalated_to:${grandparent.name}`);
              return {
                respondentRoleId: grandparent.id,
                respondentType: 'ai',
                priority: 2,
                auditReason: steps.join(' | '),
                wasRewritten: true,
              };
            }
          }
        } else {
          steps.push('supervisor_unavailable');
        }
      } else {
        steps.push('no_supervisor');
      }
    }

    // Step 6: Top-Level Fallback
    steps.push('top_level_fallback -> route to human');
    this.logger.warn('Conversation routing fell through to human fallback', {
      askingRoleId: request.askingRoleId,
      steps,
    });
    return {
      respondentRoleId: null,
      respondentType: 'human',
      priority: 3,
      auditReason: steps.join(' | '),
      wasRewritten: true,
    };
  }

  private async detectCycle(request: RoutingRequest, respondentRoleId: string): Promise<CycleCheckResult> {
    // Layer 1: Depth limit
    if (request.conversationDepth >= MAX_CONVERSATION_DEPTH) {
      return { hasCycle: true, reason: 'max_depth_exceeded', action: 'force_human' };
    }

    // Layer 2: Self-wake
    if (respondentRoleId === request.askingRoleId) {
      return { hasCycle: true, reason: 'self_reference', action: 'route_to_supervisor' };
    }

    // Layer 3: Pair cycle (check recent conversation chain)
    const recentChain = await this.workflowRepo.findRecentChainByTask(request.taskNodeId, 4);
    for (const wf of recentChain) {
      const pair1 = `${wf.askingRoleId}:${wf.respondentRoleId}`;
      const pair2 = `${wf.respondentRoleId}:${wf.askingRoleId}`;
      const currentPair = `${request.askingRoleId}:${respondentRoleId}`;
      const reversePair = `${respondentRoleId}:${request.askingRoleId}`;
      if (pair1 === currentPair || pair2 === currentPair || pair1 === reversePair || pair2 === reversePair) {
        return { hasCycle: true, reason: 'pair_cycle_detected', action: 'escalate_respondent_parent' };
      }
    }

    return { hasCycle: false };
  }
}
