# 发版说明

本仓库使用 GitHub Release 作为主发版方式。版本号统一采用纯数字语义版本：

- `2.1`
- `2.1.1`
- `2.1.15`
- `2.2.0`

以后不要再使用 `bridge`、`beta`、`rc` 等英文后缀；补丁修复走 `2.1.x`，较大功能收口走 `2.2.0`。

## 本地检查清单

1. 确认 `main` 已包含本次最终代码、README、更新日志、截图和发版说明。
2. 运行构建：

   ```powershell
   npm.cmd run build
   ```

3. 打包 Release：

   ```powershell
   npm.cmd run package:release -- -Version 2.1.15
   ```

4. 如本机需要发布 APK，运行：

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\package-android-release.ps1 -Version 2.1.15
   ```

5. 检查 `artifacts/` 中是否生成：
   - `CX-Codex-<version>.zip`
   - `CX-Codex-<version>.sha256`
   - `cx-codex-android-<version>.apk`
   - `cx-codex-android-<version>.apk.sha256`

## 发布方式

推送主分支和标签：

```powershell
git push publish main
git tag 2.1.15
git push publish 2.1.15
```

Release 工作流会自动完成：

1. 安装依赖
2. 构建项目
3. 打包 zip 与 sha256
4. 如果仓库配置了 Android 签名 secrets，构建并上传 APK
5. 发布 GitHub Release

## Release 包内容

Release 压缩包默认包含：

- 已构建的前端和 CLI
- Windows 安装与启动脚本
- 源码
- README / docs / 示例配置

## 文档维护约定

- `README.md` 是中文主文档，也包含面向 GitHub / AI 检索的英文关键词。
- `README.zh-CN.md` 只保留兼容跳转。
- 更新日志统一写入 `docs/changelog.zh-CN.md`。
- Release 正文使用 `.github/release-body.md`。
- 每次发版前优先参考 `docs/release-template.zh-CN.md`，先整理用户可感知变化，再发布。
- 公开截图必须使用脱敏演示数据，不能包含真实路径、密钥、账号、公网地址或私人会话。
