# 更新日志

## 未发布

- 界面体验：
  - 7420 侧栏会话数据源新增 Desktop/session-index 有界补充：当 Codex Desktop 能看到但 App Server `thread/list` 首屏遗漏的近期线程存在时，会通过 `thread/read(includeTurns:false)` 补入侧栏，避免 `codexui / 分析项目` 这类真实会话在浏览器端缺失；补充输出保持固定上限，防止缓存命中后首屏线程数量持续膨胀。
  - `test:7420:sidebar-data` 和 `test:7420:frontend` 增加 `分析项目` 这类 Desktop/session-index 目标线程回归断言，数据门禁会校验目标线程进入 active `thread/list`，浏览器门禁会校验桌面侧栏和手机抽屉 DOM 都包含同一线程。
  - 手机端首页回归新增打开侧栏 drawer 后必须渲染会话行和项目组的断言；`thread/list` RPC 单次等待从 45 秒收紧到 15 秒，并为侧栏空列表提供明确提示，避免 App Server 卡住时手机端长期停留在无信息骨架屏。
  - 侧栏顶部操作入口从“主操作 + 纵向命令列表”压缩为 3 列手机友好的快捷操作网格，保留图标和短标签，减少首屏高度占用；项目展开后默认只显示最新 5 条会话，超出部分通过 `显示更多 N 条` 继续展开。
  - 侧栏项目目录和项目内线程列表改为保留上游 App Server / 工作区归一化后的顺序，不再在侧栏层按最近更新时间二次重排项目；置顶和正在运行线程会继续出现在快捷区，同时保留在所属项目线程列表中，避免与 Codex Desktop 的项目浏览模型不一致。
  - 会话阅读流默认隐藏 `unhandled.fileChange` 这类低价值系统噪声，不再把“未适配的 App Server 内容 / fileChange / 字符数”诊断块直接暴露给普通用户；其他未知协议内容仍保留结构化 raw payload 兜底。
  - 会话页标题区重新排版：线程运行状态合并进顶部标题 meta 行，正文区不再重复显示独立状态栏；状态条在标题区隐藏阶段轨道、seq/turn 等低频字段，只保留当前状态和必要恢复/停止动作，正文里的简单“思考/写回复”提示也会在 header 已承载状态时自动收起。
  - 侧栏顶部操作进一步压缩：`新会话 / 搜索` 改为两列紧凑主操作，工作台/技能中心/GitHub/诊断入口降低行高，减少左侧导航占用的首屏高度。
  - 设置面板新增桌面/移动统一标题栏和关闭按钮，去掉移动端“向上滑动”等解释性小字，普通设置说明默认收起，仅保留状态反馈，面板行距和品牌块同步压缩。
  - 会话页进入紧凑化整理：运行状态条不再为正常收敛/运行状态显示解释性第二行，`已同步` 和运行活动以单行轻量状态呈现；引导式内容入口缩短为 `阶段回复`；Composer 默认移除听写教学提示、单行起步并降低最小高度与阴影，减少首屏空间占用。
  - 侧栏顶部“新会话 / 搜索”从 icon-only 工具按钮提升为纵向 icon + label 主操作行，和下方工作台/技能中心/GitHub/诊断命令入口形成连续 Desktop 风格导航；折叠屏首页回归新增 primary action 行数、图标数、圆角和触控高度断言，并将 `mcpServerStatus/list` 后台状态轮询从前端截图回归的误拦截中排除。
  - 侧栏顶部快捷入口从 2x2 按钮区收敛为纵向 icon + label command list，减少工具盘感，更接近 Codex Desktop 的连续左侧命令列表；折叠屏首页回归新增 command list 纵向布局、图标数量、圆角和触控高度断言。
  - 截图回归在完成首页设置面板断言后会自动关闭设置面板，并在 884x1104 首页 shell 断言中禁止设置面板残留，避免 `home-foldable.png` 被上一步设置面板状态污染。
  - `test:7420:frontend` 新增显式截图回归参数 `-CaptureScreenshots`、`-ScreenshotTaskName` 和 `-ScreenshotOutputDir`，可用 `agent-browser` 在现有 DOM 回归矩阵通过时把页面截图保存到 `output/regression-7420/<task-name>/`，覆盖桌面、手机和折叠屏视口。
  - `test:7420:frontend` 新增 884x1104 折叠屏/窄平板回归视口，覆盖首页 shell、Composer fixture 和 conversation fixture；首页会先重置侧栏折叠/宽度偏好，再断言侧栏比例、主内容宽度、Composer 宽度、元素贴合和无横向溢出。
  - 会话主区 runtime 状态条、消息队列、消息气泡、表格、raw payload、长文本展开、文件右键菜单和消息操作按钮继续收敛为白灰中性 token；`conversation-blocks` fixture 增加 runtime/queue 样本，并由 `test:7420:frontend` 自动断言会话辅助 chrome 不再出现暖色背景、圆角不超标且无横向溢出。
  - App Shell 设置面板、移动设置 sheet、启动配置卡片、toast 和确认弹窗继续收敛为白灰中性 token；设置面板去掉蓝色渐变卡片和暖色纸感控件，并由 `test:7420:frontend` 在首页自动打开设置面板断言背景、圆角、边框和无横向溢出。
  - 新增 `/#/__regression/composer-shell` 回归 fixture，覆盖桌面和手机视口下的底部 Composer；Composer 外壳、sheet、插件菜单和运行配置面板从暖色重卡片收敛为白灰 token 样式，并由 `test:7420:frontend` 自动断言高度、圆角、控件可见性和无横向溢出。
  - 新增 `/#/__regression/sidebar-rows` 回归 fixture，覆盖运行中、未读、不同来源和多项目线程行；Sidebar 线程来源/状态从 pill chip 收敛为轻量行内文本，菜单和重命名弹窗改为白灰 token 驱动样式，减少侧栏卡片化和暖色残留。
  - `test:7420:frontend` 增加手机宽度 `conversation-blocks` fixture 验证，逐个断言 request、tool、file、code、command 等结构化块不会越出视口；会话结构化块在窄屏下同步收敛为更紧凑的单列触控布局和桌面端风格小圆角。
  - `/#/__regression/conversation-blocks` 增加 unsupported tool call fixture，参考 `friuns2/codex-mobile` 的 pending request 类型边界，把 tool call 展示为独立工作台卡片，显示服务、工具、摘要和“让 Codex 改用文字继续”动作。
  - `/#/__regression/conversation-blocks` 增加命令执行输出 fixture，命令行收敛为中性薄边框结构化日志块，并由 `test:7420:frontend` 自动断言命令 label、输出展开、marker、圆角上限和无横向溢出。
  - `/#/__regression/conversation-blocks` 增加 MCP 权限确认 fixture，权限请求卡片收敛为中性薄边框工作台样式，并由 `test:7420:frontend` 自动断言服务/工具名、操作按钮、圆角上限和无横向溢出。
  - `test:7420:frontend` 的 conversation fixture 会通过真实点击代码块复制按钮并 stub `navigator.clipboard.writeText` 捕获复制内容，断言复制内容不包含 Markdown fence 且按钮显示“已复制”反馈。
  - 新增 `/#/__regression/conversation-blocks` 回归 fixture，并把 `test:7420:frontend` 扩展为自动断言 code block、diff block、复制按钮、文件卡片和 raw payload 卡片，避免 P1 结构化消息块只靠人工截图判断。
  - Conversation 代码/diff block 增加块级复制按钮和复制反馈，文件附件从 emoji chip 改为薄边框文件卡片，继续推进 P1 结构化工程输出；移动端空输入状态下 Composer 发送按钮保持可见 disabled，减少底部动作区跳变。
  - 建立 P0 桌面端 parity 视觉基线：App Shell、侧栏入口、会话行、顶部栏和底部输入框统一使用中性白灰 token、连续侧栏、紧凑列表行和更接近 Codex Desktop 的主操作样式，减少暖色卡片化和过重阴影。
  - 会话栏现在显示会话预览、来源和运行/未读状态，减少只看标题时无法判断上下文的问题，同时保持桌面、手机和折叠屏固定行高。
  - 对话消息新增 fenced code block / diff block 结构化渲染，代码和补丁输出不再只作为普通 Markdown 文本显示。
  - 未适配的 App Server item / raw payload 会以折叠结构化卡片展示，保留诊断可见性但避免原始 JSON 干扰正常阅读。
  - 新增 `PRODUCT.md`，把项目定位、用户、设计原则和桌面端 parity 目标沉淀为后续 UI 迭代上下文。
  - 新增 `docs/desktop-parity-ui-plan.zh-CN.md`，把 Codex Desktop 高保真 UI 目标、GitHub 参考项目、视觉系统、P0/P1/P2/P3 实施批次和回归验收标准固化为后续前端重构基线。
  - 新增并优化 `docs/frontend-ui-remediation-plan.zh-CN.md`，把前端从稳定可用提升到美观、顺手、贴近 Codex Desktop 的整改目标拆成视觉 token、参考截图门禁、组件范围、体验目标、自动化/半自动化断言矩阵和 P0-P5 实施阶段。
