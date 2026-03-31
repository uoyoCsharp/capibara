import { injectable, inject } from 'tsyringe';
import type { ISkillRepository } from '@main/core/interfaces/i-skill.repository.js';
import type { Skill, SkillCategory, TaskType } from '@main/core/types/domain.types.js';
import { SKILL_REPO_TOKEN } from '@main/core/tokens.js';

/**
 * Maps task types to skill categories and selects the best matching skill
 * from a role's available skill set.
 * See Architecture §8.3 — Skill Selection.
 */

const TASK_TYPE_TO_CATEGORY: Record<TaskType, SkillCategory> = {
  epic: 'analysis',
  story: 'design',
  task: 'implementation',
  subtask: 'implementation',
  spike: 'analysis',
  bug: 'implementation',
  chore: 'general',
};

@injectable()
export class SkillSelector {
  constructor(
    @inject(SKILL_REPO_TOKEN) private readonly skillRepo: ISkillRepository,
  ) {}

  async selectForTaskType(
    taskType: TaskType,
    roleSkillIds: string[],
  ): Promise<Skill | null> {
    const category = TASK_TYPE_TO_CATEGORY[taskType];
    const allSkills = await Promise.all(
      roleSkillIds.map((id) => this.skillRepo.findById(id)),
    );
    const available = allSkills.filter(
      (s): s is Skill => s !== null && s.category === category,
    );
    return available[0] ?? null;
  }

  async selectForReview(roleSkillIds: string[]): Promise<Skill | null> {
    const allSkills = await Promise.all(
      roleSkillIds.map((id) => this.skillRepo.findById(id)),
    );
    const reviewSkills = allSkills.filter(
      (s): s is Skill => s !== null && s.category === 'review',
    );
    return reviewSkills[0] ?? null;
  }
}
