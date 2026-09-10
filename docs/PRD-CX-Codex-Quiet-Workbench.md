# PRD：CX-Codex 安静工作台（UI/UX VNext）

> 文档状态：Sema 会话候选已验证；本轮合并后需重新验收，整体产品门槛未关闭
>
> 版本：1.3
>
> 日期：2026-09-11
>
> 产品范围：CX-Codex 浏览器端与 Android WebView 共用前端
>
> 实施方式：Codex 按本文任务包顺序、小步执行、逐包验证
>
> 当前授权边界：本轮允许替换 7420、提交并推送 beta，以及准备 2.8.1 版本草稿；不正式打 tag 或发布。历史发布授权不自动延续，不得跳过安全、Runtime、Android、CI 或 Release 门槛。

## 0. Codex 执行契约

本文不只是方向文档，也是后续 Codex 的执行入口。实施者必须遵守以下规则：

1. 开始前依次阅读仓库 `AGENTS.md`、`PRODUCT_GOAL.md`、`PRODUCT.md`、`PROJECT_SPEC.md` 和本文。
2. `PRODUCT_GOAL.md` 的安全、可靠性、性能与发布门槛高于本文；冲突时以前者为准。
3. 每次只执行一个任务包。会话改造必须“替换，不叠加”，不得在旧 Conversation 分支上继续修补；Shell、Sidebar 等非会话范围仍按最小改动执行。
4. 会话行为以固定提交的 `midea-ai/sema-code-core` 为强制设计参考。当前 Codex.app 只用于可用性和安全性复核，不得覆盖本 PRD 已固定的 Sema turn、activity、final、elapsed 和 file-change 目标。
5. 不改变 Codex App Server、Runtime Store、durable outbox、`clientMessageId`、通知序列、队列、审批执行、单写者和 Android 恢复的事实所有权；但不得复用它们当前通往 `UiMessage[]` 和旧 Conversation 的会话归并、过滤与展示规则。
6. 保留工作区已有改动。没有用户明确要求时，不提交、不推送、不切分支、不部署、不发布。
7. 每个任务包先记录基线，再修改，再运行该包最小验证；基线失败时先判断是否为既有问题，不用 UI 改动掩盖真实状态。
8. 任何状态都不能只靠颜色表达；审批、失败、离线、恢复和单写者冲突不能因“界面更干净”而被折叠到不可发现。
9. 新依赖默认不允许。确需引入时，必须说明体积、替代复杂度、移动端兼容性和移除路径。
10. 完成一个任务包后，在交付说明中列出：改动范围、视觉证据、行为证据、性能证据、已知偏离和回滚点。
11. 任何保留 7420 旧会话语义、旧渲染回退、双读、双写或长期 feature flag 的方案均视为目标偏移，不得进入候选。

### 文档优先级

后续 UI/UX 实施按以下顺序解释需求：

1. `PRODUCT_GOAL.md`：产品目标、禁止范围和强制门槛。
2. 本 PRD：当前 UI/UX VNext 的产品决策和实施顺序。
3. `PRODUCT.md`、`PROJECT_SPEC.md`：产品性格和已验证架构事实。
4. `docs/ui-ux-audit-20260808.zh-CN.md`：当前已验证能力和历史证据。
5. `docs/frontend-ui-remediation-plan.zh-CN.md`、`docs/desktop-parity-ui-plan.zh-CN.md`：历史方向参考；与本文冲突时以本文为准。

## 1. Summary

### 1.1 一句话目标

以 `midea-ai/sema-code-core` 的会话事件、turn 投影、活动归并和完成态设计为强制参考，替换 7420 原有会话逻辑，并把 CX-Codex 收敛为保留移动与恢复优势的安静工程工作台。

### 1.2 产品判断

有必要对会话层做替换式重建，但没有必要重写整个 7420 Runtime。

当前 CX-Codex 的鉴权、消息幂等、队列、恢复、移动适配和长会话虚拟化是必须保护的基础设施；当前 `UiMessage[]` 归并、事件过滤、final/elapsed 推断、阶段回复折叠和尾部过程浮层不是保护对象。会话层必须从权威 thread/turn/item 与 Runtime 事实重新投影，不能通过包装旧数组获得 Sema 式外观。

- 必做：Sema 源码映射、新 Conversation Transcript module、结构事件保真、Turn-based Conversation，以及 Shell、Sidebar、Composer 的层级收敛。
- 后置：只读 Artifact Inspector，经准入验证后再做。
- 不做：React/Tailwind 架构迁移、Sema Runtime 接入、固定三栏、全功能 IDE，以及与会话改造无关的 Runtime 重写。

### 1.3 参考策略

| 参考来源 | 借鉴内容 | 不借鉴内容 |
| --- | --- | --- |
| 当前 Codex.app | 队列、审批、焦点、弹层、恢复和可访问性复核 | 私有源码、私有资源；不得覆盖已固定的 Sema 会话目标 |
| Sema Code Core | 事件类型、transcript reducer、turn 分组、运行/完成态转换、耗时、活动组、文件变更、final 选择，以及 Shell/Sidebar/Composer 密度 | React 实现、固定三栏移动布局、Sema Runtime 接入和品牌资产 |
| CX-Codex 当前实现 | App Server/Runtime Store 权威事实、durable outbox、`clientMessageId`、队列、审批执行、重放/快照、移动生命周期和有界虚拟化 | `UiMessage[]` 会话模型、旧 normalizer 过滤、旧 Conversation 推断/折叠/浮层、双套渲染和历史样式包袱 |

