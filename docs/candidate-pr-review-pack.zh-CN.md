# Candidate Branch / PR Review Pack

生成时间：2026-07-05 10:38 Asia/Shanghai。

本文用于把当前候选分支整理成可审查、可发 PR、可准备候选发布的 review pack。它不替代正式 Release Notes；它是维护者审查入口和 PR 描述草稿。

## 分支快照

- 候选分支：`codex/candidate-release-review`
- 对比基线：`origin/main`
- 提交数量：以 `git rev-list --count origin/main..HEAD` 为准；本 review pack 创建时为 211。
- 变更规模：以 `git diff --shortstat origin/main..HEAD` 为准；本 review pack 创建时为 157 files changed，33533 insertions，6416 deletions。
- 首个候选提交：`c11af9b Add App Server schema audit workflow`
- 当前 review pack 提交：`a1f5e20 docs-add-candidate-pr-review-pack`
- 当前状态：适合进入 candidate PR / review pack；不建议直接宣称最终公开稳定版。

主题统计：

| 主题 | 提交数 |
| --- | ---: |
| App Server / protocol / runtime | 111 |
| Release / CI / smoke / governance | 41 |
| Frontend / client compatibility | 10 |
| Refactor extraction | 16 |
| Docs / security / governance | 8 |

## PR 标题草稿

```text
Prepare CX-Codex candidate release review and App Server governance
```

## PR 正文草稿

```markdown
## Summary

This candidate branch prepares CX-Codex for release review rather than declaring a final stable release.

It adds App Server schema drift governance, OpenAI official docs review, release/governance gates, server module smoke coverage, candidate release review docs, and conservative public-claims boundaries for App Server, MCP/plugin, WebSocket, Realtime, filesystem, terminal, and permission-profile capabilities.

## What Changed

- Added Codex App Server schema audit workflow, committed drift summary, protocol compatibility matrix, and candidate release review.
- Migrated optional speech-to-text integration toward the official OpenAI audio transcription API with diarize parameter normalization and redacted diagnostics.
- Split the Codex bridge and App Server runtime into smaller modules for process handling, request routing, notifications, runtime reconciliation, JSON-RPC writing, route dispatch, middleware state, and cleanup.
- Added release gates for governance docs, frontend normalizer smoke, server module smoke, CLI CJS launcher smoke, release package smoke, checksum smoke, and npm package dry-run smoke.
- Added or tightened SECURITY, SUPPORT, CONTRIBUTING, Issue/PR templates, Dependabot, release body, and release/manual documentation.
- Clarified that current App Server schema status is `drift-recorded`, not fully aligned with the latest App Server schema.

## Release Gate Evidence

- `npm.cmd run verify:release -- -RequireCleanGit -SchemaAudit warn` passed on a clean worktree.
- Latest schema audit output: `output/app-server-schema-audit/20260705-103138`.
- Expected non-blocking warning: App Server schema drift was found in warn mode and requires review before final release.
- Existing non-blocking warning: Vite large chunk warning.

## Schema Drift Summary

| Group | Baseline | Generated | Added | Removed |
| --- | ---: | ---: | ---: | ---: |
| TypeScript root | 236 | 77 | 15 | 174 |
| TypeScript v2 | 199 | 445 | 260 | 14 |
| JSON root | 37 | 35 | 5 | 7 |
| JSON v2 | 102 | 202 | 110 | 10 |

## Public Claims Boundary

Can claim:

- Self-hosted OpenAI Codex Web UI and Android client bridge.
- Windows / Android / LAN / self-hosted remote access workflows.
- Local stdio JSONL App Server bridge for core thread and turn flows.
- Optional official OpenAI speech-to-text API integration.
- Release/governance gate coverage and schema drift tracking.

Do not claim:

- Full latest Codex App Server alignment.
- Stable App Server WebSocket remote transport.
- Stable App Server Realtime audio/transcript/sdp support.
- Complete plugin marketplace lifecycle.
- Default filesystem write/remove/watch UI.
- Interactive terminal stream support.
- Complete permission-profile or guardian-review management.

## Verification

- [x] `git diff --check`
- [x] `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`
- [x] `npm.cmd run verify:release -- -RequireCleanGit -SchemaAudit warn`

## Review Notes

Treat this as a candidate branch. If published, release notes should say candidate-reviewed / drift-recorded, not fully aligned.
```

## 候选发布说明草稿

```markdown
# CX-Codex Candidate Release

This candidate release focuses on making CX-Codex reviewable and maintainable as a self-hosted OpenAI Codex Web UI and Android client bridge.

Highlights:

- App Server schema drift is now audited and documented.
- Release verification now covers governance docs, frontend normalizers, server modules, CLI loading, release package contents, checksums, and npm package contents.
- Optional OpenAI speech-to-text integration follows official transcription API constraints, including diarize response format and chunking behavior.
- App Server bridge internals were split into smaller modules with smoke coverage.
- Public documentation now separates stable capabilities from experimental, read-only diagnostic, and incomplete App Server surfaces.

Known review items:

- Current App Server status is `drift-recorded`, not fully aligned.
- App Server WebSocket, Realtime, filesystem write/remove/watch, interactive terminal streams, plugin marketplace lifecycle, and permission-profile management are not stable public capabilities.
- Vite still reports a large chunk warning.
```

