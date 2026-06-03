import type { IRoleRepository } from '@core/modules/organization/interfaces/i-role.repository';

export type ToolPolicyMode = 'permissive' | 'restrictive' | 'ask_user';

export interface ToolCallInfo {
  toolCallId: string;
  title: string;
  kind?: string;
}

export interface PolicyDecision {
  allowed: boolean;
  reason?: string;
}

interface DenyPattern {
  kind: string;
  pattern: RegExp;
}

/**
 * Tool call permission policy engine.
 * Evaluates whether a tool call should be allowed based on the Role's policy mode.
 *
 * Modes:
 *   - permissive: allow all except denylist
 *   - restrictive: deny all by default (explicit allowlist is not implemented yet)
 *   - ask_user: deny until interactive approval flow is implemented
 */
export class ToolPermissionPolicy {
  private readonly denyPatterns: DenyPattern[] = [
    { kind: 'command', pattern: /rm\s+-rf/i },
    { kind: 'command', pattern: /drop\s+table/i },
    { kind: 'command', pattern: /format\s+[a-z]:/i },
    { kind: 'command', pattern: /del\s+\/[sfq]/i },
    { kind: 'command', pattern: /rmdir\s+\/s/i },
  ];

  constructor(
    private readonly roleRepo: IRoleRepository,
  ) {}

  evaluate(roleId: string, toolCall: ToolCallInfo): PolicyDecision {
    const role = this.roleRepo.findById(roleId);
    if (!role) {
      return { allowed: false, reason: 'Role not found' };
    }

    const policy: ToolPolicyMode = (role as { toolPolicy?: ToolPolicyMode }).toolPolicy ?? 'permissive';

    switch (policy) {
      case 'permissive':
        return this.checkDenyList(toolCall);
      case 'restrictive':
        return this.checkRestrictive(toolCall);
      case 'ask_user':
        return { allowed: false, reason: 'ask_user policy is not yet supported in this build' };
    }
  }

  private checkDenyList(toolCall: ToolCallInfo): PolicyDecision {
    for (const deny of this.denyPatterns) {
      if (toolCall.kind === deny.kind && deny.pattern.test(toolCall.title)) {
        return { allowed: false, reason: `Denied by pattern: ${deny.pattern.source}` };
      }
    }
    return { allowed: true };
  }

  private checkRestrictive(toolCall: ToolCallInfo): PolicyDecision {
    const deniedByPattern = this.checkDenyList(toolCall);
    if (!deniedByPattern.allowed) {
      return deniedByPattern;
    }
    return {
      allowed: false,
      reason: 'Restrictive policy blocks tool calls unless an explicit allowlist is configured',
    };
  }
}
