/**
 * SSEReverseClientTransport
 *
 * Pure Transport implementation for reverse SSE connections.
 * Used by the internal MCP Server behind NAT/firewall.
 * Connects OUT to the public MCP Client (chat-ai) via SSE + HTTP POST.
 *
 * Architecture:
 *   GET  /mcp-reverse/sse        → open SSE stream (receive messages from Client)
 *   POST /mcp-reverse/message    → send messages to Client
 *
 * NOTE: This transport does NOT handle reconnection.
 * Reconnection policy is managed externally by ReverseMCPClient.
 *
 * Includes: connection timeout, keepalive monitoring, authentication,
 * and message buffering while the initial SSE connection is being established.
 */

import type { Transport, TransportSendOptions } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';
import type {
  SSEReverseClientTransportOptions,
  Logger,
} from '../protocol/types.js';
import { noopLogger } from '../protocol/types.js';
import { SSEParser } from '../transport/sse-util.js';

const parseMessage = (raw: unknown): JSONRPCMessage => {
  return JSONRPCMessageSchema.parse(raw);
};

const asError = (value: unknown): Error => {
  return value instanceof Error ? value : new Error(String(value));
};

type TransportState = 'idle' | 'connecting' | 'open' | 'closed';

type QueuedMessage = {
  message: JSONRPCMessage;
  resolve: () => void;
  reject: (err: Error) => void;
};

export class SSEReverseClientTransport implements Transport {
  private options: SSEReverseClientTransportOptions;
  private logger: Logger;
  private parser: SSEParser = new SSEParser();
  private _sessionId?: string;
  private state: TransportState = 'idle';
  private closeNotified = false;

  // All outbound messages use one FIFO queue. This prevents messages sent
  // just after connection establishment from overtaking messages that were
  // queued while the SSE GET was still connecting.
  private messageQueue: QueuedMessage[] = [];
  private drainPromise?: Promise<void>;

  // Keepalive
  private keepaliveTimer?: ReturnType<typeof setInterval>;
  private lastEventTime: number = 0;

  // The SSE GET and all POSTs share this signal so terminating the transport
  // also cancels any in-flight HTTP requests.
  private activeAbortController: AbortController | null = null;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(options: SSEReverseClientTransportOptions, logger?: Logger) {
    this.options = options;
    this.logger = logger ?? noopLogger;
  }

  get reverseSessionId(): string | undefined {
    return this._sessionId;
  }

  /** True only while the SSE stream is established and usable. */
  get isConnected(): boolean {
    return this.state === 'open';
  }

  // ─── Transport Interface ─────────────────────────────────────────

