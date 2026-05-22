/**
 * ReverseMCPClient
 *
 * High-level client for connecting an MCP Server to a public MCP Client
 * via reverse SSE transport.
 *
 * Responsibilities:
 *  - Transport lifecycle management (create, start, monitor, destroy)
 *  - Single reconnection loop (no competing reconnect logic)
 *  - Proper MCP protocol re-binding on reconnect (complete initialize handshake)
 *  - Message buffering during disconnection
 *  - Lifecycle event emission
 *
 * This is the ONLY entry point that staff-mcp should use.
 * It replaces the old manual transport + reconnect loop pattern.
 */

import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReconnectOptions, Logger } from '../protocol/types.js';
import { ConnectionState, noopLogger } from '../protocol/types.js';
import { ReconnectionManager } from '../protocol/reconnect.js';

// ─── Options ────────────────────────────────────────────────────────

/** Options when using SSE transport */
export interface ReverseMCPClientSSEOptions {
  /** Base URL of the reverse MCP endpoint */
  url: string;
  /** Server name for identification */
  serverName: string;
  /** Auth token */
  authToken?: string;
  /** Reconnection policy */
  reconnect?: ReconnectOptions;
  /** Additional headers */
  headers?: Record<string, string>;
  /** Whether to skip TLS verification */
  insecureTls?: boolean;
}


// ─── Event Types ────────────────────────────────────────────────────

export type ReverseMCPClientEvent = 'connected' | 'disconnected' | 'reconnecting' | 'failed' | 'error';

export type ReverseMCPClientEvents = {
  connected: () => void;
  disconnected: () => void;
  reconnecting: (attempt: number) => void;
  failed: (error: Error) => void;
  error: (error: Error) => void;
};

// ─── Transport Factory Type ─────────────────────────────────────────

type TransportFactory = (logger: Logger) => Transport;

// ─── Client ─────────────────────────────────────────────────────────

export class ReverseMCPClient {
  private server: McpServer;
  private logger: Logger;
  private transportFactory: TransportFactory;
  private reconnectManager: ReconnectionManager;
  private transport?: Transport;
  private handlers = new Map<string, Set<Function>>();
  private _started = false;

  /**
   * Create a ReverseMCPClient with SSE transport (the common case).
   */
  static async createSSE(
    server: McpServer,
    options: ReverseMCPClientSSEOptions,
    logger?: Logger,
  ): Promise<ReverseMCPClient> {
    const { SSEReverseClientTransport } = await import('./sse-connector.js');
    const factory: TransportFactory = (log) =>
      new SSEReverseClientTransport(
        {
          url: options.url,
          serverName: options.serverName,
          authToken: options.authToken,
          reconnect: { enabled: false }, // managed by us
          headers: options.headers,
          insecureTls: options.insecureTls,
        },
        log,
      );
    return new ReverseMCPClient(server, factory, options.reconnect, logger);
    return new ReverseMCPClient(server, factory, options.reconnect, logger);
  }

  private constructor(
    server: McpServer,
    transportFactory: TransportFactory,
    reconnectOptions?: ReconnectOptions,
    logger?: Logger,
  ) {
    this.server = server;
    this.transportFactory = transportFactory;
    this.logger = logger ?? noopLogger;

    const opts = reconnectOptions ?? {};
    this.reconnectManager = new ReconnectionManager(
      {
        enabled: true,
        initialDelay: opts.initialDelay ?? 1000,
        maxDelay: opts.maxDelay ?? 30000,
        multiplier: opts.multiplier ?? 2,
        jitter: opts.jitter !== false,
        maxRetries: opts.maxRetries ?? 0,
      },
      this.logger,
    );

    this.reconnectManager.setReconnectHandler(() => this.doReconnect());
    this.reconnectManager.setStateChangeHandler((state) => this.setState(state));
  }

  // ─── Public API ──────────────────────────────────────────────────

  on<E extends keyof ReverseMCPClientEvents>(
    event: E,
    handler: ReverseMCPClientEvents[E],
  ): this {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
    return this;
  }

  /** Start connecting. Resolves when first connection succeeds. */
  async start(): Promise<void> {
    if (this._started) return;
    this._started = true;
    await this.reconnectManager.start();
  }

  /** Stop permanently. No more reconnection. */
  async stop(): Promise<void> {
    this._started = false;
    this.reconnectManager.close();
    await this.cleanupTransport();
    try { await this.server.close(); } catch {}
  }

  // ─── Internal: Reconnection ──────────────────────────────────────

  /**
   * SINGLE reconnection handler — called exclusively by ReconnectionManager.
   * No other code path creates transports or triggers connection.
   */
  private async doReconnect(): Promise<void> {
    // 1. Ensure old transport is fully cleaned up
    await this.cleanupTransport();

    // 2. Ensure Protocol is unbound (defensive, _onclose may already have run)
    try { await this.server.close(); } catch {}

    // 3. Create NEW transport (internal reconnect DISABLED — we own the policy)
    this.transport = this.transportFactory(this.logger);

    // 4. Wire transport-level errors
    this.transport.onerror = (err: Error) => {
      this.logger.error(`Transport error: ${err.message}`);
      this.emit('error', err);
    };

    // 5. Wire close → reconnection BEFORE Protocol.connect.
    //    Protocol.connect() wraps existing onclose preserving both handlers:
    //      newOnclose = () => { ourOnclose(); Protocol._onclose(); }
    //    This ensures Protocol._onclose() fires to clear _transport on disconnect.
    this.transport.onclose = () => {
      if (this._started) {
        this.reconnectManager.onDisconnected();
      }
    };

    // 6. Bind MCP Protocol to the transport → full initialize handshake.
    //    Protocol.connect() internally calls transport.start() — we must NOT
    //    call it ourselves, or SSEReverseClientTransport throws "already started".
    await this.server.connect(this.transport);

    // 7. Success — reset retry counter
    this.reconnectManager.onConnected();
  }

  private async cleanupTransport(): Promise<void> {
    if (this.transport) {
      try { await this.transport.close(); } catch {}
      this.transport = undefined;
    }
  }

  // ─── Internal: Events ────────────────────────────────────────────

  private emit(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      try { handler(...args); } catch {}
    }
  }

  private setState(state: ConnectionState): void {
    switch (state) {
      case ConnectionState.CONNECTED:
        this.emit('connected');
        break;
      case ConnectionState.RECONNECTING:
        this.emit('reconnecting', this.reconnectManager.getAttempts());
        break;
      case ConnectionState.CLOSED:
        this.emit('failed', new Error('Permanent connection failure'));
        break;
    }
  }
}
