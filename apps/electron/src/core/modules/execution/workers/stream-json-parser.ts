export interface StreamJsonParserCallbacks {
  onText: (text: string) => void;
  onStatus: (status: string) => void;
  onParseError?: (line: string, error: string) => void;
}

export class StreamJsonParser {
  private buffer = '';

  constructor(private readonly callbacks: StreamJsonParserCallbacks) {}

  feed(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      this.parseLine(line.trim());
    }
  }

  flush(): void {
    if (this.buffer.trim()) {
      this.parseLine(this.buffer.trim());
      this.buffer = '';
    }
  }

  private parseLine(line: string): void {
    if (!line) return;
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      this.processObject(obj);
    } catch (e) {
      this.callbacks.onParseError?.(line, e instanceof Error ? e.message : String(e));
    }
  }

  private processObject(obj: Record<string, unknown>): void {
    if (obj.type === 'assistant') {
      const message = obj.message as Record<string, unknown> | undefined;
      if (message?.content && Array.isArray(message.content)) {
        for (const block of message.content as Array<Record<string, unknown>>) {
          if (block.type === 'text' && typeof block.text === 'string') {
            this.callbacks.onText(block.text);
          }
          if (block.type === 'tool_use' && typeof block.name === 'string') {
            this.callbacks.onStatus(`tool:${block.name}`);
          }
        }
      }
    }
  }
}
