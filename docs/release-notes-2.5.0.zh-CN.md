# CX-Codex 2.5.0：一条命令安装并安全连接手机

这一版把此前需要人工拼接的 Windows 安装、免费临时公网访问、健康验证和卸载流程收敛为可审计的一键链路，同时保留本机回环监听、访问密码和 Release 校验边界。

## 本次版本重点

- **一条命令完成安装与手机访问**：`-RemoteQuick` 自动安装或更新 CX-Codex、启动 7420、下载官方 cloudflared，并返回临时 HTTPS 地址；不要求服务器、域名或 Cloudflare 账号。
- **默认仍只监听本机**：快速模式固定使用 `127.0.0.1:7420`，不开放 Windows 防火墙，不创建自启动或看门狗任务。公网入口必须通过访问密码登录。
- **安装来源可验证**：默认下载最新正式 CX-Codex Release 和配套 SHA-256；cloudflared 同样使用官方 Release 校验值。更新采用临时目录切换，失败时保留或恢复上一版本。
- **适合提示词和自动化调用**：`-JsonOutput` 的 stdout 只输出一行版本化 JSON，进度和诊断进入 stderr；成功结果明确区分安装、启动和健康状态，失败结果提供固定错误码和阶段，不输出密码、Cookie 或 Token。
- **提供官方卸载器**：默认删除托管程序、进程、启动器、计划任务和对应防火墙规则，但保留 CX-Codex 数据、Codex 登录态、工作区和 Android 签名；需要时可显式执行完整清理。
- **真实 Windows 产品化门禁**：CI 覆盖安装、启动、`/health` 返回 200、官方卸载和端口关闭，并验证默认保留数据、完整清理、能力不匹配与失败 JSON。
- **安装和启动更加稳健**：自动处理 Node.js/npm 错配、PowerShell profile 干扰、全局 npm prefix 污染、启动日志占用和同目录多端口实例误停等真实 Windows 问题。
- **手机访问可在设置中管理**：Web 设置页可以生成、复制、打开、刷新和停止临时地址；只有公网健康、未登录 API 401 和未登录 WebSocket 拒绝三项验证全部通过才报告可用。

## 快速安装

在普通 PowerShell 中执行：

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/bootstrap-windows.ps1'))) -RemoteQuick -JsonOutput
```

安装完成后：

1. 电脑本机打开 `http://127.0.0.1:7420/local-setup` 查看访问密码。
2. 手机打开 JSON 中的 `publicUrl`，输入该密码。
3. 临时地址会在进程停止或重新连接后变化，不适合作为长期固定域名。

## 卸载

保留用户数据的默认卸载：

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/uninstall-windows.ps1')))
```

同时删除 CX-Codex 运行数据和项目托管的 cloudflared：

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/uninstall-windows.ps1'))) -RemoveUserData -RemoveCloudflared
```

## 能力边界

- Cloudflare Quick Tunnel 免费、免注册且无需自有服务器，但地址临时、没有 SLA，也不支持 SSE；CX-Codex 会使用 WebSocket/轮询恢复链路。
- 访问密码不会出现在公网 URL、JSON stdout 或 Release 日志中，只能从本机回环地址的 `/local-setup` 查看。
- `-UseBranchArchive` 只用于显式测试 `main` 预览源码；它没有正式 Release 的 SHA-256 保证，不应作为普通用户默认安装方式。
- 长期固定域名、访问策略和更高可用性仍建议使用命名 Cloudflare Tunnel、Tailscale、Nginx/Caddy 或其他自托管网络方案。

## 发布验证

- Windows 产品化回归通过：稳定 JSON、能力清单、安装、真实启动、健康检查、卸载和端口关闭。
- 前端、CLI、服务模块、治理门禁、Release zip、npm pack 与 SHA-256 制品检查通过。
- Release 工作流会强制校验标签版本、`package.json` 和本文件一致，并构建 Web/CLI 压缩包与 Android APK。
- App Server schema 仍按候选审查边界发布；没有真实 Firebase 项目和设备验证时，不宣称官方 APK 已具备深度 Doze 实时唤醒。
