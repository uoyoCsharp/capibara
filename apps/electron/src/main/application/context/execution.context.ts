import { injectable, inject } from 'tsyringe';
import type { ITaskRepository } from '@main/core/interfaces/i-task.repository.js';
import type { IRoleRepository } from '@main/core/interfaces/i-role.repository.js';
import type { ISkillRepository } from '@main/core/interfaces/i-skill.repository.js';
import type { IDiscussionRepository } from '@main/core/interfaces/i-discussion.repository.js';
import type { IRunRepository } from '@main/core/interfaces/i-run.repository.js';
import type { PromptContext, DiscussionSummary } from '@main/core/interfaces/i-prompt-builder.js';
import type { TaskNode, Role, Skill } from '@main/core/types/domain.types.js';
import {
  TASK_REPO_TOKEN,
  ROLE_REPO_TOKEN,
  SKILL_REPO_TOKEN,
  DISCUSSION_REPO_TOKEN,
  RUN_REPO_TOKEN,
} from '@main/core/tokens.js';
import { OrgContext } from './org.context.js';

/**
 * Builds the full execution context needed to compose a prompt for a given Run.
 */
@injectable()
export class ExecutionContext {
  constructor(
    @inject(TASK_REPO_TOKEN) private readonly taskRepo: ITaskRepository,
    @inject(ROLE_REPO_TOKEN) private readonly roleRepo: IRoleRepository,
    @inject(SKILL_REPO_TOKEN) private readonly skillRepo: ISkillRepository,
    @inject(DISCUSSION_REPO_TOKEN) private readonly discussionRepo: IDiscussionRepository,
    private readonly orgContext: OrgContext,
  ) {}

  async buildPromptContext(roleId: string, taskId: string): Promise<PromptContext> {
    const role = await this.roleRepo.findById(roleId);
    if (!role) throw new Error(`Role not found: ${roleId}`);

    const task = await this.taskRepo.findById(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const parentRole = await this.orgContext.getParentRole(roleId);
    const subordinates = await this.orgContext.getSubordinates(roleId);
    const peers = await this.orgContext.getPeers(roleId);

    const skills = await this.resolveSkills(role.skillIds);
    const discussionSummary = await this.buildDiscussionSummary(task);

    return {
      role,
      task,
      parentRole,
      subordinates,
      peers,
      skills,
      discussionSummary,
    };
  }

  private async resolveSkills(skillIds: string[]): Promise<Skill[]> {
    const results = await Promise.all(
      skillIds.map((id) => this.skillRepo.findById(id)),
    );
    return results.filter((s): s is Skill => s !== null);
  }

  private async buildDiscussionSummary(task: TaskNode): Promise<DiscussionSummary | null> {
    const group = await this.discussionRepo.findGroupByTaskNodeId(task.id);
    if (!group) return null;

    const recentMessages = await this.discussionRepo.findRecentMessages(group.id, 3);
    const voteStats = await this.discussionRepo.getVoteStats(group.id);

    const roleNames = new Map<string, string>();
    for (const msg of recentMessages) {
      if (msg.authorRoleId && !roleNames.has(msg.authorRoleId)) {
        const r = await this.roleRepo.findById(msg.authorRoleId);
        roleNames.set(msg.authorRoleId, r?.name ?? 'Unknown');
      }
    }

    const latestReviseMsg = recentMessages.find((m) => m.voteTag === 'REVISE');

    return {
      groupId: group.id,
      recentMessages: recentMessages.map((m) => ({
        authorName: m.authorRoleId ? (roleNames.get(m.authorRoleId) ?? 'Unknown') : 'System',
        content: m.content,
        voteTag: m.voteTag,
      })),
      voteStats,
      latestReviseFeedback: latestReviseMsg?.content ?? null,
    };
  }
}
