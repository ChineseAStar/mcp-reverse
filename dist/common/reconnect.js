/**
 * Reconnection utility with exponential backoff and jitter.
 */
import { ConnectionState } from './types.js';
export class ReconnectionManager {
    options;
    logger;
    attempt = 0;
    timer;
    state = ConnectionState.DISCONNECTED;
    onReconnect;
    onStateChange;
    constructor(options = {}, logger) {
        this.options = {
            enabled: options.enabled !== false,
            initialDelay: options.initialDelay ?? 1000,
            maxDelay: options.maxDelay ?? 30000,
            multiplier: options.multiplier ?? 2,
            jitter: options.jitter !== false,
            maxRetries: options.maxRetries ?? 0,
        };
        this.logger = logger ?? { debug: () => { }, info: () => { }, warn: () => { }, error: () => { } };
    }
    /** Set the function to call for reconnection */
    setReconnectHandler(handler) {
        this.onReconnect = handler;
    }
    /** Set callback for state changes */
    setStateChangeHandler(handler) {
        this.onStateChange = handler;
    }
    /** Get current delay for the next retry */
    getNextDelay() {
        let delay = this.options.initialDelay * Math.pow(this.options.multiplier, this.attempt);
        delay = Math.min(delay, this.options.maxDelay);
        if (this.options.jitter) {
            // Add ±25% jitter
            const jitter = delay * 0.25 * (2 * Math.random() - 1);
            delay = Math.round(delay + jitter);
        }
        return delay;
    }
    /** Get current state */
    getState() {
        return this.state;
    }
    /** Get number of retry attempts */
    getAttempts() {
        return this.attempt;
    }
    /** Start reconnection cycle */
    async start() {
        if (!this.options.enabled) {
            this.logger.debug('Reconnection disabled');
            return;
        }
        this.attempt = 0;
        this.setState(ConnectionState.CONNECTING);
        await this.scheduleRetry();
    }
    /** Called when connection is successfully established */
    onConnected() {
        this.attempt = 0;
        this.setState(ConnectionState.CONNECTED);
        this.cancelTimer();
    }
    /** Called when connection is lost, begin reconnection */
    async onDisconnected() {
        if (!this.options.enabled) {
            this.setState(ConnectionState.DISCONNECTED);
            return;
        }
        this.setState(ConnectionState.RECONNECTING);
        await this.scheduleRetry();
    }
    /** Reset state */
    reset() {
        this.attempt = 0;
        this.cancelTimer();
        this.setState(ConnectionState.DISCONNECTED);
    }
    /** Mark as permanently closed (no more reconnection) */
    close() {
        this.cancelTimer();
        this.setState(ConnectionState.CLOSED);
    }
    async scheduleRetry() {
        if (this.state === ConnectionState.CLOSED)
            return;
        // Check max retries
        if (this.options.maxRetries > 0 && this.attempt >= this.options.maxRetries) {
            this.logger.warn(`Max retries (${this.options.maxRetries}) exceeded, giving up`);
            this.setState(ConnectionState.CLOSED);
            return;
        }
        const delay = this.getNextDelay();
        this.logger.info(`Reconnecting in ${delay}ms (attempt ${this.attempt + 1}${this.options.maxRetries ? `/${this.options.maxRetries}` : ''})`);
        this.timer = setTimeout(async () => {
            this.attempt++;
            try {
                await this.onReconnect?.();
            }
            catch (err) {
                this.logger.error(`Reconnection attempt ${this.attempt} failed: ${err.message}`);
                await this.scheduleRetry();
            }
        }, delay);
    }
    cancelTimer() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
    }
    setState(newState) {
        if (this.state !== newState) {
            this.state = newState;
            this.onStateChange?.(newState);
        }
    }
}
//# sourceMappingURL=reconnect.js.map