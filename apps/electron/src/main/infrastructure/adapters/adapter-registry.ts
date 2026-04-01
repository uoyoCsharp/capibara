/**
 * CLI Adapter registry and factory.
 *
 * Resolves the appropriate ICliAdapter by executor name.
 * New adapters are registered here — no changes needed in worker code.
 */

import type { ICliAdapter } from '@main/core/interfaces/i-cli-adapter.js';
import { ClaudeLocalAdapter } from './claude-local.adapter.js';

const adapters = new Map<string, ICliAdapter>();

function ensureDefaults(): void {
  if (adapters.size > 0) return;
  registerAdapter(new ClaudeLocalAdapter());
}

export function registerAdapter(adapter: ICliAdapter): void {
  adapters.set(adapter.name, adapter);
}

export function getAdapter(executorName: string): ICliAdapter {
  ensureDefaults();

  // Direct match
  const direct = adapters.get(executorName);
  if (direct) return direct;

  // Alias resolution
  const aliases: Record<string, string> = {
    'claude': 'claude-cli',
    'claude-code': 'claude-cli',
  };

  const resolved = aliases[executorName];
  if (resolved) {
    const aliased = adapters.get(resolved);
    if (aliased) return aliased;
  }

  throw new Error(
    `No CLI adapter registered for executor "${executorName}". ` +
    `Available: ${[...adapters.keys()].join(', ')}`,
  );
}

export function listAdapters(): string[] {
  ensureDefaults();
  return [...adapters.keys()];
}
