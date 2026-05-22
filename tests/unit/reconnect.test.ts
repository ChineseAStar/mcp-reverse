/**
 * Tests for ReconnectionManager
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ReconnectionManager } from '../../src/protocol/reconnect.js';
import { ConnectionState } from '../../src/protocol/types.js';

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
    await new Promise((res) => setTimeout(res, 200));
    assert.strictEqual(called, false);
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
