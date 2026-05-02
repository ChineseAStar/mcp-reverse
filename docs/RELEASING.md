# 发布流程

本包推荐使用 **GitHub Actions 自动发布（免密 OIDC）**，不需要管理 npm token。

---

## 首次发布配置

为了让 npm 知道 `ChineseAStar/mcp-reverse` 有权限发布这个包，首次发布请按照以下步骤操作：

1. 临时移除 `package.json` 中的 provenance 配置（因为本地不支持）：
   ```json
   // 暂时删掉这两行
   "publishConfig": {
     "provenance": true
   }
   ```
2. 在本地发一个初始版本（不带 `--provenance`，只是为了创建这个包）：
   ```bash
   npm login
   npm publish
   ```
3. 去 [npm 包设置页](https://www.npmjs.com/package/mcp-reverse/access)（Settings -> Publishing access），将你的 GitHub 仓库绑定为 Trusted Publisher。
   - GitHub owner: `ChineseAStar`
   - Repository: `mcp-reverse`
4. 把 `package.json` 中的 provenance 配置加回来，提交并推送到 GitHub。

---

## 自动发布（日常流程）

之后每次发版，只需要在本地打 tag 并推送到 GitHub 即可，GitHub Actions 会自动处理测试、构建和带有防伪证明（Provenance）的发布。

```bash
# 1. 确保在 main 分支且最新
git checkout main && git pull

# 2. 更新版本号（三选一，自动修改 package.json）
npm version patch    # 1.0.0 → 1.0.1  (修 bug)
npm version minor    # 1.0.0 → 1.1.0  (加功能)
npm version major    # 1.0.0 → 2.0.0  (破坏性变更)

# 3. 把改动和 tag 一起推送到 GitHub
git push --follow-tags
```

推送后，可以在 `https://github.com/ChineseAStar/mcp-reverse/actions` 查看进度。
成功后，`npm publish --provenance` 会自动由 GitHub Actions 带着身份凭证执行。

---

## 纯手动发布（备选）

如果你不想走 GitHub Actions，也可以随时在本地手动发布。
*注意：本地环境不支持生成 provenance，手动发布时，请确保移除了 `package.json` 中的 `provenance: true` 配置，并且不要加 `--provenance` 参数。*

```bash
npm login
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
