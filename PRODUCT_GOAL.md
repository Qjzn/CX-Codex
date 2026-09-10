# CX-Codex 稳态产品化目标

状态：执行中
目标类型：有限、可验证的产品化目标，而不是无限增加功能
适用范围：Windows / Windows Server 自托管服务、浏览器端、Android 壳与 7420 桥接链路

## 北极星

把 CX-Codex 做成一个轻量、低风险、长久稳定、简约实用、交互平滑的 Codex 任务控制层。它服务于已经在本机运行 Codex、希望从浏览器或 Android 安全接续任务的个人开发者和高级用户，不替代 Codex Runtime，也不扩张成通用 IDE 或多人 SaaS。

用户应当能够在五分钟内完成首次安装并进入可工作的页面；发送消息后立即看到可信反馈；经历断网、锁屏、页面恢复或 7420 重启后，任务和消息最终收敛到唯一正确状态；默认配置不把主机暴露在不必要的高权限风险中。

## 当前进度

- 2026-09-10 用户授权替换7420后：上一批回复质量与计划/目标/队列核心修正已进入真实本地7420；空闲切换保留数据库、认证和旧部署。真实Web新任务5轮、附件读取、排队接续、原生计划按钮及暂停目标编辑/清除通过，刷新不丢结果；随后修复附件两种路径写法的重复标签，以及partial搜索提示意外隐藏已有结果的模板分支，新增9项真实模板回归，Web-only更新且保留旧哈希资源。证据见 `output/local-deploy-20260910-core/report.md`、`tests.md`；偶发历史RPC慢读、自然目标完成、定时任务、设备/公网/长期门禁仍未关闭，无Git或正式发布。

- 2026-09-09 至 09-10 核心功能候选：针对计划协议与呈现、目标通知/请求竞态、消息队列重排/取消/持久化FIFO、后台RPC占位及完成耗时显示补齐定向验证。目标实测整秒时间戳、队列真实四轮与浏览器刷新结果揭示的问题按证据修正；`npm run verify:core-flows` 的65项通过。修正原生计划参数和完成状态后，真实Web按钮确认执行、刷新保留提交状态也通过。精确结果及未验证的目标自然达成、定时任务、生产/设备/发布边界以 `output/core-flow-20260909/report.md` 及 `tests.md` 为准，不以候选单样本关闭整体门禁。本批不替换7420，不提交/推送/发布；隔离测试服务已关闭。

- 2026-09-09 回复质量第一批（仅本地候选）：修正侧栏漏项导致当前完成回复被清理、附件封装泄漏/本地图片空地址，并补齐标题/列表与会话暗色表面；接通基于实际可见 DOM 的消息反馈指标，已完成里程碑不再重复读取布局。公开状态/投影回归、图片URL与DOM计时定向测试、前端构建和隔离浏览器三宽度复核通过；证据见 `tests.md` 同日“回复呈现质量”章节。本次不替换7420、不关闭真实发送延迟、长时间恢复、设备和发布门禁；后台RPC拥堵与首屏包体预算仍待后续处理。

- 2026-09-09 增量推进（仅本地候选）：修正会话创建误判执行、发送过程误判排队、旧 Runtime 覆盖新轮状态，以及双 UUID 日志分片身份/旧路径恢复问题。新增发送状态和日志身份回归；桌面/手机尺寸七状态浏览器夹具通过。精确范围和可重复命令见 `tests.md` 的同日章节。真实端到端延迟、手机锁屏恢复、生产部署和发布门禁未因此关闭；不改变运行所有权或产品路线。

