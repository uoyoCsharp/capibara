/**
 * Config Loader Unit Tests
 */

import { describe, it, expect } from 'vitest';
import { automationConfigSchema } from '../../src/config/config.schema.js';

describe('Config Schema', () => {
  it('should apply defaults for minimal config', () => {
    const result = automationConfigSchema.parse({
      cli: { projectDir: '.' },
    });

    expect(result.cli.cliPath).toBe('claude');
    expect(result.cli.maxConcurrentProcesses).toBe(3);
    expect(result.worker.defaultMaxTurns).toBe(25);
    expect(result.evaluator.maxTurns).toBe(3);
    expect(result.pipeline.mode).toBe('semi-auto');
    expect(result.pipeline.budgetLimit).toBe(50);
  });

  it('should reject missing required projectDir', () => {
    const result = automationConfigSchema.safeParse({
      cli: {},
    });
    expect(result.success).toBe(false);
  });

  it('should accept full config', () => {
    const result = automationConfigSchema.safeParse({
      cli: {
        cliPath: '/usr/local/bin/claude',
        projectDir: '/tmp/project',
        maxConcurrentProcesses: 5,
      },
      worker: { defaultMaxTurns: 30, defaultTimeout: 300000 },
      evaluator: { maxTurns: 5 },
      messenger: { maxTurns: 3 },
      conductor: {
        maxAttemptsPerPhase: 5,
        maxTurns: 2,
      },
      trigger: { type: 'manual' },
      pipeline: { mode: 'auto', phases: ['analyze', 'implement'], budgetLimit: 100 },
      persistence: { stateDir: '/tmp/state', logDir: '/tmp/logs' },
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid evaluator maxTurns', () => {
    const result = automationConfigSchema.safeParse({
      cli: { projectDir: '.' },
      evaluator: { maxTurns: 'invalid' },
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid mode', () => {
    const result = automationConfigSchema.safeParse({
      cli: { projectDir: '.' },
      pipeline: { mode: 'turbo' },
    });
    expect(result.success).toBe(false);
  });
});
