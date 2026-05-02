# mcp-reverse

> Reverse transports for MCP — WebSocket &amp; SSE engines.  
> Let internal MCP servers behind NAT/firewall connect OUT to your public client.

## The Problem

Standard MCP transports are **client-initiated**: the Client must reach the Server's address.

```
Client (public) ───connect───> Server (public)   ✅ works
Client (public) ───connect───X Server (NAT)       ❌ unreachable
```

`mcp-reverse` **flips the direction at the transport layer.** The internal MCP Server initiates the connection; the public MCP Client accepts it. The MCP protocol then runs normally over the established channel.

```
Public Client (chat-ai) <───incoming──── Internal Server (behind NAT)       ✅ works
```

## Two Transport Engines

| Engine | Protocol | Best for |
|--------|----------|----------|
| **WebSocket** | `ws://` / `wss://` | Native Node.js, low-latency, high-throughput |
| **SSE** | HTTP + Server-Sent Events | Next.js, Express, Deno, serverless, any HTTP framework |

### Which engine should I use?

- **WebSocket** — When you control the server (Electron, Docker, bare-metal Node.js) and want the lowest latency.
- **SSE** — When deploying to a web platform (Next.js App Router, Vercel, Express) that already has an HTTP server. **No extra port needed.**

Both engines support the full MCP feature set: tools, resources, prompts, notifications, logging, etc.

## Features

| Feature | WebSocket | SSE |
|---------|:---:|:---:|
| NAT traversal | ✅ | ✅ |
| Authentication (token + custom handler) | ✅ | ✅ |
| Keepalive / heartbeat | ✅ Ping/Pong | ✅ SSE comments |
| Auto-reconnect (exponential backoff + jitter) | ✅ | ✅ |
| TLS / HTTPS | ✅ WSS | ✅ HTTPS |
| Tools / Resources / Prompts | ✅ | ✅ |
| Notifications (both directions) | ✅ | ✅ |
| Single-port deployment | ❌ | ✅ |
| Next.js / Vercel / serverless | ❌ | ✅ |

## Install

```bash
npm install mcp-reverse
```

Requires `@modelcontextprotocol/sdk` as peer dependency and `ws` (for WebSocket engine).

---

## Quick Start — SSE (Recommended for Web Platforms)

### Public Side (chat-ai / Next.js App Router)

```typescript
import { SSEAcceptor } from 'mcp-reverse';
// or: import { SSEAcceptor } from 'mcp-reverse/sse';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const acceptor = new SSEAcceptor({
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

acceptor.onDisconnection((serverName) => console.log(`Disconnected: ${serverName}`));

// ─── Next.js App Router integration ───
// GET /api/mcp-reverse/sse
export async function GET(req: NextRequest) {
  return acceptor.handleSSE(req);
}

// POST /api/mcp-reverse/message
export async function POST(req: NextRequest) {
  return acceptor.handleMessage(req);
}
```

**Or run standalone** (creates its own HTTP server):

```typescript
const acceptor = new SSEAcceptor({ port: 3400, authTokens: { ... } });
await acceptor.start();  // listens on http://0.0.0.0:3400/mcp-reverse
```

### Internal Side (behind NAT)

```typescript
import { SSEReverseClientTransport } from 'mcp-reverse';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

const transport = new SSEReverseClientTransport({
  url: 'https://public-chatai.example.com:3000/mcp-reverse',
  serverName: 'office-server',
  authToken: 'secret123',
  reconnect: { enabled: true },
});

const server = new Server(
  { name: 'office-server', version: '1.0.0' },
  { capabilities: { tools: {}, resources: {}, prompts: {} } }
);

// ... register tool/resource/prompt handlers ...

await server.connect(transport);
```

---

## Quick Start — WebSocket

### Public Side

