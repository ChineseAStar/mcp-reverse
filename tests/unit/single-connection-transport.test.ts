/**
 * Tests for the SingleConnectionTransport
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { WebSocket, WebSocketServer } from 'ws';
import { SingleConnectionTransport } from '../../src/client/single-connection-transport.js';

async function makePair() {
  const wss = new WebSocketServer({ port: 0 });
  const port = (wss.address() as { port: number }).port;
  const pair = await new Promise<{ serverWs: WebSocket; clientWs: WebSocket }>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), 5000);
    wss.on('connection', (ws) => { clearTimeout(t); resolve({ serverWs: ws, clientWs }); });
    const clientWs = new WebSocket(`ws://localhost:${port}`);
    clientWs.on('error', (e) => { clearTimeout(t); reject(e); });
  });
  await new Promise<void>((r) => {
    if (pair.clientWs.readyState === WebSocket.OPEN) r();
    else pair.clientWs.on('open', r);
  });
  const transport = new SingleConnectionTransport(pair.serverWs, 'sid-1', { enabled: false });
  return { ...pair, transport, wss };
}

describe('SingleConnectionTransport', () => {
  it('start and sessionId', async () => {
    const { transport, clientWs, wss } = await makePair();
    await transport.start();
    assert.strictEqual(transport.reverseSessionId, 'sid-1');
    assert.strictEqual(transport.isClosed(), false);
    await transport.close();
    clientWs.close();
    wss.close();
  });

  it('send messages', async () => {
    const { transport, clientWs, wss } = await makePair();
    await transport.start();
    const p = new Promise<any>((r) => clientWs.on('message', (d: Buffer) => r(JSON.parse(d.toString()))));
    await transport.send({ jsonrpc: '2.0', id: 1, method: 'test', params: {} } as any);
    const recv = await p;
    assert.strictEqual(recv.id, 1);
    await transport.close();
    clientWs.close();
    wss.close();
  });

  it('receive messages', async () => {
    const { transport, clientWs, wss } = await makePair();
    await transport.start();
    const p = new Promise<any>((r) => { transport.onmessage = r; });
    clientWs.send(JSON.stringify({ jsonrpc: '2.0', id: 2, result: {} }));
    const recv = await p;
    assert.strictEqual(recv.id, 2);
    await transport.close();
    clientWs.close();
    wss.close();
  });

  it('onclose event', async () => {
    const { transport, clientWs, wss } = await makePair();
    await transport.start();
    const p = new Promise<void>((r) => { transport.onclose = r; });
    clientWs.close();
    await p;
    assert.strictEqual(transport.isClosed(), true);
    wss.close();
  });

  it('reject send when closed', async () => {
    const { transport, clientWs, wss } = await makePair();
    await transport.start();
    await transport.close();
    await assert.rejects(transport.send({ jsonrpc: '2.0', id: 1, method: 'test', params: {} } as any), /closed/);
    clientWs.close();
    wss.close();
  });
});
