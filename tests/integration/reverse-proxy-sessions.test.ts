import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:net';
import { ReverseProxy } from '../../src/proxy/reverse-proxy.js';
import { SSEReverseClientTransport } from '../../src/connector/sse-connector.js';
import type { SSEConnectionTransport } from '../../src/transport/sse-transport.js';

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate port');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function waitFor(predicate: () => boolean, timeout = 1000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

type ProxyState = {
  reverseTransport: SSEConnectionTransport | null;
  reverseSessionId: string | null;
};

describe('ReverseProxy session replacement', () => {
  it('does not let a stale session disconnect clear the active replacement', async () => {
    const port = await freePort();
    const name = 'proxy-session-test';
    const token = 'proxy-token';
    const proxy = new ReverseProxy({ name, token, port, host: '127.0.0.1' });
    const state = proxy as unknown as ProxyState;

    const first = new SSEReverseClientTransport({
      url: `http://127.0.0.1:${port}/mcp/reverse`,
      serverName: name,
      authToken: token,
      heartbeat: { enabled: false },
      connectTimeout: 500,
    });
    const second = new SSEReverseClientTransport({
      url: `http://127.0.0.1:${port}/mcp/reverse`,
      serverName: name,
      authToken: token,
      heartbeat: { enabled: false },
      connectTimeout: 500,
    });
    const attacker = new SSEReverseClientTransport({
      url: `http://127.0.0.1:${port}/mcp/reverse`,
      serverName: 'attacker-controlled-name',
      heartbeat: { enabled: false },
      connectTimeout: 500,
    });

    try {
      await proxy.start();
      await first.start();
      await waitFor(() => state.reverseSessionId === first.reverseSessionId);

      await assert.rejects(attacker.start(), /HTTP 401 Unauthorized/);
      assert.strictEqual(state.reverseSessionId, first.reverseSessionId);

      await second.start();
      await waitFor(() => state.reverseSessionId === second.reverseSessionId);
      assert.strictEqual(state.reverseTransport?.reverseSessionId, second.reverseSessionId);

      // Closing the already-superseded session must not clear the new one.
      await first.close();
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.strictEqual(state.reverseSessionId, second.reverseSessionId);
      assert.strictEqual(state.reverseTransport?.reverseSessionId, second.reverseSessionId);

      await second.close();
      await waitFor(() => state.reverseSessionId === null && state.reverseTransport === null);
    } finally {
      await first.close();
      await second.close();
      await attacker.close();
      await proxy.close();
    }
  });
});
