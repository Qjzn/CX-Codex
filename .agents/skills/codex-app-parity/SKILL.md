---
name: "codex-app-parity"
description: "Use when implementing or changing user-visible behavior/UI in this repository and parity with the installed Codex desktop app must be validated before coding."
---

# Codex App Parity Skill

Use this skill for any feature work or user-visible behavior/UI change in this repository.
Do not use it for purely internal refactors that do not affect behavior.

## Objective

Ensure behavior is implemented with Codex.app as the source of truth, then verified with headless Playwright and screenshots.

## Project Instructions

## Codex.app-First Development Policy

For every **new feature** and every **behavior/UI change**, treat the installed desktop app as the source of truth:

- App path: `/Applications/Codex.app`
- Primary bundle to inspect: `/Applications/Codex.app/Contents/Resources/app.asar`

Do not implement first and compare later. Compare first, then implement.

## How to Search for Features in Codex.app

### Extraction

Extract the app bundle once (reuse if already extracted):

```bash
mkdir -p /tmp/codex-app-extracted
npx asar extract "/Applications/Codex.app/Contents/Resources/app.asar" /tmp/codex-app-extracted
```

On this Windows workspace, locate the active package from the running `Codex` process, then extract its ASAR from `C:\Program Files\WindowsApps\OpenAI.Codex_*\app\resources\app.asar`. If the shell resolves an obsolete global npm/npx, invoke the Node 22 npm CLI directly and run `npm exec --package=@electron/asar -- asar extract ...`.

### Key Directories

| Directory | Contents |
|-----------|----------|
| `/tmp/codex-app-extracted/webview/assets/` | Main frontend bundle (`index-*.js`) + locale files |
| `/tmp/codex-app-extracted/.vite/build/` | Electron main process (`main.js`, `main-*.js`, `preload.js`, `worker.js`) |
| `/tmp/codex-app-extracted/package.json` | App metadata, version, entry point |

### Searching the Minified Bundle

The main UI bundle is a single large minified JS file at `webview/assets/index-*.js`. Use Python to search since `grep -o` with large repeat counts fails on macOS:

```python
python3 -c "
with open('/tmp/codex-app-extracted/webview/assets/index-<hash>.js', 'r') as f:
    content = f.read()
idx = content.find('YOUR_SEARCH_TERM')
if idx >= 0:
    print(content[max(0, idx-200):idx+500])
"
```

### What to Search For

1. **i18n keys**: Search locale files (`webview/assets/zh-TW-*.js`, `webview/assets/en-*.js`, etc.) for human-readable labels. Keys follow the pattern `component.feature.property` (e.g., `composer.dictation.tooltip`).

2. **Component functions**: Minified React components follow patterns like `function X4n({prop1:t,prop2:e,...})`. Search for the feature's i18n key to find the component that renders it.

3. **API calls and endpoints**: Search main process files (`.vite/build/main-*.js`) for endpoint URLs, auth handling, and IPC channels. Key patterns:
   - `prodApiBaseUrl` → production API base (e.g., `https://chatgpt.com/backend-api`)
   - `devApiBaseUrl` → dev API base (e.g., `http://localhost:8000/api`)
   - `fetch-request` / `fetch-response` → IPC-proxied HTTP calls from renderer to main process

4. **Icon names**: Search for icon imports like `audiowave-dark.svg`, `book-open-dark.svg`. Icon mapping is in the main bundle around the `Hwn=Object.assign({` pattern.

5. **Keyboard shortcuts**: Search for `CmdOrCtrl+`, `Cmd+`, `keydown`, `keyCode`, or specific key names.

### Search Strategy

1. Start with **i18n locale files** — they have human-readable labels that identify features.
2. Use the i18n key to find the **component** in the main bundle.
3. Trace the component to find **hooks/composables**, **API calls**, and **event handlers**.
4. Check the **main process** bundle for any server-side proxying or Electron IPC handling.

### Architecture Notes

- **Renderer → Main Process**: The renderer uses a `Uu` HTTP client class that sends `fetch-request` IPC messages to the main process. The main process class `tle` handles these, adds auth tokens, and uses `electron.net.fetch` to make actual HTTP calls.
- **Auth**: Auth tokens come from the app-server's `getAuthStatus` RPC method (ChatGPT backend auth).
- **App-server**: A `codex app-server` child process communicating via JSON-RPC over stdin/stdout. Our bridge middleware proxies RPC calls to it.
- **Config constants**: `R7` = prodApiBaseUrl (`https://chatgpt.com/backend-api`), `I7` = devApiBaseUrl (`http://localhost:8000/api`), `C7` = originator (`Codex Desktop`).

