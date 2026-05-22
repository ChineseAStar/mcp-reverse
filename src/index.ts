/**
 * mcp-reverse — Main entry point
 *
 * Reverse transports for MCP (Model Context Protocol).
 * Allows internal MCP servers behind NAT/firewall to actively connect
 * to public MCP clients via SSE.
 */

// ─── High-Level Connector (recommended for all integrations) ─────────

export { ReverseMCPClient } from './connector/mcp-connector.js';
export type {
  ReverseMCPClientSSEOptions,
  ReverseMCPClientEvent,
  ReverseMCPClientEvents,
} from './connector/mcp-connector.js';

// ─── Acceptor ────────────────────────────────────────────────────────

export { SSEAcceptor } from './acceptor/sse-acceptor.js';
export type { AcceptorConnection as SSEAcceptorConnection, ConnectionHandler as SSEConnectionHandler, DisconnectionHandler as SSEDisconnectionHandler, ErrorHandler as SSEErrorHandler } from './acceptor/sse-acceptor.js';

// ─── Connector (Reverse Transports) ──────────────────────────────────

export { SSEReverseClientTransport } from './connector/sse-connector.js';

// ─── Transport ───────────────────────────────────────────────────────

export { SSEConnectionTransport } from './transport/sse-transport.js';
export { SSEParser, formatSSEEvent, formatSSEComment, formatSSEPing } from './transport/sse-util.js';
export type { ParsedSSEEvent } from './transport/sse-util.js';

// ─── Protocol Types ──────────────────────────────────────────────────

export type {
  ConnectionMetadata,
  ReconnectOptions,
  SSEHeartbeatOptions,
  SSEAcceptorOptions,
  SSEAcceptorStandaloneOptions,
  SSEReverseClientTransportOptions,
  Logger,
} from './protocol/types.js';

export {
  ConnectionState,
  noopLogger,
  consoleLogger,
} from './protocol/types.js';

// ─── Proxy / Gateway ────────────────────────────────────────────────

export { ReverseProxy } from './proxy/index.js';
export type { ProxyConfig } from './proxy/index.js';

// ─── Utilities ───────────────────────────────────────────────────────

export { ReconnectionManager } from './protocol/reconnect.js';
