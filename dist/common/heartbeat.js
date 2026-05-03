/**
 * Heartbeat utility using WebSocket Ping/Pong frames.
 * Operates at the transport level, not JSON message level.
 */
export class Heartbeat {
    pingInterval;
    pongTimeout;
    pingTimer;
    pongTimer;
    enabled;
    logger;
    onTimeout;
    constructor(options = {}, logger) {
        this.enabled = options.enabled !== false;
        this.pingInterval = options.pingInterval ?? 30000;
        this.pongTimeout = options.pongTimeout ?? 10000;
        this.logger = logger ?? { debug: () => { }, info: () => { }, warn: () => { }, error: () => { } };
    }
    /**
     * Start sending pings and monitoring pongs on the given WebSocket.
     * @param ws - WebSocket connection to heartbeat
     * @param onTimeout - Called when pong is not received in time
     */
    start(ws, onTimeout) {
        if (!this.enabled)
            return;
        this.onTimeout = onTimeout;
        this.logger.debug(`Heartbeat starting: ping=${this.pingInterval}ms, pongTimeout=${this.pongTimeout}ms`);
        ws.on('pong', () => this.handlePong());
        ws.on('ping', () => ws.pong()); // Respond to server-initiated pings
        this.pingTimer = setInterval(() => {
            if (ws.readyState === ws.OPEN) {
                ws.ping();
                // Start pong timeout
                this.pongTimer = setTimeout(() => {
                    this.logger.warn('Heartbeat: pong timeout, connection considered dead');
                    this.onTimeout?.();
                }, this.pongTimeout);
            }
        }, this.pingInterval);
    }
    handlePong() {
        if (this.pongTimer) {
            clearTimeout(this.pongTimer);
            this.pongTimer = undefined;
        }
    }
    /** Stop heartbeat timers */
    stop() {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = undefined;
        }
        if (this.pongTimer) {
            clearTimeout(this.pongTimer);
            this.pongTimer = undefined;
        }
        this.onTimeout = undefined;
        this.logger.debug('Heartbeat stopped');
    }
}
//# sourceMappingURL=heartbeat.js.map