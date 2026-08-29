# PRD：CX-Codex 安静工作台（UI/UX VNext）

> 文档状态：UX-00 至 UX-70 已完成；已获产品负责人授权继续完成 `PRODUCT_GOAL.md` 发布门槛并发布
>
> 版本：1.0
>
> 日期：2026-08-29
>
> 产品范围：CX-Codex 浏览器端与 Android WebView 共用前端
>
> 实施方式：Codex 按本文任务包顺序、小步执行、逐包验证
>
> 授权边界：允许按本文修改、验证、提交、推送并在全部门槛满足后发布；不得跳过安全、Runtime、Android、CI 或 Release 门槛

## 0. Codex 执行契约

本文不只是方向文档，也是后续 Codex 的执行入口。实施者必须遵守以下规则：

1. 开始前依次阅读仓库 `AGENTS.md`、`PRODUCT_GOAL.md`、`PRODUCT.md`、`PROJECT_SPEC.md` 和本文。
2. `PRODUCT_GOAL.md` 的安全、可靠性、性能与发布门槛高于本文；冲突时以前者为准。
3. 每次只执行一个任务包。不得把“视觉统一”扩大为框架迁移、状态重写或全仓重构。
4. UI 行为先核对当前安装版 Codex.app，再参考 Sema。Sema 是交互和密度参考，不是新的产品或运行时权威。
5. 不改变 Codex App Server、Runtime Store、durable outbox、`clientMessageId`、通知序列、队列、审批、单写者和 Android 恢复的所有权。
6. 保留工作区已有改动。没有用户明确要求时，不提交、不推送、不切分支、不部署、不发布。
7. 每个任务包先记录基线，再修改，再运行该包最小验证；基线失败时先判断是否为既有问题，不用 UI 改动掩盖真实状态。
8. 任何状态都不能只靠颜色表达；审批、失败、离线、恢复和单写者冲突不能因“界面更干净”而被折叠到不可发现。
9. 新依赖默认不允许。确需引入时，必须说明体积、替代复杂度、移动端兼容性和移除路径。
10. 完成一个任务包后，在交付说明中列出：改动范围、视觉证据、行为证据、性能证据、已知偏离和回滚点。

### 文档优先级

后续 UI/UX 实施按以下顺序解释需求：

1. `PRODUCT_GOAL.md`：产品目标、禁止范围和强制门槛。
2. 本 PRD：当前 UI/UX VNext 的产品决策和实施顺序。
3. `PRODUCT.md`、`PROJECT_SPEC.md`：产品性格和已验证架构事实。
4. `docs/ui-ux-audit-20260808.zh-CN.md`：当前已验证能力和历史证据。
5. `docs/frontend-ui-remediation-plan.zh-CN.md`、`docs/desktop-parity-ui-plan.zh-CN.md`：历史方向参考；与本文冲突时以本文为准。

## 1. Summary

### 1.1 一句话目标

把 CX-Codex 从“功能完整、可靠，但导航和会话层级偏重”的控制台，收敛为一个更像 Codex、具备 Sema 式清晰密度、同时保留 CX 移动与恢复优势的安静工程工作台。

### 1.2 产品判断

有必要整改，但没有必要重写。

当前 CX-Codex 的可靠性、移动适配、长会话性能和恢复能力是产品壁垒；真正需要解决的是桌面端的信息层级、视觉重量和组件维护边界。全量照搬 Sema 会破坏现有移动端和状态可靠性，也会把产品带向固定三栏 IDE。因此采用渐进式路线：

- 必做：设计契约、Shell、Sidebar、Conversation、Composer 的层级收敛。
- 后置：只读 Artifact Inspector，经准入验证后再做。
- 不做：React/Tailwind 架构迁移、Sema Runtime 接入、固定三栏、全功能 IDE、状态层重写。

### 1.3 参考策略

| 参考来源 | 借鉴内容 | 不借鉴内容 |
| --- | --- | --- |
| 当前 Codex.app | 任务状态、队列、审批、工作过程、焦点、弹层、恢复和可访问性行为 | 私有源码、私有资源、无法验证的内部实现 |
| Sema Code Core | 44px 顶栏、紧凑导航、约 768px 阅读列、轻量 Composer、完成后折叠中间过程、文件/工具摘要、按需右侧面板 | React 架构、固定三栏移动布局、Sema Runtime/Agent/数据模型、品牌资产 |
| CX-Codex 当前实现 | durable outbox、Runtime Store、移动单栏/折叠屏、长会话虚拟化、恢复、附件、计划、队列和诊断 | 过大的页面组件、重复状态呈现、偏宽侧栏、偏重 Composer、历史逐选择器主题覆盖 |

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