## Required Workflow (Feature Work)

1. Identify target behavior:
- Restate what behavior is being added/changed.
- Define whether it is: data mapping, runtime event handling, UX text, visual treatment, interaction model, or all of these.

2. Inspect Codex.app before coding:
- Locate the implementation in `app.asar` (extract and search built assets as needed).
- Find relevant strings/keys/functions/components for the feature (status labels, event names, item types, summaries, collapse/expand behavior, etc.).
- Capture the closest equivalent pattern if exact parity is not present.

3. Build a parity checklist from Codex.app:
- Data model shape (fields used by UI).
- Realtime event sources and transitions.
- Rendering structure (what is shown collapsed vs expanded).
- Copy/text behavior (phrasing and status wording).
- Interaction behavior (auto-expand, auto-collapse, click/keyboard handling).
- Visibility rules (when elements appear/disappear).

4. Implement against that checklist:
- Prefer Codex.app behavior over novel design.
- Keep deviations minimal and intentional.
- If deviating, include a short reason in the final response.

5. Verify parity after implementation:
- Confirm each checklist item.
- Run local build/tests.
- Re-check UI behavior against Codex.app reference.

## Response Requirements (When delivering feature changes)

For feature tasks, include:

- `Codex.app analysis`: what was inspected (files/areas/patterns).
- `Parity result`: matched items and any explicit deviations.
- `Fallback note` only if Codex.app could not be inspected or had no equivalent.

## Fallback Rules

If Codex.app cannot be inspected (missing app, extraction/search failure) or has no equivalent pattern:

- State the blocker explicitly.
- Use best local implementation consistent with existing repository patterns.
- Keep behavior conservative and avoid speculative UX innovations.

## Scope and Safety

- This policy applies to **feature behavior and UX decisions**, not just styling.
- Bug fixes should still check Codex.app when they affect user-visible behavior.
- Prefer minimal patches that align with app behavior rather than large refactors.

## Completion Verification Requirement

- After completing a task that changes behavior or UI, always run a Playwright verification in **headless** mode.
- Always capture a screenshot of the changed result and display that screenshot in chat when reporting completion.

## Self-Improvement Protocol

After each feature implementation session that uses this skill:

1. **Record new findings**: Append a dated `## Findings:` section documenting any newly discovered Codex.app internals (state keys, API endpoints, component patterns, auth flows, etc.).
2. **Update search instructions**: If new search techniques were used (e.g., a better way to extract minified code, new file locations), update the "How to Search for Features" section.
3. **Update architecture notes**: If new IPC channels, API endpoints, or data flows were discovered, add them to the Architecture Notes.
4. **Keep findings actionable**: Each finding should include enough detail that a future session can reuse it without re-discovering.

## Findings: Workspace Root Ordering (2026-02-25)

- Codex.app persists workspace root ordering/labels in global state JSON keys:
  - `electron-saved-workspace-roots` (order source of truth)
  - `electron-workspace-root-labels`
  - `active-workspace-roots`
- In this environment, persisted file path is:
  - `~/.codex/.codex-global-state.json`
- In packaged desktop runs, equivalent userData path is typically:
  - `~/Library/Application Support/Codex/.codex-global-state.json`
- For folder/project reorder parity, prefer reading these keys over browser LocalStorage-only ordering.
- Validation requirement for reorder changes:
  - Run build/typecheck.
  - Run Playwright in headless mode and capture a screenshot showing sidebar order.

## Findings: Dictation / Microphone Feature (2026-02-26)

- **i18n keys**: `composer.dictation.*` — tooltip is "Hold to dictate", aria is "Dictate".
- **Component**: `M4n` React hook handles recording state, audio capture, and transcription.
- **Audio pipeline**: `navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } })` → `MediaRecorder` → chunks → `Blob` → multipart POST.
- **Transcription endpoint**: The renderer sends audio to `/transcribe` via the IPC fetch proxy. The main process (`tle` class) prepends the `prodApiBaseUrl` (`https://chatgpt.com/backend-api`) and attaches ChatGPT auth bearer tokens. Full URL: `https://chatgpt.com/backend-api/transcribe`.
- **Request format**: Multipart form-data with boundary `----codex-transcribe-<uuid>`, fields: `file` (audio blob) and optional `language`. Body is base64-encoded and sent with `X-Codex-Base64: 1` header.
- **Response**: `{ text: "transcribed text" }`.
- **Interaction model**: Press-and-hold to record → release to stop and transcribe → text inserted into composer. Has "insert" and "send" modes.
- **Icon**: `audiowave-dark.svg` / `audiowave-light.svg` (custom SVG, not from icon library).
- **Web app implementation**: Our bridge proxies `/codex-api/transcribe` to the ChatGPT backend using auth tokens from the app-server `getAuthStatus` RPC. Frontend uses `useDictation` composable with `MediaRecorder` API.