- 当前本地候选：源码与本机 7420 已使用 2.8.0 候选身份，公开稳定版仍为 v2.7.6。Tailwind 扫描已限制到 `src`，构建标识不再读取 cwd 或 Git worktree 名；带外部伪类探针的连续构建得到 136/136 文件逐项 SHA-256 一致。候选先通过隔离 17434 H5，再原子更新生产 7420；配置、认证、Runtime 流、CLI 与前端入口保持一致，v2.7.6 完整回滚安装保存在 `C:\Users\SW\AppData\Local\CX-Codex.rollback-pre-2.8.0-20260808-1600`。本轮没有提交、推送、生成 Release package 或发布。
- M0 基线与护栏：已完成。目标章程、仓库入口和治理门禁已建立，并通过 `npm.cmd run verify:governance`。
- M1 安全与信任：执行中。代码内安全默认值、文件边界、非回环认证和诊断脱敏已验证；Skills 私有 Git 同步已移除命令参数和 `.git/config` 中的令牌，改用单次网络子进程环境凭据并禁用 hooks。Git 与 `rg` 均解析为绝对路径，Skills、Worktree、Rollback 和文件枚举不会执行用户工作树里的同名程序。Windows OAuth 状态改用系统 DPAPI `CurrentUser` 加密并迁移旧明文，Linux/macOS 文件强制为 `0600`；隔离候选已真实完成合成旧状态迁移与再次解密，本机旧式 credential-bearing origin 也已在不联网、不修改 OAuth 状态的条件下清理。公开回归夹具和测试证据中的本机用户名、真实工作目录及个人文件名已改为稳定示例并加入治理门禁。完整锁文件经 npm 10 与官方 registry 审计为 0 漏洞，CI/Release 已增加低等级起即失败的审计门禁，本地 PDF 预览保持 legacy Canvas 管线并以 header/meta CSP 禁止非同源脚本。2026-08-27 已启用 `main` 分支保护、Dependabot alerts/security updates、私密漏洞报告与 CodeQL 默认扫描；常规 Dependabot 更新改投 `beta`。历史 Google API Key 已从当前及候选源码移除，但 GitHub alert #1 的有效性仍为 unknown，凭据所有者尚未提供撤销或限制证据，因此 M1 继续保持未完成。详见 `docs/github-security-baseline-20260808.zh-CN.md`。
- M2 状态绝对正确：执行中。在不依赖 GitHub 外部授权的本地链路上，已修复事件流代际重置、App Server 传输结果不确定、双页面 outbox 覆盖、旧轮次终态清除当前轮次，以及服务进程冷启动丢失已接受 `pending_start` 的问题。浏览器按消息日志合并并用删除墓碑防止旧页面复活消息，日志按消息压缩并设置硬上限；服务端仅自动恢复正文哈希一致且尚未进入 `starting` 的请求，进入 RPC 前即清除临时正文，避免重复发送和长期保留。消息签名、持久 `clientMessageId`、重放分页、序列缺口、排队接管与 SQLite 重启故障注入矩阵已通过；Android 定向单元测试与 lint 已通过，但真机生命周期与完整端到端故障矩阵仍待收敛。
- M3 性能与流畅：本地浏览器门槛已通过，在不放宽 M1/M2 门槛的前提下继续保持回归。已有/新会话发送反馈预算为 100 ms；1602 条消息的明/暗色全量回归分别挂载 13 个节点，最大心跳延迟为 62/60 ms。本机更新后的生产 7420 再次通过 1602 条消息手机流式压力回归，挂载 13 个节点、119 次更新期间最大心跳延迟为 64 ms。缓存首屏为 162 ms，前台恢复 6 个样本的 P95 为 100 ms；启动链路只发生一次早期 `thread/read`。归档列表的 stale-while-revalidate 已修复：后台扫描仍可耗时 8.5 秒，但刷新窗口内连续两次真实 HTTP 读取只需 7/8 ms，不再让第二个用户请求等待后台 Promise；集成门禁要求跟随读不超过 1.5 秒。首屏按每次任务选择独立计时并区分本地缓存、内存与网络来源，恢复样本保存最近 7 天最多 50 个且不含正文。
- M4 简约体验：本地浏览器审查已通过并保持执行中。README 已把 Windows 2–5 分钟安装、默认入口和失败后的最小诊断提前到首屏；当前公开 v2.7.6 在独立环境中从冷安装开始到 `ok/started/healthReady` 实测为 108.1 秒，并在官方卸载后关闭测试端口、保留真实认证。浅色/深色、1440 桌面、884 折叠屏、393 手机与 852 横屏全量回归通过；本机更新后的生产 7420 又完成 38 个页面/状态、42 张截图的 H5 回归，非禁用辅助文字最低对比度为 4.54。首页 H5 门禁会把模型面板逐项对照实时 `model/list`，不再用静态夹具替代模型目录可用性。主内容、桌面会话导航和宽度调节器已有唯一中文可访问名称，跳转焦点与强制颜色轮廓通过独立 Headless Playwright；独立浏览器复核确认桌面首页与手机诊断页均只有一个主地标、无横向溢出、无页面错误或残留骨架屏。真实 Windows 高对比度、屏幕阅读器和 Android 真机仍属于独立设备门槛。
- M5 可维护交付：执行中。Windows 隔离产品化 smoke 已覆盖安装、保留/完全卸载、失败 JSON、启动健康、进程树清理与能力不匹配；公开且带 SHA-256 的正式 v2.7.4 已在隔离目录和 17431 端口真实启动，保持旧服务运行升级到 v2.7.6 后旧 PID 与三进程树退出、新 PID 健康接管、`.previous` 保留 v2.7.4，未知配置字段与主机端口保持不变。随后以无效工作区文件触发安装失败，bootstrap 返回 `BOOTSTRAP_FAILED/run_installer`、隔离失败候选并自动恢复健康的 v2.7.6。当前 `codex-cli 0.130.0` 的 schema 四组完整差异集合与 2026-07-04 基线审计一致，release verifier 已以 warn 模式完成。零容忍浸泡门禁同时检查 App Server 就绪、PID 稳定、Runtime 流代际稳定、健康/回放流 ID 一致、事件序列和全部队列/超时状态；绝对命令路径修复后的冻结候选已通过 121 秒预检及唯一 7201 秒正式浸泡，480/480 样本通过且所有异常计数、failure 数组和 runner stderr 均为 0。Release ZIP 现强制包含 README 已链接的本目标文档，完整 package smoke 通过；验证包已在本机原子替换生产 7420，配置、认证与 Runtime 流代际保持不变，旧安装保留为可恢复目录。Android 真机矩阵仍未完成，提交、发布或部署仍需用户明确授权。

## 强制子目标：M4-C 会话设计重建

状态：本地候选验证中；真实 7420 与 Android 未完成，未通过前 M4 与总目标不得标记完成。

