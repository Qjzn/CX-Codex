# Cloudflare Tunnel 一键模式

Cloudflare Tunnel 适合想从手机或外网访问家里电脑 / Windows Server 上 Codex Web UI 的用户。它的优点是通常不需要公网 IP，也不需要路由器端口映射。

本项目优先支持“快速隧道”模式：不需要 Cloudflare 账号、不需要域名，安装后会生成一个临时的 `trycloudflare.com` HTTPS 地址。

## 适合谁

- 不想配置路由器端口映射
- 没有公网 IP
- 想用一个 HTTPS 地址访问 `7420`
- 临时远程访问、演示或个人使用

## 前置条件

- 本机 `7420` 服务能正常访问
- Web UI 已设置访问密码

## 一条命令开启快速隧道

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/bootstrap-windows.ps1'))) `
  -EnableCloudflareTunnel
```

这个命令会：

- 安装或更新 `CX-Codex`
- 自动下载 `cloudflared.exe` 到用户目录
- 生成 `7420` 固定端口配置
- 开启 `tunnel: true`
- 启动服务并在日志里输出 `https://*.trycloudflare.com`

从源码执行 `npm ci` 和 `npm run build` 后，也可直接用 CLI 开启这条链路：

```powershell
node dist-cli/index.js --host 0.0.0.0 --port 7420 --tunnel
```

如果本机还没有 `cloudflared`，交互终端会提示是否自动安装到：

```text
%USERPROFILE%\.local\bin
```

如果你已经有单独安装的 `cloudflared.exe`，也可以显式指定：

```powershell
node dist-cli/index.js --host 0.0.0.0 --port 7420 --tunnel --cloudflared-command "C:\Users\your-user\.local\bin\cloudflared.exe"
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
- 不要在 Issue 里粘贴真实域名、Tunnel ID、Token 或配置文件原文。
- 快速隧道适合临时访问；长期使用建议配置固定域名和 Cloudflare Access。

## 故障排查

- 本机打不开 `http://127.0.0.1:7420`：先修 Codex Web UI 服务。
- Cloudflare 域名打不开：检查 Tunnel 是否运行、DNS 是否绑定、配置文件路径是否正确。
- 能打开登录页但不能使用：检查反向代理是否保留 WebSocket 和 SSE 连接。
- 手机网络慢：优先确认本机网络、Cloudflare 节点和浏览器缓存。
