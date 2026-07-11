# Desktop Parity UI 规划

更新时间：2026-07-05

## 目标

把 CX-Codex 前端从当前偏卡片化、米黄色、泛 SaaS 的界面，调整为接近 Codex Desktop 的浅色中性工程工作台。

目标不是复制 Codex Desktop 私有源码、私有 CSS 或私有资源，而是在浏览器和 Android WebView 可维护范围内实现高保真 parity：

- 桌面 1440px 视口下，主框架、左侧栏、会话列表、内容列和 Composer 的视觉密度接近 Codex Desktop。
- 会话回显从 Markdown-only 升级为结构化工作台输出，包括文件、代码、diff、命令、tool call、raw payload fallback。
- 保留移动端、折叠屏和远程访问的可用性，不用纯桌面布局牺牲现有核心场景。

## 非目标

- 不宣称 100% 复制官方 Codex Desktop。
- 不从官方安装包反编译并复制私有实现。
- 不引入重型 UI 框架重写整个前端。
- 不把界面改成营销页、AI 聊天克隆、玻璃拟态、深色霓虹或装饰性大卡片风格。

## 参考项目

### Codex Desktop

用途：视觉 source of truth。

参考点：

- 浅色中性背景，低饱和、低装饰。
- 左侧栏是连续平面区域，不是卡片墙。
- 会话和项目列表紧凑，主要靠轻灰选中态和文字层级表达状态。
- 主内容列居中，信息卡片克制，底部 Composer 是轻量浮层。

### assistant-ui

仓库：https://github.com/assistant-ui/assistant-ui

用途：聊天组件抽象参考。

可借鉴：

- Thread / Message / Composer / ThreadList / ActionBar 的组件边界。
- streaming、auto-scroll、attachments、markdown、code highlighting、keyboard shortcuts、accessibility。
- generative UI，把 tool call 或 JSON 映射为具体组件，而不是直接输出原始文本。

不直接采用：

- 默认视觉主题。
- React runtime 绑定。

### Palot

仓库：https://github.com/itswendell/palot

用途：工程 agent 桌面工作台参考。

可借鉴：

- 多项目、多会话管理。
- dedicated diff panel。
- tool call、file preview、terminal output 的结构化展示。
- permission approve / deny 交互。
- sub-agent activity card。

### OpenCode ChatUI

仓库：https://github.com/redentordev/opencode-chatui

用途：消息回显和工具输出参考。

可借鉴：

- unified diff 高亮。
- read/write 文件内容 viewer。
- grep/search result grouped by file。
- bash command input/output。
- TodoWrite progress。
- tool call 展开/收起、复制、全屏查看。

### Cline

仓库：https://github.com/cline/cline

用途：IDE agent 工作流参考。

可借鉴：

- Plan / Act 工作流表达。
- 文件编辑 diff 审查。
- checkpoint / undo mental model。
- 命令执行与权限审批。

不直接采用：

- VS Code webview 的视觉风格。
- 依赖 IDE 宿主能力的交互。

## 视觉系统

### 方向

采用“浅色中性工程工作台”：

- 背景：接近 `#f7f7f6` / `#fbfbfa`。
- 侧栏：接近 `#f3f3f2`，连续面板。
- 主内容：白色或近白，不做大面积米色。
- 边框：`#e5e5e2` 一类低对比细线。
- 文本：主文本接近 `#202020`，次级文本接近 `#6f6f6f`。
- 高亮：选中态用浅灰底，运行/同步状态可用小面积青绿，不做大面积彩色主题。

### 密度

- 左侧栏保持信息密集但不拥挤。
- 列表行以 32-44px 为主，只有需要预览时进入两行。
- Composer 减少视觉重量，高度和圆角低于当前实现。
- 卡片只用于文件、变更、权限、工具输出等需要边界的对象，不把整页切成卡片。

### 交互

- 所有 icon-only 按钮必须有可访问名称。
- hover / active / selected 状态不能引发布局跳动。
- 长会话不能因为新输出强制抢滚动；用户在底部时才自动跟随。
- 移动端触摸目标保持 44px 以上，桌面端可以视觉紧凑但 hit area 不缩水。