```typescript
import { WebSocketAcceptor } from 'mcp-reverse';
// or: import { WebSocketAcceptor } from 'mcp-reverse/websocket';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const acceptor = new WebSocketAcceptor({
  port: 9090,
  authTokens: { 'office-server': 'secret123' },
});

acceptor.onConnection(async ({ transport, metadata }) => {
  const client = new Client(
    { name: 'chat-ai', version: '1.0.0' },
    { capabilities: {} }
  );
  await client.connect(transport);
});

acceptor.onDisconnection((name) => console.log(`Disconnected: ${name}`));
await acceptor.start();
```

### Internal Side

```typescript
import { ReverseClientTransport } from 'mcp-reverse';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

const transport = new ReverseClientTransport({
  url: 'wss://public-chatai.example.com:9090/ws',
  serverName: 'office-server',
  authToken: 'secret123',
  reconnect: { enabled: true },
  heartbeat: { enabled: true },
});

const server = new Server(
  { name: 'office-server', version: '1.0.0' },
  { capabilities: { tools: {}, resources: {}, prompts: {} } }
);

await server.connect(transport);
```

---

## API Reference

### `SSEAcceptor` (Public Side — SSE)

```typescript
new SSEAcceptor(options: SSEAcceptorOptions | SSEAcceptorStandaloneOptions)
```

| Option | Type | Default | Notes |
|--------|------|---------|-------|
| `authTokens` | `Record<string, string>` | — | `serverName → token` map |
| `authHandler` | `async (meta) => boolean` | — | Custom auth logic |
| `heartbeat` | `SSEHeartbeatOptions` | `{enabled:true}` | Keepalive |
| `maxMessageSize` | `number` | `4MB` | POST body limit |
| `sessionTimeout` | `number` | `60000` | Inactivity timeout (ms) |
| `pathPrefix` | `string` | `'/mcp-reverse'` | URL prefix |
| `port` | `number` | — | **Standalone only**: listen port |

**Framework mode methods** (Next.js / Express):

- `handleSSE(req)` — Returns HTTP response for GET SSE connections
- `handleMessage(req)` — Returns HTTP response for POST messages

**Standalone mode methods** (when `port` is provided):

- `start()` / `close()` — Lifecycle
- `isRunning()` — Whether the server is running
- `getAddress()` — `{ host, port, pathPrefix }`

**Event handlers** (both modes):

- `onConnection(fn)` — New server connected. Receives `{ transport, metadata, sessionId }`
- `onDisconnection(fn)` — Server disconnected
- `onError(fn)` — Error occurred

### `SSEReverseClientTransport` (Internal Side — SSE)

```typescript
new SSEReverseClientTransport(options: SSEReverseClientTransportOptions)
```

| Option | Type | Default | Notes |
|--------|------|---------|-------|
| `url` | `string` | required | Base URL (appends `/sse` and `/message`) |
| `serverName` | `string` | required | Server identifier |
| `authToken` | `string` | — | Bearer token |
| `reconnect` | `ReconnectOptions` | `{enabled:true}` | Auto-reconnect |
| `heartbeat` | `SSEHeartbeatOptions` | `{enabled:true}` | Keepalive |
| `headers` | `Record<string, string>` | — | Extra headers |
| `insecureTls` | `boolean` | `false` | Skip TLS verify |
| `queryParams` | `Record<string, string>` | — | Extra query params |

Properties: `state`, `sessionId`, `reconnectAttempts`

### `WebSocketAcceptor` (Public Side — WebSocket)

```typescript
new WebSocketAcceptor(options: WebSocketAcceptorOptions)
```

| Option | Type | Default | Notes |
|--------|------|---------|-------|
| `port` | `number` | required | Listening port |
| `host` | `string` | `'0.0.0.0'` | Bind address |
| `path` | `string` | `'/ws'` | Upgrade path |
| `authTokens` | `Record<string, string>` | — | `serverName → token` map |
| `authHandler` | `async (meta) => boolean` | — | Custom auth |
| `heartbeat` | `HeartbeatOptions` | `{enabled:false}` | Ping/Pong |
| `tls` | `{cert, key}` | — | WSS cert/key files |
| `maxMessageSize` | `number` | `4MB` | Message limit |

