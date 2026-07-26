import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEAcceptor } from '../../src/acceptor/sse-acceptor.js';
import { ReverseMCPClient } from '../../src/connector/mcp-connector.js';

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

async function waitFor(predicate: () => boolean, timeout = 3000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('ReverseMCPClient reconnection', () => {
  it('keeps retrying through a gateway restart and establishes a new session', async () => {
    const port = await freePort();
    const serverName = 'restart-test';
    const authToken = 'restart-token';

    let acceptor = new SSEAcceptor({
      port,
      host: '127.0.0.1',
      authTokens: { [serverName]: authToken },
      heartbeat: { enabled: false },
      sessionTimeout: 5000,
    });
    await acceptor.start();

    const mcpServer = new McpServer({ name: serverName, version: '1.0.0' });
    const reverse = await ReverseMCPClient.createSSE(mcpServer, {
      url: `http://127.0.0.1:${port}/mcp-reverse`,
      serverName,
      authToken,
      connectTimeout: 100,
      reconnect: {
        initialDelay: 10,
        maxDelay: 20,
        multiplier: 1,
        jitter: false,
        maxRetries: 0,
      },
    });

    let connected = 0;
    let disconnected = 0;
    let reconnecting = 0;
    let failed = 0;
    reverse.on('connected', () => { connected++; });
    reverse.on('disconnected', () => { disconnected++; });
    reverse.on('reconnecting', () => { reconnecting++; });
    reverse.on('failed', () => { failed++; });

    try {
      await reverse.start();
      await waitFor(() => acceptor.sessionCount === 1 && connected === 1);

      await acceptor.close();
      await waitFor(() => disconnected === 1 && reconnecting >= 1);

      // Keep the gateway down long enough for at least one connection attempt
      // to fail. The old implementation falsely entered CONNECTED here and
      // permanently cancelled its retry timer.
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.strictEqual(connected, 1);

      acceptor = new SSEAcceptor({
        port,
        host: '127.0.0.1',
        authTokens: { [serverName]: authToken },
        heartbeat: { enabled: false },
        sessionTimeout: 5000,
      });
      await acceptor.start();

      await waitFor(() => acceptor.sessionCount === 1 && connected === 2);
      assert.strictEqual(failed, 0);
      assert.ok(reconnecting >= 1);
    } finally {
      await reverse.stop();
      await acceptor.close();
    }
  });

  it('does not emit connected when every connection attempt is rejected', async () => {
    const port = await freePort();
    const acceptor = new SSEAcceptor({
      port,
      host: '127.0.0.1',
      authTokens: { 'rejected-test': 'expected-token' },
      heartbeat: { enabled: false },
    });
    await acceptor.start();

    const mcpServer = new McpServer({ name: 'rejected-test', version: '1.0.0' });
    const reverse = await ReverseMCPClient.createSSE(mcpServer, {
      url: `http://127.0.0.1:${port}/mcp-reverse`,
      serverName: 'rejected-test',
      authToken: 'wrong-token',
      connectTimeout: 100,
      reconnect: {
        initialDelay: 5,
        maxDelay: 5,
        multiplier: 1,
        jitter: false,
        maxRetries: 3,
      },
    });

    let connected = 0;
    let failed = 0;
    reverse.on('connected', () => { connected++; });
    reverse.on('failed', () => { failed++; });

    try {
      await reverse.start();
      await waitFor(() => failed === 1);
      assert.strictEqual(connected, 0);
      assert.strictEqual(acceptor.sessionCount, 0);
    } finally {
      await reverse.stop();
      await acceptor.close();
    }
  });
});
