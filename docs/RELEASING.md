# 发布流程

本仓库的 `.github/workflows/ci.yml` 在推送 `v*` 标签时执行 Node 20/22/24 测试、类型检查及打包；通过后由 Node 24 使用 npm Trusted Publishing（OIDC）发布。不在日常修复期间自动推送发布标签。

## 发布前检查

- 仅在 `codex-cloud` 或本任务临时分支上开发；不得为了发布切换到 main/master。
- 核对待发布提交的 `package.json` 版本、源码、README 与 tarball，确保工作区干净且代码已推送。
- 执行 `npm install`、`npm run typecheck`、`npm test` 和 `npm pack`。不要把临时产物提交进仓库。
- npm 包的 Trusted Publisher 应绑定 owner `ChineseAStar`、repository `mcp-reverse`、workflow `ci.yml`（仅文件名）；本 workflow 未设置 GitHub Environment，对应字段留空。若 Actions 发布权限失败，由包维护者在 npm 设置页修正；不要把 token 发到聊天或提交进仓库。

## 1.4.0 发布顺序

1. 确认 `temp/reverse-stability-20260910` 的修复提交已通过安装包联调。
2. 维护者在本地该仓库执行（不需要切换分支）：

   ```sh
   git fetch origin temp/reverse-stability-20260910
   git show origin/temp/reverse-stability-20260910:package.json
   git tag -a v1.4.0 origin/temp/reverse-stability-20260910 -m "Release mcp-reverse 1.4.0"
   git push origin refs/tags/v1.4.0
   ```

   版本已在代码中设为 1.4.0，不要再执行 `npm version minor`，也不要强行覆盖已存在的标签。
3. 等 GitHub Actions 的 CI / publish 成功后检查：

   ```sh
   npm view mcp-reverse@1.4.0 version
   ```

4. 然后在 chat-ai 切换到真实 registry 版本 `mcp-reverse@1.4.0`，重新构建、重启测试服务验证。不能把 `.staff` 下 tarball 路径写进消费者 package.json。
5. 先部署兼容 `_meta` 与旧布尔标记的 chat-ai，再发布、推广 staff-mcp 1.2.0。
6. 任务验收后将临时分支合入 `codex-cloud`、推送并删除临时分支。发布标签保留用于版本追踪和回退。

## 回退

1.4 没有更改 HTTP 路径、认证或 MCP 消息格式；回退消费者依赖或应用产物即可，不需要数据迁移。旧连接端可继续接入新网关，但其自身的退避缺陷不会因此消失。

`connected` 在 1.4 起表示 MCP 初始化完成。直接使用 `ReconnectionManager` 的调用方还应注意：成功后的尝试次数会保留到连接稳定后断开才清零。若确实需要旧的立即重置行为，可显式设置 `stableConnectionMs: 0`。
