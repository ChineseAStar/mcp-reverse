/**
 * SSE Full Features — integration test
 *
 * End-to-end test: SSEAcceptor (public) ↔ SSEReverseClientTransport (internal).
 * Covers the entire MCP feature set: tools, resources, prompts.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { SSEAcceptor } from '../../src/sse/acceptor.js';
import { SSEReverseClientTransport } from '../../src/sse/reverse-client.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

async function freePort(): Promise<number> {
  const { createServer } = await import('net');
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const { port } = addr;
        srv.close(() => resolve(port));
      } else {
        reject(new Error('Could not find free port'));
      }
    });
  });
}

describe('SSE Full Features E2E', () => {
  let port: number;
  let acceptor: SSEAcceptor;
  let client: Client;
  let transport: SSEReverseClientTransport;
  let server: Server;

  before(async () => {
    port = await freePort();
  });

  after(async () => {
    try { await server?.close(); } catch {}
    try { await transport?.close(); } catch {}
    try { await client?.close(); } catch {}
    try { if (acceptor) { await acceptor.close(); } } catch {}
  });

  it('should support tools + resources + prompts', async () => {
    // ═══ Public side: SSEAcceptor + MCP Client ═══
    acceptor = new SSEAcceptor({ port, authTokens: { 'test-srv': 'tok' }, heartbeat: { enabled: false } });

    const clientPromise = new Promise<Client>((resolve) => {
      acceptor.onConnection(async ({ transport: acceptorTransport }) => {
        const mcpClient = new Client(
          { name: 'chat-ai', version: '1.0.0' },
          { capabilities: {} },
        );
        await mcpClient.connect(acceptorTransport);
        resolve(mcpClient);
      });
    });

    await acceptor.start();

    // ═══ Internal side: SSEReverseClientTransport + MCP Server ═══
    transport = new SSEReverseClientTransport({
      url: `http://localhost:${port}/mcp-reverse`,
      serverName: 'test-srv',
      authToken: 'tok',
      reconnect: { enabled: false },
    });

    server = new Server(
      { name: 'test-srv', version: '1.0.0' },
      {
        capabilities: {
          tools: {},
          resources: { subscribe: true },
          prompts: {},
          logging: {},
        },
        instructions: 'Test server for SSE E2E',
      },
    );

    // ─── Tools ───
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'greet',
          description: 'Greet someone',
          inputSchema: {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
          },
        },
        {
          name: 'add',
          description: 'Add two numbers',
          inputSchema: {
            type: 'object',
            properties: { a: { type: 'number' }, b: { type: 'number' } },
            required: ['a', 'b'],
          },
        },
      ],
    }));

    server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const { name, arguments: args } = req.params;
      if (name === 'greet') {
        return { content: [{ type: 'text', text: `Hello, ${args?.name ?? 'World'}!` }] };
      }
      if (name === 'add') {
        const result = (args?.a ?? 0) + (args?.b ?? 0);
        return { content: [{ type: 'text', text: `Result: ${result}` }] };
      }
      return { content: [{ type: 'text', text: 'Unknown tool' }], isError: true };
    });

    // ─── Resources ───
    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        { uri: 'file:///notes.txt', name: 'Notes', mimeType: 'text/plain' },
      ],
    }));

    server.setRequestHandler(ReadResourceRequestSchema, async () => ({
      contents: [{ uri: 'file:///notes.txt', mimeType: 'text/plain', text: 'Hello from SSE' }],
    }));

    // ─── Prompts ───
    server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: [
        { name: 'summarize', description: 'Summarize text' },
      ],
    }));

    server.setRequestHandler(GetPromptRequestSchema, async (req) => ({
      messages: [{ role: 'user', content: { type: 'text', text: `Prompt: ${req.params.name}` } }],
    }));

    // Connect the server via SSE reverse transport
    await server.connect(transport);

    // Wait for the client side to accept the connection
    client = await clientPromise;

    // ═══ TESTS ═══

    // 1. List tools
    const toolsResult = await client.listTools();
    assert.ok(toolsResult.tools);
    assert.strictEqual(toolsResult.tools.length, 2);
    assert.strictEqual(toolsResult.tools[0].name, 'greet');

    // 2. Call tool — greet
    const greetResult = await client.callTool({
      name: 'greet',
      arguments: { name: 'Alice' },
    });
    assert.strictEqual(greetResult.content[0].type, 'text');
    assert.match((greetResult.content[0] as { text: string }).text, /Hello, Alice/);

    // 3. Call tool — add
    const addResult = await client.callTool({
      name: 'add',
      arguments: { a: 3, b: 7 },
    });
    assert.match((addResult.content[0] as { text: string }).text, /Result: 10/);

    // 4. List resources
    const resourcesResult = await client.listResources();
    assert.ok(resourcesResult.resources);
    assert.strictEqual(resourcesResult.resources.length, 1);
    assert.strictEqual(resourcesResult.resources[0].name, 'Notes');

    // 5. Read resource
    const readResult = await client.readResource({ uri: 'file:///notes.txt' });
    assert.strictEqual(readResult.contents.length, 1);

    // 6. List prompts
    const promptsResult = await client.listPrompts();
    assert.ok(promptsResult.prompts);
    assert.strictEqual(promptsResult.prompts.length, 1);
    assert.strictEqual(promptsResult.prompts[0].name, 'summarize');

    // 7. Get prompt
    const promptResult = await client.getPrompt({ name: 'summarize' });
    assert.ok(promptResult.messages);
    assert.strictEqual(promptResult.messages.length, 1);
  });
});
