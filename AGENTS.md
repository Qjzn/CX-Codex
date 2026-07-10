# AGENTS.md

## "Push to main or commit to main" Means Merge To Local Main

- When the user says "push", interpret it as: merge the current work into local `main`
- Do not push to any remote unless the user explicitly asks to push to a remote.

## Merge to local main flow for worktree:

0. In the main worktree, **always stash first** before merge/rebase operations.
   - `git stash push -u -m "temp-before-merge-<your-branch>"`
   - After merge completes, restore with `git stash pop`.

1. In the worktree, commit changes and create a branch.
   - `git add -A && git commit -m "<message>"`
   - `git switch -c <your-branch>`
2. If the user asks for a **single merge commit**, do this exact sequence in the main worktree:
   - find pre-merge `main` from reflog (example: `git reflog main`)
   - `git checkout main`
   - `git reset --hard <pre-merge-main-commit>`
   - `git checkout <your-branch>`
   - `git rebase main`
   - `git checkout main`
   - `git merge --no-ff <your-branch> -m "Merge branch '<your-branch>' into main"`
3. Otherwise, merge into local `main` from the main worktree:
   - `git checkout <your-branch>`
   - `git rebase main`
   - `git checkout main`
   - `git merge --no-ff <your-branch>`

## package.json Version Conflict Rule

- For merge conflicts in `package.json` that only affect the `"version"` field, always ignore the conflict and keep the stashed/local `package.json` version value.
- Do not block merge completion on `package.json` version-only conflicts.
- For any merge/rebase conflict involving `package.json`, always resolve by taking the current local/stashed `package.json` entirely (full file replacement), then continue merge.

## Commit After Each Task

- Always create a commit after completing each discrete task or sub-task.
- Do not batch multiple tasks into a single commit.
- Each commit message should describe the specific change made.

## Tests Documentation Rule (MANDATORY)

- After every feature implementation, update `tests.md` in the repository root.
- Add a new section describing how to test the feature manually.
- Each test section must include:
  - feature/change name
  - prerequisites/setup
  - exact step-by-step actions
  - expected result(s)
  - rollback/cleanup notes (if applicable)
- Keep existing test cases; append or update only what is needed for the new feature.
- Do not mark a feature task complete until `tests.md` is updated.

## Completion Verification Requirement (MANDATORY)

- Test changes before reporting completion when feasible.
- Run Playwright verification only when the user explicitly asks for Playwright/browser automation testing.
- If a change affects package/runtime/module loading behavior, also run a CJS smoke test before completion.
- CJS smoke test requirement:
  1. Build the project/artifact first (if needed).
  2. Run a Node `require(...)` check against the changed entry (or closest public CJS entry).
  3. Confirm the module loads without runtime errors and expected exported symbol(s) exist.
  4. Include the exact CJS command and result summary in the completion report.
- For Playwright automation scripts, CJS (`const { chromium } = require('playwright')`) is the default style unless ESM is explicitly required.
- Preferred Playwright verification pattern for chat parsing changes (when Playwright is requested):
  - send a message with a unique marker (for selecting the correct rendered row)
  - include mixed content in one message (for example: plain text, `**bold**`, and `` `code` ``)
  - inspect row HTML and count expected rendered nodes (for example `strong.message-bold-text`)
  - save screenshot to `output/playwright/<task-name>.png`
- Playwright test sequence (when Playwright is requested):
  1. Start or confirm a single dev server instance (`npm run dev -- --host 0.0.0.0 --port 4173`).
  2. If there are stale servers on the same port, stop them first to avoid false test results.
  3. Run Playwright CLI against `http://127.0.0.1:4173` (or required test URL) and exercise the changed flow.
  4. For responsive/mobile changes, run checks at 375x812 and 768x1024.
  5. Wait 2-3 seconds before capturing final screenshot(s).
  6. Save screenshots under `output/playwright/` with task-specific names.
- Capture screenshots only when Playwright verification is requested.
- If the dev server fails to start due to pre-existing errors, fix them first or work around them before testing.
- If requested Playwright assertions fail, do not report completion; fix and re-run until passing.

## Browser Automation: Prefer Playwright CLI Over Cursor Browser Tool

- For all browser interactions (navigation, clicking, typing, screenshots, snapshots), prefer the Playwright CLI skill in headless mode over the Cursor IDE browser MCP tool.
- Do not run Playwright for routine task completion unless the user explicitly asks for it.
- Playwright CLI is faster, more reliable, and works in headless environments without a desktop.
- Use headless mode by default; only add `--headed` when a live visual check is explicitly needed.
- Skill location: `~/.codex/skills/playwright/SKILL.md` (wrapper script: `~/.codex/skills/playwright/scripts/playwright_cli.sh`).
- Minimum reporting format in completion messages:
  - tested URL
  - viewport(s)
  - assertion/result summary
  - screenshot absolute path(s)
  - CJS command/result (when module-loading behavior was changed)

## NPX Testing Rule

- For any `npx` package behavior test, **publish first**, then test the published `@latest` package.
- Do not rely on local unpublished changes when validating `npx` behavior.
- Run `npx` validation on the Oracle host (not local machine) unless user explicitly asks otherwise.
- For Playwright verification of `npx` behavior, use the Oracle host Tailscale URL (for example `http://100.127.77.25:<port>`) instead of `localhost`.

## A1 Playwright Verification (From Mac via Tailscale)

- Use this flow when validating UI behavior on Oracle A1 from the local Mac machine.
- On A1, start the app server with Codex CLI available in `PATH`:
  - `export PATH="$HOME/.npm-global/bin:$PATH"`
  - `npm run dev -- --host 0.0.0.0 --port 4173`
- From Mac, run Playwright against Tailscale URL (`http://100.127.77.25:4173`), not localhost.
- Verify success with both checks:
  - UI assertion in Playwright (new project/folder appears in sidebar or selector).
  - Filesystem assertion on A1 (`test -d /home/ubuntu/<project-name>`).
- Save screenshot artifact under `output/playwright/` and include it in the report.
