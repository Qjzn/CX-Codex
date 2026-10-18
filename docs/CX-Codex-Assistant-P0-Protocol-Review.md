# CX-Codex 轻量助手：P0 协议验证与开发拆分

日期：2026-10-13。配套方案：[轻量助手 v0.5](PRD-CX-Codex-Personal-Assistant-Lite-v0.5.md)。本轮只做开发前审计和隔离探针，不实现产品功能；`PRODUCT_GOAL.md` 的优先级、门槛和发布边界继续有效。

## 结论

继续保留 **1 个主助手、1 个 worker 槽、3 个协调工具、2 类持久记录**。基础动态工具、逐线程权限选择、冷恢复及主线程禁 shell 已通过隔离协议探针；严格角色的全路径覆盖仍未放行。先完成剩余可行性证明，再实现并验收来源、外发门闩、单槽和恢复；不能由 schema 或技能文字代替程序保证。

正式源码固定为 CX-Codex **v2.8.0 / `1e50c43f1ecbcaaed29faf9cef3049132f311f44`**；本机探针针对另行核实的 **Codex CLI 0.130.0**。二者属于不同版本边界；没有验证生产 7420 使用哪个 native 版本。

## 已核实的声明与实现差距

| 能力 | 已核实证据 | 实际意义与缺口 |
| --- | --- | --- |
| 动态工具 | 本机生成 `ThreadStartParams.dynamicTools`；`DynamicToolCallParams` 含 `threadId/turnId/callId` | 可声明线程工具和原生调用身份；正式版 `serverRequestPolicy.ts` 仍拒绝所有 `item/tool/call`，需要受控处理器 |
| 逐线程权限 | schema 声明线程/turn 权限；隔离 RPC 用 `permissions` 显式选择 `:read-only` 与 `:workspace` 得到两种不同实际回执 | 同进程权限选择已实测，实际 OS 写隔离仍未测；本次 legacy sandbox 参数未实现预期覆盖，宿主必须核验实际策略 |
| 严格角色 | 真实 feature key + 逐线程 config 已移除主线程 shell/代理工具；关闭的 shell 调用明确返回 unsupported | 空隔离 profile 未覆盖现有 MCP/其他写路径；冷恢复后的加固策略与跨线程越权拒绝待测。接受未知 config 键不等于有效 |
| 来源与 actual turn | bridge 保存发送 ID 及部分原生回执；工具请求声明真实 thread/turn/call | 发送 ID 和模型参数不是授权。需要后端可信 origin、精确映射和恢复；未绑定或冲突时拒绝协调调用 |
| 独立主回合 | 正式版已有 SQLite durable 队列和线程租约 | 继续复用；普通发送、原生 queue 交接与真正 turn 完成分别核验，禁止 steer 合并来源 |
| 重启与单槽 | 现有持久请求、事件、快照及线程租约 | 缺每次 RPC 前原子外发门闩、assistant 全局槽位和同 Runtime 跨进程宿主互斥；这些属于开发工作 |

原生声明以本机两次生成命令为准（均退出 0）：`app-server generate-ts --experimental`、`app-server generate-json-schema --experimental`。二进制 SHA256：`280CB1C4E3375D94DBDCBA1A191F4F6ADBF73C293BE1E4F16C74B006662B9C54`。

