import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProcessEngine } from '@core/modules/workflow/engines/process.engine';
import type { IProcessSchemaRepository } from '@core/modules/workflow/interfaces/i-process-schema.repository';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { ProcessSchema, ProcessSchemaRecord } from '@core/modules/workflow/types/workflow.types';
import { ValidationError } from '@core/foundation/errors/capibara.errors';

const DEFAULT_SCHEMA: ProcessSchema = {
  workItemTypes: [
    { name: 'epic', label: 'Epic', isLeaf: false, allowedChildren: ['story', 'spike'], allowedAtRoot: true, canDecompose: true },
    { name: 'story', label: 'Story', isLeaf: false, allowedChildren: ['task', 'bug'], allowedAtRoot: true, canDecompose: true },
    { name: 'task', label: 'Task', isLeaf: false, allowedChildren: ['subtask'], allowedAtRoot: false, canDecompose: false },
    { name: 'subtask', label: 'Subtask', isLeaf: true, allowedChildren: [], allowedAtRoot: false, canDecompose: false },
  ],
  statuses: [
    { name: 'pending', label: 'Pending', category: 'initial' },
    { name: 'in_progress', label: 'In Progress', category: 'active' },
    { name: 'revision', label: 'Revision', category: 'active' },
    { name: 'blocked', label: 'Blocked', category: 'active' },
    { name: 'awaiting_review', label: 'Awaiting Review', category: 'approval' },
    { name: 'approved', label: 'Approved', category: 'terminal' },
    { name: 'done', label: 'Done', category: 'terminal' },
    { name: 'cancelled', label: 'Cancelled', category: 'terminal' },
  ],
  transitions: [
    { from: 'pending', to: 'in_progress' },
    { from: 'in_progress', to: 'awaiting_review' },
    { from: 'in_progress', to: 'blocked' },
    { from: 'blocked', to: 'in_progress' },
    { from: 'awaiting_review', to: 'approved' },
    { from: 'awaiting_review', to: 'revision' },
    { from: 'revision', to: 'in_progress' },
    { from: 'revision', to: 'awaiting_review' },
    { from: 'approved', to: 'done' },
    { from: 'pending', to: 'cancelled' },
    { from: 'in_progress', to: 'cancelled' },
    { from: 'blocked', to: 'cancelled' },
  ],
  behaviorRules: [],
};

