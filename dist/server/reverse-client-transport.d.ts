/**
 * ReverseClientTransport
 *
 * Used by the internal MCP Server behind NAT/firewall.
 * Connects out to the public MCP Client (chat-ai) via WebSocket,
 * then provides a Transport interface that the MCP Server can use.
 *
 * Includes: automatic reconnection, heartbeat, authentication.
 */
import type { Transport, TransportSendOptions } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import WebSocket from 'ws';
import type { ReverseClientTransportOptions, Logger } from '../common/types.js';
import { ConnectionState } from '../common/types.js';
export declare class ReverseClientTransport implements Transport {
    private ws?;
    private options;
    private logger;
    private heartbeat;
    private reconnectManager;
    private _sessionId?;
    private _closed;
    private _started;
    private reconnectPending;
    private messageHandlers;
    private pendingMessages;
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: JSONRPCMessage) => void;
    constructor(options: ReverseClientTransportOptions, logger?: Logger);
    get sessionId(): string | undefined;
    /** Current connection state */
    get state(): ConnectionState;
    /** Number of reconnection attempts */
    get reconnectAttempts(): number;
    start(): Promise<void>;
    send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void>;
    close(): Promise<void>;
    /** Get the underlying WebSocket (for testing/advanced use) */
    getWebSocket(): WebSocket | undefined;
    private buildUrl;
    private buildHeaders;
    private doConnect;
    private setupMessageHandler;
    private setupCloseHandler;
    private setupErrorHandler;
    private flushPendingMessages;
}
//# sourceMappingURL=reverse-client-transport.d.ts.map