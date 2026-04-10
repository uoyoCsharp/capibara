import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { WorkflowSchema } from '@main/core/types/workflow-schema.types.js';

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  schema: WorkflowSchema;
}

/**
 * Loads workflow schema templates from JSON files on disk.
 * Similar pattern to OrgTemplateService but for workflow schemas.
 */
export class WorkflowTemplateService {
  private templates: WorkflowTemplate[] = [];

  constructor(
    private readonly logger: ILogger,
    private readonly workflowsDir: string,
  ) {
    this.loadFromDisk();
  }

  getTemplates(): WorkflowTemplate[] {
    return this.templates;
  }

  getById(id: string): WorkflowTemplate | null {
    return this.templates.find((t) => t.id === id) ?? null;
  }

  getDefaultSchema(): WorkflowSchema | null {
    return this.getById('default')?.schema ?? this.templates[0]?.schema ?? null;
  }

  /**
   * Resolve the workflow schema for a given template ID.
   * Falls back to default schema if templateId is null or not found.
   */
  resolveSchema(templateId: string | null | undefined): WorkflowSchema | null {
    if (templateId) {
      const tmpl = this.getById(templateId);
      if (tmpl) return tmpl.schema;
      this.logger.warn('Requested workflow template not found, falling back to default', { templateId });
    }
    return this.getDefaultSchema();
  }

  private loadFromDisk(): void {
    if (!existsSync(this.workflowsDir)) {
      this.logger.warn('Workflows directory not found', { path: this.workflowsDir });
      return;
    }

    const files = readdirSync(this.workflowsDir).filter((f) => f.endsWith('.json'));
    if (files.length === 0) {
      this.logger.warn('No workflow template files found', { path: this.workflowsDir });
      return;
    }

    for (const file of files) {
      try {
        const raw = readFileSync(join(this.workflowsDir, file), 'utf-8');
        const data = JSON.parse(raw) as WorkflowTemplate;

        const errors = this.validate(data, file);
        if (errors.length > 0) {
          this.logger.warn('Invalid workflow template file, skipping', { file, errors });
          continue;
        }

        this.templates.push(data);
        this.logger.info('Workflow template loaded', { file, id: data.id });
      } catch (err) {
        this.logger.error('Failed to parse workflow template file', { file, error: String(err) });
      }
    }

    if (this.templates.length === 0) {
      this.logger.warn('No valid workflow templates loaded from disk, using inline fallback');
      this.templates.push(INLINE_DEFAULT_TEMPLATE);
    }
  }

  private validate(data: unknown, file: string): string[] {
    const errors: string[] = [];
    const d = data as Record<string, unknown>;

    if (typeof d.id !== 'string' || !d.id) errors.push('missing id');
    if (typeof d.name !== 'string' || !d.name) errors.push('missing name');
    if (typeof d.description !== 'string') errors.push('missing description');

    const schema = d.schema as Record<string, unknown> | undefined;
    if (!schema || typeof schema !== 'object') {
      errors.push('missing schema object');
      return errors;
    }

    if (!Array.isArray(schema.workItemTypes) || schema.workItemTypes.length === 0) {
      errors.push('schema.workItemTypes must be a non-empty array');
    }
    if (!Array.isArray(schema.statuses) || schema.statuses.length === 0) {
      errors.push('schema.statuses must be a non-empty array');
    }
    if (!Array.isArray(schema.transitions)) {
      errors.push('schema.transitions must be an array');
    }
    if (!Array.isArray(schema.behaviorRules)) {
      errors.push('schema.behaviorRules must be an array');
    }

    return errors;
  }
}

/** Hardcoded inline fallback used when no JSON template files can be loaded. */
const INLINE_DEFAULT_TEMPLATE: WorkflowTemplate = {
  id: 'default',
  name: 'Default (Scrum-like)',
  description: 'Inline fallback — default workflow with epics, stories, tasks, and a full review cycle.',
  schema: {
    workItemTypes: [
      { name: 'epic', label: 'Epic', isLeaf: false, allowedChildren: ['story', 'spike'], allowedAtRoot: true, canDecompose: true, hasDiscussionGroup: true },
      { name: 'story', label: 'Story', isLeaf: false, allowedChildren: ['task', 'bug', 'chore', 'spike'], allowedAtRoot: true, canDecompose: true, hasDiscussionGroup: true },
      { name: 'task', label: 'Task', isLeaf: false, allowedChildren: ['subtask'], allowedAtRoot: false, canDecompose: false, hasDiscussionGroup: false },
      { name: 'subtask', label: 'Subtask', isLeaf: true, allowedChildren: [], allowedAtRoot: false, canDecompose: false, hasDiscussionGroup: false },
      { name: 'spike', label: 'Spike', isLeaf: true, allowedChildren: [], allowedAtRoot: false, canDecompose: false, hasDiscussionGroup: false },
      { name: 'bug', label: 'Bug', isLeaf: true, allowedChildren: [], allowedAtRoot: false, canDecompose: false, hasDiscussionGroup: false },
      { name: 'chore', label: 'Chore', isLeaf: true, allowedChildren: [], allowedAtRoot: false, canDecompose: false, hasDiscussionGroup: false },
    ],
    statuses: [
      { name: 'pending', label: 'Pending', category: 'initial' },
      { name: 'in_progress', label: 'In Progress', category: 'active' },
      { name: 'revision', label: 'Revision', category: 'active' },
      { name: 'blocked', label: 'Blocked', category: 'active' },
      { name: 'awaiting_review', label: 'Awaiting Review', category: 'review' },
      { name: 'approved', label: 'Approved', category: 'terminal' },
      { name: 'done', label: 'Done', category: 'terminal' },
      { name: 'cancelled', label: 'Cancelled', category: 'terminal' },
    ],
    transitions: [
      { from: 'pending', to: 'in_progress', trigger: 'manual' },
      { from: 'in_progress', to: 'awaiting_review', trigger: 'manual' },
      { from: 'in_progress', to: 'blocked', trigger: 'system' },
      { from: 'blocked', to: 'in_progress', trigger: 'manual' },
      { from: 'awaiting_review', to: 'approved', trigger: 'manual' },
      { from: 'awaiting_review', to: 'revision', trigger: 'manual' },
      { from: 'revision', to: 'in_progress', trigger: 'manual' },
      { from: 'revision', to: 'awaiting_review', trigger: 'manual' },
      { from: 'approved', to: 'done', trigger: 'auto' },
      { from: 'pending', to: 'cancelled', trigger: 'system' },
      { from: 'in_progress', to: 'cancelled', trigger: 'system' },
      { from: 'blocked', to: 'cancelled', trigger: 'system' },
    ],
    behaviorRules: [
      { id: 'default-auto-done-leaf', name: 'Auto-complete leaf on approval', priority: 10, trigger: { type: 'on_status_enter', status: 'approved' }, condition: { type: 'item_is_leaf' }, action: { type: 'auto_transition', targetStatus: 'done' } },
      { id: 'default-propagate-parent', name: 'Auto-transition parent when all children terminal', priority: 20, trigger: { type: 'on_all_children_terminal' }, condition: { type: 'always' }, action: { type: 'auto_transition', targetStatus: 'done' } },
      { id: 'default-discussion-group', name: 'Create discussion group on task creation', priority: 30, trigger: { type: 'on_task_created' }, condition: { type: 'always' }, action: { type: 'create_discussion_group' } },
    ],
  } as WorkflowSchema,
};
