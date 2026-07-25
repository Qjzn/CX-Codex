# CX-Codex 2.5.5：临时公网地址自动恢复一次

正式 2.5.4 回归中，Windows 安装、构建、本机健康和进程替换都已成功，但 Cloudflare 新生成的临时地址在首次公网验证时完全不可达，一键命令因此安全地返回失败。随后手动再次开启，约 20 秒即通过公网健康、HTTP 鉴权和 WebSocket 鉴权。2.5.5 将这次可恢复动作收进程序。

## 本版变化

- CLI 启动和设置页开启手机访问时，共用一次受限自动重试。
- 首次通道若在公网验证阶段返回 `HTTP unreachable`，程序会关闭该通道、等待 1.5 秒并重新申请一个临时地址。
- 最多只自动重试一次，第二次仍失败时返回原有稳定错误和诊断。
- 只有完全不可达才允许重试；HTTP 200、403 等错误鉴权状态不会重试，也不会开放公网入口。

## 安装或升级

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/bootstrap-windows.ps1'))) -RemoteQuick -JsonOutput
```

命令默认选择最新正式 Release、校验 SHA-256，并保留用户配置与 Codex 登录态。成功结果继续通过 `JsonOutput` 返回一行稳定 JSON。

## 卸载

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/uninstall-windows.ps1'))) -JsonOutput
```

默认卸载保留用户数据、Codex 登录态、工作区、Android 签名和已校验的 cloudflared 缓存。

## 验证

- CLI 构建与服务模块烟测通过。
- 自动化验证首次 `PUBLIC_AUTH_VERIFY_FAILED + HTTP unreachable` 后只重试一次，并在第二次成功后返回 ready。
- 自动化验证 `PUBLIC_AUTH_VERIFY_FAILED + HTTP 200` 不重试，仍返回失败。
- 真实 Quick Tunnel 通过公网健康、未登录 HTTP 401、未登录 WebSocket 拒绝和停止清理。

## 正式发布结果

GitHub Release 工作流、公开资产校验和正式归档安装回归均已完成，2.5.5 已正式发布。Quick Tunnel 是 Cloudflare 提供的临时免费入口，地址会变化且没有 SLA；自动重试只减少瞬时传播抖动，不能替代固定 Tunnel 或 Tailscale。
