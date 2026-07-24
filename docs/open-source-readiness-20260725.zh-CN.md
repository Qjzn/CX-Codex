# 开源发布前检查（2026-07-25）

## 结论

当前改动可提交到公开仓库的 `main` 分支；正式 Release 仍应先完成协议基线复核、历史 Google/Firebase key 处置和 Release/README 同步。

## 已通过

- `npm run verify:governance`
- `npm run build:frontend`
- `npm run build:cli`
- `npm run verify:server-modules`
- `npm run verify:frontend-normalizers`
- `npm run verify:quick-tunnel`
- `npm run verify:release -- -SchemaAudit warn`
- 使用隔离的 Node.js `24.18.0` / npm `11.16.0` 和 npm 官方源执行生产依赖审计：455 个依赖，严重、高、中、低风险均为 0。
- PowerShell 脚本语法检查与 `git diff --check`。
- 真实 Cloudflare Quick Tunnel 验证：公网健康、未登录 HTTP API 401、未登录 WebSocket 鉴权均通过，停止后子进程退出。
- 从无 CX-Codex 运行目录的状态按 README 完成安装、启动、公网登录、浏览器发送消息和接收回复；完整记录见 [Windows 新人安装实测与改进建议](./new-user-install-review-20260725.zh-CN.md)。
- 当前工作树未发现 AWS、Google、GitHub、OpenAI 私钥或常见访问令牌格式。
- 文档中的历史真实公网地址、个人用户目录和本机工作区路径已替换为 RFC 5737 示例地址或通用示例路径。
- README 截图已人工查看；工作区、会话、地址和消息均为虚构内容。图片元数据未发现用户名、路径、GPS 或设备标识。

## 已发现并修复

1. Windows 可能存在“Node.js 22 足够新、npm 仍是 6.x”的错配。bootstrap 现在要求 npm `9+`，不满足时自动使用项目目录内的便携式 Node.js/npm。
2. 便携式 Node.js 下载此前只依赖 HTTPS。现在同时下载 Node.js 官方 `SHASUMS256.txt` 并验证归档 SHA-256。
3. 本地 DNS 代理的临时路径由系统加密随机数生成。
4. 公网配对页、HTTP API 和 WebSocket 的本机绕过边界已分别验证；代理请求不能借助回环连接绕过密码。

## 尚未关闭的发布风险

1. GitHub Secret Scanning 仍有一条旧提交中的 Google/Firebase 客户端 key 告警。当前源码已删除该值，但仓库历史仍可见；维护者应在对应 Google Cloud 项目确认该 key 已废止或严格限制，再在 GitHub 中按真实状态关闭告警。
2. 本机 Codex CLI 的 App Server schema 已明显领先仓库基线。`warn` 模式允许本次源码提交，但正式 Release 前应审阅生成的 TypeScript/JSON schema 差异并更新兼容矩阵。
3. GitHub Dependabot 当前未启用，Code Scanning 也没有分析结果。npm 官方审计本次为 0，但仓库仍缺少持续依赖和静态安全告警。
4. 前端构建仍有超过 500 kB 的 chunk 警告；它不阻断本次功能，但会影响首次打开速度。
5. 最新正式 Release 仍是 `2.4.1`，不包含 `-RemoteQuick`。README 暂时显式使用 `-UseBranchArchive` 安装 `main` 预览版，因此没有 Release 归档的 SHA-256 保证。发布包含本功能的新 Release 后，应立即移除该参数。

## 正式 Release 前门禁

1. 处置历史 Google/Firebase key 并保留处置证据。
2. 审阅 App Server schema 漂移，更新协议兼容说明。
3. 发布与当前 `main` 同一提交对应的新版本和 SHA-256 文件。
4. 新 Release 发布后，从 Release 归档再重复一次安装、登录、发送消息、接收回复、手机访问和卸载复测；当前已经完成 `main` 源码预览版实测。
5. 启用 Dependabot；条件允许时增加 CodeQL 或等价静态分析。
