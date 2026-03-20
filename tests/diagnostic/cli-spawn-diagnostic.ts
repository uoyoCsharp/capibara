/**
 * CLI Spawn Diagnostic Script
 * Run: npx tsx tests/diagnostic/cli-spawn-diagnostic.ts
 *
 * Tests various spawn strategies to identify why the Claude CLI exits early.
 */

import { spawn, execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DIVIDER = '═'.repeat(70);
const SECTION = '─'.repeat(70);

interface DiagResult {
  label: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  duration: number;
  error?: string;
}

// ── Step 1: Resolve the claude CLI path ──────────────────────────────

function resolveClaudePath(): {
  cmdPath: string | null;
  resolvedNode: string | null;
  resolvedScript: string | null;
  rawWhere: string;
} {
  console.log(`\n${DIVIDER}`);
  console.log('STEP 1: Resolving Claude CLI path');
  console.log(DIVIDER);

  let rawWhere = '';
  try {
    rawWhere = execSync('where claude', { encoding: 'utf-8' }).trim();
    console.log(`[where claude] output:\n${rawWhere}\n`);
  } catch (err) {
    console.log('[where claude] FAILED - claude not found in PATH');
    return { cmdPath: null, resolvedNode: null, resolvedScript: null, rawWhere: '' };
  }

  const paths = rawWhere.split(/\r?\n/);
  const cmdPath =
    paths.find((p) => p.endsWith('.cmd') || p.endsWith('.bat')) ?? paths[0];

  console.log(`Selected path: ${cmdPath}`);
  console.log(`Is .cmd/.bat: ${cmdPath.endsWith('.cmd') || cmdPath.endsWith('.bat')}`);

  // Try to parse .cmd file
  let resolvedNode: string | null = null;
  let resolvedScript: string | null = null;

  if (cmdPath.endsWith('.cmd') || cmdPath.endsWith('.bat')) {
    try {
      const content = readFileSync(cmdPath, 'utf-8');
      console.log(`\n.cmd file content (first 500 chars):\n${content.slice(0, 500)}\n`);

      const cmdDir = dirname(cmdPath);

      // Try multiple patterns
      const patterns = [
        /"%(?:dp0|~dp0)%\\([^"]+\.js)"/i,
        /"%~dp0\\([^"]+\.js)"/i,
        /"%dp0%\\([^"]+\.js)"/i,
        /"([^"]+\.js)"/,
      ];

      for (const pattern of patterns) {
        const match = content.match(pattern);
        if (match) {
          const scriptPath = match[1].includes(':')
            ? match[1] // absolute path
            : join(cmdDir, match[1]);

          console.log(`Pattern ${pattern.source} matched: ${match[1]}`);
          console.log(`Resolved script path: ${scriptPath}`);
          console.log(`Script exists: ${existsSync(scriptPath)}`);

          if (existsSync(scriptPath)) {
            resolvedNode = process.execPath;
            resolvedScript = scriptPath;
            break;
          }
        }
      }

      if (!resolvedScript) {
        console.log('WARNING: Could not extract .js script path from .cmd file');
      }
    } catch (err) {
      console.log(`Error reading .cmd file: ${err}`);
    }
  }

  return { cmdPath, resolvedNode, resolvedScript, rawWhere };
}

// ── Step 2: Test spawn strategies ────────────────────────────────────

