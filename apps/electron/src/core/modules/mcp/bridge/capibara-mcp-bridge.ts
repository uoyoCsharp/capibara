#!/usr/bin/env node
// MCP bridge — spawned by Claude CLI as an MCP server.
// JSON-RPC 2.0 over stdin/stdout ↔ HTTP POST to Electron main process.

import { request as httpRequest } from 'node:http';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
function getArg(name: string): string {
  const prefix = `--${name}=`;
  const arg = args.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : '';
}

const port = parseInt(getArg('port'), 10);

if (!port) {
  process.stderr.write('Missing required arg: --port\n');
  process.exit(1);
}

const TOOLS = [
  {
    name: 'capibara_task_transition',
    description:
      'Transition a task to a new status. ' +
      'On failure, returns the current status and available transitions so you can retry with a valid target.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'The task ID to transition' },
        targetStatus: { type: 'string', description: 'The target status name to transition to' },
      },
      required: ['taskId', 'targetStatus'],
    },
  },
  {
    name: 'capibara_task_create_child',
    description: 'Create a child task under an existing parent task.',
    inputSchema: {
      type: 'object',
      properties: {
        parentId: { type: 'string', description: 'Parent task ID' },
        type: { type: 'string', description: 'Task type (e.g., task, subtask, story)' },
        title: { type: 'string', description: 'Task title' },
        description: { type: 'string', description: 'Task description' },
        assigneeRoleId: { type: 'string', description: 'Role ID to assign', nullable: true },
      },
      required: ['parentId', 'type', 'title'],
    },
  },
  {
    name: 'capibara_ask_question',
    description: 'Ask a question to another role, creating an inquiry conversation.',
    inputSchema: {
      type: 'object',
      properties: {
        orgId: { type: 'string', description: 'Organization ID' },
        askingRoleId: { type: 'string', description: 'Role ID of the questioner' },
        taskId: { type: 'string', description: 'Associated task ID' },
        question: { type: 'string', description: 'The question content' },
      },
      required: ['orgId', 'askingRoleId', 'taskId', 'question'],
    },
  },
  {
    name: 'capibara_context',
    description: 'Query project context: tasks, roles, and organizational information.',
    inputSchema: {
      type: 'object',
      properties: {
        orgId: { type: 'string', description: 'Organization ID' },
        query: { type: 'string', enum: ['tasks', 'roles', 'task_detail', 'role_detail'], description: 'What to query' },
        entityId: { type: 'string', description: 'Entity ID for detail queries' },
      },
      required: ['orgId', 'query'],
    },
  },
  {
    name: 'capibara_plan_tasks',
    description: 'Submit a structured task plan for human confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        conversationId: { type: 'string', description: 'Planning conversation ID' },
        orgId: { type: 'string', description: 'Organization ID' },
        roleId: { type: 'string', description: 'Planning role ID' },
        tasks: { type: 'array', description: 'Array of task definitions forming the plan tree', items: { type: 'object' } },
      },
      required: ['conversationId', 'orgId', 'roleId', 'tasks'],
    },
  },
];

function callMainProcess(toolName: string, toolArgs: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ toolName, arguments: toolArgs });

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
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
          } catch {
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

function sendResponse(id: number | string | null, result: unknown): void {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function sendError(id: number | string | null, code: number, message: string): void {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

async function handleMessage(raw: string): Promise<void> {
  let parsed: { jsonrpc: string; id?: number | string; method: string; params?: Record<string, unknown> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    sendError(null, -32700, 'Parse error');
    return;
  }

  const id = parsed.id ?? null;
  const method = parsed.method;

  switch (method) {
    case 'initialize':
      sendResponse(id, {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'capibara', version: '0.2.0' },
        capabilities: { tools: {} },
      });
      break;

    case 'notifications/initialized':
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

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  if (line.trim()) {
    void handleMessage(line.trim());
  }
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
