/**
 * Reconnection utility with exponential backoff and jitter.
 */
import type { ReconnectOptions, Logger } from './types.js';
import { ConnectionState } from './types.js';
export declare class ReconnectionManager {
    private options;
    private logger;
    private attempt;
    private timer?;
    private state;
    private onReconnect?;
    private onStateChange?;
    constructor(options?: ReconnectOptions, logger?: Logger);
    /** Set the function to call for reconnection */
    setReconnectHandler(handler: () => Promise<void>): void;
    /** Set callback for state changes */
    setStateChangeHandler(handler: (state: ConnectionState) => void): void;
    /** Get current delay for the next retry */
    getNextDelay(): number;
    /** Get current state */
    getState(): ConnectionState;
    /** Get number of retry attempts */
    getAttempts(): number;
    /** Start reconnection cycle */
    start(): Promise<void>;
    /** Called when connection is successfully established */
    onConnected(): void;
    /** Called when connection is lost, begin reconnection */
    onDisconnected(): Promise<void>;
    /** Reset state */
    reset(): void;
    /** Mark as permanently closed (no more reconnection) */
    close(): void;
    private scheduleRetry;
    private cancelTimer;
    private setState;
}
//# sourceMappingURL=reconnect.d.ts.map