# GitHub 包装文案包

这份文案包用于统一 README、GitHub About、Release、Topics 和社交传播表达。

## 核心定位

推荐统一使用：

把本机 Codex 变成可从浏览器、手机和远程入口访问的稳定工作台，重点面向 Windows、Android 和自托管远程访问。

英文版：

Self-hosted OpenAI Codex Web UI and Android client bridge for Windows, mobile, LAN, and remote access.

## GitHub About

中文短版：

本机 Codex 的浏览器和 Android 工作台，适合 Windows、手机访问和自托管远程入口。

英文短版：

Self-hosted OpenAI Codex Web UI and Android bridge for Windows, mobile, and remote access.

更强调远程访问：

Run Codex locally, use it from your phone or browser, and expose it through your own LAN, VPN, tunnel, or reverse proxy.

## 仓库 Topics

建议至少配置：

- `codex`
- `openai-codex`
- `codex-web`
- `codex-ui`
- `codex-android`
- `browser-ui`
- `remote-access`
- `self-hosted`
- `windows`
- `windows-server`
- `android`
- `mobile-browser`
- `cloudflare-tunnel`
- `tailscale`
- `frp`
- `lan`
- `remote-development`
- `ai-coding-agent`

## README 首屏结构

长期保持这个顺序：

1. 一句话定位
2. 当前组件渲染的脱敏演示截图
3. 核心卖点
4. 快速安装
5. Android 客户端
6. 远程访问
7. 文档入口

不要把首屏做成内部维护日志，也不要放带真实路径、真实会话或私人公网地址的截图。

## 当前截图资产

- [chat.png](./screenshots/chat.png): 桌面工作台
- [chat-mobile.png](./screenshots/chat-mobile.png): 手机会话
- [android-setup.png](./screenshots/android-setup.png): Android 首次连接
- [github-trending.png](./screenshots/github-trending.png): GitHub 热门项目模块
- [mobile-composer-plus.png](./screenshots/mobile-composer-plus.png): 手机端附件、一次性计划、任务要求与插件入口
- [mobile-model-settings.png](./screenshots/mobile-model-settings.png): 手机端模型、推理档位与速度设置
- [promo-foldable-github-trending.jpg](./screenshots/promo-foldable-github-trending.jpg): 折叠屏双栏与 GitHub 热门
- [promo-android-chat.jpg](./screenshots/promo-android-chat.jpg): 手机端会话的 JPEG 传播版本

公开截图统一从 `/#/__regression/docs-showcase` 生成。该路由复用真实前端组件，但工作区、会话、路径、地址、密钥和热门数据均为演示值；禁止直接截取真实会话、个人路径、账号、密钥、内网或公网地址。

## 发布分支约定

- GitHub Release 对应的 tag 必须指向 `main` 已包含的提交；发布后，`main` 应立即反映该版本源码，避免 Release 比默认分支更新。
- 提交 Release 前先更新 README、更新日志、版本说明和脱敏截图，再运行发布验证。
- Issue 回复优先给出版本、文档链接、验证方式和已知边界；不要用“已优化”替代可复现的说明。

截图必须使用演示数据。

## Release 标题模板

推荐格式：

- `2.1.x: Android startup and sync stability`
- `2.1.x: smoother mobile recovery and safer defaults`
- `2.1.x: faster thread switching and better release packaging`
- `2.2.0: stable Codex Web and Android bridge`

中文发布说明顺序：

1. 这版用户真正能感知到什么变化
2. 哪类用户最应该升级
3. 怎么安装或升级
4. 如果失败看哪里

模板：

- [release-template.zh-CN.md](./release-template.zh-CN.md)

## 对外介绍模板

中文：

`CX-Codex` 是一个把本机 OpenAI Codex 暴露到浏览器和 Android 手机上的自托管工作台。它重点解决 Windows / Windows Server 部署麻烦、移动端同步不稳、远程访问门槛高这几个问题。项目不试图替代官方 Codex，而是把“本地 Codex 如何稳定出现在浏览器和手机里”这条链路做稳。

English:

`CX-Codex` is a self-hosted OpenAI Codex Web UI and Android client bridge. It focuses on Windows-friendly deployment, phone access, mobile sync recovery, and remote self-hosted access for local Codex.

## 推广切入点

优先讲这些问题：

1. 如何把本机 Codex 放到手机上继续用
2. Windows / Windows Server 怎么稳定跑一个 Codex Web 入口
3. Codex Web UI 如何做自托管远程访问
4. Android 上如何保持连接地址、密钥和会话状态
5. 为什么轻量 browser bridge 比重型 SaaS 更适合个人和小团队

## 不推荐表达

避免：

- “又一个 Codex 客户端”
- “最强 AI 平台”
- “支持很多很多功能”
- “完全替代官方 Codex”

更稳的表达始终围绕：

- Local Codex
- Codex Web UI
- Android client
- Self-hosted remote access
- Windows friendly
- Stable mobile sync
