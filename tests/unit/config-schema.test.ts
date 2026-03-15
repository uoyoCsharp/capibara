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
    expect(result.evaluator.dimensions).toEqual(['quality']);
    expect(result.pipeline.mode).toBe('semi-auto');
    expect(result.pipeline.phases).toEqual(['analyze', 'design', 'implement', 'review', 'test']);
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
      evaluator: { dimensions: ['quality', 'security'], maxTurns: 5, parseRetries: 3 },
      messenger: { maxTurns: 3, summarizeThreshold: 3000, fallbackToRaw: false },
      conductor: {
        maxAttemptsPerPhase: 5,
        autoApproveThreshold: 70,
        escalateThreshold: 3,
        maxTurns: 2,
      },
      trigger: { type: 'manual' },
      pipeline: { mode: 'auto', phases: ['analyze', 'implement'], budgetLimit: 100 },
      persistence: { stateDir: '/tmp/state', logDir: '/tmp/logs' },
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid dimension', () => {
    const result = automationConfigSchema.safeParse({
      cli: { projectDir: '.' },
      evaluator: { dimensions: ['invalid'] },
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