公开说明：[Codex App Server](https://learn.chatgpt.com/docs/app-server)。官方说明动态工具属于 experimental API，客户端须显式启用；线程级注册及 `item/tool/call` 往返不能替代产品自身的来源鉴权。

## P0-A：开发前协议可行性

隔离环境使用独立 `CODEX_HOME`、独立工作目录和 localhost Responses 夹具；不使用真实模型、生产 Runtime 数据库或用户侧栏会话。夹具只请求合成的协调读工具，不请求 shell、文件或 MCP 写入。

1. 原生工具往返：真实 `item/tool/call` 的 thread/turn/call 能精确关联受控请求，工具回执后取得明确 final 和原生终态。worker 未注册助手工具；错误目标/工具必须被拒绝。
2. 权限与角色：同进程主/worker 的实际策略不同且符合冻结契约；严格禁止的原生执行、写入及跨线程路径须逐项证明，不能只观察广告工具列表。
3. 独立回合与恢复：同主线程多来源请求形成独立 turn；重启后原线程、历史和工具策略可核验。恢复不能把新启动、丢回执重发或未绑定回合算成成功。
4. 版本与降级：记录真实二进制/version/hash。目标 native 不兼容或精确身份不可恢复时暂停并保留待核对记录；不自动换 ID 重发，不引入多进程或新状态框架补缺口。

前两轮受限环境隔离探针实际失败：initialize、创建隔离线程和重启后的 thread/resume 成功，但所有 turn 均 failed、本地夹具请求数为 0。失败记录原样保留。第二轮已改用严格环境变量白名单、独立 profile/home/temp，关闭插件/应用/浏览器/钩子并将非 localhost HTTP 代理指向关闭端口；未继承凭据，未访问生产实例。

修订后窄隔离执行获批，`offline/run-2026-10-13T11-00-14-395Z/result.json` 的 **8 条协议断言全部通过**，探针退出 0，5 个 localhost 夹具请求均无 Authorization，两次 native 进程均退出 0：

- 同进程两种权限 profile 实际回执；工具调用携带真实 thread/turn/call；应答后原生 turn 成功结束并返回测试正文。
- worker 发往夹具的模型工具表没有助手读工具；原线程在冷重启后仍能调用已持久注册的动态工具。
- 已加载线程的 `thread/resume` 权限覆盖会被忽略；冷重启后 resume 可应用 profile；`turn/start` 权限覆盖可生效。恢复必须核验实际回执，不能把请求参数当结果。

这是**真实 native + 合成模型**的协议往返，不是 CX-Codex 派发/回传/重启业务闭环。默认 readOnly 的工具表仍包含 `shell`、`spawn_agent`、`send_input` 等；不能只设沙箱就宣布角色隔离完成。

独立加强探针 `offline/hardened-run-2026-10-13T11-03-51-508Z/result.json` 另有 **8 条协议断言通过**（部分复核基础断言，不相加为 16 条独立能力）。主线程使用真实支持的 `features.shell_tool=false`、`unified_exec=false`、`multi_agent=false`、`tool_search=false` 等逐线程覆盖；主工具表变为 `update_plan/request_user_input/view_image/assistant_read_tasks`，对照 worker 保留自身执行工具。强行请求已关闭的 `shell`（空参数、无命令）时，原生明确返回 **`unsupported call: shell`**，没有 shell 客户端回调；这是拒绝证据，不是参数校验失败。

完整严格角色仍未放行：本轮使用空隔离 profile，未覆盖现有通用 MCP、其他模型/工具路径、冷恢复后的加固策略和原生跨线程越权负测。`tools.view_image=false` 被接受但没有移除该工具，进一步证明必须检验实际效果。worker 第一版也应关闭原生跨线程派发，维持唯一托管执行的范围。

本轮测试 `agentMessage.phase=null`，仅证明测试正文和原生 completed，**没有证明产品要求的明确 final 捕获**。未执行真实命令、文件写入或 MCP 行为。两次成功 run 分别保存文件哈希与进程/fixture 清理记录，先前失败也完整保留。

## D1–D4：可开发的最小批次

| 批次 | 修改范围 | 完成条件 |
| --- | --- | --- |
| D1 可信协调入口 | 既有 Runtime 持久字段、来源绑定及 `item/tool/call` 处理器 | 仅实际主助手的真实用户来源能派发/停止；内部摘要只能读；未绑定、冲突或越权均拒绝 |
| D2 主会话队列 | 既有 durable 队列与托管线程入口约束 | 用户消息和内部回传逐条串行；直接 RPC、普通发送、计划续办等不能绕过契约；队列 completed 不算摘要 finished |
| D3 外发与恢复 | 既有 Runtime 每段首次发送权、停止意图及冷启动入口 | thread/start、turn/start、interrupt 每次先落原子门闩；未知占槽只对账；晚到真实 ID 兑现首次停止，禁止盲目重发 |
| D4 两记录与宿主互斥 | assistant / assistant_task、两个槽位 CAS、宿主生命周期排他所有权 | 同 Runtime 不同端口不能双写自动执行；结果与冻结回传同事务；同一主助手只有一条未结清自动回传 |

批次是依赖顺序，不是四套架构。继续复用 Runtime/SQLite/队列/审批/投影，不新增调度器、后台发送器、第三协调表或多实例接管。P0-A 未证明严格角色前，不开始自动派发产品实现。

D1 入站先核验受控 App Server 连接、`assistant.mainThreadId` 和当前 main Runtime 请求的精确实际 turn，再读取可信来源。派发仅接受真实用户来源，之后按来源幂等受理 task；新派发时 worker task 尚不存在。读接受可信用户或内部来源，停仅接受真实用户来源，两者再核验目标 task 的助手归属和操作条件，不能要求工具调用的主 turn 等于 worker turn。捕获结果只核对原 worker turn，摘要完成只核对原主摘要 turn。身份未绑定或冲突时拒绝。

## P0-B：新增代码后的实现验收

此层在 D1–D4 实现后执行，不能作为“写代码前已具备”的条件：

- 同来源重复受理、不同契约冲突、内部摘要/worker 冒充主助手、动态请求早于 turn 绑定。
- 主会话忙碌、队列失败头、回传已受理但未完成、原生 queue 交接及未知实际 turn。
- 每段 RPC 前后断点；派发和重启恢复并发；无 threadId 的未知创建不得重复创建。
- 停止先于 ID 到达；已外发未知 interrupt 不重发；本地 stopped、陈旧快照或 inProgress=false 不放行替代执行。
- 单槽争用与跨宿主争用；原恢复重用槽位；A 回传未知时 B 只落盘；重启/迟到材料不改冻结 payload/hash。

通过后才做只读业务端到端，再验证受授权写任务。构建、schema、模拟夹具和静态审计分别记录，均不能替代真实 CX-Codex 功能验收。

## 本轮材料

原始证据与 Hermes 最小输入包：[p0-protocol](../output/hermes-cxcodex-learning-20261013/p0-protocol/)。细项见 `native-identity.json`、`dispatch-audit.md`、`role-protocol-audit.md` 与 `offline`。

本轮 Hermes 学习任务首次在启动前被自动审批拒绝：审查要求明确允许审计/方案材料送至已配置的外部模型渠道。用户随后明确允许本轮最小审计包经 workbuddy-newapi / deepseek-flash 处理；关闭自动 SOUL/AGENTS/记忆注入后继续。会话 `20261013_190741_7931d4` 的学习及同会话定向修订均实际退出 0；Codex 复核后纠正了主/worker 来源绑定、逐 turn 权限推导和模型联网声明三项问题，并同步本方案。

首次学习还额外读取了相关正式/当前源码和探针记录，未完全遵守最小输入约定；定向修订的 4 次工具调用只读取和修改交付文件。没有观察到凭据读取；执行轨迹与文件校验分别记录，不能把提示词当作路径隔离，也不将这次监督修订称为独立自主验收。见 [监督报告](../output/hermes-cxcodex-learning-20261013/p0-protocol/supervision-report.md)。本轮未改已安装技能、模型渠道、SOUL、产品代码或生产服务。
