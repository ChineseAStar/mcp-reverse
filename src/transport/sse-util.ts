/**
 * SSE protocol utilities
 *
 * Parsing and formatting helpers for Server-Sent Events.
 * Implements the W3C SSE spec: https://html.spec.whatwg.org/multipage/server-sent-events.html
 */

// ─── SSE Event Formatting ────────────────────────────────────────────

/**
 * Format an SSE event with optional event type, id, and data.
 * Returns the wire-format string (including trailing double-newline).
 */
export function formatSSEEvent(
  data: string,
  options?: { event?: string; id?: string; retry?: number },
): string {
  const lines: string[] = [];

  if (options?.event) {
    lines.push(`event: ${options.event}`);
  }
  if (options?.id) {
    lines.push(`id: ${options.id}`);
  }
  if (options?.retry !== undefined) {
    lines.push(`retry: ${options.retry}`);
  }

  // Split multi-line data into multiple 'data:' lines
  const dataLines = data.split('\n');
  for (const line of dataLines) {
    lines.push(`data: ${line}`);
  }

  // SSE events are terminated by a double newline
  return lines.join('\n') + '\n\n';
}

/**
 * Format an SSE comment (used for keepalive).
 * Comments start with ':' and are ignored by SSE clients.
 */
export function formatSSEComment(text: string): string {
  return `: ${text}\n\n`;
}

/**
 * Format a "ping" heartbeat event.
 */
export function formatSSEPing(): string {
  return formatSSEComment(`ping ${Date.now()}`);
}

// ─── SSE Event Parsing ──────────────────────────────────────────────

/** A parsed SSE event */
export interface ParsedSSEEvent {
  /** Event type (default: 'message') */
  event: string;
  /** Aggregated data (multi-line 'data:' fields joined by '\n') */
  data: string;
  /** Last event id */
  id?: string;
  /** Reconnection time hint */
  retry?: number;
}

/**
 * SSE event parser — maintains partial-line state across chunks.
 * Call repeatedly with each chunk received from the stream;
 * yields fully-parsed events as they become available.
 */
export class SSEParser {
  private buffer: string = '';

  /** Feed a chunk of raw text into the parser and yield completed events */
  feed(chunk: string): ParsedSSEEvent[] {
    this.buffer += chunk;
    const events: ParsedSSEEvent[] = [];

    // Process complete events (separated by double-newline)
    let idx: number;
    while ((idx = this.buffer.indexOf('\n\n')) !== -1) {
      const raw = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);

      const parsed = this.parseEventBlock(raw);
      if (parsed) {
        events.push(parsed);
      }
    }

    return events;
  }

  /** Reset internal state */
  reset(): void {
    this.buffer = '';
  }

  private parseEventBlock(raw: string): ParsedSSEEvent | null {
    const event: ParsedSSEEvent = { event: 'message', data: '' };
    let hasData = false;

    const lines = raw.split('\n');
    for (const line of lines) {
      if (line.startsWith(':')) {
        // Comment line — ignore (keepalive)
        continue;
      }

      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) {
        // Field with no colon — the entire line is the field name, value is empty
        const field = line;
        if (field === 'data') {
          event.data += '\n';
          hasData = true;
        }
        continue;
      }

      const field = line.slice(0, colonIdx);
      let value = line.slice(colonIdx + 1);
      // Remove a single leading space if present
      if (value.startsWith(' ')) {
        value = value.slice(1);
      }

      switch (field) {
        case 'event':
          event.event = value;
          break;
        case 'data':
          if (hasData) {
            event.data += '\n' + value;
          } else {
            event.data = value;
            hasData = true;
          }
          break;
        case 'id':
          event.id = value;
          break;
        case 'retry':
          event.retry = parseInt(value, 10) || undefined;
          break;
      }
    }

    // Return null for comment-only blocks (keepalive)
    if (!hasData && event.event === 'message') {
      return null;
    }

    return event;
  }
}

// ─── Request Helpers ─────────────────────────────────────────────────

/**
 * Extract a header value safely.
 * Handles both string and string[] header values.
 */
export function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Extract custom X-MCP-Extra-* headers into a key-value map.
 */
export function extractExtraHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const extra: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.startsWith('x-mcp-extra-') && typeof value === 'string') {
      const extraKey = key.replace('x-mcp-extra-', '');
      extra[extraKey] = value;
    }
  }
  return extra;
}
