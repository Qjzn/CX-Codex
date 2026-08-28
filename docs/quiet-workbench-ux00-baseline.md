# Quiet Workbench UX-00 Baseline

日期：2026-08-29
候选基线：`origin/beta` / `09325a7`
本机生产基线：CX-Codex 2.8.0 / `http://127.0.0.1:7420`
Android 基线：`com.cxcodex.bridge` 2.8.0（versionCode 20800）

## 对照来源

- 当前安装版官方 Codex：`OpenAI.Codex 26.818.5229.0`。已检查当前 `app.asar` 的 Shell、Conversation、Composer、队列和审批相关资源。
- 官方客户端可复用的产品模式：约 48px Header、turn 状态、完成后突出结果、条件化 Outputs、独立 queued-message 与 approval 表面。
- Sema Code Core：固定提交 `f564e8d930053becdd5c31fe53f65fd863b6f283`。只采用 44px 顶栏、紧凑导航、约 768px 阅读列、轻量 Composer 和过程摘要等桌面模式。

## 当前可复现事实

首次桌面截图保留了用户显式 Sidebar 宽度 260px；源码新用户默认仍为 356px。1440×900 会话页实测 Header 101px、Conversation 900px、Composer 860×98px。884×1104 与 768×1024 仍保留 260px Sidebar，主列分别只剩 618px 与 502px。393×852 无页面横向溢出，但运行目标条与近 100px Composer 明显压缩阅读区域；852×393 的 Conversation 可见高度约 119px。

这些事实支持 PRD 的整改判断：保持 CX 的状态可靠性，收紧 Header/Composer，统一阅读轴线，并在 compact/tablet 避免持久双栏压缩正文。

## 稳定状态路由

| 状态 | 路由 |
| --- | --- |
| home | `/#/` |
| running | `/#/__regression/conversation-blocks?regression=frontend&uxState=running` |
| completed | `/#/__regression/conversation-blocks?regression=frontend&uxState=completed` |
| waiting-input | `/#/__regression/conversation-blocks?regression=frontend&uxState=waiting` |

## 截图矩阵

脚本为下列 5×4 组合生成 PNG，并在同目录写入 `manifest.json`：

| 视口 | home | running | completed | waiting-input |
| --- | --- | --- | --- | --- |
| 1440×900 | 必须 | 必须 | 必须 | 必须 |
| 884×1104 | 必须 | 必须 | 必须 | 必须 |
| 768×1024 | 必须 | 必须 | 必须 | 必须 |
| 393×852 | 必须 | 必须 | 必须 | 必须 |
| 852×393 | 必须 | 必须 | 必须 | 必须 |

默认输出：`output/quiet-workbench/ux00-baseline/`。截图目录被 Git 忽略，避免把真实任务名、路径或账户状态写入发布资产。

## 命令

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/capture-quiet-workbench-baseline.ps1
npm.cmd run verify:governance
git diff --check
```

验证尚未部署的候选 fixture 时，可让首页继续读取生产 7420，并把状态夹具指向独立静态预览：

```powershell
agent-browser close --all
.\scripts\capture-quiet-workbench-baseline.ps1 -Scope home -BaseUrl http://127.0.0.1:7420
agent-browser close --all
.\scripts\capture-quiet-workbench-baseline.ps1 -Scope fixtures -FixtureBaseUrl http://127.0.0.1:17435
```

Windows 上分段运行可避开浏览器守护进程在跨服务切换时的 CDP 竞态，并分别生成 `manifest-home.json` 与 `manifest-fixtures.json`。正式候选已经部署到同一服务后使用默认 `all`，生成单一 `manifest.json`。候选 fixture 必须由带 `codex-bridge` 中间件的 Vite 开发服务或完整 CX-Codex 服务承载；普通静态 preview 会把 `/codex-api/` 请求回退为 HTML，触发现有鉴权恢复重载，不能作为有效回归服务。

如果 `agent-browser` 的 Windows 守护进程无法稳定附着 CDP，可在记录原因后对同一 fixture 使用本机已有的 Headless Playwright；该路径仍检查精确视口、状态 DOM、唯一状态所有者和页面级横向溢出：

```powershell
.\scripts\capture-quiet-workbench-baseline.ps1 -Scope home -BrowserMode playwright -BaseUrl http://127.0.0.1:7420
.\scripts\capture-quiet-workbench-baseline.ps1 -Scope fixtures -BrowserMode playwright -FixtureBaseUrl http://127.0.0.1:17435
.\scripts\capture-quiet-workbench-baseline.ps1 -Scope home -BrowserMode playwright -Theme dark -BaseUrl http://127.0.0.1:17435 -OutputDirectory output\quiet-workbench\dark-home
.\scripts\capture-quiet-workbench-baseline.ps1 -Scope thread -BrowserMode playwright -ThreadTitle '<stable title fragment>' -BaseUrl http://127.0.0.1:17435 -OutputDirectory output\quiet-workbench\thread
.\scripts\capture-quiet-workbench-baseline.ps1 -Scope sidebar -BrowserMode playwright -FixtureBaseUrl http://127.0.0.1:17435 -OutputDirectory output\quiet-workbench\sidebar
```

## 2026-08-29 验收记录

- 输出目录：`output/quiet-workbench/ux00-baseline-20260829/`。
- `manifest-home.json` 记录 5 张生产首页截图；`manifest-fixtures.json` 记录 15 张候选状态截图。
- running、completed、waiting-input 在每个视口的 SHA-256 均各不相同；没有 query-only 路由复用造成的重复状态图。
- 15 个候选状态均无页面级横向溢出。running 每个视口恰有一个 live owner 且没有 request owner；completed 二者均无；waiting-input 恰有一个 request owner 且没有 live owner。
- 人工抽查确认当前视觉问题：桌面首页 Header 与 Composer 偏高、中心内容与侧栏信息密度失衡；768/884px 持久双栏挤压正文；手机长标题和命令摘要存在内部裁切风险；852×393 的有效会话高度不足。这些问题进入 UX-10、UX-30、UX-40 和 UX-60，不在 UX-00 改写业务 UI。
- `npm run test:7420:frontend -- -SourceOnly`、`npm run verify:governance`、`npm run build:frontend` 与 `git diff --check` 通过。

## UX-00 完成条件

- [x] 20 张稳定基线截图和两个分段 manifest 均成功生成。
- [x] 人工查看桌面、平板、手机竖屏和横屏，记录布局问题。
- [x] `DESIGN.md`、本文和脚本通过治理与差异检查。
- [x] UX-00 不修改用户可见业务逻辑。

## 回滚

删除 `DESIGN.md`、本文和截图脚本即可；`output/` 可直接丢弃，不影响 Runtime、7420 或 Android 数据。
