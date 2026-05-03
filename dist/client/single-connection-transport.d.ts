/**
 * SingleConnectionTransport
 *
 * Wraps a single WebSocket connection as an MCP Transport.
 * Used by the WebSocketAcceptor for each connected MCP server.
 * This is the Transport that the MCP Client uses to communicate
 * with a single reverse-connected MCP server.
 */
import type { Transport, TransportSendOptions } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { WebSocket } from 'ws';
import type { HeartbeatOptions, Logger } from '../common/types.js';
export declare class SingleConnectionTransport implements Transport {
    private ws;
    private heartbeat;
    private _sessionId;
    private _closed;
    private logger;
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: JSONRPCMessage) => void;
    constructor(ws: WebSocket, sessionId: string, heartbeatOptions?: HeartbeatOptions, logger?: Logger);
    get sessionId(): string | undefined;
    start(): Promise<void>;
    send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void>;
    close(): Promise<void>;
    /** Get the raw WebSocket (for advanced use) */
    getWebSocket(): WebSocket;
    /** Whether this transport is closed */
    isClosed(): boolean;
    private handleMessage;
}
//# sourceMappingURL=single-connection-transport.d.ts.map