## Findings: Chat Markdown Image Embeds (2026-03-04)

- Codex.app renderer bundle includes markdown-to-HTML image handling (`image({href,title,text})` emits `<img src="...">`), consistent with inline markdown image rendering in assistant/user text.
- In web parity mode, absolute local paths in markdown image URLs need explicit server mediation; browser runtime does not resolve `/Users/...` as local files.
- A dedicated local image endpoint (`/codex-local-image?path=...`) is required for parity-like rendering of absolute filesystem image paths in browser-delivered UI.
- Express `sendFile` must allow dot-directory segments (`dotfiles: 'allow'`) or paths under `~/.codex/...` return 404 despite existing files.

## Findings: Composer Enter Behavior (2026-03-05)

- Codex.app composer input is rich-text/multiline (`ProseMirror`-based), not single-line.
- Enter handling is configurable (`enterBehavior`):
  - `enter` submits by default.
  - `newline` inserts a newline on Enter.
  - `cmdIfMultiline` inserts newline when multiline, otherwise submits.
- Newline shortcuts are explicitly bound:
  - `Shift-Enter` inserts newline.
  - `Alt-Enter` inserts newline.
  - `Mod-Enter` submits.
- This confirms multiline composition parity requires newline-capable input plus explicit Enter-vs-newline key handling.

## Findings: Composer `@` Mentions (2026-03-05)

- Codex.app uses a dedicated mention trigger plugin for `@` with pattern `/(^|\s)(@[^\s@]*)$/`, so mentions activate at word boundaries and stop on whitespace or a second `@`.
- Mention entries are stored as an inline `mention-ui` node with attrs `{ label, path, fsPath }`, rendered with data attributes `at-mention-label`, `at-mention-path`, and `at-mention-fs-path`.
- Mention picker keyboard behavior includes:
  - `Escape` closes mention UI.
  - `Enter` and `Tab` commit the highlighted mention.
- Composer placeholder copy in local mode explicitly documents this affordance: `Ask Codex anything, @ to add files, / for commands`.

## Findings: Thread Rename Flow (2026-03-12)

- Codex.app locale keys confirm sidebar rename flow is dialog-based, not inline:
  - `sidebarElectron.renameThread`
  - `sidebarElectron.renameThreadDialogTitle`
  - `sidebarElectron.renameThreadDialogSubtitle`
  - `sidebarElectron.renameThreadDialogPlaceholder`
  - `sidebarElectron.renameThreadDialogSave`
  - `sidebarElectron.renameThreadDialogCancel`
  - `sidebarElectron.renameThreadDialogAriaLabel`
- App-server RPC for rename uses method `thread/name/set` with params `{ threadId, name }` (not `threadName`).
- `thread/name/updated` realtime notification carries `{ threadId, threadName }`, so parity implementations should handle both request/response naming differences (`name` on write, `threadName` on notification).

## Findings: Thread Fork RPC (2026-03-27)

- The local protocol schemas include a stable `thread/fork` RPC in v2, separate from `thread/start`.
- `ThreadForkParams` accepts `threadId` (required) with optional `cwd` and `model` overrides, and returns a response shape that includes `thread.id`.
- For sidebar "Create chat fork" actions, prefer `thread/fork` over creating a fresh thread with `thread/start`.

## Findings: Thread Delete Semantics (2026-03-12)

- In this app-server API surface there is no `thread/delete` method in v2 docs/schemas; thread removal from active list is handled through `thread/archive`.
- For delete-like UI parity in sidebar menus, implement a destructive confirmation dialog and route confirmation to `thread/archive`.

## Findings: Build Badge (2026-03-16)

- Searched extracted Codex.app webview assets for `build-badge`, `WT`, and `worktree` UI markers; no explicit build badge or worktree/version label found in renderer bundle.

## Findings: Windows Connection Status Presentation (2026-07-10)

