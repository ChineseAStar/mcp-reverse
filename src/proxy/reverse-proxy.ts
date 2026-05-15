/**
 * ReverseProxy
 *
 * A single-port HTTP gateway that bridges:
 *   MCP Client (StreamableHTTP /mcp)  ←→  Internal MCP Server (Reverse SSE)
 *
 * ┌──────────────────┐     StreamableHTTP      ┌──────────────────────┐     SSE Reverse      ┌──────────────────┐
 * │  MCP Client      │ ◄─────────────────────► │  ReverseProxy        │ ◄───────────────────►│  Internal MCP    │
 * │  (Claude, etc.)  │    /mcp                 │  (single port)       │  /mcp/reverse/sse   │  Server (NAT)    │
 * └──────────────────┘                        └──────────────────────┘                     └──────────────────┘
 *
 * Pure message relay — does NOT parse or understand JSON-RPC content.
 * Messages flow transparently between transports in both directions.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEAcceptor } from '../sse/index.js';
import type { SSEConnectionTransport } from '../sse/index.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { Logger } from '../common/types.js';
import { noopLogger } from '../common/types.js';
import type { ProxyConfig } from './types.js';

// ─── Helpers ──────────────────────────────────────────────────────────

function readBody(req: IncomingMessage, maxSize: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxSize) {
        req.destroy();
        reject(new Error('Payload too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

// ─── ReverseProxy ─────────────────────────────────────────────────────

export class ReverseProxy {
  private config: Required<ProxyConfig>;
  private logger: Logger;
  private httpServer?: Server;
  private httpTransport: StreamableHTTPServerTransport;
  private sseAcceptor: SSEAcceptor;
  private reverseTransport: SSEConnectionTransport | null = null;

  constructor(config: ProxyConfig, logger?: Logger) {
    this.logger = logger ?? noopLogger;
    this.config = {
      name: config.name,
      token: config.token,
      port: config.port ?? 3000,
      host: config.host ?? '0.0.0.0',
      mcpPath: config.mcpPath ?? '/mcp',
      maxMessageSize: config.maxMessageSize ?? 4 * 1024 * 1024,
    };

    // ── StreamableHTTP transport (faces MCP Client) ──────────────

    this.httpTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });

    // Bridge: MCP Client → Internal Server
    this.httpTransport.onmessage = (msg: JSONRPCMessage) => {
      this.forwardToReverse(msg);
    };

    // ── SSE Acceptor (faces Internal MCP Server) ─────────────────

    this.sseAcceptor = new SSEAcceptor(
      {
        authTokens: { [this.config.name]: this.config.token },
        pathPrefix: '/mcp/reverse',
        maxMessageSize: this.config.maxMessageSize,
      },
      this.logger,
    );

    // When internal server connects
    this.sseAcceptor.onConnection((conn) => {
      this.reverseTransport = conn.transport;
      this.logger.info(
        `Internal server '${conn.metadata.serverName}' connected (session: ${conn.sessionId})`,
      );

      // Bridge: Internal Server → MCP Client
      conn.transport.onmessage = (msg: JSONRPCMessage) => {
        this.httpTransport.send(msg).catch((err: Error) => {
          this.logger.error(`Failed to send to MCP client: ${err.message}`);
        });
      };
    });

    // When internal server disconnects
    this.sseAcceptor.onDisconnection((serverName: string) => {
      this.reverseTransport = null;
      this.logger.info(`Internal server '${serverName}' disconnected`);
    });
  }

  // ── Forwarding ──────────────────────────────────────────────────

  /** Forward a message from the MCP Client to the Internal Server */
  private forwardToReverse(msg: JSONRPCMessage): void {
    if (!this.reverseTransport) {
      this.logger.warn('No internal server connected — rejecting message');
      this.httpTransport
        .send({
          jsonrpc: '2.0',
          id: (msg as Record<string, unknown>).id ?? null,
          error: {
            code: -32002,
            message:
              'No internal server connected. Ensure the MCP server is running and has connected to the reverse proxy.',
          },
        } as JSONRPCMessage)
        .catch(() => {});
      return;
    }

    this.reverseTransport.send(msg).catch((err: Error) => {
      this.logger.error(`Failed to forward to internal server: ${err.message}`);
    });
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  /** Start the proxy HTTP server */
  async start(): Promise<void> {
    this.httpServer = createServer(async (req, res) => {
      try {
        await this.routeRequest(req, res);
      } catch (err) {
        this.logger.error(`Unhandled request error: ${(err as Error).message}`);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Internal server error');
        }
      }
    });

    return new Promise((resolve, reject) => {
      this.httpServer!.listen(this.config.port, this.config.host, () => {
        this.logger.info(
          `mcp-reverse proxy started on http://${this.config.host}:${this.config.port}`,
        );
        this.logger.info(`  MCP endpoint:  ${this.config.mcpPath}`);
        this.logger.info(`  Reverse SSE:   /mcp/reverse/sse`);
        this.logger.info(`  Reverse POST:  /mcp/reverse/message`);
        this.logger.info(`  Server name:   '${this.config.name}'`);
        resolve();
      });
      this.httpServer!.on('error', reject);
    });
  }

  /** Stop the proxy server and close all connections */
  async close(): Promise<void> {
    if (this.httpServer) {
      await this.sseAcceptor.close();
      await this.httpTransport.close();
      return new Promise((resolve) => {
        this.httpServer!.close(() => {
          this.logger.info('mcp-reverse proxy stopped');
          resolve();
        });
      });
    }
  }

  // ── Request Router ──────────────────────────────────────────────

  private async routeRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;

    // MCP Client endpoint → StreamableHTTP transport
    if (pathname === this.config.mcpPath) {
      if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
        const body = await readBody(req, this.config.maxMessageSize);
        const parsedBody = JSON.parse(body) as unknown;
        return this.httpTransport.handleRequest(req, res, parsedBody);
      }
      // GET (SSE polling) and DELETE (session close) — no body
      return this.httpTransport.handleRequest(req, res);
    }

    // Reverse SSE — internal server connects here
    if (req.method === 'GET' && pathname === '/mcp/reverse/sse') {
      await this.sseAcceptor.handleSSE(req, res);
      return;
    }

    // Reverse POST — internal server sends messages here
    if (req.method === 'POST' && pathname === '/mcp/reverse/message') {
      await this.sseAcceptor.handleMessage(req, res);
      return;
    }

    // 404 for unknown paths
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(
      [
        'mcp-reverse proxy — valid endpoints:',
        `  ${this.config.mcpPath}          (MCP client via StreamableHTTP)`,
        '  /mcp/reverse/sse     (internal server reverse connection)',
        '  /mcp/reverse/message (internal server message delivery)',
      ].join('\n'),
    );
  }
}
