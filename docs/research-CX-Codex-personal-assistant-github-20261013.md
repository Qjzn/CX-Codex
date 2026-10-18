# CX-Codex 核心私人助手：GitHub 调研

核查日期：2026-10-13（北京时间）  
范围：公开仓库、固定提交源码、许可、发行记录及 CI 快照。没有安装、运行或接入这些项目。  
关联方案：[核心私人助手 PRD](PRD-CX-Codex-Personal-Assistant.md)。

## 1. 结论

已有项目在实现主助手派发独立任务、收取结果、继续处理。最适合 CX-Codex 的路线，是借鉴它们的接口契约、状态边界和恢复机制，继续使用现有 Codex Runtime。

- Agent Orchestrator：主协调者、执行线程和持久回报的首要参考。
- OpenClaw：Codex App Server 集成、动态工具和子会话结果交付的首要参考。
- Hermes Agent：长期身份、按需技能和异步任务收件箱的首要参考。
- Orca：执行尝试隔离、防过期回报、消费者接管和崩溃恢复的参考。
- Paperclip、oh-my-codex：技能组织、任务领取和事件触发工作流的补充参考。
- 官方 Codex：先核对原生能力；当前原生回报仍不能替代产品级持久收件箱与根助手唤醒。

“可靠可参考”指存在实际实现、针对性测试和维护证据，不表示项目已在 CX-Codex 或当前 7420 跑通，也不表示最新 main 与稳定安装包行为相同。

## 2. 项目比较

