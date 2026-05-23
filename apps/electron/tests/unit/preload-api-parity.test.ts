import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Drift guard for the IPC contract.
 *
 * Asserts three invariants by static parsing (no electron bootstrap needed):
 *
 *   1. Every `ipcRenderer.invoke(<channel>, ...)` in the preload has a
 *      matching `ipcMain.handle(<channel>, ...)` somewhere in ipc-handlers/.
 *   2. Every `ipcMain.handle(<channel>, ...)` has either a preload invoke
 *      or is listed in KNOWN_INTERNAL_CHANNELS (below) as intentionally
 *      not exposed to the renderer.
 *   3. Every method name in the `api = { ... }` object literal of preload
 *      matches a method in `CapibaraApi`, and vice versa.
 */

const REPO_ROOT = resolve(__dirname, '../..');
const SRC = resolve(REPO_ROOT, 'src');

// Channels registered by ipcMain.handle but deliberately NOT exposed via
// preload (e.g. handled by a different subsystem). Add here with rationale.
const KNOWN_INTERNAL_CHANNELS = new Set<string>([
  'capibara:snapshot:load',        // called by main bootstrap, not renderer
  'capibara:settings:get-locale',  // wired through getSetting('locale')
]);

// ─── Helpers ──────────────────────────────────────────────────────────

function readSource(relPath: string): string {
  return readFileSync(resolve(SRC, relPath), 'utf-8');
}

function extractMatches(source: string, pattern: RegExp): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(source)) !== null) out.push(m[1]);
  return out;
}

function extractPreloadInvokeChannels(): Set<string> {
  const src = readSource('core/preload/index.ts');
  return new Set(extractMatches(src, /ipcRenderer\.invoke\(\s*'([^']+)'/g));
}

function extractHandlerChannels(): Set<string> {
  const files = [
    'core/ipc-handlers/workflow.handlers.ts',
    'core/ipc-handlers/organization.handlers.ts',
    'core/ipc-handlers/conversation.handlers.ts',
    'core/ipc-handlers/execution.handlers.ts',
    'core/ipc-handlers/plan-tree.handlers.ts',
    'core/ipc-handlers/system.handlers.ts',
    'core/ipc-handlers/acp.handlers.ts',
  ];
  const all = new Set<string>();
  for (const f of files) {
    const src = readSource(f);
    for (const ch of extractMatches(src, /ipcMain\.handle\(\s*'([^']+)'/g)) {
      all.add(ch);
    }
  }
  return all;
}

function extractPreloadMethodNames(): Set<string> {
  const src = readSource('core/preload/index.ts');
  // Match top-level object keys of the `const api = {` literal.
  // Keys are of the form `  name: ` on a line (indented, trailing colon).
  // We identify the api literal bounds by 'const api = {' ... '};' and
  // then parse indented "name:" lines inside.
  const startIdx = src.indexOf('const api = {');
  const endIdx = src.indexOf('};', startIdx);
  if (startIdx === -1 || endIdx === -1) throw new Error('preload api literal not found');
  const body = src.slice(startIdx, endIdx);
  const methods = new Set<string>();
  const lineRe = /^\s{2}([a-zA-Z][a-zA-Z0-9]*)\s*:/gm;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(body)) !== null) methods.add(m[1]);
  return methods;
}

function extractCapibaraApiMethodNames(): Set<string> {
  const src = readSource('core/shared/api.ts');
  const startIdx = src.indexOf('export interface CapibaraApi {');
  if (startIdx === -1) throw new Error('CapibaraApi interface not found');
  const endIdx = src.indexOf('\n}', startIdx);
  const body = src.slice(startIdx, endIdx);
  const methods = new Set<string>();
  // Match "  name: (...) =>" or "  name:" lines at one indent level.
  const lineRe = /^\s{2}([a-zA-Z][a-zA-Z0-9]*)\s*:/gm;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(body)) !== null) methods.add(m[1]);
  return methods;
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('Preload / IPC handler / CapibaraApi parity', () => {
  const preloadChannels = extractPreloadInvokeChannels();
  const handlerChannels = extractHandlerChannels();
  const preloadMethods = extractPreloadMethodNames();
  const apiMethods = extractCapibaraApiMethodNames();

  it('every preload channel has a matching ipcMain.handle', () => {
    const orphans = [...preloadChannels].filter((c) => !handlerChannels.has(c));
    expect(orphans, `preload calls channels with no handler: ${orphans.join(', ')}`).toEqual([]);
  });

  it('every ipcMain.handle is either used by preload or flagged internal', () => {
    const unused = [...handlerChannels].filter(
      (c) => !preloadChannels.has(c) && !KNOWN_INTERNAL_CHANNELS.has(c),
    );
    expect(unused, `handlers exist with no consumer: ${unused.join(', ')}`).toEqual([]);
  });

  it('every preload method is declared in CapibaraApi', () => {
    const orphans = [...preloadMethods].filter((m) => !apiMethods.has(m));
    expect(orphans, `preload exposes methods missing from CapibaraApi: ${orphans.join(', ')}`).toEqual([]);
  });

  it('every CapibaraApi method is implemented in the preload', () => {
    const orphans = [...apiMethods].filter((m) => !preloadMethods.has(m));
    expect(orphans, `CapibaraApi declares methods missing from preload: ${orphans.join(', ')}`).toEqual([]);
  });

  it('preload and CapibaraApi method counts match', () => {
    expect(preloadMethods.size).toBe(apiMethods.size);
  });
});
