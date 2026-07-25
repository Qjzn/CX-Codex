# 开源发布前检查（2026-07-25）

## 结论

当前改动可提交到公开仓库的 `main` 分支并作为 2.5.3 候选发布；2.5.1 正式 Release 已完成资产校验与首次安装，2.5.2 正式回归暴露的残留 App Server 子进程目录锁已在 2.5.3 关闭。协议基线漂移与历史 Google/Firebase key 仍需按下述边界持续处置。

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
- 从正式 2.5.1 Release 下载全部六个资产，三组 SHA-256 均通过；ZIP 包含两个 Vite HTML 入口，签名 APK 通过 APK Signature Scheme v2 校验。
- 正式 2.5.1 首次安装返回稳定成功 JSON，本机健康和公网健康、HTTP 鉴权、WebSocket 鉴权验证均通过。
- 正式 2.5.2 六个资产与三组 SHA-256 均通过，但运行中升级发现 Codex App Server 子进程继续持有目录；2.5.3 候选已停止五个成员的受管进程树并成功升级，非受管锁失败时也能自动恢复旧服务。
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
5. 2.5.3 发布后仍需从正式 Release 连续执行“保持运行升级 → 再次升级 → 官方卸载 → 干净重装”，确认 GitHub 资产与本地候选门禁一致。

## 正式 Release 前门禁

1. 处置历史 Google/Firebase key 并保留处置证据。
2. 审阅 App Server schema 漂移，更新协议兼容说明。
3. 发布与当前 `main` 同一提交对应的新版本和 SHA-256 文件。
4. 2.5.3 Release 发布后，从正式归档连续执行运行中重复升级、手机访问、卸载和干净重装；聊天发送/接收沿用已经通过的真实新人链路，并在聊天相关变更时重新执行。
5. 启用 Dependabot；条件允许时增加 CodeQL 或等价静态分析。
