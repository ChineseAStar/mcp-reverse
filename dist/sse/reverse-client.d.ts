/**
 * SSEReverseClientTransport
 *
 * Used by the internal MCP Server behind NAT/firewall.
 * Connects OUT to the public MCP Client (chat-ai) via SSE + HTTP POST,
 * then provides a Transport interface that the MCP Server can use.
 *
 * Architecture:
 *   GET  /mcp-reverse/sse        → open SSE stream (receive messages from Client)
 *   POST /mcp-reverse/message    → send messages to Client
 *
 * Includes: automatic reconnection, keepalive, authentication.
 */
import type { Transport, TransportSendOptions } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { SSEReverseClientTransportOptions, Logger } from '../common/types.js';
import { ConnectionState } from '../common/types.js';
export declare class SSEReverseClientTransport implements Transport {
    private options;
    private logger;
    private reconnectManager;
    private parser;
    private _sessionId?;
    private _closed;
    private _started;
    private _messageQueue;
    private _connecting;
    private keepaliveTimer?;
    private lastEventTime;
    private activeAbortController;
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: JSONRPCMessage) => void;
    constructor(options: SSEReverseClientTransportOptions, logger?: Logger);
    get sessionId(): string | undefined;
    /** Current connection state */
    get state(): ConnectionState;
    /** Number of reconnection attempts */
    get reconnectAttempts(): number;
    start(): Promise<void>;
    send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void>;
    close(): Promise<void>;
    private buildSSEUrl;
    private buildMessageUrl;
    private buildHeaders;
    /**
     * Establish the SSE connection.
     *
     * 1. Makes GET request to the SSE endpoint
     * 2. Waits for headers (confirms connection)
     * 3. Returns immediately — starts background reader for SSE events
     */
    private doConnect;
    /**
     * Background reader: continuously reads SSE events from the stream.
     * Runs until the stream ends or is aborted.
     */
    private readSSEStream;
    /**
     * Called when the SSE connection is lost (stream ended, error, abort).
     * Triggers reconnection if enabled.
     */
    private handleDisconnection;
    private postMessage;
    private handleIncomingEvent;
    private startKeepalive;
    private stopKeepalive;
    private abortActiveConnection;
    private flushQueue;
}
//# sourceMappingURL=reverse-client.d.ts.map