- 语音输入：
  - 后端转写支持优先使用 OpenAI 官方音频转写 API，配置 `CX_CODEX_OPENAI_API_KEY`、`CODEXUI_OPENAI_API_KEY` 或 `OPENAI_API_KEY` 后不再依赖 ChatGPT 网页登录态。
  - 官方转写 multipart 会由服务端规范化 `model`、`response_format` 和 diarize 分段参数，普通转写模型保持 `json`，`gpt-4o-transcribe-diarize` 按官方文档使用 `diarized_json` 与 `chunking_strategy=auto`，避免客户端自带字段绕过官方模型的响应格式约束。
  - 前端语音输入支持从 diarized JSON 的 `segments[].text` 兜底提取文本，避免上游没有顶层 `text` 字段时空转写。
  - 转写上传请求体默认按 OpenAI 官方 25 MB 文件限制收紧服务端保护，可通过 `CX_CODEX_OPENAI_TRANSCRIBE_MAX_BYTES` 或 `OPENAI_TRANSCRIBE_MAX_BYTES` 覆盖。
  - 诊断中心新增语音转写状态，展示当前 provider、模型、响应格式、上传上限和脱敏 endpoint，便于排查是否走官方 API 或登录态回退。
  - 自定义 OpenAI 转写 endpoint 仅接受 `http` / `https` URL；非法或非 HTTP(S) 配置会回退官方默认 endpoint，并在诊断快照中用布尔字段标识，不展示原始非法 URL。
  - `/codex-api/transcribe` 路由从 bridge 主文件抽离为独立服务端模块，官方 API 与 ChatGPT 登录态回退行为保持不变，并新增无网络 route smoke 覆盖 401 与 413 分支。
  - 未配置 OpenAI API key 时仍保留原有 ChatGPT 登录态代理转写链路，避免破坏既有安装。
- 安全加固：
  - `/auth/login` 登录请求体新增默认 16KiB 服务端保护，可通过 `CX_CODEX_AUTH_LOGIN_BODY_MAX_BYTES`、`CODEXUI_AUTH_LOGIN_BODY_MAX_BYTES` 或 `AUTH_LOGIN_BODY_MAX_BYTES` 覆盖。
  - 普通 JSON API 请求体新增默认 2MiB 服务端保护，可通过 `CX_CODEX_JSON_BODY_MAX_BYTES` 或 `JSON_BODY_MAX_BYTES` 覆盖。
  - 普通文件上传请求体新增默认 50MiB 服务端保护，可通过 `CX_CODEX_FILE_UPLOAD_MAX_BYTES` 或 `FILE_UPLOAD_MAX_BYTES` 覆盖。
