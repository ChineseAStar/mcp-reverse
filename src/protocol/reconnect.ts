/**
 * Reconnection utility with exponential backoff and jitter.
 */

import type { ReconnectOptions, Logger } from './types.js';
import { ConnectionState } from './types.js';

export class ReconnectionManager {
  private options: Required<ReconnectOptions>;
  private logger: Logger;
  private attempt: number = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private state: ConnectionState = ConnectionState.DISCONNECTED;
  private onReconnect?: () => Promise<void>;
  private onStateChange?: (state: ConnectionState) => void;

  constructor(options: ReconnectOptions = {}, logger?: Logger) {
    this.options = {
      enabled: options.enabled !== false,
      initialDelay: options.initialDelay ?? 1000,
      maxDelay: options.maxDelay ?? 30000,
      multiplier: options.multiplier ?? 2,
      jitter: options.jitter !== false,
      maxRetries: options.maxRetries ?? 0,
    };
    this.logger = logger ?? { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
  }

  /** Set the function to call for reconnection */
  setReconnectHandler(handler: () => Promise<void>): void {
    this.onReconnect = handler;
  }

  /** Set callback for state changes */
  setStateChangeHandler(handler: (state: ConnectionState) => void): void {
    this.onStateChange = handler;
  }

  /** Get current delay for the next retry */
  getNextDelay(): number {
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
  getState(): ConnectionState {
    return this.state;
  }

  /** Get number of retry attempts */
  getAttempts(): number {
    return this.attempt;
  }

  /** Start reconnection cycle */
  async start(): Promise<void> {
    if (!this.options.enabled) {
      this.logger.debug('Reconnection disabled');
      return;
    }

    this.attempt = 0;
    this.setState(ConnectionState.CONNECTING);
    await this.scheduleRetry();
  }

  /** Called when connection is successfully established */
  onConnected(): void {
    this.attempt = 0;
    this.setState(ConnectionState.CONNECTED);
    this.cancelTimer();
  }

  /** Called when connection is lost, begin reconnection */
  async onDisconnected(): Promise<void> {
    if (!this.options.enabled) {
      this.setState(ConnectionState.DISCONNECTED);
      return;
    }

    this.setState(ConnectionState.RECONNECTING);
    await this.scheduleRetry();
  }

  /** Reset state */
  reset(): void {
    this.attempt = 0;
    this.cancelTimer();
    this.setState(ConnectionState.DISCONNECTED);
  }

  /** Mark as permanently closed (no more reconnection) */
  close(): void {
    this.cancelTimer();
    this.setState(ConnectionState.CLOSED);
  }

  private async scheduleRetry(): Promise<void> {
    if (this.state === ConnectionState.CLOSED) return;

    // Check max retries
    if (this.options.maxRetries > 0 && this.attempt >= this.options.maxRetries) {
      this.logger.warn(`Max retries (${this.options.maxRetries}) exceeded, giving up`);
      this.setState(ConnectionState.CLOSED);
      return;
    }

    const delay = this.getNextDelay();
    this.logger.info(
      `Reconnecting in ${delay}ms (attempt ${this.attempt + 1}${this.options.maxRetries ? `/${this.options.maxRetries}` : ''})`
    );

    this.timer = setTimeout(async () => {
      this.attempt++;
      try {
        await this.onReconnect?.();
      } catch (err) {
        this.logger.error(`Reconnection attempt ${this.attempt} failed: ${(err as Error).message}`);
        await this.scheduleRetry();
      }
    }, delay);
  }

  private cancelTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private setState(newState: ConnectionState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.onStateChange?.(newState);
    }
  }
}
