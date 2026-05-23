import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AcpPermissionHandler } from '@core/modules/acp/handlers/acp-permission.handler';
import { ToolPermissionPolicy } from '@core/modules/acp/policies/tool-permission.policy';
import type { IRoleRepository } from '@core/modules/organization/interfaces/i-role.repository';
import { MockLogger } from '../../helpers/mock-logger';

describe('AcpPermissionHandler', () => {
  let handler: AcpPermissionHandler;
  let logger: MockLogger;

  beforeEach(() => {
    logger = new MockLogger();
    handler = new AcpPermissionHandler(logger);
  });

  it('should auto-allow with allow_once option when available', () => {
    const request = {
      toolCall: {
        toolCallId: 'tc-1',
        title: 'Write file',
        kind: 'file_write',
      },
      options: [
        { optionId: 'opt-deny', kind: 'deny' },
        { optionId: 'opt-allow', kind: 'allow_once' },
        { optionId: 'opt-always', kind: 'allow_always' },
      ],
    } as any;

    const result = handler.handlePermissionRequest(request);

    expect(result.outcome.outcome).toBe('selected');
    expect(result.outcome.optionId).toBe('opt-allow');
  });

  it('should fallback to first option when allow_once is not available', () => {
    const request = {
      toolCall: {
        toolCallId: 'tc-2',
        title: 'Execute command',
        kind: 'shell_execute',
      },
      options: [
        { optionId: 'opt-first', kind: 'deny' },
        { optionId: 'opt-second', kind: 'allow_always' },
      ],
    } as any;

    const result = handler.handlePermissionRequest(request);

    expect(result.outcome.outcome).toBe('selected');
    expect(result.outcome.optionId).toBe('opt-first');
  });

  it('should log permission request info', () => {
    const request = {
      toolCall: {
        toolCallId: 'tc-3',
        title: 'Delete file',
        kind: 'file_delete',
      },
      options: [
        { optionId: 'opt-1', kind: 'allow_once' },
      ],
    } as any;

    handler.handlePermissionRequest(request);

    expect(logger.logs).toHaveLength(1);
    expect(logger.logs[0].level).toBe('info');
    expect(logger.logs[0].msg).toBe('Permission request (auto-allow, no policy)');
    expect(logger.logs[0].data).toMatchObject({
      toolCallId: 'tc-3',
      title: 'Delete file',
      kind: 'file_delete',
    });
  });

  describe('with ToolPermissionPolicy', () => {
    let roleRepo: IRoleRepository;

    beforeEach(() => {
      roleRepo = {
        findById: vi.fn().mockReturnValue({ id: 'role-1', toolPolicy: 'permissive' }),
        findByIds: vi.fn(),
        findByOrgId: vi.fn(),
        findChildren: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      } as any;

      const policy = new ToolPermissionPolicy(roleRepo);
      handler.setToolPolicy(policy);
    });

    it('should allow safe operations via policy', () => {
      const request = {
        toolCall: { toolCallId: 'tc-10', title: 'Read file', kind: 'read' },
        options: [{ optionId: 'opt-allow', kind: 'allow_once' }],
      } as any;

      const result = handler.handlePermissionRequest(
        request,
        { roleId: 'role-1', orgId: 'org-1' },
        'sess-1',
        'run-1',
      );

      expect(result.outcome.optionId).toBe('opt-allow');
    });

    it('should reject dangerous operations via policy', () => {
      const request = {
        toolCall: { toolCallId: 'tc-11', title: 'rm -rf /', kind: 'command' },
        options: [
          { optionId: 'opt-allow', kind: 'allow_once' },
          { optionId: 'opt-reject', kind: 'reject_once' },
        ],
      } as any;

      const result = handler.handlePermissionRequest(
        request,
        { roleId: 'role-1', orgId: 'org-1' },
        'sess-1',
        'run-1',
      );

      expect(result.outcome.optionId).toBe('opt-reject');
    });

    it('should record tool call log entries', () => {
      const request = {
        toolCall: { toolCallId: 'tc-12', title: 'Edit file', kind: 'edit' },
        options: [{ optionId: 'opt-allow', kind: 'allow_once' }],
      } as any;

      handler.handlePermissionRequest(request, { roleId: 'role-1', orgId: 'org-1' }, 'sess-1', 'run-1');

      const logs = handler.drainToolCallLog();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        sessionId: 'sess-1',
        runId: 'run-1',
        toolCallId: 'tc-12',
        title: 'Edit file',
        kind: 'edit',
        permission: 'allowed',
      });
    });

    it('should drain tool call log only once', () => {
      const request = {
        toolCall: { toolCallId: 'tc-13', title: 'Read', kind: 'read' },
        options: [{ optionId: 'opt-allow', kind: 'allow_once' }],
      } as any;

      handler.handlePermissionRequest(request, { roleId: 'role-1', orgId: 'org-1' }, 'sess-1', null);
      handler.drainToolCallLog();
      const secondDrain = handler.drainToolCallLog();
      expect(secondDrain).toHaveLength(0);
    });
  });
});