- 协议治理：
  - 本地 `verify:governance`、`verify:release` 和 `verify:release-artifacts` 新增 PowerShell 运行器，先探测 `pwsh`，不可用或挂起时自动回退到 Windows PowerShell，并把选中的命令传给 release gate 内部调用。
  - GitHub Actions CI 的 Release verification 改为调用 `npm run verify:release -- -SchemaAudit skip`，与本地 package script 共享同一个 PowerShell 运行器入口，避免 PR 验证路径与本地门禁分叉。
  - GitHub Release workflow 的 release verification、源码包打包和 artifact checksum 验证统一改为 npm script 入口，避免正式发版路径绕过本地 PowerShell 运行器。
  - `verify:release` 内部的 Release package smoke 和 artifact checksum smoke 也改为调用 `package:release` / `verify:release-artifacts` npm script，确保本地 gate 持续验证正式发版同款包装入口。
  - `.github/FUNDING.yml` 移除 GitHub 默认占位模板，改为明确声明暂未配置资金入口，并纳入 governance 与 Release package smoke，避免开源治理文件带着模板噪声发布。
  - `verify:governance` 会校验 OpenAI 官方文档审查手册必须保留审查时间、官方来源、Codex manual 刷新命令、当前结论和语音转写约束，避免长期项目在文档入口上漂移。
  - OpenAI 官方文档审查手册已刷新到 2026-07-05 复核结果，确认 Codex App Server handshake / `experimentalApi` 边界和 Speech to text diarize multipart 约束仍与当前实现策略一致。
  - `verify:governance` 会阻止 `tests.md` 残留未完成验证证据占位文本，避免功能已经实现但测试记录仍是待补充状态。
  - `verify:release` 会运行 frontend normalizer smoke，把前端 App Server 线程/消息归一化兼容性纳入本地发版与 CI 门禁。
  - `verify:frontend-normalizers` 每次执行会使用独立的 `output/frontend-normalizer-smoke/run-*` 临时编译目录，避免它与 release gate 内部 frontend normalizer smoke 并行运行时互相清理产物造成偶发失败。
  - `verify:frontend-normalizers` 直接使用的 `esbuild` 已作为 devDependency 显式声明，避免开源安装或 CI 复现时依赖 `vite` / `tsup` 的间接依赖解析。
  - Release package smoke 会显式校验 `scripts/verify-frontend-normalizers.mjs` 已进入源码 zip，避免发布包缺少 release gate 依赖的前端协议兼容验证脚本。
  - Release package smoke 会强制校验测试手册、治理脚本、关键治理文档和 bridge/转写路由源码边界已进入 zip，避免可发布包缺少开源复核、手工验收入口或新抽出的服务端模块。
  - Release gate 新增 `npm pack --dry-run --json` smoke，校验 npm 发布包包含 Web/CLI 运行产物和 schema 摘要，同时不携带源码、治理脚本或手工测试手册。
  - GitHub Release 正文改为版本中性模板，并由 governance 阻止固定旧版本号或过期卖点残留，避免新 tag 继续发布旧版说明。
  - OpenAI 官方文档审查手册刷新到 2026-07-05 02:12 复核结果，并记录 OpenAI Docs MCP 注册命令；当前线程重启前仍以官方 OpenAI 域名页面为证据来源，确认 App Server WebSocket auth、Speech to text 25 MB / diarize multipart 和 Responses API 边界没有放松。
  - 新增 `docs/release-readiness-audit.zh-CN.md` 阶段性收口审计，明确当前适合内部 checkpoint / 候选分支、不应声明完全对齐最新 App Server，并把 2026-07-05 schema audit drift 分组为 P0/P1/P2/P3 后续任务。
  - 新增 `docs/candidate-release-review.zh-CN.md` 候选发布审查，记录 `verify:release -- -RequireCleanGit -SchemaAudit warn` 正式门禁结果、OpenAI Docs MCP 复核证据、schema drift P0/P1/P2 任务清单，以及 README / Release / SECURITY 可公开宣传和必须标注实验或未完成的能力边界。
  - 新增 `docs/candidate-pr-review-pack.zh-CN.md`，把候选分支快照、PR 正文草稿、候选发布说明、review checklist、schema drift P0/P1/P2 issue 草稿和本地 main 合并准备步骤收口为可复核交付物。
  - 新增 `docs/local-regression-checklist.zh-CN.md` 和 `docs/local-regression-execution-20260705.zh-CN.md`，把本地 7420、release gate、schema drift、发布治理、浏览器自动化、Android 真机和长时浸泡拆成 P0/P1/P2 回归清单并开始记录本轮执行证据。
  - `test:7420` 浏览器回归新增 `-AgentBrowserTimeoutSec` 超时保护，并在三视口检查前重置侧栏折叠状态，避免 agent-browser 挂起或历史折叠偏好导致折叠屏侧栏误报。
  - README、GitHub Release 正文、`RELEASE.md` 和 `SECURITY.md` 收紧 App Server 兼容宣传，明确当前仍是 `drift-recorded`，MCP/plugin/Realtime/WebSocket/fs/terminal/permission-profile 等能力不能被描述为完整稳定支持。
  - `RELEASE.md` 发版手册补齐 NPM package smoke、Release package smoke 覆盖范围和最终 artifact checksum 验证步骤，避免本地发版流程与自动门禁漂移。
  - `verify:release` 的 Release package smoke 会复用 `verify-release-artifacts.ps1` 校验生成的 zip 与 `.sha256`，确保本地 gate 和 GitHub Release workflow 使用同一套资产校验逻辑。
  - Release package smoke 每次执行前会通过专用 helper 确认输出路径仍位于仓库 `output` 目录下，再清理固定的 `output/release-package-smoke` 目录，避免旧 zip/APK 残留污染 artifact checksum 验证，并降低后续维护时绕过路径护栏的风险。
  - 本地 `package:release`、`setup:windows`、`test:7420*` 和 `audit:app-server-schemas` 也统一走同一个 PowerShell 运行器，减少 Windows 机器上因单一 PowerShell 命令挂起或不可用导致的验证/打包中断。
  - 新增 `docs/app-server-schema-audit-summary.json`，把最新 App Server schema drift 摘要从本地临时输出收口为可审查文档。
  - 新增 `audit:app-server-schemas:update-summary`，可把最新 raw schema audit 转成脱敏、可提交的 `docs/app-server-schema-audit-summary.json`，避免把本机绝对路径或完整生成目录带入仓库。
  - Release/governance 门禁会校验 schema audit 摘要结构、相对路径、代表项列表和 raw audit 字段黑名单，避免协议差异记录丢失、无法复核或泄漏本机路径。
  - App Server method catalog smoke 会直接读取当前 raw JSON schema audit，确认 `ClientRequest.json` 抽取 75 个 request method、`ServerNotification.json` 抽取 63 个 notification method，并记录 `rawResponseItem/completed` 当前只由 TypeScript union 覆盖、未进入 JSON notification catalog 的边界。
  - App Server method/notification catalog 共享一次 `generate-json-schema` 生成结果和并发 promise，避免诊断端点同时读取方法目录时重复启动 Codex schema 生成。
  - `verify:server-modules` 每次执行会使用独立的 `output/server-module-smoke/run-*` 临时编译目录，避免它与 release gate 内部 server smoke 并行运行时互相清理产物造成偶发失败。
  - Codex bridge HTTP 请求错误响应从主 middleware 抽离为独立 helper，并由 server module smoke 覆盖 JSON body 过大 413 与普通 bridge 失败 502 分支。
  - Codex bridge middleware dispose 资源释放顺序从主文件抽离为独立 helper，并由 server module smoke 覆盖 runtime scheduler、索引、监听器、诊断缓存、runtime store 和 app-server 的清理顺序。
  - Codex bridge middleware 基础 state 创建从主文件抽离为独立 helper，并由 server module smoke 覆盖 thread search/read cache、runtime store、诊断缓存和 sandbox readiness cache 的工厂出口。
  - Codex bridge route handler 顺序调度从主 middleware 抽离为独立 helper，并由 server module smoke 覆盖同步/异步 handler、首个命中后停止和未命中继续 next 的分支。
  - Codex bridge route handler 列表构建从主 middleware 抽离为独立 helper，并由 server module smoke 覆盖 route 数量、replay accessor 绑定和未知 URL 未处理分支。
  - Codex bridge 共享 app-server/method catalog 单例状态从主文件抽离为独立 helper，并由 server module smoke 覆盖重复读取不重复创建实例。
  - Codex bridge 通知 replay、runtime sync、cache invalidation 和 SSE listener 广播链路从主 middleware 抽离为独立 helper，并由 server module smoke 覆盖单次 App Server 通知的完整同步路径。
  - Codex bridge runtime snapshot/read/reconcile/send/interrupt 装配从主 middleware 抽离为独立 helper，并由 server module smoke 覆盖 runtime operations 工厂与 snapshot 持久化粘合。
  - App Server stdout JSON-RPC line 分流从 bridge 主文件抽离为独立 dispatcher，并由 server module smoke 覆盖 response 结算、notification 分发、server request 转交和无效行忽略。
  - App Server JSON-RPC stdin 写入从 bridge 主文件抽离为独立 writer，并由 server module smoke 覆盖正常写入、未运行报错和写入失败触发恢复回调。
  - App Server 进程 stdout/stderr/stdin/error/exit 事件装配从 bridge 主文件抽离为独立 helper，并由 server module smoke 覆盖 stderr trim、stale process error 忽略和 exit 转交。
  - App Server 进程失败、退出、重启和 dispose 共享的 pending RPC、queued RPC 与 session store 清理收口为独立 helper，并由 server module smoke 覆盖默认清理和 dispose 去重分支。
  - App Server `server/request` 的自动策略、pending 入队和 resolved 通知发射从 bridge 主文件抽离为独立 helper，并由 server module smoke 覆盖自动批准、unsupported 自动拒绝和 pending queue 分支。
  - App Server pending `server/request` 的手动响应消费、reply 写回和 resolved 通知发射从 bridge 主文件收口到 server request helper，并由 server module smoke 覆盖成功消费和缺失请求错误分支。
  - `verify:server-modules` 新增 thread search index 并发构建与 clear 中途失效 smoke，防止会话搜索在并发请求或索引清理后复用过期构建结果。
  - `verify:server-modules` 不再维护手写 `src/server` include 清单，而是只编译 `scripts/server-module-smoke.ts` 并让 TypeScript 跟随 import graph，减少 bridge 模块化后新增 helper 漏进 smoke 编译入口的风险。
  - App Server `thread/read` 未知 thread/turn status 会在 health、diagnostics 和诊断中心按来源聚合计数，方便发现官方协议新增状态且不误判为运行态。
  - App Server `Thread.source` 会在前端线程模型中保留为只读 `sourceKind` 元数据，兼容 `cli`、`appServer`、`subAgent` tagged union 和未来未知来源标签。
  - App Server `Turn.itemsView` 为 `notLoaded` 或 `summary` 且没有加载 items 时，会在前端保留为 `isUnhandled` raw message，避免新版协议返回部分 turn 视图时线程内容静默空白。
  - App Server `thread/read` 中未知 top-level turn item 或非对象 item 会保留为 `isUnhandled` raw message，避免官方新增 `ThreadInjectItems*`、`ThreadShellCommand*` 等 item 时被静默丢弃或导致线程渲染中断。
  - App Server `thread/shellCommand` 与 `thread/inject_items` 通过通用 RPC 触发时会清理 thread list/search/read 缓存，避免官方写入或命令方法执行后继续展示旧线程内容。
  - App Server `thread/metadata/update`、`thread/unarchive`、`thread/compact/start`、`thread/approveGuardianDeniedAction` 和 `turn/steer` 通过通用 RPC 触发时也会按影响范围清理线程缓存，减少新版官方写入方法造成的列表或详情陈旧。
  - App Server `thread/goal/*`、`thread/compacted`、`turn/diff/updated`、`turn/plan/updated`、`rawResponseItem/completed` 和官方 streaming delta/progress/output 通知会清理对应 thread/read 缓存，避免线程详情在流式更新或上下文压缩后继续读取旧快照；`thread/tokenUsage/updated` 仍只更新 token usage cache，不触发消息或列表重拉。
  - App Server `remoteControl/status/changed` 会作为已知官方通知进入只读 Remote Control 诊断，展示状态和 environmentId，避免被误报为未知协议漂移；当前 raw schema 中 `TurnEnvironmentParams` 尚未被 `thread/start` 或 `turn/start` 参数引用，因此不新增环境切换入口。
  - 当前 raw schema 中的 64 个官方 App Server `ServerNotification` method 已全部纳入 known 分类，`unknownNotificationCount` 只用于未来协议漂移或非当前官方 method，避免官方 streaming、account、fuzzy file search 等通知被误报为未知。
  - App Server `skills/changed` 通知会按官方语义触发前端技能列表防抖刷新，并在通知诊断中作为已知 method 处理。
  - App Server `app/list/updated` 与 `mcpServer/startupStatus/updated` 通知会触发 composer 插件/App 列表防抖刷新；`account/rateLimits/updated` 和 MCP OAuth 完成通知纳入已知 method 诊断，减少官方状态通知被误判为未知漂移。
  - App Server `model/rerouted` 与 `model/verification` 通知会进入脱敏模型通知诊断快照，并在诊断中心只读展示，不会改写当前线程渲染或用户选择模型。
  - App Server `windows/worldWritableWarning` 与 `windowsSandbox/setupCompleted` 通知会进入脱敏 Windows sandbox 诊断快照，并在诊断中心只读展示，不会暴露具体本机路径或自动触发 sandbox setup。
  - App Server `windowsSandbox/readiness` 会通过 TTL 缓存进入 health、diagnostics 和诊断中心 Windows 安全卡片，只读展示 ready、notConfigured 或 updateRequired，仍不会自动触发 setup/start。
  - App Server `hooks/list`、`hook/started` 与 `hook/completed` 会进入脱敏 Hooks 诊断快照和诊断中心 Hooks 卡片，只展示事件、来源、trust、启用状态和运行摘要，不暴露 hook 命令、sourcePath 或 hash，也不执行编辑/trust 操作。
  - App Server `item/autoApprovalReview/started` 与 `item/autoApprovalReview/completed` 会进入脱敏 Auto-review 诊断快照和诊断中心 Auto-review 卡片，只展示 review/status/risk/action 类型、耗时、文件数量和 network/file-system 脱敏权限请求标记，不暴露 command、cwd、network target、文件路径、权限 reason 或 rationale，也不改变现有审批策略。
  - App Server `warning`、`guardianWarning`、`deprecationNotice`、`configWarning`、`fs/changed` 和 `externalAgentConfig/import/completed` 会进入脱敏协议告警诊断快照，只展示摘要、路径存在标记和 changed path 数量，不暴露本机路径，也不开放 App Server fs 或外部 agent import 操作。
  - App Server `thread/realtime/*` 实验通知会进入脱敏 Realtime 诊断快照和诊断中心 Realtime 卡片，只展示 method、标识、字节数和错误摘要，不暴露 transcript、audio 或 SDP 内容，也不把 realtime 当作稳定功能入口。
  - 诊断中心新增 schema audit 摘要卡片，展示审计状态、生成时间、官方文档入口和 TypeScript/JSON schema 差异计数。
  - 诊断中心新增权限请求队列，由服务端脱敏并分类展示 App Server pending permission、approval、elicitation 或 tool request，便于排查任务等待授权的原因。
  - `/codex-api/health`、`/codex-api/diagnostics` 和 `/codex-api/server-requests/pending/diagnostics` 新增 `serverRequestDiagnostics` 快照，包含 pending 总数、按类型计数和脱敏请求列表；原始 `/codex-api/server-requests/pending` 保持给审批交互使用。
  - App Server method/notification catalog 生成逻辑从 bridge 主文件拆出，并清理临时 schema 输出目录，减少协议元数据读取的本地残留。
  - App Server `initialize` payload 生成逻辑从 bridge 主文件拆出，默认保持稳定 API 且不启用 `experimentalApi`，后续实验能力接入必须显式 opt-in。
  - App Server 进程/RPC 生命周期类从 `codexAppServerBridge.ts` 拆出到 `appServerProcess.ts`，bridge 主文件只保留 middleware 组装职责；server-module smoke 覆盖不启动外部 Codex CLI 的初始 health、plan-mode 和订阅清理路径。
  - App Server pending server request 与 plan-mode 计数运行时从 `appServerProcess.ts` 拆出到 `appServerProcessServerRequests.ts`，集中管理审批请求入队/解析和计划模式 turn 清理，减少进程类中的 server request glue。
  - App Server 启动参数从 bridge 主文件拆出到 `appServerLaunch.ts`，集中标识当前 legacy high-trust approval/sandbox 策略，并支持通过环境变量选择官方支持的更保守策略；health、diagnostics 和诊断页会展示脱敏后的有效策略快照。
  - Codex home、auth、global state、web settings、skills 和 worktrees 路径统一收口到 `codexPaths.ts`，让 bridge、Web UI state 和 skills 服务一致支持 `CODEX_HOME`。
  - Codex `auth.json` 读取逻辑从 bridge 主文件拆出到 `codexAuth.ts`，只向调用方返回 access token/account id，不进入诊断或日志输出。
  - 置顶线程的 Web 状态、桌面 global state 合并与双写逻辑从 bridge 主文件拆出，减少会话列表状态同步逻辑散落。

