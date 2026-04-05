import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { DEFAULT_CONFIG } from './config.defaults.js';
import { configSchema } from './config.schema.js';
import type { CapibaraConfig } from '@main/core/types/config.types.js';

function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as Array<keyof T>) {
    const srcVal = source[key];
    const tgtVal = target[key];
    if (
      srcVal !== undefined &&
      srcVal !== null &&
      typeof srcVal === 'object' &&
      !Array.isArray(srcVal) &&
      typeof tgtVal === 'object' &&
      tgtVal !== null &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(
        tgtVal as Record<string, unknown>,
        srcVal as Record<string, unknown>,
      ) as T[keyof T];
    } else if (srcVal !== undefined) {
      result[key] = srcVal as T[keyof T];
    }
  }
  return result;
}

function tryLoadJsonConfig(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function loadConfig(projectDir?: string): CapibaraConfig {
  let merged: Record<string, unknown> = { ...DEFAULT_CONFIG };

  // Resolve paths
  const userDataDir = app.getPath('userData');
  const capibaraDir = join(userDataDir, 'capibara');

  // Ensure dir exists
  if (!existsSync(capibaraDir)) {
    mkdirSync(capibaraDir, { recursive: true });
  }

  // Global config: ~/.capibara/config.json
  const globalConfigPath = join(capibaraDir, 'config.json');
  const globalConfig = tryLoadJsonConfig(globalConfigPath);
  if (globalConfig) {
    merged = deepMerge(merged, globalConfig);
  }

  // Project config: <projectDir>/capibara.config.json
  if (projectDir) {
    const projectConfigPath = join(projectDir, 'capibara.config.json');
    const projectConfig = tryLoadJsonConfig(projectConfigPath);
    if (projectConfig) {
      merged = deepMerge(merged, projectConfig);
    }
  }

  // Resolve default SQLite path if empty
  if (!merged.database || !(merged.database as Record<string, unknown>).sqlitePath) {
    merged = deepMerge(merged, {
      database: { sqlitePath: join(capibaraDir, 'capibara.sqlite') },
    });
  }

  // Resolve default log directory if empty
  if (!merged.logging || !(merged.logging as Record<string, unknown>).logDir) {
    merged = deepMerge(merged, {
      logging: { logDir: join(capibaraDir, 'logs') },
    });
  }

  // Validate
  const validated = configSchema.parse(merged);
  return validated as CapibaraConfig;
}
