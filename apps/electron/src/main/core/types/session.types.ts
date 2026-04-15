// ─── Session Types ──────────────────────────────────────────────────

export type SessionType = 'planning' | 'adhoc';
export type SessionStatus = 'active' | 'completed' | 'cancelled';

// ─── Session Entities ──────────────────────────────────────────────

export interface Session {
  id: string;
  orgId: string;
  roleId: string;
  type: SessionType;
  status: SessionStatus;
  /** claude-cli --resume session ID; null until first AI response */
  cliSessionId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SessionMessage {
  id: string;
  sessionId: string;
  authorType: 'human' | 'ai' | 'system';
  content: string;
  createdAt: string;
}
