/**
 * GitHub Issues Trigger - Listens to GitHub Issues as requirement source
 * @module infrastructure/triggers/github-issues-trigger
 */

import { inject, injectable } from 'tsyringe';
import type { ITrigger } from '../../core/interfaces/trigger.interface.js';
import type { Requirement } from '../../core/types/requirement.types.js';
import { CONFIG_TOKEN, LOGGER_TOKEN } from '../../tokens.js';
import type { AutomationConfig } from '../../core/types/config.types.js';
import type { Logger } from 'pino';

@injectable()
export class GitHubIssuesTrigger implements ITrigger {
  private processedIds: Set<string> = new Set();

  constructor(
    @inject(CONFIG_TOKEN) private config: AutomationConfig,
    @inject(LOGGER_TOKEN) private logger: Logger,
  ) {}

  /**
   * Poll GitHub Issues to produce new requirements
   * Current implementation is a skeleton, will be enhanced in Phase C with Octokit
   */
  async *watch(): AsyncIterable<Requirement> {
    const githubConfig = this.config.trigger.github;
    if (!githubConfig) {
      this.logger.warn('GitHub trigger config missing');
      return;
    }

    this.logger.info(
      { owner: githubConfig.owner, repo: githubConfig.repo },
      'GitHub Issues trigger started',
    );

    // TODO: Phase C - Use Octokit to poll Issues
  }

  async acknowledge(requirementId: string): Promise<void> {
    this.processedIds.add(requirementId);
    this.logger.info({ requirementId }, 'Requirement acknowledged');
    // TODO: Phase C - Add "in-progress" label to Issue
  }

  async close(requirementId: string, status: string): Promise<void> {
    this.logger.info({ requirementId, status }, 'Requirement closed');
    // TODO: Phase C - Close Issue and add comment
  }
}
