# Candidate Release Review

审查时间：2026-07-05 10:23 Asia/Shanghai。

本文是 CX-Codex 候选发布审查记录，用于回答四个问题：

1. 正式 release gate 是否能跑通。
2. App Server schema drift 应如何拆成 P0 / P1 / P2 后续任务。
3. README、Release 正文和安全声明是否存在过度宣传。
4. 哪些能力可以公开宣传，哪些必须标注为实验、只读诊断或未完成。

PR / review pack 草稿见 `docs/candidate-pr-review-pack.zh-CN.md`。

## 正式 Release Gate

本轮运行：

```powershell
npm.cmd run verify:release -- -RequireCleanGit -SchemaAudit warn
```

结果：通过。

通过项：

- clean Git status、whitespace check、`package.json` parse。
- governance docs check。
- `npm run build`，包含 `vue-tsc --noEmit`、Vite build 和 CLI `tsup` build。
- frontend normalizer smoke。
- server module smoke。
- CLI help smoke 和 CLI CJS launcher smoke。
- Release package smoke、checksum smoke。
- NPM package smoke。
- App Server schema audit `warn`。

非阻断项：

- Vite 仍报告既有 large chunk warning，后续作为前端拆包和性能任务处理。
- App Server schema audit 发现 drift；`warn` 模式允许 release gate 继续完成，但发布前必须人工审查。

本轮 schema audit 输出：

- `output/app-server-schema-audit/20260705-102346`
- `output/app-server-schema-audit/20260705-102346/audit-summary.json`

## 官方文档复核

本轮已通过 OpenAI Docs MCP 抓取官方页面。

Codex App Server protocol 官方页确认：

- App Server 使用省略 `"jsonrpc":"2.0"` 字段的 JSON-RPC 2.0 消息。
- 默认 transport 是 `stdio` JSONL。
- WebSocket transport 仍是 experimental and unsupported。
- 非 loopback WebSocket listener 远程暴露前必须配置 WebSocket auth。
- WebSocket 过载可能返回 JSON-RPC error code `-32001`，客户端应退避重试。

Speech to text 官方页确认：

- `gpt-4o-transcribe-diarize` 要求 `response_format=diarized_json`。
- 长音频 diarize 需要 `chunking_strategy`，可用 `auto`。
- `gpt-4o-transcribe-diarize` 当前只适用于 `/v1/audio/transcriptions`，不适用于 Realtime API。

因此，本项目可以公开宣传“可选 OpenAI 官方语音转写 API”，但不能把 App Server WebSocket、Realtime 或完整 v2 schema 能力宣传为稳定完成。

## Schema Drift 摘要

本轮 `warn` 审计与已提交摘要的计数一致：

| 分组 | baseline | generated | added | removed | 发布判断 |
| --- | ---: | ---: | ---: | ---: | --- |
| TypeScript root | 236 | 77 | 15 | 174 | v1/root 旧类型大量退出，不能直接覆盖基线 |
| TypeScript v2 | 199 | 445 | 260 | 14 | v2 扩展很大，是后续兼容主战场 |
| JSON root | 37 | 35 | 5 | 7 | 新增 v2 schema bundle 和权限/MCP 请求根类型 |
| JSON v2 | 102 | 202 | 110 | 10 | 新增 thread、permission、MCP、plugin、fs、process、realtime、Windows sandbox 等能力 |

结论：当前状态是 `drift-recorded`，不是 `fully-aligned`。

## P0 / P1 / P2 任务清单

### P0：候选发布前必须保持的稳定性保护

- Unknown notification、unknown thread item、unknown status 不能导致白屏、崩溃、任务卡死或线程内容消失。
- `thread/read`、`thread/list`、`turn/start`、`turn/interrupt`、`thread/resume`、`thread/fork`、`thread/rollback` 等既有核心路径不能回退。
- `thread/read` 缓存、thread list/search 缓存和 runtime snapshot 必须在新增写入类 RPC 或关键通知后正确失效。
- Permission、approval、guardian、network、fs 相关新增字段默认保守处理，不得无提示放权。
- App Server transport 默认继续走本地 stdio JSONL，不把未鉴权 WebSocket 作为公开远程方案。
- Release gate 必须继续覆盖 governance、build、frontend normalizer smoke、server module smoke、release package smoke 和 npm package smoke。

### P1：下一轮应补齐的协议能力

