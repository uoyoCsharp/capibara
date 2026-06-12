import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskDependencyService } from '@core/modules/workflow/services/task-dependency.service';
import type { ITaskDependencyRepository } from '@core/modules/workflow/interfaces/i-task-dependency.repository';
import type { ITaskRepository } from '@core/modules/workflow/interfaces/i-task.repository';
import type { Task, TaskDependency, CreateTaskDependencyInput } from '@core/modules/workflow/types/workflow.types';
import { ValidationError } from '@core/foundation/errors/capibara.errors';

function createTask(overrides?: Partial<Task>): Task {
  return {
    id: 'task-1',
    orgId: 'org-1',
    parentId: null,
    type: 'task',
    title: 'Test Task',
    description: '',
    status: 'pending',
    assigneeRoleId: 'role-1',
    depth: 0,
    artifactPaths: null,
    pausedReason: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createDependency(overrides?: Partial<TaskDependency>): TaskDependency {
  return {
    id: 'dep-1',
    orgId: 'org-1',
    dependentTaskId: 'task-1',
    dependencyTaskId: 'task-2',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('TaskDependencyService', () => {
  let service: TaskDependencyService;
  let dependencyRepo: ITaskDependencyRepository;
  let taskRepo: ITaskRepository;

  beforeEach(() => {
    dependencyRepo = {
      findById: vi.fn(),
      findByDependentTaskId: vi.fn().mockReturnValue([]),
      findByDependencyTaskId: vi.fn().mockReturnValue([]),
      findByOrgId: vi.fn().mockReturnValue([]),
      create: vi.fn(),
      deleteByDependentTaskId: vi.fn(),
      deleteByDependencyTaskId: vi.fn(),
      deleteByTaskId: vi.fn(),
      hasUnresolvedDependencies: vi.fn().mockReturnValue(false),
      canReach: vi.fn().mockReturnValue(false),
    } as unknown as ITaskDependencyRepository;

    taskRepo = {
      findById: vi.fn(),
      findByOrgId: vi.fn(),
      findChildren: vi.fn(),
      hasChildren: vi.fn(),
      findByAssigneeRoleId: vi.fn(),
      create: vi.fn(),
      updateStatus: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    } as unknown as ITaskRepository;

    service = new TaskDependencyService(dependencyRepo, taskRepo);
  });

  describe('addDependency', () => {
    it('creates valid dependency', () => {
      const input: CreateTaskDependencyInput = {
        orgId: 'org-1',
        dependentTaskId: 'task-1',
        dependencyTaskId: 'task-2',
      };
      const dependentTask = createTask({ id: 'task-1', orgId: 'org-1' });
      const dependencyTask = createTask({ id: 'task-2', orgId: 'org-1' });
      const createdDep = createDependency(input);

      vi.mocked(taskRepo.findById).mockImplementation((id) => {
        if (id === 'task-1') return dependentTask;
        if (id === 'task-2') return dependencyTask;
        return null;
      });
      vi.mocked(dependencyRepo.create).mockReturnValue(createdDep);

      const result = service.addDependency(input);

      expect(result).toEqual(createdDep);
      expect(dependencyRepo.create).toHaveBeenCalledWith(input);
    });

    it('rejects self-dependency', () => {
      const input: CreateTaskDependencyInput = {
        orgId: 'org-1',
        dependentTaskId: 'task-1',
        dependencyTaskId: 'task-1',
      };

      expect(() => service.addDependency(input)).toThrow(ValidationError);
      expect(() => service.addDependency(input)).toThrow(/cannot depend on itself/);
    });

    it('rejects direct cycle: A -> B when B -> A exists', () => {
      const input: CreateTaskDependencyInput = {
        orgId: 'org-1',
        dependentTaskId: 'task-A',
        dependencyTaskId: 'task-B',
      };
      const taskA = createTask({ id: 'task-A', orgId: 'org-1' });
      const taskB = createTask({ id: 'task-B', orgId: 'org-1' });

      vi.mocked(taskRepo.findById).mockImplementation((id) => {
        if (id === 'task-A') return taskA;
        if (id === 'task-B') return taskB;
        return null;
      });
      vi.mocked(dependencyRepo.canReach).mockReturnValue(true);

      expect(() => service.addDependency(input)).toThrow(ValidationError);
      expect(() => service.addDependency(input)).toThrow(/Circular dependency/);
    });

    it('rejects transitive cycle: A -> B -> C -> A', () => {
      const input: CreateTaskDependencyInput = {
        orgId: 'org-1',
        dependentTaskId: 'task-A',
        dependencyTaskId: 'task-C',
      };
      const taskA = createTask({ id: 'task-A', orgId: 'org-1' });
      const taskC = createTask({ id: 'task-C', orgId: 'org-1' });

      vi.mocked(taskRepo.findById).mockImplementation((id) => {
        if (id === 'task-A') return taskA;
        if (id === 'task-C') return taskC;
        return null;
      });
      vi.mocked(dependencyRepo.canReach).mockReturnValue(true);

      expect(() => service.addDependency(input)).toThrow(ValidationError);
      expect(() => service.addDependency(input)).toThrow(/Circular dependency/);
    });

    it('rejects when dependent task not found', () => {
      const input: CreateTaskDependencyInput = {
        orgId: 'org-1',
        dependentTaskId: 'nonexistent',
        dependencyTaskId: 'task-2',
      };
      const dependencyTask = createTask({ id: 'task-2', orgId: 'org-1' });

      vi.mocked(taskRepo.findById).mockImplementation((id) => {
        if (id === 'task-2') return dependencyTask;
        return null;
      });

      expect(() => service.addDependency(input)).toThrow(ValidationError);
      expect(() => service.addDependency(input)).toThrow(/Dependent task not found/);
    });

    it('rejects when dependency task not found', () => {
      const input: CreateTaskDependencyInput = {
        orgId: 'org-1',
        dependentTaskId: 'task-1',
        dependencyTaskId: 'nonexistent',
      };
      const dependentTask = createTask({ id: 'task-1', orgId: 'org-1' });

      vi.mocked(taskRepo.findById).mockImplementation((id) => {
        if (id === 'task-1') return dependentTask;
        return null;
      });

      expect(() => service.addDependency(input)).toThrow(ValidationError);
      expect(() => service.addDependency(input)).toThrow(/Dependency task not found/);
    });

    it('rejects cross-organization dependency', () => {
      const input: CreateTaskDependencyInput = {
        orgId: 'org-1',
        dependentTaskId: 'task-1',
        dependencyTaskId: 'task-2',
      };
      const dependentTask = createTask({ id: 'task-1', orgId: 'org-1' });
      const dependencyTask = createTask({ id: 'task-2', orgId: 'org-2' });

      vi.mocked(taskRepo.findById).mockImplementation((id) => {
        if (id === 'task-1') return dependentTask;
        if (id === 'task-2') return dependencyTask;
        return null;
      });

      expect(() => service.addDependency(input)).toThrow(ValidationError);
      expect(() => service.addDependency(input)).toThrow(/same organization/);
    });

    it('rejects duplicate dependency', () => {
      const input: CreateTaskDependencyInput = {
        orgId: 'org-1',
        dependentTaskId: 'task-1',
        dependencyTaskId: 'task-2',
      };
      const dependentTask = createTask({ id: 'task-1', orgId: 'org-1' });
      const dependencyTask = createTask({ id: 'task-2', orgId: 'org-1' });
      const existingDep = createDependency(input);

      vi.mocked(taskRepo.findById).mockImplementation((id) => {
        if (id === 'task-1') return dependentTask;
        if (id === 'task-2') return dependencyTask;
        return null;
      });
      vi.mocked(dependencyRepo.findByDependentTaskId).mockReturnValue([existingDep]);

      expect(() => service.addDependency(input)).toThrow(ValidationError);
      expect(() => service.addDependency(input)).toThrow(/already exists/);
    });
  });

  describe('removeDependency', () => {
    it('removes existing dependency', () => {
      const dep = createDependency({ id: 'dep-1' });
      vi.mocked(dependencyRepo.findById).mockReturnValue(dep);

      service.removeDependency('dep-1');

      expect(dependencyRepo.deleteByDependentTaskId).toHaveBeenCalledWith('task-1');
      expect(dependencyRepo.deleteByDependencyTaskId).toHaveBeenCalledWith('task-2');
    });

    it('throws when dependency not found', () => {
      vi.mocked(dependencyRepo.findById).mockReturnValue(null);

      expect(() => service.removeDependency('nonexistent')).toThrow(ValidationError);
      expect(() => service.removeDependency('nonexistent')).toThrow(/not found/);
    });
  });

  describe('getDependencies', () => {
    it('returns dependencies for task', () => {
      const deps = [
        createDependency({ dependentTaskId: 'task-1', dependencyTaskId: 'task-2' }),
        createDependency({ id: 'dep-2', dependentTaskId: 'task-1', dependencyTaskId: 'task-3' }),
      ];
      vi.mocked(dependencyRepo.findByDependentTaskId).mockReturnValue(deps);

      const result = service.getDependencies('task-1');

      expect(result).toEqual(deps);
      expect(dependencyRepo.findByDependentTaskId).toHaveBeenCalledWith('task-1');
    });

    it('returns empty array when no dependencies', () => {
      vi.mocked(dependencyRepo.findByDependentTaskId).mockReturnValue([]);

      const result = service.getDependencies('task-1');

      expect(result).toEqual([]);
    });
  });

  describe('getDependents', () => {
    it('returns tasks that depend on given task', () => {
      const deps = [
        createDependency({ dependentTaskId: 'task-2', dependencyTaskId: 'task-1' }),
      ];
      vi.mocked(dependencyRepo.findByDependencyTaskId).mockReturnValue(deps);

      const result = service.getDependents('task-1');

      expect(result).toEqual(deps);
      expect(dependencyRepo.findByDependencyTaskId).toHaveBeenCalledWith('task-1');
    });
  });

  describe('getDependenciesByOrgId', () => {
    it('returns all dependencies for organization', () => {
      const deps = [
        createDependency({ orgId: 'org-1' }),
        createDependency({ id: 'dep-2', orgId: 'org-1' }),
      ];
      vi.mocked(dependencyRepo.findByOrgId).mockReturnValue(deps);

      const result = service.getDependenciesByOrgId('org-1');

      expect(result).toEqual(deps);
      expect(dependencyRepo.findByOrgId).toHaveBeenCalledWith('org-1');
    });
  });
});
