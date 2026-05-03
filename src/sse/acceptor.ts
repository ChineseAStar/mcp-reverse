/**
 * SSEAcceptor
 *
 * Runs on the public MCP Client side (e.g. chat-ai in the cloud).
 * Accepts incoming SSE connections from internal MCP servers and
 * provides a Transport for each one.
 *
 * ## Two Integration Modes
 *
 * ### Mode A — Framework integration (Next.js / Express / Deno)
 * ```typescript
 * const acceptor = new SSEAcceptor({ authTokens: { ... } });
 *
 * // In Next.js App Router (GET /api/mcp-reverse/sse):
 * export async function GET(req: NextRequest) {
 *   return acceptor.handleSSE(req);
 * }
 *
 * // POST /api/mcp-reverse/message:
 * export async function POST(req: NextRequest) {
 *   return acceptor.handleMessage(req);
 * }
 * ```
 *
 * ### Mode B — Standalone server (creates its own HTTP server)
 * ```typescript
 * const acceptor = new SSEAcceptor({ port: 3400, ... });
 * await acceptor.start();
 * ```
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import type {
  SSEAcceptorOptions,
  SSEAcceptorStandaloneOptions,
  ConnectionMetadata,
  SSEHeartbeatOptions,
  Logger,
} from '../common/types.js';
import { noopLogger } from '../common/types.js';
import { formatSSEEvent, formatSSEPing, getHeader, extractExtraHeaders } from './util.js';
import { SSEConnectionTransport } from './connection-transport.js';

// ─── Types ───────────────────────────────────────────────────────────

export interface AcceptorConnection {
  /** The MCP Transport for this connection */
  transport: SSEConnectionTransport;
  /** Connection metadata from the server */
  metadata: ConnectionMetadata;
  /** Unique session id */
  sessionId: string;
}

export type ConnectionHandler = (connection: AcceptorConnection) => void | Promise<void>;
export type DisconnectionHandler = (serverName: string) => void | Promise<void>;
export type ErrorHandler = (error: Error) => void | Promise<void>;

interface SSESession {
  sessionId: string;
  serverName: string;
  metadata: ConnectionMetadata;
  transport: SSEConnectionTransport;
  /** Controller for the SSE write stream */
  controller: ReadableStreamDefaultController<string> | null;
  /** Resolved when session is fully initialized */
  readyPromise: Promise<void>;
  readyResolve: () => void;
  /** Last POST received timestamp (for session timeout) */
  lastActivity: number;
  /** Session timeout timer */
  timeoutTimer?: ReturnType<typeof setTimeout>;
  /** Keepalive interval timer */
  keepaliveTimer?: ReturnType<typeof setInterval>;
}

// ─── Standalone Options ──────────────────────────────────────────────

function isStandalone(opts: SSEAcceptorOptions | SSEAcceptorStandaloneOptions): opts is SSEAcceptorStandaloneOptions {
  return 'port' in opts && typeof (opts as SSEAcceptorStandaloneOptions).port === 'number';
}

// ─── SSEAcceptor Class ───────────────────────────────────────────────

export class SSEAcceptor {
  private options: Required<Pick<SSEAcceptorOptions, 'pathPrefix' | 'maxMessageSize' | 'sessionTimeout'>>
    & Omit<SSEAcceptorOptions, 'pathPrefix' | 'maxMessageSize' | 'sessionTimeout'>;
  private logger: Logger;
  private sessions: Map<string, SSESession> = new Map();
  private connectionHandlers: ConnectionHandler[] = [];
  private disconnectionHandlers: DisconnectionHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private httpServer?: Server;
  private _started: boolean = false;

  // Standalone-mode state
  private standalonePort?: number;
  private standaloneHost?: string;

  constructor(options: SSEAcceptorOptions | SSEAcceptorStandaloneOptions, logger?: Logger) {
    this.logger = logger ?? noopLogger;
    this.options = {
      ...options,
      pathPrefix: options.pathPrefix ?? '/mcp-reverse',
      maxMessageSize: options.maxMessageSize ?? 4 * 1024 * 1024, // 4MB
      sessionTimeout: options.sessionTimeout ?? 60_000,
    };

    if (isStandalone(options)) {
      this.standalonePort = options.port;
      this.standaloneHost = options.host ?? '0.0.0.0';
    }
  }

