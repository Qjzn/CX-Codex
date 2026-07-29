# CX-Codex 2.7.1：修复 Android 文件下载 HTTP 400

2.7.1 是 Android 文件打开与下载的热修复版本。此前本地 PDF、Word 等文件可以在 CX-Codex 内正常预览，但点击“打开”或“下载”后，原生客户端会把文件地址中的查询参数删除，导致服务端收不到文件路径并返回 HTTP 400。

## 本版修复

- Android 原生文件传输现在完整保留 `/codex-local-file?path=...&download=1` 中的编码路径和查询参数。
- 文件 URL 仍会移除无须发送到服务端的浏览器 `#fragment`，但不会再套用只适合服务器首页地址的清理规则。
- “打开”和“下载”共用修复后的 URL 处理，因此 PDF、Word、Excel、PPT 等本地文件都不再因缺少 `path` 参数失败。
- 该问题与免费域名无关；局域网、Tailscale Funnel 固定地址和 Cloudflare Quick Tunnel 临时地址使用同一修复链路。

## 安全边界

- 原生下载继续携带当前 CX-Codex 登录 Cookie；登录失效时仍会重新鉴权或给出明确提示。
- 服务端仍要求绝对本地文件路径，缺少路径的请求继续返回 HTTP 400。
- 文件不会上传到第三方预览服务，下载响应的 MIME 类型和附件文件名规则保持不变。
- 正式 Android APK 继续由 GitHub Release 工作流使用固定证书构建，并通过证书 SHA-256 门禁。

## 一步安装或升级

Windows 服务端可继续使用原命令安装或升级：

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/bootstrap-windows.ps1'))) -RemoteQuick -JsonOutput
```

本次问题位于 Android 原生层，网页热更新无法替换已经安装的原生代码。请从本 Release 下载并覆盖安装 `2.7.1` 正式 APK；它与 `2.5.9+` 正式版使用同一发布证书，可保留现有服务地址和设置。

官方卸载入口默认保留访问配置、Codex 登录态、工作区和 Android 正式签名：

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/uninstall-windows.ps1'))) -JsonOutput
```

## 验证

- Android `MobileShellConfigTest` 覆盖带 HTTPS 端口、编码 Windows 路径、查询参数和浏览器片段的文件 URL。
- Android Debug Java 编译与单元测试通过。
- 前端、CLI、服务模块、Release ZIP 和校验文件门禁通过。
- GitHub Release 工作流会重新构建固定签名 APK，并校验包名、`versionName=2.7.1`、`versionCode=20701` 和发布证书指纹。

标签发布前，本版仍按候选版本审查。只有 GitHub CI、Windows smoke、Release 工作流、公开 ZIP/APK、SHA-256 和正式签名全部验证通过后，本版才视为正式可交付版本。
