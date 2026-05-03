/**
 * Heartbeat utility using WebSocket Ping/Pong frames.
 * Operates at the transport level, not JSON message level.
 */
import type { HeartbeatOptions, Logger } from './types.js';
import type { WebSocket } from 'ws';
export declare class Heartbeat {
    private pingInterval;
    private pongTimeout;
    private pingTimer?;
    private pongTimer?;
    private enabled;
    private logger;
    private onTimeout?;
    constructor(options?: HeartbeatOptions, logger?: Logger);
    /**
     * Start sending pings and monitoring pongs on the given WebSocket.
     * @param ws - WebSocket connection to heartbeat
     * @param onTimeout - Called when pong is not received in time
     */
    start(ws: WebSocket, onTimeout: () => void): void;
    private handlePong;
    /** Stop heartbeat timers */
    stop(): void;
}
//# sourceMappingURL=heartbeat.d.ts.map