/**
 * SingleConnectionTransport
 *
 * Wraps a single WebSocket connection as an MCP Transport.
 * Used by the WebSocketAcceptor for each connected MCP server.
 * This is the Transport that the MCP Client uses to communicate
 * with a single reverse-connected MCP server.
 */
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';
import { Heartbeat } from '../common/heartbeat.js';
// A local re-export of the schema to avoid breaking if the SDK changes path
const parseMessage = (raw) => {
    return JSONRPCMessageSchema.parse(raw);
};
export class SingleConnectionTransport {
    ws;
    heartbeat;
    _sessionId;
    _closed = false;
    logger;
    onclose;
    onerror;
    onmessage;
    constructor(ws, sessionId, heartbeatOptions, logger) {
        this.ws = ws;
        this._sessionId = sessionId;
        this.logger = logger ?? { debug: () => { }, info: () => { }, warn: () => { }, error: () => { } };
        this.heartbeat = new Heartbeat(heartbeatOptions, logger);
    }
    get sessionId() {
        return this._sessionId;
    }
    async start() {
        if (this._closed) {
            throw new Error('Transport is closed');
        }
        this.ws.on('message', (data) => {
            this.handleMessage(data);
        });
        this.ws.on('close', (code, reason) => {
            this.logger.info(`WebSocket closed: code=${code} reason=${reason.toString()}`);
            this.heartbeat.stop();
            if (!this._closed) {
                this._closed = true;
                this.onclose?.();
            }
        });
        this.ws.on('error', (err) => {
            this.logger.error(`WebSocket error: ${err.message}`);
            this.onerror?.(err);
        });
        // Start heartbeat if connection is already open
        if (this.ws.readyState === this.ws.OPEN) {
            this.heartbeat.start(this.ws, () => {
                this.ws.terminate();
            });
        }
        this.logger.info(`Transport started: sessionId=${this._sessionId}`);
    }
    async send(message, _options) {
        if (this._closed) {
            throw new Error('Transport is closed');
        }
        return new Promise((resolve, reject) => {
            const payload = JSON.stringify(message);
            this.ws.send(payload, (err) => {
                if (err) {
                    this.logger.error(`Send failed: ${err.message}`);
                    reject(err);
                }
                else {
                    resolve();
                }
            });
        });
    }
    async close() {
        if (this._closed)
            return;
        this._closed = true;
        this.heartbeat.stop();
        this.ws.close(1000, 'Transport closed');
        this.logger.info(`Transport closed: sessionId=${this._sessionId}`);
    }
    /** Get the raw WebSocket (for advanced use) */
    getWebSocket() {
        return this.ws;
    }
    /** Whether this transport is closed */
    isClosed() {
        return this._closed;
    }
    handleMessage(data) {
        if (this._closed)
            return;
        try {
            // Handle JSON messages
            const raw = JSON.parse(data.toString());
            const message = parseMessage(raw);
            this.onmessage?.(message);
        }
        catch (err) {
            // Skip processing errors to avoid crashing the event loop
            this.logger.warn(`Failed to parse message: ${err.message}`);
            this.onerror?.(new Error(`Failed to parse message: ${err.message}`));
        }
    }
}
//# sourceMappingURL=transport.js.map