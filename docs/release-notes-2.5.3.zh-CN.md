# CX-Codex 2.5.3：完整关闭 Windows 原地升级目录锁

2.5.2 已能识别并停止受管父服务与 Quick Tunnel，但正式 Release 回归发现：父 Node 退出后，它启动的 `codex.exe` App Server 子进程仍可能短暂存活并占用安装目录。2.5.3 将停止边界扩展为“已验证的受管根进程树”，同时补上目录移动重试与失败后旧服务恢复。

## 修复内容

- 结合安装路径、配置、启动器、PID 标记和监听端口确认受管根服务。
- 从受管根 PID 递归收集子进程，并按子进程优先顺序停止 Node、Codex App Server、Quick Tunnel 及其宿主进程。
- 原子目录移动最多重试 20 次、每次间隔 250 毫秒，覆盖 Windows 进程退出后的短暂句柄释放延迟。
- 仍有非受管进程占用目录时不误杀、不强行覆盖，返回稳定失败 JSON，并自动重启保留的旧服务、等待本机健康。
- Windows CI 使用“旧安装目录中的 Node 服务 + 子进程 + PID 标记 + 监听端口”执行真实原地升级。
- App Server schema 漂移继续沿用已审查的候选发布边界，本补丁不扩大协议能力声明。

## 推荐操作

首次安装、升级和修复仍使用同一条命令：

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/bootstrap-windows.ps1'))) -RemoteQuick -JsonOutput
```

命令会选择最新正式 Release 并校验 SHA-256。`RemoteQuick` 默认保留密码保护，`JsonOutput` 的 stdout 仍只有一行版本化结果；访问密码不会写入 JSON 或公网 URL。

## 验证要求

- 保持旧服务与 Codex App Server 运行，再执行同一条命令，确认进程树退出、目录替换成功、`.previous` 回滚目录保留。
- 确认升级后 7420 健康，公网健康、HTTP 鉴权和 WebSocket 鉴权全部通过。
- 用独立非受管进程锁住安装目录，确认 bootstrap 不结束它，并在失败后自动恢复旧服务。
- 使用官方 `scripts/uninstall-windows.ps1` 清理程序、受管进程和端口，默认保留用户数据与 Codex 登录态。
