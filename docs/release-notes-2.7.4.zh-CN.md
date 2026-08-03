# CX-Codex 2.7.4：恢复 Windows 全新安装，延续会话稳定性修复

2.7.4 是替代 2.7.3 的发布完整性热修复。2.7.3 的源码、会话回归、GitHub Actions、APK 签名和 SHA-256 校验均通过，但公开 Release ZIP 漏打了本地预览构建配置，真实 Windows 全新安装会在依赖安装后失败。该版本已撤回稳定最新版身份，2.7.4 补齐文件并把同类缺失升级为发布阻断项。

## Windows 安装修复

- Release ZIP 现在强制包含 `vite.config.ts` 与 `vite.local-preview.config.ts`，与 `npm run build:frontend` 的两个 Vite 构建入口保持一致。
- 发布包烟测会同时检查两个配置文件；治理门禁也会锁定打包脚本中的必需清单，避免只在源码树可构建、解压后的发布包却无法构建。
- Windows 正式安装继续支持 `RemoteQuick` 和稳定的 `JsonOutput` 合同：

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/bootstrap-windows.ps1'))) -RemoteQuick -JsonOutput
```

官方卸载入口保持不变：

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/uninstall-windows.ps1'))) -JsonOutput
```

## 会话稳定性

2.7.4 同时包含 2.7.3 的全部会话模块修复：

- 消息队列由 7420 服务端持久接管，刷新、切换会话或关闭 Android 页面后继续按顺序发送。
- 修复内部队列通知使用上一轮完成快照误结算新消息，以及秒级时间戳让新消息并入上一轮的问题；每条排队消息由独立 turn 承载。
- 快速连续添加、删除、重试和重排按稳定消息 ID 合并；完整同步后才执行服务器精确顺序更新，并发冲突时回退到权威顺序。
- 长会话优先读取最近 40 轮的本地有界投影，连续追加只读取新增字节；静默窗口后再做一次权威收敛，保留计划、命令、审批、文件和工具记录。
- 已发送但尚未进入权威历史的消息可跨刷新恢复，外部 Codex 进程的 commentary 能及时显示。

## 计划、文件与 Android

- 计划模式持续生效，并提供结构化计划卡与线程级持续目标；暂停、继续、编辑、清除、预算和耗时以 App Server 状态为准。
- 文件引用显示真实文件名并安全打开完整路径；Android PDF 预览兼容旧 WebView。
- Android 任务宠物减少浮窗打扰，未读状态使用持久化回复事件游标，进入准确会话后立即清除提醒。

## 安全、校验与兼容边界

- 本版没有放宽文件、工作区、Cookie、WebSocket、远程入口或 App Server 权限边界。
- 正式 Android APK 继续由 GitHub Release 工作流使用固定证书构建；源码不内置私人服务地址或 Firebase 项目凭据。
- 请同时下载对应 `.sha256` 文件校验 Release ZIP 或 APK 的 SHA-256。
- 本地会话日志投影只用于快速恢复可显示内容，完整结构仍由权威 `thread/read` 收敛，不宣称完全兼容所有未来 App Server schema。

## 发布验证

- 会话队列真实执行、重排、回复延迟、会话列表、长会话、前端 36 场景、服务模块、前端 normalizer、生产构建和 CLI 构建已完成回归。
- 2.7.4 新增发布 ZIP 双 Vite 配置断言，并要求从 GitHub 公网最新版执行隔离的 Windows `NoStart` 全新安装烟测。
- 正式 APK、Release ZIP 及其 SHA-256 必须在标签工作流和公开下载后再次校验；Android 包名、版本号和固定签名证书也必须复核。

标签发布前，本版仍属于候选版本。只有主分支 CI、Release 工作流、公开 ZIP/APK、SHA-256、固定 Android 签名和公网 Windows 全新安装全部通过后，才视为正式稳定版本。
