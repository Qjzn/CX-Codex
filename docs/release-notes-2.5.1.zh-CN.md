# CX-Codex 2.5.1：修复正式 Release 一键安装

这是 2.5.0 的紧急补丁版本。2.5.0 的源码和本地门禁均通过，但正式 Release zip 遗漏了 Vite 配置所需的 `local-preview.html`，导致 Windows bootstrap 在已完成 Release SHA-256 校验和依赖安装后，于前端构建阶段失败。

## 修复内容

- Release zip 现在同时包含 `index.html` 与 `local-preview.html`。
- Release package smoke 强制检查两个根 HTML 入口，后续遗漏会在打标签前阻断。
- JSON 安装模式在 npm 真正失败时继续把完整 stderr 诊断写到 stderr，同时 stdout 仍只保留一行稳定 JSON。
- 保留 2.5.0 的全部产品化能力：`-RemoteQuick`、Release SHA-256、版本化能力清单、稳定 JSON、官方 `scripts/uninstall-windows.ps1`、托管 PID 识别和真实 StartNow/健康/卸载回归。
- App Server schema 兼容性继续沿用 2.5.0 的候选审查边界，本补丁不扩大稳定能力声明。

## 推荐操作

尚未安装成功的用户直接重新执行原命令即可，bootstrap 会自动选择最新正式 Release：

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/bootstrap-windows.ps1'))) -RemoteQuick -JsonOutput
```

2.5.0 安装失败时会删除不完整的新安装目录；如果此前已有可用版本，更新失败会保留或恢复上一版本，不需要手工清理。

## 验证要求

- 从正式 2.5.1 Release 下载 zip 并验证 SHA-256。
- 在无现有 CX-Codex 程序的 Windows 状态执行默认 bootstrap。
- 验证安装结果版本为 2.5.1、7420 `/health` 返回 200、临时公网地址已通过健康与未登录 HTTP/WebSocket 鉴权检查。
- 用官方卸载器确认程序和端口可清理，同时用户数据和 Codex 登录态默认保留。