本子目标把用户所称的 `seam-core` 校正并固定为实际参考仓库 [`midea-ai/sema-code-core`](https://github.com/midea-ai/sema-code-core)，参考基线固定为提交 [`f564e8d930053becdd5c31fe53f65fd863b6f283`](https://github.com/midea-ai/sema-code-core/tree/f564e8d930053becdd5c31fe53f65fd863b6f283)。会话事件类型、turn 投影、活动归并、执行中/完成态转换、真实耗时、文件变更摘要和最终回复选择必须逐项对照该固定源码留下映射证据；不能只模仿截图、颜色或间距后宣称完成。

在会话设计范围内，必须执行“替换，不叠加”：

- 禁止把 7420 原有扁平 `UiMessage[]`、阶段回复计数、最后一条助手文本、`Worked for` 文本、命令耗时累计或尾部过程浮层作为新会话语义的来源、兼容层或回退路径。
- 禁止继续丢弃 `fileChange`、MCP、Web Search、tool、permission、plan 等构成可观察执行过程的结构事件；内部 reasoning 不展示思维链，但不得因此连带丢失可安全呈现的活动元数据。
- 禁止在旧 `ThreadConversation.vue` 分支上继续增加条件判断来伪造 turn、final、elapsed 或 file summary；新 UI 只能消费新会话投影 module 的输出。
- 禁止保留可在运行时切回旧会话渲染的长期 feature flag、双写、双读或双套测试。需要回滚时整体恢复改造前版本，不在产品中混合两套语义。
- 允许复用且必须保护的只有与会话呈现语义无关的基础设施：App Server/Runtime Store 权威状态、`clientMessageId`、durable outbox、队列、审批执行、事件序列与重放、快照恢复、鉴权、工作区边界、虚拟化能力和 Android 生命周期。这些基础设施只能向新投影提供事实，不能把旧 UI 推断规则带入新 module。
- UI、交互和动画同样优先参考固定提交中的 `ChatView.tsx`、`Blocks.tsx`、`Composer.tsx`、`common/ui.tsx` 与 `index.css`：使用紧凑轮次分隔、运行中展开、完成后收拢、平面活动行、可见文件摘要、轻量输入区和状态反馈；不得用每轮重复头像/状态头、卡片堆叠、持续装饰动画或复杂布局动效制造“像 Sema”的表象。
- 一切视觉调整必须服务于轻量、稳定、高效和可扫读；不引入新的重型 UI 依赖，不复制 Sema 固定多栏移动布局，不以装饰性重设计牺牲 7420 已验证的移动、恢复、性能与可访问性基础设施。长期细则见 [`DESIGN.md`](DESIGN.md)。

完成门槛：

1. 建立单一、纯计算、可独立测试的会话投影 module；其小型 interface 从权威 thread/turn/item、Runtime 状态和交互等待区间生成 `ConversationTurn[]`，并一次性给出审批/补充输入/MCP 交互的类型、标题、摘要、问题、授权地址和响应身份；UI 不得读取原始 request method/params 或再次猜测轮次与交互语义。
2. 运行中 turn 展示可观察活动和稳定执行耗时；完成 turn 默认收拢中间活动，只保留最终回复、文件变更摘要及尚需用户处理的审批/错误。
3. `final` 必须来自明确协议阶段或可审计映射；没有 final 时明确显示中断、失败或未产生最终回复，不能用最后一条 commentary 顶替。
4. 文件变更必须保留路径、类型、增删统计和按需差异入口；命令、MCP、搜索、计划和子任务按 Sema 语义形成结构活动，不把原始 JSON 当普通正文。
5. 新投影 interface 的行为测试覆盖实时流、刷新快照、重放、权限等待、失败、中断、重复文本、文件变更和长会话；同一事实在实时与恢复路径产生相同投影。
6. 删除被替代的旧会话归并/推断实现和对应实现细节测试；通过静态门禁证明禁止标识与旧回退分支没有重新进入生产路径。
7. 完成桌面、手机、折叠屏、长会话和真实 7420 会话回归，且不降低 M1/M2 的安全与状态正确性门槛。
8. 视觉回归必须证明每轮只有一个 Sema 式耗时/过程分隔，运行反馈与完成收拢可区分；没有真实计时且没有过程入口时只保留分隔线，不显示“执行耗时不可用”等无行动价值文案。文件变更默认只显示紧凑摘要，路径、统计和差异由用户按需展开；回到底部控件不遮挡正文，正常与 reduced-motion 均可用，手机和粗指针折叠屏独立操作目标不低于 44px。普通终态没有显式 final 时保持视觉静默，不显示无行动价值的占位提示；失败、中断和停止仍必须可见。
9. Composer 必须按固定 Sema `Composer.tsx` 收敛为与 `48rem` 会话阅读列同轴的轻量双层输入区；默认只保留 `12px` 轻边框且无浮卡阴影，聚焦使用一像素强调环。现有附件、模型/质量/速度、IME、队列、听写和移动端模态保护可保留，但不得借此恢复 7420 原有重卡片层级或另建会话语义。

执行计划、源码参考地图、任务包、验收和停止条件见 [`docs/PRD-CX-Codex-Quiet-Workbench.md`](docs/PRD-CX-Codex-Quiet-Workbench.md)。

## 当前剩余门槛

- M4-C 会话重建已进入当前真实 7420：新会话投影、结构事件保真、Sema turn UI、精确 final、文件摘要、真实轮次耗时与旧语义静态禁用均已进入源码；`ThreadConversation.vue` 已不再接收或解析原始 `UiServerRequest`，所有待审批、用户输入、MCP 授权/批准与不支持工具状态均由纯投影输出，待处理交互即使遇到滞后的 `running` Runtime 状态也会保持轮次为 `waiting` 并停止累计执行耗时。纯计算验证、类型/构建/模块门禁以及独立桌面、手机和 884 x 1104 折叠屏浏览器回归通过。最新 UI/交互/动效复核保持每轮单一 divider、0 个旧 Codex 轮次头、完成过程默认收拢、活动过程保持展开；文件变更默认压缩为 46-48px 摘要，文件行只在用户展开后出现，普通缺失 final 不再生成占位提示，终态 final 不再保留闪烁光标，没有真实计时且没有过程入口时也不显示“执行耗时不可用”。正常 disclosure 为 180 ms，reduced-motion 为 1 ms 且持续运行动画停止，手机和粗指针折叠屏最小操作目标均为 44px、横向溢出为 0。Composer 专项回归进一步证明桌面与 884 x 1104 粗指针折叠屏的可见 shell 均为 768px，三种视口保持输入在上/控制条在下、12px 圆角、无默认阴影和零横向溢出；桌面最小控件高度 32px，手机/折叠屏为 44px，聚焦后一像素强调环可见。只读隔离候选还以当前真实 session JSONL 验证了 spectator 路径：App Server 返回 `thread not loaded` 时按精确 UUID 定位 session，不执行 resume；隐藏内部续跑请求只保留 `turn_id` 边界，event/response 镜像只按同轮、同 phase、同正文去重，`patch_apply_end` 恢复为结构化文件摘要。1600 条活动在模型中完整保留、DOM 有界挂载，当前 7420 Web 流式窗口完成 68 次更新与 65 次心跳，`maxLagMs=11`、`maxLongTaskMs=0`，操作按钮仍响应。静态候选已可回滚切换到当前 7420（首页 SHA-256 `72F7302FAB455F048E5D08101192284F24CCDCEA6008B8E8171C33B0586BFFFD`；最近备份 `E:\javaword\CXCodex\codexui-sidebar-shortcuts\dist.web-previous-20260831-085628`），真实目标 thread、fixture、Composer、合同视图、Shell、Sidebar 与 hardening 的桌面/手机/折叠屏回归均通过，0 多-final、0 无效耗时提示、0 内部上下文泄漏、0 旧尾部浮层、0 浏览器错误和 0 横向溢出。缓存首屏后端修复已在隔离候选对真实 thread 通过 `source=local-cache`、`selectionLatencyMs=283` 的严格 300ms 门槛；当前生产 Bridge 尚未为该后端修复重启，在当前目标执行期间不得用强制重启换取回归通过，因此生产 7420 的同项严格缓存首屏仍是剩余 Web 门槛。Android 真机、物理折叠屏与 Windows 环境专项按用户要求不作为本阶段门禁，仍保留为更广产品/设备目标的独立证据缺口。
- M4-C 最新本地交互补强已覆盖 `approval`、`user-input`、`mcp-input`、`mcp-approval` 与 `unsupported-tool` 五类投影：MCP 持久化按钮只由 `_meta.persist` 的 `session` / `always` 能力产生，工具身份和有界关键参数在批准前可见；URL 授权不显示无关自由文本框，用户问题在显式作答前禁止提交。隔离浏览器实际点击已验证两种 MCP 持久化回包及多答案回包；桌面、393 x 852 手机、884 x 1104 粗指针折叠屏继续保持 0 横向溢出，手机/折叠屏最小触控目标 44px。1600 条活动压力轮只挂载 18 条，69 次更新、66 次心跳的窗口内 `maxLongTaskMs = 0`、最大排队延迟 79ms、操作仍响应。证据在 `output/regression-7420/conversation-sema-all-interactions-20260830`；仍不代表生产 7420 或 Android 真机通过。
- M4-C 旧实现清零审计已完成一轮本地收口：原 `src/composables/conversationProjection.ts` 及其计划确认、实时助手副本、文本阶段归并等无生产调用的实现细节测试已删除；浏览器扁平缓存进一步缩减为 `threadMessageCache.ts` 中已确认的用户消息身份，只服务 outbox/弱网发送去重，助手正文、phase、命令、计划、final、耗时和活动数据均不得进入，也不能选择 turn 或执行状态。缓存版本升为 v4，旧全消息缓存不会继续载入。`ConversationRegressionFixture.vue` 也不再用 `UiMessage[]` / `agentMessage.live` 重建旧投影，而是直接输入结构化 App Server item 和 `localUserMessages`。静态门禁、类型/前端构建、frontend normalizers、conversation transcript、governance 与 `git diff --check` 通过；393 x 852 Headless Playwright 验证唯一显式 final、结构活动、文件摘要、五类交互、完成态展开、零页面错误和零横向溢出，1600 项压力轮挂载 18 项、801 轮长会话挂载 10 轮。截图在 `output/codex-app-parity/structured-fixture-20260830/structured-fixture-phone.png`。这只关闭本地旧实现/测试清零缺口，不替代真实 7420、Android、物理折叠屏或 Windows 辅助技术门槛。
- M4-C 逐项完成审计又发现文档截图夹具仍以 `UiMessage[]` 和 role/turnIndex 适配器把全部 assistant 强制解释为 `final_answer`；这虽不进入生产运行态，仍会形成目标禁止的第二套测试语义并掩盖 final 错误。现在 `DocumentationShowcaseFixture.vue` 直接输入结构化 turn/item，源码门禁同时禁止 `UiMessage`、`message.role` 和 `message.turnIndex` 回流。失败优先门禁、frontend source-only 与 `build:frontend` 通过；393 x 852 Headless Playwright 得到 2 turn、2 user、2 个协议明确 final、0 missing-final、0 页面错误和 0 横向溢出，截图位于 `output/codex-app-parity/documentation-structured-fixture-20260830/docs-showcase-phone.png`。本轮只读生产核对显示 7420 健康、App Server 已初始化、RPC/服务请求/不确定请求均为 0，但目标当前 turn 仍使 `restartProtection.blockingRequestCount=1`；安装版 `dist/index.html` SHA-256 仍为 `C00C1ED84E6A7AFA5E71F6D07506F9F4FF82DA3A1CF1E57C650096C671E8B577`，没有执行生产切换。
- M4-C 网关归一化审计进一步删除了最后一条本地扁平助手会话旁路：`normalizeThreadMessagesV2` 原本会把结构化 assistant、plan、image、command 和 unknown item 再解释成 `UiMessage[]`，并把非 commentary 的 agentMessage 一律推断为 final；即使渲染层已不消费它，这仍是目标禁止的第二语义模型。现在网关、详情、运行快照和回滚只携带 `acknowledgedUserMessages` 作为 outbox 送达证据，结构化响应继续原样交给唯一 `ConversationProjection`；源码门禁禁止恢复旧 normalizer、助手/计划/命令扁平化或泛化 `messages` 契约。失败优先门禁、frontend source-only、frontend normalizers 与 `build:frontend` 通过，主应用 JS 从 443.50 kB 降至 439.77 kB（minified）。393 x 852 Headless Playwright 复核文档夹具 2 turn/2 user/2 explicit final，以及会话夹具 14 turn/7 user/1 explicit final/1 commentary/1 file summary/5 requests；两者均为 0 legacy overlay、0 页面错误、0 横向溢出，截图位于 `output/codex-app-parity/user-only-normalizer-20260830`。该轮本地候选 `dist/index.html` SHA-256 为 `22CEC5E27EE045C769E1AF433C77CDE92784EF3ED796C3B2E38353C2FA47AB1B`，与安装版不同；该证据只关闭本地第二语义缺口，不替代生产 7420、Android、物理折叠屏或 Windows 辅助技术验证。
- M4-C 送达证据类型边界已完成替换：此前 normalizer 和缓存虽只在运行时保留 userMessage，TypeScript 契约仍沿用可承载 assistant、system、phase、raw payload、plan 与 command 的宽泛 `UiMessage`，留下未来误接旧语义的编译期入口。失败优先源码门禁确认该缺口后，先以专用 `AcknowledgedUserMessage` 收窄服务端确认态；继续检查又证明剩余 `UiMessage` 引用只用于乐观发送/失败恢复，因此将其整体替换为 user-only `OptimisticUserMessage`，并删除已经无调用的 `UiMessage`、`UiPlan` 与 `CommandExecutionData`。网关详情、运行快照、回滚、内存缓存、浏览器 v4 缓存、消息签名和失败托盘现在都无法承载助手会话语义；源码门禁扫描整个 `src` 防止旧类型回流。frontend source-only、frontend normalizers、`vue-tsc --noEmit` 和 `build:frontend` 通过，主应用 JS 为 439.58 kB（minified）。393 x 852 Headless Playwright 复核 14 个投影 turn、1 个显式 final、0 旧 Runtime bar、0 横向溢出，并在独立失败发送夹具展开 1 条 user-only 未发送消息，页面错误为 0；截图位于 `output/codex-app-parity/user-delivery-types-20260830/detached-failure-phone.png`。最新本地候选 `dist/index.html` SHA-256 为 `893AEDCEFBF76C32C8E68EDED085A1B9E5978A0DA69F45FB85F6551110939295`；该加固不替代生产或设备验证。
- UX-00 设计契约与回归基线本地候选已完成：`DESIGN.md` 固定 `midea-ai/sema-code-core@f564e8d930053becdd5c31fe53f65fd863b6f283` 源码映射和“替换，不叠加”边界，明确禁止恢复 7420 原有会话语义。固化 `contract` 浏览器门禁覆盖 1440×900、884×1104、768×1024、393×852、852×393 五视口的首页、运行、完成、等待输入四状态，共 20 张状态截图和一份结构化报告；每个视口主地标、显式 final、未作答选择器与零横向溢出断言均通过，独立 Headless Playwright 手机截图已复核。证据在 `output/regression-7420/ux00-contract-baseline-20260830`；历史改造前截图仍单独保留，本结果只关闭本地 UX-00，不关闭生产、Android、系统辅助技术或总目标。
- UX-10 Quiet Shell 本地候选已按固定 Sema 源码完成：桌面默认侧栏 288px、单行 Header 44px，Header 与 Composer 可见边框同为 768px 且轴线偏差为 0；保存的 340px 偏好保持，缺失偏好不再被 `Number(null)` 错误压到最小宽度。状态文案变长不移动标题或主轴，393 x 852 手机与 852 x 393 横屏无固定侧栏、遮挡或横向溢出，明暗主题用户消息对比正常。固化 CDP 与独立 Headless Playwright 截图在 `output/regression-7420/quiet-shell-20260830` 和 `output/regression-7420/quiet-shell-playwright-20260830`；这只关闭 PRD 的本地 UX-10 任务包，不关闭真实 7420、Android 或总目标。
- UX-20 Sidebar 信息架构本地候选已完成：`新会话` 独占第一行，搜索/工作台/工具收敛为第二行；项目树、搜索状态机、折叠、置顶、菜单和事件继续使用现有可靠数据路径，没有建立新的会话或 Sidebar 状态模型。有意的 pinned shortcut 保持为置顶区一次、项目内一次，等待任务继续显示文字状态。聚焦手机夹具通过 stale-search、查询连续性、菜单、新建任务、后台重排锚点和隐藏当前任务定位；首项目位于可视区顶部时的锚点边界已修复，项目上浮前后相对顶部均为 7.046875px。默认/保存宽度、明暗主题、手机触控密度及零横向溢出由 CDP 验证，独立 Headless Playwright 桌面截图也已复核；证据在 `output/regression-7420/quiet-sidebar-20260830`、`output/regression-7420/quiet-sidebar-regression-20260830` 和 `output/regression-7420/quiet-sidebar-playwright-20260830`。该结论只关闭本地 UX-20，不关闭真实 7420、Android 或总目标。
- UX-40 Compact Composer 本地候选已完成：输入壳按固定 Sema 视觉轴收敛为 48rem 同轴、12px 轻边框和无默认阴影，桌面、393×852 手机与 884×1104 粗指针折叠屏无控件重叠或横向溢出，手机/折叠屏最小触控目标 44px。五行自然增长、二十行 128px 封顶、清空回缩和半屏展开通过；IME composing/229 不提交，语音只写入可编辑 draft，桌面与手机 Enter 规则、附件/Runtime 面板的非模态/模态环境所有权和 12.8-12.9ms 本地反馈均经真实浏览器断言。审计补齐了此前只有底层 API、没有界面入口的队列重排：上下移动作只在全部已持久化、同一所有者、未处理且首条未失败时可达，393×852 下移反转和上移恢复均通过，按钮 44×44、零溢出；编辑、删除、Steer/引用与首失败暂停继续复用原队列所有权。证据在 `output/regression-7420/quiet-composer-audit-20260830`；该结论不关闭生产 7420、Android、Git、Release 或总目标。
- UX-60 响应式、主题与可访问性硬化本地候选已完成：固定 Sema 层级继续作为视觉约束，没有新增卡片、导航或状态所有者；1440×900、884×1104、768×1024、393×852、852×393 五视口的浅色/深色组合均为零横向溢出，主地标、导航和可见控件都有名称，抽样必要文字达到 WCAG AA，状态不只靠颜色。粗指针菜单和 6px 侧栏调宽轨具有 44px 有效命中区；forced-colors 的真实键盘焦点轮廓、reduced-motion 无持续动画、手机抽屉背景 inert/滚动锁/双向焦点闭环/关闭后焦点归还均通过。CDP 与独立 Headless Playwright 证据在 `output/regression-7420/ux60-hardening-20260830` 和 `output/regression-7420/ux60-final-20260830` 并已目视复核；这不替代真实 Windows 高对比度、系统屏幕阅读器、Android、生产 7420、Git 或 Release 门禁。
- 2.8.0 本机生产 H5 已通过：首页实时 7 个模型与 `model/list` 一致；随后 38 个页面/状态、42 张截图的完整回归全部通过，产品可用时间 2511 ms、浏览器观测 5149 ms，最低对比度 4.54。1602 条消息的手机流式压力场景仅挂载 13 个节点，119 次更新期间最大心跳延迟为 70 ms，低于 80 ms 门槛。它消除了本地候选与公开 v2.7.6 同号、以及临时目录污染前端构建的问题，但不等同于发布包、公开升级或跨设备完成。
- 本地门槛已收口：两小时严格浸泡与最终报告已回填；候选进程树已停止、17432 已释放、一次性测试辅助脚本已删除，原 Temp 候选目录也已确认不存在。完整 release verifier 与 package smoke 已通过，验证包已更新到 `C:\Users\SW\AppData\Local\CX-Codex`；最新生产进程健康，配置、认证哈希和 Runtime 流代际不变，无失败候选残留，归档缓存修复前的精确安装保留在 `C:\Users\SW\AppData\Local\CX-Codex.rollback-cache-fix-20260808-1113`。生产 7420 的 38 场景 H5 全量回归、最新首页冒烟、独立桌面/手机浏览器复核和侧栏数据一致性检查全部通过。
- 需要用户授权后才能完成：提交、推送、PR、正式 Release 或远端部署，以及任何 GitHub 安全设置和历史凭据告警处置。本轮仅更新本机运行版本，没有执行上述外部写入；仓库规则仍禁止把本地验证包或脏工作树证据描述为已发布版本。
- 需要凭据所有者：主分支保护、Dependabot alerts/security updates、私密漏洞报告和 CodeQL 已启用；剩余外部安全阻塞仅为历史 Google API Key 告警，需要在对应 Google Cloud / Firebase 项目确认撤销、轮换或严格限制后，才能在 GitHub 上选择准确 resolution。
- 需要设备：Android 授权真机完成进程回收、锁屏、Doze、网络切换、通知点击/去重与 410 x 502 手表矩阵；真实 Windows 高对比度和屏幕阅读器仍需独立系统级验证。代码、JVM、lint、浏览器仿真或截图不能替代这些证据。

- UX-25 Sema Conversation Transcript module 本地候选已完成：固定 Sema 提交的共享 reducer、turn 生命周期、结构活动、等待、文件累计和显式 final 语义已落入单一纯 `ConversationProjection`；实时、快照和乱序/重复 replay 逐字段一致，同文不同身份不合并。服务端仅保留 reasoning 的有界活动元数据并剥离原始思维链，session-log spectator 不 resume writer，隐藏续跑只保留 `turn_id`，镜像 final 与 `patch_apply_end` 分别按可审计规则去重和归属。终态缺少结束时间时保持计时语义不可用但不继续累计；若没有过程入口，视觉上只保留分隔线而不显示无行动价值文案；多个冲突 final 不猜测。1602 turns / 1600 activities 投影分别为 20.6ms / 5.6ms，module、server、normalizer、类型、前端/CLI 构建和 UTF-8 等价 governance 门禁通过；原 `output/regression-7420/ux25-transcript-20260830` 只保留为投影阶段历史证据，其无效耗时提示已被当前 Web 收口替代。这只关闭纯投影与协议保真的本地 UX-25，不关闭 UX-30、真实 7420、Android、系统辅助技术或总目标。
- UX-30 Turn-based Conversation 本地候选已完成：会话渲染层只消费 `ConversationProjection`，旧 `UiMessage` 收藏/计划包装已替换为窄类型意图；commentary 与投影 `activityGroups` 按原事件顺序呈现，活动轮次固定展开、完成轮次默认收起，显式 final、文件摘要和待处理交互保持独立层级。`sync-degraded` 恢复轮次现在保持 active、不可误折叠，1600 项恢复过程只挂载最近 18 项。静态门禁、投影/normalizer、前端类型与构建、UTF-8 等价源码门禁、桌面/手机/折叠屏 CDP、流式性能、reduced-motion 和独立 Playwright 截图均通过，证据在 `output/ux30-conversation`。这只关闭本地 UX-30，不关闭真实 7420、Android、系统辅助技术、远端 CI、部署、Release 或总目标。
- UX-30 长会话门禁已补强：审计确认原 1600 项浏览器夹具只证明单轮活动节点有界，不能证明 1602 条消息 DOM 上限。新渲染只在 `ConversationProjection.turns` 上复用允许保留的虚拟化基础设施，最多挂载 10 个 turn/20 条消息节点，并以动态测高、spacer、阅读锚点和 `overflow-anchor: none` 保持顶部/中段/尾部滚动；没有恢复任何旧 `UiMessage`、final、elapsed、folding 或尾部浮层逻辑。801 轮/1602 条消息在四个窗口均为 10/20，流式尾部 78 次更新、70 次心跳、最大排队延迟 29ms、`maxLongTaskMs=0`，点击后继续更新且横向溢出为 0；静态门禁禁止重新直接遍历全部 projected turns。CDP 和目视通过的独立 Headless Playwright 证据位于 `output/ux30-turn-virtualization-20260830`，仍不替代真实缓存首屏、生产 7420 或 Android 真机。
- Sema 结构活动补充审计已完成：App Server `collabAgentToolCall` 不再把 `spawnAgent` 等技术枚举直接显示给用户，而是在同一 `ConversationProjection` 中映射为创建、补充、继续、等待、结束协同子任务，并以 800 字符上限呈现任务摘要；没有新增卡片类型、状态模型、计时器或 7420 兼容分支。纯投影回归同时覆盖 MCP、Web Search、计划和协同活动；CDP 候选回归在 1440×900、393×852、884×1104 下验证可读标题与摘要、零横向溢出和移动端 44px 触控门槛，截图位于 `output/regression-7420/conversation-collaboration-20260830`。这仍是本地候选证据，不代表生产 7420、Android、Git、部署或 Release 完成。
- M4-C 完成态审计修复了真实刷新快照的状态缺口：App Server `ThreadItem` 中 `webSearch`、`plan`、`imageView`、review 与 `contextCompaction` 没有 item 级 status/时间字段，旧投影会在权威 turn 已 `completed` 时把这些结构活动恢复成“等待中”。现在只将 completed turn 中缺失状态而得到的 `pending` 活动收拢为 `completed`；协议明确给出的 `inProgress`、`failed`、`declined` 不被覆盖。纯投影失败用例、前端构建、normalizer 与三视口 CDP 门禁通过，展开完成轮次中的无状态 Web Search 明确显示“完成”；证据位于 `output/regression-7420/conversation-structural-settlement-20260830`。该结果仍不替代生产 7420、Android、系统辅助技术、Git、部署或 Release。
- M4-C 当前 schema 活动审计已补齐 `dynamicToolCall`、`imageGeneration` 与 `hookPrompt`：2026-08-28 的当前 CLI schema 审计把前两者定义为可观察工作项，把 `hookPrompt` 定义为内部上下文项；改造前它们都会落入含糊的“执行活动”兜底。现在动态工具以有界工具身份/命名空间呈现，图片生成只显示状态和保存路径，内部 hook、工具参数、content items、修订 prompt 与 base64 结果不进入投影。失败优先的纯投影用例、前端构建、normalizer、完整三视口 CDP 与独立 Headless Playwright 门禁通过；截图位于 `output/regression-7420/conversation-current-schema-20260830`。没有新增状态模型、重型依赖或 7420 旧逻辑回退；仍不替代生产 7420、Android、真实系统辅助技术、Git、部署或 Release。
- 当前生产只读诊断发现 `model/safetyBuffering/updated` 被误记为未知通知 3 次。当前 App Server live schema 明确给出 `threadId`、`turnId`、`model`、`fasterModel`、`reasons`、`showBufferingUi` 与 `useCases`；Codex.app `26.818.5229` 只在对应 turn 仍执行且 `showBufferingUi=true` 时将它作为 Composer 上方安全等待提示，而不是会话消息、活动或 final。7420 本轮只把该 method 纳入已知协议并固化“保持 turn running、投影零活动/零正文/零 final”的测试，不在缺少完整重试动作所有权时仿制 Banner 或丢弃重试；固定 Sema 仍是会话语义基线，也没有恢复 7420 旧推断。
- 当前 live `ServerNotification` schema 的 75 个官方 method 已重新逐项审计，修复了严格审批复核、外部 Agent 导入进度、项目变化、线程环境/项目/队列/设置/回退及 `turn/moderationMetadata` 共 10 个官方通知被误记为未知的问题；`thread/deleted` 继续由既有线程失效后缀规则覆盖。该修复只收紧诊断分类，既不把宿主元数据投影为 Sema 活动/正文/final，也不新增 UI、状态所有者或 7420 旧逻辑回退；纯投影另行断言 moderation metadata 不泄漏。当前 schema 对比为 `OfficialCount=75`、`UnknownOfficial=[]`，server module 与 conversation transcript smoke 已通过；仍不是生产切换、Android、系统辅助技术、Git、部署或 Release 证据。
- M4-C 回退与历史加载审计已移除最后一条可见操作旁路：较早历史锚点、回退目标、回退轮数及 worktree 回退提示现在全部来自同一 `ConversationProjection`，不再读取旧 `UiMessage[]` 的 `turnIndex` 或正文。`thread/rollback` 的结构化响应会原子替换已保留的 `threadRead` 页面并清除回退前通知，再触发权威刷新；最近窗口从第 10 轮开始时，新实时 turn 现在正确编号为 12，而不是按窗口长度误编号为 2。纯投影失败用例、frontend source-only、前端类型/构建与 393×852 Headless Playwright 两步确认通过，截图位于 `output/codex-app-parity/sema-rollback-confirmation-phone-20260830.png`。当前候选 `dist/index.html` SHA-256 为 `982C4AF936F9C296E3BC496F3E2BAD3B539CB31250A80F2F8870AB6FB6D64BDE`，生产安装仍为 `C00C1ED84E6A7AFA5E71F6D07506F9F4FF82DA3A1CF1E57C650096C671E8B577`，二者明确不同。该证据不代表真实 7420 回退、Android、Git、部署或 Release 已完成。
- UX-50 Artifact Inspector 准入结论为 No-go：当前 inline 文件行、按需 diff/命令/计划详情没有证据表明至少两个高频任务被明显打断，低保真路径也不能证明右栏比 inline/modal 少一次以上上下文切换；四条准入必须同时成立。因此保持现有 inline/modal，不建设右栏、不新增权限、状态、持久化或移动固定栏。该 No-go 符合“先证明必要性、避免过度设计”，且不阻塞 Quiet Core。
- 2026-08-30 经用户明确授权，当前真实 7420 已完成 Web-only 候选切换：活动服务实际从 `E:\javaword\CXCodex\codexui-sidebar-shortcuts` 提供静态资源，因此只将其 `dist` 原子替换为当前候选，并保留 `dist.web-previous-20260830-224606` 作为可恢复备份；没有停止 Node/App Server，也没有中断本目标正在执行的 turn。7420 实际 HTTP 入口与候选 `dist/index.html` SHA-256 均为 `893AEDCEFBF76C32C8E68EDED085A1B9E5978A0DA69F45FB85F6551110939295`，入口引用的 5 个 JS/CSS 资源全部返回 200，`/health` 与 `/codex-api/health` 均为 `ok`。生产地址上的结构夹具通过 1440 x 900、393 x 852 与 884 x 1104 Web 回归；真实目标 thread 在三种宽度均保留 9 个明确 `final_answer`、每轮最多一个 final、一个活动 turn，且无旧尾部浮层、内部上下文泄漏、横向溢出或浏览器错误。真实会话门禁同时修正了两个测试器边界：先等待缓存首屏后的 historical final 收敛；没有可见 transcript 控件时不再把空集合误报为 0px 触控目标。本轮按用户要求明确排除 Android 与 Windows 环境专项，也没有重启/切换后端 CLI、提交、推送或 Release；因此它证明的是当前 7420 Web 候选，而不是 M5 或总目标全部完成。
- 随后的真实空闲切换已补齐后端运行证据：活动 `dist-cli/index.js` SHA-256 为 `75D53C41C582D114E4B53040E22C397060DF44366DAF05BDB2E240F61852B138`，旧 CLI 保留在 `dist-cli.sema-previous-20260830-230129`；一次性切换器只在不确定请求、重启保护、RPC、服务请求和 Plan turn 全部为 0 时执行，服务管理器返回成功，候选健康检查通过且未触发回滚。新 App Server PID 为 `78328`、启动时间为 `2026-08-30T15:11:26.861Z`，`model/safetyBuffering/updated` 不再计入未知通知。切换后的真实 7420 Web fixture 再次通过三视口、801 轮/1602 消息和 1600 活动回归；真实目标 thread 三视口均为每轮最多一个 explicit final、0 旧浮层、0 内部上下文泄漏、0 横向溢出、0 浏览器错误，截图位于 `output/codex-app-parity/production-7420-sema-20260830/backend-regression`。`/codex-api/state/thread/...` 同时证明运行时使用结构化 `thread.turns/items` 且没有旧 `messages` / `commandExecution` 属性。Android、Windows 环境专项、Git、推送和 Release 仍明确排除。

在以上门槛全部有权威证据前，M1、M2、M4、M5 与总目标保持未完成；外部项不因本地绕过、文档说明或测试替身而自动关闭。

## 决策优先级

发生冲突时严格按以下顺序取舍：

1. 安全与用户数据正确性。
2. 状态、消息和任务执行的一致性。
3. 安装、升级、恢复和故障诊断的可靠性。
4. 首屏、输入、滚动和页面切换的流畅度。
5. 简约、清晰、可访问的用户体验。
6. 新功能数量和外部传播价值。

任何低优先级收益都不能以降低更高优先级门槛为代价。不能为了让界面看起来正常而隐藏真实运行状态，不能为了增加能力而扩大默认权限或常驻依赖。

## 允许范围

- Windows 安装、卸载、升级、回滚、常驻运行和健康检查。
- UX-70 本地候选验证与文档收口已完成：PowerShell 7.5.5 驱动的 source-only 与完整 7420 浏览器矩阵在隔离候选 `127.0.0.1:17438` 通过，覆盖桌面、手机、884×1104 折叠屏、侧栏、Composer、五类首层交互、队列恢复、长会话、1600 活动流式压力和“返回最新消息”。801 轮/1602 条消息最多挂载 10 轮/20 条消息，离屏第 400 轮可定位，prepend 阅读锚点漂移 5.875px；会话列表稳定 ID 去重和跨游标重叠收敛由 server/sidebar 门禁固化。governance、frontend/CLI build、conversation transcript、frontend normalizers、server modules、sidebar data 与 `git diff --check` 均通过。该证据只关闭本地 UX-70，不改变 M4-C 未完成状态：当前生产 7420 未安装候选，Android 真机、物理折叠屏、系统辅助技术、远端 CI、Git、部署与 Release 仍待验证。

- M4-C 完成审计补齐了两处渲染层之外的旧语义残留：外部 session-log 安静窗口此前仍用“最后一条 assistant 且非 commentary”推断终态；停止按钮、陈旧运行态与持久化 running command 的恢复又把“running command 或最新 user 之后出现 assistant 文本”当作完成证据。现在两条路径统一读取同一个 `ConversationProjection` 最新 turn，且只以 `completed` / `failed` / `interrupted` / `stopped` 作为终态；queued、running、waiting 与 sync-degraded 均不得收敛或清除执行态，等待交互和 fresh active Runtime 仍保持非终态。normalizer 测试覆盖全部终态/非终态，源码门禁禁止 `latestAssistant`、`message.phase`、两个 assistant-order helper 和旧 message-evidence helper 回流，frontend build 与 source-only 门禁通过。该修复改变的是前端旧残留运行态的恢复判据，不改变 Runtime 协议/存储、队列、outbox、审批或通知所有权，也不替代生产 7420 与 Android 真机验证。

- 7420 HTTP、WebSocket、SSE、App Server RPC 与运行时存储链路。
- 消息幂等、持久 outbox、事件序列、重放、快照和重启恢复。
- Android 前后台、锁屏、网络恢复、通知和 WebView 生命周期。
- 首屏、长会话、输入反馈、滚动、响应式和可访问性。
- 安全默认值、认证、工作区根目录和本地文件访问边界。
- 与上述能力直接相关的自动化测试、真机验证、文档和诊断。

## 不做什么

- 不建设多用户 SaaS、组织权限、计费或云端账号体系。
- 不把 PostgreSQL、Redis、MinIO 等服务变成默认安装依赖。
- 不重写为 Electron、Tauri、React Native 或另一套前端框架。
- 不扩张成多模型聚合平台、完整 IDE 或多智能体组织系统。
- 不复制官方客户端的私有实现，不依赖未公开接口维持核心能力。
- 不默认开放公网、高信任审批或全磁盘读写。
- 不增加与核心任务无关的装饰页面、常驻后台任务或重复状态源。

超出范围的建议进入候选清单，不自动实现。只有当它能消除更高优先级风险、且没有更简单方案时，才重新评审范围。

## 完成门槛

以下门槛全部满足并留下可复查证据后，才可把本目标标记为完成。

### 1. 轻量

- 默认安装不要求外部数据库、缓存、对象存储或额外常驻服务。
- 每个新增运行时依赖都必须说明被替代的复杂度、体积影响和移除路径。
- 长会话只保留有界缓存、事件和 DOM；1600 条消息场景的可见消息节点目标不超过 20 个。

### 2. 低风险

- 新安装默认使用非高信任的审批与沙箱组合；高信任模式必须由用户显式选择并看到风险说明。
- 远程访问必须有认证，本地文件读取、浏览和编辑必须限制在明确允许的工作区根目录内。
- Token、密码、路径和诊断信息遵循最小披露；发布资产和示例不携带私人连接信息。
- GitHub 主分支保护、安全更新和私密漏洞报告有可复查状态；无法由代码库自动完成的设置记录为外部阻塞项。

### 3. 长久稳定

- 同一个 `clientMessageId` 在重试、双页面、断网、锁屏和重启后最多产生一次真实发送结果。
- 事件重放、权威快照、持久 outbox 和冷启动读取最终收敛；已结束任务不残留虚假的运行状态。
- 7420 服务重启不丢失已接受任务，失败发送保留可理解且可操作的恢复状态。
- 前端、CLI、server modules、7420 回归、Android 生命周期和发布检查均有明确命令；候选版本完成两小时浸泡和真机恢复矩阵。

### 4. 简约实用

- 新用户从 README 到可用页面的目标时间不超过 5 分钟，失败时能看到下一步诊断动作。
- 主路径只突出项目、任务、对话、输入、审批和恢复；高级诊断与低频设置按需展开。
- 空状态、加载、失败、离线、恢复和权限提示使用简洁中文，不能只显示技术错误或原始 JSON。
- 393 x 852 手机、折叠屏双栏和 1440 x 900 桌面布局均无核心内容溢出或不可达操作。
- M4-C 会话设计重建全部通过；会话语义可追溯到固定 `sema-code-core` 参考，不存在 7420 旧会话归并、推断或运行时回退路径。

### 5. 平滑流畅

- 输入、发送、切换和点击的本地可见反馈目标为 100 ms 内。
- 有缓存的任务首屏可读目标为 300 ms 内；前台恢复后的状态收敛 P95 目标为 2 秒内。
- 1600 条消息的滚动与增量输出期间，主线程最长阻塞目标低于 80 ms。
- 用户阅读历史时不强制跳到底部；位于底部时新输出自然跟随，并且同一过程只显示一个主要加载反馈。

### 6. 可维护交付

- 一个能力只有一个权威状态源；协议、产品说明、实现和回归记录不互相矛盾。
- 不继续向超大入口文件加入独立职责；触及相关逻辑时优先提取小型纯模块并保留行为测试。
- 每次行为变更都包含验收方法、最小相关验证和回滚说明；文档变更通过治理检查。
- 不把构建通过等同于真机、远程链路或发布成功，结论必须与实际证据范围一致。

## 阶段

### M0：基线与护栏

- 固化本目标、范围、完成门槛和自主推进协议。
- 建立文档职责：`PRODUCT.md` 说明长期产品性格，本文件说明当前执行目标，`PROJECT_SPEC.md` 说明已验证架构事实，`release-capabilities.json` 说明机器可读发布契约，`tests.md` 保留验证记录。
- 识别已有改动、当前验证入口和首批风险，不覆盖用户工作区。

### M1：安全与信任

- 收紧新安装的审批与沙箱默认值，同时为已有高信任配置提供清晰迁移和显式选择。
- 将本地文件读取、下载、浏览和编辑统一限制到允许的工作区根目录。
- 补齐远程暴露、认证、敏感信息和 GitHub 安全治理检查。

### M2：状态绝对正确

- 完成消息 at-most-once、outbox、运行时请求、事件重放和快照收敛矩阵。
- 消除结束后仍运行、恢复后重复发送、双页面覆盖和冷启动丢消息。
- 用故障注入覆盖断网、超时、进程重启、序列缺口和旧快照。

### M3：性能与流畅

- 建立上述输入反馈、首屏、恢复、长列表和主线程阻塞基线。
- 在不改变状态语义的前提下消除重复请求、无界渲染和布局抖动。
- 性能预算进入可重复回归，不只保留一次性截图或主观描述。

### M4：简约体验

- 收口安装、首页、对话、审批、恢复、错误和设置的主路径。
- 先完成 M4-C：以固定 `sema-code-core` 会话设计为强制参考，建立新会话投影 module，并以替换方式移除 7420 旧会话语义和渲染分支。
- 完成手机、折叠屏、桌面、键盘和基本可访问性验证。
- 删除重复表达和无效常驻控件，但不隐藏必要的运行信息。

### M5：可维护交付与真机验证

- 收敛能力文档与实现差异，补齐关键模块边界和回归入口。
- 完成 Windows 安装升级回滚、两小时浸泡、Android 真机锁屏/Doze/通知恢复矩阵。
- 生成候选版本证据包；提交、推送、发版和部署仍须用户明确授权。

## 自主推进协议

Codex 每轮按以下闭环推进一个最小、可独立验证的结果：

1. 从尚未满足的最高优先级门槛中选择影响最大的一个问题。
2. 读取真实代码、配置、日志或运行链路，写下可复现的当前证据。
3. 定义验收条件、风险、最小改动范围和回滚方式。
4. 优先补失败用例或观测点，再做最小实现。
5. 运行最窄相关检查；通过后再运行受影响层级的构建或回归。
6. 更新事实文档和证据，保留未解决项，不用“基本完成”替代门槛。
7. 继续选择下一项，直到全部完成门槛满足。

任何变更都不得顺带重构无关代码，不得覆盖已有脏工作区，不得自行提交、推送、发布或部署。

## 阻塞处理

- 先把阻塞分类为代码缺陷、测试环境、外部服务、凭证权限、真机资源或不可逆产品决策。
- 不盲目重复同一失败；每次重试必须增加新证据或改变验证方法。
- 同一阻塞连续三个目标回合仍无法解除时，将该项保持未完成并标记为阻塞，然后切换到下一个不依赖它的最高优先级事项。
- 只有缺少凭证、外部权限、真机或不可逆产品选择时请求用户介入；普通实现难度不构成暂停理由。
- 外部阻塞消失后回到原门槛继续验证，不能因绕过或降级而宣告完成。

## 单项完成记录

每个完成项至少记录：问题与证据、验收条件、改动文件、执行过的命令、结果、未覆盖范围和回滚方式。用户可见行为变化记录在 `tests.md`；纯文档或内部治理调整不追加重复测试流水。
