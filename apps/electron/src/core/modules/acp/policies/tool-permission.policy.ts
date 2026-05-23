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
 *   - restrictive: deny all except allowlist (fallback to permissive for now)
 *   - ask_user: deferred to permissive (UI not yet available)
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
        return this.checkAllowList(roleId, toolCall);
      case 'ask_user':
        // Not yet implemented — fallback to permissive
        return this.checkDenyList(toolCall);
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

  private checkAllowList(_roleId: string, toolCall: ToolCallInfo): PolicyDecision {
    // TODO: Read allowlist from Role config once schema supports it
    // Fallback to permissive (denylist only) for now
    return this.checkDenyList(toolCall);
  }
}
