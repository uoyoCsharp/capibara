import { describe, it, expect, beforeEach } from 'vitest';
import { PendingPlanStore } from '@core/infrastructure/stores/pending-plan.store';
import type { PendingPlan } from '@core/infrastructure/stores/pending-plan.store';

function createPlan(overrides?: Partial<PendingPlan>): PendingPlan {
  return {
    conversationId: 'conv-1',
    orgId: 'org-1',
    roleId: 'role-1',
    tasks: [{ type: 'task', title: 'Plan item' }],
    submittedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('PendingPlanStore', () => {
  let store: PendingPlanStore;

  beforeEach(() => {
    store = new PendingPlanStore();
  });

  describe('set / get', () => {
    it('stores and retrieves a plan', () => {
      const plan = createPlan();
      store.set('conv-1', plan);
      expect(store.get('conv-1')).toEqual(plan);
    });

    it('returns undefined for non-existent key', () => {
      expect(store.get('nonexistent')).toBeUndefined();
    });

    it('overwrites existing plan for same key', () => {
      store.set('conv-1', createPlan({ tasks: [{ type: 'task', title: 'V1' }] }));
      store.set('conv-1', createPlan({ tasks: [{ type: 'task', title: 'V2' }] }));
      const plan = store.get('conv-1')!;
      expect((plan.tasks[0] as Record<string, unknown>).title).toBe('V2');
    });
  });

  describe('has', () => {
    it('returns true when plan exists and not expired', () => {
      store.set('conv-1', createPlan());
      expect(store.has('conv-1')).toBe(true);
    });

    it('returns false when plan does not exist', () => {
      expect(store.has('nonexistent')).toBe(false);
    });
  });

  describe('delete', () => {
    it('removes plan from store', () => {
      store.set('conv-1', createPlan());
      expect(store.delete('conv-1')).toBe(true);
      expect(store.get('conv-1')).toBeUndefined();
    });

    it('returns false when key not found', () => {
      expect(store.delete('nonexistent')).toBe(false);
    });
  });

  describe('clear', () => {
    it('removes all plans', () => {
      store.set('conv-1', createPlan({ conversationId: 'conv-1' }));
      store.set('conv-2', createPlan({ conversationId: 'conv-2' }));
      store.clear();
      expect(store.get('conv-1')).toBeUndefined();
      expect(store.get('conv-2')).toBeUndefined();
    });
  });

  describe('TTL expiration', () => {
    it('returns undefined for expired plans (older than 24h)', () => {
      const expired = createPlan({
        submittedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      });
      store.set('conv-old', expired);
      expect(store.get('conv-old')).toBeUndefined();
    });

    it('returns plan when not yet expired', () => {
      const fresh = createPlan({
        submittedAt: new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString(),
      });
      store.set('conv-fresh', fresh);
      expect(store.get('conv-fresh')).not.toBeUndefined();
    });

    it('has() returns false for expired plans', () => {
      const expired = createPlan({
        submittedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      });
      store.set('conv-old', expired);
      expect(store.has('conv-old')).toBe(false);
    });
  });
});
