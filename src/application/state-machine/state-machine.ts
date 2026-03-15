/**
 * Lightweight State Machine Implementation - Table-based state transition engine
 * @module application/state-machine/state-machine
 */

import { PipelineStateName } from './states.js';
import { TRANSITIONS, type Transition } from './transitions.js';
import type { IEventBus } from '../../core/interfaces/event-bus.interface.js';
import type { Logger } from 'pino';

export class StateMachine {
  private current: PipelineStateName = PipelineStateName.Idle;
  private transitionMap: Map<string, Transition>;

  constructor(
    private logger: Logger,
    private eventBus: IEventBus,
  ) {
    // Pre-build lookup table: key = "state::event"
    this.transitionMap = new Map(TRANSITIONS.map((t) => [`${t.from}::${t.event}`, t]));
  }

  /** Get current state */
  getState(): PipelineStateName {
    return this.current;
  }

  /** Set state (used for restoring from persistence) */
  setState(state: PipelineStateName): void {
    this.current = state;
  }

  /**
   * Trigger state transition
   * @param event Event name
   * @returns New state after transition
   * @throws Error if no valid transition rule exists
   */
  transition(event: string): PipelineStateName {
    const key = `${this.current}::${event}`;
    const t = this.transitionMap.get(key);
    if (!t) {
      throw new Error(`No transition from "${this.current}" on event "${event}"`);
    }

    const from = this.current;
    this.current = t.to;

    this.logger.info({ from, event, to: this.current }, 'State transition');

    return this.current;
  }

  /**
   * Check if an event can be triggered from current state
   */
  canTransition(event: string): boolean {
    const key = `${this.current}::${event}`;
    return this.transitionMap.has(key);
  }
}
