/**
 * Worker Session Manager - Manages Worker's CLI persistent session lifecycle
 * @module application/context/session-manager
 */

import { inject, injectable } from 'tsyringe';
import { LOGGER_TOKEN } from '../../tokens.js';
import type { Logger } from 'pino';

/**
 * Worker uses persistent sessions (--session-id) to maintain context across multiple phases.
 * This manager handles session ID generation and phase binding.
 */
@injectable()
export class SessionManager {
  private sessions: Map<string, SessionInfo> = new Map();

  constructor(@inject(LOGGER_TOKEN) private logger: Logger) {}

  /** Create Worker session for Pipeline */
  createSession(changeId: string): string {
    const sessionId = crypto.randomUUID();
    this.sessions.set(sessionId, {
      sessionId,
      changeId,
      createdAt: new Date().toISOString(),
      lastUsedPhase: undefined,
    });
    this.logger.debug({ sessionId, changeId }, 'Session created');
    return sessionId;
  }

  /** Update session's last used phase */
  updatePhase(sessionId: string, phase: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastUsedPhase = phase;
    }
  }

  /** Get session info */
  getSession(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  /** Clean up session */
  removeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.logger.debug({ sessionId }, 'Session removed');
  }
}

interface SessionInfo {
  sessionId: string;
  changeId: string;
  createdAt: string;
  lastUsedPhase?: string;
}
