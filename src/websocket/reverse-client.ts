/**
 * ReverseClientTransport
 * 
 * Pure Transport implementation for reverse WebSocket connections.
 * Used by the internal MCP Server behind NAT/firewall.
 * Connects out to the public MCP Client (chat-ai) via WebSocket.
 * 
 * NOTE: This transport does NOT handle reconnection.
 * Reconnection policy is managed externally by ReverseMCPClient.
 * 
 * Includes: heartbeat, authentication, message buffering.
 */

import type { Transport, TransportSendOptions } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';
import WebSocket from 'ws';
import type {
  ReverseClientTransportOptions,
  HeartbeatOptions,
  Logger,
} from '../common/types.js';
import { noopLogger } from '../common/types.js';
import { Heartbeat } from '../common/heartbeat.js';

const parseMessage = (raw: unknown): JSONRPCMessage => {
  return JSONRPCMessageSchema.parse(raw);
};

export class ReverseClientTransport implements Transport {
  private ws?: WebSocket;
  private options: ReverseClientTransportOptions;
  private logger: Logger;
  private heartbeat: Heartbeat;
  private _sessionId?: string;
  private _closed: boolean = false;
  private _started: boolean = false;

  // Message buffering during reconnection
  private pendingMessages: Array<{ message: JSONRPCMessage; resolve: () => void; reject: (err: Error) => void }> = [];

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(options: ReverseClientTransportOptions, logger?: Logger) {
    this.options = options;
    this.logger = logger ?? noopLogger;

    const heartbeatOpts: HeartbeatOptions = options.heartbeat ?? { enabled: true };
    this.heartbeat = new Heartbeat(heartbeatOpts, logger);
  }

  get reverseSessionId(): string | undefined {
    return this._sessionId;
  }

  // ─── Transport Interface ─────────────────────────────────────────

  async start(): Promise<void> {
    if (this._started) {
      throw new Error('ReverseClientTransport is already started');
    }
    if (this._closed) {
      throw new Error('ReverseClientTransport is closed');
    }

    this._started = true;
    await this.doConnect();
  }

  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    if (this._closed) {
      throw new Error('Transport is closed');
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return new Promise<void>((resolve, reject) => {
        this.pendingMessages.push({ message, resolve, reject });
      });
    }

    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(message);
      this.ws!.send(payload, (err) => {
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
    this._started = false;

    this.heartbeat.stop();
    this.flushPendingMessages(new Error('Transport closed'));

    if (this.ws) {
      this.ws.close(1000, 'Transport closed');
      this.ws = undefined;
    }

    this.logger.info('ReverseClientTransport closed');
  }

  /** Get the underlying WebSocket (for testing/advanced use) */
  getWebSocket(): WebSocket | undefined {
    return this.ws;
  }

  // ─── Internal ────────────────────────────────────────────────────

  private buildUrl(): string {
    const url = new URL(this.options.url);
    url.searchParams.set('server_name', this.options.serverName);
    if (this.options.authToken) {
      url.searchParams.set('token', this.options.authToken);
    }
    if (this.options.queryParams) {
      for (const [key, value] of Object.entries(this.options.queryParams)) {
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'X-MCP-Server-Name': this.options.serverName,
    };
    if (this.options.authToken) {
      headers['Authorization'] = `Bearer ${this.options.authToken}`;
    }
    if (this.options.headers) {
      Object.assign(headers, this.options.headers);
    }
    return headers;
  }

  private async doConnect(): Promise<void> {
    if (this._closed) return;

    const url = this.buildUrl();
    const headers = this.buildHeaders();

    this.logger.info(`Connecting to ${url}`);

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url, {
        headers,
        rejectUnauthorized: !this.options.insecureTls,
        handshakeTimeout: 15000,
      });

      const connectTimeout = setTimeout(() => {
        ws.close();
        reject(new Error('Connection timeout'));
      }, 20000);

      ws.on('open', () => {
        clearTimeout(connectTimeout);
        this.ws = ws;
        this._sessionId = `${this.options.serverName}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

        this.setupMessageHandler(ws);
        this.setupCloseHandler(ws);
        this.setupErrorHandler(ws);

        this.heartbeat.start(ws, () => {
          this.logger.warn('Heartbeat timeout, terminating connection');
          ws.terminate();
        });

        this.flushPendingMessages();
        this.logger.info(`Connected to ${url}`);
        resolve();
      });

      ws.on('error', (err: Error & { code?: string }) => {
        clearTimeout(connectTimeout);
        this.logger.error(`Connection error to ${url}: ${err.message} (code: ${err.code ?? 'unknown'})`);
        reject(err);
      });
    });
  }

  private setupMessageHandler(ws: WebSocket): void {
    ws.on('message', (data: Buffer) => {
      if (this._closed) return;

      try {
        const raw = JSON.parse(data.toString());
        const message = parseMessage(raw);
        this.onmessage?.(message);
      } catch (err) {
        this.logger.warn(`Failed to parse message: ${(err as Error).message}`);
        this.onerror?.(new Error(`Failed to parse message: ${(err as Error).message}`));
      }
    });
  }

  private setupCloseHandler(ws: WebSocket): void {
    ws.on('close', (code: number, reason: Buffer) => {
      this.logger.info(`WebSocket closed: code=${code} reason=${reason.toString().slice(0, 100)}`);
      this.heartbeat.stop();

      if (!this._closed) {
        this.onclose?.();
      }
    });
  }

  private setupErrorHandler(ws: WebSocket): void {
    ws.on('error', (err: Error) => {
      this.logger.error(`WebSocket error: ${err.message}`);
      this.onerror?.(err);
    });
  }

  private flushPendingMessages(rejection?: Error): void {
    const messages = this.pendingMessages.splice(0);
    for (const { resolve, reject } of messages) {
      if (rejection) {
        reject(rejection);
      } else {
        resolve();
      }
    }
  }
}
