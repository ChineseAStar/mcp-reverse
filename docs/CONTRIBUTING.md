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
├── client/                   ← 公网 MCP Client 端
│   ├── websocket-acceptor.ts     接受 Server 连接
│   └── single-connection-transport.ts  单连接 Transport
├── server/                   ← 内网 MCP Server 端
│   └── reverse-client-transport.ts   连接 Client 的 Transport
└── common/
    ├── types.ts              类型定义
    ├── heartbeat.ts          Ping/Pong 心跳
    └── reconnect.ts          指数退避重连

tests/
├── unit/                     单元测试（24 个）
└── integration/              E2E 集成测试（5 个）
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
