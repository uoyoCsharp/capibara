/**
 * Context Builder - Builds context data needed for different roles
 * @module application/context/context-builder
 */

import { inject, injectable } from 'tsyringe';
import type { Phase } from '../../core/types/phase.types.js';
import type { PipelineContext } from '../../core/types/pipeline.types.js';
import type { IArtifactStore } from '../../core/interfaces/artifact-store.interface.js';
import { ARTIFACT_STORE_TOKEN, LOGGER_TOKEN } from '../../tokens.js';
import type { Logger } from 'pino';

@injectable()
export class ContextBuilder {
  constructor(
    @inject(ARTIFACT_STORE_TOKEN) private artifactStore: IArtifactStore,
    @inject(LOGGER_TOKEN) private logger: Logger,
  ) {}

  /**
   * Build Worker-usable context summary
   * Summarizes previous phase artifacts for Worker reference
   */
  async buildWorkerContext(context: PipelineContext): Promise<string> {
    const parts: string[] = [
      `# Requirement: ${context.requirement.title}`,
      context.requirement.description,
    ];

    // Add completed phase artifact summaries
    for (const phase of context.completedPhases) {
      const artifact = await this.artifactStore.load(context.changeId, phase);
      if (artifact) {
        parts.push(`\n## ${phase} Phase Output\n${artifact.content.slice(0, 2000)}`);
      }
    }

    return parts.join('\n\n');
  }

  /**
   * Build Evaluator evaluation context
   */
  async buildEvaluatorContext(context: PipelineContext, phase: Phase): Promise<string> {
    const artifact = await this.artifactStore.load(context.changeId, phase);
    return artifact?.content ?? '';
  }
}
