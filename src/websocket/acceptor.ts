/**
 * WebSocketAcceptor
 * 
 * Runs a WebSocket server on the public MCP Client side (chat-ai).
 * Accepts incoming connections from internal MCP servers and 
 * returns a SingleConnectionTransport for each connection.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createServer, type Server as HttpServer } from 'http';
import { readFileSync } from 'fs';
import type { Server as HttpsServer } from 'https';
import { SingleConnectionTransport } from './transport.js';
import type {
  WebSocketAcceptorOptions,
  ConnectionMetadata,
  HeartbeatOptions,
  Logger,
} from '../common/types.js';
import { noopLogger } from '../common/types.js';

/** Validate that a required string is present */
function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

export interface AcceptorConnection {
  /** The MCP Transport for this connection */
  transport: SingleConnectionTransport;
  /** Connection metadata from the server */
  metadata: ConnectionMetadata;
}

export type ConnectionHandler = (connection: AcceptorConnection) => void | Promise<void>;
export type DisconnectionHandler = (serverName: string) => void | Promise<void>;
export type ErrorHandler = (error: Error) => void | Promise<void>;

export class WebSocketAcceptor {
  private options: Required<Pick<WebSocketAcceptorOptions, 'path' | 'maxMessageSize' | 'handshakeTimeout'>> & Omit<WebSocketAcceptorOptions, 'path' | 'maxMessageSize' | 'handshakeTimeout'>;
  private wss?: WebSocketServer;
  private httpServer?: HttpServer | HttpsServer;
  private logger: Logger;
  private connectionHandlers: ConnectionHandler[] = [];
  private disconnectionHandlers: DisconnectionHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private _started: boolean = false;

  constructor(options: WebSocketAcceptorOptions, logger?: Logger) {
    this.logger = logger ?? noopLogger;
    this.options = {
      ...options,
      path: options.path ?? '/ws',
      maxMessageSize: options.maxMessageSize ?? 4 * 1024 * 1024, // 4MB
      handshakeTimeout: options.handshakeTimeout ?? 30000,
    };
  }

  /** Register a connection handler */
  onConnection(handler: ConnectionHandler): this {
    this.connectionHandlers.push(handler);
    return this;
  }

  /** Register a disconnection handler */
  onDisconnection(handler: DisconnectionHandler): this {
    this.disconnectionHandlers.push(handler);
    return this;
  }

  /** Register an error handler */
  onError(handler: ErrorHandler): this {
    this.errorHandlers.push(handler);
    return this;
  }

  /** Start the WebSocket server */
  async start(): Promise<void> {
    if (this._started) {
      throw new Error('WebSocketAcceptor is already started');
    }

    const host = this.options.host ?? '0.0.0.0';
    const port = this.options.port;

    if (this.options.tls) {
      // HTTPS + WSS
      const { createServer: createHttpsServer } = await import('https');
      const cert = readFileSync(this.options.tls.cert);
      const key = readFileSync(this.options.tls.key);
      this.httpServer = createHttpsServer({ cert, key });
    } else {
      // HTTP + WS
      this.httpServer = createServer();
    }

    this.wss = new WebSocketServer({
      server: this.httpServer,
      path: this.options.path,
      maxPayload: this.options.maxMessageSize,
      // Allow all origins; auth is handled via token
      verifyClient: (info, cb) => this.verifyClient(info, cb),
    });

    this.wss.on('connection', (ws: WebSocket, req) => this.handleNewConnection(ws, req));
    this.wss.on('error', (err: Error) => this.handleServerError(err));
    this.wss.on('close', () => {
      this._started = false;
      this.logger.info('WebSocket server closed');
    });

    return new Promise((resolve, reject) => {
      this.httpServer!.listen(port, host, () => {
        this._started = true;
        const scheme = this.options.tls ? 'wss' : 'ws';
        this.logger.info(`WebSocketAcceptor listening on ${scheme}://${host}:${port}${this.options.path}`);
        resolve();
      });

      this.httpServer!.on('error', (err: Error) => {
        reject(new Error(`Failed to start server: ${err.message}`));
      });
    });
  }

  /** Close the WebSocket server */
  async close(): Promise<void> {
    if (!this._started) return;

    return new Promise((resolve, reject) => {
      this.wss?.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        this.httpServer?.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      this._started = false;
    });
  }

  /** Whether the server is running */
  isRunning(): boolean {
    return this._started;
  }

