# CX-Codex 2.6.0：本机管理中心与 Android 连接恢复

2.6.0 重点解决新用户安装完成后找不到访问地址、忘记密码无处查看，以及 Android 连接失败时只看到空白页的问题。本版新增仅限服务电脑访问的管理中心，同时补强改密后的会话失效和配置写入一致性。

## 本版变化

- 新增 `http://127.0.0.1:7420/local-setup` 本机管理中心，集中显示本机、局域网和当前外网地址。
- 管理中心支持显示、复制、生成或修改访问密码；二维码只包含外网地址，不包含密码。
- 修改密码后，已经登录的 HTTP Cookie 和 WebSocket 消息连接立即失效，其他设备必须使用新密码重新登录。
- Windows 安装完成后会在桌面和开始菜单创建“CX-Codex 管理中心”；同名快捷方式如果属于其他地址会被保留，卸载时也不会误删。
- Android 加载远程页面时显示连接进度；网络错误、HTTP 错误或超时会提供“重试”和“修改地址”，不再把连接失败表现成空白页。
- 公网登录页增加忘记密码提示，引导用户回到服务电脑处理，不再要求查找或手工编辑配置文件。

## 稳定性与安全

- 密码和 Quick Tunnel 设置共用串行原子配置更新，避免同时操作时恢复旧密码或丢失隧道配置。
- 管理中心同时校验回环 TCP 来源、回环 Host 和进程级管理令牌；通过公网域名或局域网地址请求仍返回 404。
- 管理页面禁止缓存，不会把密码写入安装 JSON、日志、二维码或公网 URL。
- 快捷方式创建和卸载都核对目标 URL，只处理当前 CX-Codex 实例拥有的入口。

## 一步安装或升级

在普通 Windows PowerShell 中执行：

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/bootstrap-windows.ps1'))) -RemoteQuick -JsonOutput
```

安装和公网验证完成后会自动打开管理中心。以后可直接从桌面或开始菜单再次打开，查看最新地址或重置密码。

## 卸载

官方卸载脚本默认保留配置、日志、Codex 登录态、工作区和 Android 签名材料：

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/uninstall-windows.ps1'))) -JsonOutput
```

## Android 升级

从 2.5.9 正式签名版可直接覆盖安装本版 APK，并保留已保存的服务地址。正式 APK 仍由 GitHub Release 工作流使用固定证书构建并校验证书 SHA-256。

如果设备安装的是开发 Debug 版，它使用独立包名，可以和正式版同时存在，不需要互相覆盖。

## 验证

- 前端与 CLI 完整构建通过。
- 服务模块、前端规范化、7420 桌面/手机/折叠屏和侧栏数据回归通过。
- Windows 安装、快捷方式冲突保护、启动、进程树卸载和数据保留回归通过。
- 隔离服务改密回归确认：旧 WebSocket 已关闭，旧 Cookie 和旧密码返回 401，新密码登录返回 200。
- Android Debug/Release 编译和正式签名门禁由本地检查与 GitHub Release 工作流共同验证。

Quick Tunnel 仍是免费、免注册的临时通道，地址会在服务或隧道重启后变化，也没有固定域名和 SLA。请始终以本机管理中心显示的当前地址为准。

正式标签发布前，本版仍按候选版本审查；只有 GitHub Release 工作流、公开资产、SHA-256 和正式签名 APK 全部验证通过后，才视为正式可交付版本。
