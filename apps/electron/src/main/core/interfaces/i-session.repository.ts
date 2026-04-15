import type { Session, SessionStatus, SessionType } from '../types/session.types.js';

export interface CreateSessionInput {
  orgId: string;
  roleId: string;
  type: SessionType;
  metadata?: Record<string, unknown>;
}

export interface ISessionRepository {
  findById(id: string): Promise<Session | null>;
  findActiveByOrgAndType(orgId: string, type: SessionType): Promise<Session | null>;
  findByOrgId(orgId: string): Promise<Session[]>;
  create(input: CreateSessionInput): Promise<Session>;
  updateStatus(id: string, status: SessionStatus): Promise<void>;
  updateCliSessionId(id: string, cliSessionId: string): Promise<void>;
  updateRoleId(id: string, roleId: string): Promise<void>;
  updateMetadata(id: string, metadata: Record<string, unknown>): Promise<void>;
}
