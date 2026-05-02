# mcp-reverse

> Reverse WebSocket transport for MCP.  
> Let internal servers behind NAT/firewall connect OUT to your public client.

## The Problem

Standard MCP transports are **client-initiated**: the Client must reach the Server's address.

```
Client (public) ───connect───> Server (public)   ✅ works
Client (public) ───connect───X Server (NAT)       ❌ unreachable
```

`mcp-reverse` **flips the direction at the transport layer.** The Server (internal) initiates the connection; the Client (public) accepts it. The MCP protocol then runs normally over the established channel.

```
Client (public) <───connect──── Server (NAT)       ✅ works
```

## Features

| Feature | Description |
|---------|-------------|
| 🔌 **Reverse WebSocket** | Server connects to Client via outgoing WebSocket |
| 🔐 **Auth** | Token header + custom auth handler |
| ❤️ **Heartbeat** | Ping/Pong keepalive, configurable timeout |
| 🔄 **Auto-reconnect** | Exponential backoff + jitter |
| 🔒 **TLS** | WSS on Client side |
| 🛡️ **All MCP features** | Tools, Prompts, Resources, Roots, Notifications, Elicitation, Sampling, Logging, Instructions — all transparent |

## Install

```bash
npm install mcp-reverse
```

Requires `@modelcontextprotocol/sdk` ^1.0.0 as peer dependency.

---

## Quick Start

### Client Side (Public — chat-ai / cloud)

```typescript
import { WebSocketAcceptor } from 'mcp-reverse';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const acceptor = new WebSocketAcceptor({
  port: 9090,
  authTokens: { 'office-server': 'secret123' },
});

acceptor.onConnection(async ({ transport, metadata }) => {
  console.log(`Server connected: ${metadata.serverName}`);

  const client = new Client(
    { name: 'chat-ai', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);

  // Use client normally
  const tools = await client.listTools();
  const result = await client.callTool({
    name: 'exec',
    arguments: { cmd: 'ls' },
  });
});

acceptor.onDisconnection((name) => console.log(`Disconnected: ${name}`));
await acceptor.start();
```

### Server Side (Internal — behind NAT)

The Server side is a standard MCP Server. Just use `ReverseClientTransport` instead of `StdioServerTransport`.

```typescript
import { ReverseClientTransport } from 'mcp-reverse';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// 1. Create the reverse transport (connects OUT to the public client)
const transport = new ReverseClientTransport({
  url: 'wss://public-chatai.example.com:9090/ws',
  serverName: 'office-server',
  authToken: 'secret123',
  reconnect: { enabled: true },
  heartbeat: { enabled: true },
});

// 2. Create a standard MCP Server with ALL capabilities
const server = new Server(
  { name: 'office-server', version: '1.0.0' },
  {
    capabilities: {
      tools: {},
      resources: { subscribe: true },
      prompts: {},
      logging: {},
    },
    instructions: 'This server provides internal office tools and data.',
  },
);

// ─── Tools ───
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'exec',
      description: 'Execute a shell command',
      inputSchema: {
        type: 'object',
        properties: { cmd: { type: 'string' } },
        required: ['cmd'],
      },
    },
    {
      name: 'screenshot',
      description: 'Take a screenshot',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  switch (name) {
    case 'exec':
      return { content: [{ type: 'text', text: `Ran: ${args.cmd}` }] };
    case 'screenshot':
      return { content: [{ type: 'image', data: 'base64...', mimeType: 'image/png' }] };
    default:
      return { content: [{ type: 'text', text: 'Unknown tool' }], isError: true };
  }
});

// ─── Resources ───
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    { uri: 'file:///docs/readme.md', name: 'Readme', mimeType: 'text/markdown' },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (req) => ({
  contents: [{ uri: req.params.uri, mimeType: 'text/markdown', text: '# Hello' }],
}));

// ─── Prompts ───
server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [
    { name: 'review', description: 'Code review prompt',
      arguments: [{ name: 'file', description: 'File to review', required: true }],
    },
  ],
}));

server.setRequestHandler(GetPromptRequestSchema, async (req) => ({
  messages: [{ role: 'user', content: { type: 'text', text: `Review ${req.params.arguments?.file}` } }],
}));

// ─── Notifications: Server can notify the Client ───
// Tell the Client that tools changed
await server.sendToolListChanged();

// Tell the Client that resources changed
await server.sendResourceListChanged();

// Tell the Client a specific resource was updated
await server.sendResourceUpdated({ uri: 'file:///docs/readme.md' });

// Tell the Client that prompts changed
await server.sendPromptListChanged();

// Send a log message to the Client
await server.sendLoggingMessage({
  level: 'info',
  data: 'Server initialized',
});

// ─── Server can also REQUEST from the Client ───
// List roots (workspaces)
const roots = await server.listRoots();

// Request LLM sampling
const msg = await server.createMessage({
  messages: [{ role: 'user', content: { type: 'text', text: 'Summarize' } }],
  maxTokens: 100,
});

// 3. Connect via reverse transport
await server.connect(transport);
```

