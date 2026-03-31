#!/usr/bin/env node
// MCP bridge entry point — spawned by Claude Code CLI as an MCP server.
// Communicates with Claude Code CLI via JSON-RPC 2.0 over stdin/stdout.
// Relays tool calls to the main Electron process via local HTTP.
// See Architecture §7.2 — MCP Server Bridge (ADR-04).

import { request as httpRequest } from 'node:http';
import { createInterface } from 'node:readline';

export const MCP_BRIDGE_VERSION = '0.1.0';

// ─── Parse CLI Args ─────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name: string): string {
  const prefix = `--${name}=`;
  const arg = args.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : '';
}

const runId = getArg('run-id');
const token = getArg('token');
const port = parseInt(getArg('port'), 10);

if (!runId || !token || !port) {
  process.stderr.write('Missing required args: --run-id, --token, --port\n');
  process.exit(1);
}

// ─── MCP Tool Definitions ──────────────────────────────────────────
const TOOLS = [
  {
    name: 'capibara_task_complete',
    description: 'Mark your assigned task as completed and submit results for review.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'The task ID to complete' },
        summary: { type: 'string', description: 'Summary of work done' },
        artifactPaths: { type: 'array', items: { type: 'string' }, description: 'Paths to artifacts created' },
      },
      required: ['taskId', 'summary'],
    },
  },
  {
    name: 'capibara_task_create_subtask',
    description: 'Create a subtask under the current task for delegation.',
    inputSchema: {
      type: 'object',
      properties: {
        parentTaskId: { type: 'string', description: 'Parent task ID' },
        title: { type: 'string', description: 'Subtask title' },
        description: { type: 'string', description: 'Subtask description' },
        type: { type: 'string', enum: ['task', 'subtask'], description: 'Task type' },
        assigneeRoleId: { type: 'string', description: 'Role ID to assign to (optional)' },
      },
      required: ['parentTaskId', 'title', 'description'],
    },
  },
  {
    name: 'capibara_discussion_post',
    description: 'Post a message or vote to a discussion group.',
    inputSchema: {
      type: 'object',
      properties: {
        discussionGroupId: { type: 'string', description: 'Discussion group ID' },
        authorRoleId: { type: 'string', description: 'Your role ID' },
        content: { type: 'string', description: 'Message content' },
        voteTag: { type: 'string', enum: ['APPROVE', 'REVISE', 'CONCERN', 'DELEGATE'], description: 'Optional vote tag' },
      },
      required: ['discussionGroupId', 'content'],
    },
  },
  {
    name: 'capibara_context_get_task',
    description: 'Get details about a task.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID to look up' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'capibara_context_get_discussion_summary',
    description: 'Get discussion group summary with vote stats and recent messages.',
    inputSchema: {
      type: 'object',
      properties: {
        discussionGroupId: { type: 'string', description: 'Discussion group ID' },
      },
      required: ['discussionGroupId'],
    },
  },
  {
    name: 'capibara_escalate',
    description: 'Escalate a task to your superior role.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID to escalate' },
        reason: { type: 'string', description: 'Reason for escalation' },
      },
      required: ['taskId', 'reason'],
    },
  },
];

// ─── HTTP Client to Main Process ────────────────────────────────────
function callMainProcess(toolName: string, toolArgs: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      runId,
      token,
      toolName,
      arguments: toolArgs,
    });

    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: '/tool-call',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 30000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            const result = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
            resolve(result);
          } catch (e) {
            reject(new Error('Failed to parse response from main process'));
          }
        });
      },
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request to main process timed out'));
    });
    req.write(body);
    req.end();
  });
}

// ─── JSON-RPC 2.0 Handling ──────────────────────────────────────────
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

function sendResponse(id: number | string | null, result: unknown): void {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, result });
  process.stdout.write(msg + '\n');
}

function sendError(id: number | string | null, code: number, message: string): void {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
  process.stdout.write(msg + '\n');
}

async function handleMessage(raw: string): Promise<void> {
  let parsed: JsonRpcRequest | JsonRpcNotification;
  try {
    parsed = JSON.parse(raw);
  } catch {
    sendError(null, -32700, 'Parse error');
    return;
  }

  const id = 'id' in parsed ? parsed.id : null;
  const method = parsed.method;

  switch (method) {
    case 'initialize':
      sendResponse(id, {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'capibara', version: MCP_BRIDGE_VERSION },
        capabilities: { tools: {} },
      });
      break;

    case 'notifications/initialized':
      // Client acknowledged init — no response needed
      break;

    case 'tools/list':
      sendResponse(id, { tools: TOOLS });
      break;

    case 'tools/call': {
      const params = parsed.params as { name: string; arguments?: Record<string, unknown> } | undefined;
      if (!params?.name) {
        sendError(id, -32602, 'Invalid params: missing tool name');
        return;
      }

      try {
        const result = await callMainProcess(params.name, params.arguments ?? {});
        const resultObj = result as { success: boolean; data?: unknown; error?: string };
        if (resultObj.success) {
          sendResponse(id, {
            content: [{ type: 'text', text: JSON.stringify(resultObj.data ?? {}) }],
          });
        } else {
          sendResponse(id, {
            content: [{ type: 'text', text: resultObj.error ?? 'Tool call failed' }],
            isError: true,
          });
        }
      } catch (err) {
        sendResponse(id, {
          content: [{ type: 'text', text: `Error: ${String(err)}` }],
          isError: true,
        });
      }
      break;
    }

    default:
      if (id !== null) {
        sendError(id, -32601, `Method not found: ${method}`);
      }
  }
}

// ─── Main Loop ──────────────────────────────────────────────────────
const rl = createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  if (line.trim()) {
    void handleMessage(line.trim());
  }
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