- Windows Codex `26.707.31428` uses modular renderer chunks under `webview/assets/`; connection behavior is isolated in `app-server-connection-state-*.js` and `app-server-connection-state-presentation-*.js` rather than only a monolithic `index-*.js` bundle.
- The reusable connection states are `connecting`, `restarting`, `connected`, `disconnected`, and `error`.
- Connected and disconnected states render compact green/gray dots; connecting and restarting use a spinner; errors use the error icon/color. The compact badge exposes the full state through an accessible label and tooltip.
- Error presentation maps actionable causes such as login, install, update, restart, or settings to a focused recovery action instead of displaying raw transport details.
- CX-Codex mobile parity intentionally keeps the same compact state vocabulary but makes the badge trigger current-thread recovery, because a suspended mobile WebView needs a direct catch-up affordance that the desktop host does not.

## Findings: Queued Messages and Web Search Activity (2026-07-13)

- Windows Codex `26.707.31428` maps App Server `webSearch` thread items into a structured `web-search` tool activity. While active it shows `Searching the web` with the query when available; completed searches contribute to the collapsed tool-activity summary instead of rendering an unsupported/raw fallback card.
- The desktop queued-message list renders in the above-composer queue portal, not as a committed conversation bubble. A submitted follow-up appears there immediately with edit, delete, reorder, and `Steer` actions while runtime reconciliation continues in the background.
- For CX-Codex parity, queue state must be written before the first awaited recovery call. If recovery discovers the thread is already idle, the normal queue processor should submit the existing row once rather than moving it through a second optimistic representation.

## Findings: MCP Tool Approval Cards (2026-07-13)

- Windows Codex `26.707.31428` parses `mcpServer/elicitation/request` metadata with `_meta.codex_approval_kind = "mcp_tool_call"` as a dedicated approval request, even when `mode` is `form` and `requestedSchema.properties` is empty. It must not fall back to a freeform text field.
- The desktop approval card defaults to `Allow once` and `Deny`. When `_meta.persist` advertises support, it adds scoped approval actions for the current conversation and `Always allow` rather than exposing persistence for every request.
- MCP approval replies use `{ action: "accept", content: {}, _meta: { persist: "session" | "always" } }`; one-time approval omits persistence. Decline uses `{ action: "decline" }`.
- The approval surface shows tool identity and meaningful target details, enters a loading state immediately after submission, and disables duplicate actions while the reply is in flight.

## Findings: Composer Send Shortcut (2026-07-16)

- Windows Codex `26.707.31428` exposes a dedicated `settings.general.enterBehavior` setting with `Enter`, `Cmd + Enter always`, and `Cmd + Enter for multiline prompts` choices; its setting description explicitly frames this as choosing whether Enter sends or inserts a newline.
- The desktop implementation keeps explicit modified-key submission and explicit newline bindings. CX-Codex therefore keeps Ctrl / Command + Enter as a reliable send shortcut in both user-facing modes, while adding a simple persisted `发送 / 换行` choice appropriate for the existing textarea composer.
- The desktop strings describe compact settings vocabulary rather than implementation details. CX-Codex uses the same direct language in Settings and keeps runtime detail behind a single compact status row instead of exposing protocol payloads.

## Findings: Staged Sidebar Prefetch (2026-07-17)

- Windows Codex `26.707.12708` starts non-blocking `AppPrefetchImpl` work in stages and keeps sidebar thread keys stable through a dedicated signal layer.
- For CX-Codex cached sidebar startup, preserve the rendered cache as the interactive first state, then begin full-list reconciliation shortly after initial paint rather than blocking the first screen or waiting long enough for older projects to appear missing.

## Findings: Quiet Navigation and Status (2026-07-17)

- Windows Codex `26.707.12708` keeps connection state compact and task-related; it does not expose unrelated desktop-host availability as a persistent new-conversation warning.
- The desktop settings bundle uses grouped settings surfaces and compact rows. For CX-Codex, optional operational destinations such as skills, GitHub, and diagnostics should be reachable from a compact tools entry instead of competing with primary conversation actions.

## Findings: Avatar Task Overlay (2026-07-17)

