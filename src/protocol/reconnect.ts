/**
 * Reconnection utility with exponential backoff and jitter.
 *
 * The manager owns exactly one retry timer and one in-flight reconnect attempt.
 * Duplicate disconnect notifications are coalesced instead of creating
 * competing reconnect loops.
 */

import type { ReconnectOptions, Logger } from './types.js';
import { ConnectionState } from './types.js';

const asError = (value: unknown): Error => {
  return value instanceof Error ? value : new Error(String(value));
};

export class ReconnectionManager {
  private options: Required<ReconnectOptions>;
  private logger: Logger;
  private attempt: number = 0;
  private readyAt?: number;
  private timer?: ReturnType<typeof setTimeout>;
  private inFlight: boolean = false;
  private activeAttemptGeneration?: number;
  private retryRequested: boolean = false;
  private generation: number = 0;
  private permanentlyClosed: boolean = false;
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
      stableConnectionMs: options.stableConnectionMs ?? 30_000,
    };
    if (!Number.isFinite(this.options.stableConnectionMs) || this.options.stableConnectionMs < 0) {
      throw new RangeError('stableConnectionMs must be a non-negative number');
    }
    this.logger = logger ?? { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
  }

  /** Set the function that performs one complete connection attempt. */
  setReconnectHandler(handler: () => Promise<void>): void {
    this.onReconnect = handler;
  }

  /** Set callback for state changes. */
  setStateChangeHandler(handler: (state: ConnectionState) => void): void {
    this.onStateChange = handler;
  }

  /** Get current delay for the next retry. */
  getNextDelay(): number {
    let delay = this.options.initialDelay * Math.pow(this.options.multiplier, this.attempt);
    delay = Math.min(delay, this.options.maxDelay);

    if (this.options.jitter) {
      const jitter = delay * 0.25 * (2 * Math.random() - 1);
      delay = Math.round(delay + jitter);
    }

    return Math.max(0, delay);
  }

  /** Get current state. */
  getState(): ConnectionState {
    return this.state;
  }

  /** Get number of consecutive attempts in the current reconnect cycle. */
  getAttempts(): number {
    return this.attempt;
  }

  /**
   * Start the connection cycle.
   *
   * The first attempt is always made, even when automatic reconnection is
   * disabled. This method preserves the historical non-blocking behavior: it
   * resolves after the attempt has been scheduled, not after it connects.
   */
  async start(): Promise<void> {
    if (this.permanentlyClosed) {
      throw new Error('ReconnectionManager is permanently closed; call reset() before restarting');
    }
    if (this.state === ConnectionState.CONNECTING
      || this.state === ConnectionState.RECONNECTING
      || this.state === ConnectionState.CONNECTED) {
      return;
    }

    this.generation++;
    this.attempt = 0;
    this.readyAt = undefined;
    this.retryRequested = false;
    this.cancelTimer();
    this.setState(ConnectionState.CONNECTING);
    this.scheduleRetry();
  }

  /**
   * Explicit success notification retained for compatibility with direct
   * ReconnectionManager users. Reconnect handlers normally need only resolve;
   * the manager then marks the attempt connected automatically.
   */
  onConnected(): void {
    if (this.isClosed()) return;
    if (this.inFlight && this.activeAttemptGeneration !== this.generation) {
      this.logger.debug('Ignoring onConnected() from a stale reconnect attempt');
      return;
    }

    this.retryRequested = false;
    if (this.state !== ConnectionState.CONNECTED) this.readyAt = performance.now();
    this.cancelTimer();
    this.setState(ConnectionState.CONNECTED);
  }

  /** Called when an established or establishing connection is lost. */
  async onDisconnected(): Promise<void> {
    if (this.isClosed()) return;

    if (this.readyAt !== undefined && performance.now() - this.readyAt >= this.options.stableConnectionMs) {
      this.attempt = 0;
    }
    this.readyAt = undefined;
    this.retryRequested = true;

    if (!this.options.enabled) {
      this.setState(ConnectionState.DISCONNECTED);
      return;
    }

    this.setState(ConnectionState.RECONNECTING);
    this.scheduleRetry();
  }

  /** Reset state and cancel pending retries. */
  reset(): void {
    this.generation++;
    this.permanentlyClosed = false;
    this.attempt = 0;
    this.readyAt = undefined;
    this.retryRequested = false;
    this.cancelTimer();
    this.setState(ConnectionState.DISCONNECTED);
  }

  /** Mark as permanently closed and ignore late attempt results. */
  close(): void {
    this.generation++;
    this.permanentlyClosed = true;
    this.readyAt = undefined;
    this.retryRequested = false;
    this.cancelTimer();
    this.setState(ConnectionState.CLOSED);
  }

  private scheduleRetry(): void {
    if (this.isClosed() || this.timer || this.inFlight) return;

    if (!this.onReconnect) {
      this.logger.warn('Reconnect handler is not configured');
      return;
    }

    if (this.options.maxRetries > 0 && this.attempt >= this.options.maxRetries) {
      this.logger.warn(`Max retries (${this.options.maxRetries}) exceeded, giving up`);
      this.setState(ConnectionState.CLOSED);
      return;
    }

    const delay = this.getNextDelay();
    const generation = this.generation;
    this.logger.info(
      `Reconnecting in ${delay}ms (attempt ${this.attempt + 1}${this.options.maxRetries ? `/${this.options.maxRetries}` : ''})`,
    );

    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.runAttempt(generation);
    }, delay);
  }

  private async runAttempt(generation: number): Promise<void> {
    if (generation !== this.generation || this.isClosed() || this.inFlight) {
      return;
    }

    this.inFlight = true;
    this.activeAttemptGeneration = generation;
    this.retryRequested = false;
    this.attempt++;
    let shouldRetry = false;

    try {
      await this.onReconnect!();

      if (generation !== this.generation || this.isClosed()) {
        return;
      }

      if (this.retryRequested) {
        shouldRetry = this.options.enabled;
        this.setState(this.options.enabled ? ConnectionState.RECONNECTING : ConnectionState.DISCONNECTED);
      } else {
        if (this.readyAt === undefined) this.readyAt = performance.now();
        this.setState(ConnectionState.CONNECTED);
      }
    } catch (value) {
      if (generation !== this.generation || this.isClosed()) {
        return;
      }

      const error = asError(value);
      this.logger.error(`Reconnection attempt ${this.attempt} failed: ${error.message}`);
      shouldRetry = this.options.enabled;
      this.setState(this.options.enabled ? ConnectionState.RECONNECTING : ConnectionState.DISCONNECTED);
    } finally {
      this.inFlight = false;
      if (this.activeAttemptGeneration === generation) {
        this.activeAttemptGeneration = undefined;
      }

      // reset() followed by start() while an old attempt was in flight waits
      // for that attempt to finish, then schedules the new generation.
      if (generation !== this.generation
        && !this.permanentlyClosed
        && (this.state === ConnectionState.CONNECTING || this.state === ConnectionState.RECONNECTING)) {
        this.scheduleRetry();
      }
    }

    if (shouldRetry && generation === this.generation && !this.isClosed()) {
      this.scheduleRetry();
    }
  }

  private isClosed(): boolean {
    return this.state === ConnectionState.CLOSED;
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
      try { this.onStateChange?.(newState); } catch { /* consumer callback */ }
    }
  }
}
