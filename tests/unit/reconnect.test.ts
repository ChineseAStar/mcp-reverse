/**
 * Tests for ReconnectionManager
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ReconnectionManager } from '../../src/protocol/reconnect.js';
import { ConnectionState } from '../../src/protocol/types.js';

async function waitFor(predicate: () => boolean, timeout = 1000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('ReconnectionManager', () => {
  it('state transitions', async () => {
    const r = new ReconnectionManager();
    r.setReconnectHandler(async () => {});
    await r.start();
    r.onConnected();
    assert.strictEqual(r.getState(), ConnectionState.CONNECTED);

    const sp = new Promise<ConnectionState>((res) => r.setStateChangeHandler((s) => res(s)));
    await r.onDisconnected();
    assert.strictEqual(await sp, ConnectionState.RECONNECTING);
    r.close();
  });

  it('jitter produces varied delays', () => {
    const r = new ReconnectionManager({ initialDelay: 1000, jitter: true });
    const delays = Array.from({ length: 20 }, () => r.getNextDelay());
    assert.ok(new Set(delays).size > 1);
    r.close();
  });

  it('respects maxDelay', () => {
    const r = new ReconnectionManager({ initialDelay: 5000, maxDelay: 5000, multiplier: 100, jitter: false });
    assert.ok(r.getNextDelay() <= 7500); // max + jitter buffer
    r.close();
  });

  it('disabled = no reconnect', async () => {
    const r = new ReconnectionManager({ enabled: false });
    let called = false;
    r.setReconnectHandler(async () => { called = true; });
    await r.onDisconnected();
    await new Promise((res) => setTimeout(res, 50));
    assert.strictEqual(called, false);
  });

  it('still performs the initial connection when automatic reconnect is disabled', async () => {
    const r = new ReconnectionManager({ enabled: false, initialDelay: 1, jitter: false });
    let calls = 0;
    r.setReconnectHandler(async () => { calls++; });

    await r.start();
    await waitFor(() => r.getState() === ConnectionState.CONNECTED);
    assert.strictEqual(calls, 1);

    await r.onDisconnected();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.strictEqual(calls, 1);
    assert.strictEqual(r.getState(), ConnectionState.DISCONNECTED);
  });

  it('retries failed attempts until a real connection succeeds', async () => {
    const r = new ReconnectionManager({
      initialDelay: 2,
      maxDelay: 2,
      multiplier: 1,
      jitter: false,
    });
    let calls = 0;
    let active = 0;
    let maxActive = 0;

    r.setReconnectHandler(async () => {
      calls++;
      active++;
      maxActive = Math.max(maxActive, active);
      try {
        await new Promise((resolve) => setTimeout(resolve, 3));
        if (calls < 3) throw new Error(`failure ${calls}`);
      } finally {
        active--;
      }
    });

    await r.start();
    await waitFor(() => r.getState() === ConnectionState.CONNECTED);

    assert.strictEqual(calls, 3);
    assert.strictEqual(maxActive, 1);
    assert.strictEqual(r.getAttempts(), 0);
    r.close();
  });

  it('coalesces duplicate disconnect notifications into one reconnect attempt', async () => {
    const r = new ReconnectionManager({ initialDelay: 5, maxDelay: 5, jitter: false });
    let calls = 0;
    r.setReconnectHandler(async () => { calls++; });

    await r.start();
    await waitFor(() => r.getState() === ConnectionState.CONNECTED);
    assert.strictEqual(calls, 1);

    await Promise.all([r.onDisconnected(), r.onDisconnected(), r.onDisconnected()]);
    await waitFor(() => r.getState() === ConnectionState.CONNECTED && calls === 2);
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.strictEqual(calls, 2);
    r.close();
  });

  it('ignores stale onConnected calls and starts the replacement generation', async () => {
    const r = new ReconnectionManager({ initialDelay: 1, jitter: false });
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let calls = 0;

    r.setReconnectHandler(async () => {
      calls++;
      if (calls === 1) {
        await firstGate;
        r.onConnected();
      }
    });

    await r.start();
    await waitFor(() => calls === 1);
    r.reset();
    await r.start();
    releaseFirst();

    await waitFor(() => calls === 2 && r.getState() === ConnectionState.CONNECTED);
    r.close();
  });

  it('ignores a late successful attempt after close', async () => {
    const r = new ReconnectionManager({ initialDelay: 1, jitter: false });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started = false;

    r.setReconnectHandler(async () => {
      started = true;
      await gate;
    });

    await r.start();
    await waitFor(() => started);
    r.close();
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.strictEqual(r.getState(), ConnectionState.CLOSED);
    await assert.rejects(r.start(), /permanently closed/);
  });

  it('reset counter on connect', async () => {
    const r = new ReconnectionManager();
    r.setReconnectHandler(async () => {});
    await r.start();
    r.onConnected();
    assert.strictEqual(r.getAttempts(), 0);
    r.close();
  });
});
