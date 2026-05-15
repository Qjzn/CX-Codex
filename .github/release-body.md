# CX-Codex 2.2.1

Self-hosted OpenAI Codex Web UI and Android client bridge.

把本机 Codex 变成可从浏览器、手机和远程入口访问的稳定工作台，适合 Windows、Android、局域网和自托管远程访问。

## 这版适合谁升级

- Android 端遇到锁屏、切后台、弱网恢复后“思考中”卡住或停止无效的人。
- 需要前端关闭后重新进入仍能恢复任务状态的人。
- 想让发送、停止、刷新更接近原生 Codex 客户端稳定性的自托管用户。
- 需要更紧凑的移动端输入框配置入口的人。

## 本次版本重点

- 持久运行态：新增 SQLite WAL runtime store，持久保存发送请求、运行事件和线程快照，页面关闭或 Android 后台恢复后可 replay 并收敛状态。
- 发送与停止更可靠：前端发送和停止改走 runtime API；停止进入确认流程，超时不会乐观清空，也不会无限保留旧“思考中”卡片。
- 刷新可恢复：顶部刷新改为强制 reconcile，会核验 app-server、拉取 runtime snapshot 和最新消息，状态已完成时清理旧 live overlay 和停止按钮。
- Android 恢复链路收口：回前台、解锁、网络恢复后按固定顺序重连事件流、回放 missed events、读取本地快照、必要时强制 reconcile。
- 后台优先级优化：发送、停止、权限响应和当前线程恢复走交互优先级；会话列表、搜索、技能市场等外围请求降级缓存，减少阻塞。
- 输入框配置优化：对话框内移除单独设置按钮，改为一个与桌面端一致的运行配置按钮，集中修改模型、质量和速度；只有快速模式才显示闪电标识。
- 日志与安全：runtime 日志、慢 RPC、恢复动作保留结构化观测，同时继续过滤密码、token、Authorization 和敏感 URL query。

## 快速安装

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force; irm https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/bootstrap-windows.ps1 | iex
```

## Android APK

如果本 Release 资产包含 `cx-codex-android-2.2.1.apk`，可下载后安装。

首次启动需要输入你自己的 Codex Web 服务地址；项目默认不内置任何私人地址。密钥登录成功后会保存在设备本地，用于后续无感重登。

## 文档入口

- README: [README.md](./README.md)
- 更新日志: [docs/changelog.zh-CN.md](./docs/changelog.zh-CN.md)
- Android 壳: [docs/android-shell.zh-CN.md](./docs/android-shell.zh-CN.md)
- 路线图: [docs/roadmap.zh-CN.md](./docs/roadmap.zh-CN.md)
- Cloudflare Tunnel: [docs/cloudflare-tunnel.zh-CN.md](./docs/cloudflare-tunnel.zh-CN.md)

## 隐私说明

Release 说明和截图只使用通用演示数据，不包含私人账号、本地密码、Token、私有 IP、个人目录、真实公网地址或私人会话内容。
