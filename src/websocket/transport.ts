/**
 * SingleConnectionTransport
 * 
 * Wraps a single WebSocket connection as an MCP Transport.
 * Used by the WebSocketAcceptor for each connected MCP server.
 * This is the Transport that the MCP Client uses to communicate
 * with a single reverse-connected MCP server.
 */

import type { Transport, TransportSendOptions } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';
import type { WebSocket } from 'ws';
import type { HeartbeatOptions, Logger } from '../common/types.js';
import { Heartbeat } from '../common/heartbeat.js';

// A local re-export of the schema to avoid breaking if the SDK changes path
const parseMessage = (raw: unknown): JSONRPCMessage => {
  return JSONRPCMessageSchema.parse(raw);
};

export class SingleConnectionTransport implements Transport {
  private ws: WebSocket;
  private heartbeat: Heartbeat;
  private _sessionId: string;
  private _closed: boolean = false;
  private logger: Logger;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(
    ws: WebSocket,
    sessionId: string,
    heartbeatOptions?: HeartbeatOptions,
    logger?: Logger,
  ) {
    this.ws = ws;
    this._sessionId = sessionId;
    this.logger = logger ?? { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    this.heartbeat = new Heartbeat(heartbeatOptions, logger);
  }

  get reverseSessionId(): string | undefined {
    return this._sessionId;
  }

  async start(): Promise<void> {
    if (this._closed) {
      throw new Error('Transport is closed');
    }

    this.ws.on('message', (data: Buffer) => {
      this.handleMessage(data);
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      this.logger.info(`WebSocket closed: code=${code} reason=${reason.toString()}`);
      this.heartbeat.stop();
      if (!this._closed) {
        this._closed = true;
        this.onclose?.();
      }
    });

    this.ws.on('error', (err: Error) => {
      this.logger.error(`WebSocket error: ${err.message}`);
      this.onerror?.(err);
    });

    // Start heartbeat if connection is already open
    if (this.ws.readyState === this.ws.OPEN) {
      this.heartbeat.start(this.ws, () => {
        this.ws.terminate();
      });
    }

    this.logger.info(`Transport started: sessionId=${this._sessionId}`);
  }

  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    if (this._closed) {
      throw new Error('Transport is closed');
    }

    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(message);
      this.ws.send(payload, (err) => {
        if (err) {
          this.logger.error(`Send failed: ${err.message}`);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;

    this.heartbeat.stop();
    this.ws.close(1000, 'Transport closed');
    this.logger.info(`Transport closed: sessionId=${this._sessionId}`);
  }

  /** Get the raw WebSocket (for advanced use) */
  getWebSocket(): WebSocket {
    return this.ws;
  }

  /** Whether this transport is closed */
  isClosed(): boolean {
    return this._closed;
  }

  private handleMessage(data: Buffer): void {
    if (this._closed) return;

    try {
      // Handle JSON messages
      const raw = JSON.parse(data.toString());
      const message = parseMessage(raw);
      this.onmessage?.(message);
    } catch (err) {
      // Skip processing errors to avoid crashing the event loop
      this.logger.warn(`Failed to parse message: ${(err as Error).message}`);
      this.onerror?.(new Error(`Failed to parse message: ${(err as Error).message}`));
    }
  }
}
