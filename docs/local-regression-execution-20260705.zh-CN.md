# 本地回归执行记录 2026-07-05

执行目标：完成 CX-Codex 本地改动完整回归测试，覆盖当前候选分支、7420 新部署、release gate、App Server schema drift、发布治理和公开宣传边界。

## 环境快照

- 分支：`codex/candidate-release-review`
- 当前部署：本机 7420 使用 `C:\src\CX-Codex\dist-cli\index.js`
- 配置：`C:\Users\example\.codexui\config.json`
- 本机地址：`http://127.0.0.1:7420`
- 公网健康地址：`http://203.0.113.10:17420/health`
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
| P0-9 进程来源 | 已通过 | PID `42800`，命令行为 `node.exe C:\src\CX-Codex\dist-cli\index.js --config C:\Users\example\.codexui\config.json` |
| P0-10 本机健康 | 已通过 | `http://127.0.0.1:7420/health` 返回 200 |
| P0-11 App Server 健康 | 已通过 | `http://127.0.0.1:7420/codex-api/health` 返回 200，app-server running/initialized |
| P0-12 公网映射健康 | 已通过 | `http://203.0.113.10:17420/health` 返回 200 |
| P0-13 事件回放端点 | 已通过 | `npm.cmd run test:7420 -- -SkipBrowser -PublicHealthUrl http://203.0.113.10:17420/health` 通过，本机健康、App Server 健康、event replay、公网健康均 ok |
| P0-14 短时浸泡 | 已通过 | `npm.cmd run test:7420:soak -- -DurationSeconds 60 -IntervalSeconds 15 -PublicBaseUrl http://203.0.113.10:17420` 通过；报告 `output\soak-7420\soak-20260705-105723.json` |
| P1-1 至 P1-6 协议和治理文档 | 已通过 | README、changelog、governance/release package 校验已覆盖本地回归文档；candidate review / PR pack / release / security 边界延续上一轮审查结果 |
| P1-7 至 P1-10 浏览器自动化 | 已通过 | `npm.cmd run test:7420 -- -PublicHealthUrl http://203.0.113.10:17420/health -ScreenshotDir output\regression-7420\p1-browser-20260705 -AgentBrowserTimeoutSec 25` 和 `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420` 通过；thread 页未传 `-ThreadId`，按脚本可选项跳过 |
| P2 手工功能/Android/长时浸泡 | 未执行 | 需要人工交互、Android 真机或长时间窗口 |

## 当前风险

- App Server schema 仍为 `drift-recorded`，不能宣称 fully aligned。
- Vite large chunk warning 仍存在，当前不阻塞本地部署和候选审查。
- Android 真机回归、语音转写实测和 2 小时长浸泡尚未执行，不能声明真机/语音/长时完全回归通过。

## 后续执行日志

后续命令执行结果追加在本节。

### 2026-07-05 10:55-10:57 Asia/Shanghai

- `git diff --check`：通过，无 trailing whitespace、冲突标记或补丁格式错误。
- `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`：通过，`Governance docs check passed.`；已要求 README、release package 和治理脚本包含本地回归清单/执行记录。
- `npm.cmd run verify:frontend-normalizers`：通过，`frontend normalizer smoke ok`。
- `npm.cmd run verify:server-modules`：通过，`server module smoke ok`；输出中的 queue/slow/error 日志属于烟测内置失败路径覆盖。
- `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip`：通过，release package smoke、checksum、npm package smoke 均 ok；schema audit 本轮跳过，沿用正式候选 gate 的 warn 结果。
- `npm.cmd run test:7420 -- -SkipBrowser -PublicHealthUrl http://203.0.113.10:17420/health`：通过，本机 `/health`、`/codex-api/health`、`/codex-api/events/replay` 和公网 `/health` 均 ok；浏览器回归按参数跳过。
- `npm.cmd run test:7420:soak -- -DurationSeconds 60 -IntervalSeconds 15 -PublicBaseUrl http://203.0.113.10:17420`：通过，4 个样本全部 local/api/public ok，`maxPending=0`、`maxQueued=0`、`timeouts=0`、`slowThreadList=0`；报告见 `output\soak-7420\soak-20260705-105723.json`。

### 尚未执行范围

- P2 Android 真机、语音转写、2 小时浸泡和外部人工路径未执行：当前只能声明代码、包级、HTTP、event replay 和短时稳定性通过。

### 2026-07-05 11:00-11:09 Asia/Shanghai

- 目标：补齐 P1 浏览器自动化回归。
- 环境确认：`git status --short --branch` 返回 `## codex/candidate-release-review`；7420 进程 PID `42800`，命令行指向 `C:\src\CX-Codex\dist-cli\index.js --config C:\Users\example\.codexui\config.json`；本机 `/health` 和 `/codex-api/health` 均返回 200。
- `agent-browser doctor --offline --quick`：通过，CLI version `0.26.0`，0 fail。
- 初次执行 `npm.cmd run test:7420 -- -PublicHealthUrl http://203.0.113.10:17420/health -ScreenshotDir output\regression-7420\p1-browser-20260705`：HTTP / event replay / public health 已通过，但旧脚本的 `agent-browser` 调用没有超时保护，浏览器阶段长时间无输出后被终止。
- 脚本修复：`scripts/regression-7420.ps1` 新增 `-AgentBrowserTimeoutSec`，`agent-browser` 子进程超时后会失败并清理；视口检查前重置 `codex-web-local.sidebar-collapsed.v1`，避免折叠屏因为历史折叠状态误报缺少侧栏。
- `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420`：通过，覆盖首页桌面、skills 手机、GitHub trending 手机、diagnostics 手机、本地 README preview 手机；thread 页未传 `-ThreadId`，脚本按可选项跳过。
- `npm.cmd run test:7420 -- -PublicHealthUrl http://203.0.113.10:17420/health -ScreenshotDir output\regression-7420\p1-browser-20260705 -AgentBrowserTimeoutSec 25`：通过，包含 notification cursor recovery、desktop 1440x900、phone 390x844、fold 884x1104；三视口 composer 可见、无横向溢出、pageErrors=0；fold 侧栏可见。
- 截图证据：`output\regression-7420\p1-browser-20260705\desktop.png`、`phone.png`、`fold.png`。
- 自动化副作用：执行 `agent-browser --session ... close --all` 时该 CLI 关闭了所有 agent-browser 自动化会话，包括历史 ZXSAAS 会话；这不影响真实 Chrome 登录态和 7420 服务。
