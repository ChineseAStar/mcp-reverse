/**
 * mcp-reverse — Main entry point
 *
 * Reverse transports for MCP (Model Context Protocol).
 * Allows internal MCP servers behind NAT/firewall to actively connect
 * to public MCP clients.
 *
 * ## Two Transport Engines
 *
 * | Engine     | Best for                                      | Protocol         |
 * |------------|-----------------------------------------------|------------------|
 * | WebSocket  | Native Node.js, low-latency, high-throughput  | `ws://` / `wss://` |
 * | SSE        | Next.js, Express, Deno, serverless platforms  | `http://` + SSE  |
 *
 * ## Quick Start — SSE (recommended for web platforms)
 *
 * ### Public side (e.g. chat-ai, Next.js App Router):
 * ```typescript
 * import { SSEAcceptor } from 'mcp-reverse';
 * import { Client } from '@modelcontextprotocol/sdk/client/index.js';
 *
 * const acceptor = new SSEAcceptor({ authTokens: { 'my-server': 'secret' } });
 *
 * acceptor.onConnection(async ({ transport, metadata }) => {
 *   const client = new Client({ name: 'chat-ai', version: '1.0.0' }, { capabilities: {} });
 *   await client.connect(transport);
 *   // Use client.listTools(), client.callTool(), etc.
 * });
 *
 * // Next.js App Router:
 * // GET /api/mcp-reverse/sse → acceptor.handleSSE(req)
 * // POST /api/mcp-reverse/message → acceptor.handleMessage(req)
 * ```
 *
 * ### Internal side (behind NAT):
 * ```typescript
 * import { SSEReverseClientTransport } from 'mcp-reverse';
 * import { Server } from '@modelcontextprotocol/sdk/server/index.js';
 *
 * const transport = new SSEReverseClientTransport({
 *   url: 'https://public-chatai.example.com:3000/mcp-reverse',
 *   serverName: 'my-server',
 *   authToken: 'secret',
 * });
 *
 * const server = new Server({ name: 'my-server', version: '1.0.0' }, { capabilities: {} });
 * await server.connect(transport);
 * ```
 *
 * ## Quick Start — WebSocket
 *
 * ### Public side:
 * ```typescript
 * import { WebSocketAcceptor } from 'mcp-reverse';
 *
 * const acceptor = new WebSocketAcceptor({ port: 9090, authTokens: { 'my-server': 'secret' } });
 * acceptor.onConnection(async ({ transport, metadata }) => { ... });
 * await acceptor.start();
 * ```
 *
 * ### Internal side:
 * ```typescript
 * import { ReverseClientTransport } from 'mcp-reverse';
 *
 * const transport = new ReverseClientTransport({
 *   url: 'wss://public-chatai.example.com:9090/ws',
 *   serverName: 'my-server',
 *   authToken: 'secret',
 * });
 * ```
 */
export { WebSocketAcceptor } from './websocket/index.js';
export type { AcceptorConnection as WSAcceptorConnection, ConnectionHandler as WSConnectionHandler, DisconnectionHandler as WSDisconnectionHandler, ErrorHandler as WSErrorHandler } from './websocket/index.js';
export { SingleConnectionTransport } from './websocket/index.js';
export { ReverseClientTransport } from './websocket/index.js';
export { SSEAcceptor } from './sse/index.js';
export type { AcceptorConnection as SSEAcceptorConnection, ConnectionHandler as SSEConnectionHandler, DisconnectionHandler as SSEDisconnectionHandler, ErrorHandler as SSEErrorHandler } from './sse/index.js';
export { SSEConnectionTransport } from './sse/index.js';
export { SSEReverseClientTransport } from './sse/index.js';
export { SSEParser, formatSSEEvent, formatSSEComment, formatSSEPing } from './sse/index.js';
export type { ParsedSSEEvent } from './sse/index.js';
export type { ConnectionMetadata, ReconnectOptions, HeartbeatOptions, SSEHeartbeatOptions, WebSocketAcceptorOptions, ReverseClientTransportOptions, SSEAcceptorOptions, SSEAcceptorStandaloneOptions, SSEReverseClientTransportOptions, Logger, } from './common/types.js';
export { ConnectionState, noopLogger, consoleLogger, } from './common/types.js';
export { Heartbeat } from './common/heartbeat.js';
export { ReconnectionManager } from './common/reconnect.js';
//# sourceMappingURL=index.d.ts.map