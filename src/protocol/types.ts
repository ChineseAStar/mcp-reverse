/**
 * Common types for mcp-reverse
 */

// ─── Connection Metadata ────────────────────────────────────────────

/** Metadata provided by the internal server when connecting */
export interface ConnectionMetadata {
  /** Name identifying the MCP server */
  serverName: string;
  /** Optional authentication token */
  authToken?: string;
  /** Optional protocol version */
  protocolVersion?: string;
  /** Additional arbitrary metadata */
  extra?: Record<string, string>;
}

// ─── Reconnection ────────────────────────────────────────────────────

/** Reconnection strategy options */
export interface ReconnectOptions {
  /** Enable automatic reconnection (default: true) */
  enabled?: boolean;
  /** Initial delay in milliseconds (default: 1000) */
  initialDelay?: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelay?: number;
  /** Backoff multiplier (default: 2) */
  multiplier?: number;
  /** Whether to add jitter (default: true) */
  jitter?: boolean;
  /** Maximum number of retries, 0 = infinite (default: 0) */
  maxRetries?: number;
}

// ─── Heartbeat ───────────────────────────────────────────────────────


/** SSE keepalive options */
export interface SSEHeartbeatOptions {
  /** Enable keepalive (default: true) */
  enabled?: boolean;
  /** Interval between keepalive pings in ms (default: 30000) */
  pingInterval?: number;
  /** Timeout waiting for next event before declaring dead (default: 45000) */
  readTimeout?: number;
}

// ─── SSE Acceptor ────────────────────────────────────────────────────

/** Options for the SSEAcceptor (public MCP Client side) */
export interface SSEAcceptorOptions {
  /**
   * Authentication tokens keyed by server name.
   * When set, every connection must provide a matching Bearer token.
   * Empty map = no auth.
   */
  authTokens?: Record<string, string>;

  /**
   * Custom auth handler. Receives metadata from the connecting server;
   * return true to allow, false to reject.
   */
  authHandler?: (metadata: ConnectionMetadata) => Promise<boolean>;

  /** SSE keepalive configuration */
  heartbeat?: SSEHeartbeatOptions;

  /** Maximum message size for POST body in bytes (default: 4MB) */
  maxMessageSize?: number;

  /** Session timeout in ms — if no POST arrives within this window, the session is evicted (default: 60000) */
  sessionTimeout?: number;

  /** Path prefix for SSE and message endpoints (default: '/mcp-reverse') */
  pathPrefix?: string;
}

/** Options for the SSEAcceptor standalone HTTP server (optional) */
export interface SSEAcceptorStandaloneOptions extends SSEAcceptorOptions {
  /** Port to listen on */
  port: number;
  /** Host to bind to (default: '0.0.0.0') */
  host?: string;
}

// ─── SSE Reverse Client ──────────────────────────────────────────────

/** Options for the SSEReverseClientTransport (internal MCP Server side) */
export interface SSEReverseClientTransportOptions {
  /**
   * Base URL of the public SSE acceptor endpoint.
   * The client appends '/sse' for the event stream and '/message' for POSTs.
   * Example: 'https://public-chatai.example.com:3000/mcp-reverse'
   */
  url: string;
  /** Server name for identification */
  serverName: string;
  /** Authentication token */
  authToken?: string;
  /** @deprecated Low-level transports do not reconnect; use ReverseMCPClient instead. */
  reconnect?: ReconnectOptions;
  /** SSE keepalive options */
  heartbeat?: SSEHeartbeatOptions;
  /** Additional headers to send with every request */
  headers?: Record<string, string>;
  /** @deprecated Reserved for compatibility; the built-in fetch transport does not bypass TLS verification. */
  insecureTls?: boolean;
  /** Timeout for establishing the SSE connection in ms (default: 15000, 0 = disabled) */
  connectTimeout?: number;
  /** Additional query parameters added to the SSE GET URL */
  queryParams?: Record<string, string>;
}

// ─── Event Types ─────────────────────────────────────────────────────


/** Event types for SSEAcceptor */
export type SSEAcceptorEvent = 'connection' | 'disconnection' | 'error';

/** Transport event types */
export type TransportEvent = 'close' | 'error' | 'message';

// ─── Logging ─────────────────────────────────────────────────────────

/** Log levels */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Logger interface */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/** Default noop logger */
export const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Minimal console logger */
export const consoleLogger: Logger = {
  debug: (...args) => console.debug('[mcp-reverse]', ...args),
  info: (...args) => console.info('[mcp-reverse]', ...args),
  warn: (...args) => console.warn('[mcp-reverse]', ...args),
  error: (...args) => console.error('[mcp-reverse]', ...args),
};

// ─── Connection State ────────────────────────────────────────────────

/** Connection state */
export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  CLOSED = 'closed',
}
