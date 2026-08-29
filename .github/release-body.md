# CX-Codex Release

Self-hosted OpenAI Codex Web UI and Android client bridge.

This release is built from the tagged source in this repository. It is intended for Windows, Android, LAN, and self-hosted remote access deployments.

## Upgrade Notes

- Read [docs/changelog.zh-CN.md](./docs/changelog.zh-CN.md) for the user-facing changes in this release.
- Review [docs/security-hardening.zh-CN.md](./docs/security-hardening.zh-CN.md) before exposing the service beyond localhost or LAN.
- Use [PRODUCT_GOAL.md](./PRODUCT_GOAL.md), [docs/app-server-protocol-matrix.zh-CN.md](./docs/app-server-protocol-matrix.zh-CN.md), and [docs/app-server-schema-audit-summary.json](./docs/app-server-schema-audit-summary.json) as the current release-claim authority.
- Review [docs/openai-docs-review.zh-CN.md](./docs/openai-docs-review.zh-CN.md) for OpenAI API compatibility notes.
- [docs/candidate-release-review.zh-CN.md](./docs/candidate-release-review.zh-CN.md) and [docs/candidate-pr-review-pack.zh-CN.md](./docs/candidate-pr-review-pack.zh-CN.md) are retained for historical traceability only; their dated branch and release facts are not current evidence.
- Android assets are published only after the stable official signing certificate passes the release fingerprint gate.

## Assets

- `CX-Codex-<tag>.zip`: source, docs, scripts, and built Web / CLI assets for self-hosted deployment and audit.
- `CX-Codex-<tag>.sha256`: checksum for the release zip.
- `cx-codex-android-<tag>.apk`: Android APK signed with the stable official release certificate.
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

Official signed releases can update earlier official signed releases in place. Development builds use a separate application id and do not replace the official app.

Deep-Doze FCM wake is optional and is not enabled by source support alone. The default release workflow does not bundle a project-specific `google-services.json` or server service-account credential. Self-hosters must configure matching Android/server Firebase projects, rebuild the APK, and pass `npm run verify:mobile-push-readiness -- --require-ready` with a real registered device and active task before calling this channel ready. Foreground service, SSE, bounded polling, network recovery, and manual refresh remain available without Firebase.

## Privacy

Release notes, docs, and screenshots must not include private accounts, passwords, tokens, private IPs, personal paths, real public tunnel URLs, or private conversation content.
