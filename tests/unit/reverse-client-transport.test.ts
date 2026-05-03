/**
 * Tests for ReverseClientTransport
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { WebSocketServer, WebSocket } from 'ws';
import { ReverseClientTransport } from '../../src/server/reverse-client-transport.js';
import { ConnectionState } from '../../src/common/types.js';

const L = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

describe('ReverseClientTransport', () => {
  it('should connect and send headers', async () => {
    const wss = new WebSocketServer({ port: 0 });
    const port = (wss.address() as { port: number }).port;
    await new Promise<void>((r) => wss.on('listening', r));

    const t = new ReverseClientTransport({ url: `ws://localhost:${port}/ws`, serverName: 'srv', reconnect: { enabled: false }, heartbeat: { enabled: false } }, L);
    const p = new Promise<void>((resolve) => { wss.on('connection', (_ws, req) => { assert.strictEqual(req.headers['x-mcp-server-name'], 'srv'); resolve(); }); });
    await t.start();
    await p;
    assert.strictEqual(t.state, ConnectionState.CONNECTED);
    await t.close();
    wss.close();
  });

  it('should send messages', async () => {
    const wss = new WebSocketServer({ port: 0 });
    const port = (wss.address() as { port: number }).port;
    await new Promise<void>((r) => wss.on('listening', r));

    const t = new ReverseClientTransport({ url: `ws://localhost:${port}/ws`, serverName: 'srv', reconnect: { enabled: false }, heartbeat: { enabled: false } }, L);
    const p = new Promise<Buffer>((r) => { wss.on('connection', (ws) => ws.on('message', r)); });
    await t.start();
    await new Promise((r) => setTimeout(r, 100));
    await t.send({ jsonrpc: '2.0', id: 1, method: 'test', params: {} } as any);
    const raw = await p;
    assert.strictEqual(JSON.parse(raw.toString()).method, 'test');
    await t.close();
    wss.close();
  });

  it('should receive messages', async () => {
    const wss = new WebSocketServer({ port: 0 });
    const port = (wss.address() as { port: number }).port;
    await new Promise<void>((r) => wss.on('listening', r));

    const t = new ReverseClientTransport({ url: `ws://localhost:${port}/ws`, serverName: 'srv', reconnect: { enabled: false }, heartbeat: { enabled: false } }, L);
    const p = new Promise<any>((r) => { t.onmessage = r; });
    wss.on('connection', (ws) => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 2, result: {} })));
    await t.start();
    const recv = await p;
    assert.strictEqual(recv.id, 2);
    await t.close();
    wss.close();
  });

  it('should handle disconnection', { timeout: 10000 }, async () => {
    const wss = new WebSocketServer({ port: 0 });
    const port = (wss.address() as { port: number }).port;
    await new Promise<void>((r) => wss.on('listening', r));

    const t = new ReverseClientTransport({ url: `ws://localhost:${port}/ws`, serverName: 'srv', reconnect: { enabled: false }, heartbeat: { enabled: false } }, L);
    wss.on('connection', (ws) => setTimeout(() => ws.close(), 100));
    const p = new Promise<void>((r) => { t.onclose = r; });
    await t.start();
    await p;
    wss.close();
  });

  it('should reconnect', { timeout: 15000 }, async () => {
    const wss = new WebSocketServer({ port: 0 });
    const port = (wss.address() as { port: number }).port;
    await new Promise<void>((r) => wss.on('listening', r));

    const t = new ReverseClientTransport({ url: `ws://localhost:${port}/ws`, serverName: 'srv', reconnect: { enabled: true, initialDelay: 200, maxDelay: 1000 }, heartbeat: { enabled: false } }, L);
    let count = 0;
    wss.on('connection', (ws) => { count++; if (count === 1) setTimeout(() => ws.close(), 100); });
    await t.start();
    await new Promise((r) => setTimeout(r, 2000));
    assert.ok(count >= 2, `Expected >=2 connections, got ${count}`);
    await t.close();
    wss.close();
  });

  it('should reject send when closed', async () => {
    const t = new ReverseClientTransport({ url: 'ws://localhost:1/ws', serverName: 'srv', reconnect: { enabled: false }, heartbeat: { enabled: false } }, L);
    await t.close();
    await assert.rejects(t.send({ jsonrpc: '2.0', id: 1, method: 'test', params: {} } as any), /closed/);
  });

  it('should pass auth token', async () => {
    const wss = new WebSocketServer({ port: 0 });
    const port = (wss.address() as { port: number }).port;
    await new Promise<void>((r) => wss.on('listening', r));

    const t = new ReverseClientTransport({ url: `ws://localhost:${port}/ws`, serverName: 'srv', authToken: 'tok', reconnect: { enabled: false }, heartbeat: { enabled: false } }, L);
    const p = new Promise<void>((r) => {
      wss.on('connection', (_ws, req) => { assert.strictEqual(req.headers['authorization'], 'Bearer tok'); r(); });
    });
    await t.start();
    await p;
    await t.close();
    wss.close();
  });

  it('should have reverseSessionId', async () => {
    const wss = new WebSocketServer({ port: 0 });
    const port = (wss.address() as { port: number }).port;
    await new Promise<void>((r) => wss.on('listening', r));

    const t = new ReverseClientTransport({ url: `ws://localhost:${port}/ws`, serverName: 'srv', reconnect: { enabled: false }, heartbeat: { enabled: false } }, L);
    wss.on('connection', () => {});
    await t.start();
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(t.reverseSessionId && t.reverseSessionId.includes('srv'));
    await t.close();
    wss.close();
  });
});