## 2.2.7

发布时间：2026-06-08

- Android 文件与更新体验：
  - Android 壳增强本地文件打开 / 下载的登录态续期，减少受保护文件下载到登录页或 HTML 的情况。
  - APK 更新包下载后如缺少“安装未知应用”权限，会先保存待安装包并引导授权，返回后可继续安装。
- 任务同步与交互稳定性：
  - 继续加固任务状态、会话刷新和队列同步，降低移动端回到前台后状态不一致的概率。
  - 优化输入区、会话列表和消息区的局部交互，减少长任务和移动端场景下的误触与状态残留。

## 2.2.4

发布时间：2026-06-04

- 工作台与效率入口：
  - 新增工作台页面，集中展示当前工作区状态、项目默认配置、常用任务模板和技能 / GitHub 热门 / 运行诊断快捷入口。
  - 工作台支持保存和应用项目默认模型、质量、速度和协作模式，减少重复配置。
- 输入区对齐桌面端：
  - 加号菜单补齐计划模式、追求目标、插件偏好、技能选择、文件 / 文件夹 / 拍照入口。
  - 模型、质量、速度合并为一个配置按钮；快速模式才显示闪电标识。
  - 修复移动端关闭配置菜单后遮罩残留、阻挡加号菜单点击的问题。
- 插件与任务选项：
  - 前端支持读取 MCP / 插件能力，选择插件偏好后随任务请求下发给后端。
  - 支持“追求目标”随任务发送，便于连续追求当前目标。
- 本地文件预览与下载：
  - PDF 预览提升清晰度和缩放体验，移动端放大后支持横向滚动查看。
  - Android 原生打开 / 下载增加 operationId 与完成 / 失败事件回传，页面能区分已完成、失败和等待中，减少“下载中无反应”。
  - 缺失文件展示明确错误，不再停留在空白或泛化操作提示。
- 运行稳定性：
  - 长 Prompt 新线程启动和 runtime 状态同步继续加固，降低发出任务后没有回复或状态不收敛的概率。
  - 运行诊断继续展示 app-server、Runtime Store、慢 RPC 和不确定请求，便于定位现场问题。

## 2.2.3

发布时间：2026-05-26

- 性能与稳定性：
  - `model/list` 增加服务端 stale-while-revalidate 缓存，重复打开页面、切换视图或回归测试时不再频繁触发慢模型列表 RPC。
  - 模型列表缓存保持后台刷新，不影响发送、停止、权限响应和当前会话恢复等交互优先级。
- 文档运营：
  - 新增 [平台兼容与 Slash Command 支持](./platform-and-commands.zh-CN.md)，说明 Windows、Android、Linux、WSL2 和 macOS 的支持边界。
  - 补充 `/model`、`/skill`、计划模式、图片、文件引用和工具权限在 CX-Codex 中的等价入口。
  - README 增加平台兼容入口，并补充本地 Markdown、PDF、DOCX、文本和图片预览能力说明。

- 本地文件打开与下载：
  - Word、Excel、PPT、PDF 等本地文件链接改为文件操作页，显示类型、大小、路径和打开 / 下载 / 返回 / 复制操作。
  - `/codex-local-file` 补齐 Office、PDF、文本等常见文件 MIME 与附件下载头，减少 Android WebView 空白或无响应。
  - Android 壳新增 `openFileFromUrl` 与 `downloadFileFromUrl`，下载时会携带 Cookie，支持受保护的本地文件链接。
  - Android 下载完成后可交给系统 Word、WPS、PDF 等应用打开，或加入系统下载管理器。
  - 文件操作页增加超时和降级反馈，旧 APK 或 WebView 下载监听异常时不再卡在“正在打开 / 正在下载”。
- Android 可靠性：
  - WebView 下载监听在启动和回前台时都会重新绑定，降低切后台恢复后下载按钮无响应的概率。
- 多端同步体验：
  - Web 端发送任务后增加桌面端同步提示，可引导刷新官方 Codex 桌面端载入最新会话。