  async start(): Promise<void> {
    if (this.state !== 'idle') {
      if (this.state === 'closed') {
        throw new Error('SSEReverseClientTransport is closed');
      }
      throw new Error('SSEReverseClientTransport is already started');
    }

    this.state = 'connecting';
    this._sessionId = `${this.options.serverName}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    await this.doConnect();
  }

  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    if (this.state === 'closed') {
      throw new Error('Transport is closed');
    }
    if (this.state !== 'connecting' && this.state !== 'open') {
      throw new Error('Transport is not connected');
    }

    const result = new Promise<void>((resolve, reject) => {
      this.messageQueue.push({ message, resolve, reject });
    });

    if (this.state === 'open') {
      void this.drainQueue();
    }

    return result;
  }

  async close(): Promise<void> {
    if (this.state === 'closed') return;

    this.terminate(new Error('Transport closed'), false);
    this.logger.info('SSEReverseClientTransport closed');
  }

  // ─── Internal: Connection Establishment ──────────────────────────

  private buildSSEUrl(): string {
    const base = this.options.url.replace(/\/$/, '');
    const url = new URL(`${base}/sse`);
    url.searchParams.set('server_name', this.options.serverName);
    if (this.options.queryParams) {
      for (const [key, value] of Object.entries(this.options.queryParams)) {
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  private buildMessageUrl(): string {
    const base = this.options.url.replace(/\/$/, '');
    const url = new URL(`${base}/message`);
    url.searchParams.set('sessionId', this._sessionId ?? '');
    return url.toString();
  }

  private buildSSEHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'X-MCP-Server-Name': this.options.serverName,
      'Accept': 'text/event-stream',
    };
    if (this.options.authToken) {
      headers['Authorization'] = `Bearer ${this.options.authToken}`;
    }
    if (this.options.headers) {
      Object.assign(headers, this.options.headers);
    }
    return headers;
  }

  private buildMessageHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-MCP-Server-Name': this.options.serverName,
      'X-Session-Id': this._sessionId ?? '',
    };
    if (this.options.authToken) {
      headers['Authorization'] = `Bearer ${this.options.authToken}`;
    }
    if (this.options.headers) {
      Object.assign(headers, this.options.headers);
    }
    return headers;
  }

  /**
   * Establish the SSE connection.
   *
   * A failed attempt MUST reject. ReverseMCPClient owns the retry loop and
   * cannot distinguish success from failure if errors are swallowed here.
   */
  private async doConnect(): Promise<void> {
    const connectTimeout = this.options.connectTimeout ?? 15_000;
    let timedOut = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

    try {
      // URL construction and logger callbacks are part of the connection
      // attempt too. If either throws, terminate the transport so an MCP SDK
      // that already owns it can clear its internal binding via onclose.
      const url = this.buildSSEUrl();
      const headers = this.buildSSEHeaders();
      this.logger.info(`SSE connecting to ${url}`);

      const controller = new AbortController();
      this.activeAbortController = controller;

      if (connectTimeout > 0) {
        timeoutTimer = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, connectTimeout);
      }

      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = undefined;
      }

      if (!response.ok) {
        throw new Error(`SSE connection failed: HTTP ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('SSE connection failed: no response body');
      }

      if (this.state === 'closed') {
        throw new Error('Transport closed during connection establishment');
      }

      const sid = response.headers.get('x-session-id');
      if (sid) {
        this._sessionId = sid;
      }

      this.state = 'open';
      this.lastEventTime = Date.now();
      this.logger.info(`SSE connected: ${url} (session: ${this._sessionId})`);

      this.startKeepalive();

      // Start the reader before draining queued messages so incoming replies
      // can be processed as soon as the first POST is sent.
      void this.readSSEStream(response.body);
      await this.drainQueue();

