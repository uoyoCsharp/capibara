import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { DEFAULT_CONFIG } from './config.defaults';
import { configSchema } from './config.schema';
import type { CapibaraConfig } from './config.types';

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

  const userDataDir = app.getPath('userData');
  const capibaraDir = join(userDataDir, 'capibara');

  if (!existsSync(capibaraDir)) {
    mkdirSync(capibaraDir, { recursive: true });
  }

  const globalConfigPath = join(capibaraDir, 'config.json');
  const globalConfig = tryLoadJsonConfig(globalConfigPath);
  if (globalConfig) {
    merged = deepMerge(merged, globalConfig);
  }

  if (projectDir) {
    const projectConfigPath = join(projectDir, 'capibara.config.json');
    const projectConfig = tryLoadJsonConfig(projectConfigPath);
    if (projectConfig) {
      merged = deepMerge(merged, projectConfig);
    }
  }

  if (!merged.database || !(merged.database as Record<string, unknown>).sqlitePath) {
    merged = deepMerge(merged, {
      database: { sqlitePath: join(capibaraDir, 'capibara.sqlite') },
    });
  }

  if (!merged.logging || !(merged.logging as Record<string, unknown>).logDir) {
    merged = deepMerge(merged, {
      logging: { logDir: join(capibaraDir, 'logs') },
    });
  }

  const envLogLevel = process.env.CAPIBARA_LOG_LEVEL || process.env.LOG_LEVEL;
  if (envLogLevel) {
    merged = deepMerge(merged, { logging: { level: envLogLevel } });
  }

  const validated = configSchema.parse(merged);
  return validated as CapibaraConfig;
}