## 信息架构映射

### 左侧栏

目标：从“卡片式会话集合”改成“桌面端项目/会话导航”。

改造项：

- 顶部入口改为紧凑 icon + text 行。
- pinned 线程改为平面列表。
- 项目分组保留，但 active project 用轻灰背景和左侧弱强调。
- 会话 row 显示标题、预览、时间、运行/未读状态，减少 tag chip 数量。
- 移除过重边框、阴影、大圆角和米色填充。

### 主内容区

目标：从“居中大空状态”改成“工作台内容列”。

改造项：

- 顶部栏高度收窄，标题和操作区靠近桌面端。
- 空状态降低标题字号，保留当前项目和新建工作树入口。
- 线程内容使用固定最大宽度内容列，文件和变更卡片居中显示。
- 长输出用结构化 blocks，避免整屏纯 Markdown。

### Composer

目标：接近 Codex Desktop 底部浮层。

改造项：

- 降低最小高度。
- 圆角和阴影减弱。
- 模型、权限、语音、发送按钮重新按桌面端密度排列。
- 输入 placeholder 保持中文，但语气更像工具而不是聊天产品。

### 消息回显

目标：让返回内容接近桌面端/工程 agent，而不是普通聊天。

改造项：

- Markdown 段落继续支持。
- fenced code block / diff block 保持结构化渲染。
- raw payload fallback 只作为诊断折叠卡片。
- 新增或补齐文件卡片、命令输出、搜索结果、tool call、permission request、review summary 的组件边界。

## 实施批次

### P0 Desktop Parity Shell

范围：

- `src/style.css`
- `src/App.vue`
- `src/components/layout/DesktopLayout.vue`
- `src/components/sidebar/SidebarThreadTree.vue`
- `src/components/content/ThreadComposer.vue`

验收：

- 1440x900 首页截图不再是米黄色卡片 UI。
- 左侧栏接近桌面端平面导航。
- Composer 视觉重量明显降低。
- 手机和折叠屏无横向滚动。

### P1 Structured Conversation Blocks

范围：

- `src/components/content/ThreadConversation.vue`
- `src/api/normalizers/v2.ts`
- `src/types/codex.ts`

验收：

- 文件、diff、命令、tool call、raw payload 都有独立视觉块。
- 未识别 payload 不丢失，但默认不干扰阅读。
- 结构化块支持复制和展开。

### P2 Review / Files / Permission Workbench

范围：

- 文件列表卡片。
- 编辑摘要卡片。
- 权限审批卡片。
- 审查入口和 diff 摘要。

验收：

- 能公开宣传“结构化工程 agent 输出”。
- 不能宣传的实验能力要在 README / release note 标注边界。

### P3 Mobile Parity Cleanup

范围：

- 手机单栏。
- 折叠屏双栏。
- Android WebView 安全区。
- 长会话滚动性能。

验收：

- 375x812、390x844、768x1024、884x1104 无横向滚动。
- Composer 不遮挡最后一条消息。
- 切换线程时先显示缓存，再后台刷新。

## 回归验证

每个 UI 批次至少运行：

```powershell
git diff --check
npm.cmd run build:frontend
npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420
npm.cmd run test:7420 -- -PublicHealthUrl http://116.62.234.104:17420/health -ScreenshotDir output\regression-7420\<task-name> -AgentBrowserTimeoutSec 25
```

如果改动影响运行时模块加载，还需要按仓库规则执行 CJS smoke。

## 公开宣传边界

可以宣传：

- Codex 风格的自托管 Web / Android 工作台。
- 多项目、多会话、移动端和远程访问。
- 结构化展示代码、diff、文件、命令和工具输出的方向。

必须谨慎标注：

- “高保真接近 Codex Desktop”可以说。
- “100% 复制官方 Codex Desktop”不能说。
- 未完全适配的 App Server payload、权限流、Realtime、完整 plugin marketplace 不能宣传为稳定完成。

## 下一步建议

立即执行 P0 Desktop Parity Shell。原因是当前最大问题不是消息组件能力，而是主界面视觉方向已经偏离 Codex Desktop；如果继续在现有米黄色卡片体系上补组件，后续改动会反复返工。
