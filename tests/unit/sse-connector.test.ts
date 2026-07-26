import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { SSEReverseClientTransport } from '../../src/connector/sse-connector.js';

interface TestServer {
  server: Server;
  baseUrl: string;
  close: () => Promise<void>;
}

async function startServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<TestServer> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const { port } = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}/mcp-reverse`,
    close: async () => {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function notification(method = 'notifications/test'): JSONRPCMessage {
  return { jsonrpc: '2.0', method };
}

async function waitFor(predicate: () => boolean, timeout = 1000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('SSEReverseClientTransport', () => {
  it('rejects failed connection attempts and notifies close exactly once', async () => {
    const http = await startServer((_req, res) => {
      res.writeHead(401, 'Unauthorized');
      res.end('Unauthorized');
    });

    try {
      const transport = new SSEReverseClientTransport({
        url: http.baseUrl,
        serverName: 'failure-test',
        heartbeat: { enabled: false },
        connectTimeout: 500,
      });
      let closeCount = 0;
      transport.onclose = () => { closeCount++; };

      await assert.rejects(transport.start(), /HTTP 401 Unauthorized/);
      assert.strictEqual(transport.isConnected, false);
      assert.strictEqual(closeCount, 1);

      await transport.close();
      assert.strictEqual(closeCount, 1);
    } finally {
      await http.close();
    }
  });

  it('times out a connection that never returns SSE headers', async () => {
    const http = await startServer(() => {
      // Intentionally leave the response without headers or a body.
    });

    try {
      const transport = new SSEReverseClientTransport({
        url: http.baseUrl,
        serverName: 'timeout-test',
        heartbeat: { enabled: false },
        connectTimeout: 30,
      });
      let closeCount = 0;
      transport.onclose = () => { closeCount++; };

      await assert.rejects(transport.start(), /timed out after 30ms/);
      assert.strictEqual(closeCount, 1);
      assert.strictEqual(transport.isConnected, false);
    } finally {
      await http.close();
    }
  });

  it('actually posts queued messages before resolving their send promises', async () => {
    let releaseSSE!: () => void;
    const allowSSE = new Promise<void>((resolve) => { releaseSSE = resolve; });
    const posts: Array<{ body: string; customHeader?: string }> = [];
    let getCustomHeader: string | undefined;

    const http = await startServer((req, res) => {
      if (req.method === 'GET') {
        getCustomHeader = req.headers['x-custom-header'] as string | undefined;
        void allowSSE.then(() => {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'X-Session-Id': 'queued-session',
          });
          res.write(': connected\n\n');
        });
        return;
      }

      if (req.method === 'POST') {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          posts.push({
            body: Buffer.concat(chunks).toString(),
            customHeader: req.headers['x-custom-header'] as string | undefined,
          });
          res.writeHead(202);
          res.end();
        });
        return;
      }

      res.writeHead(404).end();
    });

    const transport = new SSEReverseClientTransport({
      url: http.baseUrl,
      serverName: 'queue-test',
      headers: { 'X-Custom-Header': 'present' },
      heartbeat: { enabled: false },
      connectTimeout: 500,
    });

    try {
      const startPromise = transport.start();
      let sendSettled = false;
      const message = notification();
      const sendPromise = transport.send(message).finally(() => { sendSettled = true; });

      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.strictEqual(sendSettled, false);
      assert.strictEqual(posts.length, 0);

      releaseSSE();
      await startPromise;
      await sendPromise;

      assert.strictEqual(posts.length, 1);
      assert.deepStrictEqual(JSON.parse(posts[0].body), message);
      assert.strictEqual(getCustomHeader, 'present');
      assert.strictEqual(posts[0].customHeader, 'present');
    } finally {
      await transport.close();
      await http.close();
    }
  });

  it('unbinds the MCP SDK when URL construction fails synchronously', async () => {
    const mcpServer = new McpServer({ name: 'invalid-url-test', version: '1.0.0' });
    const invalid = new SSEReverseClientTransport({
      url: 'not a valid URL',
      serverName: 'invalid-url-test',
      heartbeat: { enabled: false },
    });

    await assert.rejects(mcpServer.connect(invalid), /Invalid URL/);

    const working: Transport = {
      start: async () => {},
      send: async () => {},
      close: async () => { working.onclose?.(); },
    };
    await mcpServer.connect(working);
    await mcpServer.close();
  });

  it('preserves FIFO order across the connecting-to-open transition', async () => {
    let releaseSSE!: () => void;
    const allowSSE = new Promise<void>((resolve) => { releaseSSE = resolve; });
    let releaseFirstPost!: () => void;
    const allowFirstPostResponse = new Promise<void>((resolve) => { releaseFirstPost = resolve; });
    const methods: string[] = [];

    const http = await startServer((req, res) => {
      if (req.method === 'GET') {
        void allowSSE.then(() => {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'X-Session-Id': 'fifo-session',
          });
          res.write(': connected\n\n');
        });
        return;
      }

      if (req.method === 'POST') {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          methods.push(JSON.parse(Buffer.concat(chunks).toString()).method);
          if (methods.length === 1) {
            void allowFirstPostResponse.then(() => {
              res.writeHead(202);
              res.end();
            });
          } else {
            res.writeHead(202);
            res.end();
          }
        });
      }
    });

    const transport = new SSEReverseClientTransport({
      url: http.baseUrl,
      serverName: 'fifo-test',
      heartbeat: { enabled: false },
      connectTimeout: 500,
    });

    try {
      const startPromise = transport.start();
      const firstSend = transport.send(notification('notifications/first'));
      releaseSSE();

      await waitFor(() => transport.isConnected && methods.length === 1);
      const secondSend = transport.send(notification('notifications/second'));
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.deepStrictEqual(methods, ['notifications/first']);

      releaseFirstPost();
      await Promise.all([startPromise, firstSend, secondSend]);
      assert.deepStrictEqual(methods, ['notifications/first', 'notifications/second']);
    } finally {
      await transport.close();
      await http.close();
    }
  });

  it('retires the session and fires onclose when a POST fails', async () => {
    const http = await startServer((req, res) => {
      if (req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'X-Session-Id': 'expired-session',
        });
        res.write(': connected\n\n');
        return;
      }

      res.writeHead(404, 'Not Found');
      res.end('Session not found');
    });

    try {
      const transport = new SSEReverseClientTransport({
        url: http.baseUrl,
        serverName: 'post-failure-test',
        heartbeat: { enabled: false },
        connectTimeout: 500,
      });
      let closeCount = 0;
      transport.onclose = () => { closeCount++; };

      await transport.start();
      assert.strictEqual(transport.isConnected, true);

      await assert.rejects(transport.send(notification()), /POST failed: HTTP 404 Not Found/);
      assert.strictEqual(transport.isConnected, false);
      assert.strictEqual(closeCount, 1);

      await transport.close();
      assert.strictEqual(closeCount, 1);
    } finally {
      await http.close();
    }
  });
});
