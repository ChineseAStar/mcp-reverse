/**
 * mcp-reverse — SSE module
 *
 * SSE-based reverse transport for web platforms (Next.js, Express, Deno, etc.).
 */
export { SSEAcceptor } from './acceptor.js';
export type { AcceptorConnection, ConnectionHandler, DisconnectionHandler, ErrorHandler } from './acceptor.js';
export { SSEConnectionTransport } from './connection-transport.js';
export { SSEReverseClientTransport } from './reverse-client.js';
export { SSEParser, formatSSEEvent, formatSSEComment, formatSSEPing } from './util.js';
export type { ParsedSSEEvent } from './util.js';
//# sourceMappingURL=index.d.ts.map