在不降低消息正确性、任务恢复、移动端可用性和安全边界的前提下，让用户更快找到任务、更快理解 Codex 当前在做什么，并把最终结果和需要人工处理的动作放到视觉第一层。

### 4.2 SMART Key Results

| KR | 指标 | 目标 |
| --- | --- | --- |
| KR1 主路径清晰 | 在包含至少 5 个项目、30 个会话、运行/等待/未读混合状态的固定夹具中找到指定任务 | 5 秒内完成；不需要打开二级设置 |
| KR2 输入清晰 | 从首页选择项目、输入并发送首条消息 | 主操作始终可见；本地可见反馈不超过 100ms |
| KR3 过程降噪 | 已完成 turn 的 reasoning/tool/command 默认呈现 | 合并为一个可展开过程摘要；最终回复与待处理审批不被折叠 |
| KR4 视觉密度 | 1440×900 桌面首屏 | 默认侧栏约 288px、顶栏 44px、阅读列约 800px；核心内容不溢出 |
| KR5 响应式 | 393×852、852×393、768×1024、884×1104、1440×900 | 无核心横向溢出、不可达操作或被 Composer 遮挡的最后内容 |
| KR6 性能不回退 | 缓存首屏、前台恢复、1600 条消息压力 | 缓存首屏 ≤300ms；恢复 P95 ≤2s；最长主线程阻塞 <80ms；可见消息节点 ≤20 |
| KR7 状态正确 | 队列、审批、失败、离线、恢复、单写者冲突固定夹具 | 状态、动作和顺序与权威快照一致；无丢失、重复或假成功 |
| KR8 可访问性 | 键盘、屏幕阅读器语义、forced-colors、reduced-motion | 所有可见控件有名称；焦点不丢失；必要文本对比度达到 WCAG AA |
| KR9 可维护性 | 新增或提取的 UI 组件 | 单一呈现职责、props/events 明确；不得新增全局状态权威或重复持久化 |

### 4.3 成功不等于什么

- 不是截图看起来相似就算成功。
- 不是通过构建就算完成浏览器或 Android 验证。
- 不是把状态藏起来就算“更简洁”。
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
7. 兼容优先：新 UI 只消费现有规范化数据，不绕过 normalizer、Runtime Store 或 App Server。

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
| Composer | 与 800px 阅读列对齐 | 桌面约 88–96px 初始高度，内容增长有上限 |
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
- 当前 turn 的 reasoning、tool、command 和进度保持展开，显示一个稳定的已工作时长和最新活动。
- turn 完成后，中间过程自动收敛为一个 ActivitySummary；最终答复、文件变更摘要和待处理动作留在第一层。
- 两个及以上连续工具操作合并为 ActivityGroup，默认显示“读取 / 编辑 / 执行”的摘要和最新目标。
- 文件变更显示文件数、增删统计和结果状态；详情按需展开。
- 审批、失败、等待输入和单写者冲突永远不随普通过程摘要一起折叠。
- 未识别 payload 保留可访问的诊断入口，但默认收起且不直接展示原始 JSON。
- 继续使用现有虚拟化、滚动锚点、24px 尾部阈值、返回最新输出和前台恢复策略。
- 不按文本去重消息；消息身份继续来自 item/turn/clientMessageId 等强身份。

建议逐步提取的纯呈现组件：

- `TurnGroup.vue`
- `ActivitySummary.vue`
- `ActivityGroup.vue`
- `FileChangeSummary.vue`
- `TurnActions.vue`

这些组件只接收规范化 props 并发出用户意图，不请求 Runtime、不持久化状态、不创建新的消息模型。

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
- `useDesktopState.ts` 保持编排边界；纯呈现拆分不能把网络请求下沉到 UI 小组件。
- 大文件的拆分以“独立责任 + 独立验证”为准，不以达到任意行数为目标。

### 7.10 Sema 源码参考地图

