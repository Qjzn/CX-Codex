# CX-Codex 2.5.8：公网验证完成后再交付安装结果

2.5.8 修复 `RemoteQuick` 安装结果与真实公网状态之间的竞态。2.5.7 首次公开资产回归中，本机服务已经健康，Quick Tunnel 几秒后也完全可用，但安装器在运行时仍处于 `verifying` 时读取了一次状态并提前返回 `ok=false`，容易让新人误以为安装失败。

## 本版变化

- 安装器等待 Quick Tunnel 运行态真正进入 `active + ready`，不再把中间态当作最终结果。
- 成功结果同时要求公网健康、未登录 HTTP 鉴权和未登录 WebSocket 鉴权三项验证通过。
- 瞬时公网验证失败重试期间保留约 4 秒窗口，避免第一次失败与第二次尝试之间提前返回。
- 人类可读输出不会展示尚未通过鉴权验证的临时地址。
- 保留 2.5.7 的 detached worker：外层 PowerShell 变量或自动化管道捕获 JSON 后仍可正常退出。

## 一步安装、升级或修复

在普通 Windows PowerShell 中执行：

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/bootstrap-windows.ps1'))) -RemoteQuick -JsonOutput
```

命令会下载最新正式 Release、验证 SHA-256、启动本机服务并创建免费临时 HTTPS 地址。无需服务器、域名或 Cloudflare 账号。只有本机服务和三项公网边界全部验证通过，最终 JSON 才会返回 `ok=true`。

安装完成后，在电脑本机打开：

```text
http://127.0.0.1:7420/local-setup
```

用手机扫描二维码，再输入页面单独显示的访问密码。二维码不包含密码，配对页不能从公网打开。

## 卸载

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/uninstall-windows.ps1'))) -JsonOutput
```

默认卸载会停止受管服务和临时通道，删除程序与启动器，同时保留 CX-Codex 运行数据、Codex 登录态、工作区、Android 签名和已校验的 cloudflared 缓存。

## 验证

- 真实 7420 源码安装由外层 PowerShell 变量捕获，stdout 仅一行 JSON，并在运行时达到 `ready` 后正常退出。
- 本机健康、公网健康、HTTP 鉴权和 WebSocket 鉴权全部通过，既有 Codex 登录目录保持不变。
- Windows 产品化、前端/CLI 构建、服务模块、Release ZIP、SHA-256 和 npm package smoke 全部通过。

## 边界

Quick Tunnel 免费、免注册且无需自有服务器，但地址临时、没有 SLA，服务退出后会失效。2.5.8 确保安装结果反映当时已验证的可用状态，不把临时通道变成长期固定地址。

正式标签发布前，本版仍按候选版本审查；只有 Release 工作流、公开资产校验和正式归档安装回归全部完成后，才视为正式可交付版本。
