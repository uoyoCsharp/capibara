import { injectable, inject } from 'tsyringe';
import type { ISessionRepository } from '@main/core/interfaces/i-session.repository.js';
import type { ISessionMessageRepository } from '@main/core/interfaces/i-session-message.repository.js';
import type { IEventBus } from '@main/core/interfaces/i-event-bus.js';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { Session, SessionMessage, SessionType } from '@main/core/types/session.types.js';
import {
  SESSION_REPO_TOKEN,
  SESSION_MESSAGE_REPO_TOKEN,
  EVENT_BUS_TOKEN,
  LOGGER_TOKEN,
} from '@main/core/tokens.js';

/**
 * Manages Session entity lifecycle. Sessions represent human-AI conversations
 * that are independent of the Task system.
 *
 * See architecture-session-layer.md §5 (ADR-SESSION-01).
 */
@injectable()
export class SessionService {
  constructor(
    @inject(SESSION_REPO_TOKEN) private readonly sessionRepo: ISessionRepository,
    @inject(SESSION_MESSAGE_REPO_TOKEN) private readonly messageRepo: ISessionMessageRepository,
    @inject(EVENT_BUS_TOKEN) private readonly eventBus: IEventBus,
    @inject(LOGGER_TOKEN) private readonly logger: ILogger,
  ) {}

  /**
   * Create a new session and store the initial human message.
   */
  async startSession(
    orgId: string,
    type: SessionType,
    roleId: string,
    initialMessage: string,
  ): Promise<Session> {
    const session = await this.sessionRepo.create({ orgId, roleId, type });

    await this.messageRepo.create({
      sessionId: session.id,
      authorType: 'human',
      content: initialMessage,
    });

    this.logger.info('Session created', { sessionId: session.id, orgId, type, roleId });

    this.eventBus.emit({
      type: 'session:created',
      timestamp: new Date().toISOString(),
      payload: { sessionId: session.id, orgId, sessionType: type, roleId },
    });

    return session;
  }

  /**
   * Find the active session for an org and type, or null.
   */
  async getActiveSession(orgId: string, type: SessionType): Promise<Session | null> {
    return this.sessionRepo.findActiveByOrgAndType(orgId, type);
  }

  /**
   * Get a session by ID.
   */
  async getSession(sessionId: string): Promise<Session | null> {
    return this.sessionRepo.findById(sessionId);
  }

  /**
   * Get all messages for a session, ordered by creation time.
   */
  async getSessionMessages(sessionId: string): Promise<SessionMessage[]> {
    return this.messageRepo.findBySessionId(sessionId);
  }

  /**
   * Add a message to a session.
   */
  async addMessage(
    sessionId: string,
    authorType: 'human' | 'ai' | 'system',
    content: string,
  ): Promise<SessionMessage> {
    const message = await this.messageRepo.create({ sessionId, authorType, content });

    this.eventBus.emit({
      type: 'session:message-added',
      timestamp: new Date().toISOString(),
      payload: { sessionId, authorType, messageId: message.id },
    });

    return message;
  }

  /**
   * Mark a session as completed. Idempotent.
   */
  async completeSession(sessionId: string): Promise<void> {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session || session.status !== 'active') return;

    await this.sessionRepo.updateStatus(sessionId, 'completed');
    this.logger.info('Session completed', { sessionId });

    this.eventBus.emit({
      type: 'session:completed',
      timestamp: new Date().toISOString(),
      payload: { sessionId, orgId: session.orgId },
    });
  }

  /**
   * Cancel a session. Idempotent.
   */
  async cancelSession(sessionId: string): Promise<void> {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session || session.status !== 'active') return;

    await this.sessionRepo.updateStatus(sessionId, 'cancelled');
    this.logger.info('Session cancelled', { sessionId });

    this.eventBus.emit({
      type: 'session:cancelled',
      timestamp: new Date().toISOString(),
      payload: { sessionId, orgId: session.orgId },
    });
  }

  /**
   * Switch the AI role for a session. Resets cliSessionId since
   * the conversation context changes with a different persona.
   */
  async switchRole(sessionId: string, newRoleId: string): Promise<void> {
    await this.sessionRepo.updateRoleId(sessionId, newRoleId);
    // Reset CLI session — new role means new conversation context
    await this.sessionRepo.updateCliSessionId(sessionId, '');

    // Insert system marker so phase detection resets after role switch
    await this.messageRepo.create({
      sessionId,
      authorType: 'system',
      content: `__role_switched:${newRoleId}`,
    });

    this.logger.info('Session role switched', { sessionId, newRoleId });
  }

  /**
   * Count AI messages in a session (for phase detection).
   */
  async countAiMessages(sessionId: string): Promise<number> {
    const messages = await this.messageRepo.findBySessionId(sessionId);
    return messages.filter((m) => m.authorType === 'ai').length;
  }
}
