# 本地完整回归测试清单

更新时间：2026-07-05 10:55 Asia/Shanghai。

本文覆盖当前 `codex/candidate-release-review` 分支和本机 7420 新部署后的完整回归范围。它是执行清单，不是 release notes。

## 使用方式

每次候选发布、7420 重新部署、App Server 协议兼容变更、语音转写变更、安全边界变更或 Android 壳变更后，按本文执行。

执行优先级：

- P0：必须通过；失败则不能继续候选发布。
- P1：应通过；失败时必须记录影响范围和是否阻断发布。
- P2：人工/环境相关；不能自动完成时必须记录未执行原因。

## P0 自动化门禁

| 编号 | 项目 | 命令 / 动作 | 通过标准 |
| --- | --- | --- | --- |
| P0-1 | 工作树状态 | `git status --short --branch` | 明确当前分支，除本轮测试文档外无未知改动 |
| P0-2 | 空白/冲突标记 | `git diff --check` | 无 trailing whitespace、冲突标记或补丁格式错误 |
| P0-3 | 构建 | `npm.cmd run build` | `vue-tsc --noEmit`、Vite build、`tsup` CLI build 通过；Vite large chunk warning 仅作为已知非阻断项 |
| P0-4 | Governance | `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` | `Governance docs check passed.` |
| P0-5 | Frontend normalizer | `npm.cmd run verify:frontend-normalizers` | 前端 App Server payload normalizer smoke 通过 |
| P0-6 | Server modules | `npm.cmd run verify:server-modules` | App Server / bridge server module smoke 通过 |
| P0-7 | Release package / npm package | `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip` | frontend normalizer、server module、CLI、CJS launcher、release package、checksum、npm package smoke 全部通过 |
| P0-8 | 正式候选 release gate | `npm.cmd run verify:release -- -RequireCleanGit -SchemaAudit warn` | clean worktree 上通过；schema drift warning 允许但必须记录为 review-required |

## P0 本地 7420 服务验证

| 编号 | 项目 | 命令 / 动作 | 通过标准 |
| --- | --- | --- | --- |
| P0-9 | 进程来源 | 查询 7420 监听进程命令行 | `node.exe` 使用当前仓库 `E:\javaword\CXCodex\codexui\dist-cli\index.js` |
| P0-10 | 本机健康 | `Invoke-WebRequest http://127.0.0.1:7420/health` | HTTP 200，`status=ok` |
| P0-11 | App Server 健康 | `Invoke-WebRequest http://127.0.0.1:7420/codex-api/health` | HTTP 200，`appServer.running=true` 且 `initialized=true` |
| P0-12 | 公网映射健康 | `Invoke-WebRequest http://116.62.234.104:17420/health` | HTTP 200，`status=ok`；失败时先定位 FRP/隧道/防火墙，不直接归因前端 |
| P0-13 | 事件回放端点 | `npm.cmd run test:7420 -- -SkipBrowser -PublicHealthUrl http://116.62.234.104:17420/health` | 本机、公网、`/codex-api/events/replay` 通过 |
| P0-14 | 短时浸泡 | `npm.cmd run test:7420:soak -- -DurationSeconds 60 -IntervalSeconds 15 -PublicBaseUrl http://116.62.234.104:17420` | 无连续健康失败、无新增 RPC timeout、pending/queued RPC 未超过阈值 |

## P1 协议和发布治理

| 编号 | 项目 | 命令 / 动作 | 通过标准 |
| --- | --- | --- | --- |
| P1-1 | Schema drift 摘要 | 查看 `docs/app-server-schema-audit-summary.json` 和最新 `output/app-server-schema-audit/*/audit-summary.json` | 计数变化时先更新摘要和矩阵；状态保持 `drift-recorded`，不宣称 fully aligned |
| P1-2 | Protocol matrix | 查看 `docs/app-server-protocol-matrix.zh-CN.md` | P0/P1/P2/P3 边界明确，Thread/MCP/plugin/fs/process/realtime/Windows sandbox 不被误标稳定 |
| P1-3 | Candidate review | 查看 `docs/candidate-release-review.zh-CN.md` | release gate 证据、官方文档复核、P0/P1/P2 清单和宣传边界完整 |
| P1-4 | PR review pack | 查看 `docs/candidate-pr-review-pack.zh-CN.md` | PR 正文、候选发布说明、review checklist、P0/P1/P2 issue 草稿和远程 PR 准备命令完整 |
| P1-5 | Release body | 查看 `.github/release-body.md` | 明确 schema drift 是 candidate-reviewed，不宣称 fully aligned |
| P1-6 | Security boundary | 查看 `SECURITY.md` 和 `docs/security-hardening.zh-CN.md` | WebSocket experimental/unsupported、远程暴露、API key、日志脱敏和权限边界清楚 |

