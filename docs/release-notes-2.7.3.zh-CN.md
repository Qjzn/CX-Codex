# CX-Codex 2.7.3：会话队列不丢消息，长会话回复更快

2.7.3 集中收口会话模块的可靠性与响应速度：排队消息真正由 7420 服务端持久接管，刷新、切换会话或关闭 Android 页面后仍能继续；长会话先展示最近内容，再在后台恢复完整结构；计划、持续目标、文件引用和任务宠物也一起完成稳定化。

## 本版重点

- 计划模式会持续开启，直到用户主动关闭或提交实施；结构化计划卡支持折叠、进度状态和“一步实施”。
- 新增线程级持续目标，可暂停、继续、编辑和清除，并展示预算与耗时。目标状态以 App Server 为唯一事实来源，不会与用户消息或待处理审批抢占执行。
- 已发送但尚未进入权威历史的消息会跨刷新恢复；外部 Codex 进程追加的 commentary 能及时出现，不再被当成空白或最终答复。

## 真实消息队列

- 排队消息在进入界面队列后立即持久化到 7420 服务端。切换会话、刷新浏览器或关闭 Android Activity 后，服务端仍会在当前轮次结束后按顺序继续发送。
- 修复内部队列通知拿上一轮完成快照结算新消息的问题；新排队消息不会再“显示完成但没有 turnId”，也不会静默消失。
- 修复 App Server 秒级时间戳导致新消息在启动阶段并入上一轮的问题。每条排队消息都由独立 turn 承载。
- 快速连续添加、删除、重试和失败阻塞按稳定 `clientMessageId` 合并；完整同步后才会应用服务端精确重排，并发变化时回退到服务器权威顺序。

## 长会话与回复速度

- 默认最近消息读取优先使用本地会话日志的有界投影，最多保留最近 40 轮；大文件追加时只读取新增字节，不再每 8–10 秒重新扫描完整历史。
- 连续写入停止 1.8 秒后只做一次权威收敛，补回计划、命令执行、文件变化、审批、MCP 和工具项目，速度优化不会牺牲结构化消息。
- 72 MB 真实长会话中，原先反复出现的 6.7–8.0 秒重读已消失；最终普通无工具回复从接受到首个助手数据约 1.7 秒，排队回复首字约 1.9–2.3 秒。

## 文件引用与 Android

- `:codex-file-citation` 现在显示真实文件名并打开完整路径，不再泄漏内部指令文本或附加元数据；Windows 路径、空格、Unicode 和转义属性都能安全处理。
- Android 本地 PDF 预览改用 PDF.js legacy 主线程与 worker，在缺少 `Promise.withResolvers` 或 `Math.sumPrecise` 的旧 WebView 中也能渲染。
- Android 任务宠物默认安静贴边，只在新助手回复时短暂显示五秒，任务栈八秒后自动收起；进入 CX-Codex 前台后不重复显示浮窗或完成通知。
- 未读状态由持久化回复事件游标管理。打开准确会话后立即清除对应提醒，普通运行状态不再被误计为未读。

## 安全与兼容边界

- 本版没有放宽文件、工作区、Cookie、WebSocket、远程入口或 App Server 权限边界；文件预览仍受服务端允许路径和登录态约束。
- 会话日志投影只用于快速显示可恢复文本，完整结构仍由权威 `thread/read` 收敛，不宣称完全对齐所有未来 App Server schema。
- 正式 Android APK 继续由 GitHub Release 工作流使用固定证书构建并校验证书 SHA-256；源码不内置私人服务地址或 Firebase 项目凭据。

## 安装或升级

Windows 服务端可继续使用正式 Release 安装或升级；`RemoteQuick` 和 `JsonOutput` 合同保持兼容：

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/bootstrap-windows.ps1'))) -RemoteQuick -JsonOutput
```

Android 用户可从本 Release 下载 `cx-codex-android-v2.7.3.apk` 覆盖安装。正式 APK 与 `2.5.9+` 使用同一签名，可保留已有服务地址和设置。

官方卸载入口仍可默认保留访问配置、Codex 登录态、工作区和 Android 正式签名：

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/uninstall-windows.ps1'))) -JsonOutput
```

请同时下载对应 `.sha256` 文件校验 Release ZIP 或 APK 的 SHA-256。

## 发布验证

- 前端 normalizer、服务模块、前端生产构建、CLI 构建和侧栏数据回归通过。
- 完整 7420 前端套件在最终队列顺序实现上再次覆盖 36 个桌面、手机横竖屏和折叠屏场景，耗时 590.3 秒。
- 真实队列验证得到 `BASE -> A -> B` 三个独立 turn；重排验证得到 `BASE -> C -> A -> B` 四个独立 turn，服务端列表与权威会话历史一致。
- 最终会话列表检查覆盖 239 个活跃会话、20 个目录和 6 个可读置顶会话，零 RPC 重试；服务健康状态中活动/等待 RPC、待处理请求、未知执行、线程租约和消息队列均为零。
- Release ZIP、npm 打包边界、Windows 产品化、Android 正式签名和所有 SHA-256 会在标签工作流中再次验证。

标签发布前，本版仍属于候选版本。只有主分支 CI、Release 工作流、公开 ZIP/APK、SHA-256 和固定 Android 签名全部通过后，才视为正式稳定版本。
