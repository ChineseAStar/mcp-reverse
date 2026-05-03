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
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';
import { noopLogger } from '../common/types.js';
import { ReconnectionManager } from '../common/reconnect.js';
import { SSEParser } from './util.js';
const parseMessage = (raw) => {
    return JSONRPCMessageSchema.parse(raw);
};
export class SSEReverseClientTransport {
    options;
    logger;
    reconnectManager;
    parser = new SSEParser();
    _sessionId;
    _closed = false;
    _started = false;
    _messageQueue = [];
    _connecting = false;
    // Keepalive
    keepaliveTimer;
    lastEventTime = 0;
    // Active fetch objects for cancellation
    activeAbortController = null;
    onclose;
    onerror;
    onmessage;
    constructor(options, logger) {
        this.options = options;
        this.logger = logger ?? noopLogger;
        const reconnectOpts = options.reconnect ?? { enabled: true };
        this.reconnectManager = new ReconnectionManager(reconnectOpts, logger);
    }
    get sessionId() {
        return this._sessionId;
    }
    /** Current connection state */
    get state() {
        return this.reconnectManager.getState();
    }
    /** Number of reconnection attempts */
    get reconnectAttempts() {
        return this.reconnectManager.getAttempts();
    }
    // ─── Transport Interface ─────────────────────────────────────────
    async start() {
        if (this._started) {
            throw new Error('SSEReverseClientTransport is already started');
        }
        if (this._closed) {
            throw new Error('SSEReverseClientTransport is closed');
        }
        this._started = true;
        this._sessionId = `${this.options.serverName}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        this.reconnectManager.setReconnectHandler(async () => {
            await this.doConnect();
        });
        this.reconnectManager.setStateChangeHandler((state) => {
            this.logger.info(`SSE connection state: ${state}`);
        });
        if (this.options.reconnect?.enabled !== false) {
            await this.reconnectManager.start();
        }
        else {
            await this.doConnect();
        }
    }
    async send(message, _options) {
        if (this._closed) {
            throw new Error('Transport is closed');
        }
        // If currently reconnecting/connecting, queue the message
        if (this._connecting) {
            return new Promise((resolve, reject) => {
                this._messageQueue.push({ message, resolve, reject });
            });
        }
        return this.postMessage(message);
    }
    async close() {
        if (this._closed)
            return;
        this._closed = true;
        this._started = false;
        this.reconnectManager.close();
        this.stopKeepalive();
        this.abortActiveConnection();
        this.flushQueue(new Error('Transport closed'));
        this.logger.info('SSEReverseClientTransport closed');
    }
    // ─── Internal: Connection Establish ─────────────────────────────
    buildSSEUrl() {
        const base = this.options.url.replace(/\/$/, '');
        const url = new URL(`${base}/sse`);
        url.searchParams.set('server_name', this.options.serverName);
        if (this.options.queryParams) {
            for (const [key, value] of Object.entries(this.options.queryParams)) {
                url.searchParams.set(key, value);
            }
        }
        return url.toString();
    }
    buildMessageUrl() {
        const base = this.options.url.replace(/\/$/, '');
        const url = new URL(`${base}/message`);
        url.searchParams.set('sessionId', this._sessionId ?? '');
        return url.toString();
    }
    buildHeaders() {
        const headers = {
            'X-MCP-Server-Name': this.options.serverName,
            'Accept': 'text/event-stream',
        };
        if (this.options.authToken) {
            headers['Authorization'] = `Bearer ${this.options.authToken}`;
        }
        if (this.options.headers) {
            Object.assign(headers, this.options.headers);
        }
        return headers;
    }
    /**
     * Establish the SSE connection.
     *
     * 1. Makes GET request to the SSE endpoint
     * 2. Waits for headers (confirms connection)
     * 3. Returns immediately — starts background reader for SSE events
     */
    async doConnect() {
        if (this._closed)
            return;
        this._connecting = true;
        const url = this.buildSSEUrl();
        const headers = this.buildHeaders();
        this.logger.info(`SSE connecting to ${url}`);
        const controller = new AbortController();
        this.activeAbortController = controller;
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers,
                signal: controller.signal,
            });
            if (!response.ok) {
                throw new Error(`SSE connection failed: HTTP ${response.status} ${response.statusText}`);
            }
            if (!response.body) {
                throw new Error('SSE connection failed: no response body');
            }
            // Extract session ID from response headers
            const sid = response.headers.get('x-session-id');
            if (sid) {
                this._sessionId = sid;
            }
            // Connection is now established — resolve the promise
            this._connecting = false;
            this.reconnectManager.onConnected();
            this.lastEventTime = Date.now();
            this.logger.info(`SSE connected: ${url} (session: ${this._sessionId})`);
            // Start keepalive monitoring
            this.startKeepalive();
            // Flush any queued messages (they can now be sent via POST)
            this.flushQueue();
            // Launch background reader — do NOT await!
            this.readSSEStream(response.body).catch((err) => {
                if (!this._closed) {
                    this.logger.error(`SSE stream reader crashed: ${err.message}`);
                    this.handleDisconnection();
                }
            });
        }
        catch (err) {
            this.logger.error(`SSE connection error: ${err.message}`);
            this.handleDisconnection();
        }
    }
    /**
     * Background reader: continuously reads SSE events from the stream.
     * Runs until the stream ends or is aborted.
     */
    async readSSEStream(body) {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    this.logger.info('SSE stream ended normally');
                    this.handleDisconnection();
                    return;
                }
                const chunk = decoder.decode(value, { stream: true });
                this.lastEventTime = Date.now();
                const events = this.parser.feed(chunk);
                for (const event of events) {
                    // Keepalive comments are filtered by parser; only process data events
                    if (event.event === 'message' || event.event === '') {
                        this.handleIncomingEvent(event);
                    }
                }
            }
        }
        catch (err) {
            if (err.name === 'AbortError') {
                this.logger.debug('SSE stream read aborted');
            }
            else {
                this.logger.error(`SSE stream read error: ${err.message}`);
            }
            this.handleDisconnection();
        }
        finally {
            reader.releaseLock();
        }
    }
    /**
     * Called when the SSE connection is lost (stream ended, error, abort).
     * Triggers reconnection if enabled.
     */
    handleDisconnection() {
        this._connecting = true;
        this.stopKeepalive();
        this.activeAbortController = null;
        this.parser.reset();
        if (this._closed)
            return;
        this.onclose?.();
        if (this.options.reconnect?.enabled !== false) {
            this.reconnectManager.onDisconnected().catch(() => { });
        }
    }
    // ─── Internal: Message Posting ──────────────────────────────────
    async postMessage(message) {
        if (!this._sessionId) {
            throw new Error('No session — not connected yet');
        }
        const messageUrl = this.buildMessageUrl();
        const headers = {
            'Content-Type': 'application/json',
            'X-MCP-Server-Name': this.options.serverName,
            'X-Session-Id': this._sessionId,
        };
        if (this.options.authToken) {
            headers['Authorization'] = `Bearer ${this.options.authToken}`;
        }
        const payload = JSON.stringify(message);
        this.logger.debug(`SSE POST → ${messageUrl}: ${payload.slice(0, 200)}`);
        const response = await fetch(messageUrl, {
            method: 'POST',
            headers,
            body: payload,
        });
        if (!response.ok) {
            throw new Error(`POST failed: HTTP ${response.status} ${response.statusText}`);
        }
    }
    handleIncomingEvent(event) {
        if (this._closed)
            return;
        try {
            const raw = JSON.parse(event.data);
            const message = parseMessage(raw);
            this.logger.debug(`SSE recv ←: ${event.data.slice(0, 200)}`);
            this.onmessage?.(message);
        }
        catch (err) {
            this.logger.warn(`Failed to parse incoming SSE event: ${err.message}`);
            this.onerror?.(new Error(`Failed to parse SSE event: ${err.message}`));
        }
    }
    // ─── Internal: Keepalive ────────────────────────────────────────
    startKeepalive() {
        const hb = this.options.heartbeat;
        if (hb?.enabled === false)
            return;
        const readTimeout = hb?.readTimeout ?? 45_000;
        const pingInterval = hb?.pingInterval ?? 30_000;
        // Monitor for read timeout
        this.keepaliveTimer = setInterval(() => {
            const elapsed = Date.now() - this.lastEventTime;
            if (elapsed > readTimeout) {
                this.logger.warn(`SSE read timeout: no event for ${elapsed}ms`);
                this.abortActiveConnection();
            }
        }, Math.min(pingInterval, readTimeout) / 2);
    }
    stopKeepalive() {
        if (this.keepaliveTimer) {
            clearInterval(this.keepaliveTimer);
            this.keepaliveTimer = undefined;
        }
    }
    abortActiveConnection() {
        if (this.activeAbortController) {
            this.activeAbortController.abort();
            this.activeAbortController = null;
        }
    }
    // ─── Internal: Queue ────────────────────────────────────────────
    flushQueue(error) {
        const queue = this._messageQueue.splice(0);
        for (const { resolve, reject } of queue) {
            if (error) {
                reject(error);
            }
            else {
                resolve();
            }
        }
    }
}
//# sourceMappingURL=reverse-client.js.map