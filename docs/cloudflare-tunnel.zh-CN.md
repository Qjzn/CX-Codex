# Cloudflare Tunnel 一键模式

Cloudflare Tunnel 适合想从手机或外网访问家里电脑 / Windows Server 上 Codex Web UI 的用户。它的优点是通常不需要公网 IP，也不需要路由器端口映射。

本项目优先支持“快速隧道”模式：不需要 Cloudflare 账号、不需要域名，安装后会生成一个临时的 `trycloudflare.com` HTTPS 地址。

## 先说结论

Cloudflare Quick Tunnel 当前可以免费、免注册、免域名使用，也不要求用户自建服务器。它仍会使用 Cloudflare 的公网中继，并不等于网络链路里完全没有服务器。

快速隧道只适合临时远程访问：

- 地址由 Cloudflare 随机分配，进程或电脑重启后通常会变化
- Cloudflare 不承诺 SLA 或持续可用性
- 最多允许 200 个并发中的请求
- 不支持 Server-Sent Events（SSE），CX-Codex 前台会优先使用 WebSocket，其他恢复链路继续依赖事件回放和轮询

长期固定地址和更完整的访问控制，请使用本文后面的固定域名模式，或改用 Tailscale 私有网络。

官方说明：

- [Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)
- [下载 cloudflared](https://developers.cloudflare.com/tunnel/downloads/)

## 适合谁

- 不想配置路由器端口映射
- 没有公网 IP
- 想用一个 HTTPS 地址访问 `7420`
- 临时远程访问、演示或个人使用

## 前置条件

- 本机 `7420` 服务能正常访问
- Web UI 已设置访问密码

先在 Windows PowerShell 中检查本机服务：

```powershell
curl.exe -sS http://127.0.0.1:7420/health
```

然后模拟一次非本地域名请求，确认公网访问不会绕过登录：

```powershell
curl.exe -sS -o NUL -w "%{http_code}`n" `
  -H "Host: remote-access-check.invalid" `
  http://127.0.0.1:7420/codex-api/meta/methods
```

预期状态码必须是 `401`。如果返回 `200`，先启用访问密码并重启 CX-Codex，不要继续开启公网隧道。

## 一条命令开启快速隧道

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/bootstrap-windows.ps1'))) `
  -UseBranchArchive `
  -RemoteQuick `
  -JsonOutput
```

`-RemoteQuick` 尚未进入当前 `2.4.1` Release，因此这里暂时显式安装 `main` 源码预览版。源码归档没有 Release SHA-256 保证；正式版本发布后应去掉 `-UseBranchArchive`。

这个命令会：

- 从最新正式 GitHub Release 安装或更新 `CX-Codex`，校验 Release SHA-256
- 使用临时目录原子切换版本，安装失败时保留或恢复上一版本
- 自动下载官方 `cloudflared.exe`，并按 Cloudflare Release 正文校验 SHA-256
- 固定监听 `127.0.0.1:7420`，不创建防火墙规则、开机任务或看门狗任务
- 隔离已有 `%USERPROFILE%\.cloudflared\config.yml`，不覆盖用户配置
- 验证公网健康为 `200`、未登录 API 为 `401`、未登录 WebSocket 握手被拒绝
- 最后一行输出不含密码和 Token 的 JSON 结果

如果本机对 `api.trycloudflare.com` 的解析与 Cloudflare DoH 结果不一致，CX-Codex 会为本次进程启动一个仅监听回环地址、带随机路径的临时转发，并让 cloudflared 只通过它申请快速隧道。它与隧道同时停止，不写 hosts、不改系统 DNS，也不接管其他域名。该兼容回退依赖 cloudflared 当前的 Quick Tunnel 参数；若未来官方移除参数，CX-Codex 会返回明确错误并保持公网关闭，需要升级项目或改用固定 Tunnel / Tailscale。

安装器会自动生成访问密码并写入 `%USERPROFILE%\.cx-codex\config.json`，但不会把密码打印到日志。密码只在本机查看和保存，不要把配置文件、密码和公网地址一起发到 Issue、群聊或截图中。

电脑本机打开下面地址可查看手机地址和访问密码：

```text
http://127.0.0.1:7420/local-setup
```

这个页面同时检查 TCP 来源和 `Host` 都是回环地址；通过公网域名、局域网 IP 或 Cloudflare 地址请求时返回 `404`。

服务已经运行时，也可进入 CX-Codex 设置，找到“手机访问”，点击“生成手机访问地址”。设置页会显示健康、密码和消息连接三项验证，并提供复制、打开、刷新和停止入口。

从源码执行 `npm ci` 和 `npm run build` 后，也可直接用 CLI 开启这条链路：

```powershell
node dist-cli/index.js --host 127.0.0.1 --port 7420 --tunnel
```

如果本机还没有 `cloudflared`，交互终端会提示是否自动安装到：

```text
%USERPROFILE%\.local\bin
```

如果你已经有单独安装的 `cloudflared.exe`，也可以显式指定：

```powershell
node dist-cli/index.js --host 127.0.0.1 --port 7420 --tunnel --cloudflared-command "C:\Users\your-user\.local\bin\cloudflared.exe"
```

如果你只想配置本地服务，不想自动下载 `cloudflared`：

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/bootstrap-windows.ps1'))) `
  -EnableCloudflareTunnel `
  -SkipCloudflaredInstall
```

安装完成后查看日志：

```powershell
Get-Content "$env:USERPROFILE\.cx-codex\logs\cx-codex.out.log" -Tail 80
```

找到类似下面的地址后，用手机打开：

```text
https://example.trycloudflare.com
```

> 快速隧道地址通常是临时地址，重启后可能变化。需要固定域名时，请使用下面的高级模式。

## 已运行 7420：只启动隧道

如果 CX-Codex 已经在 `127.0.0.1:7420` 运行，不需要重新安装项目。确认 `cloudflared` 可用：

```powershell
cloudflared --version
```

Windows 版不会自动更新。如果版本过旧或命令不存在，请从 Cloudflare 官方下载页更新，然后运行：

```powershell
cloudflared tunnel --url http://127.0.0.1:7420
```

看到下面两类日志后才算真正建立成功：

```text
https://example.trycloudflare.com
Registered tunnel connection
```

手机打开生成的 HTTPS 地址，使用 CX-Codex 当前访问密码登录。保持 CX-Codex 和 `cloudflared` 进程运行；前台执行时按 `Ctrl+C` 即可关闭隧道。

### 已有 Cloudflare 配置发生冲突

官方快速隧道会自动读取 `%USERPROFILE%\.cloudflared\config.yml` 或 `config.yaml`。如果电脑已经配置过固定 Tunnel，快速隧道可能因此拒绝启动。不要删除或覆盖已有配置。

Windows 可以为本次快速隧道显式使用空配置源：

```powershell
cloudflared tunnel --config NUL --no-autoupdate --url http://127.0.0.1:7420
```

以最终是否生成 `trycloudflare.com` 地址并出现 `Registered tunnel connection` 为准。

## 公网验证

把生成的地址粘贴到变量中：

```powershell
$publicUrl = "https://example.trycloudflare.com"
```

检查首页、健康状态和未登录 API：

```powershell
curl.exe -sS -o NUL -w "首页：%{http_code}`n" "$publicUrl/"
curl.exe -sS -o NUL -w "健康：%{http_code}`n" "$publicUrl/health"
curl.exe -sS -o NUL -w "鉴权：%{http_code}`n" "$publicUrl/codex-api/meta/methods"
```

预期结果：

- 首页：`200`，显示登录页面
- 健康：`200`
- 鉴权：`401`

验证完成后再把地址输入 Android App。不要把访问密码放进 URL 或二维码。

## 显式指定 cloudflared 路径

如果 `cloudflared` 不在 PATH 里，可以在配置文件里直接写：

```json
{
  "host": "0.0.0.0",
  "port": 7420,
  "tunnel": true,
  "cloudflaredCommand": "C:\\Users\\your-user\\.local\\bin\\cloudflared.exe"
}
```

## 推荐架构

```text
手机浏览器
  -> Cloudflare HTTPS 域名
  -> Cloudflare Tunnel
  -> 本机 127.0.0.1:7420
  -> Codex Web UI
```

## 高级模式：固定域名

固定域名适合长期使用。它需要：

- Cloudflare 账号
- 域名已经托管到 Cloudflare
- 本机已安装 `cloudflared`

### 安装 cloudflared

Windows 可以参考 Cloudflare 官方方式安装 `cloudflared`。安装后确认：

```powershell
cloudflared --version
```

### 登录 Cloudflare

```powershell
cloudflared tunnel login
```

浏览器会打开授权页面。选择对应域名完成授权。

### 创建 Tunnel

```powershell
cloudflared tunnel create cx-codex
```

### 绑定域名

把下面的域名换成你自己的子域名：

```powershell
cloudflared tunnel route dns cx-codex codex.example.com
```

### 配置转发

创建配置目录：

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.cloudflared"
```

创建 `$env:USERPROFILE\.cloudflared\config.yml`：

```yaml
tunnel: cx-codex
credentials-file: C:\Users\your-user\.cloudflared\your-tunnel-id.json

ingress:
  - hostname: codex.example.com
    service: http://127.0.0.1:7420
  - service: http_status:404
```

把 `credentials-file` 改成 `cloudflared tunnel create` 输出的实际路径。

### 启动 Tunnel

```powershell
cloudflared tunnel run cx-codex
```

然后打开：

```text
https://codex.example.com
```

### 设置为后台服务

Windows：

```powershell
cloudflared service install
```

然后在 Windows 服务里确认 `cloudflared` 已启动。

## 安全建议

- Web UI 必须设置密码。
- Cloudflare 侧建议增加 Access 保护，只允许自己的邮箱登录。
- 不要把无密码的 `7420` 直接暴露到公网。
- 随机公网地址不是密码，拿到地址的人仍可访问登录页面。
- 不要同时分享公网地址、密码、配置文件或带有这些内容的截图。
- 不要使用 `--loglevel debug` 处理真实会话；调试日志可能包含请求地址和请求头。
- 临时使用结束后立即停止 `cloudflared`。
- 不要在 Issue 里粘贴真实域名、Tunnel ID、Token 或配置文件原文。
- 快速隧道适合临时访问；长期使用建议配置固定域名和 Cloudflare Access。

## 故障排查

- 本机打不开 `http://127.0.0.1:7420`：先修 Codex Web UI 服务。
- 日志停在 `Requesting new quick Tunnel` 并最终超时：优先检查 `api.trycloudflare.com` 的 DNS 和 HTTPS 可达性。
- 已生成公网地址但本机或手机打不开：分别检查系统 DNS、手机网络和安全 DNS；同一运营商网络可能同时受到影响。
- 不要把 Cloudflare 当前边缘 IP 永久写入 hosts，边缘地址可能变化。优先切换网络、启用受信任的安全 DNS，或改用 Tailscale。
- 企业或受限网络需允许 Cloudflare Tunnel 的出站连接；日志出现 `Registered tunnel connection` 才表示隧道已注册。
- 能打开登录页但不能实时更新：检查 WebSocket；Quick Tunnel 不支持 SSE，CX-Codex 会使用 WebSocket 及事件回放/轮询兜底。
- 手机网络慢：优先确认本机网络、Cloudflare 节点和浏览器缓存。

检查系统 DNS：

```powershell
Resolve-DnsName api.trycloudflare.com -Type A
```

通过 DNS over HTTPS 交叉检查，不要把查询结果中的 IP 固定写入配置：

```powershell
curl.exe -sS `
  --resolve cloudflare-dns.com:443:1.1.1.1 `
  -H "accept: application/dns-json" `
  "https://cloudflare-dns.com/dns-query?name=api.trycloudflare.com&type=A"
```

查看连接日志时重点搜索：

```text
Your quick Tunnel has been created
Registered tunnel connection
context deadline exceeded
```

只停止指向 `7420` 的隧道，不要误停机器上其他 Cloudflare Tunnel：

```powershell
Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" |
  Where-Object { $_.CommandLine -like '*127.0.0.1:7420*' } |
  Select-Object ProcessId, CommandLine

Stop-Process -Id <确认后的进程号>
```
