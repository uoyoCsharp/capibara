import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import https from 'node:https';
import type { ILogger } from '@main/core/interfaces/i-logger.js';
import type { SystemCheckResult, DepCheckItem } from '@shared/contracts.js';

const execFileAsync = promisify(execFile);

const TIMEOUT_MS = 5_000;

export class SystemCheckService {
  constructor(private readonly logger: ILogger) {}

  async check(): Promise<SystemCheckResult> {
    const [nodejs, claudeCli, network] = await Promise.all([
      this.checkNode(),
      this.checkClaudeCli(),
      this.checkNetwork(),
    ]);
    return { nodejs, claudeCli, network };
  }

  private async checkNode(): Promise<DepCheckItem> {
    try {
      const { stdout } = await execFileAsync('node', ['-v'], { timeout: TIMEOUT_MS });
      const version = stdout.trim();
      return { ok: true, version };
    } catch (err) {
      this.logger.warn('Node.js check failed', { error: String(err) });
      return { ok: false, version: null };
    }
  }

  private async checkClaudeCli(): Promise<DepCheckItem> {
    try {
      const { stdout } = await execFileAsync('claude', ['--version'], {
        timeout: TIMEOUT_MS,
        shell: true,
      });
      const version = stdout.trim();
      return { ok: true, version };
    } catch (err) {
      this.logger.warn('Claude CLI check failed', { error: String(err) });
      return { ok: false, version: null };
    }
  }

  private checkNetwork(): Promise<DepCheckItem> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve({ ok: false, version: null });
      }, TIMEOUT_MS);

      const req = https.get('https://api.anthropic.com', (res) => {
        clearTimeout(timer);
        resolve({ ok: res.statusCode !== undefined, version: null });
        res.resume();
      });
      req.on('error', () => {
        clearTimeout(timer);
        resolve({ ok: false, version: null });
      });
    });
  }
}
