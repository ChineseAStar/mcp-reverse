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
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';
import { formatSSEEvent } from './util.js';
const parseMessage = (raw) => {
    return JSONRPCMessageSchema.parse(raw);
};
export class SSEConnectionTransport {
    _sessionId;
    logger;
    _closed = false;
    _writeCallback;
    _messageEventId = 0;
    onclose;
    onerror;
    onmessage;
    constructor(sessionId, logger) {
        this._sessionId = sessionId;
        this.logger = logger ?? { debug: () => { }, info: () => { }, warn: () => { }, error: () => { } };
    }
    get sessionId() {
        return this._sessionId;
    }
    /** Set the callback used for writing raw SSE data to the stream */
    setWriteCallback(cb) {
        this._writeCallback = cb;
    }
    // ─── Transport Interface ─────────────────────────────────────────
    async start() {
        // SSEConnectionTransport is "started" as soon as the SSE stream is open.
        // No action needed here — the stream was already established.
        this.logger.debug(`SSE transport started: ${this.sessionId}`);
    }
    /**
     * Send a JSON-RPC message TO the internal server.
     * Writes the message as an SSE event into the stream.
     */
    async send(message, _options) {
        if (this._closed) {
            throw new Error('Transport is closed');
        }
        const payload = JSON.stringify(message);
        const sseText = formatSSEEvent(payload, {
            event: 'message',
            id: String(++this._messageEventId),
        });
        this.logger.debug(`SSE send → ${this.sessionId}: ${payload.slice(0, 200)}`);
        if (this._writeCallback) {
            this._writeCallback(sseText);
        }
        else {
            throw new Error('No write callback — SSE stream not yet established');
        }
    }
    async close() {
        if (this._closed)
            return;
        this._closed = true;
        this.logger.info(`SSE transport closed: ${this.sessionId}`);
        this.onclose?.();
    }
    // ─── Internal ────────────────────────────────────────────────────
    /**
     * Feed a raw message body (from POST) into the transport.
     * Parses it as JSON-RPC and fires onmessage.
     */
    feedMessage(raw) {
        if (this._closed)
            return;
        try {
            const parsed = JSON.parse(raw);
            const message = parseMessage(parsed);
            this.logger.debug(`SSE recv ← ${this.sessionId}: ${raw.slice(0, 200)}`);
            this.onmessage?.(message);
        }
        catch (err) {
            this.logger.warn(`Failed to parse incoming message: ${err.message}`);
            this.onerror?.(new Error(`Failed to parse message: ${err.message}`));
        }
    }
    /**
     * Called by the acceptor when the session is destroyed.
     */
    destroy() {
        if (this._closed)
            return;
        this._closed = true;
        this.onclose?.();
    }
    /** Whether this transport is closed */
    isClosed() {
        return this._closed;
    }
}
//# sourceMappingURL=connection-transport.js.map