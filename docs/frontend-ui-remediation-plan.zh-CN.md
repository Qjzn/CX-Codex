# 前端 UI 整改方案

更新时间：2026-07-05

## 一句话目标

把 CX-Codex 前端从“能用、偏稳、但像普通 Web 卡片工具”的状态，提升为“稳定、清爽、美观、信息密度合理、尽量贴近 Codex Desktop 的工程工作台”。

这个方案和 `desktop-parity-ui-plan.zh-CN.md` 的关系：

- `desktop-parity-ui-plan.zh-CN.md` 定义桌面端 parity 的方向和边界。
- 本方案定义具体整改范围、体验目标、视觉 token、组件优先级和验收矩阵。

## 现状问题

结合当前 7420 截图和 Codex Desktop 参考截图，当前主要问题不是单点样式，而是整体体验层级不稳定：

- 视觉方向不统一：部分界面偏米黄色、重圆角、重卡片，和 Codex Desktop 的白灰中性工作台不一致。
- 信息密度不稳定：桌面端需要紧凑高效，移动端需要清晰可读；当前部分内容在窄屏会被压得过窄。
- 组件边界不统一：文件卡片、消息卡片、Composer、侧栏 row 的圆角、边框、间距没有共同规则。
- Composer 视觉重量偏大：底部输入区应该是轻量工作台控件，而不是主视觉容器。
- 消息回显还不够“工程化”：Markdown、文件、diff、命令、tool call、权限、raw payload 应该有不同阅读形态。
- 美观依赖局部 CSS：缺少全局 token 和可量化验收，容易每次改出不同风格。

## 设计原则

### 视觉 source of truth

视觉唯一 source of truth 是 Codex Desktop 截图和可观察行为。

GitHub 上的 assistant-ui、Palot、OpenCode ChatUI、Cline 只能参考结构和交互，不直接参考视觉主题。

### 稳定优先，但不能只追求稳

稳定是底线，美观和体验是目标：

- 稳定：无横向滚动、无布局跳动、不卡死、不会丢状态。
- 美观：低噪声、细边框、少阴影、层级清楚。
- 高效：会话、文件、diff、命令、审批都能快速扫读。
- 贴近桌面端：整体像工程工作台，不像营销页、聊天玩具或后台模板。

### 克制而不是装饰

不使用：

- 大面积米黄色主题。
- 渐变背景、玻璃拟态、发光、装饰图形。
- 多层嵌套卡片。
- 过重阴影。
- 无意义动效。
- 过多 chip 和标签堆叠。

## 视觉 Token 草案

这些 token 是 P0 实施时的初始目标，后续用截图微调。

### 色彩

| Token | 建议值 | 用途 |
| --- | --- | --- |
| `--ui-bg-window` | `#f7f7f6` | 页面窗口背景 |
| `--ui-bg-sidebar` | `#f3f3f2` | 左侧栏连续背景 |
| `--ui-bg-surface` | `#ffffff` | 主内容和浮层表面 |
| `--ui-bg-surface-muted` | `#f8f8f7` | 文件卡片、浅分组 |
| `--ui-bg-row-hover` | `#ededeb` | row hover |
| `--ui-bg-row-active` | `#e9e9e7` | 当前会话/项目 |
| `--ui-border-subtle` | `#e3e3df` | 细边框 |
| `--ui-border-strong` | `#d6d6d0` | 强分隔 |
| `--ui-text-primary` | `#1f1f1f` | 主文本 |
| `--ui-text-secondary` | `#6f6f6c` | 次级文本 |
| `--ui-text-tertiary` | `#92928d` | 辅助文本 |
| `--ui-accent` | `#0f766e` | 同步/运行状态小面积强调 |
| `--ui-danger` | `#c2410c` | 权限/危险动作 |
| `--ui-focus` | `#2563eb` | 键盘焦点 |

### 字体和字号

| Token | 建议值 | 用途 |
| --- | --- | --- |
| `--ui-font-sans` | system-ui, `Segoe UI`, sans-serif | 全局字体 |
| `--ui-font-mono` | `SFMono-Regular`, Consolas, monospace | 代码/命令 |
| `--ui-text-xs` | `12px` | 时间、状态、辅助 |
| `--ui-text-sm` | `13px` | sidebar preview、按钮 |
| `--ui-text-base` | `15px` | 默认正文 |
| `--ui-text-lg` | `18px` | 标题 |
| `--ui-text-xl` | `22px` | 关键空状态标题 |

正文行高保持 `1.55-1.7`，不要为了桌面密度牺牲中文可读性。

### 圆角和阴影

