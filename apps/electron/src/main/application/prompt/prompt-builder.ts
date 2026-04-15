import { injectable } from 'tsyringe';
import type { IPromptBuilder, PromptContext, SessionPromptContext } from '@main/core/interfaces/i-prompt-builder.js';
import { SessionPromptStrategy } from './session-prompt-strategy.js';
import { TaskPromptStrategy } from './task-prompt-strategy.js';

/**
 * Scenario-driven prompt builder. Constructs the system prompt for Agent execution.
 * Delegates to dedicated strategies for session vs task prompt construction.
 * See Architecture §7.4 — Prompt Construction (ADR-02).
 */
@injectable()
export class PromptBuilder implements IPromptBuilder {
  private readonly sessionStrategy = new SessionPromptStrategy();
  private readonly taskStrategy = new TaskPromptStrategy();

  buildForSession(context: SessionPromptContext): string {
    return this.sessionStrategy.build(context);
  }

  build(context: PromptContext): string {
    return this.taskStrategy.build(context);
  }
}
