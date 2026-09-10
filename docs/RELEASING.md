# 发布流程

本仓库的 `.github/workflows/ci.yml` 在推送 `v*` 标签时执行 Node 20/22/24 测试、类型检查及打包；通过后由 Node 24 使用 npm Trusted Publishing（OIDC）发布。不在日常修复期间自动推送发布标签。

## 发布前检查

- 日常开发在 `codex-cloud` 或临时分支进行。正式发布顺序是：临时分支 → `codex-cloud` → `main` → 版本标签，不直接从未合并的临时分支发布。
- 工作区若限制主分支操作，只完成 `codex-cloud` 集成；`main` 合并与正式发布交由有权限的维护者执行。
- 核对待发布提交的 `package.json` 版本、源码、README 与 tarball，确保工作区干净且代码已推送。
- 执行 `npm install`、`npm run typecheck`、`npm test` 和 `npm pack`。不要把临时产物提交进仓库。
- npm 包的 Trusted Publisher 应绑定 owner `ChineseAStar`、repository `mcp-reverse`、workflow `ci.yml`（仅文件名）；本 workflow 未设置 GitHub Environment，对应字段留空。若 Actions 发布权限失败，由包维护者在 npm 设置页修正；不要把 token 发到聊天或提交进仓库。

## 1.4.0 发布顺序

1. 确认修复提交已通过安装包联调，将临时分支合入 `codex-cloud`、推送，并删除已完成的临时分支。
2. 维护者通过 PR 将 `codex-cloud` 合入 `main`。本仓库主分支是 `main`，不是 `master`。等待合并后提交的 CI 测试、类型检查及构建成功，再对该提交打标签。workflow 技术上也接受其他提交上的 `v*` 标签，但这不应绕过主分支集成。
3. 维护者在该仓库核对待发布主分支提交（以下命令不切换当前开发分支）：

   ```sh
   git fetch origin main codex-cloud
   git merge-base --is-ancestor origin/codex-cloud origin/main
   git show origin/main:package.json
   git log -1 --oneline origin/main
   ```

   确认 `codex-cloud` 已完整进入 `main`，且上述 `main` 提交的 CI 成功、package.json 版本为 `1.4.0` 后执行：

   ```sh
   git tag -a v1.4.0 origin/main -m "Release mcp-reverse 1.4.0"
   git push origin refs/tags/v1.4.0
   ```

   版本已在代码中设为 1.4.0，不要再执行 `npm version minor`，也不要强行覆盖已存在的标签。
4. 等标签触发的 GitHub Actions CI / publish 成功后检查：

   ```sh
   npm view mcp-reverse@1.4.0 version
   ```

5. 然后在 chat-ai 的 `codex-cloud` 分支切换到真实 registry 版本 `mcp-reverse@1.4.0`，重新构建、重启测试服务验证。不能把 `.staff` 下 tarball 路径写进消费者 package.json。
6. 将 staff-mcp 的 `codex-cloud` 合入其 `master` 分支后，可独立发布 staff-mcp 1.2.0，无需等待 chat-ai 部署。chat-ai 只从 `_meta` 读取工具结果元数据，不兼容旧的 `structuredContent.persistent` 写法；旧 chat-ai 仍能连接和调用新版 staff-mcp，但不识别新的技能跨轮回填标记。是否需要先升级接收端，取决于是否需要该回填功能。测试服务升级不代表正式接收端已部署。

发布标签保留用于版本追踪和回退。

## 回退

1.4 没有更改 HTTP 路径、认证或 MCP 消息格式；回退消费者依赖或应用产物即可，不需要数据迁移。旧连接端可继续接入新网关，但其自身的退避缺陷不会因此消失。

`connected` 在 1.4 起表示 MCP 初始化完成。直接使用 `ReconnectionManager` 的调用方还应注意：成功后的尝试次数会保留到连接稳定后断开才清零。若确实需要旧的立即重置行为，可显式设置 `stableConnectionMs: 0`。
