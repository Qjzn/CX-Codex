# CX-Codex 2.8.0：安全默认值、消息收敛与可复现交付

2.8.0 是当前本地候选版本，用于承载 v2.7.6 之后已经完成 H5 与 Windows 本地验证、但尚未提交或发布的安全和稳定性改动。公开稳定版仍是 v2.7.6；只有主分支 CI、Release 工作流、公开资产和外部设备门槛全部通过后，本候选才可成为正式版本。

## 安全与边界

- 新安装默认使用 `on-request + workspace-write`，高权限模式只能显式选择。
- 非回环监听不能使用无密码模式；本地文件读取、浏览和编辑限制在登记的工作区根目录内。
- 诊断响应统一脱敏密码、Cookie、Token、API Key 与常见敏感错误片段。
- 私有 Skills Git 同步不再把凭据写入命令参数、远程 URL 或 `.git/config`；Windows 状态使用 DPAPI `CurrentUser` 加密。
- 依赖安全门禁从低等级漏洞开始失败，本地 PDF 预览继续使用受 CSP 限制的 legacy Canvas 管线。

## 消息与恢复

- 多页面 outbox 使用逐消息日志和删除墓碑合并，避免页面之间覆盖待发送消息或复活已删除记录。
- App Server 超时、退出或重启后的发送和中断进入权威对账，不把可能已经执行的动作误报为确定失败。
- 7420 重启后只恢复尚未开始且正文哈希一致的已接受请求；已经开始或结果不确定的请求不会自动重发。
- 旧轮次终态不再清除当前轮次、消息队列或 outbox。

## 性能与体验

- 已有和新会话发送反馈保持在 100 ms 预算内；缓存首屏目标为 300 ms，前台恢复 P95 目标为 2 秒。
- 1600 条消息场景最多挂载 20 个消息节点并限制主线程心跳延迟；当前验证为约 13 个节点、最高 64 ms。
- 归档列表有旧缓存时立即返回，后台权威扫描不再阻塞后续读者。
- H5 回归覆盖桌面、手机、横屏和折叠屏，并把模型选择器逐项对照实时 `model/list`。

## 安装、升级与回滚

Windows 候选继续沿用现有安装契约；正式发布后可使用 README 中的一条命令安装，自动化调用保留稳定 `-JsonOutput` 单行 JSON：

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/bootstrap-windows.ps1'))) -RemoteQuick -JsonOutput
```

卸载入口保持为 `scripts/uninstall-windows.ps1`，默认保留配置和认证。Release ZIP、Windows 包和 Android 资产在正式发布时都必须带可复核 SHA-256；安装失败必须恢复上一份健康安装。

## 候选边界

- Android 真机进程回收、锁屏、Doze、网络切换和通知去重仍未完成。
- 真实 Windows 高对比度、屏幕阅读器和当前候选公网链路仍需独立证据。
- GitHub 主分支保护、Dependabot 安全更新、私密漏洞报告和历史密钥告警处置属于外部管理员门槛。
- 本文不是发布声明；未创建 v2.8.0 标签、Release、APK 或远端部署。

`RemoteQuick`、`JsonOutput`、SHA-256、`uninstall-windows.ps1` 和失败回滚必须在正式发布前继续通过完整门禁。候选状态不能仅凭本机构建或浏览器回归自动升级为稳定版。
