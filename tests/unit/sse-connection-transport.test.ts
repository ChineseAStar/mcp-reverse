/**
 * SSE Connection Transport — unit tests
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { SSEConnectionTransport } from '../../src/sse/connection-transport.js';

describe('SSEConnectionTransport', () => {
  it('should have a sessionId', () => {
    const t = new SSEConnectionTransport('test-session-123');
    assert.strictEqual(t.sessionId, 'test-session-123');
  });

  it('should start successfully', async () => {
    const t = new SSEConnectionTransport('test-1');
    await t.start();
    // No error = success
  });

  it('should feed messages through feedMessage and fire onmessage', async () => {
    const t = new SSEConnectionTransport('test-2');
    const received: unknown[] = [];

    t.onmessage = (msg) => {
      received.push(msg);
    };

    t.feedMessage(JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/list',
      id: 1,
    }));

    assert.strictEqual(received.length, 1);
    assert.strictEqual((received[0] as any).method, 'tools/list');
  });

  it('should handle multiple messages', async () => {
    const t = new SSEConnectionTransport('test-3');
    const received: unknown[] = [];

    t.onmessage = (msg) => received.push(msg);

    t.feedMessage(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }));
    t.feedMessage(JSON.stringify({ jsonrpc: '2.0', id: 2, result: {} }));
    t.feedMessage(JSON.stringify({ jsonrpc: '2.0', id: 3, result: {} }));

    assert.strictEqual(received.length, 3);
  });

  it('should fire onerror for invalid JSON', async () => {
    const t = new SSEConnectionTransport('test-4');
    let error: Error | undefined;

    t.onerror = (err) => { error = err; };

    t.feedMessage('not json at all');

    assert.ok(error);
    assert.match(error!.message, /Failed to parse/);
  });

  it('should reject send if no write callback set', async () => {
    const t = new SSEConnectionTransport('test-5');
    await assert.rejects(
      () => t.send({ jsonrpc: '2.0', id: 1, method: 'test', params: {} } as any),
      /No write callback/,
    );
  });

  it('should send messages via write callback', async () => {
    const t = new SSEConnectionTransport('test-6');
    const written: string[] = [];

    t.setWriteCallback((data) => written.push(data));

    await t.send({ jsonrpc: '2.0', id: 1, method: 'test', params: {} } as any);

    assert.strictEqual(written.length, 1);
    assert.match(written[0], /event: message/);
    assert.match(written[0], /data: \{.*"method":"test".*\}/);
    assert.match(written[0], /\n\n$/);
  });

  it('should reject send after close', async () => {
    const t = new SSEConnectionTransport('test-7');
    t.setWriteCallback(() => {});
    await t.close();

    await assert.rejects(
      () => t.send({ jsonrpc: '2.0', id: 1, method: 'test', params: {} } as any),
      /closed/,
    );
  });

  it('should fire onclose when closed', async () => {
    const t = new SSEConnectionTransport('test-8');
    let closed = false;
    t.onclose = () => { closed = true; };

    await t.close();
    assert.ok(closed);
  });

  it('should fire onclose when destroyed', () => {
    const t = new SSEConnectionTransport('test-9');
    let closed = false;
    t.onclose = () => { closed = true; };

    t.destroy();
    assert.ok(closed);
    assert.ok(t.isClosed());
  });

  it('should ignore messages after close', () => {
    const t = new SSEConnectionTransport('test-10');
    const received: unknown[] = [];
    t.onmessage = (msg) => received.push(msg);

    t.destroy();

    t.feedMessage(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'test' }));
    assert.strictEqual(received.length, 0);
  });

  it('should generate incrementing event ids', async () => {
    const t = new SSEConnectionTransport('test-11');
    const written: string[] = [];
    t.setWriteCallback((data) => written.push(data));

    await t.send({ jsonrpc: '2.0', id: 1, method: 'a', params: {} } as any);
    await t.send({ jsonrpc: '2.0', id: 2, method: 'b', params: {} } as any);
    await t.send({ jsonrpc: '2.0', id: 3, method: 'c', params: {} } as any);

    assert.match(written[0], /id: 1/);
    assert.match(written[1], /id: 2/);
    assert.match(written[2], /id: 3/);
  });

  it('should handle notifications (no id field)', async () => {
    const t = new SSEConnectionTransport('test-12');
    let notif: unknown;
    t.onmessage = (msg) => { notif = msg; };

    t.feedMessage(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/tools/list_changed',
    }));

    assert.ok(notif);
    assert.strictEqual((notif as any).method, 'notifications/tools/list_changed');
  });
});
