import { describe, it, expect } from 'vitest';
import { DefaultFileAccessPolicy } from '@core/modules/acp/policies/file-access.policy';

describe('DefaultFileAccessPolicy', () => {
  const policy = new DefaultFileAccessPolicy();

  describe('Layer 1: cwd boundary', () => {
    it('should allow path within cwd', () => {
      const result = policy.checkRead('/workspace/src/app.ts', '/workspace');
      expect(result.allowed).toBe(true);
    });

    it('should deny path outside cwd', () => {
      const result = policy.checkRead('/etc/passwd', '/workspace');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('outside workspace');
    });

    it('should deny path traversal attempt', () => {
      const result = policy.checkRead('/workspace/../etc/passwd', '/workspace');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('outside workspace');
    });

    it('should handle Windows-style paths', () => {
      const result = policy.checkRead('C:\\projects\\app\\src\\file.ts', 'C:\\projects\\app');
      expect(result.allowed).toBe(true);
    });

    it('should deny Windows-style path traversal', () => {
      const result = policy.checkRead('C:\\projects\\app\\..\\secrets\\key', 'C:\\projects\\app');
      expect(result.allowed).toBe(false);
    });
  });

  describe('Layer 2: allowedPaths allowlist', () => {
    it('should allow path matching allowedPaths glob', () => {
      const result = policy.checkRead('/workspace/src/index.ts', '/workspace', ['src/**']);
      expect(result.allowed).toBe(true);
    });

    it('should deny path not matching allowedPaths', () => {
      const result = policy.checkRead('/workspace/config/secret.yml', '/workspace', ['src/**', 'tests/**']);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not in allowedPaths');
    });

    it('should allow when allowedPaths is empty (no restriction)', () => {
      const result = policy.checkRead('/workspace/anything.ts', '/workspace', []);
      expect(result.allowed).toBe(true);
    });

    it('should allow when allowedPaths is undefined', () => {
      const result = policy.checkRead('/workspace/anything.ts', '/workspace', undefined);
      expect(result.allowed).toBe(true);
    });

    it('should support multiple glob patterns', () => {
      const result = policy.checkRead('/workspace/docs/readme.md', '/workspace', ['src/**', 'docs/**']);
      expect(result.allowed).toBe(true);
    });
  });

  describe('Layer 3: global denylist', () => {
    it('should deny .env file access', () => {
      const result = policy.checkRead('/workspace/.env', '/workspace');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('global deny pattern');
    });

    it('should deny .env.local file access', () => {
      const result = policy.checkRead('/workspace/.env.local', '/workspace');
      expect(result.allowed).toBe(false);
    });

    it('should deny secrets directory access', () => {
      const result = policy.checkRead('/workspace/secrets/api-key.txt', '/workspace');
      expect(result.allowed).toBe(false);
    });

    it('should deny .git/objects access', () => {
      const result = policy.checkRead('/workspace/.git/objects/abc123', '/workspace');
      expect(result.allowed).toBe(false);
    });

    it('should allow .gitignore (not in deny pattern)', () => {
      const result = policy.checkRead('/workspace/.gitignore', '/workspace');
      expect(result.allowed).toBe(true);
    });
  });

  describe('write operations', () => {
    it('should apply same rules to writes', () => {
      const result = policy.checkWrite('/workspace/.env', '/workspace');
      expect(result.allowed).toBe(false);
    });

    it('should allow valid writes', () => {
      const result = policy.checkWrite('/workspace/src/new-file.ts', '/workspace');
      expect(result.allowed).toBe(true);
    });
  });

  describe('custom deny patterns', () => {
    it('should use provided deny patterns instead of defaults', () => {
      const custom = new DefaultFileAccessPolicy(['**/private/**']);
      // .env is not denied with custom patterns
      const envResult = custom.checkRead('/workspace/.env', '/workspace');
      expect(envResult.allowed).toBe(true);
      // But private dir is denied
      const privateResult = custom.checkRead('/workspace/private/data.txt', '/workspace');
      expect(privateResult.allowed).toBe(false);
    });
  });
});
