import { resolve, relative as relativePath } from 'node:path';
import { minimatch } from 'minimatch';

export interface AccessDecision {
  allowed: boolean;
  reason?: string;
}

export interface IFileAccessPolicy {
  checkRead(path: string, cwd: string, allowedPaths?: string[]): AccessDecision;
  checkWrite(path: string, cwd: string, allowedPaths?: string[]): AccessDecision;
}

/**
 * Three-layer file access control:
 *   Layer 1: cwd boundary — path must be within cwd
 *   Layer 2: allowedPaths — if configured, path must match an allowlist glob
 *   Layer 3: denylist — global deny patterns (.env, secrets, etc.)
 */
export class DefaultFileAccessPolicy implements IFileAccessPolicy {
  private readonly globalDenyPatterns: string[];

  constructor(denyPatterns?: string[]) {
    this.globalDenyPatterns = denyPatterns ?? [
      '**/.env',
      '**/.env.*',
      '**/secrets/**',
      '**/.git/objects/**',
      '**/node_modules/.cache/**',
    ];
  }

  checkRead(path: string, cwd: string, allowedPaths?: string[]): AccessDecision {
    return this.check(path, cwd, allowedPaths);
  }

  checkWrite(path: string, cwd: string, allowedPaths?: string[]): AccessDecision {
    return this.check(path, cwd, allowedPaths);
  }

  private check(targetPath: string, cwd: string, allowedPaths?: string[]): AccessDecision {
    const resolved = resolve(targetPath);
    const resolvedCwd = resolve(cwd);

    // Layer 1: cwd boundary
    const normalizedResolved = resolved.replace(/\\/g, '/').toLowerCase();
    const normalizedCwd = resolvedCwd.replace(/\\/g, '/').toLowerCase();
    if (!normalizedResolved.startsWith(normalizedCwd)) {
      return { allowed: false, reason: `Path outside workspace: ${targetPath}` };
    }

    const rel = relativePath(resolvedCwd, resolved).replace(/\\/g, '/');

    // Layer 2: allowlist (if configured)
    if (allowedPaths && allowedPaths.length > 0) {
      const matched = allowedPaths.some(pattern => minimatch(rel, pattern));
      if (!matched) {
        return { allowed: false, reason: 'Path not in allowedPaths for this role' };
      }
    }

    // Layer 3: global denylist
    const denied = this.globalDenyPatterns.some(pattern => minimatch(rel, pattern));
    if (denied) {
      return { allowed: false, reason: 'Path matches global deny pattern' };
    }

    return { allowed: true };
  }
}