- 技能与 GitHub 热门文案：
  - 技能详情里的“描述”统一改为“解释”。
  - GitHub 热门项目操作按钮统一改为“解释”，更贴近用户实际动作。

## 2.2.2

发布时间：2026-05-15

- Release 自动化补强：
  - GitHub Actions 现在会始终同步并构建 Android 壳。
  - 配置 Android 签名 secret 时继续发布正式 `cx-codex-android-<version>.apk`。
  - 未配置签名 secret 时自动发布 `cx-codex-android-debug-<version>.apk` 备用包，避免开源 Release 缺少 Android 安装资产。
  - debug 备用包只用于自托管测试和临时安装；后续切换正式签名 APK 时可能需要先卸载 debug 包。

## 2.2.1

发布时间：2026-05-15

- 稳定性持续加固：
  - 新增 SQLite WAL runtime store，持久化发送请求、运行事件和线程运行快照，页面关闭、Android 切后台或锁屏后可从本地状态恢复。
  - 前端发送、停止、当前线程恢复和手动刷新改走 runtime API，减少只依赖实时通知流导致的“任务已完成但仍思考中”。
  - 停止任务改为确认流程；停止超时进入不确定状态，由后端 reconcile 核验，不再乐观清空或无限显示旧运行卡片。
  - 顶部刷新升级为强制恢复动作，会回放事件、核验 app-server、拉取 runtime snapshot 和最新消息，并在后端已完成时清理旧 live overlay。
  - Android 前台恢复、解锁和网络恢复后按固定顺序重连事件流、replay missed events、读取本地快照并必要时 reconcile。
- 后端调度优化：
  - 发送、停止、权限响应和当前线程 reconcile 走交互优先级。
  - 会话列表、搜索、技能市场等外围请求保持低优先级并尽量缓存，避免阻塞发送和停止。
  - `/codex-api/health` 增加 runtime store、事件序列、uncertain request 和 reconciler 状态观测。
- 输入框体验优化：
  - 对话框内移除单独设置按钮，改为一个与桌面端一致的运行配置按钮。
  - 模型、质量和速度集中在同一个弹层内修改。
  - 默认速度不显示闪电图标，只有快速模式才显示速度标识。
- 安全与发布：
  - runtime store 和日志不保存明文 token、密码、Authorization 或敏感 URL query。
  - 继续保持 Release 文案和安装说明不包含私人地址、个人目录或真实凭据。

## 2.2.0

发布时间：2026-05-12

- 稳定性大版本收口：
  - Android 切后台、锁屏、网络恢复后会强制重连通知流并收敛运行状态，降低任务已完成但仍显示“思考中”的概率。
  - 手动刷新升级为强制恢复动作，会重新拉取运行快照、当前会话消息和会话列表，并清理旧实时增量残影。
  - 后端对陈旧运行态做降级处理，无 pending request 且线程已完成时不再继续向前端暴露 active 状态。
  - 计划模式完成、失败、中断等路径会按 turn/thread 双路径清理计数，避免计划状态残留。
- 会话体验优化：
  - Android / 折叠屏长回复不再被自动吸到底部顶到中段，长回复会优先锚定到回复开头。
  - 会话列表、置顶、搜索和线程补齐逻辑继续向桌面端 Codex 行为靠拢，减少 Android 端缺记录和状态差异。
  - 搜索和补齐减少批量读取完整 turns，降低大列表下的慢 RPC 压力。
- 技能中心产品化：
  - 技能中心布局改为更紧凑的产品化视图，已安装技能和市场技能展示更清晰。
  - 新增 GitHub 热门技能搜索/浏览能力，可查看技能名称、介绍、来源、热度并直接安装。
  - 技能详情支持展示来源、星标信息和更安全的已安装/启用操作。
- 文件与 Android 体验：
  - 本地文件链接对文档、压缩包、安装包等类型改为下载处理，Android WebView 接入系统下载器。
  - 普通可浏览内容继续保留页面打开体验，减少 App 内点击文件链接无响应的问题。
- 发布与安全：
  - 启动脚本兼容旧配置路径，默认新配置不存在时可回退旧 `~/.codexui/config.json`。
  - 安装脚本不再输出明文密码，只显示 `enabled (hidden)`。
  - 后台日志对密码、token、Authorization、URL query 等敏感字段做脱敏。

## 2.1.17

发布时间：2026-05-06

- 项目正式更名为 `CX-Codex`：
  - GitHub 仓库、README、Release 文案、Issue 引导和部署文档统一指向 `Qjzn/CX-Codex`
  - Windows 一键安装命令改为读取 `https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/bootstrap-windows.ps1`
- 更新运行命名：
  - npm 包名和 CLI 命令改为 `cx-codex`
  - 默认配置文件改为 `cx-codex.config.json`
  - 默认用户配置目录改为 `~/.cx-codex`
  - 日志和 watchdog 状态文件改为 `cx-codex` 前缀
- 更新 Android 身份：
  - App 显示名称改为 `CX-Codex`
  - Android 包名改为 `com.cxcodex.bridge`
  - Release APK 命名保持 `cx-codex-android-<version>.apk`
- 保留兼容：
  - 仍可读取旧 `codexui.config.json`、旧 `~/.codexui/config.json` 和旧 `CODEXUI_*` 环境变量，避免已有部署直接失效。

## 2.1.16

发布时间：2026-05-01

- 优化 Android 和折叠屏侧边栏体验：
  - 折叠屏双栏模式保持侧边栏稳定显示，点击搜索框或搜索按钮不再自动收起侧边栏。
  - 侧边栏支持拖拽调整宽度，拖动过程更跟手，宽度会保存在本机。
  - 降低手机端字号、卡片留白和列表高度，减少“老年视感”和屏幕占用。
- 修复 Android 会话操作问题：
  - 修复重命名弹窗闪现后隐藏左侧菜单的问题。
  - 阻止会话菜单、重命名、删除等弹层在 Android WebView 中穿透点击导致侧边栏关闭。
  - 为触屏端补齐会话置顶/取消置顶入口。
- 对齐桌面端 Codex 会话列表：
  - 会话列表分页加载完整记录，不再只取固定首批数据。
  - 移动端目录模块恢复显示，并保持目录可展开/收起。
  - 会话搜索改为仅搜索标题，会话列表只显示一行标题，不再显示正文预览。
  - 置顶会话状态改为从服务端刷新同步，减少桌面端置顶后 Android 不一致的问题。
- 优化连接地址不可访问时的 Android 引导：
  - 连接失败时提示此前输入的地址无法访问，并引导重新输入新的服务地址。

## 2.1.15

发布时间：2026-04-28

- 修复 Android 首次启动闪退：
  - `MainActivity` 未配置服务地址时不再提前 `return`
  - 所有启动路径都会先调用 `BridgeActivity.onCreate`
  - 原生连接地址输入页改为在 Activity 初始化完成后覆盖显示，避免 Android 生命周期异常
- 刷新公开发行材料：
  - README 改为面向 GitHub 和 AI 检索的产品介绍，突出 Codex Web UI、Android、自托管远程访问和 Windows 友好部署
  - 替换旧截图为脱敏浏览器截图，删除旧图引用
  - 新增项目运营规划，明确版本节奏、Issue 运营、搜索关键词和近期路线
  - Release 版本命名统一为 `2.1.x` 纯数字语义版本
- 修复 Release 打包脚本在旧版 Windows PowerShell 缺少 `Get-FileHash` 时失败的问题，自动降级到 .NET SHA256 计算。

## 2.1.14

发布时间：2026-04-28

- 将 Android 首次连接地址配置前移到原生层：
  - 未保存服务地址时不再启动 WebView，避免“正在启动”和“输入连接地址”两个 Web 页面竞争切换
  - 首次地址输入改用 Android 原生输入框，点击后由系统键盘直接弹出
  - 保存地址后重启当前 Activity，并使用已保存地址进入远程 Web 端

## 2.1.13

发布时间：2026-04-28

- 修复 Android App 首次进入未输入连接地址时，“输入连接地址”和“正在启动”页面频繁切换的问题：
  - 原生壳不再把打包默认地址当作已配置地址
  - 未保存连接地址时只加载本地配置页，不自动跳转远程页面
  - 本地首次启动直接显示连接地址输入页，不再先闪现“正在启动”
- 重置连接地址后回到未配置状态，需重新输入地址，避免默认地址继续参与启动链路。

