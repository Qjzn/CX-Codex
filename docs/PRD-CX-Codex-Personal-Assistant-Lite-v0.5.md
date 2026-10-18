# CX-Codex 轻量私人助手 v0.5 草案

日期：2026-10-13
方案版本：0.5（Hermes 学习正式版并修订，Codex 复核补齐持久契约）
状态：可开发草案；产品功能尚未实现，P0 协议可行性尚未放行。声明、隔离运行与后续实现验收分别记录于 [P0 审查](CX-Codex-Assistant-P0-Protocol-Review.md)。`PRODUCT_GOAL.md` 的优先级与完成门槛保持有效。
源码基线：[v2.8.0](https://github.com/Qjzn/CX-Codex/releases/tag/v2.8.0)，提交 `1e50c43f1ecbcaaed29faf9cef3049132f311f44`；证据明细见[Hermes 源码学习记录](../output/hermes-cxcodex-learning-20261013/deliverables/learning.md)（文件及一基行号）。
被取代：`PRD-CX-Codex-Personal-Assistant-Lite.md` v0.4 与更早的重型编排设计。

## 1. 一句话

一个固定私人助手：简单问题直答，执行类需求派给**一个**后台 Codex worker；worker 结束后助手按一次自动回传转述结果。**一次受理、一次执行、一次回传**，复用正式版既有的 Runtime/SQLite/队列/审批/会话投影。

## 2. 与 v0.4 的差异（本轮修订）

| 主题 | v0.4 / 首批稿写法 | v0.5 修订 | 依据 |
| --- | --- | --- | --- |
| 重启恢复 | 「只有未进发送阶段的 `pending_start` 才续发」「比 v0.4 更强」 | **错**。`pending_start` 期间可能已 `await thread/start`；续发判据只校验 payload/id/hash，调度器会重放整条发送流程 → 可能**重复建线程**。⇒ **外发前持久门闩是开发前提** | `appServerRuntimeStart.ts:157-165,180,199-207`；`appServerRuntimeReconcileScheduler.ts:48`；`appServerRuntimeRequestReconciliation.ts:109-122` |
| 停止与释放 | 「interrupt + 等权威终态」，且首批稿写「释放唯一依据＝快照 `inProgress=false`」 | **错**。`sync_degraded`（陈旧 90s）与 `markInterrupted`（interrupt ACK）都会给出 `inProgress=false`。⇒ 释放只认：**证明未外发且已撤出**，或**新鲜、精确绑定原 thread/turn 的明确原生终态** | `runtimeState.ts:514-523,284-295`；`appServerRuntimeInterrupt.ts:104-115` |
| 失败队列头 | 「`queue_failed` 即标执行失败（未启动）并 retry/DELETE」 | **错**。`queue_failed` 来自普通 `catch`，不证明未启动。⇒ 重点处理**主助手自动回传**的失败队头；只有确定未外发或已权威终态才可先记 `attention` 再撤出并释放回传占用 | `runtimeMessageQueue.ts:270-271,303-312` |
| 不确定创建 | 「不确定都不重发」 | **错**。无 threadId 的不确定 `thread/start` 落 `failed`（不在重启阻塞集合）→ 远端线程可能已存在，本地不占槽也不对账 | `appServerRuntimeStart.ts:229,289-299`；`runtimeStore.ts:180` |
| 角色与权限 | 「按实际用户授权构造 worker 的项目/sandbox/approval/角色」；首批稿把它降级为进程级 | **两条都不成立**：不能把角色策略降级成文字，也不能断言协议只支持进程级。⇒ 角色边界**必须是程序保证**（主助手 + 内部摘要实际只读、禁原生执行/文件/MCP 写与跨线程递归、3 工具只对实际主助手开放、可信 origin 贯穿全链）；逐任务权限**需协议验证**，做不到就停在只读候选，**不从范围删除** | `rpcProxyRoute.ts:64-114`；`serverRequestPolicy.ts:115-163`；`appServerLaunch.ts:16-40` |
| 单槽记账 | 「执行槽＝各类已受理 task 计数」 | 单槽＝**原子启动权争用**（不是计数）：在 `assistant`/`assistant_task` 上争用唯一 `activeTaskId`，派发与重启恢复共用入口，恢复原任务**重用原占槽**；助手单槽与 Runtime 线程租约分属两层（租约只排斥同一 thread） | `runtimeStore.ts:427,299-316` |
| 等待审批 | 「等待原生审批/输入也占槽」（未给机制） | 复用内存 pending 态 + 快照 `waiting_permission`（等价 `running`，占租约）；**不持久**，重启须从头重建 | `pendingServerRequests.ts:21-61`；`runtimeState.ts:145-149,510-512`；`appServerRuntimeBridge.ts:18` |
| 详情与回传恢复 | 未区分「详情」与「再发一次 turn」；恢复含糊 | 详情**默认只读执行记录**；普通发送/继续实现计划/RPC 不得绕过 task 契约。「恢复」分两种：证明未发出的原请求沿原身份继续；用户**新来源**显式重新摘要（保留旧失败，不改旧 payload/身份，不是第二次自动回传）。内部来源仍硬禁派发/停止 | `runtimePayload.ts:39-50,81-90`；`appServerRuntimeStart.ts:146-152,170-172`；`src/internalContextMessage.ts:1-25` |

## 3. 轻量边界（硬约束，不得扩大）

1. **1 个主助手**：一个固定主会话（thread）承担直答与协调。
2. **1 个 worker 执行槽**：同时只允许一个**已取得启动权**的托管执行（排队中的不算）。
3. **3 个协调工具**（拟新增，只注册给主助手）：`assistant_dispatch_task`、`assistant_read_tasks`、`assistant_stop_task`。worker 与普通线程无这些工具。
4. **2 类新增持久记录**（拟新增，复用现有 runtime SQLite）：`assistant`、`assistant_task`。
5. **原生 final/终态**：worker 用 Codex 原生 final 交付，不做自定义结构化报告 schema。
6. **现有 durable 队列**：复用既有队列/租约/幂等，不新建队列、调度器或发送器。
7. **一次受理 / 一次执行 / 一次自动回传**；补充需求创建**关联的新任务**（`relatedTaskId`），不改已冻结契约。

### 两类记录的最小持久契约（拟新增）

| 记录 | 必要字段 |
| --- | --- |
| `assistant` | 固定身份/名称、主 thread 绑定、配置/静态资产版本、`activeTaskId`、`activeReportTaskId` |
| `assistant_task` | `assistantId`、当前真实来源及澄清/限制引用、`relatedTaskId`、不可变目标/cwd/权限/资产 hash、`contractHash`、稳定执行 request/clientMessageId、实际 worker thread/turn、停止意图、结果快照及出处、回传 request/clientMessageId/payload/hash/status、实际主 turn、时间与错误 |

唯一约束覆盖 `(assistantId, sourceUserRequestId)`、执行 request/clientMessageId、回传 requestId/`reportMessageId`（即回传 clientMessageId）和原执行结果捕获关联。同来源同 `contractHash` 返回原 task，不同 hash 报冲突。Runtime 持有真实执行状态、可信 origin 和外发阶段；task 只保存关联及协调事实，不另造运行状态机。

## 4. 核心技能（包内静态资产，两份文件）

- `cxcodex-assistant-core/SKILL.md`：规定直答 vs 派发、澄清、读状态、停止、转述证据、未知状态解释。**不含**工具实现、不写路径/凭据、不承诺自动派发已存在。
- `worker-brief.md`：本次目标、材料、允许动作、检查要求，以及「结果 / 出处 / 检查 / 未完成项」交付提示。

两者为受信任静态资产；**不建**插件系统、通用技能路由器或版本迁移引擎；派发记录必要版本/hash。

## 5. 派发

- **开发前提（阻塞项）**：新增**外发前持久门闩**——在每次外发 RPC（`thread/start`、`turn/start`、`interrupt`）之前持久化「可能已外发」阶段，并**互斥复查停止意图**；覆盖所有入口、恢复与晚到回调。`pending_start`/`payload`/`hash` 都不是未外发证据。门闩未落地前，不宣称「未知不重跑」。
- 每次外发阶段必须以事务条件更新取得首次发送权；正常入口与恢复并发时只有一个调用可外发。`activeTaskId` 已是本 task 只表示归属，不授权再次发送；已置位但没有回执的阶段只对账。
- 入口：后端调用既有 `POST /codex-api/runtime/send`（不带 `threadId` 由 bridge 建 worker 线程；**`/runtime/queue` 需要已有 `threadId`**，`runtimeMessageQueue.ts:129`），带**稳定** `clientMessageId` 与 `requestId`。[源码学习记录](../output/hermes-cxcodex-learning-20261013/deliverables/learning.md) §3。
- 顺序：先持久受理 `assistant_task`（含冻结契约、来源引用、request/clientMessageId），再调用 send；创建返回后**先保存真实 thread/turn ID**，再进入下一次外发。
- 去重锚点：已鉴权、持久保存的当前 `sourceUserRequestId`/`clientMessageId`；一个来源对应唯一 task；同契约重投返回原回执，不同契约返回冲突。
- 来源校验由**后端**解析真实用户消息引用（含原目标、当前澄清、期间限制）；模型不能自造来源或挑旧授权。内部摘要回合**硬禁**派发/停止。
- 协调请求先核验受控 App Server 连接、`assistant.mainThreadId` 和当前主 Runtime 请求的**精确实际 turn**，再读取可信来源。派发仅接受真实用户来源，之后按来源幂等受理 task；新派发时 worker task 尚不存在，不能拿它做入站前提。读接受可信用户或内部来源，停仅接受真实用户来源，两者另核验目标 task 属于同一助手及操作条件；工具调用的主 turn 不等于 worker turn。结果捕获与摘要完成各自绑定原 worker turn / 原主摘要 turn，不能混用。
- 角色边界按程序实现（§8 规则 3）：主助手与内部摘要实际只读；工具只对实际主助手注册。
- worker 的 `cwd`/`model` 由后端按任务构造；第一版关闭 worker 原生跨线程派发，保持唯一托管执行。**逐任务权限/角色需协议验证**（未验证前不实现；不断言只能进程级，也不据此另建多进程）。
- 主会话按独立请求串行处理，忙碌时进入同一 durable 队列；不用 steer 并入活动 turn。

## 6. 结果回传

- 后端按精确 worker thread/turn 捕获终态、明确 final、产物/检查引用；事件只是触发器，快照/历史补偿漏事件。
- **结果与 pending 回传同事务落盘**（同 `assistant_task`），再沿主会话既有队列启动**一次**原生摘要回合。此时冻结 task/原执行引用、有界结果正文及出处、目标主 thread、可信内部 origin、发送参数与 payload hash；沿原回传身份恢复须逐项校验，不能依据迟到材料、当前配置或新生成文本重新拼装。
- 同一主会话仅有一个已取得自动回传权且尚未结清的 task：事务条件更新 `assistant.activeReportTaskId`。其他结果只持久等待。`finished`，或确定未外发/已有权威终态且失败队项已安全撤出后，才释放；`attention` 本身不释放未知占用。worker 执行槽与回传占用分别记账。
- 释放与完成：`accepted` 只表示回传已持久受理；`finished` 要求精确绑定的实际主 turn 成功结束且有明确 final。请求 completed / 原生队列交接不算 finished。
- **回传失败（队头问题优先处理）**：主助手自动回传所在的队列项若 `queue_failed`，会阻塞该线程后续用户消息与报告。只有「确定未外发」或「已取得权威终态」时才允许先持久记 `attention`，再安全撤出队头并释放回传占用；实际回合未知则继续占用并对账，**不得 retry 重跑**。
- **显式恢复分两种**：同 `clientMessageId` 的 `failed` 重投只会返回旧失败（`appServerRuntimeStart.ts:146-152,170-172`）。因此：(a) 能证明原回传未发出的，沿原身份继续、不改 payload；(b) 用户以**新来源**显式要求重新摘要的，作为新请求处理，保留旧失败记录，**不改旧 payload/身份**，且**不是第二次自动回传**。
- worker 已结束但 final 暂缺 → 有界补读后仍缺则 `attention`；已有回传冻结后，迟到材料不改写原正文、不触发第二次自动摘要。
- 禁止：后台发送器、绕队列旁路、合批/公平调度/多消费者租约。

## 7. 重启恢复

扫描已有 `assistant_task` 并对账原执行（不是任务重试系统）：

| 已保存事实 | 动作 |
| --- | --- |
| 能证明处于外发阶段之前（门闩未置位） | 沿原 request/clientMessageId 继续 |
| 门闩已置位 / `pending_start` 后可能已建线程 / `starting` / `start_uncertain` | 按原身份核对；**占槽不重跑**，不得重新 `thread/start` |
| 记录为 `failed` 但曾可能外发（含无 threadId 的不确定创建） | 按原身份核对远端是否已有线程/回合；未知占槽，**不得直接重派** |
| worker 仍活动或等待审批/输入 | 恢复监听 + 快照对账（等待审批不是持久事实，须从事件/线程读取重建） |
| worker 已结束、结果未保存 | 从原 thread/turn 补捕获 |
| 结果已保存、回传未受理 | 以原 reportMessageId + 冻结 payload 接入队列 |
| 回传 accepted 或可能已发送 | 只核对原请求与实际主 turn，未知不重发 |
| 主回传 turn 已结束、状态未写 | 精确绑定 turn 成功且明确 final → 幂等补 `finished`；失败/中断/无 final → `attention`；仍未知继续对账 |
| 主会话丢失或权限不兼容 | 暂停自动调度，任务与结果保留可查 |

**不能用 `inProgress=false` 放行**（`sync_degraded` 陈旧 90s 与 `markInterrupted` 都会给出该值）。停止未证实时不得启动替代执行；**「已外发而结果未知」的 interrupt 不得重发，已取得终态则不发**。**晚到 ID 处理**：先持久化停止意图（绑 task，不绑 ID）；绑定真实 thread/turn 后立刻重读意图，未外发 interrupt 时先落外发阶段再发**首次** interrupt；晚到 thread ID 后、下一次 `turn/start` 前同样复查并兑现。**恢复原任务必须重用原占槽**（同一 `activeTaskId`），不得重争第二个槽。

## 8. 边界规则（含必须的程序保证）

1. **停止与晚到回调**：**停止意图与「是否已拿到真实 ID」解耦**——先持久化意图（绑 task，不绑 ID）；晚到回调绑定真实 thread/turn 后**立刻重读意图**，若该 turn 已确认活动且 interrupt 尚未外发，则先持久化外发阶段、再发**首次** interrupt；晚到 thread ID 后、**下一次 `turn/start` 之前**同样复查：停止意图已在外发前生效则不启动该 turn；若启动已经外发，则待真实 ID 可核对后执行首次 interrupt。**已外发而结果未知的 interrupt 禁止盲目重发**，已终态不发。释放只认「证明执行 turn 未外发且已撤出」或「新鲜、精确原 thread/turn 的明确原生终态」；**停止未知仍保留用户意图**（不得因 `canStop=false` 丢弃）。晚到回调绑定 ID、兑现意图及核对状态，不改契约。
2. **失败队列头**：`queue_failed` 不证明未启动（普通 `catch`）；只有确定未外发或已权威终态才记 `attention` 并撤出队头、释放回传占用；实际回合未知继续占用对账。禁止为绕过失败头再建同线程任务。
3. **角色与来源（程序保证，不是文字）**：主助手与内部摘要实际只读（禁原生执行/文件/MCP 写、禁原生跨线程递归绕过）；3 个协调工具只对实际主助手可用；内部来源不能派发/停止；后端可信 origin 贯穿来源→queue→request→实际 turn→恢复。需要协议验证；做不到就停在只读候选。
4. **单槽＝启动权争用（不是计数）**：在现有 `assistant`/`assistant_task` 上**原子争用唯一 `activeTaskId`**（同一 SQLite 事务内条件更新，影响行数为 0 即未取得启动权、不得外发）；正常派发与**重启恢复走同一入口**，恢复原任务**重用原占槽**不重争；助手单槽与 Runtime **线程租约分属两层**——租约只排斥同一 thread，不同 worker 的线程租约不互相排斥。未知即占槽。**宿主/Runtime 单实例互斥证明是 P0**。不新建第三表、租约框架或调度器。
5. **回传与恢复**：见 §6（含 (a)/(b) 两种恢复）。
6. **详情与原生等待**：worker 详情默认只读执行记录，不等于再向主线程发一次 turn；普通发送/继续实现计划/直接 RPC 不得绕过 task 契约；原生审批/输入只回应重新核验后的当前有效请求。
7. **「停 A 改 B」**：真实用户回合先持久受理冻结的 B（新 task、`relatedTaskId=A`、独立授权与来源），B 排队不占槽；A 满足规则 1 的释放条件后才调度 B；A 未知不得启动 B；不得靠内部摘要回合找回旧授权。

## 9. 开发顺序与完成条件

1. **P0-A 协议可行性（先做，含阻塞项）**：隔离证明主线程动态工具实际往返、真实 thread/turn/call 身份、逐线程权限、严格角色限制、独立回合与原线程恢复。只读角色须禁原生执行/文件/MCP 写及跨线程递归；schema、工具广告清单或技能文字不能代替强制拒绝。未证明的能力不作为已存在功能，也不从范围删除。
   - **实现及 P0-B 验收**：在可行性证明后，沿既有 Runtime 开发可信 origin→queue→request→actual turn→恢复、受控动态工具入口、统一队列、每段 RPC 的原子持久门闩、宿主互斥及助手两个槽位；再验证所有入口/恢复/晚到回调均受约束。门闩和宿主锁是待开发项，不能要求在写代码前已落地。最小批次、证据与失败记录见 [P0 审查](CX-Codex-Assistant-P0-Protocol-Review.md)。
2. **只读闭环**：身份 + 3 工具 + 2 记录 + 单 worker + 原生结果捕获 + 单次回传 + 最小任务列表。端到端留真实记录（例：分析某项目发送流程，不修改文件）。
3. **定向故障验收**：重复派发、跨 turn 澄清、确定启动失败、无 threadId 的不确定创建、`queue_failed` 回传队头、RPC 未知、网页关闭、主助手忙碌、结果/回传断点重启、停止未证实不放行新执行、`inProgress=false` 误判（陈旧 90s 后仍活动）。
   - **停止与晚到 ID（针对场景）**：用户先要求停止（此刻尚无 turn ID）→ 晚到回执绑定真实 ID 后必须兑现意图（落外发阶段并发**首次** interrupt）；已取得终态**不得**再发；「已外发而结果未知」**不得**重发；晚到 **thread ID** 后、下一次 `turn/start` **之前**必须复查并兑现。
   - **单槽原子性（针对场景）**：并发两路（派发 + 重启恢复）争抢同一 `activeTaskId` 时，只允许一路取得启动权，另一路**不得外发**；恢复原任务**复用原占槽**，不重争第二个槽。
   - **回传占用与冻结（针对场景）**：A 的摘要未知时，B 的结果落盘但不进入第二轮自动摘要；重启/迟到材料不改 A 的 payload/hash；结清 A 后才调度 B。重复结果捕获、同来源不同契约与同 task 并发恢复均须证明唯一受理与唯一外发。
4. 通过后再验证受授权写任务；按仓库既有定向检查运行并更新 `tests.md`。

验收场景与源码引用见 [源码学习记录](../output/hermes-cxcodex-learning-20261013/deliverables/learning.md) §3/§4/§7；构建通过不能代替真实闭环。

## 10. 明确不在范围

并行执行、自动拆分、自动改目标、同任务续办/修订、历史线程接管、自动重建主会话、定时任务、自动长期记忆、多实例接管、事务式业务验收发布、结构化 worker-report schema、独立 inbox/wakeBatch/claim-ACK、后台发送器与合批调度、多进程拆分。

**不在范围 ≠ 从需求删除**：逐任务/逐线程权限与角色隔离属 §9 步骤 1 的协议验证项；验证结果决定它进第一版还是停在只读候选。

## 11. 对外承诺边界

只承诺「一个入口、可追踪派发、持久结果、原执行对账」。不承诺：摘要内容正确、目标已达成、手机通知已送达、用户已读、业务验收成功、未知执行不会被重复外发（该保证依赖 §5 门闩落地）。
