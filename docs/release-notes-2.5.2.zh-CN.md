# CX-Codex 2.5.2：修复 Windows 一键升级

> 后续正式 Release 回归发现 `codex.exe` 子进程仍可能短暂持有安装目录。请使用 2.5.3 或更高版本；2.5.3 已改为停止受管进程树并增加失败恢复。

2.5.1 已修复正式 Release 首次安装，但从正在运行的版本再次执行同一条安装命令时，Windows 会锁定服务的当前工作目录，导致 bootstrap 无法把旧安装原子移动到回滚目录。2.5.2 补齐了这条日常升级链路。

## 修复内容

- 原子替换前结合目标安装路径、配置、启动器、PID 标记与监听端口确认 CX-Codex 服务，并停止对应 Quick Tunnel。
- 进程识别继续采用严格边界，不按模糊进程名结束其他 Node.js 或 cloudflared 实例。
- 最多等待 10 秒确认受管进程退出；无法确认时停止升级并保留原安装，不强行覆盖。
- 替换成功后继续保留 `.previous` 回滚目录，由新版本完成依赖安装、构建、启动和公网鉴权验证。
- Windows CI 新增旧安装目录被进程占用时的原地升级回归。
- App Server schema 漂移继续沿用已审查的候选发布边界，本补丁不扩大协议能力声明。

## 推荐操作

首次安装与已有版本升级使用同一条命令：

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/bootstrap-windows.ps1'))) -RemoteQuick -JsonOutput
```

命令会选择最新正式 Release，校验 SHA-256，保留用户数据与 Codex 登录态，并在成功后返回一行 JSON。访问密码不会出现在 JSON 或公网 URL 中，只能在本机 `http://127.0.0.1:7420/local-setup` 查看。

## 验证要求

- 从正式 Release 全新安装并确认本机健康与三项 Quick Tunnel 鉴权验证通过。
- 保持服务运行，再次执行同一条命令，确认旧服务与隧道退出、安装目录成功替换、`.previous` 可回滚。
- 确认升级后仍是 7420 健康、临时公网地址 ready，用户数据与 Codex 登录态未丢失。
- 用官方 `scripts/uninstall-windows.ps1` 确认程序、受管进程和端口可清理，默认继续保留用户数据。
