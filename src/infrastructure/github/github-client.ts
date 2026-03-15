/**
 * GitHub Client Wrapper (reserved, Phase C implementation)
 * @module infrastructure/github/github-client
 */

import { inject, injectable } from 'tsyringe';
import { CONFIG_TOKEN, LOGGER_TOKEN } from '../../tokens.js';
import type { AutomationConfig } from '../../core/types/config.types.js';
import type { Logger } from 'pino';

/**
 * GitHub API Client
 * Current implementation is skeleton, will be enhanced in Phase C with Octokit
 */
@injectable()
export class GitHubClient {
  constructor(
    @inject(CONFIG_TOKEN) private config: AutomationConfig,
    @inject(LOGGER_TOKEN) private logger: Logger,
  ) {}

  /** Get Issues with specified labels */
  async getIssuesWithLabels(labels: string[]): Promise<GitHubIssue[]> {
    // TODO: Implement with Octokit
    this.logger.warn('GitHubClient.getIssuesWithLabels not implemented');
    return [];
  }

  /** Add label to Issue */
  async addLabel(issueNumber: number, label: string): Promise<void> {
    this.logger.warn({ issueNumber, label }, 'GitHubClient.addLabel not implemented');
  }

  /** Close Issue */
  async closeIssue(issueNumber: number, comment?: string): Promise<void> {
    this.logger.warn({ issueNumber }, 'GitHubClient.closeIssue not implemented');
  }
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  createdAt: string;
}
