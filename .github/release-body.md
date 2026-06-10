# CX-Codex 2.2.7

Self-hosted OpenAI Codex Web UI and Android client bridge.

把本机 Codex 变成可从浏览器、手机和远程入口访问的稳定工作台，适合 Windows、Android、局域网和自托管远程访问。

## 这版适合谁升级

- Android 端使用本地文件打开、下载或 APK 站内更新时遇到登录态、权限或安装流程问题的人。
- 长任务、移动端回到前台、会话刷新后偶发状态不同步的人。
- 需要更清晰的任务队列、会话状态和消息区交互反馈的人。
- 希望设置页版本信息更聚焦，避免重复展示当前版本的人。

## 本次版本重点

- Android 文件与更新体验：本地文件打开 / 下载增加登录态续期，减少受保护文件被下载成登录页或 HTML 的情况。
- APK 站内更新更顺滑：缺少“安装未知应用”权限时先保存待安装包，引导授权后继续安装。
- 任务同步继续加固：优化会话刷新、任务状态和队列同步，降低移动端回到前台后的状态不一致。
- 消息区与输入区交互优化：减少长任务和移动端场景下的误触、状态残留和刷新不及时。
- 设置页版本展示优化：当前版本只在版本卡展示，更新区域改为状态表达，避免同一版本号重复出现。
- 本地发布验证补强：重启脚本校验启动版本，前端回归脚本增加 agent-browser 超时保护，避免旧进程或卡住的浏览器检查影响发布判断。

## 快速安装

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force; irm https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/bootstrap-windows.ps1 | iex
```

## Android APK

如果本 Release 资产包含 `cx-codex-android-v2.2.7.apk`，这是正式签名 APK。

如果只包含 `cx-codex-android-debug-v2.2.7.apk`，说明仓库尚未配置 Android 签名 secret；该包适合自托管测试和临时安装，后续正式签名 APK 可能需要先卸载 debug 包再安装。

首次启动需要输入你自己的 Codex Web 服务地址；项目默认不内置任何私人地址。密钥登录成功后会保存在设备本地，用于后续无感重登。

## 文档入口

- README: [README.md](./README.md)
- 更新日志: [docs/changelog.zh-CN.md](./docs/changelog.zh-CN.md)
- Android 壳: [docs/android-shell.zh-CN.md](./docs/android-shell.zh-CN.md)
- 路线图: [docs/roadmap.zh-CN.md](./docs/roadmap.zh-CN.md)
- Cloudflare Tunnel: [docs/cloudflare-tunnel.zh-CN.md](./docs/cloudflare-tunnel.zh-CN.md)

## 隐私说明

Release 说明和截图只使用通用演示数据，不包含私人账号、本地密码、Token、私有 IP、个人目录、真实公网地址或私人会话内容。