| 项目 | 与目标的对应关系 | 最值得参考 | 主要边界 |
| --- | --- | --- | --- |
| [Agent Orchestrator](https://github.com/OrchestratorInc/agent-orchestrator) | 项目主协调者派发 worker，持久回报并投递 | 主助手职责、真实 App Server 线程、回报领取与确认、入口技能 | 项目级编码协调；全局私人身份与跨项目偏好仍需 CX 实现 |
| [OpenClaw](https://github.com/openclaw/openclaw) | 私人助手、子会话、父助手审核；已有 Codex App Server 插件 | thread/turn 接口、动态工具、任务归属、持久结果交付 | Gateway、插件、权限和会话体系庞大；不同执行路径不能混用 |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | 长期身份与记忆、异步委派、父会话处理结果 | 身份与会话分开、持久 completion、失败恢复、unknown 状态 | 核查的子任务运行 Hermes Agent，不是 Codex App Server thread |
| [Orca](https://github.com/stablyai/orca) | 编码任务、worker、派发与邮箱协调 | task/dispatch 分离、旧回报拒收、去重、消费者代际 | 核查代码明确尚未实现 AI 自动任务拆解 |
| [Paperclip](https://github.com/paperclipai/paperclip) | 多智能体任务平台，支持 Codex 与事件唤醒 | 原子领取、合并唤醒、技能注入、重启恢复 | 组织、预算和治理超出 CX 当前范围；整套引入成本高 |
| [oh-my-codex](https://github.com/Yeachan-Heo/oh-my-codex) | Codex CLI 的 leader/worker、邮箱和验收流程 | 入口技能、交付回执、验收与有限修复循环 | 主要支持 macOS/Linux CLI，Windows/App 非默认路径；依赖终端团队运行方式 |
| [Agent Zero](https://github.com/agent0ai/agent-zero) | 父子助手、专用 profile、并行后台工作 | 子助手上下文隔离与交付模板 | 自有 Agent Runtime；未验证重启后主动回报闭环，优先级较低 |
| [Vibe Kanban](https://github.com/BloopAI/vibe-kanban) | 多编码任务及 Codex 执行适配 | 历史 App Server 适配实现 | 已公告 sunsetting，不选为长期依赖 |

## 3. 最值得阅读的源码

### Agent Orchestrator：主助手派发与回传

原 ComposioHQ 项目当前迁移至 OrchestratorInc。项目主协调者保留规划与决策，worker 执行独立工作。结构化聊天驱动实际调用 Codex thread/start、thread/resume 和 thread/fork。[App Server 驱动](https://github.com/OrchestratorInc/agent-orchestrator/blob/4a499e8d5e4678d5e3ee098bd797c608291b73d5/backend/internal/adapters/chatdriver/codexappserver/driver.go)。

回报协议有真实实现：worker 保存 checkpoint、needs-input、stuck、done 与产物；协调器领取回报，以稳定幂等身份提交；接收确认后才 acknowledge，失败释放重试，没有主协调者时保留。报告是协调声明，不直接修改权威执行生命周期。[报告服务](https://github.com/OrchestratorInc/agent-orchestrator/blob/4a499e8d5e4678d5e3ee098bd797c608291b73d5/backend/internal/service/report/service.go)、[投递协调器](https://github.com/OrchestratorInc/agent-orchestrator/blob/4a499e8d5e4678d5e3ee098bd797c608291b73d5/backend/internal/service/report/coordinator.go)、[确认、重试和过期 token 测试](https://github.com/OrchestratorInc/agent-orchestrator/blob/4a499e8d5e4678d5e3ee098bd797c608291b73d5/backend/internal/service/report/coordinator_test.go)。

仅 56 行的入口技能按 spawn、send、report 等命令读取对应文档，支持“一份核心技能加按需参考文档”的方案。[using-ao/SKILL.md](https://github.com/OrchestratorInc/agent-orchestrator/blob/4a499e8d5e4678d5e3ee098bd797c608291b73d5/backend/internal/skillassets/using-ao/SKILL.md)。

其普通回报可等到一小时兜底，done 使用五分钟结算窗口。CX 私人助手应另定完成回报的短合并窗口，补充输入应及时呈现，不照搬等待时间。[报告命令契约](https://github.com/OrchestratorInc/agent-orchestrator/blob/4a499e8d5e4678d5e3ee098bd797c608291b73d5/backend/internal/skillassets/using-ao/commands/report.md)。

### OpenClaw：现有 Codex 技术接点

当前已包含官方 OpenClaw Codex 插件，真实 thread/start 和 turn/start 走 App Server，不能概括成只封装 codex exec。[线程生命周期](https://github.com/openclaw/openclaw/blob/c15fe88ece42366cc68cb6d9ef92b597593fa529/extensions/codex/src/app-server/thread-lifecycle-io.ts#L487)、[启动轮次](https://github.com/openclaw/openclaw/blob/c15fe88ece42366cc68cb6d9ef92b597593fa529/extensions/codex/src/app-server/run-attempt-turn-request.ts#L309)。

子会话注册表有结果交付流程，可参考父任务、子会话与结果身份绑定，以及父助手收到私有结果后审核。[交付生命周期](https://github.com/openclaw/openclaw/blob/c15fe88ece42366cc68cb6d9ef92b597593fa529/src/agents/subagents/registry/subagent-registry-lifecycle-delivery.ts)、[交付积压测试](https://github.com/openclaw/openclaw/blob/c15fe88ece42366cc68cb6d9ef92b597593fa529/src/agents/tools/sessions-spawn-tool.delivery-backlog.test.ts)。

限制：OpenClaw 原生子会话、ACP harness、Codex 插件原生线程是不同路径。sessions_spawn 的 completionTarget=parent 只允许隐藏的原生子助手，不能推断任意 ACP 任务都有同样闭环。[派发工具](https://github.com/openclaw/openclaw/blob/c15fe88ece42366cc68cb6d9ef92b597593fa529/src/agents/tools/sessions-spawn-tool.ts)。

Codex 原生子助手终态结果仍有版本敏感点：当前代码解析 rawResponseItem/completed 中的 subagent_notification，并说明 App Server 尚无类型化结果。CX 不能仅凭一段文本宣布任务完成，需保护解析失败与版本变化。[通知解析](https://github.com/openclaw/openclaw/blob/c15fe88ece42366cc68cb6d9ef92b597593fa529/extensions/codex/src/app-server/native-subagent-notification.ts#L15)。

### Hermes：身份与持久回报

身份有独立 SOUL.md，适合参考身份独立于某条聊天的设计。[身份文件](https://github.com/NousResearch/hermes-agent/blob/63d0b94120027d487c9a5235b9ec64b696af1b26/SOUL.md)。

async_delegation.py 派发后返回 delegation_id，任务与终态写入 SQLite，结果先落盘再进入 completion queue；支持领取、确认、失败释放和重启补发。拥有者退出而没有终态证据时标为 unknown，避免盲目重跑可能已有副作用的任务。[异步委派](https://github.com/NousResearch/hermes-agent/blob/63d0b94120027d487c9a5235b9ec64b696af1b26/tools/async_delegation.py)、[失败重排队测试](https://github.com/NousResearch/hermes-agent/blob/63d0b94120027d487c9a5235b9ec64b696af1b26/tests/tools/test_async_delegation_requeue.py)。

核查的子助手实际调用 Hermes child.run_conversation。可迁移数据结构与恢复原则；整套引入则增加另一套 Python Agent Runtime。[子助手执行](https://github.com/NousResearch/hermes-agent/blob/63d0b94120027d487c9a5235b9ec64b696af1b26/tools/delegate_tool_child_run.py#L855)。

### Orca：执行身份与崩溃恢复

回报结算拒绝 task/dispatch 不匹配和旧执行尝试，重复回报保持幂等；邮箱消费校验消费者 generation，阻止被替换的旧进程继续处理消息。[回报结算](https://github.com/stablyai/orca/blob/1182168681db97fa867c36d3ed5a54d06949a137/src/main/runtime/orchestration/db/dispatch-context/worker-report-settlement.ts)、[邮箱消费](https://github.com/stablyai/orca/blob/1182168681db97fa867c36d3ed5a54d06949a137/src/main/runtime/orchestration/db/messages/mailbox-consumer.ts)、[崩溃恢复测试](https://github.com/stablyai/orca/blob/1182168681db97fa867c36d3ed5a54d06949a137/src/main/runtime/orchestration-mailbox-crash-recovery.test.ts)。

协调器明确 AI 自动拆解尚未实现，任务须预先创建。可以借鉴可靠派发与邮箱，但没有完整自主私人助手的实现证明。[coordinator.ts](https://github.com/stablyai/orca/blob/1182168681db97fa867c36d3ed5a54d06949a137/src/main/runtime/orchestration/coordinator.ts#L146)。

### Paperclip 与 oh-my-codex：技能和工作流

Paperclip checkout 使用带状态、领取身份和执行锁条件的数据库更新；唤醒队列合并同范围工作并保存回执。技能规定短时唤醒、读取新上下文、领取、执行、写结果和退出。[checkout](https://github.com/paperclipai/paperclip/blob/4a641d0980fdaffc4c4e805f6f0a8809eb5702f2/server/src/services/issues.ts#L11703)、[队列](https://github.com/paperclipai/paperclip/blob/4a641d0980fdaffc4c4e805f6f0a8809eb5702f2/server/src/services/heartbeat/queue.ts#L4175)、[技能](https://github.com/paperclipai/paperclip/blob/4a641d0980fdaffc4c4e805f6f0a8809eb5702f2/skills/paperclip/SKILL.md)。

它面向组织、预算和治理，与 CX 当前 PRODUCT_GOAL.md 的轻量范围不符。其 classic Codex CLI 适配器默认绕过审批与 sandbox，不能照搬；这一判断不扩展为所有执行路径的共同默认值。[默认常量](https://github.com/paperclipai/paperclip/blob/4a641d0980fdaffc4c4e805f6f0a8809eb5702f2/packages/adapters/codex-local/src/index.ts#L14)、[参数构造](https://github.com/paperclipai/paperclip/blob/4a641d0980fdaffc4c4e805f6f0a8809eb5702f2/packages/adapters/codex-local/src/server/codex-args.ts#L53)。

oh-my-codex 先持久保存邮箱再通知并记录交付阶段，验收有 verify/fix 和次数上限。[邮箱实现](https://github.com/Yeachan-Heo/oh-my-codex/blob/2e3e629617899c867049e4979ef1355cdea94e9f/src/team/mcp-comm.ts)、[验收状态机](https://github.com/Yeachan-Heo/oh-my-codex/blob/2e3e629617899c867049e4979ef1355cdea94e9f/src/team/orchestrator.ts)。

其 README 明确主要支持 macOS/Linux CLI，Windows/App 非默认路径；依赖 tmux/psmux，推荐启动的 madmax 绕过审批。交付 smoke 使用 fake bridge/tmux，不能当作真实模型闭环证明。[README](https://github.com/Yeachan-Heo/oh-my-codex/blob/2e3e629617899c867049e4979ef1355cdea94e9f/README.md)、[交付测试](https://github.com/Yeachan-Heo/oh-my-codex/blob/2e3e629617899c867049e4979ef1355cdea94e9f/src/team/__tests__/delivery-e2e-smoke.test.ts)。

## 4. 官方 Codex 的能力与缺口

当前官方源码已有真实子线程、父子关系、权限继承、完成 watcher 和冷恢复，应先核对可复用能力。[原生 spawn](https://github.com/openai/codex/blob/f82e36592278a0a782fb0d0fc97e5fa10e832ac2/codex-rs/core/src/tools/handlers/multi_agents/spawn.rs#L128)。

| 机制 | 当前事实 | CX 仍需负责 |
| --- | --- | --- |
| 自动回报 | v2 watcher 送结果时 trigger_turn=false | 闲置根助手的汇总唤醒 |
| followup_task | 禁止把根代理作为目标 | 宿主启动根助手汇总 |
| 普通邮箱 | 进程内 Mutex/HashMap | 跨重启持久 inbox |
| 终态 report | best effort，未去重 | 报告身份、消费回执与补偿 |
| SQLite 消息板 | 帖子持久化，通知不启动新 turn | 存储可借鉴，唤醒仍由宿主负责 |

证据：[watcher](https://github.com/openai/codex/blob/f82e36592278a0a782fb0d0fc97e5fa10e832ac2/codex-rs/core/src/agent/control.rs#L454)、[根目标限制](https://github.com/openai/codex/blob/f82e36592278a0a782fb0d0fc97e5fa10e832ac2/codex-rs/core/src/agent/control/api.rs#L129)、[邮箱](https://github.com/openai/codex/blob/f82e36592278a0a782fb0d0fc97e5fa10e832ac2/codex-rs/core/src/agent/control/mailbox.rs#L15)、[回报契约](https://github.com/openai/codex/blob/f82e36592278a0a782fb0d0fc97e5fa10e832ac2/codex-rs/core/src/agent/api.rs#L129)、[消息板通知](https://github.com/openai/codex/blob/f82e36592278a0a782fb0d0fc97e5fa10e832ac2/codex-rs/ext/agent-message-board/src/host.rs#L17)。

当前 main 与正式 rust-v0.162.1 中，multi_agent_v2 为 Stable、默认关闭；agent_message_board 和 multi_agent_v2_dynamic_tools 为 UnderDevelopment、默认关闭。源码存在不代表稳定对外 API。[feature 定义](https://github.com/openai/codex/blob/f82e36592278a0a782fb0d0fc97e5fa10e832ac2/codex-rs/features/src/lib.rs#L1464)、[正式发布](https://github.com/openai/codex/releases/tag/rust-v0.162.1)。

此前本地协议探针是 0.130.0，且不是活动 7420 进程的版本证明。新能力要先核对真实运行版本、配置和隔离闭环；本次没有升级。内部 AgentControl 管理代理树，不等同于 App Server 任意用户会话的跨线程公共协议。

## 5. 维护、许可与证据快照

以下项目核查时均未归档。固定提交代表本次阅读对象；CI 状态是动态快照，未把正在运行、跳过或失败项目写成通过。

| 项目 | 固定提交 | 许可 | 最新稳定发行 |
| --- | --- | --- | --- |
| Agent Orchestrator | 4a499e8d5e4678d5e3ee098bd797c608291b73d5 | Apache-2.0 | [v0.13.7](https://github.com/OrchestratorInc/agent-orchestrator/releases/tag/v0.13.7)，10-10 |
| OpenClaw | c15fe88ece42366cc68cb6d9ef92b597593fa529 | MIT | [v2026.10.2](https://github.com/openclaw/openclaw/releases/tag/v2026.10.2)，10-12 发布 |
| Hermes | 63d0b94120027d487c9a5235b9ec64b696af1b26 | MIT | [v0.21.7](https://github.com/NousResearch/hermes-agent/releases/tag/v0.21.7)，10-12 |
| Orca | 1182168681db97fa867c36d3ed5a54d06949a137 | MIT | [v1.4.224](https://github.com/stablyai/orca/releases/tag/v1.4.224)，10-10 |
| Paperclip | 4a641d0980fdaffc4c4e805f6f0a8809eb5702f2 | MIT | [v2026.1012.0](https://github.com/paperclipai/paperclip/releases/tag/v2026.1012.0)，10-13 北京时间 / 10-12 UTC |
| oh-my-codex | 2e3e629617899c867049e4979ef1355cdea94e9f | MIT | [v0.21.10](https://github.com/Yeachan-Heo/oh-my-codex/releases/tag/v0.21.10)，10-13 |
| 官方 Codex | f82e36592278a0a782fb0d0fc97e5fa10e832ac2 | Apache-2.0 | [rust-v0.162.1](https://github.com/openai/codex/releases/tag/rust-v0.162.1)，10-09 |

CI 信号：

- Agent Orchestrator：[Go CI](https://github.com/OrchestratorInc/agent-orchestrator/actions/runs/38325467048)有成功的 backend、chat/sqlite race、session-store、Windows workspace 项；[native/CLI E2E](https://github.com/OrchestratorInc/agent-orchestrator/actions/runs/38325466997)也成功。
- Hermes：[所核查提交 CI 成功](https://github.com/NousResearch/hermes-agent/actions/runs/38341673043)，另有 Docker 工作流尚待完成。
- OpenClaw：[所核查提交 CI](https://github.com/openclaw/openclaw/actions/runs/38353773255)核查时仍在运行，不能称当前全绿。
- Orca：[persistence CI](https://github.com/stablyai/orca/actions/runs/38350790272)中 Windows/Linux/macOS 项成功，也有 queued/skipped 项。
- Paperclip：[所核查提交 verification](https://github.com/paperclipai/paperclip/actions/runs/38353977826)大部分仍在运行。有 restart/replay/recovery chaos 与 runner 检查，不意味着该轮已通过。
- oh-my-codex：[CI](https://github.com/Yeachan-Heo/oh-my-codex/actions/runs/38322952042)中 Team Critical coverage、运行状态、hooks、typecheck、native Windows 项成功；部分行为测试使用替身。

Agent Zero 为次选：固定提交 e3051fb584b1a36be2b0a0c90606f1c2c2d356ec，9-24 发布 [v2.13](https://github.com/agent0ai/agent-zero/releases/tag/v2.13)。[LICENSE 正文](https://github.com/agent0ai/agent-zero/blob/e3051fb584b1a36be2b0a0c90606f1c2c2d356ec/LICENSE)是 MIT，但 GitHub metadata 为 NOASSERTION，采用时应核对具体文件许可。[子助手](https://github.com/agent0ai/agent-zero/blob/e3051fb584b1a36be2b0a0c90606f1c2c2d356ec/tools/call_subordinate.py)与 parallel.py 是自有运行链路；本次仅看到 Docker 发布成功，未看到通用测试全部执行的工作流。

Vibe Kanban 固定提交 d5cbb5380fa0b32e98ef9b8d987f63decce4be3a，[README 已公告 sunsetting](https://github.com/BloopAI/vibe-kanban/blob/d5cbb5380fa0b32e98ef9b8d987f63decce4be3a/README.md)。可阅读历史实现，不推荐为长期关键依赖。

## 6. 对 CX 可开发方案的影响

先定义一份 cxcodex-assistant-core，配一个执行线程交付模板。入口保持简短，派发与验收细则按需读取。

| 内容 | 职责 | 参考 |
| --- | --- | --- |
| 核心技能 | 直答或派发、持续关注现有任务、何时汇报 | AO 入口技能、Hermes 分流 |
| 派发参考文档 | 目标、工作区、授权、验收、任务与修订身份 | AO spawn/report、Orca dispatch |
| 回报参考文档 | 结果、产物、验证证据、未完成项、输入需求 | AO report、OpenClaw 父助手审核 |
| 执行线程模板 | 只处理委派范围，返回结构化回报 | worker 契约 |
| 后端协调模块 | 身份、任务关系、幂等派发、持久 inbox、回执、根助手唤醒、权限 | AO、Hermes、Orca |

固定私人身份和用户偏好不应只藏在技能正文。技能提供方法，后端提供能力、身份约束和持久事实。第一版按实际任务选择现有领域技能，不先制造大量强制技能依赖。

继续保持这些方案边界：

1. 用户统一与助手交流，后台保留可查看、可审批的原生执行线程。
2. App Server / Runtime 是执行状态权威；报告只表达协调声明和业务验收。
3. 后端分配与校验派发身份；重试不重复创建线程。
4. 结果先入持久 inbox，主助手忙碌时保留，闲置后由后端启动汇总。
5. 区分报告已保存、已接收、已审核、已向用户汇报，不提前确认业务完成。
6. 新修订有独立执行身份，旧结果不能覆盖当前任务。
7. 保留权限边界，不引入组织、计费、多模型平台或额外常驻数据库。

## 7. 开发前最小验证

在隔离候选中证明真实闭环：用户请求 → 助手派发 → 新 Codex 线程执行 → 后端保存结果 → 根助手汇总 → 用户看到证据。再验证：

- 同一派发重试只产生一条执行线程。
- 结果落盘后、尚未进入助手队列时重启，仍能补发。
- 主助手正在回应另一请求时，回报保留且之后消费。
- 汇总已接受但未明确完成时重启，不重跑原任务，不误标已汇报。
- 修订后旧线程回报到达，不覆盖当前修订。
- 子线程等待审批或补充输入时，统一入口保留原请求身份。

本次增强了方案的参考依据，没有完成上述验证，也没有执行依赖安装、Codex 升级、代码接入、Git 提交、发布或 7420 替换。
