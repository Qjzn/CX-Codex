# CX-Codex Repository Guidance

This is the active 7420 / CX-Codex source repository. Inherit global and workspace rules; keep this file limited to repository-specific commands and safety boundaries.

## Active product goal

- Read `PRODUCT_GOAL.md` before selecting or implementing product work. Its priority order, scope boundaries, completion gates, and blocker protocol are the durable definition of the current CX-Codex steady-state productization goal.
- Keep `PRODUCT.md` focused on timeless product character and `PROJECT_SPEC.md` focused on verified implementation facts. Do not duplicate or silently weaken the active goal in feature plans.
- Do not mark the product goal complete while any mandatory gate in `PRODUCT_GOAL.md` is unverified or blocked.

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

- `beta` is the integration branch for local product changes and candidate verification. `main` is the stable branch and accepts product changes only by merging a verified `beta` candidate.
- Push ordinary candidate work to `beta`; do not create an official version tag there. Create `vX.Y.Z` or `X.Y.Z` only from a commit already reachable from `origin/main` after every mandatory `PRODUCT_GOAL.md` gate passes.
- `npm run package:release`, `npm publish`, remote-host validation, Android packaging, and any remote push/deploy require an explicit user request.
- Validate local unpublished package behavior locally unless the user specifically requests a published-package or remote-host test.
