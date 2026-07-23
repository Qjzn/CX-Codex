# CX-Codex Repository Guidance

This is the active 7420 / CX-Codex source repository. Inherit global and workspace rules; keep this file limited to repository-specific commands and safety boundaries.

## Change boundaries

- Preserve existing dirty worktree changes. Do not stash, reset, switch branches, commit, merge, push, publish, or deploy unless the user requests that Git/release action.
- Resolve conflicts per changed hunk and preserve valid changes from both sides. Never replace an entire `package.json` merely to settle a version conflict.
- Match the current Vue/TypeScript structure and keep fixes surgical. Read `PRODUCT.md`, `PROJECT_SPEC.md`, theme/global styles, and representative components only when the task needs them.
- Update `tests.md` when a feature's user-visible behavior or manual verification contract changes; do not append boilerplate for documentation-only or trivial internal edits.

## Verification

- Frontend/type changes: run `npm run build:frontend` or a narrower relevant verifier.
- CLI/server-module changes: run `npm run build:cli` plus `npm run verify:server-modules` when applicable.
- 7420 regressions: choose the smallest relevant command from `npm run test:7420`, `npm run test:7420:frontend`, `npm run test:7420:sidebar-data`, and `npm run verify:frontend-normalizers`.
- Use the inherited browser-routing rule. Run Playwright only for explicit Playwright engineering; use ordinary browser smoke verification for important UI changes when feasible.
- Report the exact checks run and distinguish pre-existing failures from failures caused by the change.

## Release boundary

- `npm run package:release`, `npm publish`, remote-host validation, Android packaging, and any remote push/deploy require an explicit user request.
- Validate local unpublished package behavior locally unless the user specifically requests a published-package or remote-host test.