function makeSchemaRecord(schema: ProcessSchema = DEFAULT_SCHEMA): ProcessSchemaRecord {
  return {
    id: 'schema-1',
    orgId: 'org-1',
    schemaJson: JSON.stringify(schema),
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('ProcessEngine', () => {
  let engine: ProcessEngine;
  let schemaRepo: IProcessSchemaRepository;
  let logger: ILogger;

  beforeEach(() => {
    schemaRepo = {
      findActiveByOrgId: vi.fn().mockReturnValue(makeSchemaRecord()),
      findById: vi.fn(),
      save: vi.fn(),
      deactivate: vi.fn(),
    } as unknown as IProcessSchemaRepository;

    logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as ILogger;

    engine = new ProcessEngine(schemaRepo, logger);
  });

  // ─── validateTransition() ──────────────────────────────────────

  describe('validateTransition()', () => {
    it('returns true for valid transition: pending → in_progress', () => {
      expect(engine.validateTransition('org-1', 'pending', 'in_progress')).toBe(true);
    });

    it('returns true for valid transition: in_progress → awaiting_review', () => {
      expect(engine.validateTransition('org-1', 'in_progress', 'awaiting_review')).toBe(true);
    });

    it('returns true for valid transition: awaiting_review → approved', () => {
      expect(engine.validateTransition('org-1', 'awaiting_review', 'approved')).toBe(true);
    });

    it('returns true for valid transition: approved → done (auto)', () => {
      expect(engine.validateTransition('org-1', 'approved', 'done')).toBe(true);
    });

    it('returns true for valid transition: in_progress → cancelled', () => {
      expect(engine.validateTransition('org-1', 'in_progress', 'cancelled')).toBe(true);
    });

    it('returns false for in_progress → approved (the reported bug)', () => {
      expect(engine.validateTransition('org-1', 'in_progress', 'approved')).toBe(false);
    });

    it('returns false for in_progress → done (no direct path)', () => {
      expect(engine.validateTransition('org-1', 'in_progress', 'done')).toBe(false);
    });

    it('returns false for pending → approved (skips entire workflow)', () => {
      expect(engine.validateTransition('org-1', 'pending', 'approved')).toBe(false);
    });

    it('returns false for pending → done (skips entire workflow)', () => {
      expect(engine.validateTransition('org-1', 'pending', 'done')).toBe(false);
    });

    it('returns false for done → in_progress (reverse from terminal)', () => {
      expect(engine.validateTransition('org-1', 'done', 'in_progress')).toBe(false);
    });

    it('returns false for cancelled → in_progress (reverse from terminal)', () => {
      expect(engine.validateTransition('org-1', 'cancelled', 'in_progress')).toBe(false);
    });

    it('returns false for approved → in_progress (reverse from terminal)', () => {
      expect(engine.validateTransition('org-1', 'approved', 'in_progress')).toBe(false);
    });

    it('returns false for awaiting_review → in_progress (not a defined reverse)', () => {
      expect(engine.validateTransition('org-1', 'awaiting_review', 'in_progress')).toBe(false);
    });

    it('returns false for awaiting_review → done (skipping approved)', () => {
      expect(engine.validateTransition('org-1', 'awaiting_review', 'done')).toBe(false);
    });

    it('returns false for blocked → done (no direct path)', () => {
      expect(engine.validateTransition('org-1', 'blocked', 'done')).toBe(false);
    });

    it('returns false for revision → approved (must go through awaiting_review)', () => {
      expect(engine.validateTransition('org-1', 'revision', 'approved')).toBe(false);
    });

    it('returns false for same-status "transition" when not defined', () => {
      expect(engine.validateTransition('org-1', 'pending', 'pending')).toBe(false);
    });

    it('returns false for completely unknown status names', () => {
      expect(engine.validateTransition('org-1', 'nonexistent', 'in_progress')).toBe(false);
      expect(engine.validateTransition('org-1', 'in_progress', 'nonexistent')).toBe(false);
    });

    it('returns true (permissive) when no schema exists for org', () => {
      vi.mocked(schemaRepo.findActiveByOrgId).mockReturnValue(null);
      const freshEngine = new ProcessEngine(schemaRepo, logger);
      expect(freshEngine.validateTransition('unknown-org', 'anything', 'else')).toBe(true);
    });
  });

  // ─── getStatusesByCategory() ───────────────────────────────────

  describe('getStatusesByCategory()', () => {
    it('returns all terminal statuses in declaration order', () => {
      const terminals = engine.getStatusesByCategory('org-1', 'terminal');
      expect(terminals.map((s) => s.name)).toEqual(['approved', 'done', 'cancelled']);
    });

    it('approved is the first terminal status (root cause of the bug)', () => {
      const terminals = engine.getStatusesByCategory('org-1', 'terminal');
      expect(terminals[0].name).toBe('approved');
    });

    it('returns initial statuses', () => {
      const initials = engine.getStatusesByCategory('org-1', 'initial');
      expect(initials).toHaveLength(1);
      expect(initials[0].name).toBe('pending');
    });

    it('returns active statuses', () => {
      const actives = engine.getStatusesByCategory('org-1', 'active');
      expect(actives.map((s) => s.name)).toEqual(['in_progress', 'revision', 'blocked']);
    });

    it('returns empty array when no schema exists', () => {
      vi.mocked(schemaRepo.findActiveByOrgId).mockReturnValue(null);
      const freshEngine = new ProcessEngine(schemaRepo, logger);
      expect(freshEngine.getStatusesByCategory('unknown', 'terminal')).toEqual([]);
    });

    it('returns empty array for category with no matching statuses', () => {
      const schema: ProcessSchema = {
        ...DEFAULT_SCHEMA,
        statuses: [
          { name: 'pending', label: 'Pending', category: 'initial' },
          { name: 'done', label: 'Done', category: 'terminal' },
        ],
      };
      vi.mocked(schemaRepo.findActiveByOrgId).mockReturnValue(makeSchemaRecord(schema));
      const freshEngine = new ProcessEngine(schemaRepo, logger);
      expect(freshEngine.getStatusesByCategory('org-1', 'active')).toEqual([]);
    });
  });

  describe('getStatusesByCategory() — approval', () => {
    it('returns awaiting_review under approval category after fix', () => {
      const approvalStatuses = engine.getStatusesByCategory('org-1', 'approval');
      expect(approvalStatuses).toHaveLength(1);
      expect(approvalStatuses[0].name).toBe('awaiting_review');
    });
  });

  // ─── getAvailableTransitions() ─────────────────────────────────

  describe('getAvailableTransitions()', () => {
    it('returns all outgoing transitions from in_progress', () => {
      const transitions = engine.getAvailableTransitions('org-1', 'in_progress');
      const targets = transitions.map((t) => t.to);
      expect(targets).toEqual(['awaiting_review', 'blocked', 'cancelled']);
    });

    it('returns all outgoing transitions from pending', () => {
      const transitions = engine.getAvailableTransitions('org-1', 'pending');
      const targets = transitions.map((t) => t.to);
      expect(targets).toEqual(['in_progress', 'cancelled']);
    });

    it('returns all outgoing transitions from awaiting_review', () => {
      const transitions = engine.getAvailableTransitions('org-1', 'awaiting_review');
      const targets = transitions.map((t) => t.to);
      expect(targets).toEqual(['approved', 'revision']);
    });

    it('returns single transition from approved', () => {
      const transitions = engine.getAvailableTransitions('org-1', 'approved');
      expect(transitions).toHaveLength(1);
      expect(transitions[0]).toEqual({ from: 'approved', to: 'done' });
    });

    it('returns empty array for terminal status done (no outgoing)', () => {
      expect(engine.getAvailableTransitions('org-1', 'done')).toEqual([]);
    });

    it('returns empty array for terminal status cancelled', () => {
      expect(engine.getAvailableTransitions('org-1', 'cancelled')).toEqual([]);
    });

    it('returns empty array for unknown status', () => {
      expect(engine.getAvailableTransitions('org-1', 'nonexistent')).toEqual([]);
    });

    it('returns empty array when no schema exists', () => {
      vi.mocked(schemaRepo.findActiveByOrgId).mockReturnValue(null);
      const freshEngine = new ProcessEngine(schemaRepo, logger);
      expect(freshEngine.getAvailableTransitions('unknown', 'pending')).toEqual([]);
    });

    it('returns transition definitions with from and to fields', () => {
      const transitions = engine.getAvailableTransitions('org-1', 'in_progress');
      for (const t of transitions) {
        expect(t.from).toBe('in_progress');
        expect(typeof t.to).toBe('string');
      }
    });
  });

  // ─── getStatusCategory() ───────────────────────────────────────

  describe('getStatusCategory()', () => {
    it('returns correct category for each status', () => {
      expect(engine.getStatusCategory('org-1', 'pending')).toBe('initial');
      expect(engine.getStatusCategory('org-1', 'in_progress')).toBe('active');
      expect(engine.getStatusCategory('org-1', 'awaiting_review')).toBe('approval');
      expect(engine.getStatusCategory('org-1', 'approved')).toBe('terminal');
      expect(engine.getStatusCategory('org-1', 'done')).toBe('terminal');
      expect(engine.getStatusCategory('org-1', 'cancelled')).toBe('terminal');
    });

    it('returns null for unknown status', () => {
      expect(engine.getStatusCategory('org-1', 'nonexistent')).toBeNull();
    });

    it('returns null when no schema exists', () => {
      vi.mocked(schemaRepo.findActiveByOrgId).mockReturnValue(null);
      const freshEngine = new ProcessEngine(schemaRepo, logger);
      expect(freshEngine.getStatusCategory('unknown', 'pending')).toBeNull();
    });
  });

  // ─── getTransition() ──────────────────────────────────────────

  describe('getTransition()', () => {
    it('returns transition definition for valid path', () => {
      const t = engine.getTransition('org-1', 'pending', 'in_progress');
      expect(t).toEqual({ from: 'pending', to: 'in_progress' });
    });

    it('returns null for invalid path', () => {
      expect(engine.getTransition('org-1', 'in_progress', 'approved')).toBeNull();
    });
  });

  // ─── validateChildType() ──────────────────────────────────────

  describe('validateChildType()', () => {
    it('allows story as child of epic', () => {
      expect(engine.validateChildType('org-1', 'epic', 'story')).toBe(true);
    });

    it('allows task as child of story', () => {
      expect(engine.validateChildType('org-1', 'story', 'task')).toBe(true);
    });

    it('rejects task as child of epic', () => {
      expect(engine.validateChildType('org-1', 'epic', 'task')).toBe(false);
    });

    it('rejects epic as child of story', () => {
      expect(engine.validateChildType('org-1', 'story', 'epic')).toBe(false);
    });

    it('rejects any child of a leaf type (subtask)', () => {
      expect(engine.validateChildType('org-1', 'subtask', 'task')).toBe(false);
    });

    it('returns true (permissive) for unknown parent type', () => {
      expect(engine.validateChildType('org-1', 'nonexistent', 'task')).toBe(true);
    });
  });

  // ─── saveSchema() / validateSchema() ──────────────────────────

  describe('saveSchema()', () => {
    it('throws ValidationError when schema has no statuses', () => {
      const schema = { ...DEFAULT_SCHEMA, statuses: [] };
      expect(() => engine.saveSchema('org-1', schema as ProcessSchema)).toThrow(ValidationError);
    });

    it('throws ValidationError when schema has no initial status', () => {
      const schema: ProcessSchema = {
        ...DEFAULT_SCHEMA,
        statuses: [{ name: 'done', label: 'Done', category: 'terminal' }],
      };
      expect(() => engine.saveSchema('org-1', schema)).toThrow(ValidationError);
    });

    it('throws ValidationError when schema has no terminal status', () => {
      const schema: ProcessSchema = {
        ...DEFAULT_SCHEMA,
        statuses: [{ name: 'pending', label: 'Pending', category: 'initial' }],
      };
      expect(() => engine.saveSchema('org-1', schema)).toThrow(ValidationError);
    });

    it('throws ValidationError when transition references unknown from-status', () => {
      const schema: ProcessSchema = {
        ...DEFAULT_SCHEMA,
        statuses: [
          { name: 'pending', label: 'Pending', category: 'initial' },
          { name: 'done', label: 'Done', category: 'terminal' },
        ],
        transitions: [{ from: 'nonexistent', to: 'done' }],
      };
      expect(() => engine.saveSchema('org-1', schema)).toThrow(ValidationError);
      expect(() => engine.saveSchema('org-1', schema)).toThrow(/unknown status: nonexistent/);
    });

    it('throws ValidationError when transition references unknown to-status', () => {
      const schema: ProcessSchema = {
        ...DEFAULT_SCHEMA,
        statuses: [
          { name: 'pending', label: 'Pending', category: 'initial' },
          { name: 'done', label: 'Done', category: 'terminal' },
        ],
        transitions: [{ from: 'pending', to: 'nonexistent' }],
      };
      expect(() => engine.saveSchema('org-1', schema)).toThrow(ValidationError);
      expect(() => engine.saveSchema('org-1', schema)).toThrow(/unknown status: nonexistent/);
    });

    it('saves valid schema and updates cache', () => {
      const schema: ProcessSchema = {
        ...DEFAULT_SCHEMA,
        statuses: [
          { name: 'pending', label: 'Pending', category: 'initial' },
          { name: 'done', label: 'Done', category: 'terminal' },
        ],
        transitions: [{ from: 'pending', to: 'done' }],
      };

      engine.saveSchema('org-1', schema);

      expect(schemaRepo.save).toHaveBeenCalledWith('org-1', JSON.stringify(schema));
      expect(engine.validateTransition('org-1', 'pending', 'done')).toBe(true);
    });
  });

  // ─── Schema caching ───────────────────────────────────────────

  describe('schema caching', () => {
    it('caches schema after first load', () => {
      engine.validateTransition('org-1', 'pending', 'in_progress');
      engine.validateTransition('org-1', 'pending', 'in_progress');
      expect(schemaRepo.findActiveByOrgId).toHaveBeenCalledTimes(1);
    });

    it('clearCache forces reload on next access', () => {
      engine.validateTransition('org-1', 'pending', 'in_progress');
      engine.clearCache('org-1');
      engine.validateTransition('org-1', 'pending', 'in_progress');
      expect(schemaRepo.findActiveByOrgId).toHaveBeenCalledTimes(2);
    });
  });
});
