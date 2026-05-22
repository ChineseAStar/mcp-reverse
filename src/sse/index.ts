// Backward compatibility barrel for "mcp-reverse/sse"
// All SSE types are re-exported from their new homes
export { SSEAcceptor } from '../acceptor/sse-acceptor.js';
export type {
  AcceptorConnection,
  ConnectionHandler,
  DisconnectionHandler,
  ErrorHandler,
} from '../acceptor/sse-acceptor.js';
export { SSEReverseClientTransport } from '../connector/sse-connector.js';
export { SSEConnectionTransport } from '../transport/sse-transport.js';
export { SSEParser, formatSSEEvent, formatSSEComment, formatSSEPing } from '../transport/sse-util.js';
export type { ParsedSSEEvent } from '../transport/sse-util.js';
