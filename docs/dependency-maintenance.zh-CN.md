# 依赖维护手册

本项目长期维护依赖更新时，优先保证 `CX-Codex` 的自托管部署、Codex App Server 兼容、Android 壳和发布包可验证。依赖更新默认通过 `.github/dependabot.yml` 生成 PR；人工升级只用于明确的安全修复、官方协议适配或阻塞构建的问题。

## 更新范围

Dependabot 当前覆盖：

- `npm`：前端、CLI、服务端 bridge、构建和测试脚本依赖。
- `github-actions`：CI、Release 和打包流水线依赖。

人工维护时按影响面分类：

- `runtime`：会影响 7420 服务、Codex App Server bridge、语音转写、权限策略或诊断接口。
- `frontend`：会影响 Vue UI、移动端布局、消息渲染、图片/文件预览或状态同步。
- `build`：会影响 Vite、TypeScript、tsup、脚本、打包或发布包内容。
- `mobile`：会影响 Capacitor、Android WebView 壳、APK 生成或移动端桥接。
- `ci`：会影响 GitHub Actions、release workflow、artifact 上传或 checksum 生成。

## PR 审查步骤

1. 阅读 PR 变更范围，确认是否来自 `.github/dependabot.yml`，并检查 lockfile 是否只包含预期依赖树变化。
2. 查看上游 release notes 或 changelog，标记 breaking change、Node 版本要求、默认行为变化和安全修复。
3. 按影响面选择验证命令：
   - 通用治理和发布门禁：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`
   - 纯治理文档：`npm.cmd run verify:governance`
   - 服务端模块或 App Server bridge：`npm.cmd run verify:server-modules`
   - Android/Capacitor 相关：`npm.cmd run mobile:android:sync`，必要时再执行 Android 构建。
   - Codex App Server 协议、schema 或 OpenAI 官方 API 行为相关：`npm.cmd run audit:app-server-schemas`；如差异变化，再运行 `npm.cmd run audit:app-server-schemas:update-summary` 更新脱敏的 `docs/app-server-schema-audit-summary.json`，并记录为什么暂不更新基线。
4. 如果更新会改变 CLI 入口、CJS 加载、发布包内容、前端 App Server normalizer 或运行时模块加载，必须保留 release gate 的 frontend normalizer smoke、CLI CJS launcher smoke 和 Release package smoke。
5. 在 PR 描述中写清楚：更新类型、风险、验证命令、是否影响 Android、是否影响 Codex App Server 协议或 OpenAI API。

## 合并策略

- minor / patch 更新可以在验证通过后合并，但不要绕过 release gate。
- major 更新不自动合并；必须先单独审查 breaking change，并优先拆成最小可回滚 PR。
- 安全更新优先处理，但仍要跑最小相关验证；如果只能临时缓解，需在 PR 中写明剩余风险。
- GitHub Actions 更新必须确认 release workflow 仍能调用 `scripts/verify-release.ps1`，并且 artifact 清单没有丢失治理文件。
- 不要把依赖更新和无关 UI 重构、功能开发、格式化大改混在同一个 PR。

## 回滚和排障

- 依赖更新导致构建失败时，先定位是哪一个生态或包引入变化，再回退该 PR；不要整体回退无关治理文件。
- 发布包内容缺失时，检查 `scripts/package-release.ps1` 和 `scripts/verify-release.ps1` 的 release package smoke。
- App Server 协议或 OpenAI API 行为变化时，以官方文档和 schema audit 结果为准，更新兼容矩阵和测试记录后再合并。
- Android 构建失败时，先确认 Capacitor 同步产物和本机 Java/Android SDK 环境，再判断是否为依赖问题。

## 维护记录

每次人工依赖升级或 Dependabot PR 合并后，应在 PR 中保留验证结果。若更新影响用户部署、移动端、协议兼容或安全策略，还需要同步更新：

- `docs/changelog.zh-CN.md`
- `tests.md`
- `RELEASE.md` 或相关安装/排障文档
- `docs/app-server-protocol-matrix.zh-CN.md` 或 `docs/security-hardening.zh-CN.md`，如果变更触及对应领域
