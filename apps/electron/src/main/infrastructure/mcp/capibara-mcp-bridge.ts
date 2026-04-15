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
const VALID_CONTEXTS = ['session:planning', 'session:adhoc', 'task:execution'];
const rawContext = getArg('context') || 'task:execution';
const mcpContext = VALID_CONTEXTS.includes(rawContext) ? rawContext : 'task:execution';
if (rawContext && !VALID_CONTEXTS.includes(rawContext)) {
  process.stderr.write(`WARNING: Unknown MCP context "${rawContext}", falling back to task:execution\n`);
}

if (!runId || !token || !port) {
  process.stderr.write('Missing required args: --run-id, --token, --port\n');
  process.exit(1);
}

// ─── MCP Tool Definitions ──────────────────────────────────────────
// Each tool has a `contexts` array specifying which execution contexts it's available in.
// Tools are filtered by the `--context` CLI arg before being exposed to Claude.
const ALL_TOOLS = [
  {
    name: 'capibara_task_complete',
    contexts: ['task:execution'],
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
    name: 'capibara_task_create_child',
    contexts: ['task:execution'],
    description: 'Create a child task under a parent task. Type hierarchy: epic→story|spike, story→task|bug|chore|spike, task→subtask.',
    inputSchema: {
      type: 'object',
      properties: {
        parentTaskId: { type: 'string', description: 'Parent task ID' },
        title: { type: 'string', description: 'Child task title' },
        description: { type: 'string', description: 'Child task description' },
        type: { type: 'string', enum: ['story', 'task', 'subtask', 'spike', 'bug', 'chore'], description: 'Task type (must be valid for the parent type)' },
        assigneeRoleId: { type: 'string', description: 'Role ID to assign to (optional)' },
      },
      required: ['parentTaskId', 'title', 'description'],
    },
  },
  {
    name: 'capibara_discussion_post',
    contexts: ['task:execution'],
    description: 'Post a message or vote to a discussion group. Do NOT use this for task reviews — capibara_task_review posts automatically.',
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
    name: 'capibara_context',
    contexts: ['session:planning', 'session:adhoc', 'task:execution'],
    description: 'Query context information. Use query="task" with a task ID, query="org_tree" with an org ID, or query="discussion_summary" with a discussion group ID.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', enum: ['task', 'org_tree', 'discussion_summary'], description: 'Type of context to retrieve' },
        id: { type: 'string', description: 'The ID to look up (taskId, orgId, or discussionGroupId depending on query)' },
      },
      required: ['query', 'id'],
    },
  },
  {
    name: 'capibara_task_review',
    contexts: ['task:execution'],
    description: 'Review a child task as a parent role. Approve or request revision with feedback. Automatically posts review feedback to the discussion group — do NOT call capibara_discussion_post separately.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'The child task ID to review' },
        decision: { type: 'string', enum: ['approve', 'revise'], description: 'Review decision' },
        feedback: { type: 'string', description: 'Review feedback (required for revise, optional for approve)' },
        reviewerRoleId: { type: 'string', description: 'Your role ID (the reviewer)' },
      },
      required: ['taskId', 'decision', 'reviewerRoleId'],
    },
  },
  {
    name: 'capibara_conversation',
    contexts: ['task:execution'],
    description: 'Manage conversation workflows. Use action="ask" to post a question and wait for a reply, or action="resolve" to mark a conversation as resolved.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['ask', 'resolve'], description: 'Conversation action' },
        taskId: { type: 'string', description: 'The task ID associated with the conversation' },
        question: { type: 'string', description: 'The question to ask (required for action="ask")' },
        recipientTarget: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['supervisor', 'human', 'role', 'any'], description: 'Recipient type' },
            roleId: { type: 'string', description: 'Role ID (required when type="role")' },
          },
          description: 'Who to direct the question to (optional, defaults to supervisor)',
        },
        urgency: { type: 'string', enum: ['normal', 'urgent'], description: 'Question urgency (optional, defaults to normal)' },
        summary: { type: 'string', description: 'Resolution summary (optional for action="resolve")' },
      },
      required: ['action', 'taskId'],
    },
  },
  {
    name: 'capibara_plan_tasks',
    contexts: ['session:planning'],
    description: 'Submit a structured task plan for user review. The plan will be presented to the user for approval before any tasks are created.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Brief summary of the plan' },
        tasks: {
          type: 'array',
          description: 'Array of task nodes forming the plan tree',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Task title' },
              type: { type: 'string', description: 'Task type (e.g., epic, story, task)' },
              description: { type: 'string', description: 'Task description' },
              assigneeRoleName: { type: 'string', description: 'Name of role to assign to (optional)' },
              children: { type: 'array', description: 'Child tasks (recursive)' },
            },
            required: ['title', 'type', 'description'],
          },
        },
      },
      required: ['summary', 'tasks'],
    },
  },
];

// Filter tools based on execution context
const TOOLS = ALL_TOOLS
  .filter((t) => t.contexts.includes(mcpContext))
  .map(({ contexts: _contexts, ...tool }) => tool);

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

