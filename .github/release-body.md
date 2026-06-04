# CX-Codex 2.2.4

Self-hosted OpenAI Codex Web UI and Android client bridge.

把本机 Codex 变成可从浏览器、手机和远程入口访问的稳定工作台，适合 Windows、Android、局域网和自托管远程访问。

## 这版适合谁升级

- 希望在 Web / Android 中获得更接近桌面端 Codex 输入区体验的人。
- 需要工作台、项目默认配置、常用任务模板和运行诊断入口的人。
- Android 端使用 PDF、Word、Markdown 等本地文件预览和下载时遇到不清晰、无反馈或下载失败的人。
- 需要通过插件偏好、计划模式和目标追求来减少重复操作的人。

## 本次版本重点

- 新增工作台：集中展示当前工作区、运行状态、项目默认配置、常用任务模板和快捷入口。
- 输入区对齐桌面端：加号菜单支持计划模式、追求目标、插件偏好、技能选择、文件 / 文件夹 / 拍照入口。
- 运行配置集中化：模型、质量和速度合并到一个按钮，快速模式才显示闪电标识。
- 插件偏好真实下发：可读取插件能力并随任务请求传给后端，不只是 UI 展示。
- PDF 预览优化：提升移动端渲染清晰度，放大后支持横向滚动查看。
- Android 文件操作更可靠：原生打开 / 下载增加 operationId 和完成 / 失败事件回传，减少“下载中无反应”。
- 移动端交互修复：修复配置菜单遮罩残留后阻挡加号菜单点击的问题。
- 运行诊断增强：继续展示 app-server、Runtime Store、慢 RPC 和不确定请求，便于定位现场问题。

## 快速安装

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force; irm https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/bootstrap-windows.ps1 | iex
```

## Android APK

如果本 Release 资产包含 `cx-codex-android-2.2.4.apk`，这是正式签名 APK。

如果只包含 `cx-codex-android-debug-2.2.4.apk`，说明仓库尚未配置 Android 签名 secret；该包适合自托管测试和临时安装，后续正式签名 APK 可能需要先卸载 debug 包再安装。

首次启动需要输入你自己的 Codex Web 服务地址；项目默认不内置任何私人地址。密钥登录成功后会保存在设备本地，用于后续无感重登。

## 文档入口

- README: [README.md](./README.md)
- 更新日志: [docs/changelog.zh-CN.md](./docs/changelog.zh-CN.md)
- Android 壳: [docs/android-shell.zh-CN.md](./docs/android-shell.zh-CN.md)
- 路线图: [docs/roadmap.zh-CN.md](./docs/roadmap.zh-CN.md)
- Cloudflare Tunnel: [docs/cloudflare-tunnel.zh-CN.md](./docs/cloudflare-tunnel.zh-CN.md)

## 隐私说明

Release 说明和截图只使用通用演示数据，不包含私人账号、本地密码、Token、私有 IP、个人目录、真实公网地址或私人会话内容。