function runSpawnTest(
  label: string,
  command: string,
  args: string[],
  options: {
    shell?: boolean;
    stdinData?: string;
    stdinMode?: 'pipe' | 'ignore';
    timeout?: number;
  } = {},
): Promise<DiagResult> {
  const startTime = Date.now();
  const timeout = options.timeout ?? 30_000;

  const argsDisplay = args.map((a) =>
    a.length > 80 ? a.slice(0, 80) + `...(${a.length} chars)` : a,
  );
  console.log(`\n${SECTION}`);
  console.log(`TEST: ${label}`);
  console.log(`  Command: ${command}`);
  console.log(`  Args: ${JSON.stringify(argsDisplay)}`);
  console.log(`  Shell: ${options.shell ?? false}`);
  console.log(`  Stdin mode: ${options.stdinMode ?? 'ignore'}`);
  console.log(
    `  Total args length: ${args.reduce((s, a) => s + a.length, 0)} chars`,
  );
  console.log(SECTION);

  return new Promise<DiagResult>((resolve) => {
    try {
      const stdinMode = options.stdinMode ?? 'ignore';
      const proc = spawn(command, args, {
        cwd: process.cwd(),
        env: { ...process.env },
        stdio: [stdinMode, 'pipe', 'pipe'],
        shell: options.shell ?? false,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d: Buffer) => {
        stdout += d.toString();
      });
      proc.stderr.on('data', (d: Buffer) => {
        stderr += d.toString();
      });

      // Write to stdin if needed
      if (stdinMode === 'pipe' && options.stdinData) {
        proc.stdin!.write(options.stdinData);
        proc.stdin!.end();
      } else if (stdinMode === 'pipe') {
        // pipe mode but no data - close immediately
        proc.stdin!.end();
      }

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        const duration = Date.now() - startTime;
        resolve({
          label,
          exitCode: null,
          stdout: stdout.slice(0, 500),
          stderr: stderr.slice(0, 500),
          duration,
          error: `TIMEOUT after ${timeout}ms (this means the process IS running and waiting - that's good!)`,
        });
      }, timeout);

      // Wait for streams + close
      let stdoutEnded = false;
      let stderrEnded = false;
      let exitCode: number | null = null;
      let exited = false;

      const tryResolve = () => {
        if (!stdoutEnded || !stderrEnded || !exited) return;
        clearTimeout(timer);
        const duration = Date.now() - startTime;
        resolve({
          label,
          exitCode,
          stdout: stdout.slice(0, 1000),
          stderr: stderr.slice(0, 1000),
          duration,
        });
      };

      proc.stdout.on('end', () => { stdoutEnded = true; tryResolve(); });
      proc.stderr.on('end', () => { stderrEnded = true; tryResolve(); });
      proc.on('close', (code) => { exitCode = code; exited = true; tryResolve(); });
      proc.on('error', (err) => {
        clearTimeout(timer);
        const duration = Date.now() - startTime;
        resolve({
          label,
          exitCode: null,
          stdout: stdout.slice(0, 500),
          stderr: stderr.slice(0, 500),
          duration,
          error: `SPAWN ERROR: ${err.message}`,
        });
      });
    } catch (err: any) {
      resolve({
        label,
        exitCode: null,
        stdout: '',
        stderr: '',
        duration: Date.now() - startTime,
        error: `EXCEPTION: ${err.message}`,
      });
    }
  });
}

