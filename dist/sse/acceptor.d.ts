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
import { type IncomingMessage, type ServerResponse } from 'http';
import type { SSEAcceptorOptions, SSEAcceptorStandaloneOptions, ConnectionMetadata, Logger } from '../common/types.js';
import { SSEConnectionTransport } from './connection-transport.js';
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
export declare class SSEAcceptor {
    private options;
    private logger;
    private sessions;
    private connectionHandlers;
    private disconnectionHandlers;
    private errorHandlers;
    private httpServer?;
    private _started;
    private standalonePort?;
    private standaloneHost?;
    constructor(options: SSEAcceptorOptions | SSEAcceptorStandaloneOptions, logger?: Logger);
    /** Register a connection handler — fires when a server successfully connects */
    onConnection(handler: ConnectionHandler): this;
    /** Register a disconnection handler */
    onDisconnection(handler: DisconnectionHandler): this;
    /** Register an error handler */
    onError(handler: ErrorHandler): this;
    /**
     * Start a standalone HTTP server.
     * Only available when `port` was provided in constructor options.
     */
    start(): Promise<void>;
    /** Close the standalone server and all sessions */
    close(): Promise<void>;
    /** Whether the standalone server is running */
    isRunning(): boolean;
    /** Get the address (only meaningful in standalone mode) */
    getAddress(): {
        host: string;
        port: number;
        pathPrefix: string;
    };
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
    handleSSE(reqOrRequest: IncomingMessage | Request, res?: ServerResponse): Promise<Response | void>;
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
    handleMessage(reqOrRequest: IncomingMessage | Request, res?: ServerResponse): Promise<Response | void>;
    /**
     * Return the number of active SSE sessions.
     */
    get sessionCount(): number;
    private handleSSENextRequest;
    private handleMessageNextRequest;
    private handleSSENodeRequest;
    private handleMessageNodeRequest;
    private handleNodeRequest;
    private createSession;
    private destroySession;
    private destroySessionByServerName;
    /** Write a raw SSE-formatted string to a session's stream */
    writeToSession(sessionId: string, sseText: string): void;
    private resetSessionTimeout;
    private startKeepalive;
    private startKeepaliveNode;
    private authenticate;
    private resolveHeader;
    private resolveExtraHeaders;
    private extractSessionId;
    private emitConnection;
}
//# sourceMappingURL=acceptor.d.ts.map