# App Server 协议差异矩阵

本文把 `npm run audit:app-server-schemas` 发现的官方 schema 差异拆成可执行的兼容矩阵。它不是 release notes，而是后续升级、验收和开源治理的工作台。

这里的 App Server 指官方 Codex App Server，即 Codex rich clients 使用的本机协议接口。

## 当前证据

- 审计命令：`npm.cmd run audit:app-server-schemas`
- 审计时间：2026-07-03
- 审计输出：`output/app-server-schema-audit/20260703-192708`
- 已提交摘要：`docs/app-server-schema-audit-summary.json`
- TypeScript schema diff：526 files changed，3038 insertions，2189 deletions
- JSON schema diff：273 files changed，73005 insertions，61600 deletions
- 结论：官方最新 schema 与仓库基线大范围不一致，不能直接覆盖基线，也不能声明已完全对齐最新 App Server。

## 兼容状态定义

- `已覆盖`：当前 Web/Android 客户端已有功能路径，升级时必须保持行为不回退。
- `部分覆盖`：已有基础能力，但官方 schema 新字段/新事件/新方法未完全进入 UI 或状态机。
- `需容错`：暂不做产品入口，但必须保证未知字段、未知事件或未知 item 不导致白屏、崩溃或任务卡死。
- `待接入`：具备明确用户价值，后续应设计 UI、权限、安全边界和测试。
- `暂缓`：官方仍偏实验或产品边界不清，先文档化并避免误宣传为稳定能力。

## 能力矩阵

