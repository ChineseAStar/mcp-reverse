/**
 * Common types for mcp-reverse
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
/** Heartbeat (ping/pong) options — WebSocket */
export interface HeartbeatOptions {
    /** Enable heartbeat (default: true) */
    enabled?: boolean;
    /** Ping interval in milliseconds (default: 30000) */
    pingInterval?: number;
    /** Pong timeout in milliseconds (default: 10000) */
    pongTimeout?: number;
}
/** SSE keepalive options */
export interface SSEHeartbeatOptions {
    /** Enable keepalive (default: true) */
    enabled?: boolean;
    /** Interval between keepalive pings in ms (default: 30000) */
    pingInterval?: number;
    /** Timeout waiting for next event before declaring dead (default: 45000) */
    readTimeout?: number;
}
/** Options for the WebSocketAcceptor (public MCP Client side) */
export interface WebSocketAcceptorOptions {
    /** Port to listen on */
    port: number;
    /** Host to bind to (default: '0.0.0.0') */
    host?: string;
    /** Path for WebSocket upgrade (default: '/ws') */
    path?: string;
    /** Optional TLS configuration */
    tls?: {
        cert: string;
        key: string;
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
/** Options for the WebSocket ReverseClientTransport (internal MCP Server side) */
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
    /** Reconnection options */
    reconnect?: ReconnectOptions;
    /** SSE keepalive options */
    heartbeat?: SSEHeartbeatOptions;
    /** Additional headers to send with every request */
    headers?: Record<string, string>;
    /** Whether to skip TLS certificate verification (default: false) */
    insecureTls?: boolean;
    /** Additional query parameters added to the SSE GET URL */
    queryParams?: Record<string, string>;
}
/** Event types for WebSocketAcceptor */
export type WebSocketAcceptorEvent = 'connection' | 'disconnection' | 'error' | 'listening' | 'close';
/** Event types for SSEAcceptor */
export type SSEAcceptorEvent = 'connection' | 'disconnection' | 'error';
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
export declare const noopLogger: Logger;
/** Minimal console logger */
export declare const consoleLogger: Logger;
/** Connection state */
export declare enum ConnectionState {
    DISCONNECTED = "disconnected",
    CONNECTING = "connecting",
    CONNECTED = "connected",
    RECONNECTING = "reconnecting",
    CLOSED = "closed"
}
//# sourceMappingURL=types.d.ts.map