# Changelog

## Unreleased

### Added
- **SSE engine** (`SSEAcceptor` + `SSEReverseClientTransport`) — HTTP-based reverse transport, no extra port needed
  - `SSEAcceptor` — dual mode: Framework integration (Next.js / Express) or standalone HTTP server
  - `SSEReverseClientTransport` — background SSE stream reader + HTTP POST message sender
  - `SSEConnectionTransport` — wraps an SSE session as an MCP Transport
  - `SSEParser` — SSE event parser with partial-chunk support
  - SSE keepalive via comments with configurable read timeout
  - 37 new tests (17 SSE util + 13 connection transport + 7 E2E)
- **Subpath exports**: `mcp-reverse/sse`, `mcp-reverse/websocket`
- **Directory restructuring** — `websocket/` and `sse/` directories for clear engine isolation

### Changed
- Directory structure: `client/` → `websocket/`, `server/` → `websocket/`
- Old `client/` and `server/` paths kept as backward-compatible re-exports
- Logger prefix changed from `[mcp-reverse-ws]` to `[mcp-reverse]`
- Package description updated to reflect dual-engine support

## 1.0.0 (2026-05-02)

### Added
- `WebSocketAcceptor` — 公网 Client 端，接受内网 Server 的 WebSocket 连接
- `ReverseClientTransport` — 内网 Server 端，主动连接公网 Client
- `SingleConnectionTransport` — 单连接的 Transport 封装
- `Heartbeat` — WebSocket Ping/Pong 心跳，可配置超时
- `ReconnectionManager` — 指数退避 + 抖动自动重连
- Token 认证（`authTokens`）和自定义认证（`authHandler`）
- TLS（WSS）支持
- 完整的 TypeScript 类型定义
- 29 个测试（24 单元 + 5 集成），覆盖 Tools / Resources / Prompts / Notifications