## 2.1.12

发布时间：2026-04-28

- 修复会话内容页上滑后误显示“最新输出”的问题：只有真实新增下方输出时才显示跳转按钮，思考态/状态刷新不再触发假提醒。
- 会话内容默认只渲染最新 10 条，上滑接近顶部时每次无感补 10 条，直到加载完整上下文。
- 项目删除改为逐线程调用真实归档接口，避免刷新后已删除项目恢复。
- 思考中无命令执行时显示“暂无命令执行”和等待时长，便于识别卡滞状态。
- GitHub 热门项目列表扩展为 10 条，并移除“原始介绍”展示块。
- 侧边栏搜索按钮补齐边框和尺寸，使其与其他图标按钮一致。

## 2.1.11

发布时间：2026-04-28

- 修复 Android App 内消息超链接点击无响应：
  - 新增 Android 原生 `openUrl` 桥接，支持 http、https、mailto、tel 链接
  - 消息内容、附件链接、MCP 请求链接统一走链接打开处理
  - Web 端仍保留新窗口打开行为，Android 本地相对链接在 App 内打开

## 2.1.10

发布时间：2026-04-28

- 保留 GitHub 热门项目功能，继续作为可选入口显示在侧边栏。
- 将非核心能力从主流程移除，降低 Android 和 Web 首屏/恢复时的无关请求：
  - Cloudflare Tunnel 默认关闭，设置页不再展示 Tunnel 状态块，启动后不再自动检测 Tunnel
  - Android 启动和打开设置时不再自动请求 GitHub Release 检查更新，仅用户主动检查时请求
  - Android 壳不再执行桌面端刷新可用性检测
  - 设置页不再自动读取账号限流状态，避免 `account/rateLimits/read` 参与普通使用链路
- 本机配置已同步写入 `tunnel: false`，避免旧配置继续触发不可用 Tunnel。

## 2.1.9

发布时间：2026-04-28

- 修复 Android APK 启动时先闪现主页、再弹出连接地址配置页的问题：
  - Android 壳读取本机连接配置期间先进入独立启动页
  - 未确认连接地址前不再渲染主界面，避免主页和配置弹窗来回闪动
- 降低会话任务超时概率：
  - 首屏刷新不再等待慢 `model/list`，会话列表和主内容优先加载
  - `model/list` 改为 app-server RPC 低优先级，避免抢占会话读取和任务交互
  - 轻量 `thread/read` 服务端超时从 20 秒提高到 30 秒，前端等待提高到 40 秒，减少 Android 恢复时的误超时

## 2.1.8

发布时间：2026-04-27

- 修复 Android 切后台后回到线程仍显示“思考中”的状态卡滞：
  - `completed_pending_sync` 不再被前后端当成“任务仍在运行”
  - 任务完成事件已到达但消息补同步稍慢时，不再显示停止按钮或思考卡
  - Android 回到前台后即使先拿到 runtime 快照，也会把完成态作为已结束处理

## 2.1.7

发布时间：2026-04-27

- Android / Web 默认配置安全收口：
  - Android release 打包默认不再写入任何本机或公网服务地址，首次进入必须由用户输入连接地址
  - 首次输入的连接地址会持久化到 Android App，本机重启或后续启动会直接使用已保存地址
  - Web 登录成功后，Android App 会把访问密钥持久化到本机；Cookie / token 失效或服务重启后会自动用本机密钥无感重登
  - 前端 `/codex-api` 请求遇到认证失效时会先尝试 Android 无感重登，再重试原请求，减少“被踢出登录”造成的同步中断

## 2.1.6

发布时间：2026-04-27

- 修复 Android APK 图标变形问题：
  - Android 图标生成脚本优先使用仓库内 `assets/branding/cx-codex-source.png` 作为唯一源图
  - legacy 图标与 public branding 图标均按源图等比缩放，不再重新绘制替代 logo
  - adaptive foreground 增加安全边距，避免 Android 启动器裁切后出现溢出、压扁或变形

## 2.1.5

发布时间：2026-04-27

- 优化切换会话进入速度，主内容优先加载：
  - 会话切换不再预先触发 `thread/resume`，只有遇到未物化会话时才恢复后重试，避免 `thread/resume` 抢占 `thread/read`
  - 路由进入会话不再先执行完整 runtime snapshot 校验，避免主内容加载前多一次重型读取
  - 上下文进度条的 session log token 统计改为后台补齐，主消息快照返回时不再等待上下文统计扫描
  - 新增独立 `thread-token-usage` 后台接口，进度条未就绪时显示占位，消息内容先进入
  - 同一会话的主消息读取增加前端 in-flight 去重，避免会话选择与后台同步同时请求 `/state/thread`
  - app-server RPC 并发提升到 2，并下调 `thread/list`、技能列表、限流读取优先级，避免慢列表刷新阻塞主内容读取

## 2.1.4

发布时间：2026-04-27

- 继续降低 `thread/list` 对 Android 和 Web 交互的阻塞风险：
  - 服务端 `thread/list` 缓存改为 stale-while-revalidate：缓存过期但仍可用时，先把旧列表返回给前端，再后台刷新
  - 列表缓存新鲜期延长到 3 分钟，最长可作为 20 分钟兜底快照，避免旧页面或多端轮询时反复等待 12 秒级慢列表 RPC
  - 后台刷新增加最小间隔保护，避免多个客户端同时触发同一轮列表刷新
- 修复 Android APK 启动闪退风险：
  - Android 壳未写入默认服务地址时，不再向 Capacitor 传入空 `serverUrl`，改为正常使用 bundled Web 资源
  - 本地一键打包脚本可通过 `-ServerUrl` 显式写入地址；2.1.7 起默认不再内置地址

## 2.1.3

发布时间：2026-04-27

- 后台同步继续减压：
  - 后台和 Android resume 不再按固定间隔反复拉重型 `thread/list`
  - 运行态优先使用 runtime snapshot、事件回放和当前会话消息同步，降低 RPC 队列被列表读取长期占用的概率
  - 后端对 `thread/list` 增加短缓存和结构变化失效保护，即使旧页面或多端仍在轮询，也不会持续压住 app-server
- 稳定性验证工程化：
  - 新增 `npm run test:7420:soak`，可按固定间隔采样本机、公网、RPC 队列和 timeout，并输出 JSON 报告
  - 发布前完成 2 小时浸泡验证：本机 `/health`、`/codex-api/health`、公网 `/health` 全程通过
  - 2 小时浸泡累计 480 个采样点，新增 RPC timeout 为 `0`，最大 `queuedRpcCount=2`，最大 `pendingRpcCount=1`
- 发布定位：
  - `2.1.3` 作为 Android/Web 同步稳定性候选版，重点降低后台轮询、锁屏恢复和多端访问时的排队风险
  - 保持版本号规则：继续使用纯数字 `2.1.x`，不再使用英文后缀

## 2.1.2

发布时间：2026-04-27

- 稳定性回归与 Android 恢复继续收口：
  - 本机 `7420`、公网 `/health`、事件回放、通知游标恢复、桌面 / 手机 / 折叠屏三视口自动化回归通过
  - Android 资源已同步到本轮前端构建，release APK 构建通过
  - Android `versionCode` 改为默认由数字版本号生成，避免后续安装升级仍停留在固定 `1`
- 保持版本号规则：继续使用纯数字 `2.1.x`，不再使用英文后缀

## 2.1.1

发布时间：2026-04-26

- 修复 Android 端回到前台、网络恢复、锁屏恢复时重复触发全量同步的问题：
  - Android 壳使用更稀疏的恢复重试节奏，减少短时间内反复重读会话列表和消息详情
  - 同一轮恢复事件增加防抖，避免 `resume`、`focus`、`pageshow` 连续触发造成请求洪峰
  - 后续补同步只在执行中、列表过期或有待刷新标记时读取重数据
- `codex app-server` RPC 增加服务端排队和优先级：
  - 慢读取队列改为单并发，避免多个慢 `thread/read` 同时把 Android 页面拖成卡住
  - 新消息发送、继续会话、审批回复优先于列表和统计类请求
  - 队列积压时写入告警日志，便于继续定位真实上游慢点