| 能力域 | 官方最新差异 | 当前项目状态 | 下一步门槛 |
| --- | --- | --- | --- |
| JSON-RPC / schema bundle | 新增 `codex_app_server_protocol.v2.schemas.json`，根 schema 与 v2 schema 均有大范围变化 | 部分覆盖。仓库已有 schema 基线、审计脚本、临时输出和已提交的 `docs/app-server-schema-audit-summary.json` | 每次升级 Codex CLI 先生成临时 schema，再审计；如差异变化，更新摘要快照和矩阵后再进入 release |
| Transport / handshake / auth | 官方 App Server wire format 省略 `"jsonrpc":"2.0"`；默认 `stdio` JSONL；连接后先 `initialize` 再发 `initialized` notification；WebSocket 为 experimental and unsupported，远程暴露必须配置 auth；过载可能返回 `-32001` | 已覆盖稳定 stdio 路径。当前 bridge 使用 stdio JSONL 子进程通信，出站 request/response/notification 统一省略 `"jsonrpc":"2.0"`，并在 `initialize` 成功后发送 `initialized`；Web/Android 侧不直接暴露 app-server WebSocket | 继续默认走本地 stdio；如未来接入 WebSocket，必须先实现 auth、`/readyz`/`/healthz` 健康检查、Origin 拒绝和 overload retry |
| Thread / Turn 核心 | `ThreadStatus`、`ThreadActiveFlag`、`ThreadSource`、`TurnItemsView`、`TurnEnvironmentParams`、`ThreadInjectItems*`、`ThreadShellCommand*`、`ThreadUnsubscribe*` 等新增 | 部分覆盖。现有代码覆盖 `thread/list`、`thread/read`、`thread/start`、`thread/resume`、`thread/fork`、`thread/rollback`、`thread/archive`、`thread/name/set`、`turn/start`、`turn/interrupt` | 扩展 normalizer 对 `thread.status`、`active flag`、`unsubscribe status` 的容错；不支持的 action 必须展示为 unhandled raw block |
| Runtime 状态机 | 最新 schema 对 turn/thread 状态表达更细，新增 goal/status/realtime 通知 | 部分覆盖。当前已有 runtime store、reconcile、stop uncertain、notification replay；未知 thread/turn status 已在 health/diagnostics 与诊断中心按来源和值聚合计数 | 继续扩展具体新增状态的产品语义；状态机只把明确状态映射为运行态，其余保持非运行/降级路径 |
| 审批与权限 | 新增 permission profile、guardian review、network/file-system permission、approval review 通知 | 部分覆盖。当前已有 command/file/mcp 基础审批和停止审计，但未覆盖 guardian/profile | 先做只读展示和拒绝/降级策略，避免默认放权；所有新增 approval 必须记录来源、scope、decision |
| Command / Process / Terminal | 新增 command exec stream、resize、write、terminate、process output delta/exited、terminal size | 部分覆盖。当前 UI 能展示 commandExecution 聚合输出，但不支持交互式 terminal 流 | 保证新增 stream/delta item 不崩溃；后续再设计交互式终端 UI |
| File System | 新增 fs read/write/copy/remove/watch/unwatch/metadata/directory 相关 schema | 待接入。当前项目没有把 App Server fs API 暴露为文件管理入口 | 默认不暴露写操作；如接入，必须绑定 workspace permission 和路径边界检查 |
| MCP | 新增 elicitation、resource read、server tool call/status/update、startup state 等 | 部分覆盖。当前 composer 插件列表读取 `mcpServerStatus/list`，OAuth 登录和 reload 可用 | 支持 elicitation/server request 的泛化展示；resource read 只在明确权限下接入 |
| Plugins / Apps / Marketplace | 新增 plugin install/read/list/share/uninstall、marketplace add/remove/upgrade、app branding/summary/tool approval | 部分覆盖。当前支持 app/list 与 MCP 合并展示，但不管理 marketplace 生命周期 | 短期只读展示 install/accessibility 状态；安装/卸载/分享必须加确认和来源标识 |
| Skills | `SkillSummary`、`SkillsChangedNotification`、skill read/config 相关变化 | 部分覆盖。当前 skills/list 已用于 composer | 监听 skills changed 后刷新列表；新增字段只读容错 |
| Hooks | 新增 hook list、started/completed、scope、trust、migration 等 | 待接入 | 先在诊断中心只读展示 hook 状态；不在普通用户流里执行或编辑 hook |
| External Agent / Migration | 新增 external agent config detect/import、migration item | 暂缓 | 仅记录为未来迁移能力；不能默认导入外部 agent 配置 |
| Realtime / Audio | 新增 thread realtime audio/transcript/sdp/transport 等 | 暂缓。当前语音能力走 OpenAI 官方 audio transcription API，不接 App Server realtime | 不把 realtime 宣传为稳定能力；如接入，先隔离为实验入口 |
| Windows Sandbox | 新增 readiness/setup/start/completed | 待接入 | 先在诊断中心展示 readiness；setup 需要显式用户确认 |
| Models / Rate Limits / Account | 模型可用性、reroute、verification、service tier、rate limit 类型扩展 | 部分覆盖。当前已有模型列表和账户状态基础读取 | 将 reroute/verification 作为通知展示，不影响当前 thread 渲染 |
| Notifications | 新增大量 notification 类型，部分旧 v1 event 移除 | 部分覆盖。当前 replay buffer 存储通知并按 threadId 触发刷新；未知 notification 不阻断 replay/runtime 流，并在 health/diagnostics 中按 method 聚合计数 | 继续扩展未知 notification 到诊断中心 UI；不能因为未知 notification 丢失当前线程刷新 |
| Open-source release governance | 协议差异需要能被维护者和贡献者复核 | 部分覆盖。已有协议审计文档、脚本、已提交摘要快照、测试记录和 release/governance 门禁 | Release checklist 必须包含 schema audit、build、CJS smoke、README/changelog、安全说明；治理门禁必须校验摘要快照结构 |

## 优先级

### P0：稳定性保护

1. Unknown notification / unknown thread item 不崩溃。
2. Thread/turn 核心方法的参数和响应兼容。
3. Permission/guardian/network/fs 默认保守，不能无提示放权。
4. Runtime 状态机对新增状态有降级路径。

### P1：产品竞争力

1. 插件、MCP、skills 的只读状态展示和刷新。
2. 诊断中心展示 schema audit 摘要、未知通知、未知状态、权限请求队列。
3. Windows sandbox readiness 和模型 reroute/verification 可见。

### P2：实验能力

1. App Server realtime audio/transcript。
2. Plugin marketplace 安装/分享。
3. Hook 和 external agent 配置导入。
4. App Server 文件系统写操作。

## 后续执行规则

每个协议域进入实现前，必须先回答：

1. 官方 schema 字段是否稳定，还是实验/迁移字段？
2. 当前 UI 是否需要主动入口，还是只需要容错？
3. 是否涉及文件系统、网络、shell、插件、凭据或用户确认？
4. 是否需要更新 `tests.md`、README、changelog 和 release checklist？
5. 是否能通过 `npm.cmd run build`，如果涉及 CJS entry，还要做 require smoke。

未回答这些问题前，不更新仓库 schema 基线。
