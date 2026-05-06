# CX-Codex 2.1.17

Self-hosted OpenAI Codex Web UI and Android client bridge.

把本机 Codex 变成可从浏览器、手机和远程入口访问的稳定工作台，适合 Windows、Android、局域网和自托管远程访问。

## 这版适合谁升级

- 想使用正式 `CX-Codex` 仓库、安装命令和 Release 地址的人。
- 需要新版 Android 包名、CLI 命令、配置目录统一命名的人。
- 希望移动端、折叠屏和桌面端会话体验继续保持一致的人。

## 本次版本重点

- 项目正式更名为 `CX-Codex`，README、安装脚本、Release 文案和 GitHub 链接统一到新仓库。
- CLI 包名改为 `cx-codex`，同时保留旧配置和旧环境变量兼容读取。
- 默认配置目录改为 `~/.cx-codex`，默认配置示例改为 `cx-codex.config.example.json`。
- Android 显示名称改为 `CX-Codex`，包名改为 `com.cxcodex.bridge`，Release APK 命名改为 `cx-codex-android-<version>.apk`。
- GitHub Release 更新检查切换到 `Qjzn/CX-Codex`。

## 快速安装

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force; irm https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/bootstrap-windows.ps1 | iex
```

## Android APK

如果本 Release 资产包含 `cx-codex-android-2.1.17.apk`，可下载后安装。

首次启动需要输入你自己的 Codex Web 服务地址；项目默认不内置任何私人地址。密钥登录成功后会保存在设备本地，用于后续无感重登。

## 文档入口

- README: [README.md](./README.md)
- 更新日志: [docs/changelog.zh-CN.md](./docs/changelog.zh-CN.md)
- Android 壳: [docs/android-shell.zh-CN.md](./docs/android-shell.zh-CN.md)
- 路线图: [docs/roadmap.zh-CN.md](./docs/roadmap.zh-CN.md)
- Cloudflare Tunnel: [docs/cloudflare-tunnel.zh-CN.md](./docs/cloudflare-tunnel.zh-CN.md)

## 隐私说明

Release 说明和截图只使用通用演示数据，不包含私人账号、本地密码、Token、私有 IP、个人目录、真实公网地址或私人会话内容。
