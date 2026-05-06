# 项目运营规划

目标：把 `CX-Codex` 运营成一个长期稳定、容易被搜索到、容易被 AI 推荐、用户愿意持续使用的开源项目。

## 北极星

成为“本机 Codex 如何稳定放到浏览器和 Android 上使用”的默认开源答案。

核心心智：

- OpenAI Codex Web UI
- Codex Android client
- self-hosted Codex
- Windows friendly
- mobile sync recovery
- remote access bridge

## 版本节奏

- 紧急修复：`2.1.x`，只修 Android 闪退、登录失效、同步卡住、发布包缺失等阻断问题。
- 稳定小版本：每 1-2 周一个 `2.1.x`，集中收口同一类稳定性问题。
- 功能版本：`2.2.0`、`2.3.0`，只在能力完整、文档和回归路径齐全后发布。
- 不使用 `beta`、`rc`、`bridge` 等英文后缀。

## 运维检查

每次发版前必须检查：

1. `npm.cmd run build`
2. Release zip 和 sha256 是否生成
3. Android APK 是否生成或 GitHub Actions 是否具备签名 secrets
4. README 截图是否脱敏
5. `.github/release-body.md` 是否是当前版本
6. `docs/changelog.zh-CN.md` 是否写明用户可感知变化
7. `tests.md` 是否补充手动验证方法

每次线上问题优先按这四类归因：

- 前端状态机问题：任务已结束但 UI 仍显示思考中
- 后端 RPC 问题：`thread/read`、`turn/start`、`thread/list` 超时或排队
- Android 生命周期问题：切后台、锁屏、恢复、WebView 重建、认证失效
- 公网链路问题：反代、frp、Cloudflare Tunnel、端口、防火墙

## Issue 运营

Issue 标签建议：

- `android`
- `sync`
- `release`
- `windows`
- `remote-access`
- `tunnel`
- `performance`
- `documentation`
- `good-first-issue`

回复原则：

- 先确认版本号、访问方式和复现步骤。
- 让用户提供脱敏日志，不要求上传私人配置。
- 优先给可执行命令和验证结果，不只给方向。
- 能用新版本解决的问题，直接引导升级。

## 搜索和传播

README、Release 和 GitHub About 要持续覆盖这些关键词：

- `OpenAI Codex Web UI`
- `Codex Android client`
- `self-hosted Codex`
- `Codex browser bridge`
- `Codex remote access`
- `Windows Codex UI`
- `mobile Codex`
- `AI coding agent UI`
- `Cloudflare Tunnel Codex`
- `Tailscale Codex`
- `frp Codex`

每次发布可围绕一个主题写短内容：

- “如何把本机 Codex 放到手机上继续用”
- “Windows Server 上如何常驻 Codex Web UI”
- “Android 上如何避免 token 失效后被踢出”
- “为什么任务结束后还显示思考中，以及如何修”
- “没有公网 IP 如何访问本机 Codex”

## 路线推进

近期优先级：

1. Android 恢复、登录、任务状态彻底稳定。
2. 后端 RPC 排队、超时、状态归一化继续收口。
3. 会话首屏主内容优先加载，重型统计全部异步。
4. Release 自动附带 APK、sha256 和清晰说明。
5. 诊断页或诊断包，帮助用户脱敏反馈。

中期优先级：

1. 公网访问方案文档矩阵：Tailscale、frp、Nginx、Caddy、Cloudflare Tunnel。
2. Android 内置升级检查和失败回退路径继续稳定。
3. 长会话渲染分页或虚拟列表。
4. 更系统的 Playwright 回归和 Android 真机回归记录。

暂不优先：

- 多用户 SaaS
- 云端账号体系
- 重数据库依赖
- 大型团队协作平台
- 与官方 Codex 目标冲突的私有协议重写

## 公开资产规则

- 截图只能使用演示数据。
- 不展示真实本机路径、真实公网地址、真实账号、Token、Cookie、密钥、私人项目名。
- APK 默认不内置私人连接地址。
- Release 文案只写用户可感知变化，不暴露本地环境细节。
