/**
 * SSEConnectionTransport
 *
 * Wraps a single SSE session as an MCP Transport.
 * Used by SSEAcceptor for each connected MCP server.
 *
 * Messages FROM the public client TO the internal server are written
 * into the SSE stream (via write callback).
 *
 * Messages FROM the internal server TO the public client arrive via
 * POST and are fed into this transport via feedMessage().
 */
import type { Transport, TransportSendOptions } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { Logger } from '../common/types.js';
export declare class SSEConnectionTransport implements Transport {
    private _sessionId;
    private logger;
    private _closed;
    private _writeCallback?;
    private _messageEventId;
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: JSONRPCMessage) => void;
    constructor(sessionId: string, logger?: Logger);
    get sessionId(): string | undefined;
    /** Set the callback used for writing raw SSE data to the stream */
    setWriteCallback(cb: (data: string) => void): void;
    start(): Promise<void>;
    /**
     * Send a JSON-RPC message TO the internal server.
     * Writes the message as an SSE event into the stream.
     */
    send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void>;
    close(): Promise<void>;
    /**
     * Feed a raw message body (from POST) into the transport.
     * Parses it as JSON-RPC and fires onmessage.
     */
    feedMessage(raw: string): void;
    /**
     * Called by the acceptor when the session is destroyed.
     */
    destroy(): void;
    /** Whether this transport is closed */
    isClosed(): boolean;
}
//# sourceMappingURL=connection-transport.d.ts.map