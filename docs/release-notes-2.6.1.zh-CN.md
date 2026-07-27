# CX-Codex 2.6.1：Windows 一键安装更可靠

2.6.1 聚焦新人首次安装时最容易卡住的两个环节：Windows PowerShell 的 SHA-256 校验能力差异，以及 cloudflared 大文件下载被网络瞬时中断。安装命令、密码保护和校验边界保持不变。

## 本版修复

- 当 `Get-FileHash` 在外层 bootstrap 或内层 Windows 安装器中不可用时，自动改用 .NET SHA-256 计算，不再因精简或异常 PowerShell 环境中缺少该命令而中断安装。
- Node.js、CX-Codex Release 和 cloudflared 仍必须匹配官方 SHA-256；降级路径不会跳过或弱化完整性校验。
- cloudflared 下载遇到 EOF 或瞬时网络错误时最多自动重试三次，并明确显示下一次重试序号和等待时间。
- 每次重试前及最终失败后都会删除未完成的 `.download-*` 半包，避免用户目录残留几十 MB 的无效文件。

## 一步安装或升级

在普通 Windows PowerShell 中执行：

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/bootstrap-windows.ps1'))) -RemoteQuick -JsonOutput
```

首次安装通常需要 2–5 分钟。依赖构建和大文件下载期间会每 15 秒显示一次安装心跳；请保持窗口打开。安装成功后会自动打开仅限本机的 CX-Codex 管理中心。

## 安全边界

- 安装结果、日志、二维码和公网 URL 不包含访问密码、Cookie 或 Codex Token。
- 公网 Codex API 与 WebSocket 必须通过访问密码登录。
- 本机管理中心通过公网域名请求仍返回 404。
- 官方卸载默认保留 Codex 登录态、工作区和 Android 正式签名；显式彻底清理只删除 CX-Codex 自己管理的运行数据。

官方卸载入口：

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/uninstall-windows.ps1'))) -JsonOutput
```

## 验证

- 从完全卸载状态复现并修复缺少 `Get-FileHash` 的安装失败。
- 在禁用 `Get-FileHash` 的独立 PowerShell 环境中确认 .NET SHA-256 结果一致。
- 从完全卸载状态复现 cloudflared 下载 EOF，并确认失败半包被清理。
- 修复候选完成 189.1 秒全新安装，公网健康、HTTP 鉴权和 WebSocket 鉴权全部进入 `ready`。
- 公网真实消息发送返回 202，11.37 秒内完成；线程回读和手机宽度前端均看到回复。
- Windows 产品化、服务模块、前端规范化和 7420 多尺寸回归通过。

Quick Tunnel 免费且无需账号或域名，但临时地址会在服务或隧道重启后变化，也没有固定域名和 SLA。请始终以本机管理中心显示的当前地址为准。

只有 GitHub Release 工作流、公开 ZIP/SHA-256、固定签名 APK 和公开一键重装全部验证通过后，本版才视为正式可交付版本。
