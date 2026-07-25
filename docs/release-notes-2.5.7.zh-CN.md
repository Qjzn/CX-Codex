# CX-Codex 2.5.7：一键安装调用可可靠退出

2.5.7 修复 Windows 新人安装链路中的一个关键稳定性问题：当自动化工具或 PowerShell 变量捕获 `-JsonOutput` 结果时，CX-Codex 服务虽然已经启动并返回成功 JSON，外层调用仍可能因为后台进程继承句柄而一直不退出。

## 本版变化

- Windows 安装器通过 CIM 创建隐藏 worker，使常驻 Node 服务脱离安装脚本的原生进程作业和输出管道。
- 服务继续使用端口级 stdout/stderr 日志，不向安装 JSON 泄漏密码、Cookie、Token 或临时公网地址之外的敏感信息。
- PID 标记、健康检查、Quick Tunnel 和官方卸载流程保持原有契约。
- Windows 产品化回归改为从外层 PowerShell 变量捕获真实 `StartNow` JSON，并要求调用在 60 秒内退出。
- Release 归档强制包含新的 detached worker，避免源码验证通过但正式 ZIP 缺文件。

## 一步安装、升级或修复

在普通 Windows PowerShell 中执行：

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/bootstrap-windows.ps1'))) -RemoteQuick -JsonOutput
```

命令会选择最新正式 Release、校验 SHA-256、启动本机服务并创建免费临时 HTTPS 地址。无需服务器、域名或 Cloudflare 账号。

安装完成后，在电脑本机打开：

```text
http://127.0.0.1:7420/local-setup
```

用手机扫描二维码打开临时地址，再输入页面单独显示的访问密码。二维码不包含密码，配对页也不能从公网打开。

## 卸载

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/uninstall-windows.ps1'))) -JsonOutput
```

默认卸载会停止受管服务和临时通道，删除程序与启动器，同时保留 CX-Codex 运行数据、Codex 登录态、工作区、Android 签名和已校验的 cloudflared 缓存。

## 验证

- 本机 Windows 产品化回归通过真实外层变量捕获、单行 JSON、服务健康、官方卸载和端口关闭。
- 隔离新人环境的源码版 `RemoteQuick` 通过公网健康、未登录 API 401 和未登录 WebSocket 拒绝三项验证。
- 全新浏览器可经密码页进入新会话界面，创建任务、消息输入和设置入口均可见，无横向溢出。
- GitHub Linux Release gate 与 Windows bootstrap、产品化、锁文件升级和卸载 smoke 全部通过。

## 边界

Quick Tunnel 免费、免注册且无需自有服务器，但地址是临时的，没有 SLA，服务退出后地址会失效。2.5.7 解决的是安装调用不退出问题，不把临时通道升级为长期固定公网服务。

正式标签发布前，本版仍按候选版本审查；只有 Release 工作流、公开资产校验和正式归档安装回归全部完成后，才视为正式可交付版本。
