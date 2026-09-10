# Quiet Workbench Android 真机验证记录

日期：2026-08-29
候选边界：隔离 worktree 的生产前端构建，由 `com.cxcodex.bridge.debug` 加载本机 `http://127.0.0.1:17436`；正式包 `com.cxcodex.bridge` 2.8.0、生产 7420、用户数据和认证均未替换。

## 设备与安装

- 设备：OPPO PKH110，Android 16，物理主屏 2248×2480，density 520。
- 调试包：2.8.0-debug，仓库既有 `applicationIdSuffix ".debug"`，与正式包并存。
- 连接：`adb reverse tcp:17436 tcp:17436`；17436 提供本轮生产 `dist`，仅把 `/codex-api` 代理到隔离候选 17435。
- WebView 证据：通过调试包 CDP 读取真实 `visualViewport`、DOM 几何、可访问名称和溢出状态；脚本为 `scripts/inspect-android-quiet-workbench.mjs`。

## 结果

| 场景 | 权威结果 | 证据 |
| --- | --- | --- |
| 折叠屏竖屏启动 | 691×730 CSS viewport，双栏正常，页面无横向溢出 | `01-portrait-launch.png`、`02-portrait-ime.json` |
| 折叠屏竖屏软键盘 | OEM IME 高 1009px；`visualViewport` 高 406px；Composer 与 controls 均完整位于可视区，5 个可见控制均为 44px | `03-portrait-oem-ime.png/json` |
| 折叠屏竖屏长输入 | 192 字符后 textarea 从 32px 增长到 87.5px、Composer 到 152.6px，仍不遮挡键盘 | `05-portrait-oem-autogrow.png/json` |
| 折叠屏横屏软键盘 | 763×370 CSS viewport；textarea 67.6px、Composer 132.7px，全部控制仍在可视区且无横向溢出 | `06-landscape-oem-ime-autogrow.png/json` |
| Android Back 收键盘 | 第一次 Back 只关闭 IME；路由仍为 `#/`，192 字符草稿不丢失，应用仍在前台 | `07-back-hides-ime.json` |
| 前后台恢复 | Home 后热恢复到同一路由；草稿长度仍为 192，布局与控制可达性不变 | `08-background-foreground.png/json` |
| 设置弹层与 Back | 设置以底部 sheet 打开；Back 只关闭 sheet，应用与原页面保持前台 | `10-settings-sheet.png`、`11-settings-back.png/json` |
| 332 CSS px 窄屏 | 单栏 Header + 覆盖式 Sidebar；页面宽度与滚动宽度同为 332，无横向溢出；Composer 控制均为 44px | `12-phone-layout.png/json` |
| 窄屏 Sidebar 与 Back | 抽屉覆盖正文且保留遮罩；Back 只关闭抽屉并把焦点还给“展开侧栏” | `13-phone-drawer.png`、`14-phone-drawer-back.png/json` |
| 窄屏软键盘 | OEM IME 高 872px；`visualViewport` 高 423px；Composer 与 controls 完整位于可视区 | `15-phone-ime.png/json` |
| 窄屏长输入 | 120 字符后 textarea 87.5px、Composer 152.6px；仍位于 423px 可视区，零横向溢出 | `16-phone-ime-autogrow.png/json` |
| 锁屏长任务 | 熄屏期间保持非交互态，任务从 1 个活动态收敛为 0；终态与完成通知各只推进 1 次 | `android-background-20260829/screenoff-terminal-fixed/summary.json` |
| 强制 Doze | 观察窗口内 `deviceIdleMode=true` 且屏幕保持关闭；任务终态与完成通知在恢复前完成 | `android-background-20260829/doze-locked-terminal/summary.json` |
| 网络切换 | 连续 10 轮移动数据关闭/恢复均触发原生权威快照恢复，最终仍保留同一个活动任务且无重复终态 | `android-background-20260829/network-switch-10-authoritative/summary.json` |
| 进程回收 | 活动任务中以调试包自身权限终止进程，PID 变化，系统粘性重建或恢复看门狗归因成立，活动任务仍为 1 | `android-background-20260829/process-recovery-authoritative/summary.json` |
| 新任务代际栅栏 | 新任务在 `turn/started` 后不会被前端瞬时终态提前结算；原生保存精确 `requestTurnId`，服务端真实完成前保持 `running` | `android-background-20260829/latest-active-preserve-submit.json`、原生诊断与 `/runtime/snapshots` 对照 |
| 完成通知点击与去重 | 后台终态到通知 11ms，完成通知只投递 1 次；点击后精确回到目标 `#/thread/:id`，活动完成通知归零且 15 秒内未重发 | `android-background-20260829/notification-click-observe/summary.json`、`after-click-webview.json`、`dedupe-after-15s.json` |

页面类 JSON 都同时满足：一个主 landmark、零可见无名称按钮、`scrollWidth <= clientWidth`。页面截图与 JSON 位于 `output/quiet-workbench/android-20260829/`，生命周期证据位于 `output/quiet-workbench/android-background-20260829/`；两个目录均为本地验证输出，不进入 Git。

## 生命周期结论与剩余边界

- 调试包的屏幕关闭、Doze、10 轮网络切换、应用进程回收、终态通知、通知点击与去重均已在同一台真机和同一隔离候选链路通过。
- Runtime `/runtime/request` 的 `completed` 只表示发送调度完成，不代表 turn 终态。原生现在持久化 `requestTurnId`，以 `/runtime/snapshots` 的活动 turn 与开始/完成时间栅栏决定结算；同一代任务仍由原生监控时，前端瞬时终态不能覆盖它。
- OPPO 最近任务划除测试会终止整个调试包并取消其 Alarm；在没有系统“允许后台运行/自启动”授权或 FCM 配置时，应用无法在该 OEM 行为后自我唤醒。这是当前真机外部策略阻塞，不记录为通过。
- 当前仓库默认未捆绑 `google-services.json` 或服务账号，`mobilePushDiagnostics.state=not_configured`。普通 SSE/轮询、锁屏和强制 Doze 已验证；FCM 深度休眠唤醒仍是可选配置能力，不用未配置状态冒充已验证推送。
- 410×502 Android 9 手表实体设备仍不可用，手机分辨率覆盖或浏览器仿真不能替代该设备证据。

## 设备恢复与证据边界

- 验证结束后已清空测试草稿，恢复物理分辨率 2248×2480、自动旋转、`show_ime_with_hard_keyboard=0` 和原微信输入法；临时启用的 OEM 搜狗输入法已再次禁用。
- 调试包暂时保留用于最终候选复测；它不覆盖正式包，也不证明最终签名 Release APK、OPPO 最近任务划除后的 OEM 后台自启动或手表矩阵已经通过。
- 本记录已覆盖 UX-40、UX-60 以及手机端主要 Android 生命周期矩阵。完整发布设备门槛仍按 `PRODUCT_GOAL.md` 独立执行，不能用调试签名或单一设备扩大结论。
