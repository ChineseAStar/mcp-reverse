/**
 * Proxy module — Types
 */

export interface ProxyConfig {
  /** Name of the expected internal MCP server (used for auth validation) */
  name: string;

  /** Authentication token the internal server must present */
  token: string;

  /** HTTP port for the proxy server (default: 3000) */
  port?: number;

  /** Host to bind to (default: '0.0.0.0') */
  host?: string;

  /** Path for the StreamableHTTP MCP client endpoint (default: '/mcp') */
  mcpPath?: string;

  /** Maximum message size in bytes (default: 4MB) */
  maxMessageSize?: number;
}
