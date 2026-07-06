# CX-Codex 移动端/7420 竞品代码分析与产品路线决策

更新时间：2026-07-06

## 结论先行

CX-Codex 的下一阶段不应继续优先做大 UI 改版，也不应引入重型云端架构。当前用户最敏感的问题是：会话列表慢、线程打开慢、历史记录缺失、移动端操作不跟手。这些问题的本质不是视觉问题，而是“会话索引、正文读取、实时事件、缓存恢复”没有形成足够明确的轻量数据层。

建议路线：

1. P0 先建立轻量稳定的数据底座：本地会话索引、缓存优先渲染、后台 app-server 对账、线程正文分页/降级、事件补偿。
2. P1 再做移动端交互和消息渲染：虚拟列表、结构化 blocks、语音转文字进输入框、运行态和队列体验。
3. P2 最后做开源产品化：README 宣传边界、发布门禁、性能指标、竞品对比和稳定性说明。

本轮审查的关键经验是：成熟竞品普遍把“列表摘要”和“会话正文”分离，把“实时输出”和“持久历史”分离，把“当前运行态”和“历史回放”分离。CX-Codex 需要吸收这个思路，但保持部署轻量，不照搬重数据库、多用户云服务或 Electron/Tauri 桌面壳。

## 候选项目

本轮使用 GitHub 元数据和浅克隆代码进行审查。浅克隆仅作为本地分析缓存，位于 `output/research/competitors/`，不作为发布产物。

