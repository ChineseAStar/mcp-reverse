import { describe, it } from 'node:test';
import assert from 'node:assert';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { SSEAcceptor } from '../../src/acceptor/sse-acceptor.js';

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Could not allocate a test port');
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function waitFor(predicate: () => boolean, timeout = 1000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('SSEAcceptor session lifecycle', () => {
  it('extends the idle timeout after POST activity and reports the exact session id', async () => {
    const port = await freePort();
    const serverName = 'timeout-reset-test';
    const token = 'token';
    // Real HTTP scheduling needs headroom on loaded CI runners; the two activity
    // intervals still cross the original deadline without crossing the renewed one.
    const timeout = 1000;
    const activityInterval = 600;
    const disconnected: Array<{ serverName: string; sessionId: string }> = [];

    const acceptor = new SSEAcceptor({
      port,
      host: '127.0.0.1',
      authTokens: { [serverName]: token },
      heartbeat: { enabled: false },
      sessionTimeout: timeout,
    });
    acceptor.onDisconnection((name, sessionId) => {
      assert.ok(sessionId);
      disconnected.push({ serverName: name, sessionId });
    });

    const abort = new AbortController();

    try {
      await acceptor.start();
      const response = await fetch(`http://127.0.0.1:${port}/mcp-reverse/sse`, {
        headers: {
          'X-MCP-Server-Name': serverName,
          'Authorization': `Bearer ${token}`,
        },
        signal: abort.signal,
      });
      assert.strictEqual(response.status, 200);
      const sessionId = response.headers.get('x-session-id');
      assert.ok(sessionId);
      assert.strictEqual(acceptor.sessionCount, 1);

      await new Promise((resolve) => setTimeout(resolve, activityInterval));
      const postResponse = await fetch(
        `http://127.0.0.1:${port}/mcp-reverse/message?sessionId=${encodeURIComponent(sessionId)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/activity' }),
        },
      );
      assert.strictEqual(postResponse.status, 202);

      // The original creation-based timer would have expired by now. The
      // session must remain alive until timeout milliseconds after the POST.
      await new Promise((resolve) => setTimeout(resolve, activityInterval));
      assert.strictEqual(acceptor.sessionCount, 1);

      await waitFor(() => acceptor.sessionCount === 0, timeout * 2);
      assert.deepStrictEqual(disconnected, [{ serverName, sessionId }]);
    } finally {
      abort.abort();
      await acceptor.close();
    }
  });

  it('does not expire a session while a POST body is actively streaming', async () => {
    const port = await freePort();
    const serverName = 'slow-post-test';
    const token = 'slow-token';
    const timeout = 80;
    const acceptor = new SSEAcceptor({
      port,
      host: '127.0.0.1',
      authTokens: { [serverName]: token },
      heartbeat: { enabled: false },
      sessionTimeout: timeout,
    });
    const abort = new AbortController();

    try {
      await acceptor.start();
      const response = await fetch(`http://127.0.0.1:${port}/mcp-reverse/sse`, {
        headers: {
          'X-MCP-Server-Name': serverName,
          'Authorization': `Bearer ${token}`,
        },
        signal: abort.signal,
      });
      const sessionId = response.headers.get('x-session-id');
      assert.ok(sessionId);

      const payload = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/slow' });
      const quarter = Math.floor(payload.length / 4);
      const statusPromise = new Promise<number>((resolve, reject) => {
        const req = request({
          host: '127.0.0.1',
          port,
          method: 'POST',
          path: `/mcp-reverse/message?sessionId=${encodeURIComponent(sessionId)}`,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            'Authorization': `Bearer ${token}`,
          },
        }, (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        });
        req.on('error', reject);
        req.write(payload.slice(0, quarter));
        setTimeout(() => req.write(payload.slice(quarter, quarter * 2)), 40);
        setTimeout(() => req.write(payload.slice(quarter * 2, quarter * 3)), 80);
        setTimeout(() => req.end(payload.slice(quarter * 3)), 120);
      });

      await new Promise((resolve) => setTimeout(resolve, timeout + 20));
      assert.strictEqual(acceptor.sessionCount, 1);
      assert.strictEqual(await statusPromise, 202);
      assert.strictEqual(acceptor.sessionCount, 1);
    } finally {
      abort.abort();
      await acceptor.close();
    }
  });

  it('expires a stalled POST after one inactivity window', async () => {
    const port = await freePort();
    const serverName = 'stalled-post-test';
    const token = 'stalled-token';
    const timeout = 60;
    const acceptor = new SSEAcceptor({
      port,
      host: '127.0.0.1',
      authTokens: { [serverName]: token },
      heartbeat: { enabled: false },
      sessionTimeout: timeout,
    });
    const abort = new AbortController();
    let stalledRequest: ReturnType<typeof request> | undefined;

    try {
      await acceptor.start();
      const response = await fetch(`http://127.0.0.1:${port}/mcp-reverse/sse`, {
        headers: {
          'X-MCP-Server-Name': serverName,
          'Authorization': `Bearer ${token}`,
        },
        signal: abort.signal,
      });
      const sessionId = response.headers.get('x-session-id');
      assert.ok(sessionId);

      stalledRequest = request({
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: `/mcp-reverse/message?sessionId=${encodeURIComponent(sessionId)}`,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': 100,
          'Authorization': `Bearer ${token}`,
        },
      });
      stalledRequest.on('error', () => {});
      stalledRequest.write('{');

      await waitFor(() => acceptor.sessionCount === 0, 500);
    } finally {
      stalledRequest?.destroy();
      abort.abort();
      await acceptor.close();
    }
  });

  it('enforces maxMessageSize while streaming a framework Request body', async () => {
    const serverName = 'framework-limit-test';
    const token = 'framework-token';
    const acceptor = new SSEAcceptor({
      authTokens: { [serverName]: token },
      heartbeat: { enabled: false },
      sessionTimeout: 1000,
      maxMessageSize: 10,
    });
    const abort = new AbortController();

    try {
      const sseResponse = await acceptor.handleSSE(new Request('http://localhost/mcp-reverse/sse', {
        headers: {
          'X-MCP-Server-Name': serverName,
          'Authorization': `Bearer ${token}`,
        },
        signal: abort.signal,
      })) as Response;
      const sessionId = sseResponse.headers.get('x-session-id');
      assert.ok(sessionId);

      let pulls = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls++;
          controller.enqueue(new Uint8Array(8));
          if (pulls >= 20) controller.close();
        },
      });
      const messageRequest = new Request(
        `http://localhost/mcp-reverse/message?sessionId=${encodeURIComponent(sessionId)}`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body,
          duplex: 'half',
        } as RequestInit & { duplex: 'half' },
      );

      const response = await acceptor.handleMessage(messageRequest) as Response;
      assert.strictEqual(response.status, 413);
      assert.ok(pulls < 20, `expected early cancellation, but read all ${pulls} chunks`);
    } finally {
      abort.abort();
      await acceptor.close();
    }
  });
});
