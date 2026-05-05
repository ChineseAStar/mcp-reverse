/**
 * mcp-reverse — Main entry point
 *
 * Reverse transports for MCP (Model Context Protocol).
 * Allows internal MCP servers behind NAT/firewall to actively connect
 * to public MCP clients.
 */

// ─── High-Level Client (recommended for all integrations) ─────────────

export { ReverseMCPClient } from './client/index.js';
export type {
  ReverseMCPClientSSEOptions,
  ReverseMCPClientWSOptions,
  ReverseMCPClientEvent,
  ReverseMCPClientEvents,
} from './client/index.js';

// ─── WebSocket Engine ────────────────────────────────────────────────

export { WebSocketAcceptor } from './websocket/index.js';
export type { AcceptorConnection as WSAcceptorConnection, ConnectionHandler as WSConnectionHandler, DisconnectionHandler as WSDisconnectionHandler, ErrorHandler as WSErrorHandler } from './websocket/index.js';
export { SingleConnectionTransport } from './websocket/index.js';
export { ReverseClientTransport } from './websocket/index.js';

// ─── SSE Engine ──────────────────────────────────────────────────────

export { SSEAcceptor } from './sse/index.js';
export type { AcceptorConnection as SSEAcceptorConnection, ConnectionHandler as SSEConnectionHandler, DisconnectionHandler as SSEDisconnectionHandler, ErrorHandler as SSEErrorHandler } from './sse/index.js';
export { SSEConnectionTransport } from './sse/index.js';
export { SSEReverseClientTransport } from './sse/index.js';
export { SSEParser, formatSSEEvent, formatSSEComment, formatSSEPing } from './sse/index.js';
export type { ParsedSSEEvent } from './sse/index.js';

// ─── Common Types ────────────────────────────────────────────────────

export type {
  ConnectionMetadata,
  ReconnectOptions,
  HeartbeatOptions,
  SSEHeartbeatOptions,
  WebSocketAcceptorOptions,
  ReverseClientTransportOptions,
  SSEAcceptorOptions,
  SSEAcceptorStandaloneOptions,
  SSEReverseClientTransportOptions,
  Logger,
} from './common/types.js';

export {
  ConnectionState,
  noopLogger,
  consoleLogger,
} from './common/types.js';

// ─── Utilities ───────────────────────────────────────────────────────

export { Heartbeat } from './common/heartbeat.js';
export { ReconnectionManager } from './common/reconnect.js';
