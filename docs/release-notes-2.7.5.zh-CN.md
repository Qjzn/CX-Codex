# CX-Codex 2.7.5：修复 Android 重复消息、后台卡死与白屏恢复

2.7.5 聚焦手机端聊天稳定性，并吸收两项社区贡献。它修复 Android 从后台恢复后同一条用户消息显示两次、等待期间交互卡住，以及 WebView 被系统回收或崩溃后长时间白屏的问题；同时减少 Windows 后台控制台弹窗，并让 fork 拉取请求可以正确执行 Windows 安装烟测。

## Android 消息与前后台恢复

- 每次发送都会持久记录发送前的消息边界。刷新或恢复时，已经进入 Codex 权威历史的消息会替换对应的本地乐观气泡，不再把同一问题渲染两次。
- 旧版本遗留的待发送记录没有新边界字段时，会根据原有尾消息或消息数恢复基线；升级后不要求用户清缓存或丢弃会话。
- 回到前台后的首次同步仍会及时执行，后续 4.5 秒和 12 秒重试只在消息待处理、存在未读、连接陈旧、内容未加载、队列未清空或服务端请求仍在运行时触发，降低重复全量读取和界面卡顿。
- 等待卡片保持可点击，详情面板可正常打开和关闭，不会留下透明遮罩阻断页面操作。

## Android 白屏自恢复

- 原生壳在恢复时会探测 WebView 是否真正响应；无响应、渲染进程被系统回收或崩溃时先显示明确的恢复状态，再自动重建页面，不再让用户面对无反馈白屏。
- 保持系统默认的 WebView 渲染器重要性，不在应用进入后台时主动降低存活优先级。
- 低内存回收会恢复原来的安全会话路由；真实渲染崩溃会从服务根入口重建，避免同一路由持续触发崩溃循环。

## Windows 与社区贡献

- Windows 启动 Codex App Server 子进程时启用隐藏窗口参数，减少后台服务控制台反复弹出。
- fork 拉取请求的 Windows bootstrap 烟测现在从贡献者自己的仓库和分支取源码，不再误用上游仓库分支；活动任务升级夹具保持不变。
- 感谢 [@534A4D21](https://github.com/534A4D21) 提交并协助定位拉取请求 #46、#47。

## 安装与升级

Windows 一条命令安装或升级：

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/bootstrap-windows.ps1'))) -RemoteQuick -JsonOutput
```

需要完整卸载程序但保留默认可恢复数据时，使用官方卸载入口：

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/uninstall-windows.ps1'))) -JsonOutput
```

Android 请从 [GitHub 最新 Release](https://github.com/Qjzn/CX-Codex/releases/latest) 下载 `cx-codex-android-v2.7.5.apk`。正式 APK 使用与 2.7.4 相同的固定证书，可直接覆盖升级；不要安装来源不明或使用其他证书重签名的同包名 APK。

## 验证与边界

- 发布候选已通过前端 normalizer、生产前端与 CLI 构建、完整 36 场景前端回归、Android 恢复策略单元测试、Android lint、Release 构建、签名和 zip-alignment 检查，以及 60 秒本地稳定性浸泡。
- 依赖升级拉取请求 #49、#50、#51 未混入本次稳定性修复。它们分别影响 Android PDF 兼容、聊天 Markdown 渲染和原生 SQLite 运行时，需要独立回归后再处理。
- FCM 深度 Doze 真机验收仍由 issue #28 跟踪。前后台恢复和 WebView 自愈不等同于后台推送能力，本版不会把浏览器或 JVM 测试描述成真机 Doze 通过。
- 远程访问仍要求本机 7420 服务和 HTTPS 通道正常；本版不会把 Cloudflare Quick Tunnel 的随机临时域名变成固定域名。

标签发布前，本版仍属于候选版本。只有主分支 CI、Release 工作流、公开 ZIP/APK、SHA-256、固定 Android 签名和公网 Windows 全新安装全部通过后，才视为正式稳定版本。
