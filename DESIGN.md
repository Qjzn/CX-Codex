# CX-Codex Design Contract

## 文档职责

本文定义 CX-Codex 长期有效的界面与交互契约：视觉语言、布局、状态所有权、响应式、可访问性和组件边界。产品范围以 `PRODUCT.md` 为准，当前完成门槛以 `PRODUCT_GOAL.md` 为准，已验证架构以 `PROJECT_SPEC.md` 为准；功能 PRD 可以细化本文，但不得降低这些上位约束。

## 产品气质

CX-Codex 是安静、紧凑、可信的 Codex 任务工作台，不是通用 IDE、营销页面或装饰性聊天产品。

- 第一眼突出当前任务、最终答复或待用户处理事项。
- 通过背景、间距、字重和少量边框建立层级；阴影只属于浮层。
- 中文优先，正文可选择、可复制、可键盘操作，不依赖颜色表达状态。
- 视觉精简不能隐藏审批、失败、离线、恢复、队列或单写者冲突。

## 参考边界

- 官方 Codex 客户端决定已经存在的 Codex 行为和通用信息层级。每次改动用户可见行为前，必须检查当前安装版，而不是依赖旧截图。
- Sema Code Core 固定参考提交为 `f564e8d930053becdd5c31fe53f65fd863b6f283`，只借鉴桌面密度、过程折叠、轻量 Composer 和按需详情。不得引入它的 Runtime、React 架构、固定三栏或移动端布局。
- CX-Codex 继续以现有 App Server、Runtime Store、normalizer、消息强身份、持久 outbox 和移动恢复链路作为状态权威。

## 信息层级

主路径按以下顺序组织：

1. 项目与任务导航。
2. 当前任务标题、路径和连接状态。
3. 按 turn 阅读的对话。
4. 当前活动、审批、失败或等待输入。
5. 对齐阅读列的输入区。
6. 按需打开的文件、diff、计划或诊断详情。

Workbench、Skills、趋势、诊断和设置属于低频能力，不应同时占据 Header 与 Sidebar 的一级位置。

## 语义 Token

实现必须优先使用语义 token。以下数值是默认目标，不是散落在组件中的硬编码许可。

| 类别 | 默认契约 |
| --- | --- |
| Sidebar | 新用户 288px，可调范围 240–360px；已有显式宽度保留并安全裁剪 |
| Topbar | 44px 单行结构 |
| Reading / Composer | 桌面 800px 同轴；宽 artifact 可临时扩到 1120px |
| Desktop row | 32px 单行或 48px 固定双行，不随内容任意增高 |
| Mobile hit target | 不低于 44px |
| UI / Reading type | 14px / 15px；中文正文行高约 1.6 |
| Radius | row、card、control 8px；composer 14px；pill 仅用于真实标签或状态 |
| Border / shadow | 1px 语义边框；页面层级不使用装饰性阴影 |
| Motion | 80/120/180/220ms；只传达按压、状态、浮层和重排 |

颜色 token 至少区分 window、sidebar、surface、muted surface、hover、active、subtle border、strong border、primary/secondary/tertiary text、accent、success、warning、danger 和 focus。暗色主题与强制颜色模式必须表达同一语义，不建立第二套组件特例。

## 状态所有权

一个状态只能有一个主要可见所有者，其他区域至多提供不抢占层级的入口。

| 状态 | 主要所有者 | 必须保持第一层的内容 |
| --- | --- | --- |
| 连接、重连、离线 | Header | 当前连接结果与可执行恢复入口 |
| starting、running、streaming | 当前 turn 尾部 | 一个稳定计时、最新活动、停止入口 |
| completed、interrupted | turn 结果 | 最终答复、结果状态、必要后续动作 |
| waiting input、approval | 对话内对应请求 | 问题或审批内容、权限范围、接受/拒绝动作 |
| sending、confirming、waiting network | 消息或 Composer 上方 | 原消息、可信发送阶段、不可误导的恢复说明 |
| queued、paused、failed steer | Composer 上方队列 | 原顺序、编辑/删除/重试/Steer、稳定消息身份 |
| detached failure | Composer 上方失败托盘 | 原消息与恢复动作，不写进已提交 transcript |
| writer collision、spectator | 当前任务表面 | 权威写入端、只读原因和接管/刷新动作 |
| attachment upload | 附件本身 | 本地预览、上传、失败、重试、移除 |

关键状态不随普通 reasoning、tool 或 command 一起折叠。未知 payload 默认收起，但必须保留可访问的诊断入口。

## 响应式布局

### Desktop（不小于 1200px）

- Sidebar + Conversation 构成默认双栏。
- Sidebar 新默认 288px；Conversation 的 Header、阅读列和 Composer 共用中轴。
- Artifact Inspector 默认关闭，只能按内容触发，不能常驻挤压主阅读列。

