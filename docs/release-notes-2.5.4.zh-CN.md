# CX-Codex 2.5.4：卸载完整关闭受管进程树

2.5.3 已完成正式 Release 的运行中升级、重复升级、卸载和重装回归。回归中程序与端口虽然最终清理成功，但旧卸载器逐个停止并等待父进程，可能先报一次 10 秒退出超时，再由后续清理确认进程已经消失。2.5.4 将卸载策略与已验证的升级策略统一，减少普通用户看到无效警告。

## 本版变化

- 从已验证的 CX-Codex 根服务和 Quick Tunnel 出发收集全部子进程。
- 按子进程优先顺序停止 `codex.exe`、cloudflared、控制台宿主和 Node 根服务。
- 对整棵选中进程树统一等待，只有超时后仍真实存在的 PID 才返回 `PROCESS_STOP_TIMEOUT`。
- 新增真实子进程卸载回归，要求根进程、子进程、7420 类监听端口和安装目录全部清理。

## 安装或升级

首次安装、升级和修复仍使用同一条命令：

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/bootstrap-windows.ps1'))) -RemoteQuick -JsonOutput
```

命令默认选择最新正式 Release、校验 SHA-256，并保留现有配置与 Codex 登录态。

## 卸载

默认卸载保留用户数据、Codex 登录态、工作区、Android 签名和已校验的 cloudflared 缓存：

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/uninstall-windows.ps1'))) -JsonOutput
```

只有明确需要彻底清理时，才增加 `-RemoveUserData -RemoveCloudflared`。

## 验证

- PowerShell 语法检查通过。
- Windows 产品化回归通过稳定 JSON、默认保留卸载、完整清理、真实启动健康检查和失败 JSON。
- 新增的受管进程树夹具通过：根进程及子进程全部退出，端口和安装目录清理完成，结果没有停止超时警告。
- 在真实 2.5.3 五进程运行树上执行新版卸载器，五个进程均按子进程优先顺序停止，配置与 Codex 登录态保留，7420 端口关闭，`warnings` 为空。

## 候选边界

在 GitHub Release 工作流、正式资产校验和公开归档卸载回归完成前，2.5.4 仍是候选版本。卸载器只处理通过安装路径、配置、PID 标记和监听端口验证的受管进程；不会扫描或删除用户工作区、Codex 登录材料和 Android 签名文件。
