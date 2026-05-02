# 发布流程

两种方式：**自动（推荐）** 和 **手动**。

---

## 方式一：自动发布（打 Tag 触发 CI）

推送格式为 `v*` 的 tag，GitHub Actions 自动 `npm publish`。

### 首次配置（一次性）

**① 获取 npm token**

1. 登录 [npmjs.com](https://www.npmjs.com) → 头像 → Access Tokens
2. Generate New Token → Classic → 选 `Automation`
3. 复制 token（只显示一次）

**② 添加到 GitHub Secrets**

1. 打开 `https://github.com/ChineseAStar/mcp-reverse/settings/secrets/actions`
2. New repository secret
   - Name: `NPM_TOKEN`
   - Value: 上面复制的 token

### 每次发版

```bash
# 1. 确保在 main 分支且最新
git checkout main && git pull

# 2. 更新版本号（三选一）
npm version patch    # 1.0.0 → 1.0.1  修 bug
npm version minor    # 1.0.0 → 1.1.0  新功能
npm version major    # 1.0.0 → 2.0.0  破坏性变更

# 3. 推送代码 + tag
git push --follow-tags
```

推送后去看 `https://github.com/ChineseAStar/mcp-reverse/actions`，CI 会自动：

```
打 v1.0.1 tag
  → test (Node 20/22/24) 三个并行跑
    → 全部通过
      → publish job: npm publish
        → ✅ mcp-reverse@1.0.1 发布成功
```

---

## 方式二：手动发布

```bash
cd mcp-reverse

# 1. 登录
npm login

# 2. 预检（看看会发什么，不会真正发布）
npm publish --dry-run

# 3. 发布
npm publish
```

---

## 版本号规则（SemVer）

```
1.2.3
│ │ │
│ │ └─ patch：修 bug，不影响 API
│ └─── minor：新功能，向后兼容
└───── major：破坏性变更，不兼容旧版
```

| 改动类型 | 命令 | 示例 |
|----------|------|------|
| 修一个 bug | `npm version patch` | 1.0.0 → 1.0.1 |
| 加一个 Transport 选项 | `npm version minor` | 1.0.1 → 1.1.0 |
| 改 `start()` 签名 | `npm version major` | 1.1.0 → 2.0.0 |

---

## 发布后

1. 去 [npm 页面](https://www.npmjs.com/package/mcp-reverse) 确认新版本已上线
2. 去 [GitHub Releases](https://github.com/ChineseAStar/mcp-reverse/releases) 写一下 Release Notes
3. 在 chat-ai 项目中 `npm update mcp-reverse`
