/**
 * Progress Query Service - Provides progress feedback for pipelines
 * @module application/progress/progress-query-service
 */

import { inject, injectable } from 'tsyringe';
import type { IExecutionLogStore } from '../../core/interfaces/execution-log-store.interface.js';
import type { IArtifactStore } from '../../core/interfaces/artifact-store.interface.js';
import type { IStateStore } from '../../core/interfaces/state-store.interface.js';
import type {
  ExecutionLogEntry,
} from '../../core/types/execution-log.types.js';
import type {
  InteractionRecord,
  PipelineStatus,
  Phase,
} from '../../core/types/index.js';
import type { Logger } from 'pino';
import {
  EXECUTION_LOG_STORE_TOKEN,
  ARTIFACT_STORE_TOKEN,
  STATE_STORE_TOKEN,
  LOGGER_TOKEN,
} from '../../tokens.js';

export interface PipelineProgress {
  pipelineId: string;
  changeId: string;
  status: PipelineStatus;
  currentPhase: Phase;
  completedPhases: Phase[];
  /** Total rounds across all phases */
  totalRounds: number;
  /** Current round in current phase */
  currentRound: number;
  /** Execution logs (recent, limited) */
  recentLogs: ExecutionLogEntry[];
  /** Phase artifacts (truncated preview) */
  artifacts: Array<{ phase: Phase; preview: string }>;
  /** Cost summary */
  costSummary: { total: number; byPhase: Record<string, number> };
  /** Timestamps */
  startedAt: string;
  updatedAt: string;
}

export interface IProgressQueryService {
  /** Get current progress for pipeline */
  getProgress(pipelineId: string): Promise<PipelineProgress | null>;

  /** Get interaction history for human intervention context */
  getInteractionHistory(
    pipelineId: string,
    phase: Phase,
    count: number,
  ): Promise<InteractionRecord[]>;

  /** Get latest worker output for a phase */
  getLatestOutput(pipelineId: string, phase: Phase): Promise<string | null>;
}

/** Maximum preview size for artifacts */
const MAX_PREVIEW_SIZE = 500;

@injectable()
export class ProgressQueryService implements IProgressQueryService {
  constructor(
    @inject(EXECUTION_LOG_STORE_TOKEN) private logStore: IExecutionLogStore,
    @inject(ARTIFACT_STORE_TOKEN) private artifactStore: IArtifactStore,
    @inject(STATE_STORE_TOKEN) private stateStore: IStateStore,
    @inject(LOGGER_TOKEN) private logger: Logger,
  ) {}

  async getProgress(pipelineId: string): Promise<PipelineProgress | null> {
    // Load pipeline state
    const state = await this.stateStore.load(pipelineId);
    if (!state) {
      this.logger.warn({ pipelineId }, 'Pipeline state not found');
      return null;
    }

    // Get recent logs
    const recentLogs = await this.logStore.getLogsByPipeline(pipelineId, 20);

    // Get artifact previews
    const artifacts = await this.getArtifactPreviews(state.changeId, state.context.artifacts);

    // Calculate cost summary
    const costSummary = this.calculateCostSummary(recentLogs);

    // Find started timestamp
    const startedLog = recentLogs.find((log) => log.eventType === 'pipeline:started');
    const startedAt = startedLog?.timestamp ?? state.metadata.createdAt;

    return {
      pipelineId: state.id,
      changeId: state.changeId,
      status: state.metadata.status,
      currentPhase: state.currentPhase,
      completedPhases: state.context.artifacts
        ? (Object.keys(state.context.artifacts) as Phase[])
        : [],
      totalRounds: this.calculateTotalRounds(recentLogs),
      currentRound: state.phaseAttempts[state.currentPhase] ?? 0,
      recentLogs,
      artifacts,
      costSummary,
      startedAt,
      updatedAt: state.metadata.updatedAt,
    };
  }

  async getInteractionHistory(
    pipelineId: string,
    phase: Phase,
    count: number,
  ): Promise<InteractionRecord[]> {
    // W2 fix: Read directly from persisted state instead of rebuilding from logs
    const state = await this.stateStore.load(pipelineId);
    if (!state || !state.context.interactionHistory) {
      return [];
    }

    // Filter by phase if specified, then return most recent N records
    const filtered = state.context.interactionHistory.filter(
      (record) => record.phase === phase,
    );

    return filtered.slice(0, count);
  }

  async getLatestOutput(pipelineId: string, phase: Phase): Promise<string | null> {
    const logs = await this.logStore.query({
      pipelineId,
      phase,
      eventTypes: ['worker:completed'],
      limit: 1,
    });

    if (logs.length === 0) {
      return null;
    }

    // Get full output from artifact store if available
    const state = await this.stateStore.load(pipelineId);
    if (state) {
      const artifact = await this.artifactStore.load(state.changeId, phase);
      if (artifact) {
        return artifact.content;
      }
    }

    // Fallback to log output (may be truncated)
    return logs[0].output ?? null;
  }

  private async getArtifactPreviews(
    changeId: string,
    artifacts: Record<Phase, string>,
  ): Promise<Array<{ phase: Phase; preview: string }>> {
    const previews: Array<{ phase: Phase; preview: string }> = [];

    for (const [phase] of Object.entries(artifacts)) {
      const artifact = await this.artifactStore.load(changeId, phase as Phase);
      if (artifact) {
        previews.push({
          phase: phase as Phase,
          preview: artifact.content.slice(0, MAX_PREVIEW_SIZE) + (artifact.content.length > MAX_PREVIEW_SIZE ? '...' : ''),
        });
      }
    }

    return previews;
  }

  private calculateCostSummary(logs: ExecutionLogEntry[]): {
    total: number;
    byPhase: Record<string, number>;
  } {
    const byPhase: Record<string, number> = {};
    let total = 0;

    for (const log of logs) {
      const cost = (log.payload.cost as number) ?? 0;
      total += cost;
      byPhase[log.phase] = (byPhase[log.phase] ?? 0) + cost;
    }

    return { total, byPhase };
  }

  private calculateTotalRounds(logs: ExecutionLogEntry[]): number {
    const workerCompleted = logs.filter((log) => log.eventType === 'worker:completed');
    return workerCompleted.length;
  }
}
