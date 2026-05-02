# 发布流程

两种方式：**自动（推荐）** 和 **手动**。

---

## 方式一：自动发布（打 Tag 触发 CI，免密 OIDC）

本项目使用 npm 的 **Provenance (OIDC)** 机制，GitHub Actions 会自动获取临时权限发布包，**无需配置任何 Token**。

### 前提条件（仅第一次发布需要）

为了让 npm 信任 GitHub Actions，你需要先做一次 **手动发布并绑定出处（Provenance）**：

```bash
# 1. 登录 npm（需要是能发包的账号）
npm login

# 2. 正常手动发布一次，加上 --provenance 参数
npm publish --provenance
```

这次发布成功后，npm 会记录 `ChineseAStar/mcp-reverse` 仓库具有发包权限。以后就可以完全走自动化了。

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
      → publish job: npm publish --provenance
        → ✅ mcp-reverse@1.0.1 发布成功（自带防伪签名）
```

---

## 方式二：完全手动发布

如果不经过 GitHub Actions，你可以随时在本地手动发布：

```bash
cd mcp-reverse

# 1. 登录
npm login

# 2. 发布（建议加上 --provenance）
npm publish --provenance
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
