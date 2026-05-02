/**
 * mcp-reverse - Main entry point
 * 
 * A reverse WebSocket transport for MCP (Model Context Protocol).
 * Allows internal MCP servers behind NAT/firewall to actively connect
 * to public MCP clients.
 * 
 * ## Quick Start
 * 
 * ### MCP Client side (public, e.g. chat-ai):
 * ```typescript
 * import { WebSocketAcceptor } from '@anthropic/mcp-reverse';
 * import { Client } from '@modelcontextprotocol/sdk/client/index.js';
 * 
 * const acceptor = new WebSocketAcceptor({
 *   port: 9090,
 *   authTokens: { 'my-server': 'secret123' },
 * });
 * 
 * acceptor.onConnection(async ({ transport, metadata }) => {
 *   const client = new Client(
 *     { name: 'chat-ai', version: '1.0.0' },
 *     { capabilities: {} }
 *   );
 *   await client.connect(transport);
 *   // Use client.listTools(), client.callTool(), etc.
 * });
 * 
 * await acceptor.start();
 * ```
 * 
 * ### MCP Server side (internal, behind NAT):
 * ```typescript
 * import { ReverseClientTransport } from '@anthropic/mcp-reverse';
 * import { Server } from '@modelcontextprotocol/sdk/server/index.js';
 * 
 * const transport = new ReverseClientTransport({
 *   url: 'wss://public-chatai.example.com:9090/ws',
 *   serverName: 'my-server',
 *   authToken: 'secret123',
 * });
 * 
 * const server = new Server(
 *   { name: 'my-server', version: '1.0.0' },
 *   { capabilities: { tools: {} } }
 * );
 * 
 * await server.connect(transport);
 * ```
 */

// Client-side exports
export { WebSocketAcceptor } from './client/index.js';
export type { AcceptorConnection, ConnectionHandler, DisconnectionHandler, ErrorHandler } from './client/index.js';
export { SingleConnectionTransport } from './client/index.js';

// Server-side exports
export { ReverseClientTransport } from './server/index.js';

// Common types
export type {
  ConnectionMetadata,
  ReconnectOptions,
  HeartbeatOptions,
  WebSocketAcceptorOptions,
  ReverseClientTransportOptions,
  Logger,
} from './common/types.js';

export {
  ConnectionState,
  noopLogger,
  consoleLogger,
} from './common/types.js';

// Utilities
export { Heartbeat } from './common/heartbeat.js';
export { ReconnectionManager } from './common/reconnect.js';