  // ─── Event Handlers ──────────────────────────────────────────────

  /** Register a connection handler — fires when a server successfully connects */
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

  // ─── Standalone Mode ─────────────────────────────────────────────

  /**
   * Start a standalone HTTP server.
   * Only available when `port` was provided in constructor options.
   */
  async start(): Promise<void> {
    if (this._started) {
      throw new Error('SSEAcceptor is already started');
    }
    if (this.standalonePort === undefined) {
      throw new Error('Cannot start standalone server: no port provided. Use framework integration mode instead.');
    }

    this.httpServer = createServer((req, res) => {
      try {
        this.handleNodeRequest(req, res);
      } catch (err) {
        this.logger.error(`Request handler error: ${(err as Error).message}`);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Internal server error');
        }
      }
    });

    return new Promise((resolve, reject) => {
      this.httpServer!.listen(this.standalonePort!, this.standaloneHost, () => {
        this._started = true;
        this.logger.info(
          `SSEAcceptor listening on http://${this.standaloneHost}:${this.standalonePort}${this.options.pathPrefix}`,
        );
        resolve();
      });
      this.httpServer!.on('error', (err: Error) => {
        reject(new Error(`Failed to start SSEAcceptor: ${err.message}`));
      });
    });
  }

  /** Close the standalone server and all sessions */
  async close(): Promise<void> {
    // Terminate all active sessions
    for (const [, session] of this.sessions) {
      this.destroySession(session);
    }
    this.sessions.clear();

    if (this.httpServer) {
      return new Promise((resolve) => {
        this.httpServer!.close(() => {
          this._started = false;
          this.logger.info('SSEAcceptor standalone server closed');
          resolve();
        });
      });
    }
    this._started = false;
  }

  /** Whether the standalone server is running */
  isRunning(): boolean {
    return this._started;
  }

  /** Get the address (only meaningful in standalone mode) */
  getAddress(): { host: string; port: number; pathPrefix: string } {
    const port = this.standalonePort ?? 0;
    return {
      host: this.standaloneHost ?? '0.0.0.0',
      port,
      pathPrefix: this.options.pathPrefix,
    };
  }

  // ─── Framework Integration Mode ─────────────────────────────────

  /**
   * Handle an incoming SSE connection request.
   *
   * **Next.js App Router:**
   * ```ts
   * export async function GET(req: NextRequest) {
   *   return acceptor.handleSSE(req);
   * }
   * ```
   *
   * **Express / Node.js http module:**
   * ```ts
   * app.get('/mcp-reverse/sse', (req, res) => acceptor.handleSSE(req, res));
   * ```
   *
   * @param reqOrRequest - Incoming HTTP request (Next.js `Request` or Node.js `IncomingMessage`)
   * @param res - Node.js `ServerResponse` (only used with Node.js http module)
   */
  async handleSSE(
    reqOrRequest: IncomingMessage | Request,
    res?: ServerResponse,
  ): Promise<Response | void> {
    // Next.js Request
    if (reqOrRequest instanceof Request) {
      return this.handleSSENextRequest(reqOrRequest);
    }
    // Node.js IncomingMessage + ServerResponse
    if (res) {
      return this.handleSSENodeRequest(reqOrRequest, res);
    }
    throw new Error('Invalid arguments: expected (Request) or (IncomingMessage, ServerResponse)');
  }

  /**
   * Handle an incoming POST message from a connected server.
   *
   * **Next.js App Router:**
   * ```ts
   * export async function POST(req: NextRequest) {
   *   return acceptor.handleMessage(req);
   * }
   * ```
   *
   * **Express / Node.js http module:**
   * ```ts
   * app.post('/mcp-reverse/message', (req, res) => acceptor.handleMessage(req, res));
   * ```
   */
  async handleMessage(
    reqOrRequest: IncomingMessage | Request,
    res?: ServerResponse,
  ): Promise<Response | void> {
    if (reqOrRequest instanceof Request) {
      return this.handleMessageNextRequest(reqOrRequest);
    }
    if (res) {
      return this.handleMessageNodeRequest(reqOrRequest, res);
    }
    throw new Error('Invalid arguments: expected (Request) or (IncomingMessage, ServerResponse)');
  }

  /**
   * Return the number of active SSE sessions.
   */
  get sessionCount(): number {
    return this.sessions.size;
  }

  // ─── Internal: Next.js Handlers ─────────────────────────────────

  private async handleSSENextRequest(req: Request): Promise<Response> {
    const metadata = await this.authenticate(req.headers);
    if (!metadata) {
      return new Response('Unauthorized', { status: 401 });
    }

    const session = this.createSession(metadata);

    const stream = new ReadableStream({
      start: (controller) => {
        session.controller = controller;
        // Send an initial comment to confirm the stream is open
        controller.enqueue(`: connected ${session.sessionId}\n\n`);
        session.readyResolve();

        // Wire up the transport write path to the SSE stream
        session.transport.setWriteCallback((data) => {
          try { controller.enqueue(data); } catch { /* stream closed */ }
        });

        this.emitConnection(session);
        this.startKeepalive(session);
      },
      cancel: () => {
        this.destroySession(session);
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',       // Disable nginx buffering
        'X-Session-Id': session.sessionId,
      },
    });
  }

  private async handleMessageNextRequest(req: Request): Promise<Response> {
    try {
      const sessionId = this.extractSessionId(req);
      if (!sessionId) {
        return new Response('Missing sessionId', { status: 400 });
      }

      const session = this.sessions.get(sessionId);
      if (!session) {
        return new Response('Session not found', { status: 404 });
      }

      // Check auth for this session
      const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
      if (this.options.authTokens?.[session.serverName]) {
        const expected = this.options.authTokens[session.serverName];
        if (token !== expected) {
          return new Response('Unauthorized', { status: 401 });
        }
      }

      // Check content length
      const contentLength = parseInt(req.headers.get('content-length') ?? '0', 10);
      if (contentLength > this.options.maxMessageSize) {
        return new Response('Payload too large', { status: 413 });
      }

      const body = await req.text();
      session.lastActivity = Date.now();

      // Route the message into the transport
      session.transport.feedMessage(body);

      return new Response(null, { status: 202 });
    } catch (err) {
      this.logger.error(`Message handler error: ${(err as Error).message}`);
      return new Response('Internal error', { status: 500 });
    }
  }

  // ─── Internal: Node.js Handlers ─────────────────────────────────

  private async handleSSENodeRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const metadata = await this.authenticate(req.headers);
    if (!metadata) {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('Unauthorized');
      return;
    }

    const session = this.createSession(metadata);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Session-Id': session.sessionId,
    });

    // Write initial comment
    res.write(`: connected ${session.sessionId}\n\n`);
    session.readyResolve();

    // Monkey-patch res.write to intercept SSE writes
    // We'll use a wrapper so Transport.send() can write to the stream
    session.controller = null; // No ReadableStream in Node.js mode
    session.transport.setWriteCallback((data: string) => {
      if (!res.writableEnded) {
        res.write(data);
      }
    });

    this.emitConnection(session);
    this.startKeepaliveNode(session, res);

    req.on('close', () => {
      this.destroySession(session);
    });
  }

  private async handleMessageNodeRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const sessionId = url.searchParams.get('sessionId');

      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing sessionId');
        return;
      }

      const session = this.sessions.get(sessionId);
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Session not found');
        return;
      }

      // Auth check
      const authHeader = getHeader(req.headers, 'authorization') ?? '';
      const token = authHeader.replace(/^Bearer\s+/i, '');
      if (this.options.authTokens?.[session.serverName]) {
        const expected = this.options.authTokens[session.serverName];
        if (token !== expected) {
          res.writeHead(401, { 'Content-Type': 'text/plain' });
          res.end('Unauthorized');
          return;
        }
      }

      // Read body
      const chunks: Buffer[] = [];
      let totalLength = 0;
      req.on('data', (chunk: Buffer) => {
        totalLength += chunk.length;
        if (totalLength > this.options.maxMessageSize) {
          req.destroy(new Error('Payload too large'));
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        session.lastActivity = Date.now();
        session.transport.feedMessage(body);

        res.writeHead(202);
        res.end();
      });

      req.on('error', (err: Error) => {
        this.logger.error(`Message handler read error: ${err.message}`);
        if (!res.headersSent) {
          res.writeHead(500);
        }
        res.end();
      });
    } catch (err) {
      this.logger.error(`Message handler error: ${(err as Error).message}`);
      if (!res.headersSent) {
        res.writeHead(500);
      }
      res.end('Internal error');
    }
  }

  // ─── Internal: Standalone Server Request Router ─────────────────

  private handleNodeRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const prefix = this.options.pathPrefix;

    if (req.method === 'GET' && url.pathname === `${prefix}/sse`) {
      this.handleSSENodeRequest(req, res).catch((err) => {
        this.logger.error(`SSE handler error: ${(err as Error).message}`);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Internal server error');
        }
      });
    } else if (req.method === 'POST' && url.pathname === `${prefix}/message`) {
      this.handleMessageNodeRequest(req, res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`mcp-reverse SSEAcceptor — valid endpoints: GET ${prefix}/sse, POST ${prefix}/message`);
    }
  }

  // ─── Internal: Session Management ───────────────────────────────

  private createSession(metadata: ConnectionMetadata): SSESession {
    const sessionId = `${metadata.serverName}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    let readyResolve!: () => void;
    const readyPromise = new Promise<void>((r) => { readyResolve = r; });

    const transport = new SSEConnectionTransport(sessionId, this.logger);
    transport.onclose = () => this.destroySessionByServerName(metadata.serverName);

    const session: SSESession = {
      sessionId,
      serverName: metadata.serverName,
      metadata,
      transport,
      controller: null,
      readyPromise,
      readyResolve,
      lastActivity: Date.now(),
    };

    this.sessions.set(sessionId, session);
    this.logger.info(`SSE session created: ${sessionId} (${metadata.serverName})`);

    // Start session timeout
    this.resetSessionTimeout(session);

    return session;
  }

  private destroySession(session: SSESession): void {
    if (!this.sessions.has(session.sessionId)) return;

    this.logger.info(`SSE session closed: ${session.sessionId} (${session.serverName})`);

    if (session.timeoutTimer) {
      clearTimeout(session.timeoutTimer);
      session.timeoutTimer = undefined;
    }

    if (session.keepaliveTimer) {
      clearInterval(session.keepaliveTimer);
      session.keepaliveTimer = undefined;
    }

    // Close the transport
    session.transport.destroy();

    // Close the SSE stream
    if (session.controller) {
      try { session.controller.close(); } catch { /* already closed */ }
    }

    this.sessions.delete(session.sessionId);

    // Emit disconnection
    for (const handler of this.disconnectionHandlers) {
      try {
        handler(session.serverName);
      } catch (err) {
        this.logger.error(`Disconnection handler error: ${(err as Error).message}`);
      }
    }
  }

  private destroySessionByServerName(serverName: string): void {
    for (const [, session] of this.sessions) {
      if (session.serverName === serverName) {
        this.destroySession(session);
        return;
      }
    }
  }

  /** Write a raw SSE-formatted string to a session's stream */
  writeToSession(sessionId: string, sseText: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.controller) {
      // Next.js ReadableStream mode
      session.controller.enqueue(sseText);
    }
    // Node.js mode: write happens via the transport's write callback
  }

  private resetSessionTimeout(session: SSESession): void {
    if (session.timeoutTimer) {
      clearTimeout(session.timeoutTimer);
    }
    session.timeoutTimer = setTimeout(() => {
      this.logger.warn(
        `SSE session timeout for ${session.serverName} (${session.sessionId}) — no activity for ${this.options.sessionTimeout}ms`,
      );
      this.destroySession(session);
    }, this.options.sessionTimeout);
  }

  // ─── Internal: Keepalive ────────────────────────────────────────

  private startKeepalive(session: SSESession): void {
    const hb = this.options.heartbeat;
    if (hb?.enabled === false) return;

    const interval = hb?.pingInterval ?? 30_000;
    const timer = setInterval(() => {
      if (!this.sessions.has(session.sessionId)) {
        clearInterval(timer);
        return;
      }
      if (session.controller) {
        try {
          session.controller.enqueue(formatSSEPing());
        } catch {
          clearInterval(timer);
        }
      }
    }, interval);

    // Store the timer so it can be cleared on session destroy
    session.keepaliveTimer = timer;
  }

  private startKeepaliveNode(session: SSESession, res: ServerResponse): void {
    const hb = this.options.heartbeat;
    if (hb?.enabled === false) return;

    const interval = hb?.pingInterval ?? 30_000;
    const timer = setInterval(() => {
      if (!this.sessions.has(session.sessionId) || res.writableEnded) {
        clearInterval(timer);
        return;
      }
      res.write(formatSSEPing());
    }, interval);

    // Store the timer so it can be cleared on session destroy
    session.keepaliveTimer = timer;
  }

  // ─── Internal: Auth ─────────────────────────────────────────────

  private async authenticate(
    headers: Record<string, string | string[] | undefined> | Headers,
  ): Promise<ConnectionMetadata | null> {
    const serverName = this.resolveHeader(headers, 'x-mcp-server-name') ?? '';
    if (!serverName) {
      this.logger.warn('Connection rejected: missing X-MCP-Server-Name header');
      return null;
    }

    const authHeader = this.resolveHeader(headers, 'authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    // Token validation
    if (this.options.authTokens) {
      const expected = this.options.authTokens[serverName];
      if (expected && token !== expected) {
        this.logger.warn(`Connection rejected: invalid token for '${serverName}'`);
        return null;
      }
    }

    const metadata: ConnectionMetadata = {
      serverName,
      authToken: token || undefined,
      extra: this.resolveExtraHeaders(headers),
    };

    // Custom auth handler
    if (this.options.authHandler) {
      try {
        const allowed = await this.options.authHandler(metadata);
        if (!allowed) {
          this.logger.warn(`Connection rejected by auth handler for '${serverName}'`);
          return null;
        }
      } catch (err) {
        this.logger.error(`Auth handler error for '${serverName}': ${(err as Error).message}`);
        return null;
      }
    }

    return metadata;
  }

  private resolveHeader(
    headers: Record<string, string | string[] | undefined> | Headers,
    name: string,
  ): string | undefined {
    if (headers instanceof Headers) {
      return headers.get(name) ?? undefined;
    }
    const value = headers[name.toLowerCase()];
    if (Array.isArray(value)) return value[0];
    return value;
  }

  private resolveExtraHeaders(
    headers: Record<string, string | string[] | undefined> | Headers,
  ): Record<string, string> {
    if (headers instanceof Headers) {
      const extra: Record<string, string> = {};
      headers.forEach((value, key) => {
        if (key.startsWith('x-mcp-extra-')) {
          extra[key.replace('x-mcp-extra-', '')] = value;
        }
      });
      return extra;
    }
    return extractExtraHeaders(headers);
  }

  private extractSessionId(req: Request): string | null {
    // First try query parameter
    const url = new URL(req.url);
    const qpSessionId = url.searchParams.get('sessionId');
    if (qpSessionId) return qpSessionId;

    // Then try X-Session-Id header
    return req.headers.get('x-session-id');
  }

  // ─── Internal: Event Emitters ───────────────────────────────────

  private emitConnection(session: SSESession): void {
    const connection: AcceptorConnection = {
      transport: session.transport,
      metadata: session.metadata,
      sessionId: session.sessionId,
    };

    for (const handler of this.connectionHandlers) {
      try {
        handler(connection);
      } catch (err) {
        this.logger.error(`Connection handler error: ${(err as Error).message}`);
      }
    }
  }
}
