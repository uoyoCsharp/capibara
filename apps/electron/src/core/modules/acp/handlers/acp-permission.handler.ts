import type * as acp from '@agentclientprotocol/sdk';
import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { ToolPermissionPolicy, ToolCallInfo } from '../policies/tool-permission.policy';

export interface PermissionSessionContext {
  roleId: string;
  orgId: string;
}

export interface ToolCallLogEntry {
  sessionId: string;
  runId: string | null;
  toolCallId: string;
  title: string;
  kind: string | undefined;
  permission: 'allowed' | 'rejected';
}

/**
 * Handles Agent permission requests (session/request_permission).
 * Evaluates tool calls against the ToolPermissionPolicy engine.
 */
export class AcpPermissionHandler {
  private toolPolicy: ToolPermissionPolicy | null = null;
  private readonly toolCallLog: ToolCallLogEntry[] = [];

  constructor(
    private readonly logger: ILogger,
  ) {}

  /**
   * Set the tool permission policy (injected after module initialization).
   */
  setToolPolicy(policy: ToolPermissionPolicy): void {
    this.toolPolicy = policy;
  }

  handlePermissionRequest(
    request: acp.RequestPermissionRequest,
    context?: PermissionSessionContext,
    sessionId?: string,
    runId?: string | null,
  ): acp.RequestPermissionResponse {
    const { toolCall, options } = request;

    const toolCallInfo: ToolCallInfo = {
      toolCallId: toolCall.toolCallId ?? '',
      title: toolCall.title ?? '',
      kind: toolCall.kind ?? undefined,
    };

    // Evaluate against policy if available and context is provided
    if (this.toolPolicy && context) {
      const decision = this.toolPolicy.evaluate(context.roleId, toolCallInfo);

      this.logger.info('Permission decision', {
        roleId: context.roleId,
        toolCallId: toolCall.toolCallId,
        title: toolCall.title,
        kind: toolCall.kind,
        decision: decision.allowed ? 'allow' : 'reject',
        reason: decision.reason,
      });

      // Record audit log entry
      this.toolCallLog.push({
        sessionId: sessionId ?? '',
        runId: runId ?? null,
        toolCallId: toolCall.toolCallId ?? '',
        title: toolCall.title ?? '',
        kind: toolCall.kind ?? undefined,
        permission: decision.allowed ? 'allowed' : 'rejected',
      });

      if (decision.allowed) {
        const allowOption = options.find(o => o.kind === 'allow_once');
        if (allowOption) {
          return { outcome: { outcome: 'selected', optionId: allowOption.optionId } };
        }
      } else {
        const rejectOption = options.find(o => o.kind === 'reject_once');
        if (rejectOption) {
          return { outcome: { outcome: 'selected', optionId: rejectOption.optionId } };
        }
      }
    } else {
      // Fallback: permissive auto-allow when no policy or context
      this.logger.info('Permission request (auto-allow, no policy)', {
        toolCallId: toolCall.toolCallId,
        title: toolCall.title,
        kind: toolCall.kind,
      });
    }

    // Default: allow
    const allowOption = options.find(o => o.kind === 'allow_once');
    if (allowOption) {
      return { outcome: { outcome: 'selected', optionId: allowOption.optionId } };
    }

    // Absolute fallback: select first option
    return { outcome: { outcome: 'selected', optionId: options[0].optionId } };
  }

  /**
   * Get collected tool call log entries (for audit persistence).
   */
  drainToolCallLog(): ToolCallLogEntry[] {
    return this.toolCallLog.splice(0);
  }
}
