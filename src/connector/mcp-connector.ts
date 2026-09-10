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
 *  - Lifecycle event emission
 *
 * This is the ONLY entry point that staff-mcp should use.
 */

import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReconnectOptions, SSEHeartbeatOptions, Logger } from '../protocol/types.js';
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
  /** @deprecated Reserved for compatibility; the built-in fetch transport does not bypass TLS verification. */
  insecureTls?: boolean;
  /** Timeout for establishing each SSE connection in ms (default: 15000, 0 = disabled) */
  connectTimeout?: number;
  /** Timeout for MCP initialization after SSE opens (default: 15000 ms, must be positive). */
  initializationTimeout?: number;
  /** SSE liveness monitoring; independent of tool execution timeouts. */
  heartbeat?: SSEHeartbeatOptions;
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

interface ManagedTransport extends Transport {
  /** Optional runtime signal exposed by transports managed by this client. */
  readonly isConnected?: boolean;
}

type TransportFactory = (logger: Logger) => ManagedTransport;

const asError = (value: unknown): Error => {
  return value instanceof Error ? value : new Error(String(value));
};

// ─── Client ─────────────────────────────────────────────────────────

export class ReverseMCPClient {
  private server: McpServer;
  private logger: Logger;
  private transportFactory: TransportFactory;
  private reconnectManager: ReconnectionManager;
  private transport?: ManagedTransport;
  private handlers = new Map<string, Set<Function>>();
  private _started = false;
  private permanentlyStopped = false;
  private lifecycleGeneration = 0;
  private initializationTimeout = 15_000;
  private cancelInitialization?: (error: Error) => void;

