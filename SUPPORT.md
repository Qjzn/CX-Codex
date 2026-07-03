# 支持与反馈

提交 Issue 前，先尽量确认问题属于安装、访问、同步、Android 生命周期还是公网链路。这样维护者可以更快定位。

## 先检查这些信息

1. 当前版本：Release 版本号或 Git commit。
2. 运行平台：Windows、Windows Server、Linux、macOS、Android App 或手机浏览器。
3. 访问方式：本机、局域网、VPN、Cloudflare Tunnel、frp、Nginx、Caddy 或其他反代。
4. 是否能打开本地健康检查。
5. 问题是否只在 Android 切后台、锁屏、弱网恢复或长会话里出现。

## 常用诊断命令

Windows PowerShell：

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:7420/health
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:7420/codex-api/health
```

查看本机 7420 进程：

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -like '*dist-cli*' -or $_.CommandLine -like '*cx-codex*' } |
  Select-Object ProcessId, CommandLine
```

查看最近日志：

```powershell
Get-ChildItem "$env:USERPROFILE\.cx-codex\logs","$env:USERPROFILE\.codexui\logs" -Filter *.log -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 5 FullName, LastWriteTime, Length
```

## Issue 里不要包含

- 密码、Token、Cookie、Authorization header。
- 真实公网地址、私有 IP、公司内网地址。
- 个人目录、私人项目路径、业务文件内容。
- 未脱敏的截图或日志。

## 最有效的反馈格式

```text
版本：
平台：
访问方式：
复现步骤：
实际结果：
期望结果：
/health 关键字段：
/codex-api/health 关键字段：
是否 Android 切后台/锁屏/弱网相关：
```

如果问题涉及“思考中卡住”或“发送后无回复”，请优先说明是否能通过顶部刷新恢复，以及刷新后 `/codex-api/health` 中是否仍有 pending、queued、uncertain 或 running 状态。

## Codex App Server 兼容问题

如果问题出现在 Codex CLI、Codex App 或 App Server 升级之后，请优先使用 GitHub 的 `Codex App Server 兼容性` Issue 模板，并补充：

- CX-Codex 版本或 commit。
- Codex CLI / App Server 版本。
- 使用的 transport：`stdio`、`websocket`、Unix socket 或不确定。
- 受影响的 method / event，例如 `initialize`、`thread/read`、`turn/start`、approval、tool request、interrupt。
- 最小脱敏 JSON-RPC payload、error code、health 关键字段或行为差异。

不要公开粘贴 Authorization header、Token、Cookie、真实公网地址、私人项目路径或完整业务日志。
