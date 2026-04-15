/**
 * Parses Claude CLI stream-json (NDJSON) output in real time,
 * extracting assistant text content and tool-use status from stdout chunks.
 *
 * Each chunk from the worker may contain partial lines, multiple lines,
 * or a mix. This parser maintains a line buffer to handle cross-chunk splits.
 *
 * Stream-JSON format (one JSON object per line):
 *   {"type":"system","subtype":"init","model":"...","session_id":"..."}
 *   {"type":"assistant","message":{"content":[{"type":"text","text":"Hello"},{"type":"thinking",...}]}}
 *   {"type":"result","is_error":false,"usage":{...},"session_id":"..."}
 */
export class StreamJsonParser {
  private buffer = '';
  private readonly onText: (text: string) => void;
  private readonly onStatus?: (status: string) => void;

  constructor(
    onText: (text: string) => void,
    onStatus?: (status: string) => void,
  ) {
    this.onText = onText;
    this.onStatus = onStatus;
  }

  /**
   * Feed a raw stdout chunk. May contain 0..N complete NDJSON lines.
   * Only `stdout` chunks are relevant; stderr is ignored by the caller.
   */
  feed(chunk: string): void {
    this.buffer += chunk;

    // Process all complete lines (terminated by \n)
    let newlineIdx: number;
    while ((newlineIdx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIdx).trim();
      this.buffer = this.buffer.slice(newlineIdx + 1);

      if (line.length === 0) continue;
      this.parseLine(line);
    }
  }

  /** Flush any remaining buffer content (e.g. on run completion). */
  flush(): void {
    const line = this.buffer.trim();
    this.buffer = '';
    if (line.length > 0) {
      this.parseLine(line);
    }
  }

  private parseLine(line: string): void {
    try {
      const obj = JSON.parse(line);
      if (obj.type !== 'assistant') return;

      // Claude CLI format: {"type":"assistant","message":{"content":[...]}}
      const content = obj.message?.content;
      if (!Array.isArray(content)) return;

      for (const block of content) {
        if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
          this.onText(block.text);
        } else if (block.type === 'tool_use' && typeof block.name === 'string' && this.onStatus) {
          this.onStatus(`tool:${block.name}`);
        }
      }
    } catch {
      // Malformed JSON — skip silently (may be stderr leaking into stdout)
    }
  }
}
