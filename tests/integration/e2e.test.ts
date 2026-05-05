/**
 * Full features E2E test
 * Verifies tools, resources, prompts, and notifications all work
 * through the reverse WebSocket transport.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { WebSocketAcceptor } from '../../src/websocket/acceptor.js';
import { ReverseClientTransport } from '../../src/websocket/reverse-client.js';

describe('Full Features E2E', () => {
  it('tools + resources + prompts + notifications', async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
    const {
      CallToolRequestSchema,
      ListToolsRequestSchema,
      ListResourcesRequestSchema,
      ReadResourceRequestSchema,
      ListPromptsRequestSchema,
      GetPromptRequestSchema,
      ToolListChangedNotificationSchema,
      ResourceListChangedNotificationSchema,
      PromptListChangedNotificationSchema,
    } = await import('@modelcontextprotocol/sdk/types.js');

    // --- Setup ---
    const acceptor = new WebSocketAcceptor({ port: 0, heartbeat: { enabled: false } });
    let clientTransport: any;
    const tp = new Promise<any>((r) => acceptor.onConnection(({ transport }) => { clientTransport = transport; r(transport); }));
    await acceptor.start();
    const addr = acceptor.getAddress();

    // --- Server ---
    const st = new ReverseClientTransport({
      url: `ws://localhost:${addr.port}${addr.path}`,
      serverName: 'full-features',
      reconnect: { enabled: false },
      heartbeat: { enabled: false },
    });

    const server = new Server(
      { name: 'full-features', version: '1.0.0' },
      { capabilities: { tools: {}, resources: {}, prompts: {} }, instructions: 'Test server' },
    );

    // Tools
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object', properties: { msg: { type: 'string' } } } }],
    }));
    server.setRequestHandler(CallToolRequestSchema, async (req: any) => ({
      content: [{ type: 'text', text: `Echo: ${req.params.arguments.msg}` }],
    }));

    // Resources
    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [{ uri: 'file:///test.txt', name: 'Test' }],
    }));
    server.setRequestHandler(ReadResourceRequestSchema, async () => ({
      contents: [{ uri: 'file:///test.txt', text: 'Hello', mimeType: 'text/plain' }],
    }));

    // Prompts
    server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: [{ name: 'summarize', description: 'Summarize', arguments: [{ name: 'text', required: true }] }],
    }));
    server.setRequestHandler(GetPromptRequestSchema, async (req: any) => ({
      messages: [{ role: 'user', content: { type: 'text', text: `Summary: ${req.params.arguments?.text}` } }],
    }));

    await server.connect(st as any);
    await tp;

    // --- Client ---
    const client = new Client({ name: 'c', version: '1.0.0' }, { capabilities: {} });
    await client.connect(clientTransport as any);

    // === Test all features ===

    // Tools
    const tools = await client.listTools();
    assert.strictEqual(tools.tools.length, 1);
    assert.strictEqual(tools.tools[0].name, 'echo');

    const r = await client.callTool({ name: 'echo', arguments: { msg: 'Hi' } });
    assert.strictEqual((r.content[0] as any).text, 'Echo: Hi');

    // Resources
    const resources = await client.listResources();
    assert.strictEqual(resources.resources[0].name, 'Test');

    const rr = await client.readResource({ uri: 'file:///test.txt' });
    assert.strictEqual((rr.contents[0] as any).text, 'Hello');

    // Prompts
    const prompts = await client.listPrompts();
    assert.strictEqual(prompts.prompts[0].name, 'summarize');

    const pr = await client.getPrompt({ name: 'summarize', arguments: { text: 'hello' } });
    assert.strictEqual((pr.messages[0] as any).content.text, 'Summary: hello');

    // Notifications (Server → Client)
    let toolChanged = false;
    let resourceChanged = false;
    let promptChanged = false;

    client.setNotificationHandler(ToolListChangedNotificationSchema as any, () => { toolChanged = true; });
    client.setNotificationHandler(ResourceListChangedNotificationSchema as any, () => { resourceChanged = true; });
    client.setNotificationHandler(PromptListChangedNotificationSchema as any, () => { promptChanged = true; });

    await server.sendToolListChanged();
    await server.sendResourceListChanged();
    await server.sendPromptListChanged();
    await new Promise((r) => setTimeout(r, 300));

    assert.strictEqual(toolChanged, true);
    assert.strictEqual(resourceChanged, true);
    assert.strictEqual(promptChanged, true);

    // Cleanup
    await client.close();
    await st.close();
    await acceptor.close();
  });
});
