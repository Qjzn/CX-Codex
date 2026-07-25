# CX-Codex 2.5.9：Android 正式签名升级与一键安装反馈优化

2.5.9 修复 Android Release 可能退回发布临时 Debug 签名 APK、导致已有正式版无法覆盖安装的问题。正式 APK 现在只允许使用项目固定证书构建；缺少签名配置或证书指纹变化时，发布会直接失败，不再把问题交给安装用户。

## 本版变化

- GitHub Release 强制校验 Android 正式签名配置与证书 SHA-256，只发布可持续覆盖升级的 `cx-codex-android-v2.5.9.apk`。
- 删除公开 Debug APK 备用发布路径；本地 Debug 构建使用独立包名 `com.cxcodex.bridge.debug`，可与正式版同时安装。
- Windows bootstrap 在耗时步骤中每 15 秒输出一次无敏感信息的安装心跳，避免新人误以为安装卡死。
- `RemoteQuick` 完成本机健康、公网健康、HTTP 鉴权和 WebSocket 鉴权后，自动打开仅限本机访问的手机配对页。
- 无人值守场景可以增加 `-SkipOpenPairing`；浏览器启动失败只返回警告，不会把已经成功的安装误报为失败。

## Android 升级

从此前正式签名版本升级时，直接安装本版 APK 即可保留 App 配置。

如果设备安装的是 v2.5.8 的临时 Debug APK，因为 Android 不允许不同证书覆盖同一包名，需要卸载该 Debug 版本一次，再安装 v2.5.9 正式版。此后正式版本可以持续覆盖升级。

## 一步安装、升级或修复

在普通 Windows PowerShell 中执行：

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/bootstrap-windows.ps1'))) -RemoteQuick -JsonOutput
```

`JsonOutput` 模式的 stdout 仍然只输出最终单行 JSON，安装阶段与心跳写入 stderr。完成后会打开本机 `http://127.0.0.1:7420/local-setup`，用手机扫描二维码并输入页面单独显示的访问密码即可。

## 卸载

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/uninstall-windows.ps1'))) -JsonOutput
```

`uninstall-windows.ps1` 默认保留 CX-Codex 数据、Codex 登录态、工作区和 Android 签名材料。

## 验证

- Android release APK 通过 APK Signature Scheme 校验，证书 SHA-256 与项目固定发布证书一致。
- Android Debug 与 Release 使用不同 application id。
- Windows 产品化、RemoteQuick、前端/CLI 构建、Release ZIP 与全部 SHA-256 校验通过。

正式标签发布前，本版仍按候选版本审查；只有 GitHub Release 工作流、公开资产和正式签名 APK 全部验证通过后，才视为正式可交付版本。