  /** Create a ReverseMCPClient with SSE transport (the common case). */
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
          connectTimeout: options.connectTimeout,
          heartbeat: options.heartbeat,
        },
        log,
      );
    const client = new ReverseMCPClient(server, factory, options.reconnect, logger);
    const initializationTimeout = options.initializationTimeout ?? 15_000;
    if (!Number.isFinite(initializationTimeout) || initializationTimeout <= 0) {
      throw new RangeError('initializationTimeout must be a positive number');
    }
    client.initializationTimeout = initializationTimeout;
    return client;
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
        enabled: opts.enabled !== false,
        initialDelay: opts.initialDelay ?? 1000,
        maxDelay: opts.maxDelay ?? 30000,
        multiplier: opts.multiplier ?? 2,
        jitter: opts.jitter !== false,
        maxRetries: opts.maxRetries ?? 0,
        stableConnectionMs: opts.stableConnectionMs ?? 30_000,
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

  /** Start the connection/reconnection loop. */
  async start(): Promise<void> {
    if (this.permanentlyStopped) {
      throw new Error('ReverseMCPClient has been stopped permanently');
    }
    if (this._started) return;

    this._started = true;
    this.lifecycleGeneration++;
    try {
      await this.reconnectManager.start();
    } catch (error) {
      this._started = false;
      throw error;
    }
  }

  /** Stop permanently. No more reconnection. */
  async stop(): Promise<void> {
    if (this.permanentlyStopped) return;

    this._started = false;
    this.permanentlyStopped = true;
    this.lifecycleGeneration++;
    this.reconnectManager.close();
    this.cancelInitialization?.(new Error('ReverseMCPClient stopped during initialization'));
    await this.cleanupTransport();
    try { await this.server.close(); } catch { /* already unbound */ }
  }

  // ─── Internal: Reconnection ──────────────────────────────────────

  /** Perform exactly one complete connection attempt. */
  private async doReconnect(): Promise<void> {
    const generation = this.lifecycleGeneration;
    this.assertActive(generation);

    // Detach first so closing an old transport cannot schedule another retry.
    await this.cleanupTransport();
    this.assertActive(generation);

    // Defensive cleanup for SDK versions where a failed transport.start()
    // could leave Protocol bound to the old transport.
    try { await this.server.close(); } catch { /* already unbound */ }
    this.assertActive(generation);

    const candidate = this.transportFactory(this.logger);
    this.transport = candidate;
    const protocol = this.server.server;
    const previousInitialized = protocol.oninitialized;
    let resolveInitialized!: () => void;
    let rejectInitialized!: (error: Error) => void;
    const initialized = new Promise<void>((resolve, reject) => {
      resolveInitialized = resolve;
      rejectInitialized = reject;
    });
    // stop()/onclose may reject before server.connect() returns; always observe that rejection.
    void initialized.catch(() => {});
    this.cancelInitialization = rejectInitialized;
    const onInitialized = () => {
      if (this.transport !== candidate || !this._started || generation !== this.lifecycleGeneration) return;
      try {
        previousInitialized?.call(protocol);
        resolveInitialized();
      } catch (error) {
        rejectInitialized(asError(error));
      }
    };
    protocol.oninitialized = onInitialized;
    let initializationTimer: ReturnType<typeof setTimeout> | undefined;

    try {
      // Protocol.connect() owns the transport and invokes transport.start().
      // A failed start must reject and the transport must fire onclose so the
      // SDK clears its internal _transport binding before the next attempt.
      await this.server.connect(candidate);
      this.assertActive(generation, candidate);

      this.attachRuntimeHandlers(candidate, generation, rejectInitialized);

      // Covers closure after Protocol.connect() resolves but before our runtime wrapper runs.
      if (candidate.isConnected === false) {
        throw new Error('Transport closed during connection establishment');
      }
      initializationTimer = setTimeout(() => {
        rejectInitialized(new Error(`MCP initialization timed out after ${this.initializationTimeout}ms`));
      }, this.initializationTimeout);
      await initialized;
      this.assertActive(generation, candidate);
    } catch (value) {
      const error = asError(value);
      if (this.transport === candidate) {
        this.transport = undefined;
      }

      try { await candidate.close(); } catch { /* best effort */ }
      try { await this.server.close(); } catch { /* already unbound */ }

      if (this._started && generation === this.lifecycleGeneration) {
        this.emit('error', error);
      }
      throw error;
    } finally {
      if (initializationTimer) clearTimeout(initializationTimer);
      if (protocol.oninitialized === onInitialized) protocol.oninitialized = previousInitialized;
      if (this.cancelInitialization === rejectInitialized) this.cancelInitialization = undefined;
    }
  }

  /**
   * Protocol.connect() replaces transport callbacks. Compose our lifecycle
   * hooks only after it succeeds so this works with both old and new SDKs.
   */
  private attachRuntimeHandlers(
    candidate: ManagedTransport,
    generation: number,
    rejectInitialization: (error: Error) => void,
  ): void {
    const protocolOnClose = candidate.onclose;
    let closeHandled = false;

    candidate.onclose = () => {
      if (closeHandled) return;
      closeHandled = true;
      rejectInitialization(new Error('Transport closed before MCP initialization settled'));

      try {
        protocolOnClose?.();
      } finally {
        if (this.transport !== candidate) return;

        this.transport = undefined;
        if (this._started && generation === this.lifecycleGeneration) {
          this.emit('disconnected');
          void this.reconnectManager.onDisconnected();
        }
      }
    };

    const protocolOnError = candidate.onerror;
    candidate.onerror = (error: Error) => {
      try {
        protocolOnError?.(error);
      } finally {
        if (this.transport === candidate
          && this._started
          && generation === this.lifecycleGeneration) {
          this.logger.error(`Transport error: ${error.message}`);
          this.emit('error', error);
        }
      }
    };
  }

  private assertActive(generation: number, candidate?: ManagedTransport): void {
    if (!this._started || generation !== this.lifecycleGeneration) {
      throw new Error('ReverseMCPClient stopped during connection attempt');
    }
    if (candidate && this.transport !== candidate) {
      throw new Error('Connection attempt was superseded');
    }
  }

  private async cleanupTransport(): Promise<void> {
    const transport = this.transport;
    if (!transport) return;

    // Clear identity before close; a late onclose from this transport must not
    // be interpreted as a disconnect of the next generation.
    this.transport = undefined;
    try { await transport.close(); } catch { /* best effort */ }
  }

  // ─── Internal: Events ────────────────────────────────────────────

  private emit(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      try { handler(...args); } catch { /* consumer callback */ }
    }
  }

  private setState(state: ConnectionState): void {
    if (!this._started) return;

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
