/**
 * ACP protocol type definitions.
 * Wraps external types from @agentclientprotocol/sdk and provides internal business types.
 */

import type * as schema from '@agentclientprotocol/sdk';

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
}

// ── Agent Process ────────────────────────────────────────

export interface AgentCapabilities {
  supportsResume: boolean;
  supportsLoad: boolean;
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

export type AcpSessionStatus = 'active' | 'suspended' | 'closed' | 'error';

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