- `ThreadInjectItems*`：补 UI 降级、权限确认、失败回滚和 tests.md 手工验证。
- `ThreadShellCommand*`：补命令来源、审批边界、输出展示和禁止默认交互式执行的安全说明。
- `ThreadMetadataUpdate*`、`ThreadUnsubscribe*`、`TurnSteer*`、goal/status：补产品语义和状态机映射。
- MCP elicitation、resource read、server tool call/status：先做只读/受控展示，再决定是否开放操作入口。
- Plugin/app/marketplace install/read/share/uninstall：先展示状态，不默认开放安装、卸载或分享。
- Hook list、hook started/completed、model reroute/verification、Windows sandbox readiness：继续只读诊断，补更细的 UI 文案和异常分级。
- 官方 schema audit summary 变化时，同步更新 `docs/app-server-schema-audit-summary.json`、协议矩阵和 release review。

### P2：安全敏感能力，不能作为默认稳定入口

- fs read/write/copy/remove/watch/unwatch/metadata/directory：接入前必须绑定 workspace 边界、权限确认、路径脱敏和回滚说明。
- process output、terminal stream、resize/write/terminate：接入前必须设计交互式终端 UI、命令审批和远程访问边界。
- permission profile 主动管理、guardian approval review、network/file-system permission 写入：必须先做只读诊断和明确确认流。
- App Server WebSocket transport：只适合 localhost、SSH port forwarding 或受控网络；远程暴露必须配置官方 WebSocket auth。
- Windows sandbox setup/start：不得后台自动执行，必须显式用户确认。

## 可公开宣传的能力

可以公开宣传：

- Self-hosted OpenAI Codex Web UI and Android client bridge。
- Windows / Windows Server、Android、LAN、VPN、Tailscale、frp、Nginx、Caddy、Cloudflare Tunnel 等自托管访问形态。
- 默认复用本机 Codex，CX-Codex 负责浏览器、手机和远程入口。
- 本地 stdio JSONL App Server bridge、线程列表/读取/发送/恢复/停止等核心使用路径。
- 移动端恢复补同步、长会话状态刷新、停止状态保护和诊断中心。
- 可选 OpenAI 官方 Speech to text 转写 API，包含 diarize 参数规范化和脱敏诊断。
- Release/governance 门禁、schema drift 记录、安全硬化清单、Issue/PR 模板和发布包 smoke。

必须保守宣传：

- MCP、plugin、skills、hooks：当前适合描述为状态读取、只读诊断、缓存刷新和部分审批/工具链支持，不应宣称 marketplace 全生命周期已稳定完成。
- 权限控制：可以宣传有审批和安全边界诊断，但不能宣称完整覆盖最新 permission profile / guardian review。
- App Server 协议兼容：可以宣传“有官方 schema audit 和兼容矩阵”，不能宣传“完全对齐最新 App Server”。

必须标注实验、只读诊断或未完成：

- App Server WebSocket 远程 transport。
- App Server realtime audio/transcript/sdp。
- `ThreadInjectItems*`、`ThreadShellCommand*` 的完整产品入口。
- fs 写入/删除/watch UI。
- process/terminal interactive stream。
- plugin marketplace 安装、卸载、分享。
- permission profile 主动管理和 guardian review 操作流。
- Windows sandbox setup/start。

## README / Release / Security 审查结论

README：

- 可以保留 self-hosted、Windows、Android、remote access、browser bridge 等定位。
- 功能清单中的 MCP / 工具权限表述必须保持为状态、审批和诊断边界，避免暗示完整 marketplace 或 permission profile 支持。
- 项目边界必须继续说明不是官方 Codex 替代品，也不能声明完全对齐最新 App Server。

RELEASE：

- `verify:release -- -RequireCleanGit -SchemaAudit warn` 可以作为候选发布本地证据。
- GitHub Actions 使用 `-SchemaAudit skip` 只能是 runner 约束下的自动化检查，不能替代维护者本机 warn/strict 审计。
- Release 正文必须链接候选发布审查和 schema drift 文档。

SECURITY：

- WebSocket transport 必须继续标注为 experimental/unsupported 官方能力，远程使用需要官方 WebSocket auth 或受控网络边界。
- App Server transport、OpenAI API key、远程访问密码、日志和截图仍是 release 前安全复核重点。

## 候选发布结论

当前状态可以进入 candidate release review / PR 审查包。

不能直接宣布为最终公开稳定版的原因：

- 本地 `main` 相对 `origin/main` 仍有大量 ahead 提交，需要候选分支或 PR 审查。
- App Server schema drift 仍存在，状态是 `drift-recorded`。
- P1/P2 协议能力仍有多个只读、实验或未完成入口。

下一步建议：

1. 创建候选分支或 PR 审查包；当前候选分支为 `codex/candidate-release-review`，review pack 见 `docs/candidate-pr-review-pack.zh-CN.md`。
2. 将本文 P0/P1/P2 转成 issue 或 checklist。
3. 若 schema audit 计数变化，先更新摘要和矩阵，再考虑发布。
4. 发布正文避免使用“完全对齐最新 App Server”“完整插件市场”“稳定 Realtime”等表述。
