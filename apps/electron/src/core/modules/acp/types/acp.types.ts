/**
 * ACP protocol type definitions.
 * Wraps external types from @agentclientprotocol/sdk and provides internal business types.
 */

import type * as schema from '@agentclientprotocol/sdk';

export type { LifecycleIntent } from '@core/modules/execution/types/execution.types';

// ── Agent Configuration ──────────────────────────────────

export type McpTransportType = 'sse' | 'http';

export interface AgentRegistryEntry {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  capabilities?: {
    supportsResume?: boolean;
    supportsLoad?: boolean;
  };
  /** Preferred MCP transport protocol. 'sse' for broad compatibility (Claude Code), 'http' for Streamable HTTP (newer clients). Defaults to 'sse'. */
  mcpTransport?: McpTransportType;
}

export interface AgentRegistryConfig {
  defaultAgent: string;
  registry: AgentRegistryEntry[];
  globalFilePolicy: {
    denyPatterns: string[];
  };
}

export interface CollaborationConfig {
  maxChainDepth: number;
  maxBroadcastTargets: number;
  maxResumeCount: number;
  inquiryTimeoutMs: number;
  /**
   * Idle suspension TTL (ms). Idle planning sessions older than this are expired by the sweeper.
   * Optional until the sweeper (and its config plumbing) lands; defaults applied by consumers.
   */
  sessionTtlMs?: number;
  /**
   * Absolute liveness cap (ms) for collaboration suspensions, which are otherwise idle-TTL exempt.
   * Optional until the sweeper lands; defaults applied by consumers.
   */
  collaborationCapMs?: number;
}

// ── Model Selection ──────────────────────────────────────

/**
 * How the active agent exposes model selection over ACP (ADR-1). Detected per session from the
 * `session/new` response: a `configOptions` entry with `category: 'model'` (preferred, stable) or
 * the dedicated `models` field (`SessionModelState`, experimental). `null` ⇒ unsupported.
 */
export type AgentModelMechanism = 'config_option' | 'set_model';

/** A model the active agent advertises as selectable. */
export interface AvailableModel {
  /** modelId (set_model mechanism) or config option value id (config_option mechanism). */
  id: string;
  name: string;
  description?: string;
}

/**
 * Normalized, mechanism-agnostic view of an agent's model selection state, derived from the
 * `session/new` response by {@link normalizeModelState}. `models` empty ⇒ selection unsupported.
 */
export interface ModelState {
  models: AvailableModel[];
  /** The model the agent reports as currently active for the session. */
  currentModelId: string | null;
  mechanism: AgentModelMechanism | null;
  /** The `configOptions` id to set; present only when `mechanism === 'config_option'`. */
  configId?: string;
}

/** Renderer-facing model state: the agent-advertised list merged with the user's stored preference. */
export interface ModelStateSummary {
  /** Whether the active agent advertises any selectable model (`models.length > 0`). */
  supported: boolean;
  models: AvailableModel[];
  /** The model the agent reports as currently active. */
  currentModelId: string | null;
  /** The user's persisted default-model preference. */
  selectedModelId: string | null;
}

// ── Agent Process ────────────────────────────────────────

export interface AgentCapabilities {
  supportsResume: boolean;
  supportsLoad: boolean;
  /** Whether the agent advertises `sessionCapabilities.list` (session/list discovery). */
  supportsList: boolean;
  supportedMcpTransports: ('stdio' | 'sse')[];
}

export interface AgentProcess {
  agentId: string;
  child: import('node:child_process').ChildProcess;
  exited: boolean;
  capabilities: AgentCapabilities | null;
  connection: schema.ClientSideConnection | null;
}

// ── ACP Session ──────────────────────────────────────────

export type AcpSessionStatus = 'active' | 'suspended' | 'closed' | 'expired';

/**
 * Why a session was suspended. Drives lifecycle policy:
 * - 'idle'          — planning session waiting for the user; subject to idle TTL.
 * - 'collaboration' — waiting for another AI's reply; TTL-exempt (liveness bound to
 *                     the awaiting records), guarded only by an absolute cap.
 */
export type SuspendReason = 'idle' | 'collaboration';

/** Why a session was closed (persisted for diagnostics; replaces the old 'error' status). */
export type CloseReason = 'completed' | 'user_closed' | 'expired' | 'error' | 'cancelled' | 'shutdown';

/**
 * Lean, persistable view of a session's lifecycle owned by Capibara. The agent process
 * remains the source of truth for session *history content* (retrieved via session/load),
 * so derivable fields (cwd, mcpServers, allowedPaths, capabilities) are intentionally NOT
 * stored here — they are re-derived from role+org config on rebuild.
 */
export interface AcpSessionRecord {
  id: string;
  acpSessionId: string;
  agentId: string;
  roleId: string;
  orgId: string;
  runId: string | null;
  /** Planning binding (supersedes conversation.externalSessionId as the source of truth). */
  conversationId: string | null;
  taskId: string | null;
  status: AcpSessionStatus;
  suspendReason: SuspendReason | null;
  resumeStrategy: 'resume' | 'load' | 'rebuild';
  resumeCount: number;
  /** Last prompt/resume activity; drives idle-TTL sweeping. */
  lastActivityAt: string;
  createdAt: string;
  closedAt: string | null;
  closeReason: CloseReason | null;
}

export interface AcpSession {
  id: string;
  acpSessionId: string;
  agentId: string;
  roleId: string;
  orgId: string;
  runId: string | null;
  status: AcpSessionStatus;
  cwd: string;
  allowedPaths: string[] | null;
  capabilities: AgentCapabilities;
  resumeStrategy: 'resume' | 'load' | 'rebuild';
  resumeCount: number;
  mcpServers: schema.McpServer[];
  createdAt: string;
  closedAt: string | null;
}

export interface CreateSessionParams {
  agentId: string;
  roleId: string;
  orgId: string;
  runId: string;
  taskId?: string;
  conversationId?: string;
  cwd: string;
  mcpServers: schema.McpServer[];
  allowedPaths?: string[];
}

// ── Prompt ───────────────────────────────────────────────

export type PromptContent = schema.ContentBlock & { type: string };

export interface PromptResult {
  stopReason: schema.StopReason;
  textOutput: string;
  tokensUsed: {
    input: number;
    output: number;
    cached: number;
  };
}

// ── Callback Types ───────────────────────────────────────

export type LogCallback = (stream: 'stdout' | 'stderr', chunk: string) => void;
export type TextCallback = (text: string) => void;
export type SessionUpdateCallback = (update: schema.SessionUpdate) => void;