Methods: `start()`, `close()`, `onConnection(fn)`, `onDisconnection(fn)`, `onError(fn)`, `getAddress()`

### `ReverseClientTransport` (Internal Side — WebSocket)

```typescript
new ReverseClientTransport(options: ReverseClientTransportOptions)
```

| Option | Type | Default | Notes |
|--------|------|---------|-------|
| `url` | `string` | required | WebSocket URL |
| `serverName` | `string` | required | Server identifier |
| `authToken` | `string` | — | Bearer token |
| `reconnect` | `ReconnectOptions` | `{enabled:false}` | Auto-reconnect |
| `heartbeat` | `HeartbeatOptions` | `{enabled:false}` | Ping/Pong |
| `headers` | `Record<string, string>` | — | Extra headers |
| `insecureTls` | `boolean` | `false` | Skip TLS verify |

Properties: `state`, `sessionId`, `reconnectAttempts`

### Reconnect Options

```typescript
{
  enabled?: boolean;       // WebSocket: default false, SSE: default true
  initialDelay?: number;   // default: 1000ms
  maxDelay?: number;       // default: 30000ms
  multiplier?: number;     // default: 2
  jitter?: boolean;        // default: true
  maxRetries?: number;     // default: 0 (infinite)
}
```

---

## All MCP Features — Confirmed Working

| MCP Feature | WebSocket | SSE |
|-------------|:---:|:---:|
| `tools/list` | ✅ | ✅ |
| `tools/call` | ✅ | ✅ |
| `notifications/tools/list_changed` | ✅ | ✅ |
| `resources/list` | ✅ | ✅ |
| `resources/read` | ✅ | ✅ |
| `resources/subscribe` | ✅ | ✅ |
| `notifications/resources/list_changed` | ✅ | ✅ |
| `notifications/resources/updated` | ✅ | ✅ |
| `prompts/list` | ✅ | ✅ |
| `prompts/get` | ✅ | ✅ |
| `notifications/prompts/list_changed` | ✅ | ✅ |
| `roots/list` | ✅ | ✅ |
| `sampling/createMessage` | ✅ | ✅ |
| `logging` | ✅ | ✅ |
| `ping` | ✅ | ✅ |
| **Instructions** | ✅ | ✅ |

> **Key insight:** The Transport is a transparent JSON-RPC pipe. Any message that flows through `transport.send()` / `transport.onmessage` works automatically.

---

## Project Structure

```
src/
├── common/                  # Shared utilities
│   ├── types.ts             # All type definitions
│   ├── heartbeat.ts         # WebSocket Ping/Pong heartbeat
│   └── reconnect.ts         # Exponential backoff reconnection
├── websocket/               # WebSocket engine
│   ├── acceptor.ts          # WebSocketAcceptor (public side)
│   ├── reverse-client.ts    # ReverseClientTransport (internal side)
│   └── transport.ts         # SingleConnectionTransport wrapper
├── sse/                     # SSE engine
│   ├── acceptor.ts          # SSEAcceptor (public side)
│   ├── reverse-client.ts    # SSEReverseClientTransport (internal side)
│   ├── connection-transport.ts  # SSEConnectionTransport wrapper
│   └── util.ts              # SSE parsing/formatting utilities
├── client/                  # (deprecated) Re-exports from websocket/
├── server/                  # (deprecated) Re-exports from websocket/
└── index.ts                 # Main entry point — exports all engines
```

## Testing

```bash
npm test                   # All 66 tests (unit + integration)
npm run build              # TypeScript compilation
```

## Credits

- [CleverChatty](https://github.com/Gelembjuk/cleverchatty) — first `reverse-websocket` MCP implementation (Go)
- [Supergateway](https://github.com/supercorp-ai/supergateway) — MCP WS transport bridge

## License

MIT
