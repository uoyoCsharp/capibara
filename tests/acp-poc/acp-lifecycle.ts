/**
 * ACP Phase 0 PoC — 完整生命周期验证
 *
 * 验证目标:
 *   T1. initialize → 获取 Agent 能力
 *   T2. session/new → 创建会话
 *   T3. session/prompt → 发送消息并消费 session/update 流
 *   T4. session/close → 关闭会话
 *   T5. session/resume 或 session/load → 恢复会话
 *   T6. fs/read_text_file → Client 侧文件系统
 *   T7. session/request_permission → 权限请求
 *   T8. MCP stdio 传输 → Agent 连接 MCP server
 *
 * 运行方式:
 *   npx tsx tests/acp-poc/acp-lifecycle.ts
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { Writable, Readable } from 'node:stream';
import { createRequire } from 'node:module';
import * as acp from '@agentclientprotocol/sdk';

// ── Result tracking ───────────────────────────────────────────

interface TestResult {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  detail: string;
}

const results: TestResult[] = [];

function record(name: string, status: 'pass' | 'fail' | 'skip', detail: string) {
  results[results.length] = { name, status, detail };
  const icon = status === 'pass' ? '✅' : status === 'fail' ? '❌' : '⏭️';
  console.log(`${icon} ${name}: ${detail}`);
}

// ── ACP Client implementation ─────────────────────────────────

class PocClient implements acp.Client {
  permissionRequests: acp.RequestPermissionRequest[] = [];
  updates: acp.SessionNotification[] = [];
  fileReads: acp.ReadTextFileRequest[] = [];
  fileWrites: acp.WriteTextFileRequest[] = [];
  textChunks: string[] = [];
  toolCalls: string[] = [];

  async requestPermission(
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> {
    this.permissionRequests.push(params);
    console.log(`  🔐 Permission requested: ${params.toolCall.title} (kind: ${params.toolCall.kind})`);

    // 自动允许所有权限请求
    const allowOption = params.options.find((o) => o.kind === 'allow_once');
    if (allowOption) {
      return { outcome: { outcome: 'selected', optionId: allowOption.optionId } };
    }
    return { outcome: { outcome: 'selected', optionId: params.options[0].optionId } };
  }

  async sessionUpdate(params: acp.SessionNotification): Promise<void> {
    this.updates.push(params);
    const update = params.update;

    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        if (update.content.type === 'text') {
          this.textChunks.push(update.content.text);
          process.stdout.write(update.content.text);
        }
        break;
      case 'tool_call':
        this.toolCalls.push(update.title);
        console.log(`  🔧 Tool call: ${update.title} (${update.status})`);
        break;
      case 'tool_call_update':
        console.log(`  🔧 Tool update: ${update.toolCallId} → ${update.status}`);
        break;
      case 'plan':
        console.log(`  📋 Plan received (${update.entries?.length ?? 0} entries)`);
        break;
      default:
        console.log(`  📨 Update: ${update.sessionUpdate}`);
        break;
    }
  }

  async readTextFile(params: acp.ReadTextFileRequest): Promise<acp.ReadTextFileResponse> {
    this.fileReads.push(params);
    console.log(`  📄 fs/read_text_file: ${params.path}`);
    // 返回模拟内容以验证通道工作
    return { content: `[PoC mock] Content of ${params.path}` };
  }

  async writeTextFile(params: acp.WriteTextFileRequest): Promise<acp.WriteTextFileResponse> {
    this.fileWrites.push(params);
    console.log(`  📝 fs/write_text_file: ${params.path} (${params.content.length} bytes)`);
    // 不实际写入，只记录
    return {};
  }
}

// ── Helpers ───────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

// ── Main test flow ────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  ACP Phase 0 PoC — Claude Agent (claude-agent-acp)');
  console.log('═══════════════════════════════════════════════════\n');

  // Spawn claude-agent-acp as subprocess.
  // claude-agent-acp auto-discovers Claude Code via its bundled
  // @anthropic-ai/claude-agent-sdk platform binary, so we do NOT need
  // to set CLAUDE_CODE_EXECUTABLE unless the user explicitly provides it
  // (e.g. to pin a specific CLI version).
  const _require = createRequire(import.meta.url);
  const AGENT_ENTRY = process.env.CLAUDE_AGENT_ACP_ENTRY
    ?? _require.resolve('@agentclientprotocol/claude-agent-acp/dist/index.js');
  console.log('🚀 Spawning claude-agent-acp via node...');
  if (process.env.CLAUDE_CODE_EXECUTABLE) {
    console.log(`  CLAUDE_CODE_EXECUTABLE (user override) → ${process.env.CLAUDE_CODE_EXECUTABLE}`);
  } else {
    console.log('  CLAUDE_CODE_EXECUTABLE not set — agent will auto-discover via SDK platform binary');
  }
  console.log();

  let agentProcess: ChildProcess;
  try {
    agentProcess = spawn('node', [AGENT_ENTRY], {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: {
        ...process.env,
        DEBUG_CLAUDE_AGENT_SDK: '1',
      },
      windowsHide: true,
    });
  } catch (err) {
    console.error('Failed to spawn agent:', err);
    process.exit(1);
  }

  agentProcess.on('error', (err) => {
    console.error('Agent process error:', err);
  });

  const input = Writable.toWeb(agentProcess.stdin!);
  const output = Readable.toWeb(agentProcess.stdout!) as ReadableStream<Uint8Array>;

  const client = new PocClient();
  const stream = acp.ndJsonStream(input, output);
  const connection = new acp.ClientSideConnection((_agent) => client, stream);

  try {
    // ── T1: Initialize ──────────────────────────────────────
    console.log('─── T1: Initialize ───');
    const initResult = await connection.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {
        fs: {
          readTextFile: true,
          writeTextFile: true,
        },
      },
    });

    console.log(`  Protocol version: ${initResult.protocolVersion}`);
    console.log(`  Agent capabilities: ${JSON.stringify(initResult.agentCapabilities, null, 2)}`);

    const capabilities = initResult.agentCapabilities ?? {};
    const sessionCaps = (capabilities as Record<string, unknown>).sessionCapabilities as
      | Record<string, unknown>
      | undefined;
    const supportsClose = !!sessionCaps?.close;
    const supportsResume = !!sessionCaps?.resume;
    const supportsLoad = !!(capabilities as Record<string, unknown>).loadSession;

    record('T1-initialize', 'pass', `protocol v${initResult.protocolVersion}`);
    record(
      'T1-capabilities',
      'pass',
      `close=${supportsClose}, resume=${supportsResume}, loadSession=${supportsLoad}`,
    );

    // ── T2: Create Session ──────────────────────────────────
    console.log('\n─── T2: session/new ───');
    const sessionResult = await connection.newSession({
      cwd: process.cwd(),
      mcpServers: [],
    });

    const sessionId = sessionResult.sessionId;
    console.log(`  Session ID: ${sessionId}`);
    record('T2-session-new', 'pass', `sessionId=${sessionId}`);

    // ── T3: Prompt (simple) ─────────────────────────────────
    console.log('\n─── T3: session/prompt (simple text) ───');
    console.log('  → Sending: "Say hello in exactly 5 words."\n');

    let t3passed = false;
    try {
      const promptResult = await withTimeout(connection.prompt({
        sessionId,
        prompt: [
          {
            type: 'text',
            text: 'Say hello in exactly 5 words. Do not use any tools.',
          },
        ],
      }), 60000, 'T3-prompt');

      console.log(`\n  Stop reason: ${promptResult.stopReason}`);
      record('T3-prompt', 'pass', `stopReason=${promptResult.stopReason}`);
      t3passed = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      record('T3-prompt', 'fail', msg);
      console.log(`\n  T3 failed: ${msg}`);
    }
    record(
      'T3-updates',
      client.updates.length > 0 ? 'pass' : 'fail',
      `received ${client.updates.length} session/update notifications`,
    );
    record(
      'T3-text-streaming',
      client.textChunks.length > 0 ? 'pass' : 'fail',
      `received ${client.textChunks.length} text chunks`,
    );

    // ── T6: Test fs/read_text_file (trigger via prompt) ─────
    console.log('\n─── T6: fs/read_text_file trigger ───');
    console.log('  → Sending: "Read the file package.json and tell me the project name."\n');

    client.textChunks = [];
    client.fileReads = [];
    client.toolCalls = [];
    client.permissionRequests = [];

    const fsPromptResult = await withTimeout(connection.prompt({
      sessionId,
      prompt: [
        {
          type: 'text',
          text: 'Read the file package.json in the current directory and tell me the project name field. Use the file system to read it.',
        },
      ],
    }), 90000, 'T6-prompt');

    console.log(`\n  Stop reason: ${fsPromptResult.stopReason}`);
    record(
      'T6-fs-read',
      client.fileReads.length > 0 ? 'pass' : 'skip',
      client.fileReads.length > 0
        ? `${client.fileReads.length} file read(s): ${client.fileReads.map((r) => r.path).join(', ')}`
        : 'Agent did not call fs/read_text_file (may use built-in tools instead)',
    );
    record(
      'T7-permission',
      client.permissionRequests.length > 0 ? 'pass' : 'skip',
      client.permissionRequests.length > 0
        ? `${client.permissionRequests.length} permission request(s)`
        : 'No permission requests received (Agent may auto-approve or not request)',
    );
    record(
      'T6-tool-calls',
      client.toolCalls.length > 0 ? 'pass' : 'skip',
      client.toolCalls.length > 0
        ? `Tool calls observed: ${client.toolCalls.join(', ')}`
        : 'No tool_call updates received',
    );

    // ── T4: Close Session ───────────────────────────────────
    console.log('\n─── T4: session/close ───');
    if (supportsClose) {
      try {
        await connection.closeSession({ sessionId });
        console.log('  Session closed successfully');
        record('T4-close', 'pass', 'session/close succeeded');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        record('T4-close', 'fail', `session/close error: ${msg}`);
      }
    } else {
      record('T4-close', 'skip', 'Agent does not advertise sessionCapabilities.close');
    }

    // ── T5: Resume Session ──────────────────────────────────
    console.log('\n─── T5: session/resume ───');
    if (supportsResume) {
      try {
        await connection.resumeSession({
          sessionId,
          cwd: process.cwd(),
          mcpServers: [],
        });
        console.log('  Session resumed successfully');

        // Send a follow-up prompt to verify context retention
        client.textChunks = [];
        console.log('  → Sending follow-up: "What was the first thing I asked you?"\n');

        const resumePrompt = await withTimeout(connection.prompt({
          sessionId,
          prompt: [
            {
              type: 'text',
              text: 'What was the first thing I asked you in this session? Reply briefly.',
            },
          ],
        }), 60000, 'T5-resume-prompt');

        console.log(`\n  Stop reason: ${resumePrompt.stopReason}`);
        const remembers = client.textChunks.join('').toLowerCase().includes('hello') ||
          client.textChunks.join('').toLowerCase().includes('5 words');
        record('T5-resume', 'pass', 'session/resume succeeded');
        record(
          'T5-context-retained',
          remembers ? 'pass' : 'fail',
          remembers
            ? 'Agent remembers prior context after resume'
            : 'Agent may not retain context (check output above)',
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        record('T5-resume', 'fail', `session/resume error: ${msg}`);
      }
    } else if (supportsLoad) {
      console.log('  Agent does not support resume, trying session/load...');
      try {
        await connection.loadSession({
          sessionId,
          cwd: process.cwd(),
          mcpServers: [],
        });
        console.log('  Session loaded (replayed) successfully');
        record('T5-load', 'pass', 'session/load succeeded (fallback)');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        record('T5-load', 'fail', `session/load error: ${msg}`);
      }
    } else {
      record('T5-resume', 'skip', 'Agent supports neither resume nor loadSession');
    }
  } catch (err) {
    console.error('\n💥 Unhandled error:', err);
    record('FATAL', 'fail', err instanceof Error ? err.message : String(err));
  } finally {
    // ── Summary ─────────────────────────────────────────────
    console.log('\n═══════════════════════════════════════════════════');
    console.log('  Phase 0 PoC Results Summary');
    console.log('═══════════════════════════════════════════════════\n');

    const passed = results.filter((r) => r.status === 'pass').length;
    const failed = results.filter((r) => r.status === 'fail').length;
    const skipped = results.filter((r) => r.status === 'skip').length;

    for (const r of results) {
      const icon = r.status === 'pass' ? '✅' : r.status === 'fail' ? '❌' : '⏭️';
      console.log(`  ${icon} ${r.name}: ${r.detail}`);
    }

    console.log(`\n  Total: ${passed} passed, ${failed} failed, ${skipped} skipped`);

    // Capability matrix
    console.log('\n─── Agent Capability Matrix ───');
    const caps = results.find((r) => r.name === 'T1-capabilities');
    if (caps) console.log(`  ${caps.detail}`);
    console.log(`  fs/read_text_file: ${results.find((r) => r.name === 'T6-fs-read')?.status ?? 'unknown'}`);
    console.log(`  permission_request: ${results.find((r) => r.name === 'T7-permission')?.status ?? 'unknown'}`);

    // Degradation strategy
    console.log('\n─── Recommended Degradation Strategy ───');
    const resumeResult = results.find((r) => r.name === 'T5-resume');
    const loadResult = results.find((r) => r.name === 'T5-load');
    if (resumeResult?.status === 'pass') {
      console.log('  ✅ Use session/resume (optimal)');
    } else if (loadResult?.status === 'pass') {
      console.log('  ⚠️ Use session/load (replay history, suboptimal)');
    } else {
      console.log('  ⚠️ Must use session/new + context rebuild (fallback)');
    }

    console.log('');

    // Cleanup
    agentProcess.kill();
    process.exit(failed > 0 ? 1 : 0);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
