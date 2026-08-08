# 发版说明

本仓库使用 GitHub Release 作为主发版方式。版本号统一采用纯数字语义版本：

- `2.1`
- `2.1.1`
- `2.1.15`
- `2.2.0`

以后不要再使用 `bridge`、`beta`、`rc` 等英文后缀；补丁修复走 `2.1.x`，较大功能收口走 `2.2.0`。

## 分支职责

- `beta` 是测试/集成分支，承接本地功能、修复和候选版本提交；每次推送都必须运行 CI，但不会自动产生正式 GitHub Release。
- `main` 是正式稳定分支，不直接接收日常开发提交；只有 `beta` 候选通过 `PRODUCT_GOAL.md` 的全部强制门槛和正式发布检查后，才通过 PR 合并到 `main`。
- 正式标签只允许使用 `vX.Y.Z` 或 `X.Y.Z`，并且必须指向已属于 `origin/main` 的提交。`beta`、`rc` 等候选状态使用分支和 CI 表达，不创建会触发正式 Release 的版本标签。

标准流转顺序为：本地改动 -> `beta` -> CI 与候选验证 -> `beta` 合并到 `main` -> 正式标签 -> GitHub Release。任何设备、安全或发布门槛未完成时，候选可以继续留在 `beta`，但不能合并到 `main` 或创建正式标签。

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

   该命令会执行治理文档检查、前端/CLI 构建、frontend normalizer smoke、server module smoke、CLI help smoke、CLI CJS launcher smoke、Release package smoke 和 NPM package smoke。
   - `-SchemaAudit warn` 会生成最新 App Server schema 审计摘要；如果发现 drift，命令继续完成但必须人工审计。
   - 已准备更新 schema 基线并要求严格阻断时，改用 `-SchemaAudit strict`。
   - 快速本地预检可用 `-SchemaAudit skip`，但不能作为最终发版证据。
   - Release package smoke 会生成 zip 与 sha256，并检查源码包内的 README、治理文档、测试手册、GitHub 模板、workflow、前端构建产物和 CLI 入口。
   - NPM package smoke 会执行 `npm pack --dry-run --json`，确认 npm 运行包只包含 Web/CLI 运行产物和必要文档，不携带源码、治理脚本或手工测试手册。
   - 只验证脚本路径或排查构建问题时，可临时加 `-SkipPackageSmoke`；正式发版验证不要跳过，因为它会同时跳过 Release package smoke 和 NPM package smoke。
   - `verify:release` 的治理门禁会校验 `docs/app-server-schema-audit-summary.json` 的结构；正式发版前如果重新审计发现计数变化，必须同步更新该摘要和 `docs/app-server-protocol-matrix.zh-CN.md`。
   - 如果 `warn` 模式完成但输出 schema drift warning，本次只能视为 candidate-reviewed；正式宣传前必须以 [PRODUCT_GOAL.md](./PRODUCT_GOAL.md)、[当前 App Server 协议矩阵](./docs/app-server-protocol-matrix.zh-CN.md) 和 [当前 schema 审计摘要](./docs/app-server-schema-audit-summary.json) 明确哪些能力可公开宣传，哪些仍是实验、只读诊断或未完成。
   - GitHub Actions Release workflow 默认执行 `-SchemaAudit skip`，因为 runner 不保证安装 Codex CLI；正式发版前应在维护者机器运行 `warn` 或 `strict` 并记录摘要。
   - 本地 `npm.cmd run verify:release` 会自动选择可用的 PowerShell：优先探测 `pwsh`，不可用、失败或挂起时回退到 Windows PowerShell，并把选中的命令复用于 release gate 内部调用。
   - CI / Release workflow 仍直接使用 GitHub runner 提供的 `pwsh` 调用 `.ps1` 脚本；本地 npm 脚本用于提升 Windows 机器上的验证稳定性。

4. 安全边界复核：

   - 对照 [docs/security-hardening.zh-CN.md](./docs/security-hardening.zh-CN.md) 检查默认绑定地址、密码、远程访问、App Server transport、权限确认、语音转写 API key、日志和截图。
   - 对照 [PRODUCT_GOAL.md](./PRODUCT_GOAL.md)、[docs/app-server-protocol-matrix.zh-CN.md](./docs/app-server-protocol-matrix.zh-CN.md) 和 [docs/app-server-schema-audit-summary.json](./docs/app-server-schema-audit-summary.json) 检查 README、Release 正文和安全声明，避免宣称完全对齐最新 App Server、完整插件市场、稳定 Realtime、默认文件系统写入或交互式终端能力。
   - [Candidate release review](./docs/candidate-release-review.zh-CN.md) 与 [Candidate PR review pack](./docs/candidate-pr-review-pack.zh-CN.md) 是 2026-07-05 的历史快照；历史审查材料只用于追溯，不能替代当前发布事实源。
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

候选开发阶段推送 `beta`：

```powershell
git push origin beta
```

全部强制门槛通过后，将 `beta` 通过 PR 合并到 `main`。在最新 `main` 上重新运行正式发布检查，再推送正式标签：

```powershell
git switch main
git pull --ff-only origin main
npm.cmd run verify:release -- -RequireCleanGit -SchemaAudit warn
git tag v2.1.15
git push origin v2.1.15
```

Release 工作流会自动完成：

1. 安装依赖
2. 构建项目
3. 打包 zip 与 sha256
4. 如果仓库配置了 Android 签名 secrets，构建并上传 APK
5. 校验 zip / APK 与 `.sha256`
6. 发布 GitHub Release

## Android 正式签名密钥运维

- 正式签名只通过 GitHub Actions Secrets 提供：`ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS` 和 `ANDROID_KEY_PASSWORD`。不要把 keystore、密码、Base64 内容或可还原片段写入提交、Issue、Release、日志或构建产物。
- 日常只轮换密码时，保留原 keystore 与签名证书，原子更新四个 Secrets，并先用候选 Tag 验证 Release workflow、APK SHA-256、包名、版本号和 `apksigner verify --print-certs` 的证书 SHA-256。
- 更换 keystore 或签名证书会影响 Android 覆盖升级。除非证书已泄露、失效或平台迁移明确要求，否则不要更换签名证书；必须更换时，要在发布说明中明确旧版无法直接覆盖升级及迁移路径。
- 怀疑密钥泄露时，立即停止打新 Tag，删除或覆盖仓库中的四个签名 Secrets，使 Release workflow 在签名准备阶段阻断；清理已公开的敏感内容，轮换相关仓库访问凭据，并按 `SECURITY.md` 记录脱敏事件时间线。
- 轮换或恢复后，使用新的候选 Tag 重跑正式签名流程；只有固定证书指纹、正式 APK、对应 `.sha256` 和公开下载复核全部通过，才恢复稳定发布。受影响的旧 Release 应标记撤回或预发布，并指向安全替代版本。
- keystore 的离线备份、恢复权限和失效处置由维护者在仓库外管理。GitHub Secrets 只保存 CI 所需副本，不能作为唯一备份或证书恢复来源。

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
- Release workflow 会校验标签、`package.json` 与 `docs/release-notes-<version>.zh-CN.md` 一致，并使用对应版本说明作为正文；`.github/release-body.md` 保留为通用模板与审查基线。
- 每次发版前优先参考 `docs/release-template.zh-CN.md`，先整理用户可感知变化，再发布。
- 公开截图必须使用脱敏演示数据，不能包含真实路径、密钥、账号、公网地址或私人会话。
