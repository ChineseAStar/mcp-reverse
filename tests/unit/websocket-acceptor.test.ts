/**
 * WebSocketAcceptor tests
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { WebSocket } from 'ws';
import { WebSocketAcceptor } from '../../src/client/websocket-acceptor.js';

describe('WebSocketAcceptor', () => {
  it('should start and stop', async () => {
    const acc = new WebSocketAcceptor({ port: 0 });
    await acc.start();
    assert.strictEqual(acc.isRunning(), true);
    assert.ok(acc.getAddress().port > 0);
    await acc.close();
  });

  it('should accept WebSocket connection', async () => {
    const acc = new WebSocketAcceptor({ port: 0 });
    await acc.start();
    let connected = false;
    let metadata: any = null;
    acc.onConnection(({ metadata: m }) => { connected = true; metadata = m; });

    const addr = acc.getAddress();
    const ws = new WebSocket(`ws://localhost:${addr.port}${addr.path}`, {
      headers: { 'X-MCP-Server-Name': 'test-server' },
    });
    await new Promise<void>((r) => ws.on('open', r));
    await new Promise((r) => setTimeout(r, 100));

    assert.strictEqual(connected, true);
    assert.strictEqual(metadata.serverName, 'test-server');
    ws.close();
    await acc.close();
  });

  it('should reject connections without server name', async () => {
    const acc = new WebSocketAcceptor({ port: 0 });
    await acc.start();
    let errorReceived = false;
    const addr = acc.getAddress();
    const ws = new WebSocket(`ws://localhost:${addr.port}${addr.path}`);
    await new Promise<void>((r) => {
      ws.on('error', () => { errorReceived = true; r(); });
    });
    assert.strictEqual(errorReceived, true);
    await acc.close();
  });

  it('should enforce auth tokens', async () => {
    const acc = new WebSocketAcceptor({
      port: 0,
      authTokens: { 'test-server': 'correct-token' },
    });
    await acc.start();
    const addr = acc.getAddress();

    // Wrong token -> rejected
    let refused = false;
    const ws1 = new WebSocket(`ws://localhost:${addr.port}${addr.path}`, {
      headers: { 'X-MCP-Server-Name': 'test-server', 'Authorization': 'Bearer wrong' },
    });
    await new Promise<void>((r) => { ws1.on('error', () => { refused = true; r(); }); });
    assert.strictEqual(refused, true);

    // Correct token -> accepted
    let connected = false;
    acc.onConnection(() => { connected = true; });
    const ws2 = new WebSocket(`ws://localhost:${addr.port}${addr.path}`, {
      headers: { 'X-MCP-Server-Name': 'test-server', 'Authorization': 'Bearer correct-token' },
    });
    await new Promise<void>((r) => ws2.on('open', r));
    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(connected, true);
    ws2.close();
    await acc.close();
  });

  it('should emit disconnection events', async () => {
    const acc = new WebSocketAcceptor({ port: 0 });
    await acc.start();
    let disconnected = '';
    acc.onDisconnection((name) => { disconnected = name; });

    const addr = acc.getAddress();
    const ws = new WebSocket(`ws://localhost:${addr.port}${addr.path}`, {
      headers: { 'X-MCP-Server-Name': 'test-server' },
    });
    await new Promise<void>((r) => ws.on('open', r));
    await new Promise((r) => setTimeout(r, 100));
    ws.close();
    await new Promise((r) => setTimeout(r, 200));
    assert.strictEqual(disconnected, 'test-server');
    await acc.close();
  });

  it('should use custom auth handler', async () => {
    const acc = new WebSocketAcceptor({
      port: 0,
      authHandler: async (m) => m.serverName === 'allowed',
    });
    await acc.start();
    const addr = acc.getAddress();

    let rejected = false;
    const ws1 = new WebSocket(`ws://localhost:${addr.port}${addr.path}`, {
      headers: { 'X-MCP-Server-Name': 'denied' },
    });
    await new Promise<void>((r) => { ws1.on('error', () => { rejected = true; r(); }); });
    assert.strictEqual(rejected, true);

    let connected = false;
    acc.onConnection(() => { connected = true; });
    const ws2 = new WebSocket(`ws://localhost:${addr.port}${addr.path}`, {
      headers: { 'X-MCP-Server-Name': 'allowed' },
    });
    await new Promise<void>((r) => ws2.on('open', r));
    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(connected, true);
    ws2.close();
    await acc.close();
  });
});
