/**
 * ReverseClientTransport
 *
 * Used by the internal MCP Server behind NAT/firewall.
 * Connects out to the public MCP Client (chat-ai) via WebSocket,
 * then provides a Transport interface that the MCP Server can use.
 *
 * Includes: automatic reconnection, heartbeat, authentication.
 */
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';
import WebSocket from 'ws';
import { noopLogger } from '../common/types.js';
import { Heartbeat } from '../common/heartbeat.js';
import { ReconnectionManager } from '../common/reconnect.js';
const parseMessage = (raw) => {
    return JSONRPCMessageSchema.parse(raw);
};
export class ReverseClientTransport {
    ws;
    options;
    logger;
    heartbeat;
    reconnectManager;
    _sessionId;
    _closed = false;
    _started = false;
    reconnectPending = false;
    messageHandlers = [];
    // For message buffering during reconnection
    pendingMessages = [];
    onclose;
    onerror;
    onmessage;
    constructor(options, logger) {
        this.options = options;
        this.logger = logger ?? noopLogger;
        const heartbeatOpts = options.heartbeat ?? { enabled: true };
        const reconnectOpts = options.reconnect ?? { enabled: true };
        this.heartbeat = new Heartbeat(heartbeatOpts, logger);
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
    async start() {
        if (this._started) {
            throw new Error('ReverseClientTransport is already started');
        }
        if (this._closed) {
            throw new Error('ReverseClientTransport is closed');
        }
        this._started = true;
        this._sessionId = `${this.options.serverName}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        this.reconnectManager.setReconnectHandler(async () => {
            await this.doConnect();
        });
        this.reconnectManager.setStateChangeHandler((state) => {
            this.logger.info(`Connection state: ${state}`);
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
        // Handle reconnection buffer
        if (this.reconnectPending && this.options.reconnect?.enabled !== false) {
            return new Promise((resolve, reject) => {
                this.pendingMessages.push({ message, resolve, reject });
            });
        }
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket is not connected');
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
        this._started = false;
        this.heartbeat.stop();
        this.reconnectManager.close();
        this.flushPendingMessages(new Error('Transport closed'));
        if (this.ws) {
            this.ws.close(1000, 'Transport closed');
            this.ws = undefined;
        }
        this.logger.info('ReverseClientTransport closed');
    }
    /** Get the underlying WebSocket (for testing/advanced use) */
    getWebSocket() {
        return this.ws;
    }
    buildUrl() {
        const url = new URL(this.options.url);
        // Add query params
        url.searchParams.set('server_name', this.options.serverName);
        if (this.options.authToken) {
            url.searchParams.set('token', this.options.authToken);
        }
        if (this.options.queryParams) {
            for (const [key, value] of Object.entries(this.options.queryParams)) {
                url.searchParams.set(key, value);
            }
        }
        return url.toString();
    }
    buildHeaders() {
        const headers = {
            'X-MCP-Server-Name': this.options.serverName,
        };
        if (this.options.authToken) {
            headers['Authorization'] = `Bearer ${this.options.authToken}`;
        }
        if (this.options.headers) {
            Object.assign(headers, this.options.headers);
        }
        return headers;
    }
    async doConnect() {
        if (this._closed)
            return;
        const url = this.buildUrl();
        const headers = this.buildHeaders();
        this.logger.info(`Connecting to ${url}`);
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(url, {
                headers,
                rejectUnauthorized: !this.options.insecureTls,
                // Allow handshake to take longer on slow connections
                handshakeTimeout: 15000,
            });
            const connectTimeout = setTimeout(() => {
                ws.close();
                reject(new Error('Connection timeout'));
            }, 20000);
            ws.on('open', () => {
                clearTimeout(connectTimeout);
                this.ws = ws;
                this._sessionId = `${this.options.serverName}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
                this.setupMessageHandler(ws);
                this.setupCloseHandler(ws);
                this.setupErrorHandler(ws);
                this.heartbeat.start(ws, () => {
                    this.logger.warn('Heartbeat timeout, terminating connection');
                    ws.terminate();
                });
                this.reconnectManager.onConnected();
                this.flushPendingMessages();
                this.logger.info(`Connected to ${url}`);
                resolve();
            });
            ws.on('error', (err) => {
                clearTimeout(connectTimeout);
                this.logger.error(`Connection error to ${url}: ${err.message} (code: ${err.code ?? 'unknown'})`);
                if (this.options.reconnect?.enabled !== false) {
                    // Don't reject - let reconnection manager handle it
                    this.reconnectManager.onDisconnected().catch(() => { });
                    resolve(); // Resolve so reconnection manager continues
                }
                else {
                    reject(err);
                }
            });
        });
    }
    setupMessageHandler(ws) {
        ws.on('message', (data) => {
            if (this._closed)
                return;
            try {
                const raw = JSON.parse(data.toString());
                const message = parseMessage(raw);
                this.onmessage?.(message);
            }
            catch (err) {
                this.logger.warn(`Failed to parse message: ${err.message}`);
                this.onerror?.(new Error(`Failed to parse message: ${err.message}`));
            }
        });
    }
    setupCloseHandler(ws) {
        ws.on('close', (code, reason) => {
            this.logger.info(`WebSocket closed: code=${code} reason=${reason.toString().slice(0, 100)}`);
            this.heartbeat.stop();
            if (!this._closed) {
                this.reconnectPending = true;
                this.onclose?.();
                if (this.options.reconnect?.enabled !== false) {
                    this.reconnectManager.onDisconnected().catch(() => { });
                }
            }
        });
    }
    setupErrorHandler(ws) {
        ws.on('error', (err) => {
            this.logger.error(`WebSocket error: ${err.message}`);
            this.onerror?.(err);
        });
    }
    flushPendingMessages(rejection) {
        const messages = this.pendingMessages.splice(0);
        for (const { resolve, reject } of messages) {
            if (rejection) {
                reject(rejection);
            }
            else {
                resolve();
            }
        }
        this.reconnectPending = false;
    }
}
//# sourceMappingURL=reverse-client-transport.js.map