| 参考点 | 固定源码 | CX 用法 |
| --- | --- | --- |
| Shell 和可调面板 | [`App.tsx`](https://github.com/midea-ai/sema-code-core/blob/f564e8d930053becdd5c31fe53f65fd863b6f283/webui/client/src/app/App.tsx) | 参考 256px 侧栏、按需右栏和面板 resize；CX 使用更宽的 288px 默认并保留移动抽屉 |
| 中性色与 14px UI | [`index.css`](https://github.com/midea-ai/sema-code-core/blob/f564e8d930053becdd5c31fe53f65fd863b6f283/webui/client/src/index.css) | 参考低噪声色阶和正文密度；不替换 CX 已验证的 AA token |
| 紧凑导航 | [`Sidebar.tsx`](https://github.com/midea-ai/sema-code-core/blob/f564e8d930053becdd5c31fe53f65fd863b6f283/webui/client/src/features/sidebar/Sidebar.tsx) | 参考 32/28px 行、平面 hover/active 和项目树层级 |
| 44px 顶栏、约 768px 对话列、turn 分组 | [`ChatView.tsx`](https://github.com/midea-ai/sema-code-core/blob/f564e8d930053becdd5c31fe53f65fd863b6f283/webui/client/src/features/chat/ChatView.tsx) | 参考顶栏、阅读列和完成后过程折叠 |
| 轻量双层输入区 | [`Composer.tsx`](https://github.com/midea-ai/sema-code-core/blob/f564e8d930053becdd5c31fe53f65fd863b6f283/webui/client/src/features/chat/Composer.tsx) | 参考 52px 输入 + 44px 控制条、紧凑 dropdown 和 token 状态 |
| 工具/文件摘要 | [`Blocks.tsx`](https://github.com/midea-ai/sema-code-core/blob/f564e8d930053becdd5c31fe53f65fd863b6f283/webui/client/src/features/chat/Blocks.tsx) | 参考 tool verb、目标、diff stat、ActivityGroup 和 FileChangesCard |
| 小型 UI primitives | [`common/ui.tsx`](https://github.com/midea-ai/sema-code-core/blob/f564e8d930053becdd5c31fe53f65fd863b6f283/webui/client/src/common/ui.tsx) | 参考 Button/Popover/Menu/Dropdown/Toggle 的小边界，不引入 React 实现 |

### 7.11 工作包与执行顺序

| ID | 名称 | 依赖 | 发布必要性 | 状态 |
| --- | --- | --- | --- | --- |
| UX-00 | 设计契约与回归基线 | 无 | 必须 | 已完成 |
| UX-10 | Quiet Shell 与 Header | UX-00 | 必须 | 已完成 |
| UX-20 | Sidebar 信息架构 | UX-10 | 必须 | 已完成 |
| UX-30 | Turn-based Conversation | UX-10 | 必须 | 已完成 |
| UX-40 | Compact Composer | UX-10、UX-30 | 必须 | 已完成 |
| UX-50 | Artifact Inspector 准入与可选实现 | UX-30 | 条件 | 已完成（No-go） |
| UX-60 | 响应式、主题与可访问性硬化 | UX-20、UX-30、UX-40；可含 UX-50 | 必须 | 已完成 |
| UX-70 | 候选验证与文档收口 | UX-60 | 必须 | 已完成（隔离候选完整门禁通过） |

任务包只有在验收证据已记录后才能把状态改为“已完成”；实现开始但验收未结束时标记为“进行中”，不得提前跳过依赖。

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

**回滚：** 删除新增设计/基线文件即可，不影响运行时。

#### UX-10：Quiet Shell 与 Header

**目标：** 第一眼从“Web 控制台”变成安静工作台。

**优先文件：** `src/style.css`、`src/App.vue`、`src/components/layout/DesktopLayout.vue`、`src/components/content/ContentHeader.vue`。

**步骤：**

1. 把桌面新默认收敛为 Sidebar 288px、Topbar 44px、Reading/Composer 800px。
2. 保留已有显式侧栏宽度并安全裁剪；不覆盖用户桌面偏好。
3. 收敛首页空状态、Header 和 Composer 的共同轴线。
4. 移除重复连接/运行反馈，只保留各自状态所有者。
5. 截图对比浅色、深色、桌面和手机。

**验收：**

- 1440×900 主内容、Header 和 Composer 对齐。
- 393×852 和 852×393 不出现横向溢出或内容遮挡。
- Header 状态变化不引发布局跳动。
- 发送、连接、恢复状态仍能通过文本或可访问名称区分。

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

#### UX-30：Turn-based Conversation

**目标：** 当前过程可见、完成过程安静、最终结论突出。

**优先文件：** `ThreadConversation.vue` 和新增纯呈现子组件；非必要不修改 normalizer 和类型。

**步骤：**

1. 用现有 turn/item 身份建立 TurnGroup 呈现，不新建消息数据模型。
2. 实现稳定 ActivitySummary 和两个以上工具的 ActivityGroup。
3. 保持审批、失败、等待输入和 writer collision 在第一层。
4. 文件变更、命令、diff、MCP 和 raw payload 使用一致的摘要/详情模式。
5. 验证流式更新、历史加载、虚拟化、滚动离底、返回最新和前台恢复。

**验收：**

- 活跃 turn 过程展开；完成 turn 默认只有一个过程摘要。
- 最终答复不因过程折叠而隐藏；审批可直接操作。
- 1602 条消息可见节点 ≤20，最长主线程阻塞 <80ms。
- 两次相同文本的用户输入仍是两个独立消息，不被错误去重。

**回滚：** 保留原始规范化消息和现有渲染分支，可按根级呈现开关一次切回；开关不得成为长期用户设置，验证完成后删除。

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

**回滚：** 语义 token 与组件变更按任务包回退；不做不可逆主题迁移。

#### UX-70：候选验证与文档收口

**目标：** 形成可审查的本地候选，不自动发布。

**最小验证矩阵：**

```powershell
git diff --check
npm.cmd run verify:governance
npm.cmd run build:frontend
npm.cmd run verify:frontend-normalizers
npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420
npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420
```

若任务包触及 server/runtime 模块，追加：

```powershell
npm.cmd run build:cli
npm.cmd run verify:server-modules
```

若声明 Android 完成，追加现有 Android policy 测试与真实设备的前后台、锁屏、旋转、软键盘和恢复证据。桌面浏览器的 393×852 截图不能替代真机。

**完成标准：**

- 记录所有命令、结果、截图目录和已知偏离。
- 更新 `tests.md` 中用户可见行为与手工验证契约。
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
| 视觉重构误伤恢复逻辑 | UI 组件开始直接读取 Runtime、localStorage 或请求 API | 纯呈现子组件；状态仍由现有编排层注入 |
| 为了简洁隐藏关键状态 | 审批、失败或单写者只在展开后出现 | 关键状态固定第一层，普通过程才折叠 |
| Sidebar 变紧后难以识别任务 | 标题截断、状态 chip 拥挤、行高跳动 | 固定 row 变体、完整 title、状态优先、5 秒任务测试 |
| Sema 布局破坏手机 | 小屏仍保留多栏或右栏压缩正文 | <768px 强制单栏；Inspector 转 sheet/overlay |
| 暗色主题继续分叉 | 新组件同时写 token 和 `zinc-*` 覆盖 | 新组件只用 token，触及一处迁移一处 |
| 双套 UI 长期共存 | 临时根级开关进入用户设置或发布后保留 | 只用于任务包回归，验证后删除旧分支和开关 |
| 性能因分组/动画回退 | 每个 delta 触发整组重算或布局动画 | 保留批处理、虚拟化和结构变化判断；动效只用 transform/opacity |
| Inspector 演化成 IDE | 增加编辑、终端、文件树或新持久化 | 准入审查；严格只读；超范围另立 PRD |
| 旧计划与新 PRD 冲突 | Codex 同时执行两份阶段编号 | 本文为当前 UI 执行入口，旧文档仅作历史参考 |

## 8. Release

### Phase 0：Contract

交付 UX-00。建立 `DESIGN.md`、多视口基线和稳定验收入口。不改变用户可见行为。

### Phase 1：Quiet Core

交付 UX-10、UX-20、UX-30、UX-40。形成新的 Shell、Sidebar、Conversation 和 Composer 核心体验。这是本 PRD 的最小可发布范围。

退出条件：KR1–KR8 均通过，且没有消息、队列、审批、恢复和长会话性能回归。

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

## Appendix B：停止条件

出现以下任一情况，停止当前任务包并报告证据：

- 需要修改 Runtime/App Server/队列/outbox/通知协议才能完成纯视觉目标。
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
先检查当前 Codex.app 行为和 CX 多视口基线，再建立 DESIGN.md 与回归证据。
按 UX-00 的验收、回滚和停止条件完成，最后报告精确改动与验证结果。
```

后续执行：

```text
请阅读 docs/PRD-CX-Codex-Quiet-Workbench.md，只执行首个已满足依赖且未完成的任务包。
不要顺带执行下一包，不改变 Runtime、队列、outbox、审批或恢复所有权。
完成后按该任务包的验收矩阵验证，并报告本地、浏览器、生产、CI、Release、Android 证据边界。
```
