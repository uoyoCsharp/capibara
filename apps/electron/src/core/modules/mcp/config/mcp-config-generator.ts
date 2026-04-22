import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { app } from 'electron';
import type { ILogger } from '@core/foundation/interfaces/i-logger';

export class McpConfigGenerator {
  private readonly tempDir: string;
  private configPath: string | null = null;

  constructor(private readonly logger: ILogger) {
    this.tempDir = join(tmpdir(), 'capibara-mcp');
    mkdirSync(this.tempDir, { recursive: true });
  }

  getBridgePath(): string {
    return join(app.getAppPath(), 'out', 'main', 'capibara-mcp-bridge.js');
  }

  getConfigPath(): string | null {
    return this.configPath;
  }

  generate(port: number): string {
    const bridgePath = this.getBridgePath();
    const config = {
      mcpServers: {
        capibara: {
          command: 'node',
          args: [bridgePath, `--port=${port}`],
        },
      },
    };

    const filePath = join(this.tempDir, 'capibara-mcp.json');
    writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
    this.configPath = filePath;
    this.logger.debug('MCP config generated', { filePath, port });
    return filePath;
  }

  cleanup(): void {
    if (!this.configPath) return;
    try {
      unlinkSync(this.configPath);
      this.logger.debug('MCP config cleaned up');
    } catch {
      // File may already be removed
    }
    this.configPath = null;
  }
}
