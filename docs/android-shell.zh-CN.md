# Android 壳应用一期

本项目的一期 Android 方案不是把 Node 桥接后端搬进手机，而是用 Capacitor 把现有 Web 前端封装成安卓壳，并连接一台已经运行 `CX-Codex` 的远程地址。

## 目标

- 复用现有 Web 前端，不重写页面
- 在 Android 端接入更稳定的前后台恢复和网络恢复事件
- 为后续通知、语音、文件上传和本地持久化预留原生入口

## 当前范围

- 已接入 Capacitor Android 基础依赖
- 已新增 App 生命周期和网络状态桥接
- 已新增 Android 原生通知权限和任务通知桥接
- App 回到前台、网络恢复或 WebView 重新载入时，会先回放持久化的服务端事件游标，再复用现有 Web 端自动补同步逻辑

当前这版仍然依赖远程 `CX-Codex`，不支持离线独立运行。

## 使用方式

1. 先准备一台可访问的 `CX-Codex`

例如局域网或公网地址：

- `http://192.168.x.x:7420`
- `https://your-remote-host.example.com`

2. 可选：在 PowerShell 中设置 Android 壳要预置的连接地址

```powershell
$env:CAP_SERVER_URL = "https://your-remote-host.example.com:7420"
```

默认发行 APK 不预置任何服务地址。首次进入 App 时需要输入连接地址，保存后会持久化到本机，后续启动会自动进入该地址。

3. 生成 Android 工程

```powershell
npm run mobile:android:add
```

4. 同步前端资源与 Capacitor 配置

```powershell
npm run mobile:android:sync
```

5. 用 Android Studio 打开原生工程

```powershell
npm run mobile:android:open
```

## 当前脚本

- `npm run mobile:android:add`
- `npm run mobile:android:sync`
- `npm run mobile:android:open`
- `npm run mobile:android:run`

## 本地 release 签名

当前工作区已经支持本地签名版 APK：

- 本地 keystore：`%USERPROFILE%\\.cx-codex\\android-signing\\cxcodex-release.jks`
- 本地签名配置：`android/keystore.properties`

这两个文件只用于当前机器：

- `android/keystore.properties` 已加入 `.gitignore`
- keystore 不会随仓库提交

构建命令：

```powershell
$env:JAVA_HOME = "C:\\Program Files\\Java\\jdk-24"
$env:ANDROID_SDK_ROOT = "$env:LOCALAPPDATA\\Android\\Sdk"
$env:ANDROID_HOME = $env:ANDROID_SDK_ROOT
cd android
.\gradlew.bat assembleRelease
```

默认产物：

- `android/app/build/outputs/apk/release/app-release.apk`

## 当前 Android 产品化收口

- 应用名称：`CX-Codex`
- 默认远程地址：发行包默认留空；如需私有包预置地址，可通过 `CAP_SERVER_URL` 同步写入原生配置
- Android 已显式放开 HTTP 明文访问，适配自托管 `http://host:port` 场景
- 启动页已改为原生 SplashScreen + 品牌图标方案
- App 设置里已新增“移动端连接”区块：
  - 可直接查看当前连接地址
  - 可手动修改服务地址并保存重连
  - 私有预置包可恢复打包时写入的默认地址；公开发行包默认地址为空
- Android 会在登录成功后持久化访问密钥；Cookie / token 失效或服务重启后，会优先使用本机密钥自动重登
- App 设置里已新增“App 更新”区块：
  - 可读取 GitHub 最新 Release
  - 可显示当前安装版本、最新版本和 APK 名称
  - 可直接下载最新 APK 并拉起系统安装
- Android 原生插件已补充移动端稳定性能力：
  - 对话执行、发送、排队、打断时接入轻量触感反馈
  - 对话活跃和同步追平期间保持屏幕活跃，减少锁屏 / 息屏后的断点感
  - App 设置里可读取原生网络、设备省电状态和 WebView 版本，方便定位真机差异
  - App 设置里可检测和申请 Android 通知权限
  - 等待确认、任务完成和任务出错时，可通过 Android 本地通知提醒
  - 语音转文字优先调用 Android 系统语音识别：即使连接的是 `http://` 自托管服务也可使用，不受网页麦克风安全上下文限制；首次使用会申请 `RECORD_AUDIO` 权限，识别结果默认回填输入框，供编辑确认。若系统语音服务不可用，可改用输入框麦克风打开系统录音/选择音频后由服务端转写。

## 本地一键打包

```powershell
./scripts/package-android-release.ps1 -Version 2.1.7 -VersionCode 20107
```

默认会产出：

- `artifacts/cx-codex-android-2.1.7.apk`
- `artifacts/cx-codex-android-2.1.7.apk.sha256`

如需构建私有预置地址包，再显式传入：

```powershell
./scripts/package-android-release.ps1 -Version 2.1.7 -ServerUrl https://your-codex-host.example.com -VersionCode 20107
```

## 7420 回归检查

每次调整移动端恢复、折叠屏布局、Android 壳或 7420 服务稳定性后，建议先启动本地服务，再执行：

```powershell
npm run test:7420
```

脚本会检查：

- `http://127.0.0.1:7420/health`
- `http://127.0.0.1:7420/codex-api/health`
- 传入 `-PublicHealthUrl` 时会额外检查公网 `/health`
- `http://127.0.0.1:7420/codex-api/events/replay`
- WebView 通知游标恢复
- 桌面 `1440x900`
- 手机 `390x844`
- 折叠屏 `884x1104`
- 页面关键元素、横向溢出和浏览器错误

如果本地服务没有启动，可用：

```powershell
npm run test:7420 -- -RestartIfUnhealthy
```

## GitHub Release 挂 APK

仓库内的 `release.yml` 已支持额外上传 Android APK，但为了保证后续站内更新可以覆盖安装，Release APK 必须始终使用同一把签名 key。建议在 GitHub 仓库配置以下 secrets：

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`
- `ANDROID_DEFAULT_SERVER_URL`（可选）

配置后，打标签发版时会自动：

- 构建 Web Release 包
- 构建签名版 `CX-Codex` Android APK
- 将 APK 与 `.sha256` 一并挂到 GitHub Release

## 已知边界

- 如果没有设置 `CAP_SERVER_URL`，安卓壳仍可生成，首次进入会显示连接地址配置页。
- 当前实现优先解决“回到前台自动补同步”和“关键任务本地提醒”，不是“锁屏期间持续流式更新”。
- Android 通知依赖系统通知权限；如果用户关闭通知，Web 端仍会在回到前台后通过事件回放追平状态。
- 真机安装、调试和发布仍需要本机 Android SDK / Android Studio。

## 后续建议

- 在真机上补一轮锁屏、切后台、弱网和折叠屏展开 / 合上回归
- 继续把高频线程状态做成更轻的服务端快照，降低长线程恢复时的重读压力
