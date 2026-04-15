import type { SessionMessage } from '../types/session.types.js';

export interface CreateSessionMessageInput {
  sessionId: string;
  authorType: 'human' | 'ai' | 'system';
  content: string;
}

export interface ISessionMessageRepository {
  findById(id: string): Promise<SessionMessage | null>;
  findBySessionId(sessionId: string): Promise<SessionMessage[]>;
  create(input: CreateSessionMessageInput): Promise<SessionMessage>;
  countBySessionId(sessionId: string): Promise<number>;
}
