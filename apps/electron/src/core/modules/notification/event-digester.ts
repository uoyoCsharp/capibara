import { injectable } from 'tsyringe';
import type { DesktopEvent } from './event-broadcaster';

type FlushFn = (events: DesktopEvent[]) => void;

@injectable()
export class EventDigester {
  private buffer: DesktopEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushFn: FlushFn | null = null;
  private readonly windowMs: number;

  constructor(windowMs: number = 300) {
    this.windowMs = windowMs;
  }

  setFlushFn(fn: FlushFn): void {
    this.flushFn = fn;
  }

  push(event: DesktopEvent): void {
    this.buffer.push(event);
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.windowMs);
    }
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0);
    if (this.flushFn) {
      this.flushFn(batch);
    }
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.buffer = [];
  }
}
