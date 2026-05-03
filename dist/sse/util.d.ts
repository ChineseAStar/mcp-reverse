/**
 * SSE protocol utilities
 *
 * Parsing and formatting helpers for Server-Sent Events.
 * Implements the W3C SSE spec: https://html.spec.whatwg.org/multipage/server-sent-events.html
 */
/**
 * Format an SSE event with optional event type, id, and data.
 * Returns the wire-format string (including trailing double-newline).
 */
export declare function formatSSEEvent(data: string, options?: {
    event?: string;
    id?: string;
    retry?: number;
}): string;
/**
 * Format an SSE comment (used for keepalive).
 * Comments start with ':' and are ignored by SSE clients.
 */
export declare function formatSSEComment(text: string): string;
/**
 * Format a "ping" heartbeat event.
 */
export declare function formatSSEPing(): string;
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
export declare class SSEParser {
    private buffer;
    /** Feed a chunk of raw text into the parser and yield completed events */
    feed(chunk: string): ParsedSSEEvent[];
    /** Reset internal state */
    reset(): void;
    private parseEventBlock;
}
/**
 * Extract a header value safely.
 * Handles both string and string[] header values.
 */
export declare function getHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined;
/**
 * Extract custom X-MCP-Extra-* headers into a key-value map.
 */
export declare function extractExtraHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string>;
//# sourceMappingURL=util.d.ts.map