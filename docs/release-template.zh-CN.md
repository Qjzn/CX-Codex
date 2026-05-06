# Release 文案模板

这份模板用于每次发 GitHub Release 时快速整理“用户真正关心的变化”，避免说明写成内部提交记录。

## 标题模板

版本号使用纯数字语义版本，不使用英文后缀：

- `2.1.x：Android 启动和同步稳定性修复`
- `2.1.x：移动端恢复更稳，默认配置更安全`
- `2.1.x：线程切换更快，发布包更完整`
- `2.2.0：Codex Web 与 Android 工作台稳定版`

## 正文模板

~~~md
# CX-Codex

Self-hosted OpenAI Codex Web UI and Android client bridge.

把本机 Codex 变成可从浏览器、手机和远程入口访问的稳定工作台，适合 Windows、Android、局域网和自托管远程访问。

## 这版适合谁升级

- 想把本机 Codex 放到手机上继续用的人
- 想在 Windows / Windows Server 上稳定跑一个浏览器入口的人
- Android 端遇到启动、重登、同步或“思考中”状态卡滞的人

## 本次版本重点

- 写用户能感知到的结果
- 说明具体改善了哪个痛点
- 说明升级后最明显的变化

## 快速安装

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force; irm https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/bootstrap-windows.ps1 | iex
```

## Android APK

如果 Release 资产包含 `cx-codex-android-<version>.apk`，可下载后安装。

首次启动需要输入自己的 Codex Web 服务地址；项目默认不内置私人地址。

## 相关文档

- README: [README.md](./README.md)
- 更新日志: [docs/changelog.zh-CN.md](./docs/changelog.zh-CN.md)
- 路线图: [docs/roadmap.zh-CN.md](./docs/roadmap.zh-CN.md)
- Android 壳: [docs/android-shell.zh-CN.md](./docs/android-shell.zh-CN.md)
- Cloudflare Tunnel: [docs/cloudflare-tunnel.zh-CN.md](./docs/cloudflare-tunnel.zh-CN.md)
~~~

## 推荐写法

- “Android 首次启动不再内置私人地址，用户输入后本机持久保存。”
- “密钥保存后可用于无感重登，减少 token 失效导致的同步中断。”
- “任务结束后会清理已完成思考态，降低‘已完成但仍思考中’的误导。”
- “长会话默认只加载最新内容，上滑再自动补历史，主内容优先出现。”

## 不推荐写法

避免只写：

- “重构了若干模块”
- “优化了一些细节”
- “修复了部分问题”
- “更新了若干逻辑”
