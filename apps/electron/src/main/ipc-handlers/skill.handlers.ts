import { ipcMain } from 'electron';
import { IPC_CHANNELS, createSkillSchema, updateSkillSchema, searchSkillsSchema } from '@shared/contracts.js';
import type { DesktopResult } from '@shared/contracts.js';
import type { ISkillRepository } from '@main/core/interfaces/i-skill.repository.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { Skill } from '@main/core/types/domain.types.js';

function ok<T>(data: T): DesktopResult<T> {
  return { ok: true, data };
}

function fail<T>(code: string, message: string): DesktopResult<T> {
  return { ok: false, error: { code, message } };
}

export function registerSkillHandlers(
  skillRepo: ISkillRepository,
  logger: ILogger,
): void {
  ipcMain.handle(IPC_CHANNELS.getSkills, async () => {
    try {
      const skills = await skillRepo.findAll();
      return ok(skills);
    } catch (err) {
      logger.error('Failed to get skills', { error: String(err) });
      return fail('INTERNAL', 'Failed to get skills');
    }
  });

  ipcMain.handle(IPC_CHANNELS.getSkill, async (_event, id: unknown) => {
    try {
      if (typeof id !== 'string' || !id) {
        return fail('VALIDATION_ERROR', 'id must be a non-empty string');
      }
      const skill = await skillRepo.findById(id);
      return ok(skill);
    } catch (err) {
      logger.error('Failed to get skill', { error: String(err) });
      return fail('INTERNAL', 'Failed to get skill');
    }
  });

  ipcMain.handle(IPC_CHANNELS.createSkill, async (_event, input: unknown) => {
    try {
      const parsed = createSkillSchema.safeParse(input);
      if (!parsed.success) {
        return fail('VALIDATION_ERROR', parsed.error.message);
      }
      // Check command uniqueness
      const existing = await skillRepo.findByCommand(parsed.data.command);
      if (existing) {
        return fail('DUPLICATE', `Skill with command "${parsed.data.command}" already exists`);
      }
      const skill = await skillRepo.create(parsed.data);
      return ok(skill);
    } catch (err) {
      logger.error('Failed to create skill', { error: String(err) });
      return fail('INTERNAL', 'Failed to create skill');
    }
  });

  ipcMain.handle(IPC_CHANNELS.updateSkill, async (_event, input: unknown) => {
    try {
      const parsed = updateSkillSchema.safeParse(input);
      if (!parsed.success) {
        return fail('VALIDATION_ERROR', parsed.error.message);
      }
      const { id, ...updates } = parsed.data;
      // Check command uniqueness if command is being updated
      if (updates.command) {
        const existing = await skillRepo.findByCommand(updates.command);
        if (existing && existing.id !== id) {
          return fail('DUPLICATE', `Skill with command "${updates.command}" already exists`);
        }
      }
      const skill = await skillRepo.update(id, updates);
      return ok(skill);
    } catch (err) {
      logger.error('Failed to update skill', { error: String(err) });
      return fail('INTERNAL', 'Failed to update skill');
    }
  });

  ipcMain.handle(IPC_CHANNELS.deleteSkill, async (_event, id: unknown) => {
    try {
      if (typeof id !== 'string' || !id) {
        return fail('VALIDATION_ERROR', 'id must be a non-empty string');
      }
      // Prevent deletion of builtin/template skills
      const skill = await skillRepo.findById(id);
      if (skill && skill.source !== 'custom') {
        return fail('FORBIDDEN', 'Cannot delete builtin or template skills');
      }
      await skillRepo.delete(id);
      return ok(undefined as void);
    } catch (err) {
      logger.error('Failed to delete skill', { error: String(err) });
      return fail('INTERNAL', 'Failed to delete skill');
    }
  });

  ipcMain.handle(IPC_CHANNELS.searchSkills, async (_event, input: unknown) => {
    try {
      const parsed = searchSkillsSchema.safeParse(input);
      if (!parsed.success) {
        return fail('VALIDATION_ERROR', parsed.error.message);
      }
      const { query, category, source } = parsed.data;
      let skills: Skill[];

      if (category) {
        skills = await skillRepo.findByCategory(category);
      } else {
        skills = await skillRepo.findAll();
      }

      // Filter by source
      if (source) {
        skills = skills.filter((s) => s.source === source);
      }

      // Filter by query (name, command, description)
      if (query) {
        const q = query.toLowerCase();
        skills = skills.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.command.toLowerCase().includes(q) ||
            s.description.toLowerCase().includes(q),
        );
      }

      return ok(skills);
    } catch (err) {
      logger.error('Failed to search skills', { error: String(err) });
      return fail('INTERNAL', 'Failed to search skills');
    }
  });
}