| 项目 | 2026-07-06 星标 | 定位 | 本轮用途 | 结论 |
| --- | ---: | --- | --- | --- |
| [openai/codex](https://github.com/openai/codex) | 95828 | 官方 Codex CLI/app-server | 协议 source of truth | 必须对齐 |
| [slopus/happy](https://github.com/slopus/happy) | 22448 | Codex/Claude Code Mobile + Web | 移动、多端、实时语音、同步模型 | 借鉴思路，不照搬架构 |
| [winfunc/opcode](https://github.com/winfunc/opcode) | 22150 | Claude Code GUI/Tauri | 长消息性能、虚拟列表、任务控件 | 可借鉴前端性能策略 |
| [siteboon/claudecodeui](https://github.com/siteboon/claudecodeui) | 12424 | Claude/OpenCode/Cursor/Codex Web UI | 会话 store、事件回放、移动 Web | 强参考，但架构偏重 |
| [friuns2/codex-mobile](https://github.com/friuns2/codex-mobile) | 747 | Codex app-server Web/Mobile | 当前项目上游近亲 | 作为差异基线，不作为最终答案 |
| [0xcaff/codex-web](https://github.com/0xcaff/codex-web) | 170 | 浏览器端运行 Codex Desktop Web UI | 桌面端 Web 桥接 | 可参考桥接思路，不适合公开复制 |
| [friuns2/codex-web-ui](https://github.com/friuns2/codex-web-ui) | 149 | 启动 Codex Desktop Web UI | 私有 desktop webview 桥 | 不作为主路线 |
| [lulu-sk/CodexFlow](https://github.com/lulu-sk/CodexFlow) | 82 | Windows/WSL 多 agent 桌面工作台 | 本地历史索引、summaryOnly 解析 | 可借鉴索引和容错 |

## 官方约束

OpenAI app-server 文档明确了几个不能绕开的约束：

- app-server 是 JSON-RPC 2.0 风格协议，官方稳定入口仍以 stdio/unix socket 为主；`ws://` transport 标注为 experimental/unsupported。
- 服务端存在 bounded queues；饱和时返回 `-32001` / `Server overloaded; retry later.`，客户端必须按可重试错误处理。
- `thread/list` 是 cursor 分页接口，列表项包含 `status`，但不等于完整正文。
- `thread/read` 可用 `includeTurns` 控制是否读取 turns；读取完整 turns 可能很重。
- `thread/turns/list` 和 `thread/items/list` 已出现为更细粒度分页能力，但仍是 experimental。
- `thread/start`、`thread/resume`、`thread/fork`、`turn/start`、`turn/interrupt`、`thread/status/changed` 等是任务执行和状态同步主链路。
- `thread/realtime/*` 是 experimental，不能作为当前稳定语音功能的基础宣传。

对 CX-Codex 的直接影响：

- 7420 不能把重型 `thread/read(includeTurns:true)` 当作线程切换的首屏依赖。
- 会话列表不能依赖完整读取所有历史来补标题、预览、项目归属。
- 客户端必须区分“官方 app-server 当前返回值”和“本地 session jsonl 可恢复历史”。
- 移动端恢复应该先显示本地/服务端缓存，再后台对账，而不是白屏等待 app-server。

## 代码层观察

### 1. codex-mobile：当前近亲，但不是最终产品形态

`codex-mobile` 和 CX-Codex 共享大量思路：Vue + Express + app-server RPC，`thread/list` 获取列表，`thread/read(includeTurns:true)` 获取正文，`thread/read(includeTurns:false)` 获取摘要。

本轮重点观察：

- `src/api/codexGateway.ts` 中列表和正文仍是 app-server RPC 主路径：`thread/list`、`thread/read(includeTurns:true)`、`thread/read(includeTurns:false)`。
- `src/composables/useDesktopState.ts` 已有后台分页：首屏先加载一页，剩余页延迟加载；加载失败时保留第一页可用。
- `ThreadConversation.vue` 已有 markdown、inline segment、highlight HTML 等 bounded cache。

可借鉴：

- 保留当前 app-server-first 的协议适配层。
- 保留“首屏列表 + 后台加载剩余页”的方向。
- 保留 markdown/code 高亮缓存。

不足：

- 如果完整正文读取失败，用户仍容易看到缺历史或错误卡。
- 列表摘要仍容易受 app-server 完整性、cursor、补充读取预算影响。
- UI 和状态层已经很大，继续堆功能会加重维护成本。

### 2. claudecodeui：最值得借鉴的数据层

`claudecodeui` 的会话 store 设计很接近 CX-Codex 当前痛点：

- `src/stores/useSessionStore.ts` 明确使用 sessionId-keyed Map。
- 切换会话只是改变 activeSessionId，不清空旧数据。
- 后端 JSONL 是历史 source of truth，前端不把 localStorage 当正文真源。
- REST history 和 WebSocket realtime 分开存，再合并去重。
- 支持分页加载 older messages。
- realtime 有最大缓存，避免无限增长。

服务端 WebSocket 也值得借鉴：

- `chat.subscribe` 会返回当前会话是否 processing。
- 订阅时按 `lastSeq` replay missed events。
- 正在运行的会话会重新 attach socket，刷新页面也能继续接流。
- 完成后的会话不盲目 replay，避免和 REST history 重复。

可借鉴：

- CX-Codex 应新增“线程槽位 ThreadSlot”概念：summary、messages、realtimeOverlay、status、fetchedAt、lastSeq、error 分离。
- 页面切换只切 selectedThreadId，不清空旧消息。
- 正文读取失败不能清空已有消息；只标记 stale/error。
- 运行中事件走 overlay，持久历史走 server/cache，对账后再裁剪 overlay。

不宜照搬：

- 完整 auth、SQLite 项目库、多 provider runtime、push notification、plugin system 过重。
- AGPL-3.0 项目的代码不能直接复制到 MIT 项目。

### 3. happy：移动端产品力强，但架构过重

`happy` 是移动端体验最强的竞品之一，但它的产品形态是完整云端/多端客户端：

- Expo/React Native + Web + Tauri。
- 后端有 Prisma、数据库、对象存储、Socket.IO。
- 会话和消息支持端到端加密/数据密钥。
- session-scoped socket 使用无限重连、最大延迟控制。
- `SessionClient.waitForTurnCompletion` 同时观察 turn-start/turn-end、ready event、agent state、disconnect、timeout。
- 语音是 realtime 方向，依赖 LiveKit/ElevenLabs/WebRTC 等较重链路。

可借鉴：

- 移动端需要原生级输入、键盘、安全区、语音权限和轻动画。
- 任务完成判断不能只靠一个字段，要组合事件、状态、超时和断线。
- 连接应该 session-scoped，避免全局刷新污染当前任务。

不宜照搬：

- 不能引入 Postgres/Redis/MinIO/云账号/E2EE 作为 CX-Codex 默认路线。
- 不能把语音升级成实时语音对话作为 P0；当前目标是“语音转文字放入输入框”，更轻。
- 不能牺牲 Windows 本机一键部署。

### 4. opcode：长会话性能和任务控件值得借鉴

`opcode` 是 Tauri + React，偏桌面工具。它对 CX-Codex 的价值主要在长输出渲染和任务执行控件：

- `MessageList.tsx` 使用 `@tanstack/react-virtual` 虚拟列表。
- 新消息自动滚到底，但用户离开底部后停止强制滚动。
- `outputCache.tsx` 对运行中的 session output 做缓存和轮询。
- `PromptQueue.tsx` 把排队 prompt 做成明确可见的 UI。
- checkpoint、fork 等能力完整，但不适合 CX-Codex P0 直接扩张。

可借鉴：

- CX-Codex 的 `ThreadConversation.vue` 需要虚拟列表或至少分页渲染，避免长会话卡顿。
- 自动滚动必须尊重用户阅读历史。
- 任务队列和停止按钮应轻量、明确、靠近 composer。

不宜照搬：

- Tauri、桌面窗口、checkpoint 大体系不是移动端 7420 的优先级。
- 过多 agent/tool/analytics 面板会稀释轻量定位。

### 5. CodexFlow：本地历史索引和容错值得借鉴

`CodexFlow` 是 Windows/WSL 桌面工作台。它不是移动 Web 项目，但历史解析方式对 CX-Codex 很重要：

- 多 provider 会话解析器支持 `summaryOnly`。
- 文件过大时只读 prefix 提取 title/preview/cwd，避免完整 parse 阻塞列表。
- JSONL 逐行容错，坏行只计 skippedLines，不导致整条会话消失。
- 通过 cwd/hash/dirKey 做项目归属校验，避免误归类。
- 有 fast project enumeration。

可借鉴：

- CX-Codex 应建立本地 session index：只读少量 prefix/tail，提取 id、title、preview、cwd、updatedAt、path、messageCount、corruptLineCount。
- 列表永远不依赖完整正文 parse。
- 坏 session 文件不应让线程丢失；应显示“历史部分可恢复”而不是缺失。

不宜照搬：

- Electron 主进程和多 provider 解析体系较重。
- 当前 CX-Codex 应只先解决 Codex session jsonl，不扩张到 Claude/Gemini/Antigravity。

### 6. codex-web / codex-web-ui：桥接桌面端不是可持续主路线

`codex-web` 和 `codex-web-ui` 通过桥接 Codex Desktop/WebView 能快速获得接近桌面端的视觉，但路线风险明显：

- 依赖官方桌面端私有 bundle 或 webview 结构。
- 上游变化不可控。
- 很难把 Android WebView、远程访问、安全发布和开源维护做好。

可借鉴：

- 桌面端 UI 的信息密度、侧栏排序、composer 位置可以作为视觉参考。
- 对 Electron IPC/WebSocket bridge 的最小化思路可参考。

不宜照搬：

- 不应复制私有 bundle、私有 CSS 或反编译逻辑。
- 不应把“像桌面端”建立在不可维护的私有实现上。

## CX-Codex 推荐架构

### 产品定位

CX-Codex 应定位为：

> 轻量、自托管、Windows 友好、手机顺手的 Codex Web/Android 工作台。

不建议定位为：

- 多用户云端协作平台。
- 完整 IDE。
- 复制官方 Codex Desktop 的私有客户端。
- 重型 agent marketplace。

### 数据层

建议新增或收敛为四层：

1. Official RPC layer：只负责 app-server JSON-RPC，含退避、超时、错误分类、schema drift 兼容。
2. Local index layer：扫描 `.codex/sessions`，生成轻量 thread index，提供列表首屏和缺失恢复。
3. Thread slot cache：按 threadId 缓存 summary、messages、status、lastSeq、fetchedAt、source、error。
4. Reconcile layer：后台把 app-server 列表/正文与本地 index/cache 对账，修正排序、归属和状态。

首屏策略：

- 先渲染本地 index + 最近 cache，目标 300ms 内可见列表。
- 后台调用 `thread/list` 对账，更新 status、archived、official metadata。
- 打开线程时先显示 cached messages 或 session-log fallback。
- 再后台轻读 `thread/read(includeTurns:false)`，确认 path/status。
- 最后再尝试正文分页或重读，不阻塞首屏。

### 会话列表

排序和展示规则：

- 置顶线程：本地 pinned 配置优先，按 pinned 顺序或最新更新时间展示。
- 项目目录：以 desktop/app-server 的 cwd/path 为准，本地 index 只做补充。
- 项目下线程：按 updatedAt desc，最多先展示 5 条，展开后加载更多。
- 缺官方 thread 但本地存在 jsonl 的会话：显示为可恢复项，不应消失。
- 损坏 jsonl：保留列表项，正文区显示可恢复/部分可用，不让列表缺口扩大。

必须避免：

- 为了补标题预览对大量线程执行重型 `thread/read(includeTurns:true)`。
- 单个坏文件导致整个项目组或列表分页失败。
- 后台 cursor 错误覆盖已加载列表。

### 线程正文

正文应分三种状态：

- cached：立即展示已缓存/本地恢复内容。
- official：app-server 正文读取成功后对账替换。
- partial：本地恢复成功但官方重读失败，明确标注“历史部分恢复”，不显示大段技术异常。

推荐实现：

- 新增 thread slot，保存 `messages`, `source`, `fetchedAt`, `hasMoreOlder`, `readError`。
- 首屏正文限制最近 N 条或最近 N turns。
- 老消息滚动到顶部再加载。
- 未识别系统/tool raw payload 默认折叠，不占首屏。
- 长会话使用虚拟列表或分段渲染。

### 实时与恢复

移动端恢复目标不是锁屏后台实时，而是回到前台后自动补齐：

- app foreground/network resume 触发轻量 sync。
- 如果当前线程 running，先读状态，再订阅/重建通知流。
- 对每个 running thread 保留 last seen event id 或 synthetic sequence。
- 如果没有可靠 event replay，回前台后用 thread/read/session-log 补正文。
- 失败时保留旧内容，只给小状态提示，不清空页面。

### 语音输入

当前应做轻量语音转文字，不做实时语音 agent：

- Android 点击麦克风开始录音。
- 录音期间 composer 内显示轻量波形/呼吸动画。
- 停止后调用官方 transcription 或已有代理接口。
- 识别文本只填入输入框，不自动发送。
- 用户可编辑后再发送。
- 失败时保留输入框内容并给可重试提示。

这比 Happy 的 realtime voice 轻很多，更符合 CX-Codex “手机端对话顺手”的目标。

## P0/P1/P2 任务清单

### P0：会话同步和性能底座

目标：解决列表慢、缺线程、缺历史、打开慢。

任务：

- 建立本地 session index，字段至少包括 `threadId/title/preview/cwd/projectName/updatedAt/path/hasParseError/messageCount`。
- 列表首屏改为 cache/index-first，再后台 `thread/list` 对账。
- 对 `thread/list` cursor 错误、app-server 超时、单页失败做保留已加载数据处理。
- 打开线程改为 cache-first，不能因为 heavy read 失败清空已有内容。
- `thread/read(includeTurns:true)` 失败时走 session-log fallback，且只恢复最近有限 turns/items。
- 后台读取加预算：每轮最大读取数、最大耗时、单文件超时。
- 运行态请求优先级高于列表补全、MCP 状态、技能市场等低优先级请求。
- 建立 desktop-vs-7420 会话列表一致性回归：必须能找到 `分析项目` 这类 desktop 已显示线程。

验收指标：

- 7420 列表首屏在已有 index/cache 时 300ms 内可见。
- 冷启动官方对账不阻塞首屏；后台完成可超过 2s，但不能白屏。
- cached thread 打开 300ms 内显示已有消息。
- official/fallback 正文 2s 内至少显示最近一屏或明确 partial 状态。
- 单个损坏 jsonl 不会导致列表缺项或整个线程页报红色大异常。
- 浏览器回归覆盖桌面 1440x900、手机 390x844，并断言目标线程存在。

### P1：移动端任务执行体验

目标：让手机端真正顺手。

任务：

- ThreadConversation 增加虚拟列表或分段渲染，长会话不一次渲染所有 blocks。
- tool/raw/system 低价值内容默认折叠，只保留摘要。
- composer 收紧高度，状态、模型、权限、语音、发送不互相挤压。
- 语音转文字进入输入框，增加轻量录音/转写动画。
- 运行态只保留一个主状态入口，避免标题、状态栏、卡片重复显示。
- 队列消息清晰可删，运行中可以继续输入但不误发。
- 用户阅读历史时不强制滚到底；底部时新输出自动跟随。

验收指标：

- 390x844 无横向滚动，composer 不遮挡最后一条消息。
- 1000 条 message/item 的长会话滚动无明显卡顿。
- 语音识别失败不会自动发送、不丢输入。
- 运行中、等待权限、已完成、失败四种状态用户能一眼区分。

### P2：开源发布和产品化

目标：让项目可公开宣传且边界可信。

任务：

- README 首屏明确：轻量自托管、Windows 友好、Android/Web 可用、接近 Codex Desktop 体验。
- Release notes 只宣传已验证能力。
- 安全声明明确：本地 Codex 权限、远程访问、隧道、APK 安装风险。
- 增加性能基准文档：列表首屏、线程打开、长会话滚动、移动端语音。
- 增加 issue 模板：缺历史、列表不同步、Android 语音、远程访问、app-server schema drift。
- 和竞品对比时强调轻量优势，不声称功能覆盖 Happy/CloudCLI 全套云端能力。

验收指标：

- 新用户 5 分钟内能理解项目定位和运行方式。
- 发布页有 APK、校验和、变更说明、已知问题。
- GitHub About/topics/screenshot 与当前能力一致。

## 应公开宣传的能力

可以宣传：

- 自托管 Codex Web/Android 工作台。
- Windows/Windows Server 友好。
- 手机浏览器/Android APK 远程使用。
- 多项目、多会话、置顶、收藏、图片预览、文件链接。
- 接近 Codex Desktop 的工作台体验方向。
- cache-first 和本地恢复提升移动端稳定性。

必须谨慎标注：

- “接近 Codex Desktop”，不能说“100% 还原官方桌面端”。
- app-server experimental API 相关能力必须标注实验。
- 语音输入在完成 Android 真实设备回归前不能宣传为稳定。
- remote/public tunnel 必须提示安全配置和权限风险。

不建议宣传：

- 多用户协作。
- 云端同步账号体系。
- 实时语音 agent。
- 完整 plugin marketplace。
- 完整替代官方 Codex Desktop。

## 不采用清单

明确不作为近期路线：

- 不引入 PostgreSQL/Redis/MinIO 作为默认依赖。
- 不重写为 React Native/Expo。
- 不重写为 Electron/Tauri 桌面应用。
- 不复制 Codex Desktop 私有 bundle。
- 不为了 UI 好看增加重动画、重阴影、复杂页面装饰。
- 不把所有 app-server API 都暴露在设置页。
- 不让诊断信息占据普通用户首屏。

## 下一个目标建议

下一个目标应是 P0 数据底座，而不是继续视觉改版：

> 修复 CX-Codex 移动端/7420 会话列表和线程历史稳定性：实现本地 session index + cache-first thread slot + app-server 后台对账 + session-log fallback，并用浏览器回归证明 7420 与 Codex Desktop 关键线程列表一致，打开 `分析项目` 线程能显示历史且不阻塞首屏。

这个目标的边界应控制在 4-6 小时内：

- 不改整体视觉。
- 不做发布。
- 不做长篇 README。
- 不做重数据库。
- 只处理列表、线程读取、缓存恢复和回归验证。

