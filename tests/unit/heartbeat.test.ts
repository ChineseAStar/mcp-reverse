/**
 * Tests for Heartbeat utility
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Heartbeat } from '../../src/common/heartbeat.js';

describe('Heartbeat', () => {
  it('should start and stop without error', () => {
    const heartbeat = new Heartbeat({ pingInterval: 100, pongTimeout: 50, enabled: true });
    const mockWs = {
      on: () => {},
      ping: () => {},
      pong: () => {},
      OPEN: 1,
      readyState: 1,
      terminate: () => {},
    };
    heartbeat.start(mockWs as any, () => {});
    heartbeat.stop();
  });

  it('should call timeout handler when pong not received', async () => {
    const heartbeat = new Heartbeat({ pingInterval: 30, pongTimeout: 10, enabled: true });

    let timeoutCalled = false;
    const mockWs = {
      on: (event: string, handler: Function) => {
        // Don't forward pong events
      },
      ping: () => {},
      OPEN: 1,
      readyState: 1,
      terminate: () => {},
    };

    heartbeat.start(mockWs as any, () => { timeoutCalled = true; });
    await new Promise((r) => setTimeout(r, 150));
    assert.strictEqual(timeoutCalled, true);
    heartbeat.stop();
  });

  it('should not call timeout when stopped in time', () => {
    const heartbeat = new Heartbeat({ pingInterval: 200, pongTimeout: 100, enabled: true });
    let timeoutCalled = false;

    const mockWs = {
      on: () => {},
      ping: () => {},
      OPEN: 1,
      readyState: 1,
      terminate: () => {},
    };

    heartbeat.start(mockWs as any, () => { timeoutCalled = true; });
    heartbeat.stop(); // Stop before timeout fires
    assert.strictEqual(timeoutCalled, false);
  });

  it('should not start if disabled', () => {
    const heartbeat = new Heartbeat({ enabled: false });
    let onCalled = false;
    const mockWs = { on: () => { onCalled = true; }, ping: () => {}, pong: () => {}, OPEN: 1, readyState: 1 };
    heartbeat.start(mockWs as any, () => {});
    assert.strictEqual(onCalled, false);
    heartbeat.stop();
  });
});