  /** Get the address the server is listening on */
  getAddress(): { host: string; port: number; path: string } {
    // Read the actual port from the running server (important when port: 0)
    const actualPort = this.httpServer?.address();
    const port = typeof actualPort === 'object' && actualPort ? actualPort.port : this.options.port;
    return {
      host: this.options.host ?? '0.0.0.0',
      port,
      path: this.options.path,
    };
  }

  private async verifyClient(
    info: { origin: string; req: { headers: Record<string, string | string[] | undefined> }; secure: boolean },
    cb: (res: boolean, code?: number, message?: string, headers?: Record<string, string>) => void,
  ): Promise<void> {
    const headers = info.req.headers;
    const serverName = this.getHeader(headers, 'x-mcp-server-name') ?? '';

    if (!serverName) {
      this.logger.warn(`Connection rejected: missing server name from ${info.origin}`);
      cb(false, 400, 'Missing X-MCP-Server-Name header');
      return;
    }

    // Validate auth if configured
    if (this.options.authTokens) {
      const expectedToken = this.options.authTokens[serverName];
      if (expectedToken) {
        const authHeader = this.getHeader(headers, 'authorization') ?? '';
        const token = authHeader.replace(/^Bearer\s+/i, '').trim();
        if (token !== expectedToken) {
          this.logger.warn(`Connection rejected: invalid token for server '${serverName}'`);
          cb(false, 401, 'Unauthorized');
          return;
        }
      }
    }

    // Custom auth handler
    if (this.options.authHandler) {
      const metadata: ConnectionMetadata = {
        serverName,
        authToken: this.getHeader(headers, 'authorization')?.replace(/^Bearer\s+/i, '').trim(),
        extra: this.extractExtraHeaders(headers),
      };

      try {
        const allowed = await this.options.authHandler(metadata);
        if (!allowed) {
          this.logger.warn(`Connection rejected by auth handler for server '${serverName}'`);
          cb(false, 403, 'Forbidden');
          return;
        }
      } catch (err) {
        this.logger.error(`Auth handler error for server '${serverName}': ${(err as Error).message}`);
        cb(false, 500, 'Internal auth error');
        return;
      }
    }

    cb(true);
  }

  private handleNewConnection(ws: WebSocket, req: { headers: Record<string, string | string[] | undefined> }): void {
    const headers = req.headers;
    const serverName = requiredString(
      this.getHeader(headers, 'x-mcp-server-name'),
      'X-MCP-Server-Name'
    );

    const metadata: ConnectionMetadata = {
      serverName,
      authToken: this.getHeader(headers, 'authorization')?.replace(/^Bearer\s+/i, '').trim(),
      extra: this.extractExtraHeaders(headers),
    };

    const sessionId = `${serverName}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const transport = new SingleConnectionTransport(
      ws,
      sessionId,
      this.options.heartbeat,
      this.logger,
    );

    // Emit connection event
    const connection: AcceptorConnection = { transport, metadata };

    // Notify all handlers
    for (const handler of this.connectionHandlers) {
      try {
        handler(connection);
      } catch (err) {
        this.logger.error(`Connection handler error: ${(err as Error).message}`);
      }
    }

    // Handle disconnection
    transport.onclose = () => {
      this.logger.info(`Server disconnected: ${serverName}`);
      for (const handler of this.disconnectionHandlers) {
        try {
          handler(serverName);
        } catch (err) {
          this.logger.error(`Disconnection handler error: ${(err as Error).message}`);
        }
      }
    };

    transport.onerror = (err) => {
      this.logger.error(`Transport error for ${serverName}: ${err.message}`);
    };

    // Start the transport
    transport.start().catch((err) => {
      this.logger.error(`Failed to start transport for ${serverName}: ${err.message}`);
    });
  }

  private handleServerError(err: Error): void {
    this.logger.error(`WebSocket server error: ${err.message}`);
    for (const handler of this.errorHandlers) {
      try {
        handler(err);
      } catch (handlerErr) {
        this.logger.error(`Error handler error: ${(handlerErr as Error).message}`);
      }
    }
  }

  /** Safely extract a header value */
  private getHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
    const value = headers[name.toLowerCase()];
    if (Array.isArray(value)) return value[0];
    return value;
  }

  /** Extract custom X-MCP-Extra-* headers */
  private extractExtraHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
    const extra: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (key.startsWith('x-mcp-extra-') && typeof value === 'string') {
        const extraKey = key.replace('x-mcp-extra-', '');
        extra[extraKey] = value;
      }
    }
    return extra;
  }
}
