/**
 * SSEConnectionTransport
 *
 * Wraps a single SSE session as an MCP Transport.
 * Used by SSEAcceptor for each connected MCP server.
 *
 * Messages FROM the public client TO the internal server are written
 * into the SSE stream (via write callback).
 *
 * Messages FROM the internal server TO the public client arrive via
 * POST and are fed into this transport via feedMessage().
 */

import type { Transport, TransportSendOptions } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';
import { formatSSEEvent } from './util.js';
import type { Logger } from '../common/types.js';

const parseMessage = (raw: unknown): JSONRPCMessage => {
  return JSONRPCMessageSchema.parse(raw);
};

export class SSEConnectionTransport implements Transport {
  private _sessionId: string;
  private logger: Logger;
  private _closed: boolean = false;
  private _writeCallback?: (data: string) => void;
  private _messageEventId: number = 0;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(sessionId: string, logger?: Logger) {
    this._sessionId = sessionId;
    this.logger = logger ?? { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
  }

  get sessionId(): string | undefined {
    return this._sessionId;
  }

  /** Set the callback used for writing raw SSE data to the stream */
  setWriteCallback(cb: (data: string) => void): void {
    this._writeCallback = cb;
  }

  // ─── Transport Interface ─────────────────────────────────────────

  async start(): Promise<void> {
    // SSEConnectionTransport is "started" as soon as the SSE stream is open.
    // No action needed here — the stream was already established.
    this.logger.debug(`SSE transport started: ${this.sessionId}`);
  }

  /**
   * Send a JSON-RPC message TO the internal server.
   * Writes the message as an SSE event into the stream.
   */
  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    if (this._closed) {
      throw new Error('Transport is closed');
    }

    const payload = JSON.stringify(message);
    const sseText = formatSSEEvent(payload, {
      event: 'message',
      id: String(++this._messageEventId),
    });

    this.logger.debug(`SSE send → ${this.sessionId}: ${payload.slice(0, 200)}`);

    if (this._writeCallback) {
      this._writeCallback(sseText);
    } else {
      throw new Error('No write callback — SSE stream not yet established');
    }
  }

  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    this.logger.info(`SSE transport closed: ${this.sessionId}`);
    this.onclose?.();
  }

  // ─── Internal ────────────────────────────────────────────────────

  /**
   * Feed a raw message body (from POST) into the transport.
   * Parses it as JSON-RPC and fires onmessage.
   */
  feedMessage(raw: string): void {
    if (this._closed) return;

    try {
      const parsed = JSON.parse(raw);
      const message = parseMessage(parsed);
      this.logger.debug(`SSE recv ← ${this.sessionId}: ${raw.slice(0, 200)}`);
      this.onmessage?.(message);
    } catch (err) {
      this.logger.warn(`Failed to parse incoming message: ${(err as Error).message}`);
      this.onerror?.(new Error(`Failed to parse message: ${(err as Error).message}`));
    }
  }

  /**
   * Called by the acceptor when the session is destroyed.
   */
  destroy(): void {
    if (this._closed) return;
    this._closed = true;
    this.onclose?.();
  }

  /** Whether this transport is closed */
  isClosed(): boolean {
    return this._closed;
  }
}
