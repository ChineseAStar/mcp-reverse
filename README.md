# mcp-reverse

> Reverse transports for MCP — SSE engine.  
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

## Features

| Feature | Support |
|---------|:---:|
| NAT traversal | ✅ |
| Authentication (token + custom handler) | ✅ |
| Keepalive / heartbeat | ✅ SSE comments |
| Auto-reconnect (exponential backoff + jitter) | ✅ |
| TLS / HTTPS | ✅ |
| Tools / Resources / Prompts | ✅ |
| Notifications (both directions) | ✅ |
| Next.js / Vercel / serverless | ✅ |

## Install

```bash
npm install mcp-reverse
```

Requires `@modelcontextprotocol/sdk` as peer dependency.

---

## Quick Start — SSE

### Public Side (chat-ai / Next.js App Router)

```typescript
import { SSEAcceptor } from 'mcp-reverse';
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
  const result = await client.callTool({ name: 'exec', arguments: { cmd: 'ls' } });
});

acceptor.onDisconnection((serverName) => console.log(`Disconnected: ${serverName}`));

// ─── Next.js App Router integration ───
export async function GET(req: NextRequest) {
  return acceptor.handleSSE(req);
}
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
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const transport = new SSEReverseClientTransport({
  url: 'https://public-chatai.example.com:3000/mcp-reverse',
  serverName: 'office-server',
  authToken: 'secret123',
  reconnect: { enabled: true },
});

const server = new McpServer({ name: 'office-server', version: '1.0.0' });
server.tool('greet', 'Greet someone', { name: z.string() },
  async ({ name }) => ({ content: [{ type: 'text', text: `Hello, ${name}!` }] })
);

await server.connect(transport);
```

### High-Level Client (recommended)

```typescript
import { ReverseMCPClient } from 'mcp-reverse/connector';

const client = await ReverseMCPClient.createSSE(server, {
  url: 'https://public-host.example.com:3000/mcp-reverse',
  serverName: 'office-server',
  authToken: 'secret123',
  reconnect: { enabled: true, maxDelay: 30000 },
});

client.on('connected', () => console.log('Connected'));
client.on('disconnected', () => console.log('Disconnected'));
client.on('reconnecting', (attempt) => console.log(`Reconnecting (${attempt})`));
```

---

## API Reference

### `SSEAcceptor` (Public Side)

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
| `pathPrefix` | `string` | `/mcp-reverse` | URL prefix |
| `port` | `number` | — | Standalone only: listen port |

### `SSEReverseClientTransport` (Internal Side)

```typescript
new SSEReverseClientTransport(options: SSEReverseClientTransportOptions)
```

| Option | Type | Default | Notes |
|--------|------|---------|-------|
| `url` | `string` | required | Base URL |
| `serverName` | `string` | required | Server identifier |
| `authToken` | `string` | — | Bearer token |
| `reconnect` | `ReconnectOptions` | `{enabled:true}` | Auto-reconnect |
| `heartbeat` | `SSEHeartbeatOptions` | `{enabled:true}` | Keepalive |
| `headers` | `Record<string, string>` | — | Extra headers |
| `insecureTls` | `boolean` | `false` | Skip TLS verify |
| `queryParams` | `Record<string, string>` | — | Extra query params |

### Reconnect Options

```typescript
{
  enabled?: boolean;       // default: true
  initialDelay?: number;   // default: 1000ms
  maxDelay?: number;       // default: 30000ms
  multiplier?: number;     // default: 2
  jitter?: boolean;        // default: true
  maxRetries?: number;     // default: 0 (infinite)
}
```

---

## Project Structure

```
src/
├── protocol/                # Protocol-level abstractions
│   ├── types.ts             # All type definitions
│   └── reconnect.ts         # Exponential backoff reconnection
├── acceptor/
│   └── sse-acceptor.ts      # SSEAcceptor (public side)
├── connector/
│   ├── mcp-connector.ts     # ReverseMCPClient (high-level)
│   └── sse-connector.ts     # SSEReverseClientTransport (internal side)
├── transport/
│   ├── sse-transport.ts     # SSEConnectionTransport
│   └── sse-util.ts          # SSE parsing/formatting utilities
├── proxy/
│   └── reverse-proxy.ts     # ReverseProxy / gateway
└── index.ts                 # Main entry point
```

### Sub-path exports

| Export path | Description |
|-------------|-------------|
| `mcp-reverse` | Main entry — all types |
| `mcp-reverse/connector` | High-level `ReverseMCPClient` |
| `mcp-reverse/acceptor` | `SSEAcceptor` |
| `mcp-reverse/sse` | Backward compat — all SSE types |
| `mcp-reverse/transport` | `SSEConnectionTransport`, SSE utilities |
| `mcp-reverse/proxy` | `ReverseProxy` |

---

## Testing

```bash
npm test                   # All 43 tests (unit + integration)
npm run build              # TypeScript compilation
```

## License

MIT
