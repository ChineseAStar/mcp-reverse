/**
 * mcp-reverse — Client module
 *
 * High-level client for connecting MCP Servers to remote MCP Clients via reverse transports.
 */

export { ReverseMCPClient } from './reverse-mcp-client.js';
export type {
  ReverseMCPClientSSEOptions,
  ReverseMCPClientWSOptions,
  ReverseMCPClientEvent,
  ReverseMCPClientEvents,
} from './reverse-mcp-client.js';
