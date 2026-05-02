# Changelog

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
