# CX-Codex 2.7.0：固定手机地址与会话加载恢复

2.7.0 解决两个长期使用痛点：升级或重启后外网地址和访问密码难以保持，以及手机能看到会话但内容加载失败时像空会话。本版默认优先使用 Tailscale Funnel 固定地址，Cloudflare Quick Tunnel 继续作为无需注册的临时备用方案。

## 固定地址优先

- 安装并登录一次 Tailscale 后，可在 CX-Codex“手机访问”中启用固定 HTTPS 地址。
- 固定通道使用独立的 `8443` 端口；电脑与 Tailscale 在线后，升级或重启会继续使用同一设备域名。
- 如果 `8443` 已被其他本地服务使用，CX-Codex 会提示冲突，不会覆盖或停止已有配置。
- 未安装、未登录或固定通道暂时不可用时，可直接使用 Cloudflare 临时备用地址。
- 两种模式都必须通过公网健康、访问密码和 WebSocket 消息连接鉴权，才会显示为可用。

## 密码和配置不会随升级重置

- Windows 首次安装默认选择固定访问模式并生成一次访问密码。
- 重复安装或升级会保留原密码、远程访问开关、访问模式以及未知配置字段。
- 启用临时备用地址不会把“固定优先”永久改成临时模式。
- 访问密码只有在本机管理中心手动修改，或用户明确删除运行数据后才会变化。
- 设置页和本机管理中心会明确标记当前是固定地址还是临时地址。

## 手机会话加载恢复

- 手机端进入会话时，如果内容请求失败，不再误显示“当前会话还没有消息”。
- 未缓存的会话显示中文恢复卡，可立即“重新连接”；Android 端还可直接“修改地址”。
- 已缓存的消息在后台刷新失败时继续保留，不会因短暂断网变成空白。
- 网络和超时错误继续使用有界自动重试，连接恢复后补拉当前会话内容。

## 一步安装或升级

在普通 Windows PowerShell 中执行：

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/bootstrap-windows.ps1'))) -RemoteQuick -JsonOutput
```

参数名 `RemoteQuick` 为兼容旧版本而保留；2.7.0 会先尝试恢复固定地址，失败时才使用临时备用地址。安装完成后会打开仅限本机的 CX-Codex 管理中心。

首次启用固定地址：

1. 打开设置中的“手机访问”。
2. 点击“安装 Tailscale”，完成安装并登录。
3. 返回 CX-Codex，刷新状态并点击“启用固定地址”。
4. 等待健康、密码和消息连接验证全部通过后，再复制到手机使用。

官方卸载入口默认保留访问配置、Codex 登录态、工作区和 Android 正式签名：

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/uninstall-windows.ps1'))) -JsonOutput
```

## 安全边界

- 公网 Codex API 和 WebSocket 始终要求访问密码。
- 二维码、安装 JSON、日志和 Release 文档不包含密码、Cookie、Token 或私人公网地址。
- 本机管理中心仍只允许从服务电脑的回环地址访问。
- 正式 Android APK 继续由 GitHub Release 工作流使用固定证书构建并校验证书 SHA-256。

## 验证

- 前端、CLI、服务模块和 Windows 产品化门禁通过。
- 重复安装夹具确认密码、隧道开关、访问模式和未知配置字段保持不变。
- 服务模块烟测覆盖固定地址解析、登录状态、端口占用保护、固定/临时切换和停止边界。
- 7420 前端回归覆盖失败会话恢复卡、自动重试、缓存消息保留和 Android 修改地址。
- 桌面与 393 × 852 手机尺寸完成可视检查，无横向溢出，恢复和访问按钮保持至少 44px 触控高度。

Tailscale Funnel 需要 Tailscale 账号和一次登录；Cloudflare Quick Tunnel 仍可免费、免注册、免域名使用，但地址可能在升级、重启或通道重连后变化，也没有固定域名和 SLA。

标签发布前，本版仍按候选版本审查。只有 GitHub Release 工作流、公开 ZIP/SHA-256、固定签名 APK 和公开下载验证全部通过后，本版才视为正式可交付版本。