---

## All MCP Features — Confirmed Working

| MCP Feature | Client → Server | Server → Client | Handled By |
|-------------|:---:|:---:|------------|
| `tools/list` | ✅ Request | — | `ListToolsRequestSchema` |
| `tools/call` | ✅ Request | — | `CallToolRequestSchema` |
| `notifications/tools/list_changed` | — | ✅ `server.sendToolListChanged()` | Transport.send() |
| `resources/list` | ✅ Request | — | `ListResourcesRequestSchema` |
| `resources/read` | ✅ Request | — | `ReadResourceRequestSchema` |
| `resources/subscribe` | ✅ Request | — | `SubscribeRequestSchema` |
| `notifications/resources/list_changed` | — | ✅ `server.sendResourceListChanged()` | Transport.send() |
| `notifications/resources/updated` | — | ✅ `server.sendResourceUpdated()` | Transport.send() |
| `prompts/list` | ✅ Request | — | `ListPromptsRequestSchema` |
| `prompts/get` | ✅ Request | — | `GetPromptRequestSchema` |
| `notifications/prompts/list_changed` | — | ✅ `server.sendPromptListChanged()` | Transport.send() |
| `roots/list` | — | ✅ `server.listRoots()` | Transport.send() + response |
| `notifications/roots/list_changed` | ✅ Client notification | — | Transport.onmessage |
| `sampling/createMessage` | — | ✅ `server.createMessage()` | Transport.send() + response |
| `elicitation/create` | — | ✅ `server.elicitInput()` | Transport.send() + response |
| `notifications/message` (logging) | — | ✅ `server.sendLoggingMessage()` | Transport.send() |
| `ping` | ✅ Client request | ✅ Server request | Both directions |
| `completion/complete` | ✅ Request | — | `CompleteRequestSchema` |
| **Instructions** | — | In `initialize` response | `Server` constructor option |

> **Key insight:** The Transport is a transparent JSON-RPC pipe. Any message that flows through `transport.send()` / `transport.onmessage` works automatically. No special handling per feature.

---

## API Reference

### `WebSocketAcceptor` (Client Side)

```typescript
new WebSocketAcceptor(options: WebSocketAcceptorOptions)
```

| Option | Type | Default | Notes |
|--------|------|---------|-------|
| `port` | `number` | required | Listening port |
| `host` | `string` | `'0.0.0.0'` | Bind address |
| `path` | `string` | `'/ws'` | Upgrade path |
| `authTokens` | `Record<string, string>` | — | `serverName → token` map |
| `authHandler` | `async (meta) => boolean` | — | Custom auth logic |
| `heartbeat` | `HeartbeatOptions` | `{enabled:false}` | Keepalive |
| `tls` | `{cert, key}` | — | TLS files for WSS |
| `maxMessageSize` | `number` | `4MB` | Message limit |

Methods:
- `start()` / `close()` — lifecycle
- `onConnection(fn)` — new server connected
- `onDisconnection(fn)` — server disconnected
- `onError(fn)` — server error
- `getAddress()` — `{ host, port, path }`

### `ReverseClientTransport` (Server Side)

```typescript
new ReverseClientTransport(options: ReverseClientTransportOptions)
```

| Option | Type | Default | Notes |
|--------|------|---------|-------|
| `url` | `string` | required | Target WebSocket URL |
| `serverName` | `string` | required | Server identifier |
| `authToken` | `string` | — | Bearer token |
| `reconnect` | `ReconnectOptions` | `{enabled:false}` | Auto-reconnect |
| `heartbeat` | `HeartbeatOptions` | `{enabled:false}` | Keepalive |
| `headers` | `Record<string, string>` | — | Extra headers |
| `insecureTls` | `boolean` | `false` | Skip TLS verify |

Properties:
- `state` — `ConnectionState` enum
- `sessionId` — unique session id
- `reconnectAttempts` — count

### Reconnect Options

```typescript
{
  enabled?: boolean;      // default: false
  initialDelay?: number;  // default: 1000ms
  maxDelay?: number;      // default: 30000ms
  multiplier?: number;    // default: 2
  jitter?: boolean;       // default: true
  maxRetries?: number;    // default: 0 (infinite)
}
```

---

## Testing

```bash
npm test                   # All 29 tests
npm run test:e2e           # E2E only
npm run typecheck          # TypeScript check
```

---

## Credits

- [CleverChatty](https://github.com/Gelembjuk/cleverchatty) — first `reverse-websocket` MCP implementation (Go)
- [Supergateway](https://github.com/supercorp-ai/supergateway) — MCP WS transport bridge

## License

MIT