- Windows Codex package `26.707.91948` isolates the feature in `avatar-overlay-page-*`, `avatar-overlay-native-page-*`, `avatar-overlay-native-frame-*`, `avatar-mascot-button-*`, and `pets-settings-*` renderer chunks, plus separate pet sprite sheets.
- The overlay is a transparent independent window. Its mascot badge carries the notification count; activating it opens an activity tray rather than navigating immediately.
- Activity rows retain `localConversationId` and an `app-server-conversation` control target. Activating a row sends the equivalent of `open-in-main-window`, focuses the primary window, and opens that exact conversation.
- The reference window is draggable/resizable and exposes Wake/Tuck Away, pet choice, and size settings. CX-Codex Android matches the high-value behavior—opt-in system overlay, draggable mascot, count badge, expandable activity rows, and exact-thread navigation—while intentionally using one original code-native mascot and one fixed touch-friendly size instead of copying proprietary sprites or desktop-only customization.
- Android requires a foreground service plus `SYSTEM_ALERT_WINDOW` to remain useful across apps. Because the WebView can be suspended, the native service additionally reconciles the small frontend-supplied active-thread snapshot; this is an Android lifecycle adaptation, not a desktop parity deviation in task semantics.

## Findings: Avatar Overlay Interaction Performance (2026-07-17)

- Windows Codex `26.707.91948` keeps mascot interaction pointer-based: pointer capture distinguishes taps from drags with a 4 px movement threshold, and badge feedback uses transform/opacity spring motion with an explicit reduced-motion path.
- The native overlay page batches geometry reads with `requestAnimationFrame` and `ResizeObserver`, while compiled component memo caches avoid recreating stable mascot and notification subtrees on unrelated state changes.
- CX-Codex Android follows the same performance intent with frame-coalesced `WindowManager` drag updates, deferred task-row construction while the tray is collapsed, and one batched runtime-snapshot read for all known active tasks. Android network failure backoff is an intentional mobile battery adaptation.

## Findings: Cross-client stale-list catch-up (2026-07-17)

- Windows Codex keeps cached sidebar rows interactive while staged prefetch reconciles them in the background.
- For CX-Codex, the first stale `thread/list` read should remain instant. A second same-key reconciliation arriving while refresh is active should reuse and await that refresh so another 7420 client receives the caught-up list instead of the same stale snapshot.
- Android foreground recovery should replay notifications and reconcile the selected thread immediately; a full thread-list refresh is only needed after structural invalidation or when the last list sync is old enough.

## Findings: Lightweight interaction motion (2026-07-17)

- Windows Codex keeps frequent control feedback state-driven: its shared button and avatar controls use active/pressed state, transform or opacity changes, and pointer-aware behavior instead of decorative page choreography.
- The avatar overlay implementation batches high-frequency movement and provides an explicit reduced-motion path; persistent visual activity is isolated to the smallest status element.
- CX-Codex should therefore share a short motion scale across mobile controls, keep drawer/sheet movement bounded, avoid moving an entire message history during thread switches, and prefer one calm status pulse over simultaneous sweep, spinner, and jumping-dot effects.

## Findings: Avatar Overlay Drag Release and Live Summaries (2026-07-17)

- Windows Codex `26.707.91948` sends explicit `avatar-overlay-drag-start`, `avatar-overlay-drag-move`, `avatar-overlay-drag-end`, and physics-aware `avatar-overlay-drag-release` messages; the renderer records recent pointer samples and only promotes a tap to a drag after 4 px movement.
- Notification rows derive their compact copy from the latest turn items and show structured waiting-request summaries rather than replacing every active row with a generic running label.
- CX-Codex Android follows the interaction intent with 4 dp promotion, frame-coalesced movement, immediate haptic/scale/tilt feedback, and a 220 ms nearest-edge deceleration. It intentionally omits desktop bounce physics to keep window movement predictable on touch screens.
- The Android bridge now forwards the newest sanitized activity detail while the WebView is active. Native runtime polling preserves that detail and updates event freshness/state in the background instead of overwriting it with generic copy.

## Findings: Desktop Session CLI Parity (2026-07-17)

- Windows Codex package `26.707.12708` keeps local conversation, sidebar-thread signals, thread resolution, and App Server connection state in separate renderer modules; thread history visibility and live resumability are distinct states.
- A desktop-created session records the writing CLI version in `session_meta`. A session written by desktop CLI `0.144.5` could expose light metadata to an older `0.130.0` bridge while full `thread/read`, `thread/resume`, and `turn/start` failed, producing a readable but non-actionable ghost thread.
- On Windows, CX-Codex should prefer the newest runnable desktop-managed binary under `%LOCALAPPDATA%\OpenAI\Codex\bin\<build>\codex.exe`, while keeping an explicitly configured runnable command authoritative. Null resume fallbacks must not be cached as proof that a thread is live.