| Token | 建议值 | 用途 |
| --- | --- | --- |
| `--ui-radius-row` | `10px` | sidebar active row |
| `--ui-radius-card` | `8px` | 文件/工具/输出卡片 |
| `--ui-radius-control` | `10px` | 普通按钮/输入控件 |
| `--ui-radius-pill` | `999px` | icon pill、模型选择 |
| `--ui-radius-composer` | `22px` | 底部 Composer |
| `--ui-shadow-float` | `0 14px 40px rgb(0 0 0 / 0.08)` | Composer / 浮层 |

卡片圆角默认不超过 `8px`。只有 Composer、pill 控件和系统浮层可以更圆。

### 布局尺寸

| Token | 桌面目标 | 移动目标 |
| --- | --- | --- |
| `--ui-sidebar-width` | `320-356px` | 单栏隐藏或抽屉 |
| `--ui-topbar-height` | `52-56px` | `52px` |
| `--ui-content-max` | `860-920px` | `100%` |
| `--ui-composer-max` | `860-920px` | `calc(100vw - 32px)` |
| `--ui-composer-min-height` | `96-118px` | `96-132px` |
| `--ui-row-height` | `34-44px` | `44-52px` |

## 组件整改范围

### 1. App Shell

目标：整体第一眼像桌面端工程工作台。

改造点：

- 页面背景改为浅灰白，不再用米黄色主调。
- 主内容和侧栏之间用 1px 细边框，不用厚重阴影。
- 顶部栏更薄，标题、项目、操作按钮靠左/靠右稳定排列。
- 主内容列居中，最大宽度固定，长文本不贴边。

涉及文件：

- `src/style.css`
- `src/App.vue`
- `src/components/layout/DesktopLayout.vue`
- `src/components/content/ContentHeader.vue`

### 2. Sidebar

目标：像桌面端导航，不像卡片列表。

改造点：

- 顶部入口使用 icon + text 行，不使用大卡片按钮。
- pinned / project / thread row 用统一 row 组件。
- active row 使用浅灰底，不使用粗边框或高饱和强调。
- 时间、状态、未读、运行中保持右侧弱提示。
- 预览文本保留，但限制为一行，避免 row 高度频繁变化。
- 项目分组和会话列表保持可扫读，不堆叠过多 chip。

涉及文件：

- `src/components/sidebar/SidebarThreadTree.vue`
- `src/components/sidebar/SidebarMenuRow.vue`
- `src/components/sidebar/SidebarThreadControls.vue`

### 3. Conversation Content

目标：消息阅读像工程审查流，不像普通聊天流。

改造点：

- 普通文本保留宽松行高。
- 文件卡片用薄边框列表样式。
- diff block 用专门行样式和 additions/deletions 颜色。
- command output 用 mono 区块，支持折叠。
- tool call 和 raw payload 默认折叠，摘要可读。
- 图片附件不应在窄屏挤压到不可读。
- 消息动作区贴近桌面端：复制、反馈、展开、时间等弱化但可发现。

涉及文件：

- `src/components/content/ThreadConversation.vue`
- `src/api/normalizers/v2.ts`
- `src/types/codex.ts`

### 4. Composer

目标：输入区轻、稳、顺手，接近桌面端底部浮层。

改造点：

- 底部 Composer 最大宽度和内容列对齐。
- 降低厚重边框和阴影，保留轻微浮层感。
- 输入文本区域保持足够高度，但不占据过多首屏。
- `+`、权限、模型、语音、发送按钮统一尺寸和对齐。
- 移动端 Composer 不能遮挡最后一条消息。
- 附件预览在移动端横向可滚动，不把主输入挤窄。

涉及文件：

- `src/components/content/ThreadComposer.vue`
- `src/components/content/ComposerDropdown.vue`
- `src/components/content/ComposerRuntimeDropdown.vue`
- `src/components/content/ComposerSkillPicker.vue`
- `src/composables/useDictation.ts`

### 5. Mobile / Foldable

目标：移动端不是桌面端缩小版，而是保留桌面端气质的可用单栏。

改造点：

- 375x812 下不能出现横向滚动。
- 文件卡片、图片缩略图、打开方式按钮不能互相挤压。
- 侧栏抽屉和内容区域切换要清楚。
- 折叠屏 884x1104 保持双栏，但左栏不抢主内容。
- 底部 Composer 使用安全区 padding。

涉及文件：

- `src/composables/useMobile.ts`
- `src/components/layout/DesktopLayout.vue`
- `src/App.vue`
- `src/components/content/ThreadComposer.vue`

## 体验整改范围

### 阅读体验

- 优先让用户知道“Codex 做了什么”，再展开细节。
- 长输出先摘要，代码/diff/命令再展开。
- 当前运行状态靠近消息流和 Composer，不分散在多个位置。

### 操作体验

