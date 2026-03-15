/**
 * Configuration Loader - Loads and validates config from file + environment variables
 * @module config/config-loader
 */

import { config as dotenvConfig } from 'dotenv';
import { readFileSync, existsSync } from 'node:fs';
import { automationConfigSchema } from './config.schema.js';
import type { AutomationConfig } from '../core/types/config.types.js';

/**
 * Config loading process:
 * 1. Read .env environment variables
 * 2. Read automation.config.json file (if exists)
 * 3. Merge environment variable overrides
 * 4. Zod validation (fail fast on failure)
 */
export function loadConfig(configPath?: string): AutomationConfig {
  dotenvConfig();

  const filePath = configPath ?? 'automation.config.json';
  let fileConfig: Record<string, unknown> = {};

  if (existsSync(filePath)) {
    const raw = readFileSync(filePath, 'utf-8');
    fileConfig = JSON.parse(raw);
  }

  // Environment variables take precedence over config file
  const cliConfig = (fileConfig.cli ?? {}) as Record<string, unknown>;
  const triggerConfig = (fileConfig.trigger ?? {}) as Record<string, unknown>;
  const githubConfig = (triggerConfig.github ?? {}) as Record<string, unknown>;

  const merged = {
    ...fileConfig,
    cli: {
      ...cliConfig,
      cliPath: process.env.CLAUDE_CLI_PATH ?? cliConfig.cliPath,
      projectDir: process.env.PROJECT_DIR ?? cliConfig.projectDir ?? '.',
    },
    trigger: {
      ...triggerConfig,
      github: githubConfig.owner
        ? {
            ...githubConfig,
            token: process.env.GITHUB_TOKEN ?? githubConfig.token,
          }
        : undefined,
    },
  };

  const result = automationConfigSchema.safeParse(merged);
  if (!result.success) {
    const formatted = result.error.format();
    throw new Error(`Configuration validation failed:\n${JSON.stringify(formatted, null, 2)}`);
  }

  return result.data as AutomationConfig;
}
