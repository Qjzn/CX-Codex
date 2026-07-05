# 本地回归执行记录 2026-07-05

执行目标：完成 CX-Codex 本地改动完整回归测试，覆盖当前候选分支、7420 新部署、release gate、App Server schema drift、发布治理和公开宣传边界。

## 环境快照

- 分支：`codex/candidate-release-review`
- 当前部署：本机 7420 使用 `E:\javaword\CXCodex\codexui\dist-cli\index.js`
- 配置：`C:\Users\SW\.codexui\config.json`
- 本机地址：`http://127.0.0.1:7420`
- 公网健康地址：`http://116.62.234.104:17420/health`
- 回归清单：`docs/local-regression-checklist.zh-CN.md`

## 执行状态

| 项目 | 状态 | 证据 |
| --- | --- | --- |
| P0-1 工作树状态 | 已通过 | `git status --short --branch` 返回 `## codex/candidate-release-review`，仅本轮回归文档和治理引用存在改动 |
| P0-2 空白/冲突标记 | 已通过 | `git diff --check` 通过，无输出 |
| P0-3 构建 | 已通过 | 2026-07-05 重新部署前执行 `npm.cmd run build` 通过；Vite large chunk warning 为既有非阻断项 |
| P0-4 Governance | 已通过 | `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` 通过，输出 `Governance docs check passed.` |
| P0-5 Frontend normalizer | 已通过 | `npm.cmd run verify:frontend-normalizers` 通过，输出 `frontend normalizer smoke ok` |
| P0-6 Server modules | 已通过 | `npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`；warn/error 日志来自烟测覆盖的队列/失败场景 |
| P0-7 Release package / npm package | 已通过 | `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip` 通过，包含 CLI、CJS launcher、release package、checksum、npm package smoke |
| P0-8 正式候选 release gate | 已通过 | 2026-07-05 已在 clean branch 执行 `npm.cmd run verify:release -- -RequireCleanGit -SchemaAudit warn`；schema drift warning 为 review-required |
| P0-9 进程来源 | 已通过 | PID `42800`，命令行为 `node.exe E:\javaword\CXCodex\codexui\dist-cli\index.js --config C:\Users\SW\.codexui\config.json` |
| P0-10 本机健康 | 已通过 | `http://127.0.0.1:7420/health` 返回 200 |
| P0-11 App Server 健康 | 已通过 | `http://127.0.0.1:7420/codex-api/health` 返回 200，app-server running/initialized |
| P0-12 公网映射健康 | 已通过 | `http://116.62.234.104:17420/health` 返回 200 |
| P0-13 事件回放端点 | 已通过 | `npm.cmd run test:7420 -- -SkipBrowser -PublicHealthUrl http://116.62.234.104:17420/health` 通过，本机健康、App Server 健康、event replay、公网健康均 ok |
| P0-14 短时浸泡 | 已通过 | `npm.cmd run test:7420:soak -- -DurationSeconds 60 -IntervalSeconds 15 -PublicBaseUrl http://116.62.234.104:17420` 通过；报告 `output\soak-7420\soak-20260705-105723.json` |
| P1-1 至 P1-6 协议和治理文档 | 已通过 | README、changelog、governance/release package 校验已覆盖本地回归文档；candidate review / PR pack / release / security 边界延续上一轮审查结果 |
| P1-7 至 P1-10 浏览器自动化 | 未执行 | 需要浏览器自动化；未在本阶段默认执行 |
| P2 手工功能/Android/长时浸泡 | 未执行 | 需要人工交互、Android 真机或长时间窗口 |

## 当前风险

- App Server schema 仍为 `drift-recorded`，不能宣称 fully aligned。
- Vite large chunk warning 仍存在，当前不阻塞本地部署和候选审查。
- 浏览器自动化和 Android 真机回归尚未执行，不能声明视觉/真机完全回归通过。

## 后续执行日志

后续命令执行结果追加在本节。

### 2026-07-05 10:55-10:57 Asia/Shanghai

- `git diff --check`：通过，无 trailing whitespace、冲突标记或补丁格式错误。
- `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`：通过，`Governance docs check passed.`；已要求 README、release package 和治理脚本包含本地回归清单/执行记录。
- `npm.cmd run verify:frontend-normalizers`：通过，`frontend normalizer smoke ok`。
- `npm.cmd run verify:server-modules`：通过，`server module smoke ok`；输出中的 queue/slow/error 日志属于烟测内置失败路径覆盖。
- `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip`：通过，release package smoke、checksum、npm package smoke 均 ok；schema audit 本轮跳过，沿用正式候选 gate 的 warn 结果。
- `npm.cmd run test:7420 -- -SkipBrowser -PublicHealthUrl http://116.62.234.104:17420/health`：通过，本机 `/health`、`/codex-api/health`、`/codex-api/events/replay` 和公网 `/health` 均 ok；浏览器回归按参数跳过。
- `npm.cmd run test:7420:soak -- -DurationSeconds 60 -IntervalSeconds 15 -PublicBaseUrl http://116.62.234.104:17420`：通过，4 个样本全部 local/api/public ok，`maxPending=0`、`maxQueued=0`、`timeouts=0`、`slowThreadList=0`；报告见 `output\soak-7420\soak-20260705-105723.json`。

### 尚未执行范围

- P1 浏览器自动化未执行：本轮没有调用 `agent-browser`，不能宣称桌面/手机/折叠屏视觉回归完成。
- P2 Android 真机、语音转写、2 小时浸泡和外部人工路径未执行：当前只能声明代码、包级、HTTP、event replay 和短时稳定性通过。