Sema 参考基线固定为提交 [`f564e8d930053becdd5c31fe53f65fd863b6f283`](https://github.com/midea-ai/sema-code-core/tree/f564e8d930053becdd5c31fe53f65fd863b6f283)。该项目为 MIT License；可以研究和依法复用，但 CX-Codex 默认采用 Vue 重新实现交互模式。若复制实质性源码，必须保留原版权与许可声明。

## 2. Contacts

| 角色 | 负责人 | 职责 |
| --- | --- | --- |
| 产品负责人 | 仓库维护者 / 用户 | 确认 PRD、处理不可逆产品选择、批准实施与发布 |
| 实施者 | Codex | 按任务包实施、验证、记录证据，不越过授权边界 |
| 设计审查 | 产品负责人 + Codex | 对照当前 Codex.app、Sema 参考和 CX 多视口截图审查 |
| 架构权威 | `PROJECT_SPEC.md` 与当前代码 | 决定 Runtime、状态、队列、恢复和持久化所有权 |
| 发布批准 | 产品负责人 | 决定提交、推送、候选验证、Android 构建和正式发布 |

## 3. Background

### 3.1 已验证事实

| 事实 | 产品含义 |
| --- | --- |
| CX-Codex 定位是本地 Codex 的浏览器/Android 任务控制层，不是通用 IDE 或多人 SaaS | UI 优化必须围绕项目、任务、对话、输入、审批和恢复 |
| App Server 与 Runtime Store 快照是任务状态权威，浏览器 outbox 只在被接受前拥有发送 | 不能为了简化 UI 新建第二套会话或队列状态 |
| 当前前端已经支持手机单栏、折叠屏、长会话虚拟化、缓存首屏和前台恢复 | 这些能力是回归底线，不是本轮重做对象 |
| 既有压力证据在 1602 条消息时只挂载 13 个消息项，最大心跳延迟约 60ms | Conversation 重构必须保留虚拟化和增量渲染边界 |
| 当前 UI 已采用白灰中性色和语义 token，旧文档中的“米黄色主调”判断已经过时 | 本轮重点不是换颜色，而是压低结构噪声和统一层级 |
| `App.vue`、`SidebarThreadTree.vue`、`ThreadComposer.vue`、`ThreadConversation.vue`、`useDesktopState.ts` 都是大型编排文件 | 长期维护需要按责任提取视图组件，但不能另造状态中心 |
| Sema 桌面端默认侧栏约 256px、顶栏 44px、正文 `max-w-3xl`，Composer 使用紧凑双层结构 | 可用于 CX 桌面密度和层级参考 |
| Sema 在 393px 宽度下的固定多栏布局会压坏主内容 | 不可复制其移动布局；CX 当前响应式策略必须保留 |

### 3.2 当前主要问题

1. Sidebar 默认宽度和顶部入口视觉重量偏大，项目、置顶、会话、工具入口同时争夺注意力。
2. 会话正文把过程、工具、文件、回复和恢复状态放在多个视觉层，完成后的中间过程仍显得嘈杂。
3. Composer 圆角、阴影、最小高度和控制数量让它成为页面主视觉，而不是稳定输入工具。
4. Header、Conversation、Composer 的内容轴线并不总是形成同一阅读列。
5. 同类控件仍可能来自全局 CSS、Tailwind 类和局部覆盖三种规则，明暗主题长期维护成本高。
6. 大型组件同时处理数据适配、状态判断、滚动、渲染和交互，视觉调整容易触碰可靠性代码。
7. 旧 UI 规划强调“像 Codex”，但缺少按任务执行的准入、停止和回滚条件，容易演变为持续美化。

### 3.3 机会

CX-Codex 不需要在功能数量上追赶 Sema。更有价值的差异化是：

- 桌面端像成熟 Codex 工作台一样安静、紧凑、可扫读。
- 手机和折叠屏保持真正可用，而不是桌面三栏的缩小版。
- 断网、锁屏、重启、跨进程写入和长任务下仍然可信。
- 文件、diff、命令和审批需要时可展开，不需要时不干扰最终答案。

### 3.4 约束与假设

- 当前安装版 Codex.app 会持续变化，因此每个实施任务包都要重新检查相应行为，不把本文截图记忆当永久事实。
- 本轮优先中文界面，但布局必须容纳英文模型、工具和路径文本。
- 不新增云端遥测。体验指标通过本地回归、页面内 timing 和人工任务测试获取，不记录提示词或回复正文。
- 右侧 Artifact Inspector 是否进入正式范围，取决于 UX-50 的准入结果，不因 Sema 有此能力就默认建设。

## 4. Objective

### 4.1 产品目标

在不降低消息正确性、任务恢复、移动端可用性和安全边界的前提下，建立独立于 7420 旧会话逻辑的新 Conversation Transcript module，使执行中过程、完成耗时、最终回复和文件变更由权威事实确定，并按固定 `sema-code-core` 参考呈现。

### 4.2 SMART Key Results

| KR | 指标 | 目标 |
| --- | --- | --- |
| KR1 主路径清晰 | 在包含至少 5 个项目、30 个会话、运行/等待/未读混合状态的固定夹具中找到指定任务 | 5 秒内完成；不需要打开二级设置 |
| KR2 输入清晰 | 从首页选择项目、输入并发送首条消息 | 主操作始终可见；本地可见反馈不超过 100ms |
| KR3 过程降噪 | 已完成 turn 的可观察活动默认呈现 | 合并为一个可展开过程摘要；内部 thinking 不显示；最终回复与待处理审批不被折叠 |
| KR4 视觉密度 | 1440×900 桌面首屏 | 默认侧栏约 288px、顶栏 44px、会话阅读列约 768px；核心内容不溢出 |
| KR5 响应式 | 393×852、852×393、768×1024、884×1104、1440×900 | 无核心横向溢出、不可达操作或被 Composer 遮挡的最后内容 |
| KR6 性能不回退 | 缓存首屏、前台恢复、1600 条消息压力 | 缓存首屏 ≤300ms；恢复 P95 ≤2s；1600 条消息滚动与增量输出期间最长主线程阻塞 <80ms；可见消息节点 ≤20 |
| KR7 状态正确 | 队列、审批、失败、离线、恢复、单写者冲突固定夹具 | 状态、动作和顺序与权威快照一致；无丢失、重复或假成功 |
| KR8 可访问性 | 键盘、屏幕阅读器语义、forced-colors、reduced-motion | 所有可见控件有名称；焦点不丢失；必要文本对比度达到 WCAG AA |
| KR9 可维护性 | 新增或提取的 UI 组件 | 单一呈现职责、props/events 明确；不得新增全局状态权威或重复持久化 |
| KR10 会话语义 | 实时流、刷新快照和事件重放产生的同一 turn | 输出相同 `ConversationTurn`；不依赖文本位置、助手消息数量或旧 UI 状态 |
| KR11 结果完整 | 完成 turn | 明确执行耗时、唯一 final、文件改动摘要；缺失时显示可审计的失败/中断状态，不猜测补齐 |
| KR12 旧逻辑清零 | 生产会话路径和测试 | 不存在旧归并、旧耗时推算、旧阶段折叠、旧尾部浮层或运行时回退；静态门禁通过 |

### 4.3 成功不等于什么

- 不是截图看起来相似就算成功。
- 不是通过构建就算完成浏览器或 Android 验证。
- 不是把状态藏起来就算“更简洁”。
- 不是在旧 `UiMessage[]` 上增加一个 TurnGroup 外壳就算完成。
- 不是新建一套组件库或把 Vue 改成 React。
- 不是发布版本；发布需要独立授权和完整门槛。

## 5. Market Segments

### 5.1 本地深度开发者

**Job to be done：** 在多个仓库和长任务间快速切换，判断哪个任务正在执行、等待输入或已完成，并继续发起工作。

**主要问题：** 侧栏噪声、重复入口、状态散落、长对话过程信息抢占最终结果。

**优先价值：** 紧凑导航、清晰状态、完成后折叠过程、快速返回当前任务。

### 5.2 移动接续用户

**Job to be done：** 离开电脑后，在手机或折叠屏上查看进度、审批、补充一句话并安全恢复任务。

**主要问题：** 窄屏操作密集、系统键盘遮挡、弱网与进程恢复容易让 UI 状态不可信。

**优先价值：** 单栏、44px 触摸目标、队列/失败就近恢复、后台到前台快速收敛。

### 5.3 结果审阅者

**Job to be done：** 快速阅读最终答案，核对文件、diff、命令和审批，不被完整工具日志淹没。

**主要问题：** 工具过程与最终结论权重相近；文件细节缺少稳定检查空间。

**优先价值：** turn 分组、过程摘要、文件变更摘要、按需 Artifact Inspector。

## 6. Value Propositions

| 用户问题 | 价值承诺 | 产品实现 |
| --- | --- | --- |
| “我找不到当前最重要的任务” | 任务状态和当前项目优先于功能入口 | 固定 Sidebar 层级、等待/未读明确、低频入口收纳 |
| “过程太多，看不到结论” | 活跃过程可见，完成过程收起，最终回复突出 | TurnGroup、ActivitySummary、FileChangeSummary |
| “手机上像挤坏的桌面页” | 移动端保留同一产品语言但使用单栏工作流 | 抽屉、sheet、安全区、44px 目标、Composer 分层 |
| “断网或重启后不敢相信页面” | 每个可见状态都能对应权威数据或明确的本地发送阶段 | 原样保留 Runtime Store、outbox、replay/snapshot、恢复文案 |
| “UI 每改一次就不一致” | 使用少量稳定 token 和责任清楚的呈现组件 | `DESIGN.md`、语义 token、渐进提取，不另造状态层 |

## 7. Solution

### 7.1 设计原则

1. 工作流优先：先看项目和任务，再看过程和细节。
2. 一屏一个视觉重点：运行时是当前活动；完成后是最终答复；等待时是审批或补充输入。
3. 少卡片、多行结构：只给文件、diff、审批和真实对象使用边界。
4. 状态就近：连接状态归 Header，工作过程归会话尾部，发送状态归消息或 Composer 上方。
5. 桌面紧凑、触摸不缩水：桌面视觉高度可低，手机交互目标不得低于 44px。
6. 先语义后装饰：状态、名称、焦点、顺序正确后再调整阴影、圆角和动画。
7. 事实保真：新会话投影从权威 thread/turn/item、Runtime 状态和等待区间生成；旧 normalizer 与旧 `UiMessage[]` 不属于新 module 的 interface。
8. 替换而非兼容：新会话路径验收后删除旧实现和实现细节测试，不保留运行时切换开关。

### 7.2 目标信息架构

#### Desktop（≥1200px）

- 左侧 Sidebar：项目、任务和低频入口，默认 288px，可调 240–360px。
- 中间 Conversation：Header + 约 800px 阅读列 + 对齐的 Composer。
- 右侧 Artifact Inspector：默认关闭，仅在文件/diff/计划详情触发，建议 360–520px；是否实现由 UX-50 决定。

#### Compact / Tablet（768–1199px）

- Sidebar 可收起或以覆盖层打开。
- Conversation 保持单一主列。
- Artifact Inspector 使用覆盖层，不压缩正文到不可读宽度。

#### Phone（<768px）

- 单栏 Conversation。
- Sidebar 使用模态抽屉；设置、附件、模型和详情使用有焦点所有权的 sheet。
- 不启用 Sema 式固定三栏，不持久化手机抽屉为桌面侧栏偏好。

### 7.3 视觉规格

以下是第一轮实现默认值，不是新的永久硬编码。落地后写入 `DESIGN.md` 和语义 token：

| 类别 | 默认目标 | 说明 |
| --- | --- | --- |
| Sidebar | 288px；范围 240–360px | 新用户使用新默认；已有显式宽度保留并按安全范围裁剪 |
| Topbar | 44px | 单行标题、连接状态和溢出操作 |
| Reading column | 800px | 普通对话与 Markdown；宽 artifact 可临时扩到 1120px |
| Composer | 可见边框与 48rem 阅读列同轴 | 桌面约 88–96px 初始高度，内容增长有上限；默认 12px 轻边框、无浮卡阴影 |
| Desktop nav row | 32px 或固定 48px 双行变体 | 不允许内容导致任意高度抖动 |
| Mobile target | ≥44px | 图标视觉可更小，hit area 不缩小 |
| UI / Reading font | 14px / 15px | 中文正文行高 1.6 左右 |
| Radius | row 8px、card 8px、control 8px、composer 14px | 避免到处使用 pill 和大圆角 |
| Border / shadow | 1px 语义边框；阴影只用于浮层 | 页面层级主要靠背景和间距 |
| Motion | 80/120/180/220ms | 只用于状态反馈、弹层和重排；支持 reduced-motion |

### 7.4 Shell 与 Header

- Header 保持 44px 单行结构：返回/侧栏、任务标题与项目路径、紧凑连接状态、主要动作、更多。
- 连接中的 spinner、任务中的工作过程和消息发送状态各有唯一所有者，不在多个区域重复。
- 首页取消大 Hero；显示当前工作目录、简短提示和 Composer。
- 主内容、Header 标题轴和 Composer 必须对齐。
- 低频全局能力通过命令菜单或“更多”进入，不在 Header 和 Sidebar 同时平铺。

### 7.5 Sidebar

推荐顺序：

1. 新建任务（唯一强主操作）。
2. 搜索 / 当前任务定位。
3. 置顶任务。
4. 最近项目与项目内任务。
5. Workbench、Skills、趋势、诊断、设置等低频入口。

规则：

- 顶部入口采用纵向 icon + text 行，不使用横向大按钮带。
- 默认会话行突出标题；时间、运行、等待、未读使用紧凑右侧状态。
- 仅活动、等待和搜索结果可显示第二行摘要；行高只能使用固定单行或双行规格。
- 同一会话在同一分组内只出现一次。置顶区与所属项目中的重复是有意快捷方式，必须通过分区和 pin 语义让用户能理解。
- 项目按最近任务活动排序；置顶项目的历史元数据只保留兼容，不重新引入复杂排序设置。
- hover/focus 才出现的菜单不得在不可见时拦截指针；触屏要有明确菜单入口。
- 搜索的 loading、partial、empty、error 是四种独立状态，不能用“无结果”代替仍在查询或失败。

### 7.6 Conversation

Conversation 以 turn 为阅读单位：

- 用户输入使用轻量、可识别的表面，不使用高饱和大气泡。
- 当前 turn 默认展开最近两段明确的公开 commentary，不截断正文；tool、command、MCP、search、plan 等操作详情仅在显式点击后挂载，不占用公开进展窗口，不展示内部 thinking 链。执行时间只从结构时间戳与等待区间计算；本地显示时钟不拥有 Runtime 状态。
- turn 完成后，中间活动默认收敛为一个 ActivitySummary；选择文字、聚焦过程控件、离底部或显式展开历史时保留当前阅读内容，直到返回最新或明确导航。明确 `final`、文件变更摘要和待处理动作留在第一层。
- 两个及以上连续工具操作合并为 ActivityGroup，默认显示“读取 / 编辑 / 执行”的摘要和最新目标。
- 文件变更显示文件数、增删统计和结果状态；详情按需展开。
- 审批、失败、等待输入和单写者冲突永远不随普通过程摘要一起折叠。
- 未识别 payload 保留可访问的诊断入口，但默认收起且不直接展示原始 JSON。
- 继续使用经验证的有界虚拟化、滚动锚点、返回最新输出和前台恢复能力，但重新通过新投影 interface 接入，不复制旧会话判断。
- 不按文本去重消息；消息身份继续来自 item/turn/clientMessageId 等强身份。

新的深 module 放在独立 seam，建议目录为 `src/conversation-transcript/`，外部 interface 只暴露一个纯投影入口：

```ts
projectConversation(input: ConversationProjectionInput): ConversationProjection
```

`ConversationProjectionInput` 只接收权威 thread/turn/item、Runtime turn 状态、待处理交互和时间区间；`ConversationProjection` 输出有序 `ConversationTurn[]`。复杂的事件分类、归并、耗时、final、file changes 和活动组全部隐藏在 module implementation 内，调用者不得再次推断。

建议新增的呈现 module：

- `TurnGroup.vue`
- `ActivitySummary.vue`
- `ActivityGroup.vue`
- `FileChangeSummary.vue`
- `TurnActions.vue`

这些 module 只接收 `ConversationProjection` props 并发出用户意图，不请求 Runtime、不持久化状态、不读取旧 `UiMessage[]`。

明确禁止以下旧实现进入新路径：

- 以最后一条助手文本代替 `final`。
- 以助手消息数量决定是否出现阶段摘要。
- 解析 `Worked for ...` 文本或累计命令耗时作为 turn 耗时。
- 使用 Teleport 尾部浮层代替 turn 内活动流。
- 在 frontend normalizer、RPC trim 或 session-log fallback 中丢弃 `fileChange`、MCP、search 等结构事件。
- 通过根级开关、双读或兼容 adapter 回到旧 Conversation。

### 7.7 Composer

- 外层使用 14px 左右圆角和轻边框，不使用大面积阴影。
- 第一层是可自动增长的输入区；第二层是附件、模式、模型、权限、上下文和发送/停止。
- 权限和模型的当前有效值必须可见，不能只藏在更多菜单。
- 手机 Enter 默认换行，Ctrl/Command + Enter 发送；桌面保持用户配置；IME 组合阶段不得提交。
- 附件选择后立即显示本地预览；上传中、失败、重试、移除继续由附件本身拥有。
- 队列和 detached failure tray 保持在 Composer 上方，不进入已提交 transcript。
- 队列编辑、删除、重排、Steer 和失败暂停保留稳定 `clientMessageId` 与原排序。
- Composer 收紧不得减少输入可编辑空间，长输入继续按现有上限增长并内部滚动。

### 7.8 Artifact Inspector（条件范围）

该能力不是首轮视觉整改的完成条件。只有 UX-50 准入通过才实现。

允许内容：

- 文件只读预览。
- diff 和文件变更详情。
- 计划步骤和工具详情。
- MCP/审批的结构化详情。

禁止内容：

- 完整文件编辑器、终端模拟器、Git 客户端或 IDE 导航树。
- 新的文件状态数据库。
- 默认常驻并压缩所有会话内容。
- 手机上的固定右栏。

准入标准：

1. 至少两个高频用户任务在会话内展开详情时明显打断阅读。
2. 原型证明桌面右栏比 modal/inline 展开少一次以上上下文切换。
3. 1024px 以下可自动转覆盖层，393px 手机无横向溢出。
4. 不增加新的 Runtime、文件权限或持久化所有权。

若任一条件不满足，保持现有 inline/modal 详情，不建设 Inspector。

### 7.9 设计系统与维护边界

- UX-00 创建根目录 `DESIGN.md`，记录产品视觉语言、token、布局、状态、响应式和组件规则。
- 新组件只使用语义 token。触及旧选择器时渐进迁移，不进行一次性暗色主题全量重写。
- 优先复用现有按钮、菜单、弹层和 focus environment；只有连续三个场景需要相同行为时才提取共享 primitive。
- `useDesktopState.ts` 保持 Runtime 编排职责，但不再向 UI 暴露需要二次猜测的扁平会话；Conversation Transcript module 是会话呈现语义的唯一 seam。
- 大文件的拆分以“深 module、窄 interface、可独立验证”为准，不以达到任意行数为目标。

### 7.10 Sema 源码参考地图

| 参考点 | 固定源码 | CX 用法 |
| --- | --- | --- |
| 事件与会话类型 | [`types.ts`](https://github.com/midea-ai/sema-code-core/blob/f564e8d930053becdd5c31fe53f65fd863b6f283/webui/shared/types.ts) | 固定 text/tool/permission/task/todo/plan/usage/file-change 等结构语义和 turn 生命周期映射 |
| Transcript 投影 | [`transcript.ts`](https://github.com/midea-ai/sema-code-core/blob/f564e8d930053becdd5c31fe53f65fd863b6f283/webui/shared/transcript.ts) | 参考顺序事件到 turn blocks、活动组、文件改动和完成态的共享 reducer；CX 用纯 TypeScript module 重新实现 |
| Shell 和可调面板 | [`App.tsx`](https://github.com/midea-ai/sema-code-core/blob/f564e8d930053becdd5c31fe53f65fd863b6f283/webui/client/src/app/App.tsx) | 参考 256px 侧栏、按需右栏和面板 resize；CX 使用更宽的 288px 默认并保留移动抽屉 |
| 中性色与 14px UI | [`index.css`](https://github.com/midea-ai/sema-code-core/blob/f564e8d930053becdd5c31fe53f65fd863b6f283/webui/client/src/index.css) | 参考低噪声色阶和正文密度；不替换 CX 已验证的 AA token |
| 紧凑导航 | [`Sidebar.tsx`](https://github.com/midea-ai/sema-code-core/blob/f564e8d930053becdd5c31fe53f65fd863b6f283/webui/client/src/features/sidebar/Sidebar.tsx) | 参考 32/28px 行、平面 hover/active 和项目树层级 |
| 44px 顶栏、约 768px 对话列、turn 分组 | [`ChatView.tsx`](https://github.com/midea-ai/sema-code-core/blob/f564e8d930053becdd5c31fe53f65fd863b6f283/webui/client/src/features/chat/ChatView.tsx) | 参考顶栏、阅读列和完成后过程折叠 |
| 轻量双层输入区 | [`Composer.tsx`](https://github.com/midea-ai/sema-code-core/blob/f564e8d930053becdd5c31fe53f65fd863b6f283/webui/client/src/features/chat/Composer.tsx) | 参考 52px 输入 + 44px 控制条、紧凑 dropdown 和 token 状态 |
| 工具/文件摘要 | [`Blocks.tsx`](https://github.com/midea-ai/sema-code-core/blob/f564e8d930053becdd5c31fe53f65fd863b6f283/webui/client/src/features/chat/Blocks.tsx) | 参考 tool verb、目标、diff stat、ActivityGroup 和 FileChangesCard |
| 小型 UI primitives | [`common/ui.tsx`](https://github.com/midea-ai/sema-code-core/blob/f564e8d930053becdd5c31fe53f65fd863b6f283/webui/client/src/common/ui.tsx) | 参考 Button/Popover/Menu/Dropdown/Toggle 的小边界，不引入 React 实现 |

当前 Vue 映射与偏离记录在根目录 [`DESIGN.md`](../DESIGN.md)。UI 实施必须保留以下可审计关系：`TurnGroup/TurnDivider` 对应 `.turn-shell/.turn-divider/.process-toggle`，`ToolCard/ToolGroup` 对应平面 `.activity-block`，`FileChangesCard` 对应按需展开文件行的 `.file-summary`，运行 Spinner/StatusLine/return-to-bottom 对应活动点、轻量 live state 与居中三点按钮。CX 明确保留单栏手机布局、44px 粗指针目标和恢复能力，不复制 Sema 的固定多栏移动布局。

动效只用于状态与披露：过程展开使用 180ms opacity/transform，箭头使用 180ms rotate，运行点/回到底部三点只在任务活跃时持续；`prefers-reduced-motion: reduce` 停止持续动画并把披露过渡压到 1ms。禁止页面入场编舞、测量高度动画、弹簧/视差、动画渐变和装饰性卡片堆叠。
### 7.11 工作包与执行顺序

| ID | 名称 | 依赖 | 发布必要性 | 状态 |
| --- | --- | --- | --- | --- |
| UX-00 | 设计契约与回归基线 | 无 | 必须 | 已完成（本地候选） |
| UX-10 | Quiet Shell 与 Header | UX-00 | 必须 | 已完成（本地候选） |
| UX-20 | Sidebar 信息架构 | UX-10 | 必须 | 已完成（本地候选） |
| UX-25 | Sema Conversation Transcript module | UX-00 | 必须 | 已完成（本地候选） |
| UX-30 | Turn-based Conversation | UX-10、UX-25 | 必须 | 已完成（本地候选） |
| UX-40 | Compact Composer | UX-10、UX-30 | 必须 | 已完成（本地候选） |
| UX-50 | Artifact Inspector 准入与可选实现 | UX-30 | 条件 | 已完成（No-go） |
| UX-60 | 响应式、主题与可访问性硬化 | UX-20、UX-30、UX-40；可含 UX-50 | 必须 | 已完成（本地候选） |
| UX-70 | 候选验证与文档收口 | UX-60 | 必须 | 本地候选完成（生产/真机未验） |

任务包只有在验收证据已记录后才能把状态改为“已完成”；实现开始但验收未结束时标记为“进行中”，不得提前跳过依赖。UX-25 与 UX-30 是 M4-C 强制门槛，不能用 UX-10/20/40 的视觉完成代替。

#### UX-00：设计契约与回归基线

**目标：** 冻结改造前事实和长期设计规则。

**允许修改：** `DESIGN.md`、测试夹具/截图说明、必要的 UI 回归脚本；不改用户可见业务逻辑。

**步骤：**

1. 检查当前安装版 Codex.app 的 Shell、Sidebar、Conversation、Composer、队列和审批行为。
2. 捕获 CX 当前 1440×900、884×1104、768×1024、393×852、852×393 的首页和会话基线。
3. 在 `DESIGN.md` 固化本文视觉规格、状态所有权、响应式规则、禁用模式和截图清单。
4. 为后续回归补齐稳定的 `data-testid` 或语义定位，只在现有语义不足时添加。

**验收：**

- 每个视口有首页、运行、完成、等待输入至少一组基线证据。
- `DESIGN.md` 不复制实现细节，不与 `PRODUCT_GOAL.md` 冲突。
- 无业务代码变更；`git diff --check` 与 `npm.cmd run verify:governance` 通过。

**本地验收（2026-08-30）：** 当前运行中的 Codex.app 已核实为 `OpenAI.Codex_26.818.5229.0_x64`，其 Shell、Sidebar、Conversation、Composer、队列和审批行为继续作为交互安全对照；`DESIGN.md` 已固定 `midea-ai/sema-code-core@f564e8d930053becdd5c31fe53f65fd863b6f283` 的源码映射，并明确禁止恢复 7420 原有会话归并、final/elapsed 推断、阶段折叠、尾部浮层和 `fileChange` 丢弃逻辑。新增固化的 `contract` 回归模式在 1440×900、884×1104、768×1024、393×852、852×393 五个视口逐一验证首页、运行、完成、等待输入，共生成 20 张状态截图和 `contract-baseline.json`；每个视口均只有一个命名主地标、一个显式 final、一个未作答选择器，且首页/会话横向溢出为 0。当前候选矩阵位于 `output/regression-7420/ux00-contract-baseline-20260830`，独立 Headless Playwright 手机截图也已目视复核。历史改造前截图继续单独保存在 `output/regression-7420/p5-screenshot-baseline`，不把本次候选截图冒充完整的改造前证据。独立 Vite 预览没有 7420 Bridge，首页预期出现 `/codex-api` 404 并已记录为环境限制；会话夹具浏览器错误为 0。此次只修改回归脚本和文档，没有修改用户可见业务逻辑；`node --check`、`vue-tsc --noEmit`、`npm.cmd run build:frontend`、`npm.cmd run verify:conversation-transcript`、UTF-8 等价 frontend source-only/governance 与 `git diff --check` 均通过。该结论只关闭本地 UX-00，不代表生产 7420、Android 真机、真实 Windows 高对比度/屏幕阅读器、Git、CI 或 Release 通过。
**回滚：** 删除新增设计/基线文件即可，不影响运行时。

#### UX-10：Quiet Shell 与 Header

**目标：** 第一眼从“Web 控制台”变成安静工作台。

**优先文件：** `src/style.css`、`src/App.vue`、`src/components/layout/DesktopLayout.vue`、`src/components/content/ContentHeader.vue`。

**步骤：**

1. 把桌面新默认收敛为 Sidebar 288px、Topbar 44px、Reading 与 Composer 可见边框同为 48rem；Composer 外层只保留组件自身 gutter。
2. 保留已有显式侧栏宽度并安全裁剪；不覆盖用户桌面偏好。
3. 收敛首页空状态、Header 和 Composer 的共同轴线。
4. 移除重复连接/运行反馈，只保留各自状态所有者。
5. 截图对比浅色、深色、桌面和手机。

**验收：**

- 1440×900 主内容、Header 和 Composer 对齐。
- 393×852 和 852×393 不出现横向溢出或内容遮挡。
- Header 状态变化不引发布局跳动。
- 发送、连接、恢复状态仍能通过文本或可访问名称区分。

**本地验收（2026-08-30）：** 固定 Sema 提交的 256px 侧栏、44px Header 和 `max-w-3xl` 轴线已映射为 CX 的 288px 默认侧栏、44px 单行 Header 和 768px Header/Composer 同轴布局；保存的 340px 用户偏好保持不变，缺失偏好不再因 `Number(null)` 错误落到最小宽度。固化 CDP 回归覆盖 1440×900、393×852、852×393、明暗主题和状态文案变长，轴线偏差与横向溢出均为 0，标题位置不变；独立 Headless Playwright 另行复核桌面和手机截图。证据位于 `output/regression-7420/quiet-shell-20260830` 与 `output/regression-7420/quiet-shell-playwright-20260830`。这是本地候选任务包完成，不代表真实 7420、Android、提交或发布完成。
**回滚：** 任务包独立回退，旧 token 和布局值可一次恢复；不涉及持久化迁移。

#### UX-20：Sidebar 信息架构

**目标：** 更快找到项目和任务，减少工具入口和列表噪声。

**优先文件：** `SidebarThreadTree.vue`、`SidebarMenuRow.vue`、`SidebarThreadControls.vue` 及其局部样式。

**步骤：**

1. 改为纵向主操作和低频入口分层。
2. 建立固定单行/双行 row；标题优先，状态和时间次之。
3. 保持有意的 pinned shortcut 语义，清理同一分组中的意外重复。
4. 验证搜索 pending/partial/empty/error、项目收起展开、背景重排锚点和当前任务定位。
5. 验证触屏菜单、键盘菜单和完整标题恢复。

**验收：**

- 固定夹具中 5 秒内找到指定运行、等待或未读任务。
- 行高、hover、active、展开和后台重排无视觉跳动。
- 搜索中的请求不显示假空状态；失败有重试。
- 移动抽屉关闭后焦点和 Android Back 顺序不变。

**回滚：** 只回退 Sidebar 呈现；项目顺序、折叠、置顶和搜索数据格式不变。

**本地候选证据（2026-08-30）：** `新会话` 成为独立首行主操作，搜索、工作台和工具收敛为第二行低频入口；仍复用现有四个事件、搜索状态机、项目顺序、折叠、置顶和菜单所有权，没有引入新的 Sidebar 数据模型。固定手机夹具验证 10 条基线 row、运行/等待/未读识别、唯一有意 pinned shortcut、项目菜单、新建任务入口、stale-search 合并、查询连续性、后台项目重排锚点与隐藏当前任务定位；边界修复后项目上浮使 scrollTop 从 220 调整为 348，而原可见项目相对顶部保持 7.046875px 不变。默认 288px 和保存的 340px 侧栏均为两行操作区，主操作高度 36px、次操作 32px；粗指针 row 为 58px，所有视口无横向溢出。明暗主题、CDP 截图和独立 Headless Playwright 桌面截图已目视复核，证据位于 `output/regression-7420/quiet-sidebar-20260830`、`output/regression-7420/quiet-sidebar-regression-20260830` 与 `output/regression-7420/quiet-sidebar-playwright-20260830`。这是本地任务包完成，不代表真实 7420、Android、提交或发布完成。

**合并后侧栏合同（2026-09-11）：** 保留远端顶部侧栏开关、全部已读、新建任务的独立所有权，以及第二行搜索、Skills、GitHub 三列入口；工作台与诊断只移除前端目的地，后台能力不删除。上段为旧候选证据，不是合并后布局验收。

#### UX-25：Sema Conversation Transcript module

**目标：** 在 UI 之外建立唯一的新会话投影 seam，用固定 Sema 源码语义替换 7420 的旧会话归并和推断。

**优先范围：** `src/conversation-transcript/`、App Server DTO 类型、RPC/thread payload 保真、session-log 恢复投影、前端接入类型、独立 verifier；不修改 Shell、Sidebar 或 Composer 样式。

**步骤：**

1. 建立逐项源码映射表：Sema `types.ts`、`transcript.ts`、`ChatView.tsx`、`Blocks.tsx` 的输入事实、turn 生命周期、block 类型、文件累计、等待时间和 final 规则，分别映射到 Codex App Server 的实际字段。
2. 定义 `projectConversation(input): ConversationProjection` 的小型 interface；一次性返回有序 turns、活动、文件变更、耗时、final 和待处理交互。待处理交互必须包含可直接渲染的类型、标题、摘要、问题、受限授权地址、响应身份及是否支持会话级允许，调用者不得解析原始 method/params 或二次推断。
3. 修改服务端 trim、session-log fallback 和前端接入，使 `fileChange`、MCP、search、tool、plan、permission 等必要结构事实以有界形式到达新 module；保留大小、数量和敏感字段限制，不把大 patch 无界推到手机端。
   - spectator 的 `thread not loaded` 只能通过精确 thread UUID 定位 `sessions`/`archived_sessions` JSONL，不得调用 `thread/resume` 抢占 writer。
   - session-log 中隐藏的内部续跑 user item 不展示正文，但其权威 `turn_id` 必须保留为轮次边界；`patch_apply_end.changes` 必须转换为同轮 `fileChange`，event/response 镜像只在同 phase 且规范化正文相同时去重，不能按阶段整体折叠。
4. 用纯 computation 实现顺序归并、强身份、turn 状态、等待区间扣除、final 选择、活动分组和文件统计。没有 final 时输出明确终态原因，不生成替代文本。
5. 新增 `verify:conversation-transcript`，覆盖实时事件、刷新快照、replay、session-log fallback、权限等待、失败、中断、重复文本、文件变化、未知事件和 1600+ 消息有界输入。
6. 让实时和恢复路径都调用同一投影 interface；删除所有绕过该 seam 的会话语义拼装。

**验收：**

- 同一 turn 的实时流、刷新快照和重放夹具产生逐字段相同的 `ConversationProjection`。
- 完成 turn 具有可审计的 started/completed/active elapsed、唯一 final 和文件变更摘要；缺字段时输出明确缺失状态。
- permission/elicitation 等用户等待不计入 active elapsed，并可单独呈现等待时长。
- 即使 Runtime 状态暂时仍为 `running`，存在待处理交互的所属 turn 也必须投影为 `waiting`；`ThreadConversation.vue` 不接收 `UiServerRequest`，只按投影类型发出批准、拒绝或回答意图。
- 重复文本不合并；乱序或重复 event 依赖强身份和 sequence 收敛，不按文本去重。
- 新 verifier、frontend normalizer、server module 和类型构建通过；投影不读 DOM、Vue state、localStorage 或旧 `UiMessage[]`。
- 真实 session-log spectator 回放中，内部续跑上下文不可见，每个完成 turn 至多一个明确 final，文件变化归属权与 `turn_id` 一致。

**回滚：** 通过版本控制整体恢复 UX-25 改造前源码；不得在运行时保留旧投影 adapter、双读、双写或切换开关。

**本地候选证据（2026-08-30）：** 已按固定 Sema 提交的共享 transcript reducer、turn 生命周期、thinking/text 分相、结构活动、等待与文件累计语义完成单一纯 `ConversationProjection` seam；实时事件、刷新快照与含乱序/重复 sequence 的 replay 现在逐字段一致。强身份测试证明两条同文 commentary 保持独立；reasoning 仅以有界元数据跨越服务端 DTO，原始思维链正文被剥离，fileChange/MCP 的有界压缩继续生效。完成轮次缺少 `completedAt` 时明确输出 `timingStatus: unavailable`，不再把当前时钟误算成仍在执行；等待区间从 active elapsed 扣除，未完成等待可单独累计。显式 final 保持唯一，多个冲突 final 输出可审计错误而不猜测；失败、中断、未知事件、50k 文本有界输入和 1600+ 活动均有覆盖。session-log spectator 继续按精确 UUID 只读定位且不 resume writer，隐藏内部续跑只保留 `turn_id` 边界，event/response 镜像按同轮同 phase 同正文去重，`patch_apply_end` 归入同轮文件变化。`verify:conversation-transcript`（1602 turns 20.6ms；1600 activities 5.6ms）、frontend normalizers、server modules、`vue-tsc --noEmit`、前端构建和 CLI 构建通过；系统 PowerShell 5.1 的无 BOM 中文脚本解析失败后，以内容相同的 UTF-8 BOM 临时副本执行 governance 并通过，临时文件已删除。独立 Headless Playwright 已断言并目视复核终态缺时显示“执行耗时不可用”且显式 final 可见，证据在 `output/regression-7420/ux25-transcript-20260830`。这是 UX-25 本地 module 候选完成；未安装真实 7420，未验证 Android、物理折叠屏、Windows 高对比度或屏幕阅读器，也未执行提交、推送、CI、部署或发布，该段只记录 UX-25；UX-30 本地候选状态见下节，总目标继续保持未完成。

**补充结构活动审计（2026-08-30）：** 固定 Sema 源码中的 Agent 工作项确认“协同子任务”应作为同轮结构活动可读呈现，而不是暴露 App Server 的 `spawnAgent` / `sendInput` 技术枚举。实现继续复用唯一 `ConversationGenericActivity`，仅按 `CollabAgentTool` 映射中文动作，并把可选 prompt 以 800 字符上限作为摘要；没有新增第二套 card、状态、时钟、网络请求或旧 7420 fallback。纯投影门禁新增 MCP、Web Search、计划、创建子任务和补充指令的联合断言；CDP 浏览器门禁进一步检查展开完成轮次中的标题和任务摘要，1440×900、393×852、884×1104 均为零横向溢出，手机和折叠屏命中目标不小于 44px。证据位于 `output/regression-7420/conversation-collaboration-20260830`；该证据不替代生产 7420、Android、物理折叠屏或系统辅助技术验证。

**完成快照结构活动状态审计（2026-08-30）：** App Server `ThreadItem` 中 `webSearch`、`plan`、`imageView`、review-mode transition 与 `contextCompaction` 不带 item status/时间；权威 turn 已完成时，投影曾把这些项恢复成“等待中”。现只把 completed turn 中因字段缺失而产生的 pending 活动收拢为 completed，显式 in-progress/failed/declined 继续保持协议事实。纯投影、normalizer、前端构建与固化 CDP 三视口门禁通过，展开轮次中的无状态 Web Search 显示“完成”；长会话、1600 活动、动效、触控和溢出门禁无回退。证据在 `output/regression-7420/conversation-structural-settlement-20260830`；生产 7420、Android、系统辅助技术、Git、部署与 Release 仍未完成。

**当前 App Server schema 活动审计（2026-08-30）：** 2026-08-28 的当前 CLI schema 审计中，`ThreadItem` 比仓库旧文档多出 `hookPrompt`、`dynamicToolCall` 与 `imageGeneration`。改造前唯一投影会把三者都显示为“执行活动 + 技术类型名”，既不可扫读，也让内部 hook 进入可见活动列表。当前实现把 `hookPrompt` 视为不可见内部上下文；`dynamicToolCall` 只投影有界工具标签和命名空间，不携带 arguments/content items；`imageGeneration` 只投影状态与 `savedPath`，不携带 revised prompt、result 或 base64。当前 Codex.app `26.818.5229` 的 bundle 同样把动态工具纳入工具活动适配、把图片生成作为独立 presentation，并未把 hook prompt 当成普通过程正文；固定 Sema 的“人类可读活动、内部 reasoning 不展示”仍是语义基线。失败优先用例、三视口 DOM 泄漏断言、长会话与 1600 活动门禁通过；独立 Headless Playwright 另行验证桌面、手机、粗指针折叠屏标签、载荷隔离与零横向溢出，截图和目视证据均在 `output/regression-7420/conversation-current-schema-20260830`。这是本地候选协议保真补强，不是生产、Android 或系统辅助技术证据。

**Safety Buffering 通知边界审计（2026-08-30）：** 当前生产只读诊断证明 `model/safetyBuffering/updated` 已真实出现，但它不是 Sema transcript item。当前 live schema 将其限定为 turn identity、模型、原因、用途与 `showBufferingUi`；Codex.app 只在所属 turn 仍执行时把它作为 Composer 上方安全等待提示。7420 本轮仅修正“官方通知被误报为未知”的诊断分类，并用纯投影断言它不得生成活动、过程正文或 final；在没有完整丢弃/重试动作所有权前不新增 Banner。这样既保留协议漂移可观测性，也不把 Codex.app 的宿主状态误并入固定 Sema 会话语义，更不复用 7420 旧推断。

**完整官方通知分类审计（2026-08-30）：** 当前 live `ServerNotification.json` 共 75 个 method；与诊断分类器逐项比对后，确认严格审批复核、外部 Agent 导入进度、项目变化、线程环境连接/断开、项目/队列/设置变化、线程回退和 `turn/moderationMetadata` 共 10 个官方 method 会被误报为未知，`thread/deleted` 已由既有后缀规则覆盖。实现只补齐 known 分类并把 75 项完整集合固化进 server smoke；moderation metadata 与 safety buffering 一样保持 turn 宿主元数据身份，纯投影断言其正文不得进入活动、commentary 或 final。当前对比结果为 `OfficialCount=75`、`UnknownOfficial=[]`，未增加界面、运行状态或 7420 兼容分支。

#### UX-30：Turn-based Conversation

**目标：** 只消费 UX-25 的 `ConversationProjection`，实现当前过程可见、完成过程安静、最终结论突出，并删除旧 Conversation 逻辑。

**优先范围：** `ThreadConversation.vue`、新 turn/activity/file/final 呈现 module、滚动和虚拟化接入、旧实现删除、静态禁止门禁。

**步骤：**

1. `ThreadConversation.vue` 只负责窗口化、滚动、投影列表编排和交互意图回传；turn、activity、elapsed、final、file summary 及 approval/input/MCP 的呈现字段全部来自 UX-25 interface，组件内禁止解析原始 server request。
2. 活跃 turn 默认展开最近两段公开 commentary；技术操作通过显式详情入口按需挂载。ActivityGroup 保留投影顺序；完成 turn 默认折叠为唯一 ActivitySummary，受保护的阅读窗口不自动撤回。
3. commentary 与 ActivityGroup 严格按投影块顺序呈现；`running`、`waiting`、`queued` 和 `sync-degraded` 都属于活动轮次，恢复态不得被误折叠或绕过长会话窗口上限。
3. 最终回复使用独立正文层级；审批、失败、等待输入和 writer collision 始终在第一层。
4. 文件变更、命令、diff、MCP、search、plan 和未知 payload 使用一致的摘要/详情模式。
5. 删除阶段回复计数、last-assistant final、`Worked for`/命令累计耗时、旧 guided folding、Teleport 过程浮层和旧 fileChange 隐藏分支。
6. 增加静态禁止门禁，阻止上述旧模式、旧根级开关或绕过投影 interface 的新代码回流。
7. 验证流式更新、历史加载、虚拟化、滚动离底、返回最新、前台恢复、手机和折叠屏。

**验收：**

- `ThreadConversation.vue` 只接收 `ConversationProjection`，不出现 `UiMessage`、原始请求解析、旧 final/elapsed/folding 或 Teleport 标记；收藏和计划执行只回传窄类型意图。
- commentary 与投影 `activityGroups` 保持原事件顺序；活动轮次公开进展固定展开、操作详情按需，完成轮次过程默认收起但受保护阅读不撤回，显式 final、文件摘要与待处理交互保持独立层级。
- `sync-degraded` 显示明确恢复状态、固定展开且不可误折叠；1600 项活动仍只挂载最近 18 项，浏览器采样窗口主线程长任务小于 80ms。
- 桌面、393×852 手机和 884×1104 折叠屏夹具无横向溢出；手机和折叠屏可见交互目标不低于 44px；reduced-motion 下无持续动画。

**本地候选证据（2026-08-30）：** `ThreadConversation.vue` 已移除对旧 `UiMessage` 的兼容包装，收藏与计划执行分别使用 `ConversationFavoriteIntent` 和 `ConversationPlanImplementationIntent`；commentary 与 `activityGroups` 现在按 `ConversationProjection.blocks` 原顺序呈现，活动组只提供结构边界，不新增卡片或装饰。`sync-degraded` 已纳入活动轮次，恢复过程固定展开且沿用 18 项挂载上限。静态门禁明确禁止 `UiMessage`、`toUiMessage`、`toPlanMessage` 及既有旧逻辑标记。`verify:conversation-transcript` 通过（1602 turns 19.8ms；1600 activities 4.8ms），frontend normalizers、`vue-tsc --noEmit`、生产前端构建、无 BOM 脚本的 UTF-8 BOM 等价 `-SourceOnly` 门禁和 `git diff --check` 均通过。CDP 回归覆盖桌面、393×852 手机与 884×1104 折叠屏，显式 final、完成态折叠、五类首层交互、文件摘要、活动组、reduced-motion 和零横向溢出均通过；1600 项流式压力轮只挂载 18 项，70 次更新、67 次心跳期间 `maxLongTaskMs=0`、最大心跳延迟 79ms、操作仍响应。恢复专用夹具为 1 个 active `sync-degraded` turn、1600 项投影/18 项挂载、0 横向溢出。独立 Playwright 1.55 使用本机 Chrome 等待真实恢复状态后截图并已目视复核，证据在 `output/ux30-conversation/conversation-sync-degraded-playwright.png`。这是 UX-30 本地候选完成；未验证真实 7420、Android 真机、系统屏幕阅读器、远端 CI、部署或 Release，总目标继续保持未完成。

**长会话门禁补强（2026-08-30）：** 审计发现上段的 1600 项浏览器压力只覆盖单轮活动窗口，不能证明“1602 条消息可见节点 ≤20”。`ThreadConversation.vue` 现直接在 `ConversationProjection.turns` 上恢复有界轮次虚拟化：动态测高、顶部/底部 spacer、用户阅读锚点和单一 `overflow-anchor: none` 滚动所有者，最多挂载 10 个 turn；没有恢复 `UiMessage`、旧 final/elapsed/folding 或尾部浮层。新增 801 轮/1602 条消息夹具在底部、顶部和中段都挂载 10 个 turn/20 条消息，流式尾部 78 次更新、70 次心跳、最大排队延迟 29ms、`maxLongTaskMs=0`，交互后输出继续且横向溢出为 0；原 1600 活动和 `sync-degraded` 场景同时通过。静态门禁禁止再次直接遍历全部 projected turns。CDP 证据与独立 Headless Playwright 截图位于 `output/ux30-turn-virtualization-20260830`；这仍是隔离本地候选，不替代真实缓存首屏、生产 7420 或 Android 真机。

**回退与历史所有权审计（2026-08-30）：** UI 已从 projected turn 发出回退意图，但状态层仍曾使用旧 `UiMessage[]` 计算最末轮、回退轮数、worktree 提示和较早历史锚点；成功 RPC 也只更新旧消息缓存，使新投影继续显示被移除的结构化 turn。当前实现把四个判定全部收敛到 `ConversationProjection`，并用 `thread/rollback` 返回的结构化 `threadRead` 原子替换旧页面、丢弃回退前通知后再做权威刷新。最近窗口后的实时 turn 使用绝对索引续排；失败优先用例证明旧实现把 `[10, 11]` 后的新 turn 错排为 `2`，修复后为 `12`。Codex.app `26.818.5229` 仅作为安全复核，确认其也把 rollback response 直接应用到结构会话存储；可见交互仍保持固定 Sema 风格的轻量内联两步确认。`verify:conversation-transcript`、frontend source-only 和 `build:frontend` 通过，393×852 Headless Playwright 验证首次激活变为“确认回退”、第二次才发出意图且无 page error；截图在 `output/codex-app-parity/sema-rollback-confirmation-phone-20260830.png`。这仍不替代真实 7420 回退、Android、系统辅助技术、Git、部署或 Release。

- 活跃 turn 过程展开；完成 turn 默认只有一个过程摘要。
- 最终答复来自投影中的明确 final，不因过程折叠而隐藏；没有 final 时显示中断/失败/缺失，审批可直接操作。
- 完成 turn 显示 active elapsed 和文件变更摘要；展开过程后活动顺序、状态和目标与权威事实一致。
- 1602 条消息可见节点 ≤20，滚动与增量输出窗口内最长主线程阻塞 <80ms；冷导航诊断不得替代独立的缓存首屏 ≤300ms 证据。
- 两次相同文本的用户输入仍是两个独立消息，不被错误去重。
- 较早历史请求、回退目标、回退轮数和回退后的可见会话都以 `ConversationProjection` 与 RPC 结构化响应为准；不得读取旧扁平消息索引或正文作决定。
- 静态禁止门禁证明生产路径不存在旧会话推断、旧过程浮层和运行时回退分支。

**回滚：** 通过版本控制整体恢复 UX-25/UX-30 改造前版本；产品运行时不保留旧 Conversation 分支或切换开关。

#### UX-40：Compact Composer

**目标：** 输入区更轻、更像工具，同时不牺牲移动输入和恢复。

**优先文件：** `ThreadComposer.vue`、现有 Composer dropdown/picker、局部样式。

**步骤：**

1. 收敛圆角、阴影、内边距和控制顺序。
2. 保持模式、模型、权限、上下文和发送/停止的有效状态可见。
3. 让附件、队列和失败恢复沿用各自状态所有权。
4. 验证 IME、桌面/手机 Enter、长输入增长、软键盘和安全区。

**验收：**

- 393×852 下输入、附件、模型、权限和发送/停止无重叠。
- 队列仍支持编辑、删除、重排、Steer 和首失败暂停。
- 发送失败不消失、不制造 thread failure、不自动重复发送。
- 本地输入和发送反馈 ≤100ms。

**本地验收（2026-08-30）：** Composer 按固定 Sema 提交收敛为与 48rem Transcript 同轴的 12px 轻边框、无默认阴影双层工具壳；桌面、393×852 手机和 884×1104 粗指针折叠屏均保持输入在上、控制在下且横向溢出为 0，手机/折叠屏控制目标最小 44px。五行输入自然增长，二十行在 128px 封顶，清空后回缩，显式展开仍可达半屏；IME composing/229 不提交或误选，语音结果只写入可编辑 draft，桌面 Enter 提交、Shift+Enter 换行，手机 Enter 换行、Ctrl+Enter 提交。附件与 Runtime 面板在桌面保持非模态，在手机保持 focus、`aria-modal`、背景滚动锁定和关闭后焦点恢复；页面内可见发送反馈为 12.8-12.9ms。审计同时发现原队列虽有服务端重排能力却没有可达入口，因此新增仅在“全部已持久化、单一所有者、未处理、首条未失败”时出现的上下移动作；393×852 实际完成下移反转与上移恢复，按钮 44×44、零溢出，并复用现有持久化与服务端 409 顺序收敛。编辑、删除、引用立即执行（Steer）与首失败暂停继续沿用原所有者。类型检查、前端构建、UTF-8 源码契约门禁和浏览器断言通过，截图位于 `output/regression-7420/quiet-composer-audit-20260830`。这是本地候选完成，不代表生产 7420、Android、Git 或 Release 完成。
**回滚：** 仅回退 Composer 布局/样式；draft、outbox、queue 和 runtime send 代码不迁移。

#### UX-50：Artifact Inspector 准入与可选实现

**目标：** 先证明价值，再决定是否增加右侧详情面板。

**步骤：**

1. 用低保真原型比较 inline、modal 和右栏三种文件/diff 审阅路径。
2. 按 7.8 的四条准入标准记录 go/no-go。
3. No-go 时只优化现有详情，不实现右栏。
4. Go 时实现默认关闭、只读、路由无关、1024px 以下覆盖层的 Inspector。

**验收：**

- 有明确 go/no-go 记录。
- Go 实现不新增权限、文件状态、Runtime 状态或移动固定栏。
- 关闭 Inspector 后阅读位置、焦点和任务状态不变。

**准入决定（2026-08-30）：No-go。** 当前文件变更行默认可见、diff 按文件原位展开，命令输出、计划和完成过程均按需披露；审计没有找到两个被这些 inline 详情明显打断的高频任务，因此标准 1 不成立。低保真路径比较中，inline 从所属 turn 一次点击即可查看且不离开阅读位置，modal 与右栏同样至少需要一次打开动作；右栏没有证明比 inline/modal 少一次以上上下文切换，因此标准 2 不成立。1024px 以下覆盖层和只读无新权限在技术上可满足标准 3/4，但四项必须同时成立。依据 7.8 保留现有 inline/modal，不建设 Inspector、不新增入口、状态、权限、持久化或移动固定栏；No-go 不阻塞 Phase 1。
**回滚：** 移除 Inspector 入口和呈现组件即可；原 inline/modal 详情继续可用。

#### UX-60：响应式、主题与可访问性硬化

**目标：** 证明“更紧凑”没有变成“更难用”。

**步骤：**

1. 覆盖五个目标视口、浅色、深色、forced-colors 和 reduced-motion。
2. 检查主 landmark、导航名称、弹层 focus trap、关闭后 focus return 和 Android Back 优先级。
3. 检查所有 icon-only 控件名称、菜单键盘行为和隐藏控件 hit testing。
4. 只把本轮触及的旧主题规则迁移到语义 token。

**验收：**

- 所有目标视口无核心横向溢出。
- 必要文字 WCAG AA；状态不只靠颜色。
- modal 打开时背景不进入 Tab 或辅助技术导航。
- reduced-motion 下无持续装饰动画，功能反馈仍然存在。

**本地验收（2026-08-30）：** 固化 `hardening` 浏览器门禁覆盖 1440×900、884×1104、768×1024、393×852 与 852×393 五个视口的浅色/深色主题；十个组合均无横向溢出、重复 ID、无名称的可见控件、隐藏命中目标或低于 WCAG AA 的抽样必要文字，状态同时保留文本。粗指针侧栏调宽轨仍为 6px 视觉宽度，但有效命中宽度为 44px；forced-colors 下使用真实键盘 Tab 聚焦调宽轨并得到 2px 可见轮廓；reduced-motion 下没有持续动画。手机抽屉具有命名 dialog/`aria-modal`、背景 `inert` 与滚动锁，Tab/Shift+Tab 双向闭环，关闭后解除隔离并把焦点归还菜单按钮。审计修复了活动任务时间文字对比度、深色状态底色、粗指针菜单/调宽命中区和 forced-colors 焦点轮廓；没有新增 UI、状态模型或重型依赖。独立 Headless Playwright 的 768×1024 截图与 CDP 证据位于 `output/regression-7420/ux60-final-20260830` 和 `output/regression-7420/ux60-hardening-20260830`，关键截图已人工复核。这只关闭本地 UX-60 任务包；真实 Windows 高对比度、系统屏幕阅读器、Android 真机、生产 7420、Git 与 Release 仍未完成。
**回滚：** 语义 token 与组件变更按任务包回退；不做不可逆主题迁移。

#### UX-70：候选验证与文档收口

**目标：** 形成可审查的本地候选，不自动发布。

**最小验证矩阵：**

```powershell
git diff --check
npm.cmd run verify:governance
npm.cmd run build:frontend
npm.cmd run verify:conversation-transcript
npm.cmd run verify:frontend-normalizers
npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420
npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420
```

`verify:conversation-transcript` 由 UX-25 建立，在 UX-25 尚未实施前不应伪造为空命令。若任务包触及 server/runtime 模块，追加：

```powershell
npm.cmd run build:cli
npm.cmd run verify:server-modules
```

若声明 Android 完成，追加现有 Android policy 测试与真实设备的前后台、锁屏、旋转、软键盘和恢复证据。桌面浏览器的 393×852 截图不能替代真机。

**完成标准：**

- 记录所有命令、结果、截图目录和已知偏离。
- 更新 `tests.md` 中用户可见行为与手工验证契约。
**本地候选验收（2026-08-30）：** 隔离候选 `http://127.0.0.1:17438` 已通过 PowerShell 7.5.5 驱动的 frontend source-only 与完整浏览器矩阵；覆盖桌面、手机、884×1104 折叠屏、侧栏搜索/锚点/当前会话揭示、命令面板焦点、Composer、五类首层交互、队列恢复、1600 活动流式压力、长会话虚拟化及“返回最新消息”。专用返回最新夹具验证点击后滚动距离归零、按钮消失且焦点归还；801 轮/1602 条消息最多挂载 10 轮/20 条消息，离屏第 400 轮可定位，高位 prepend 从 761 增至 801 轮时阅读锚点漂移 5.875px。`verify:conversation-transcript` 为 1602 轮 20.7ms、1600 活动 5.7ms；governance、frontend build、frontend normalizers、CLI build、server modules、sidebar data 与 `git diff --check` 均通过。App Server 会话列表按稳定 ID 保留首项并对分页结果幂等去重；候选侧栏读取 289 个活动会话、首屏 100 项和 23 个项目组，页内无重复，跨游标重叠被记录并只展示一次。此结论只关闭 UX-70 的本地候选任务包；当前生产 7420 仍不是该候选，Android 真机、物理折叠屏、系统辅助技术、远端 CI、Git、部署与 Release 均未完成。
- 不把本地候选、生产 7420、远端 CI、正式 Release 和 Android 真机证据混为一谈。
- 没有用户明确授权时，到本地候选即停止。

### 7.12 状态验收清单

每个受影响表面至少覆盖：

- Empty / loading / cached / stale / partial / failed。
- Connecting / reconnecting / recovery timeout / offline。
- Idle / starting / running / streaming / waiting input / completed / interrupted。
- Pending approval / approval failure / writer collision / spectator read。
- Sending / confirmation pending / waiting network / failed / retrying。
- Queued / paused / editing / reordering / Steer / restored after failed Steer。
- Attachment selected / uploading / failed / loaded。
- Long Markdown / code / table / image / diff / MCP / unknown payload。
- 1600+ 消息、阅读历史离底、回到最新、线程切换和前台恢复。

### 7.13 风险与应对

| 风险 | 早期信号 | 应对 |
| --- | --- | --- |
| 新投影误伤恢复逻辑 | UI module 直接读取 Runtime、localStorage，或旧 normalizer 继续做语义裁剪 | 单一 Conversation Transcript seam；权威事实输入；实时/刷新/重放等价测试 |
| 为了简洁隐藏关键状态 | 审批、失败或单写者只在展开后出现 | 关键状态固定第一层，普通过程才折叠 |
| Sidebar 变紧后难以识别任务 | 标题截断、状态 chip 拥挤、行高跳动 | 固定 row 变体、完整 title、状态优先、5 秒任务测试 |
| Sema 布局破坏手机 | 小屏仍保留多栏或右栏压缩正文 | <768px 强制单栏；Inspector 转 sheet/overlay |
| 暗色主题继续分叉 | 新组件同时写 token 和 `zinc-*` 覆盖 | 新组件只用 token，触及一处迁移一处 |
| 双套 UI 长期共存 | 出现旧 adapter、双读、双写、根级开关或兼容测试 | 不进入候选；整体版本回滚；新 interface 测试建立后删除旧分支和旧实现细节测试 |
| 只换外观没有换语义 | TurnGroup 仍从旧 `UiMessage[]`、last assistant 或 `Worked for` 推算 | UX-25 必须先通过；UX-30 只能消费 `ConversationProjection`；静态禁止门禁 |
| 性能因分组/动画回退 | 每个 delta 触发整组重算或布局动画 | 保留批处理、虚拟化和结构变化判断；动效只用 transform/opacity |
| Inspector 演化成 IDE | 增加编辑、终端、文件树或新持久化 | 准入审查；严格只读；超范围另立 PRD |
| 旧计划与新 PRD 冲突 | Codex 同时执行两份阶段编号 | 本文为当前 UI 执行入口，旧文档仅作历史参考 |

## 8. Release

### Phase 0：Contract

交付 UX-00。建立 `DESIGN.md`、Sema 固定源码映射、多视口基线和稳定验收入口。不改变用户可见行为。

### Phase 1：Quiet Core

依次交付 UX-10、UX-20、UX-25、UX-30、UX-40。先完成新 Conversation Transcript module，再形成新的 Shell、Sidebar、Conversation 和 Composer 核心体验。这是本 PRD 的最小可发布范围。

退出条件：KR1–KR12 均通过，旧会话语义和运行时回退已删除，且没有消息、队列、审批、恢复和长会话性能回归。

### Phase 2：Review Surface

执行 UX-50 准入。Go 则实现只读 Inspector；No-go 则记录决定并优化现有 inline/modal。No-go 不阻塞 Phase 1 发布。

### Phase 3：Hardening

交付 UX-60、UX-70，完成主题、响应式、可访问性、截图和候选验证。

### Phase 4：Release Decision

由产品负责人单独决定是否提交、推送到 `beta`、运行远端 CI、制作 Android 包或发布正式版本。`beta` 通过不等于正式 Release；浏览器通过不等于 Android 真机通过。

### 发布后观察

不新增云端遥测。使用本地、无内容的 timing/identifier 证据和用户反馈观察：

- 首条消息可见反馈。
- 缓存首屏和前台恢复。
- 任务查找耗时。
- Sidebar 搜索失败率和恢复动作。
- 发送失败、队列暂停和 writer collision 的可恢复率。
- 1600+ 消息心跳延迟、可见节点和横向溢出。

若消息正确性、审批可见性、恢复或移动可用性任一高优先级指标回退，立即回滚对应任务包，不用后续视觉微调抵消。

## Appendix A：Definition of Done

一个任务包只有同时满足以下条件才可标记完成：

- 用户故事和明确非目标均未越界。
- 参考了当前 Codex.app 对应行为，并记录允许偏离。
- 代码只修改允许范围，未覆盖工作区已有改动。
- 对应状态矩阵、视口和最小命令通过。
- 截图经过人工检查，不只依赖像素或 DOM 数字。
- 关键状态具有可访问名称、键盘路径和恢复动作。
- 性能数据来自页面/浏览器内部指标，不把外部轮询时间当产品时间。
- 交付说明写明本地、生产、CI、Release、Android 真机各自证据状态。
- 没有把临时兼容分支、调试开关或重复样式留作永久架构。
- `sema-code-core` 固定源码映射、`ConversationProjection` interface 测试和旧逻辑清零门禁均有可复查证据。

## Appendix B：停止条件

出现以下任一情况，停止当前任务包并报告证据：

- 需要改变 Runtime Store、队列、outbox、审批执行或通知所有权；为结构事件保真而调整有界 DTO/trim 不属于该停止条件，但必须由 UX-25 测试覆盖。
- 需要覆盖、删除或重置用户已有改动。
- 同一消息、审批或队列出现丢失、重复、错误排序或假成功。
- 393×852 无法在不牺牲主操作的情况下消除横向溢出。
- 1600 条消息可见节点超过 20 或最长阻塞达到 80ms 及以上。
- 需要引入新的重型 UI 依赖或第二套全局状态。
- 需要提交、推送、部署、发布或真实设备权限，而用户尚未授权。

## Appendix C：可直接交给 Codex 的执行提示词

首次执行：

```text
请阅读 AGENTS.md、PRODUCT_GOAL.md、PRODUCT.md、PROJECT_SPEC.md 和
docs/PRD-CX-Codex-Quiet-Workbench.md，只执行 UX-00。
保留现有工作区改动，不提交、不推送、不部署。
先按固定提交建立 sema-code-core 源码映射，再检查当前 Codex.app 和 CX 多视口基线，建立 DESIGN.md 与回归证据。
按 UX-00 的验收、回滚和停止条件完成，最后报告精确改动与验证结果。
```

后续执行：

```text
请阅读 docs/PRD-CX-Codex-Quiet-Workbench.md，只执行首个已满足依赖且未完成的任务包。
会话任务必须以固定 sema-code-core 源码为强制参考并执行“替换，不叠加”；不得复用 7420 旧会话归并、final/elapsed 推断、阶段折叠、过程浮层或 fileChange 丢弃逻辑，不保留运行时回退。
不要顺带执行下一包，不改变 Runtime Store、队列、outbox、审批执行或恢复所有权。
完成后按该任务包的验收矩阵验证，并报告本地、浏览器、生产、CI、Release、Android 证据边界。
```