## Review Checklist

- [ ] Confirm PR targets the intended upstream branch.
- [ ] Confirm branch name is `codex/candidate-release-review`.
- [ ] Confirm `git diff --shortstat origin/main..HEAD` matches the expected large candidate branch scale.
- [ ] Confirm `README.md` does not claim full latest App Server alignment.
- [ ] Confirm `.github/release-body.md` links candidate review and says schema drift means candidate-reviewed rather than fully aligned.
- [ ] Confirm `RELEASE.md` requires `verify:release -- -RequireCleanGit -SchemaAudit warn` before final release.
- [ ] Confirm `SECURITY.md` says App Server WebSocket transport is experimental / unsupported and requires auth or controlled network boundaries.
- [ ] Confirm `docs/candidate-release-review.zh-CN.md` includes P0/P1/P2 boundaries.
- [ ] Confirm `tests.md` includes candidate branch / PR review pack manual verification steps.
- [ ] Confirm raw `output/app-server-schema-audit/` generated directories are not committed.

## Schema Drift Issue List

### P0 Stability Protection

Suggested issue title:

```text
P0: Preserve App Server drift tolerance across unknown notifications, items, status, and cache invalidation
```

Acceptance checklist:

- Unknown notification, unknown thread item, unknown turn item, and unknown status do not crash or blank the UI.
- Thread/read, list/search, runtime snapshot, and notification replay invalidation still work after write-like RPCs.
- Permission, approval, guardian, network, and fs-related drift stays conservative by default.
- Release gate keeps governance, frontend normalizer, server module, release package, and npm package smoke coverage.

### P1 Protocol Capability Completion

Suggested issue title:

```text
P1: Design controlled support for ThreadInjectItems, ThreadShellCommand, metadata, unsubscribe, steer, MCP, plugin, hook, model, and sandbox readiness drift
```

Acceptance checklist:

- `ThreadInjectItems*` and `ThreadShellCommand*` have explicit UI fallback, permission, failure, and rollback semantics.
- `ThreadMetadataUpdate*`, `ThreadUnsubscribe*`, `TurnSteer*`, goal/status, and thread source/status changes have product semantics.
- MCP elicitation/resource/tool status and plugin/app/marketplace surfaces are first exposed as read-only or clearly confirmed actions.
- Hook/model/Windows sandbox readiness diagnostics remain read-only unless a separate approval design exists.

### P2 Security-Sensitive Capability Design

Suggested issue title:

```text
P2: Define security design before exposing App Server filesystem, terminal, permission profile, guardian, WebSocket, or sandbox setup operations
```

Acceptance checklist:

- fs read/write/copy/remove/watch/unwatch/metadata/directory is bound to workspace boundaries, path redaction, user confirmation, and rollback notes.
- process/terminal stream/write/resize/terminate has an explicit interactive terminal UI and command approval boundary.
- permission profile and guardian review operations require explicit confirmation and audit logging.
- App Server WebSocket remote transport requires official auth or controlled network boundaries.
- Windows sandbox setup/start is never automatic in the background.

## 本地 Main 合并准备

当前本地 `main` 已包含候选分支创建前的 210 个提交；本分支是在该快照上创建的 candidate branch。若后续要把候选分支合回本地 `main`，按仓库规则执行：

1. 在主 worktree 先 stash：

   ```powershell
   git stash push -u -m "temp-before-merge-codex-candidate-release-review"
   ```

2. 切回 `main` 并合并：

   ```powershell
   git checkout main
   git merge --no-ff codex/candidate-release-review
   ```

3. 恢复 stash：

   ```powershell
   git stash pop
   ```

如果要走 GitHub PR，建议先推送候选分支，再使用上方 PR 正文草稿。不要把 `output/app-server-schema-audit/` 原始生成目录提交进 PR。

纯文本校验句：不要把 output/app-server-schema-audit/ 原始生成目录提交进 PR。

## 远程 PR 准备命令

以下命令仅作为维护者手动执行清单；本 review pack 不代表已经推送远程分支或创建 GitHub PR。

推送候选分支：

```powershell
git push -u origin codex/candidate-release-review
```

创建 PR 时，复制本文“PR 正文草稿”部分作为正文；如果使用 GitHub CLI，可先把正文整理到临时文件再执行：

```powershell
gh pr create --base main --head codex/candidate-release-review --title "Prepare CX-Codex candidate release review and App Server governance" --body-file <pr-body.md>
```

远程 PR 创建前最后确认：

- `git status --short --branch` 是 clean。
- `npm.cmd run verify:release -- -RequireCleanGit -SchemaAudit warn` 已在维护者机器跑通或明确记录最新一次 warn 输出。
- Release 正文只描述 candidate-reviewed / drift-recorded，不宣称 fully aligned。
