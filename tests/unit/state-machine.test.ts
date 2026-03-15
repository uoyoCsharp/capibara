/**
 * State Machine Unit Tests
 */

import { describe, it, expect } from 'vitest';
import { StateMachine } from '../../src/application/state-machine/state-machine.js';
import { PipelineStateName } from '../../src/application/state-machine/states.js';

// Create minimal mock logger and eventBus
const mockLogger = {
  info: () => {},
  warn: () => {},
  debug: () => {},
  error: () => {},
} as any;

const mockEventBus = {
  emit: () => {},
  on: () => {},
  off: () => {},
} as any;

describe('StateMachine', () => {
  it('should start in Idle state', () => {
    const sm = new StateMachine(mockLogger, mockEventBus);
    expect(sm.getState()).toBe(PipelineStateName.Idle);
  });

  it('should transition from Idle to Triggered on new_requirement', () => {
    const sm = new StateMachine(mockLogger, mockEventBus);
    sm.transition('new_requirement');
    expect(sm.getState()).toBe(PipelineStateName.Triggered);
  });

  it('should transition through analyze phase', () => {
    const sm = new StateMachine(mockLogger, mockEventBus);
    sm.transition('new_requirement');
    sm.transition('start_analyze');
    expect(sm.getState()).toBe(PipelineStateName.Analyzing);

    sm.transition('phase_complete');
    expect(sm.getState()).toBe(PipelineStateName.AnalyzeEvaluating);

    sm.transition('evaluations_complete');
    expect(sm.getState()).toBe(PipelineStateName.AnalyzeDecision);

    sm.transition('approve');
    expect(sm.getState()).toBe(PipelineStateName.Designing);
  });

  it('should support revise loop', () => {
    const sm = new StateMachine(mockLogger, mockEventBus);
    sm.transition('new_requirement');
    sm.transition('start_analyze');
    sm.transition('phase_complete');
    sm.transition('evaluations_complete');

    // Revise back to Analyzing
    sm.transition('revise');
    expect(sm.getState()).toBe(PipelineStateName.Analyzing);
  });

  it('should throw on invalid transition', () => {
    const sm = new StateMachine(mockLogger, mockEventBus);
    expect(() => sm.transition('approve')).toThrow('No transition from "idle" on event "approve"');
  });

  it('should report canTransition correctly', () => {
    const sm = new StateMachine(mockLogger, mockEventBus);
    expect(sm.canTransition('new_requirement')).toBe(true);
    expect(sm.canTransition('approve')).toBe(false);
  });

  it('should allow setState for recovery', () => {
    const sm = new StateMachine(mockLogger, mockEventBus);
    sm.setState(PipelineStateName.Implementing);
    expect(sm.getState()).toBe(PipelineStateName.Implementing);
  });

  it('should transition through full pipeline', () => {
    const sm = new StateMachine(mockLogger, mockEventBus);

    // Idle -> Triggered -> Analyzing
    sm.transition('new_requirement');
    sm.transition('start_analyze');

    // Analyze
    sm.transition('phase_complete');
    sm.transition('evaluations_complete');
    sm.transition('approve');

    // Design
    sm.transition('phase_complete');
    sm.transition('evaluations_complete');
    sm.transition('approve');

    // Implement
    sm.transition('phase_complete');
    sm.transition('evaluations_complete');
    sm.transition('approve');

    // Review
    sm.transition('phase_complete');
    sm.transition('evaluations_complete');
    sm.transition('approve');

    // Test
    sm.transition('phase_complete');
    sm.transition('evaluations_complete');
    sm.transition('approve');

    expect(sm.getState()).toBe(PipelineStateName.Completed);
  });
});
