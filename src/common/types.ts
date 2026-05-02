/**
 * Common types for mcp-reverse-ws-transport
 */

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

/** Heartbeat (ping/pong) options */
export interface HeartbeatOptions {
  /** Enable heartbeat (default: true) */
  enabled?: boolean;
  /** Ping interval in milliseconds (default: 30000) */
  pingInterval?: number;
  /** Pong timeout in milliseconds (default: 10000) */
  pongTimeout?: number;
}

/** Options for the WebSocketAcceptor (client side - chat-ai) */
export interface WebSocketAcceptorOptions {
  /** Port to listen on */
  port: number;
  /** Host to bind to (default: '0.0.0.0') */
  host?: string;
  /** Path for WebSocket upgrade (default: '/ws') */
  path?: string;
  /** Optional TLS configuration */
  tls?: {
    cert: string;  // Path to cert file
    key: string;   // Path to key file
    minVersion?: 'TLSv1.2' | 'TLSv1.3';
  };
  /** Expected auth tokens (keyed by server name), empty = no auth */
  authTokens?: Record<string, string>;
  /** Validate connection metadata via callback */
  authHandler?: (metadata: ConnectionMetadata) => Promise<boolean>;
  /** Heartbeat configuration */
  heartbeat?: HeartbeatOptions;
  /** Maximum message size in bytes (default: 4MB) */
  maxMessageSize?: number;
  /** Timeout for the initial MCP handshake in ms (default: 30000) */
  handshakeTimeout?: number;
}

/** Options for the ReverseClientTransport (server side - internal MCP server) */
export interface ReverseClientTransportOptions {
  /** WebSocket URL to connect to (e.g. 'wss://public-chatai.example.com:9090/ws') */
  url: string;
  /** Server name for identification */
  serverName: string;
  /** Authentication token */
  authToken?: string;
  /** Reconnection options */
  reconnect?: ReconnectOptions;
  /** Heartbeat options */
  heartbeat?: HeartbeatOptions;
  /** Additional headers to send */
  headers?: Record<string, string>;
  /** Whether to skip TLS certificate verification (default: false) */
  insecureTls?: boolean;
  /** Additional query parameters */
  queryParams?: Record<string, string>;
}

/** Event types for WebSocketAcceptor */
export type WebSocketAcceptorEvent = 'connection' | 'disconnection' | 'error' | 'listening' | 'close';

/** Transport event types */
export type TransportEvent = 'close' | 'error' | 'message';

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
  debug: (...args) => console.debug('[mcp-reverse-ws]', ...args),
  info: (...args) => console.info('[mcp-reverse-ws]', ...args),
  warn: (...args) => console.warn('[mcp-reverse-ws]', ...args),
  error: (...args) => console.error('[mcp-reverse-ws]', ...args),
};

/** Connection state */
export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  CLOSED = 'closed',
}