function printResult(r: DiagResult) {
  console.log(`\n  Result for: ${r.label}`);
  console.log(`  Exit Code : ${r.exitCode}`);
  console.log(`  Duration  : ${r.duration}ms`);
  if (r.error) console.log(`  Error     : ${r.error}`);
  if (r.stdout) console.log(`  Stdout    : ${r.stdout.slice(0, 300)}`);
  if (r.stderr) console.log(`  Stderr    : ${r.stderr.slice(0, 300)}`);
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${'*'.repeat(70)}`);
  console.log('  Claude CLI Spawn Diagnostic');
  console.log(`  Platform: ${process.platform}  Node: ${process.version}`);
  console.log(`  process.execPath: ${process.execPath}`);
  console.log(`${'*'.repeat(70)}`);

  const { cmdPath, resolvedNode, resolvedScript } = resolveClaudePath();

  if (!cmdPath) {
    console.log('\nFATAL: Claude CLI not found. Make sure it is installed and in PATH.');
    process.exit(1);
  }

  console.log(`\n${DIVIDER}`);
  console.log('STEP 2: Running spawn tests (30s timeout each)');
  console.log(DIVIDER);

  const results: DiagResult[] = [];

  // Test A: Basic shell spawn - simplest possible invocation
  results.push(
    await runSpawnTest('A: shell=true, --version', cmdPath, ['--version'], {
      shell: true,
    }),
  );

  // Test B: shell=true, --print with short prompt, stdin=ignore
  results.push(
    await runSpawnTest(
      'B: shell=true, --print short prompt, stdin=ignore',
      cmdPath,
      ['--print', '--output-format', 'json', '--dangerously-skip-permissions', 'Say "hello"'],
      { shell: true, stdinMode: 'ignore' },
    ),
  );

  // Test C: shell=true, --print with short prompt, stdin=pipe (closed immediately)
  results.push(
    await runSpawnTest(
      'C: shell=true, --print short prompt, stdin=pipe (closed)',
      cmdPath,
      ['--print', '--output-format', 'json', '--dangerously-skip-permissions', 'Say "hello"'],
      { shell: true, stdinMode: 'pipe' },
    ),
  );

  // Test D: If resolved to node+script, test direct spawn
  if (resolvedNode && resolvedScript) {
    results.push(
      await runSpawnTest(
        'D: node+script direct, --print, stdin=ignore',
        resolvedNode,
        [resolvedScript, '--print', '--output-format', 'json', '--dangerously-skip-permissions', 'Say "hello"'],
        { shell: false, stdinMode: 'ignore' },
      ),
    );

    results.push(
      await runSpawnTest(
        'E: node+script direct, --print, stdin=pipe (closed)',
        resolvedNode,
        [resolvedScript, '--print', '--output-format', 'json', '--dangerously-skip-permissions', 'Say "hello"'],
        { shell: false, stdinMode: 'pipe' },
      ),
    );
  }

  // Test F: prompt via stdin instead of args
  results.push(
    await runSpawnTest(
      'F: shell=true, prompt via STDIN',
      cmdPath,
      ['--print', '--output-format', 'json', '--dangerously-skip-permissions'],
      { shell: true, stdinMode: 'pipe', stdinData: 'Say "hello"' },
    ),
  );

  // Test G: Long system prompt (test Windows arg length limits)
  const longSystemPrompt = 'You are a helpful assistant. '.repeat(500); // ~15KB
  results.push(
    await runSpawnTest(
      `G: shell=true, long --system-prompt (${longSystemPrompt.length} chars)`,
      cmdPath,
      [
        '--print', '--output-format', 'json',
        '--system-prompt', longSystemPrompt,
        '--dangerously-skip-permissions',
        'Say "hello"',
      ],
      { shell: true, stdinMode: 'ignore' },
    ),
  );

  // Test H: Long system prompt with prompt via stdin
  if (resolvedNode && resolvedScript) {
    results.push(
      await runSpawnTest(
        `H: node+script, long system prompt, prompt via STDIN`,
        resolvedNode,
        [
          resolvedScript,
          '--print', '--output-format', 'json',
          '--system-prompt', longSystemPrompt,
          '--dangerously-skip-permissions',
        ],
        { shell: false, stdinMode: 'pipe', stdinData: 'Say "hello"' },
      ),
    );
  }

  // ── Summary ──────────────────────────────────────────────────────

  console.log(`\n\n${'='.repeat(70)}`);
  console.log('DIAGNOSTIC SUMMARY');
  console.log('='.repeat(70));

  for (const r of results) {
    const status =
      r.error
        ? (r.error.includes('TIMEOUT') ? 'WAITING (process alive)' : 'ERROR')
        : r.exitCode === 0
          ? 'SUCCESS'
          : `EXIT(${r.exitCode})`;

    console.log(`\n  [${status.padEnd(22)}] ${r.label}`);
    console.log(`    Duration: ${r.duration}ms`);
    if (r.error) console.log(`    Error: ${r.error.slice(0, 100)}`);
    if (r.stderr && !r.error) console.log(`    Stderr: ${r.stderr.slice(0, 150)}`);
    if (r.stdout && status === 'SUCCESS')
      console.log(`    Stdout: ${r.stdout.slice(0, 150)}`);
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log('ANALYSIS:');

  // Analyze patterns
  const quickExits = results.filter(
    (r) => !r.error && r.duration < 3000 && r.exitCode !== 0,
  );
  const timeouts = results.filter((r) => r.error?.includes('TIMEOUT'));
  const successes = results.filter((r) => r.exitCode === 0);
  const spawnErrors = results.filter((r) => r.error?.includes('SPAWN ERROR'));

  if (spawnErrors.length > 0) {
    console.log('\n  SPAWN ERRORS detected:');
    for (const r of spawnErrors)
      console.log(`    - ${r.label}: ${r.error}`);
    console.log('  >> Check Claude CLI installation and PATH');
  }

  if (quickExits.length > 0) {
    console.log('\n  QUICK EXITS detected (process starts but exits immediately):');
    for (const r of quickExits) {
      console.log(`    - ${r.label}: code=${r.exitCode}, ${r.duration}ms`);
      if (r.stderr) console.log(`      stderr: ${r.stderr.slice(0, 200)}`);
    }
    console.log('  >> Likely cause: CLI configuration issue or invalid arguments');
    console.log('  >> Check stderr output above for error messages');
  }

  if (timeouts.length > 0) {
    console.log('\n  TIMEOUTS detected (process alive but slow):');
    for (const r of timeouts)
      console.log(`    - ${r.label}`);
    console.log('  >> These tests show the process IS running (good sign)');
  }

  if (successes.length > 0) {
    console.log('\n  SUCCESSFUL tests:');
    for (const r of successes)
      console.log(`    - ${r.label} (${r.duration}ms)`);
  }

  // Specific pattern analysis
  const testB = results.find((r) => r.label.startsWith('B:'));
  const testF = results.find((r) => r.label.startsWith('F:'));
  if (testB && testF) {
    if (
      testB.exitCode !== 0 &&
      testB.duration < 3000 &&
      (testF.exitCode === 0 || testF.error?.includes('TIMEOUT'))
    ) {
      console.log('\n  >> DIAGNOSIS: Prompt-as-arg fails but stdin works.');
      console.log('     FIX: Pass prompt via stdin instead of command-line argument.');
    }
  }

  const testG = results.find((r) => r.label.startsWith('G:'));
  if (testG && testG.exitCode !== 0 && testG.duration < 3000) {
    console.log('\n  >> DIAGNOSIS: Long --system-prompt causes quick exit.');
    console.log(
      '     Likely hitting Windows command-line length limit (32K chars).',
    );
    console.log('     FIX: Write system prompt to temp file or pass via stdin.');
  }

  console.log(`\n${'='.repeat(70)}\n`);
}

main().catch(console.error);
