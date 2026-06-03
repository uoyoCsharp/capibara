import type { ILogger } from '@core/foundation/interfaces/i-logger';
import type { ISuspensionRepository } from '../interfaces/i-suspension.repository';
import type { ISessionSuspensionManager } from '../interfaces/i-session-suspension.manager';
import type { CollaborationConfig } from '../types/acp.types';
import type { SessionSuspension, SuspendParams, ResumeDecision } from './suspension.types';
import { InquiryAggregator } from './inquiry-aggregator';
import { ChainDepthGuard } from './chain-depth.guard';

/**
 * Core collaboration component.
 * Manages session suspension/resume lifecycle for AI↔AI inquiries.
 *
 * Phase 3a: basic single-target suspend + resume.
 * Phase 3b: chain depth tracking, broadcast support, circular detection.
 */
export class SessionSuspensionManager implements ISessionSuspensionManager {
  private readonly aggregator = new InquiryAggregator();
  private readonly chainGuard: ChainDepthGuard;

  constructor(
    private readonly suspensionRepo: ISuspensionRepository,
    private readonly logger: ILogger,
    private readonly config: CollaborationConfig = {
      maxChainDepth: 5,
      maxBroadcastTargets: 5,
      maxResumeCount: 10,
      inquiryTimeoutMs: 300_000,
    },
  ) {
    this.chainGuard = new ChainDepthGuard(suspensionRepo, config.maxChainDepth);
  }

  suspend(params: SuspendParams): SessionSuspension {
    const { sessionId, acpSessionId, runId, roleId, orgId, taskId, awaitingInquiries, aggregationMode } = params;

    // Auto-detect parent suspension: is there an active suspension waiting for this role?
    let parentSuspensionId = params.parentSuspensionId ?? null;
    let chainDepth = 0;

    if (!parentSuspensionId) {
      const parentSuspension = this.suspensionRepo.findSuspensionAwaitingRole(roleId, orgId);
      if (parentSuspension) {
        parentSuspensionId = parentSuspension.id;
        chainDepth = parentSuspension.chainDepth + 1;
      }
    } else {
      const parent = this.suspensionRepo.findById(parentSuspensionId);
      chainDepth = parent ? parent.chainDepth + 1 : 0;
    }

    // Enforce max chain depth
    if (chainDepth >= this.config.maxChainDepth) {
      throw new Error(
        `Chain depth ${chainDepth} exceeds max ${this.config.maxChainDepth}`,
      );
    }

    const suspension = this.suspensionRepo.createSuspension({
      sessionId,
      acpSessionId,
      runId,
      roleId,
      orgId,
      taskId,
      aggregationMode,
      parentSuspensionId,
      chainDepth,
    });

    for (const inquiry of awaitingInquiries) {
      this.suspensionRepo.createAwaiting({
        suspensionId: suspension.id,
        conversationId: inquiry.conversationId,
        respondentRoleId: inquiry.respondentRoleId,
      });
    }

    this.logger.info('Session suspended', {
      suspensionId: suspension.id,
      sessionId,
      runId,
      chainDepth,
      parentSuspensionId,
      awaitingCount: awaitingInquiries.length,
    });

    return suspension;
  }

  onInquiryResolved(conversationId: string, response: string): ResumeDecision | null {
    // Find the suspension that is waiting for this conversation
    const suspension = this.suspensionRepo.findByConversationId(conversationId);
    if (!suspension || suspension.status !== 'suspended') return null;

    // Get all awaiting entries for this suspension
    const awaitingList = this.suspensionRepo.findAwaitingBySuspensionId(suspension.id);
    const target = awaitingList.find(a => a.conversationId === conversationId);
    if (!target || target.status === 'resolved') return null;

    // Mark this inquiry as resolved
    const nowIso = new Date().toISOString();
    this.suspensionRepo.updateAwaitingStatus(
      target.id,
      'resolved',
      response,
      nowIso,
    );

    // Refresh awaiting list to check completion
    const refreshedList = this.suspensionRepo.findAwaitingBySuspensionId(suspension.id);
    const updatedList = this.applyAggregationTimeoutIfNeeded(suspension, refreshedList, nowIso);
    const isReady = suspension.aggregationMode === 'all'
      ? updatedList.every((a) => a.status === 'resolved' || a.status === 'timed_out')
      : updatedList.some(a => a.status === 'resolved');

    if (!isReady) {
      this.logger.info('Inquiry resolved but suspension not ready', {
        suspensionId: suspension.id,
        resolved: updatedList.filter(a => a.status === 'resolved').length,
        total: updatedList.length,
      });
      return null;
    }

    // All conditions met — prepare resume decision
    const aggregatedReply = this.aggregator.buildAggregatedReply(updatedList);
    this.suspensionRepo.updateSuspensionStatus(
      suspension.id,
      'resumed',
      new Date().toISOString(),
    );

    this.logger.info('Session ready to resume', {
      suspensionId: suspension.id,
      sessionId: suspension.sessionId,
    });

    return {
      suspensionId: suspension.id,
      sessionId: suspension.sessionId,
      acpSessionId: suspension.acpSessionId,
      runId: suspension.runId,
      roleId: suspension.roleId,
      orgId: suspension.orgId,
      taskId: suspension.taskId,
      aggregatedReply,
    };
  }

  findSuspensionByInquiry(conversationId: string): SessionSuspension | null {
    return this.suspensionRepo.findByConversationId(conversationId);
  }

  findActiveByRole(roleId: string, orgId: string): SessionSuspension | null {
    return this.suspensionRepo.findActiveByRole(roleId, orgId);
  }

  findSuspensionAwaitingRole(roleId: string, orgId: string): SessionSuspension | null {
    return this.suspensionRepo.findSuspensionAwaitingRole(roleId, orgId);
  }

  getChainDepth(orgId: string, fromRoleId: string): number {
    return this.chainGuard.validateDepth(orgId, fromRoleId).currentDepth;
  }

  private applyAggregationTimeoutIfNeeded(
    suspension: SessionSuspension,
    awaitingList: ReturnType<ISuspensionRepository['findAwaitingBySuspensionId']>,
    nowIso: string,
  ): ReturnType<ISuspensionRepository['findAwaitingBySuspensionId']> {
    if (suspension.aggregationMode !== 'all') {
      return awaitingList;
    }

    const suspendedAt = Date.parse(suspension.suspendedAt);
    const now = Date.parse(nowIso);
    if (Number.isNaN(suspendedAt) || Number.isNaN(now)) {
      return awaitingList;
    }

    if (now - suspendedAt < this.config.inquiryTimeoutMs) {
      return awaitingList;
    }

    let timedOutCount = 0;
    const updated = awaitingList.map((awaiting) => {
      if (awaiting.status !== 'pending' && awaiting.status !== 'in_progress') {
        return awaiting;
      }

      this.suspensionRepo.updateAwaitingStatus(awaiting.id, 'timed_out', undefined, nowIso);
      timedOutCount += 1;
      return {
        ...awaiting,
        status: 'timed_out' as const,
        resolvedAt: nowIso,
      };
    });

    if (timedOutCount > 0) {
      this.logger.warn('Aggregation timeout reached for suspended session; pending inquiries marked timed_out', {
        suspensionId: suspension.id,
        timeoutMs: this.config.inquiryTimeoutMs,
        timedOutCount,
      });
    }

    return updated;
  }
}
