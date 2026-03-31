import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { injectable, inject } from 'tsyringe';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import { LOGGER_TOKEN } from '@main/core/tokens.js';

/**
 * Generates temporary MCP config files for Claude Code CLI execution.
 * See Architecture §7.2 — MCP Server Bridge (ADR-04).
 */
@injectable()
export class McpConfigGenerator {
  private readonly tempDir: string;
  private port = 0;

  constructor(
    @inject(LOGGER_TOKEN) private readonly logger: ILogger,
  ) {
    this.tempDir = join(tmpdir(), 'capibara-mcp');
    mkdirSync(this.tempDir, { recursive: true });
  }

  setPort(port: number): void {
    this.port = port;
  }

  getBridgePath(): string {
    // The bridge script is built alongside the main entry as 'capibara-mcp-bridge.js'
    // In Electron, __dirname points to the built output directory (out/main/)
    return join(dirname(__dirname), 'main', 'capibara-mcp-bridge.js');
  }

  generate(runId: string, bridgePath: string, token: string): string {
    const config = {
      mcpServers: {
        capibara: {
          command: 'node',
          args: [
            bridgePath,
            `--run-id=${runId}`,
            `--token=${token}`,
            `--port=${this.port}`,
          ],
        },
      },
    };

    const filePath = join(this.tempDir, `capibara-mcp-${runId}.json`);
    writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
    this.logger.debug('MCP config generated', { runId, filePath });
    return filePath;
  }

  cleanup(runId: string): void {
    const filePath = join(this.tempDir, `capibara-mcp-${runId}.json`);
    try {
      unlinkSync(filePath);
      this.logger.debug('MCP config cleaned up', { runId });
    } catch {
      // File may already be removed
    }
  }
}
