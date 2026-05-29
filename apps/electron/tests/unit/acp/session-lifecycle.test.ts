import { describe, it, expect } from 'vitest';
import type * as schema from '@agentclientprotocol/sdk';
import {
  decideLifecycle,
  canTransition,
  assertTransition,
  type LifecycleContext,
} from '@core/modules/acp/client/session-lifecycle';
import type { AcpSessionStatus } from '@core/modules/acp/types/acp.types';

function ctx(overrides: Partial<LifecycleContext> = {}): LifecycleContext {
  return {
    intent: 'keep_alive',
    stopReason: 'end_turn',
    hasPendingInquiry: false,
    ...overrides,
  };
}

describe('decideLifecycle', () => {
  it('suspends for collaboration when a pending inquiry exists (wins over everything)', () => {
    expect(decideLifecycle(ctx({ hasPendingInquiry: true })))
      .toEqual({ action: 'suspend', reason: 'collaboration' });
  });

  it('pending inquiry wins even with close_on_complete intent and a non-end_turn stop', () => {
    expect(decideLifecycle(ctx({
      hasPendingInquiry: true,
      intent: 'close_on_complete',
      stopReason: 'cancelled',
    }))).toEqual({ action: 'suspend', reason: 'collaboration' });
  });

  it('closes with error on an abnormal (non-cancelled, non-end_turn) stop when no inquiry pending', () => {
    const abnormal: schema.StopReason[] = ['max_tokens', 'max_turn_requests', 'refusal'];
    for (const stopReason of abnormal) {
      expect(decideLifecycle(ctx({ stopReason })))
        .toEqual({ action: 'close', reason: 'error' });
    }
  });

  it('closes with reason "cancelled" on a clean cancellation (distinct from error)', () => {
    expect(decideLifecycle(ctx({ stopReason: 'cancelled' })))
      .toEqual({ action: 'close', reason: 'cancelled' });
    // Intent must not change the cancellation outcome.
    expect(decideLifecycle(ctx({ stopReason: 'cancelled', intent: 'close_on_complete' })))
      .toEqual({ action: 'close', reason: 'cancelled' });
  });

  it('suspends idle on end_turn with keep_alive intent (planning continuation)', () => {
    expect(decideLifecycle(ctx({ intent: 'keep_alive', stopReason: 'end_turn' })))
      .toEqual({ action: 'suspend', reason: 'idle' });
  });

  it('closes completed on end_turn with close_on_complete intent (task done)', () => {
    expect(decideLifecycle(ctx({ intent: 'close_on_complete', stopReason: 'end_turn' })))
      .toEqual({ action: 'close', reason: 'completed' });
  });
});

describe('session state machine', () => {
  const legal: Array<[AcpSessionStatus, AcpSessionStatus]> = [
    ['active', 'suspended'],
    ['active', 'closed'],
    ['suspended', 'active'],
    ['suspended', 'expired'],
    ['suspended', 'closed'],
    ['expired', 'active'],
  ];

  const illegal: Array<[AcpSessionStatus, AcpSessionStatus]> = [
    ['active', 'expired'],
    ['closed', 'active'],
    ['closed', 'suspended'],
    ['expired', 'closed'],
    ['expired', 'suspended'],
  ];

  it('allows valid transitions', () => {
    for (const [from, to] of legal) {
      expect(canTransition(from, to), `${from} → ${to}`).toBe(true);
    }
  });

  it('rejects invalid transitions', () => {
    for (const [from, to] of illegal) {
      expect(canTransition(from, to), `${from} → ${to}`).toBe(false);
    }
  });

  it('assertTransition throws on an illegal transition', () => {
    expect(() => assertTransition('closed', 'active')).toThrow(/Illegal ACP session transition/);
  });

  it('assertTransition is silent on a legal transition', () => {
    expect(() => assertTransition('suspended', 'active')).not.toThrow();
  });
});