      if (this.state !== 'open') {
        throw new Error('SSE connection closed during startup');
      }
    } catch (value) {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }

      const error = timedOut
        ? new Error(`SSE connection timed out after ${connectTimeout}ms`)
        : asError(value);

      if (!this.isClosed()) {
        this.logger.error(`SSE connection error: ${error.message}`);
        this.terminate(error, true);
      }

      throw error;
    }
  }

  /** Read SSE events until the stream ends or the transport is terminated. */
  private async readSSEStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();

    try {
      while (this.state === 'open') {
        const { done, value } = await reader.read();

        if (done) {
          if (this.state === 'open') {
            this.logger.info('SSE stream ended');
            this.terminate(new Error('SSE stream ended'), false);
          }
          return;
        }

        const chunk = decoder.decode(value, { stream: true });
        this.lastEventTime = Date.now();

        const events = this.parser.feed(chunk);
        for (const event of events) {
          if (event.event === 'message' || event.event === '') {
            this.handleIncomingEvent(event);
          }
        }
      }
    } catch (value) {
      if (this.state === 'closed') return;

      const error = asError(value);
      if (error.name === 'AbortError') {
        this.logger.debug('SSE stream read aborted');
      } else {
        this.logger.error(`SSE stream read error: ${error.message}`);
      }
      this.terminate(error, error.name !== 'AbortError');
    } finally {
      try { reader.releaseLock(); } catch { /* already released */ }
    }
  }

  /**
   * Move the transport to its terminal state and notify the MCP SDK exactly
   * once. A transport instance is never reused after a disconnect.
   */
  private terminate(error: Error, reportError: boolean): void {
    if (this.state === 'closed') return;

    this.state = 'closed';
    this.stopKeepalive();
    this.parser.reset();

    const controller = this.activeAbortController;
    this.activeAbortController = null;
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }

    this.rejectQueue(error);

    if (reportError) {
      try { this.onerror?.(error); } catch { /* consumer callback */ }
    }

    if (!this.closeNotified) {
      this.closeNotified = true;
      try { this.onclose?.(); } catch { /* consumer callback */ }
    }
  }

  // ─── Internal: Message Posting ───────────────────────────────────

  private async postMessage(message: JSONRPCMessage): Promise<void> {
    if (this.state !== 'open' || !this._sessionId) {
      throw new Error('No active session');
    }

    const messageUrl = this.buildMessageUrl();
    const headers = this.buildMessageHeaders();
    const payload = JSON.stringify(message);
    this.logger.debug(`SSE POST → ${messageUrl}: ${payload.slice(0, 200)}`);

    try {
      const response = await fetch(messageUrl, {
        method: 'POST',
        headers,
        body: payload,
        signal: this.activeAbortController?.signal,
      });

      if (!response.ok) {
        throw new Error(`POST failed: HTTP ${response.status} ${response.statusText}`);
      }
    } catch (value) {
      const error = asError(value);
      if (!this.isClosed()) {
        this.logger.error(`SSE POST error: ${error.message}`);
        // A failed POST leaves delivery and session validity unknown. Retire
        // this transport and let the owner establish a fresh MCP session.
        this.terminate(error, true);
      }
      throw error;
    }
  }

  private handleIncomingEvent(event: { data: string }): void {
    if (this.state !== 'open') return;

    try {
      const raw = JSON.parse(event.data);
      const message = parseMessage(raw);
      this.logger.debug(`SSE recv ←: ${event.data.slice(0, 200)}`);
      this.onmessage?.(message);
    } catch (value) {
      const error = asError(value);
      this.logger.warn(`Failed to parse incoming SSE event: ${error.message}`);
      this.onerror?.(new Error(`Failed to parse SSE event: ${error.message}`));
    }
  }

  // ─── Internal: Keepalive ─────────────────────────────────────────

  private startKeepalive(): void {
    const hb = this.options.heartbeat;
    if (hb?.enabled === false) return;

    const readTimeout = hb?.readTimeout ?? 45_000;
    const pingInterval = hb?.pingInterval ?? 30_000;

    this.keepaliveTimer = setInterval(() => {
      const elapsed = Date.now() - this.lastEventTime;
      if (elapsed > readTimeout) {
        const error = new Error(`SSE read timeout: no event for ${elapsed}ms`);
        this.logger.warn(error.message);
        this.terminate(error, true);
      }
    }, Math.min(pingInterval, readTimeout) / 2);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = undefined;
    }
  }

  private isClosed(): boolean {
    return this.state === 'closed';
  }

  // ─── Internal: Queue ─────────────────────────────────────────────

  private drainQueue(): Promise<void> {
    if (this.drainPromise) return this.drainPromise;

    const task = (async () => {
      while (this.state === 'open' && this.messageQueue.length > 0) {
        const queued = this.messageQueue.shift()!;
        try {
          await this.postMessage(queued.message);
          queued.resolve();
        } catch (value) {
          queued.reject(asError(value));
          // postMessage terminates the transport and rejects the remaining queue.
          return;
        }
      }
    })();

    this.drainPromise = task.finally(() => {
      this.drainPromise = undefined;
      if (this.state === 'open' && this.messageQueue.length > 0) {
        void this.drainQueue();
      }
    });
    return this.drainPromise;
  }

  private rejectQueue(error: Error): void {
    const queue = this.messageQueue.splice(0);
    for (const { reject } of queue) {
      reject(error);
    }
  }
}