## P1 7420 前端自动化

这些项目会调用 `agent-browser`，属于浏览器自动化。执行前确认本机可以启动/控制自动化浏览器。

| 编号 | 项目 | 命令 / 动作 | 通过标准 |
| --- | --- | --- | --- |
| P1-7 | 基础三视口回归 | `npm.cmd run test:7420 -- -PublicHealthUrl http://116.62.234.104:17420/health -ScreenshotDir output\regression-7420\candidate` | 桌面、手机、折叠屏无空白、无横向溢出、composer 可见、无浏览器 page error |
| P1-8 | 前端页面回归 | `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420` | 首页、skills、GitHub trending、diagnostics、本地预览和可选 thread 页通过 |
| P1-9 | 诊断中心 | 打开 `/diagnostics` | Runtime Store、App Server、schema audit、通知/状态诊断卡片可见，无敏感信息泄漏 |
| P1-10 | 本地预览 | 打开 `local-preview.html?path=<README.md>` | Markdown 渲染正常，无横向溢出 |

## P2 手工功能回归

| 编号 | 项目 | 动作 | 通过标准 |
| --- | --- | --- | --- |
| P2-1 | 会话列表和线程读取 | 打开已有会话，切换 3 个线程 | 先显示缓存或轻量内容，再补全详情；无长时间空白 |
| P2-2 | 新消息发送 | 在测试线程发送短消息 | 消息乐观显示，运行态可见，完成后停止/思考态清理 |
| P2-3 | 队列行为 | 运行中继续输入第二条消息 | 新消息进入队列或按设计处理，不丢失、不误执行 |
| P2-4 | 停止操作 | 对可停止任务点击停止 | UI 和 `/codex-api/health` runtime 状态最终收敛 |
| P2-5 | 移动恢复 | 手机或窄视口切后台/锁屏后返回 | 自动补同步，不需要手动刷新才能看到最终状态 |
| P2-6 | 折叠屏布局 | 884x1104 视口 | 左侧列表和右侧内容同时可用，无空白内容列 |
| P2-7 | 图片/文件预览 | 打开带图片或本地文件链接的消息 | 图片可预览/缩放，本地文件只在允许根目录内转换链接 |
| P2-8 | 收藏/置顶 | 收藏消息、置顶线程、刷新页面 | 状态持久化，非浏览器 localStorage 单点依赖 |
| P2-9 | 语音转写 | 配置或不配置 OpenAI API key 分别测试 | 官方 API 路径和登录态回退路径行为符合 README；诊断不泄露 key |
| P2-10 | Android 壳 | Android 连接公网 17420，前后台恢复 | 首页、线程、恢复补同步、下载更新入口可用 |
| P2-11 | 公网访问 | 外部网络访问 `http://116.62.234.104:17420` | 登录/健康/页面加载正常；公网失败不影响本机健康判断 |

## P2 长时稳定性

| 编号 | 项目 | 命令 / 动作 | 通过标准 |
| --- | --- | --- | --- |
| P2-12 | 发布前浸泡 | `npm.cmd run test:7420:soak -- -DurationSeconds 7200 -IntervalSeconds 15 -PublicBaseUrl http://116.62.234.104:17420` | 2 小时内无连续健康失败、无新增 RPC timeout、pending/queued RPC 未超过阈值 |
| P2-13 | 日志审查 | 查看 `C:\Users\SW\.codexui\logs` 最新 `.log` | 无重复崩溃、无限重启、明文凭据或异常堆积 |

## 失败处理规则

- P0 失败：停止候选发布，先修复或回退。
- P1 失败：记录风险；如果影响公开承诺或核心路径，升级为阻断。
- P2 未执行：必须记录原因、影响范围和补测条件。
- schema drift 变化：不要直接覆盖基线；先更新脱敏摘要、协议矩阵和 candidate review。
- 浏览器/Android 自动化未跑：不能宣称已完成视觉/真机回归，只能声明代码和 HTTP/包级验证通过。
