# CX-Codex 2.2.8

Self-hosted OpenAI Codex Web UI and Android client bridge.

这版重点修复 Codex Desktop 与 7420 浏览器侧栏的会话列表差异，并把发布前回归门禁补强到真实浏览器页面。

## 适合谁升级

- 发现 Codex Desktop 左侧有会话，但 7420 浏览器或手机端侧栏找不到同一会话的人。
- 经常在多个项目目录之间切换，希望 7420 项目线程列表更接近 Desktop 的人。
- 准备把 CX-Codex 作为长期自托管入口使用，需要更稳定回归门禁的人。

## 本次版本重点

- 修复 Desktop/session-index 中存在、但 App Server `thread/list` 首屏遗漏的近期线程不会进入 7420 侧栏的问题。
- 侧栏补充逻辑改为有界策略，避免缓存热起来后首屏线程数量持续膨胀。
- 数据回归新增目标线程检查，可验证 `分析项目` 这类真实 Desktop 会话已经进入 7420 active 列表。
- 浏览器回归新增桌面侧栏和手机抽屉 DOM 检查，确认同一目标线程在真实页面可见。

## 快速安装

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force; irm https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/bootstrap-windows.ps1 | iex
```

## 升级后建议验证

```powershell
npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目
npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目
```

## 仍需注意

- CX-Codex 仍是本机 Codex App Server 的 Web/Android bridge，不是独立云端 Codex 服务。
- App Server 协议兼容仍按仓库中的 schema drift 记录持续维护，不应宣传为完整覆盖所有实验能力。
- 公网访问必须配置密码、VPN、Tunnel、反向代理鉴权或其他受控边界。
