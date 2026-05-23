import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolPermissionPolicy } from '@core/modules/acp/policies/tool-permission.policy';
import type { IRoleRepository } from '@core/modules/organization/interfaces/i-role.repository';

function createMockRoleRepo(overrides: Record<string, any> = {}): IRoleRepository {
  return {
    findById: vi.fn().mockImplementation((id: string) => {
      if (id === 'role-not-found') return null;
      return {
        id,
        orgId: 'org-1',
        name: 'Developer',
        toolPolicy: 'permissive',
        ...overrides,
      };
    }),
    findByIds: vi.fn(),
    findByOrgId: vi.fn(),
    findChildren: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } as any;
}

describe('ToolPermissionPolicy', () => {
  describe('evaluate', () => {
    it('should return denied when role is not found', () => {
      const repo = createMockRoleRepo();
      const policy = new ToolPermissionPolicy(repo);

      const result = policy.evaluate('role-not-found', {
        toolCallId: 'tc-1',
        title: 'Read file',
        kind: 'read',
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Role not found');
    });

    it('should allow safe operations in permissive mode', () => {
      const repo = createMockRoleRepo({ toolPolicy: 'permissive' });
      const policy = new ToolPermissionPolicy(repo);

      const result = policy.evaluate('role-1', {
        toolCallId: 'tc-1',
        title: 'Read file src/app.ts',
        kind: 'read',
      });

      expect(result.allowed).toBe(true);
    });

    it('should deny rm -rf command in permissive mode', () => {
      const repo = createMockRoleRepo({ toolPolicy: 'permissive' });
      const policy = new ToolPermissionPolicy(repo);

      const result = policy.evaluate('role-1', {
        toolCallId: 'tc-2',
        title: 'rm -rf /',
        kind: 'command',
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Denied by pattern');
    });

    it('should deny DROP TABLE command', () => {
      const repo = createMockRoleRepo({ toolPolicy: 'permissive' });
      const policy = new ToolPermissionPolicy(repo);

      const result = policy.evaluate('role-1', {
        toolCallId: 'tc-3',
        title: 'DROP TABLE users',
        kind: 'command',
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Denied by pattern');
    });

    it('should deny format command', () => {
      const repo = createMockRoleRepo({ toolPolicy: 'permissive' });
      const policy = new ToolPermissionPolicy(repo);

      const result = policy.evaluate('role-1', {
        toolCallId: 'tc-4',
        title: 'format C:',
        kind: 'command',
      });

      expect(result.allowed).toBe(false);
    });

    it('should allow non-command kind even with dangerous title', () => {
      const repo = createMockRoleRepo({ toolPolicy: 'permissive' });
      const policy = new ToolPermissionPolicy(repo);

      const result = policy.evaluate('role-1', {
        toolCallId: 'tc-5',
        title: 'rm -rf note in documentation',
        kind: 'read',
      });

      expect(result.allowed).toBe(true);
    });

    it('should use permissive as default when toolPolicy is undefined', () => {
      const repo = createMockRoleRepo({ toolPolicy: undefined });
      const policy = new ToolPermissionPolicy(repo);

      const result = policy.evaluate('role-1', {
        toolCallId: 'tc-6',
        title: 'Write file',
        kind: 'edit',
      });

      expect(result.allowed).toBe(true);
    });

    it('should handle restrictive mode (falls back to denylist for now)', () => {
      const repo = createMockRoleRepo({ toolPolicy: 'restrictive' });
      const policy = new ToolPermissionPolicy(repo);

      const result = policy.evaluate('role-1', {
        toolCallId: 'tc-7',
        title: 'Read file',
        kind: 'read',
      });

      // Currently restrictive falls back to permissive (denylist only)
      expect(result.allowed).toBe(true);
    });

    it('should handle ask_user mode (falls back to permissive)', () => {
      const repo = createMockRoleRepo({ toolPolicy: 'ask_user' });
      const policy = new ToolPermissionPolicy(repo);

      const result = policy.evaluate('role-1', {
        toolCallId: 'tc-8',
        title: 'Edit file',
        kind: 'edit',
      });

      expect(result.allowed).toBe(true);
    });
  });
});