### Compact / Tablet（768–1199px）

- Conversation 保持唯一主列。
- Sidebar 可收起或覆盖打开；不能把正文压缩到不可读宽度。
- Artifact 详情使用覆盖层，不进入固定三栏。

### Phone（小于 768px）

- 使用单栏 Conversation。
- Sidebar、设置、附件、模型和详情进入具有焦点所有权的 drawer 或 sheet。
- 手机临时抽屉状态不得写回桌面 Sidebar 偏好。
- 竖屏与横屏均不得出现页面级横向溢出或固定底栏遮挡内容。

## 组件规则

### Shell 与 Header

- Header 是 44px 单行：侧栏/返回、任务标题与必要路径、连接状态、主要动作、更多。
- 标题变化和状态变化不得引起可感知的高度跳动。
- 首页不使用大 Hero；当前工作目录、简短引导和 Composer 保持同轴。

### Sidebar

- “新建任务”是唯一强主操作；搜索、定位当前任务和置顶任务紧随其后。
- 项目按最近活动排序；任务标题优先，时间、运行、等待和未读使用紧凑状态。
- 只有活动、等待和搜索结果允许第二行摘要；单行/双行均使用固定高度。
- hover/focus 菜单在不可见时不能拦截指针；触摸设备必须有显式菜单入口。
- 搜索 loading、partial、empty、error 是不同状态。

### Conversation

- 以 turn 为阅读单位；用户输入使用低饱和轻表面。
- 当前 turn 的 reasoning、tool、command 和进度展开；完成后收敛为一个 Activity Summary。
- 连续两个及以上普通工具活动可组合，显示动词、目标与结果摘要。
- 最终答复、文件变更、审批、失败、等待输入和冲突保持第一层。
- 继续使用现有虚拟化、滚动锚点、返回最新输出和前台恢复策略；不得按文本去重消息。

### Composer

- 使用轻边框、14px 圆角的双层结构：可增长输入区 + 附件/模式/模型/权限/上下文/发送控制条。
- 模型和当前有效权限必须可见；不得只藏在更多菜单。
- 手机 Enter 默认换行，Ctrl/Command + Enter 发送；桌面服从用户配置；IME 组合阶段不得提交。
- 初始可编辑空间不得因视觉收紧而减少，长输入在既有上限内增长并内部滚动。

### Artifact 详情

- 默认使用现有 inline 或 modal。只有准入评审证明高频价值后，才允许增加只读 Inspector。
- Inspector 仅承载文件预览、diff、计划、工具和审批详情；不包含编辑器、终端、Git 客户端或新持久化状态。
- 1024px 以下转覆盖层，手机禁止固定右栏。

## 交互与可访问性

- 所有图标按钮都有中文可访问名称；状态文本不依赖颜色。
- 键盘焦点可见，dialog、drawer、sheet 和嵌套弹层只有一个焦点/滚动所有者。
- 鼠标 hover 只增强，不成为发现操作的唯一方式。
- `prefers-reduced-motion` 下取消非必要动画；状态仍须可理解。
- 普通文字目标对比度不低于 4.5:1；禁用控件不承担关键说明。
- 加载、缓存、陈旧、部分结果、失败、恢复和空状态都必须使用简洁中文并给出下一步。

## 实现边界

- 新呈现组件只接收规范化 props 并发出用户意图，不请求 Runtime、不读写 localStorage、不创建第二状态源。
- `useDesktopState.ts` 保持编排边界；触及超大组件时，只按独立责任提取可单测的纯呈现模块。
- 连续三个场景需要相同行为后才提取共享 primitive。
- 不做一次性主题重写，不引入页面级 feature flag，不长期保留新旧两套 UI。
- 不复制官方 Codex 私有实现；若复制 Sema 的实质性源码，必须保留 MIT 版权与许可。

## 截图与回归契约

每次 Shell、Sidebar、Conversation 或 Composer 的用户可见改动，至少覆盖以下视口：

- 1440×900 desktop
- 884×1104 foldable/tablet
- 768×1024 compact boundary
- 393×852 phone portrait
- 852×393 phone landscape

每个视口必须保留 home、running、completed、waiting-input 四个表面，并额外验证浅色、深色、键盘焦点、reduced motion 和强制颜色。稳定基线由 `scripts/capture-quiet-workbench-baseline.ps1` 生成；截图只进入被忽略的 `output/`，验收事实记录在 `docs/quiet-workbench-ux00-baseline.md` 和 `tests.md`。

完成用户可见 UI 改动后，必须运行相关前端构建/回归、使用浏览器检查 DOM 和控制台，并人工查看至少一张桌面与一张手机截图。浏览器证据、生产 7420、Android 真机、远端 CI 和正式 Release 必须分别陈述。
