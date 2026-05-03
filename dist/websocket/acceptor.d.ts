/**
 * WebSocketAcceptor
 *
 * Runs a WebSocket server on the public MCP Client side (chat-ai).
 * Accepts incoming connections from internal MCP servers and
 * returns a SingleConnectionTransport for each connection.
 */
import { SingleConnectionTransport } from './transport.js';
import type { WebSocketAcceptorOptions, ConnectionMetadata, Logger } from '../common/types.js';
export interface AcceptorConnection {
    /** The MCP Transport for this connection */
    transport: SingleConnectionTransport;
    /** Connection metadata from the server */
    metadata: ConnectionMetadata;
}
export type ConnectionHandler = (connection: AcceptorConnection) => void | Promise<void>;
export type DisconnectionHandler = (serverName: string) => void | Promise<void>;
export type ErrorHandler = (error: Error) => void | Promise<void>;
export declare class WebSocketAcceptor {
    private options;
    private wss?;
    private httpServer?;
    private logger;
    private connectionHandlers;
    private disconnectionHandlers;
    private errorHandlers;
    private _started;
    constructor(options: WebSocketAcceptorOptions, logger?: Logger);
    /** Register a connection handler */
    onConnection(handler: ConnectionHandler): this;
    /** Register a disconnection handler */
    onDisconnection(handler: DisconnectionHandler): this;
    /** Register an error handler */
    onError(handler: ErrorHandler): this;
    /** Start the WebSocket server */
    start(): Promise<void>;
    /** Close the WebSocket server */
    close(): Promise<void>;
    /** Whether the server is running */
    isRunning(): boolean;
    /** Get the address the server is listening on */
    getAddress(): {
        host: string;
        port: number;
        path: string;
    };
    private verifyClient;
    private handleNewConnection;
    private handleServerError;
    /** Safely extract a header value */
    private getHeader;
    /** Extract custom X-MCP-Extra-* headers */
    private extractExtraHeaders;
}
//# sourceMappingURL=acceptor.d.ts.map