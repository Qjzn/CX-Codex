# CX-Codex Release

Self-hosted OpenAI Codex Web UI and Android client bridge.

This release is built from the tagged source in this repository. It is intended for Windows, Android, LAN, and self-hosted remote access deployments.

## Upgrade Notes

- Read [docs/changelog.zh-CN.md](./docs/changelog.zh-CN.md) for the user-facing changes in this release.
- Review [docs/security-hardening.zh-CN.md](./docs/security-hardening.zh-CN.md) before exposing the service beyond localhost or LAN.
- Review [docs/openai-docs-review.zh-CN.md](./docs/openai-docs-review.zh-CN.md) and [docs/app-server-protocol-matrix.zh-CN.md](./docs/app-server-protocol-matrix.zh-CN.md) for Codex App Server / OpenAI API compatibility notes.
- Review [docs/candidate-release-review.zh-CN.md](./docs/candidate-release-review.zh-CN.md) before treating schema drift, MCP/plugin, WebSocket, Realtime, filesystem, terminal, or permission-profile capabilities as stable.
- If Android assets include a debug APK instead of a signed release APK, the repository has not configured Android signing secrets for this run.

## Assets

- `CX-Codex-<tag>.zip`: source, docs, scripts, and built Web / CLI assets for self-hosted deployment and audit.
- `CX-Codex-<tag>.sha256`: checksum for the release zip.
- `cx-codex-android-<tag>.apk`: signed Android APK, when signing secrets are configured.
- `cx-codex-android-debug-<tag>.apk`: debug APK fallback for self-hosted testing when signing secrets are not configured.
- `*.sha256`: checksum files for each uploaded zip or APK asset.

## Verification

The release workflow runs:

- `npm run verify:release -- -RequireCleanGit -SchemaAudit skip`
- `npm run package:release -- -Version <tag> -OutputDir <release-dir>`
- Android sync and APK build
- `npm run verify:release-artifacts -- -OutputDir <release-dir>`

Maintainers should also run a local schema audit before final release when App Server or OpenAI API behavior changed:

```powershell
npm.cmd run verify:release -- -RequireCleanGit -SchemaAudit warn
```

If the local gate completes with schema drift warnings, this release should be described as candidate-reviewed rather than fully aligned with the latest Codex App Server schema.

## Quick Install

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force; irm https://raw.githubusercontent.com/Qjzn/CX-Codex/main/scripts/bootstrap-windows.ps1 | iex
```

## Android Notes

On first launch, enter your own CX-Codex service URL. The Android app does not ship with a private server address.

If you previously installed a debug APK and this release provides a signed APK, Android may require uninstalling the debug build before installing the signed build.

## Privacy

Release notes, docs, and screenshots must not include private accounts, passwords, tokens, private IPs, personal paths, real public tunnel URLs, or private conversation content.
