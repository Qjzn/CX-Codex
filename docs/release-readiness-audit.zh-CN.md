# 阶段性 Release Readiness 审计

审计时间：2026-07-05 09:30 Asia/Shanghai。

本文件用于收口当前长目标阶段，判断 CX-Codex 是否适合继续无界自动推进、是否具备发版条件，以及下一步最应该做什么。它不是正式 Release Notes，也不代表已经完全对齐最新 Codex App Server。

## 当前仓库状态

- 工作树：本轮审计开始时 `git status --short --branch` 返回 `## main...origin/main [ahead 208]`，无未提交文件。
- 当前目标状态：paused；累计运行约 19 小时 20 分钟。
- 最近主线：OpenAI 官方文档复核、Codex App Server schema drift 治理、语音转写官方 API 化、安全边界、bridge 模块化、release/governance smoke。
- `src/server/codexAppServerBridge.ts` 已降到 194 行，主职责变成 bridge middleware 组装。
- App Server 进程、请求、通知、runtime、route、shared state、cleanup、JSON-RPC line/write 等职责已拆入独立 server 模块，并纳入 `scripts/server-module-smoke.ts`。

## 当前可发布性判断

结论：适合作为内部 checkpoint 或准备候选分支；不建议直接宣布为“完全对齐最新 Codex App Server”的公开稳定版。

已经具备的发版基础：

- 本地构建通过：`npm.cmd run build`。
- 本地 release gate 通过：`npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip`。
- Release package smoke 覆盖 README、治理文档、测试手册、关键 server 模块、GitHub 模板和 workflow。
- NPM package smoke 覆盖 dry-run 包内容，避免 npm 包携带源码、治理脚本或手工测试手册。
- OpenAI 官方文档审查手册已明确 App Server、Speech to text、Responses API 和安全边界。
- `SECURITY.md`、`SUPPORT.md`、`CONTRIBUTING.md`、Issue 模板、PR 模板、Dependabot、release workflow 均已纳入治理门禁。

不应直接发布为最终稳定版的原因：

- 当前 `main` 本地 ahead 208，变更面很大，正式公开发布前需要人工审查或至少整理为候选分支。
- App Server schema drift 仍是 `drift-recorded`，不能声明完全对齐最新官方协议。
- 本地 release gate 使用 `-SchemaAudit skip` 只是快速预检；正式发版前应运行 `-SchemaAudit warn` 或 `strict` 并记录结果。
- Vite 仍有既有 large chunk warning，当前不是阻塞项，但需要作为后续前端性能任务处理。
- OpenAI Docs MCP 已注册，但当前 Codex 线程重启前不会热加载 MCP 工具；后续官方文档复核应在新线程或重启后优先使用 MCP。

## Schema Drift 分组

本轮重新运行：

```powershell
npm.cmd run audit:app-server-schemas
```

结果：命令返回 1，并生成 `output/app-server-schema-audit/20260705-093004`。这是预期的 drift 信号，输出包含 `Schema differences found. Exit code 1 means review is required, not that generation failed.`。

本轮 raw summary 与已提交的 `docs/app-server-schema-audit-summary.json` 结论一致：

| 分组 | baseline | generated | added | removed | 当前判断 |
| --- | ---: | ---: | ---: | ---: | --- |
| TypeScript root | 236 | 77 | 15 | 174 | 旧 v1/root 类型大量退出；不应直接覆盖基线 |
| TypeScript v2 | 199 | 445 | 260 | 14 | v2 能力大量扩展，是后续兼容主战场 |
| JSON root | 37 | 35 | 5 | 7 | 新增 v2 schema bundle 和权限/MCP 请求根类型 |
| JSON v2 | 102 | 202 | 110 | 10 | 新增 thread、permission、MCP、plugin、fs、process、realtime、Windows sandbox 等能力 |

按发布风险分组：

- P0 稳定性保护：unknown notification、unknown thread item、unknown status、thread/read 缓存失效、runtime stop/reconcile、permission 默认保守。当前已有较多覆盖，应继续保持。
- P1 协议能力补齐：ThreadInjectItems、ThreadShellCommand、ThreadMetadataUpdate、ThreadUnsubscribe、TurnSteer、goal/status、hook、MCP、plugin、model notification 等。当前多为部分覆盖或只读诊断。
- P2 安全敏感能力：fs read/write/remove/watch、process/terminal interactive stream、permission profile、guardian review、WebSocket auth、sandbox setup。默认不能开放写入或自动执行。
- P3 实验能力：App Server realtime audio/transcript/sdp。当前仅做脱敏只读诊断，不作为稳定入口宣传。

## 下一步优先级

最应该做的下一步不是继续无界拆模块，而是收口为短目标：

1. 创建候选分支或准备 PR/发布审查包，先处理 ahead 208 的审查压力。
2. 运行正式发版预检：`npm.cmd run verify:release -- -RequireCleanGit -SchemaAudit warn`。如果 drift 计数变化，先更新 `docs/app-server-schema-audit-summary.json` 和 `docs/app-server-protocol-matrix.zh-CN.md`。
3. 做 schema drift 分组 issue 或任务清单，把 P0/P1/P2/P3 固化为可跟踪事项。
4. 对 README、Release 正文和截图做一次人工审查，确保没有宣称“完全对齐最新 App Server”。
5. 之后再进入下一轮功能开发，优先做 P0/P1 的协议兼容缺口，而不是继续一般性重构。

## 是否继续长目标

不建议继续让当前长目标连续自动运行。当前更合理的状态是保持 paused，并用短目标推进：

```text
完成 CX-Codex release readiness 收口：候选分支/PR 准备、schema drift 分组任务化、正式 release gate warn 验证、README/Release/安全声明人工审查。
```

只有当上述短目标完成后，才适合继续下一阶段实现任务，例如补齐 ThreadShellCommand/ThreadInjectItems 的权限交互，或处理 Vite chunk 拆分。
