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

3. 运行发版验证：

   ```powershell
   npm.cmd run verify:release -- -RequireCleanGit -SchemaAudit warn
   ```

   该命令会执行治理文档检查、前端/CLI 构建、server module smoke、CLI help smoke、CLI CJS launcher smoke、Release package smoke 和 NPM package smoke。
   - `-SchemaAudit warn` 会生成最新 App Server schema 审计摘要；如果发现 drift，命令继续完成但必须人工审计。
   - 已准备更新 schema 基线并要求严格阻断时，改用 `-SchemaAudit strict`。
   - 快速本地预检可用 `-SchemaAudit skip`，但不能作为最终发版证据。
   - Release package smoke 会生成 zip 与 sha256，并检查源码包内的 README、治理文档、测试手册、GitHub 模板、workflow、前端构建产物和 CLI 入口。
   - NPM package smoke 会执行 `npm pack --dry-run --json`，确认 npm 运行包只包含 Web/CLI 运行产物和必要文档，不携带源码、治理脚本或手工测试手册。
   - 只验证脚本路径或排查构建问题时，可临时加 `-SkipPackageSmoke`；正式发版验证不要跳过，因为它会同时跳过 Release package smoke 和 NPM package smoke。
   - `verify:release` 的治理门禁会校验 `docs/app-server-schema-audit-summary.json` 的结构；正式发版前如果重新审计发现计数变化，必须同步更新该摘要和 `docs/app-server-protocol-matrix.zh-CN.md`。
   - GitHub Actions Release workflow 默认执行 `-SchemaAudit skip`，因为 runner 不保证安装 Codex CLI；正式发版前应在维护者机器运行 `warn` 或 `strict` 并记录摘要。
   - 本地 `npm.cmd run verify:release` 会自动选择可用的 PowerShell：优先探测 `pwsh`，不可用、失败或挂起时回退到 Windows PowerShell，并把选中的命令复用于 release gate 内部调用。
   - CI / Release workflow 仍直接使用 GitHub runner 提供的 `pwsh` 调用 `.ps1` 脚本；本地 npm 脚本用于提升 Windows 机器上的验证稳定性。

4. 安全边界复核：

   - 对照 [docs/security-hardening.zh-CN.md](./docs/security-hardening.zh-CN.md) 检查默认绑定地址、密码、远程访问、App Server transport、权限确认、语音转写 API key、日志和截图。
   - 涉及远程访问、App Server transport、权限确认或转写代理的版本，Release 正文必须说明安全边界和回滚方式。

5. 打包 Release：

   ```powershell
   npm.cmd run package:release -- -Version 2.1.15
   ```

6. 如本机需要发布 APK，运行：

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\package-android-release.ps1 -Version 2.1.15
   ```

7. 检查 `artifacts/` 中是否生成：
   - `CX-Codex-<version>.zip`
   - `CX-Codex-<version>.sha256`
   - `cx-codex-android-<version>.apk`
   - `cx-codex-android-<version>.apk.sha256`

8. 校验最终发布资产 checksum：

   ```powershell
   npm.cmd run verify:release-artifacts -- -OutputDir artifacts
   ```

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
5. 校验 zip / APK 与 `.sha256`
6. 发布 GitHub Release

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