- 常用操作少而清晰：新会话、搜索、切换项目、发送、停止、复制、展开。
- 危险操作必须有明确语义和确认。
- 权限审批要能快速判断风险：文件、命令、路径、操作类型。

### 状态体验

- 加载中、运行中、断线、恢复、失败都要有明确状态。
- 移动端恢复后优先自动补齐，而不是要求用户刷新。
- 不用多个 spinner 同时出现。

### 空状态体验

- 新会话页不做大 hero。
- 标题简短，项目选择和新建工作树是核心操作。
- 空状态应该像工具启动页，不像产品宣传页。

## 验收矩阵

### 视觉验收

| 场景 | 必须满足 |
| --- | --- |
| 1440x900 首页 | 白灰中性工作台；无米黄色主视觉；左侧栏连续面板；Composer 轻量浮层 |
| 1440x900 会话页 | 内容列居中；文件/消息卡片边框轻；动作区弱化但可见 |
| 390x844 手机 | 无横向滚动；Composer 不遮挡内容；附件不挤压输入区 |
| 768x1024 平板 | 内容宽度稳定；顶部栏和底部 Composer 不压迫阅读 |
| 884x1104 折叠屏 | 双栏可用；左栏不超过可读比例；右侧内容不被压扁 |

### 体验验收

| 能力 | 必须满足 |
| --- | --- |
| 会话扫描 | 5 秒内能从标题、预览、时间、状态判断要打开哪个会话 |
| 输出阅读 | 普通文本、代码、diff、命令、文件、raw payload 有不同视觉形态 |
| 操作反馈 | 发送、停止、复制、展开、权限审批都有即时反馈 |
| 移动输入 | 输入、语音、模型、权限、发送按钮不互相遮挡 |
| 长会话 | 用户阅读历史时不被自动滚到底；在底部时新输出自动跟随 |

### 工程验收

每个实施批次至少运行：

```powershell
git diff --check
npm.cmd run build:frontend
npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420
npm.cmd run test:7420 -- -PublicHealthUrl http://116.62.234.104:17420/health -ScreenshotDir output\regression-7420\<task-name> -AgentBrowserTimeoutSec 25
```

涉及模块加载行为时追加 CJS smoke。

## 实施阶段

### P0 视觉基线和 Shell

目标：先让第一屏方向正确。

任务：

- 建立全局 UI token。
- 重做 App Shell、顶部栏、侧栏背景、主内容背景。
- 移除米黄色主调、重卡片、重阴影。
- Composer 与内容列对齐。

完成标准：

- 首页和会话页截图第一眼接近 Codex Desktop。
- 桌面、手机、折叠屏无横向滚动。

### P1 Sidebar 和导航

目标：提升扫读效率。

任务：

- 统一 sidebar row。
- 精简 chip。
- 优化 active/hover/运行/未读状态。
- 项目分组和会话分组视觉层级稳定。

完成标准：

- 侧栏像桌面端列表，不像卡片集合。
- 行高稳定，无 hover 抖动。

### P2 Composer 和输入体验

目标：让输入区更像桌面端，也更顺手。

任务：

- 重排按钮和状态区。
- 降低浮层视觉重量。
- 移动端附件和输入区分离。
- 检查语音、模型、权限菜单在窄屏不遮挡。

完成标准：

- 底部输入区轻量、稳定、可触控。
- 390x844 下按钮和文本不重叠。

### P3 Conversation Blocks

目标：让输出内容更工程化、更美观。

任务：

- 文件卡片列表化。
- diff / command / tool call / raw payload 分块。
- 操作区弱化但可发现。
- 图片和附件响应式。

完成标准：

- 不同输出类型一眼可区分。
- 长输出默认不压迫阅读。

### P4 Mobile / Foldable Polish

目标：移动端也像一个认真工具，而不是桌面端裁切。

任务：

- 手机单栏专用间距。
- 折叠屏双栏比例优化。
- 安全区和底部 Composer 遮挡修复。
- 长会话滚动性能检查。

完成标准：

- 375x812、390x844、768x1024、884x1104 均可读可操作。

### P5 视觉回归和发布边界

目标：让 UI 提升可验证、可维护、可公开说明。

任务：

- 固化截图目录和回归说明。
- README / release note 只宣传已完成能力。
- 未完成的 payload、权限、Realtime、plugin marketplace 标注实验或未完成。

完成标准：

- 可公开宣传“更接近 Codex Desktop 的自托管 Web / Android 工作台”。
- 不宣传“100% 复制官方桌面端”。

## 下一步执行建议

直接启动 P0，先改视觉基线和 Shell。原因：

- 现在最大感知问题是第一屏风格不像桌面端。
- 不先建立 token，后续 sidebar、Composer、conversation blocks 会继续各改各的。
- P0 完成后再做 P1/P2/P3，才能避免反复返工。
