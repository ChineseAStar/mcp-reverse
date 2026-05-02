## 本地开发

```bash
git clone git@github.com:ChineseAStar/mcp-reverse.git
cd mcp-reverse
npm install
```

### 常用命令

| 命令 | 作用 |
|------|------|
| `npm test` | 跑全部测试 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run build` | 编译到 dist/ |
| `node --test --import tsx tests/unit/xxx.test.ts` | 跑单个测试文件 |

### 项目结构

```
src/
├── websocket/                # WebSocket 引擎
│   ├── acceptor.ts           # WebSocketAcceptor（公网 Client 侧）
│   ├── reverse-client.ts     # ReverseClientTransport（内网 Server 侧）
│   └── transport.ts          # SingleConnectionTransport
├── sse/                      # SSE 引擎
│   ├── acceptor.ts           # SSEAcceptor（公网 Client 侧）
│   ├── reverse-client.ts     # SSEReverseClientTransport（内网 Server 侧）
│   ├── connection-transport.ts  # SSEConnectionTransport
│   └── util.ts               # SSE 解析/格式化工具
├── common/                   # 共享模块
│   ├── types.ts              # 所有类型定义
│   ├── heartbeat.ts          # WebSocket Ping/Pong 心跳
│   └── reconnect.ts          # 指数退避重连（双引擎复用）
├── client/                   # （向后兼容）→ websocket/
├── server/                   # （向后兼容）→ websocket/
└── index.ts                  # 统一入口，导出全部引擎

tests/
├── unit/                     # 单元测试（41 个）
│   ├── sse-util.test.ts
│   └── sse-connection-transport.test.ts
└── integration/              # E2E 集成测试（8 个）
    ├── e2e.test.ts           # WebSocket E2E
    └── sse-full-features.test.ts  # SSE E2E
```

### 加新功能

```bash
git checkout -b feat/xxx
# 写代码...
npm test                # 确保现有测试通过
npm run typecheck       # 确保类型正确
# 写新测试...
git add . && git commit -m "feat: xxx"
git push -u origin feat/xxx
# 创建 Pull Request → CI 自动跑 → 合并
```

## CI

推送到 `main` 或开 PR 会自动跑 `.github/workflows/ci.yml`：

- Node 20 / 22 / 24 三个版本上执行 `typecheck` + `npm test`
- 全部通过才算成功

## 发布到 npm

详见 [RELEASING.md](./releasing.md)。