- 继续修复 `turn/start timed out after 20s`：
  - `turn/start`、`turn/interrupt`、`thread/start` 改为交互直通，不再排在慢会话读取后面
  - 前端 RPC 对交互请求使用更长超时，避免后端仍在启动任务时前端先报失败
  - 降低 Android 恢复后 `thread/list` / `thread/read` 对交互请求的抢占
- 安全收口：
  - 启动日志不再输出访问密码明文
  - 从开源跟踪中移除本地 HTTPS 证书私钥，并忽略 `.cert/` 与 `*.pem`

## 2.1.0

发布时间：2026-04-26

- 新增 Android 壳一期基础脚手架：
  - 接入 `Capacitor` Android 依赖与基础命令
  - 新增 `capacitor.config.ts`
  - 新增移动端 App 生命周期 / 网络状态桥接
  - App 回到前台和网络恢复时，可复用现有自动补同步逻辑
  - 补充 `docs/android-shell.zh-CN.md` 说明当前远程壳方案与使用方式
- 新增 Android 本地签名打包链路：
  - Android 工程支持读取本地 `keystore.properties` 做 release 签名
  - 本机已补齐最小 Android SDK、命令行工具和本地 keystore
  - 可直接产出签名版 `release APK`
- Android 壳进一步收口：
  - 应用名称改为 `CX-Codex`
  - 明确放开 Android 端 HTTP 明文访问，适配当前公网地址
  - 启动页改为原生 SplashScreen 方案，减少默认脚手架感
  - 新增 Android 原生“移动端连接”插件，可在 App 设置里直接查看、修改和恢复服务地址
  - 保存新地址后会自动重连，不再需要为了切换地址重新同步 `CAP_SERVER_URL` 再打包
  - 新增品牌图标生成脚本，统一产出 `CX-Codex` 的 Android 图标与 Web 品牌资源
  - 新增 Android 原生“App 更新”能力，可读取 GitHub 最新 Release 并直接下载 APK 安装
  - 新增 `scripts/package-android-release.ps1`，可一键同步前端、构建签名版 APK 并输出 SHA256
  - GitHub Release 工作流新增 Android APK 发布通道，支持在配置签名 secrets 后自动挂 APK 资产
- Android 壳进一步优化稳定性与可用性：
  - 图标改成新的白色圆角卡片样式，并同步到 Android 启动页和 Web 品牌图
  - 折叠屏 / 宽触屏进入双栏布局，左侧会话列表、右侧内容区按设备宽度自动分配占比
  - 设置里的“当前版本”改成可点击检查 GitHub 更新，发现新版本后直接弹出下载安装确认层
  - App 更新版本比较改成真实版本排序，不再把“本机版本更高”误判成有更新
  - 更新下载增加网络检查、临时文件写入和完整性校验，减少安装包损坏或下载到一半失败
  - Activity 增加 `adjustResize` 与可调整大小配置，更适合折叠屏和多窗口场景
  - 会话标题旁新增手动刷新按钮，Android 壳和本地 7420 线程页都可在内容没有及时追平时立即补拉当前线程
  - Android 启动图标改为使用本机品牌源图重新生成全部 `mipmap-*` 图标资源
  - Android 原生插件新增运行状态读取、保持屏幕活跃和触感反馈，执行中可降低锁屏/息屏导致的恢复断点感
  - App 设置里新增原生网络、设备状态和 WebView 版本信息，便于排查手机端卡顿、锁屏恢复和 WebView 差异
  - Android 原生插件新增通知权限检测 / 申请与任务本地通知能力，等待确认、任务完成和任务出错时可在 App 后台或非当前会话场景提醒
  - 新增 `npm run test:7420` 回归脚本，可一键检查本地/公网健康、桌面/手机/折叠屏三视口和浏览器页面错误
- Web 线程同步链路稳定性修复：
  - `codex app-server` RPC 新增服务端超时和 pending 清理，避免上游卡住后把 7420 拖成“有界面但不出内容”
  - 线程快照改成“轻状态先读 + 重消息缓存复用”，同版本线程不再每次都重读全量 turns
  - 重消息读取超时或物化失败时，会先回退到最近一次成功消息，不再轻易把会话打成空白
  - 前端识别缓存态 / 暂不可用态时会保留现有消息，并继续等待后续自动补同步
  - 线程列表对 `status.type` 的执行态识别补齐，减少状态误判
  - 新增服务端通知事件游标与 `/codex-api/events/replay` 回放接口，App 锁屏、切后台或网络抖动后回到前台会先补拉遗漏事件再同步当前线程
  - 前端实时通知流统一记录 `seq`，重连、网络恢复和 App resume 时会按游标回放，降低“任务已结束但还卡在思考中”的概率
  - 通知游标改为浏览器持久化，并在检测到 7420 服务重启导致序号归零时自动重置回放，降低 WebView 被系统回收后漏同步的概率
  - `npm run test:7420` 新增通知游标恢复检查，会主动模拟旧游标并验证页面刷新后能自动纠正
- Android 与移动端体验修复：
  - Android 图标整体缩小，避免桌面图标在白色圆角底板内溢出
  - 设置弹窗在折叠屏也按底部弹层处理，恢复纵向滑动和安全区适配
  - 公网地址增加行内复制按钮，减少移动端误触
  - 会话内容区使用无边框细滚动条，折叠屏和移动端允许纵向触摸滑动
  - 新建会话、搜索、全部已读改为侧边栏图标操作，其中全部已读改用扫把图标
  - 上下文进度、同步状态、收藏入口合并到同一行，收藏入口只保留图标
  - 语音 HTTPS 限制提示改为点击语音时出现，设置项改为控制语音图标是否显示
  - 收藏列表取消收藏改为仅显示图标
- 版本号规则调整：
  - 后续发布不再使用英文后缀，按 `2.1` / `2.1.x` 这类数字版本迭代

## v0.2.0-bridge.4

发布时间：2026-04-24

本次版本重点：

- 新增 GitHub Issue 模板：
  - Bug 报告
  - 功能建议
  - 安装 / 部署求助
- 新增开源运营文档：
  - `CONTRIBUTING.md`
  - `SECURITY.md`
  - `docs/roadmap.zh-CN.md`
  - `docs/cloudflare-tunnel.zh-CN.md`
- README 增加路线图、Cloudflare Tunnel、贡献指南和安全策略入口
- Windows bootstrap 增加 `-EnableCloudflareTunnel`
- Windows install 脚本增加 `-InstallCloudflared`，可自动下载 `cloudflared.exe`
- CLI 增加 Windows 用户目录下 `cloudflared.exe` 的自动识别
- CLI 现在支持 `cloudflaredCommand` / `--cloudflared-command` 显式指定隧道程序路径
- CLI 的 `--tunnel` 运行时补装从 Linux 扩展到 Windows，交互终端可直接提示安装
- Windows install / bootstrap 脚本会把已解析到的 `cloudflared` 路径写入配置，减少后续探测漂移
- Cloudflare Tunnel 文档改为优先说明无需账号域名的快速隧道模式
- Web 设置面板新增 Cloudflare Tunnel 状态区，可直接查看配置状态、最近公网地址和 `cloudflared` 路径，并支持一键复制地址
- Web 设置面板新增当前版本显示和 GitHub 仓库跳转按钮
- 修复会话顶部上下文百分比口径：
  - 不再使用累计 `total.totalTokens` 伪造占用率
  - 改为与官方客户端一致，按 `last.totalTokens / modelContextWindow` 计算
  - 顶部提示文案同步改为区分“当前上下文已用”和“累计 tokens”
- MCP 工具权限请求改为专用确认卡片，不再误显示为补充内容输入框
- 设置面板新增权限控制，可配置命令执行、文件变更、MCP 工具权限，并支持完全放行权限类请求
- 移除 Telegram 对接入口与后端桥接逻辑，清理不可用设置
- 修复语音输入在手机端紧凑布局隐藏麦克风的问题，并增强转写返回格式兼容
- 清理技能中心历史残留：
  - 移除 Firebase GitHub 弹窗登录分支，统一保留设备登录链路
  - 移除未接入页面的孤儿组件和后端 `token-login` 死入口
  - 移除未再使用的 `firebase` 依赖，降低安装体积与维护成本
- 后端模块化一期：
  - 将技能市场目录检索与 README 解析逻辑从 `skillsRoutes.ts` 拆分到 `skillsHubService.ts`
  - 收窄路由文件职责，降低后续继续拆分 GitHub 同步与鉴权链路的耦合风险
- 语音输入体验优化：
  - 手机端麦克风支持更稳定的按住录音交互
  - 不支持直接录音的地址会自动退回到系统录音 / 音频上传链路
  - 新增更明确的录音状态提示，减少误触和长按丢失
- 鉴权恢复修复：
  - 当登录态失效时，API 会返回明确的鉴权失效响应
  - Web 端会自动识别并回到登录页，不再需要手动刷新
- 会话同步与性能优化：
  - 已加载过的会话改为缓存优先显示，再在后台静默刷新
  - 页面回到前台、网络恢复或通知流陈旧时会主动重建实时通道并补同步
  - “同步异常”从通用操作错误中拆分，只在真实同步失败时展示
  - 减少线程切换时旧内容停留和切换浮动动画，降低卡顿与闪烁
  - 放宽执行态短暂抖动的容错，降低“思考中”卡片无故消失的概率
- 仓库对外包装收口：
  - 重写 README 首屏，突出“本地 Codex 浏览器入口 + Windows 友好 + 手机可用”的定位
  - 路线图改为用户价值导向，围绕 5 分钟可用、手机顺手、远程省事和问题可定位展开
  - 新增 GitHub 包装文案包，统一 About、topics、social preview 和对外介绍口径
  - 新增 GitHub 社交预览图与 Release 文案模板，降低每次发版时重新组织卖点的成本
- 会话收藏能力：
  - 每条用户 / 助手消息卡片右上角新增收藏按钮
  - 顶部新增全局收藏入口，可统一查看所有会话的收藏内容
  - 收藏面板支持搜索、仅看当前会话、复制内容、跳转原会话和取消收藏
  - 跳转收藏项时会自动定位并高亮对应消息
- 会话顶部新增上下文百分比状态：
  - 接入真实线程 token usage 通知与线程快照
  - 会话标题下方增加环形上下文占用状态，环内直接显示百分比
  - 刷新页面或断线回补后，仍会从桥接快照恢复最近一次上下文统计
  - `thread/tokenUsage/updated` 不再触发多余的消息/会话列表重拉，减少无效刷新
- 左侧会话列表收口为更紧凑的桌面阅读样式：
  - 默认改为一行标题 + 一行摘要
  - 不再额外显示“未读”文字标识，未读和执行中仅保留状态点
  - 项目目录与选中会话加深底色和边框对比，区分层级更明确
- 收藏与置顶改为账号级持久化：
  - 收藏记录不再只保存在当前浏览器 `localStorage`
  - 置顶线程列表也同步迁移到本机账号目录下的持久化文件
  - 新浏览器或重新登录后会自动回补账号级收藏与置顶状态
- Cloudflare Tunnel 状态检测与设置交互增强：
  - 修复只读取固定 `cx-codex.out.log` 导致 7420 实际日志无法识别的问题
  - 改为扫描最新 `.out.log`，正确识别当前端口对应的日志、`cloudflared` 路径和公网地址
  - 设置面板新增 Tunnel 开关、打开公网地址、保存检测到的 `cloudflared` 路径，便于直接在前端操作

## v0.2.0-bridge.3

发布时间：2026-04-22

本次版本重点：

- 修复 MCP Elicitation 待处理请求体验：
  - Web 端现在可以识别 `mcpServer/elicitation/request` 与 `elicitation/create`
  - 不再把底层方法名直接显示给用户
  - 待处理请求会显示为“等待输入 / MCP 服务需要补充信息”
  - 支持表单输入、下拉枚举、布尔选项、数字输入和 URL 打开场景
- 修复待处理请求按钮语义：
  - 表单模式返回 `action: accept` 与 `content`
  - URL 模式返回 `action: accept` 且不携带表单内容
  - 拒绝和取消分别返回 `action: decline / cancel`
- 优化执行状态提示：
  - 状态卡文案从“上方有待处理请求”修正为“下方有待处理请求”
  - 避免当前底部状态卡布局下的方向误导
- 维护验证：
  - `vue-tsc --noEmit` 通过
  - `npm run build:frontend` 通过
  - 本机 `7420` 首页返回 `200`

## v0.2.0-bridge.2

发布时间：2026-04-21

本次版本重点：

- Web 端发送体验优化：
  - 发送消息后立即在会话框回显用户消息，不再等待下一轮同步
  - 后端真实用户消息同步回来后自动去重替换，避免重复显示
  - 队列消息在真正开始执行时也会立即进入会话流
- 会话执行状态优化：
  - “思考中 / 执行命令 / 待处理请求”卡片从顶部冻结区域移到会话底部
  - 执行状态不再长期占用顶部阅读空间
  - 当前执行命令与过程只展示在当前会话的动态状态卡里
- 同步与恢复体验优化：
  - 页面回到前台、网络恢复或浏览器重新进入时会自动补同步
  - 服务状态文案从“等待新请求 / 待机”收口为更明确的自动同步状态
  - 优先刷新当前会话消息，再刷新会话列表，减少“执行中但内容不更新”的错觉
- 图片与本地内容展示修复：
  - Web 端支持接收并展示 Codex 回复中的图片内容
  - 兼容 `image_url`、本地图片路径和 markdown 图片
  - 本地文件浏览地址处理更稳，降低手机端打不开本地内容的概率
- 全局 UI 密度与移动端体验优化：
  - 默认 UI 显示密度调整为接近浏览器 `90%` 缩放效果
  - 主布局、移动抽屉、技能弹窗和重命名弹窗统一缩放口径
  - 技能、模型、思考强度等输入区弹层继续适配手机输入法场景
- 会话与侧栏交互稳定性修复：
  - 修复会话切换加载过程中的交互卡顿
  - 修复会话列表字体显示不全、置顶与未读状态相关体验问题
  - 优化长会话滚动、分页加载和底部跟随逻辑

## v0.2.0-bridge.1

发布时间：2026-04-18

本次版本重点：

- 会话滚动与长线程性能优化：
  - 滚动监听改成 `passive + requestAnimationFrame` 合批
  - 将消息累计高度计算与可视区范围计算拆分，减少滚动时主线程开销
  - 滚动状态上报增加节流，降低父层同步负担
- 会话历史分页加载：
  - 默认仅显示最新 `20` 条消息
  - 上滑到顶部会自动继续加载更早的 `20` 条
  - 保留顶部“继续查看更多”入口，并在加载后维持阅读位置，避免跳屏
- 会话切换体验优化：
  - 切换时只保留一套轻量加载提示
  - 新会话内容到位前短暂保留旧内容做平滑过渡
- 执行中输入区优化：
  - 执行任务过程中，`模型 / 技能 / 思考强度` 三个控件不再被锁死
- 技能选择器改成交互更稳的统一弹窗：
  - 手机端贴底弹层，避免输入法直接遮挡
  - PC 端也改为贴底显示，不再居中悬浮
  - 技能列表默认显示 `6` 条，超出后内部滚动
  - 打开技能弹窗时不再自动聚焦搜索框，避免真机一打开就弹出输入法
- 输入区底部控制条调整为更稳定的三列布局，减少手机端横向裁切和按钮错位
- 补充手工回归步骤，覆盖会话滚动流畅度、分页加载、切换加载态与执行中输入区控件可用性

## v0.1.59-bridge.1

发布时间：2026-04-17

本次版本重点：

- 修复线程切换加载过程中点击其他会话不立即响应的问题
- 收口空线程 deep link、空线程移除和空线程恢复边界
- 修复本地图片上传与回显链路
- 会话执行中发送新消息默认进入消息队列
- 支持“引用立即执行 / 删除队列消息 / 自动顺序续跑”
- 修复消息队列稳定性问题：
  - 引用失败不再丢消息
  - 自动消费成功启动后再出队
  - `localStorage` 写失败时保留内存态
- 会话区命令卡片改成仅展示执行中的命令
- “刷新桌面端”入口移到设置里
- 侧栏新增“全部已读”
- 全局 UI/UX 收口，手机端、侧栏、会话区与输入区更简约
- 清理一批未使用死代码，并补 `.vue` 类型声明，方便后续严格静态检查

## v0.1.58-bridge.6

发布时间：2026-04-17

- 修复线程详情加载过程中快速切换会话卡住的问题

## v0.1.58-bridge.5

发布时间：2026-04-17

- 收录空线程恢复、图片回显、线程快照与移动端体验相关修复
