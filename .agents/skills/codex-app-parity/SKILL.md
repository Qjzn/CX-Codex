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

## Findings: Avatar Overlay Size and Tuck Away (2026-07-17)

- Windows Codex `26.707.91948` exposes pet size as a separate 80-224 range and provides explicit `Tuck Away Pet` / `Wake Pet` actions; hiding the mascot is not presented as disabling the feature.
- CX-Codex Android adapts this to a smaller fixed 88 x 96 dp default plus a non-destructive 48 x 48 dp minimized bubble. The bubble keeps the live count and restores on tap, while the Settings master switch remains the only full-close action.
- The Android fixed sizes preserve predictable system-overlay geometry and a minimum 48 dp touch target without adding a continuously animated or battery-heavy customization surface.

## Findings: Avatar Overlay Reduced Motion and Hidden Animation (2026-07-17)

- Windows Codex passes a shared reduced-motion signal into the avatar tray and uses zero-duration transitions plus `motion-reduce:transition-none`; drag feedback remains state-driven and bounded to the mascot.
- CX-Codex uses state-specific four-frame CX companion animations plus bounded property transitions in the full view and the same static state image in the 48 dp minimized bubble. Reduced motion selects the still Web source, and minimizing or destroying the native overlay stops the hidden decoder.

## Findings: CX-Branded Task Pet Identity (2026-07-17)

- Codex desktop proves that the useful parity contract is state visibility, direct task access, drag feedback, and non-destructive minimization; the mascot itself is a product customization surface rather than a fixed character requirement.
- CX-Codex therefore uses an original companion derived from its loop-and-X logo, with five readable four-frame state animations and bounded native transforms. Continuous decoding is limited to the visible full pet while working, waiting, completed, dragging, or slowly idling.

## Findings: Task-Pet Read Acknowledgement (2026-07-17)

- Codex desktop notification rows open their owning task context; dismissal and navigation are separate concerns, so a click alone is not proof that conversation content was read.
- CX-Codex keeps completed native records after launch intent delivery and clears them only when the matching Vue conversation has loaded and is no longer running. Direct reply instead converts the record back to an active task.

## Findings: Task-Pet Platform Entry and Confirmed Close (2026-07-17)

- Windows Codex avatar activity rows use `open-in-main-window` with the owning local conversation id, while `Tuck Away Pet` / `Wake Pet` remain separate from navigation and task semantics.
- CX-Codex Android preserves that separation with one explicit platform entry, two newest known conversation shortcuts, and exact-thread launch intents. Recent conversations are navigation shortcuts and are not merged into persistent task records.
- A full close is materially different from minimization, so Android requires an inline confirmation, persists the Settings master switch as disabled, and tells the user where to re-enable the overlay. This avoids relying on a service-owned system dialog that may lack a valid application window token.

## Findings: Task-Pet Exact Navigation and Touch Reply (2026-07-17)

- Windows Codex avatar rows carry `localConversationId` into `open-in-main-window`, making the exact conversation target durable across overlay-to-main-window activation. The inspected avatar chunks do not expose a long-press reply gesture.
- Capacitor calls the Activity's overridden `onNewIntent()` once while `BridgeActivity.load()` is still inside `super.onCreate()`. CX-Codex must capture the task-pet thread id at that point but defer WebView navigation until the subclass has completed initial creation; otherwise the extra is removed before the stable launch path can use it.
- Long-press reply is an intentional Android touch adaptation: a 520 ms hold consumes the following click, reuses the existing focusable overlay composer and `/codex-api/runtime/send`, and promotes a successful recent-conversation reply into the native running-task list.

## Findings: Glanceable Task-Pet Progress (2026-07-17)

- Windows Codex avatar-overlay notifications retain the exact `localConversationId` and derive compact visible copy from current turn items; a generic record title is not sufficient progress information when the overlay is intended for at-a-glance monitoring.
- CX-Codex Android therefore makes the latest assistant reply the primary two-line row content while keeping phase, project, and conversation title as secondary context. Foreground messages and server-side `item/agentMessage/delta` events feed the same bounded reply field so background batch polling does not regress to titles.
- Idle presentation is a derived Android adaptation: no records means a 48 dp touch target with a 36 dp visual, while new work restores the proportionally smaller full companion. The platform Logo and close × remain 48 dp header actions; no manual minimized preference competes with task state.

## Findings: Desktop Session CLI Parity (2026-07-17)

- Windows Codex package `26.707.12708` keeps local conversation, sidebar-thread signals, thread resolution, and App Server connection state in separate renderer modules; thread history visibility and live resumability are distinct states.
- A desktop-created session records the writing CLI version in `session_meta`. A session written by desktop CLI `0.144.5` could expose light metadata to an older `0.130.0` bridge while full `thread/read`, `thread/resume`, and `turn/start` failed, producing a readable but non-actionable ghost thread.
- On Windows, CX-Codex should prefer the newest runnable desktop-managed binary under `%LOCALAPPDATA%\OpenAI\Codex\bin\<build>\codex.exe`, while keeping an explicitly configured runnable command authoritative. Null resume fallbacks must not be cached as proof that a thread is live.

## Findings: Conversation Running Timeline (2026-07-17)

- Windows Codex `26.707.12708` renders active work as a `worked-for` item carrying `startedAtMs` and `completedAtMs`; its elapsed label is derived from those timestamps rather than the component mount time.
- The turn renderer switches copy between `Thinking`, `Worked for {time}`, and `You stopped after {time}` while retaining the same timeline data, so activity-label changes must not restart the clock.
- CX-Codex should create the local timeline together with the optimistic user bubble, preserve it through runtime reconciliation, and clear it only on a definitive completion, interruption, or send failure.

## Findings: Reliable Message Delivery Feedback (2026-07-17)

- Windows Codex `26.707.12708` exposes bounded reconnect progress such as `Reconnecting 1/5` when a local conversation stream drops, but it does not provide a reusable failed outgoing-message bubble in the inspected renderer path.
- Matrix JS SDK and Signal Desktop preserve local outgoing content across send failures, distinguish pending from failed delivery, and expose a retry path. CX-Codex intentionally adopts this messaging convention because mobile and weak-network use make disappearing prompts more harmful than a compact delivery label.
- CX-Codex keeps the implementation local and reversible: only optimistic user messages carry `sending` or `failed`, authoritative history still replaces them by signature, and retry reuses the original request context without adding a new persistence protocol.

## Findings: Bounded Send Reconnect and Idempotency (2026-07-17)

- Windows Codex `26.707.12708` renders stream recovery with explicit bounded progress (`Reconnecting {attempt}/{maxAttempts}`) and distinct busy-server copy instead of an indefinite spinner.
- CX-Codex applies the same bounded-progress convention to outgoing mobile messages, but only after assigning a stable `clientMessageId` and making `/codex-api/runtime/send` deduplicate both concurrent and later repeated requests.
- Automatic retry is limited to transport uncertainty. Definite application errors remain immediate failures, and a user-initiated retry receives a fresh id so a known failed request cannot be confused with a network replay.

## Findings: First Message Reliability (2026-07-17)

- Windows Codex applies the same bounded stream-reconnect presentation to a local conversation regardless of whether it was just created or already existed; users are not exposed to separate first-message recovery vocabulary.
- CX-Codex therefore shares one runtime-send recovery function for both paths. It deliberately does not automatically replay the preliminary `thread/start`, because that RPC lacks the `clientMessageId` idempotency boundary used by `/codex-api/runtime/send`.
- If preliminary thread creation is transport-uncertain, CX-Codex falls through to the idempotent runtime endpoint. Once a thread id exists, first-message failure is retained as the same actionable failed bubble used in established conversations.

## Findings: Persistent Mobile Message Outbox (2026-07-17)

- Windows Codex `26.707.12708` persists composer prompt drafts under a versioned signal and restores the original prompt and attachments when submission throws; its completion transport recovery polls the authoritative conversation after a recoverable stream error instead of immediately replaying user input.
- CX-Codex follows the same restore-and-reconcile semantics and adds a mobile lifecycle adaptation: an outgoing request is stored before the first await, then reconciled by `clientMessageId` after WebView reload or process death.
- Unknown requests are never automatically replayed during startup. Accepted requests return to authoritative thread sync, while failed requests remain retryable bubbles whether or not a thread id was obtained.
- The browser outbox is intentionally bounded to 12 entries with a seven-day TTL and no new dependency. It complements server idempotency without becoming a second message database.

## Findings: Cross-client New-thread Invalidation (2026-07-17)

- The authoritative Runtime Store records `thread/started` immediately after a successful `thread/start`, before `turn/started`; this is the existing App Server signal that another client has created a conversation.
- The sending client can insert its new thread optimistically, but other 7420 clients must treat `thread/started` as a structural thread-list invalidation and run the existing debounced reconciliation.
- Frequent `thread/status/changed` and `thread/tokenUsage/updated` events remain non-structural so cross-client catch-up does not create a list-refresh storm or require a proprietary synchronization event.

## Findings: Durable Pending-start Resume (2026-07-17)

- Codex.app restores a durable prompt after transport interruption and distinguishes an acknowledged request from an authoritative conversation result; a persisted request row without a thread id is not sufficient proof that the message is visible or runnable.
- CX-Codex therefore keeps a threadless `pending_start` entry in the mobile outbox and reuses its original `clientMessageId` to resume the known server request. It must not delete that entry merely because the lookup endpoint returned a row.
- The 7420 server resumes the original persisted request id after process restart. Same-process duplicates still coalesce through the existing in-flight map, while completed, running, failed, or thread-bound requests retain their previous idempotent behavior.

## Findings: Monotonic Runtime Event Convergence (2026-07-17)

- Codex.app keeps conversation event state and sidebar state behind stable signal layers; a completed turn must not return to running because an earlier asynchronous read resolves later.
- CX-Codex runtime notifications carry the Runtime Store `seq`. The frontend must retain that sequence when applying live or replayed state and reject a snapshot whose non-zero `lastEventSeq` is lower than the latest applied notification sequence.
- Rejected snapshots may still contribute preserved message content, but cannot replace execution state, active turn, pending requests, token usage, or loaded-version markers. Sequence-free snapshots remain accepted for compatibility with older 7420 servers.

## Findings: Confirmed Delivery Versus Uncertain Acknowledgement (2026-07-17)

- Codex.app keeps reconnecting or transport-uncertain work distinct from a completed acknowledgement; a locally visible prompt is not itself proof that `turn/start` succeeded.
- CX-Codex now keeps `pending_start`, `starting`, and `start_uncertain` messages in the durable outbox as `确认中`. Only an authoritative running or settled request removes the outbox entry and presents `已发送`.
- A bridge restart reconciles persisted `starting` requests against the thread snapshot. Running or completed work converges normally; an idle or stopped pre-turn snapshot becomes a retryable failure instead of remaining stuck or being replayed automatically.

## Findings: Foreground and Parallel-page Outbox Recovery (2026-07-17)

- Codex.app couples foreground/reconnect recovery to durable prompt state instead of assuming a still-connected renderer has received every acknowledgement.
- CX-Codex must reconcile its message outbox on the first foreground attempt even when the notification transport still reports connected; Android can suspend JavaScript without producing a clean disconnect transition.
- Multiple 7420 pages on the same origin share localStorage but not their in-memory maps. Outbox mutations therefore merge the newest persisted entries before writing, and storage events replace the stale map and trigger authoritative request reconciliation without adding polling.

## Findings: Deterministic Bounded-send Recovery (2026-07-17)

- Codex.app presents reconnect attempts as bounded progress and reconciles authoritative conversation state before treating a transport failure as a new send opportunity.
- CX-Codex production runtime sends now use one testable bounded-recovery coordinator: each failure first queries the same `clientMessageId`, transport-only failures retry after 650 ms and 1800 ms, and definitive errors stop immediately.
- A recovered request returns without replay, an exhausted transport failure preserves the original outbox bubble for manual retry, and tests inject waits rather than sleeping so weak-network behavior is deterministic and fast.

## Findings: Local Transport Failure Ownership (2026-07-17)

- Codex.app keeps renderer/network recovery feedback distinct from an authoritative task failure: a request that never reached the runtime must not manufacture an active or failed turn card.
- CX-Codex therefore lets the optimistic message bubble own local send failure and retry actions, while the global connection indicator owns transport health. Thread-level `turnError` remains reserved for errors reported by the authoritative runtime.
- On an idle thread, bounded send exhaustion clears the temporary running state. If an authoritative turn was already active before steering, that prior activity remains visible rather than being stopped by the local send failure.

## Findings: Durable In-place Manual Retry (2026-07-17)

- Mature chat clients keep a failed message as one stable visual object: retry changes that object's delivery state and does not append a second copy before server acknowledgement.
- CX-Codex failed-outbox recovery must first match the currently visible optimistic bubble by `clientMessageId`; only a genuine reload without that bubble may create the deterministic outbox representation.
- Retry derives its target thread and payload from the failed message's durable outbox entry when volatile state is absent. A known-failed attempt receives a fresh idempotency key, while the same optimistic message id remains visible until authoritative history replaces it.

## Findings: Measurable Mobile Send Feedback (2026-07-17)

- Codex.app commits local conversation feedback before awaiting the App Server; network or thread-list latency must not be used as a proxy for how quickly the renderer acknowledges a tap.
- CX-Codex measures from the composer submit handler to local state commit and to the next rendered bubble/running frame. The page-side metric follows the existing first-screen-ready approach so browser-driver polling time cannot inflate product latency.
- The regression budget is deliberately conservative at 50 ms for local state and 200 ms for visible bubble/running feedback. The metric keeps only 20 timing-only rows and never stores message content.

## Findings: Turn First-response Performance Span (2026-07-17)

- Windows Codex `26.707.12708` implements a dedicated `turn_first_response_visible` performance span keyed by the client user-message id. It records `request_dispatched`, binds the conversation and turn on `turn_started`, records `first_data_received`, and ends only after `first_response_visible` is painted.
- The desktop span treats completion without a visible response as `no_visible_response`, and separately aborts navigation, interruption, superseded submissions, and app disposal. This confirms that HTTP completion alone is not a valid chat responsiveness metric.
- CX-Codex follows the same correlation model with `clientMessageId`, `turnId`, App Server notifications, and a post-render frame. Its optional real-response regression uses conservative 500/5000/45000/250 ms dispatch, acknowledgement, first-data, and data-to-paint budgets while keeping only timing and identifier fields.

## Findings: Optimistic New-conversation First Turn (2026-07-17)

- Windows Codex `26.707.12708` starts a real conversation first, then launches its initial turn with `returnAfterOptimisticTurn`; the renderer can return once local turn feedback exists without waiting for the runtime request to finish.
- CX-Codex cannot assume `thread/start` is instantaneous on a mobile bridge, so the home route renders one memory-only provisional conversation immediately. It does not create a fake sidebar thread or a second persistent message store.
- Once the authoritative thread id arrives, the real thread adopts the same optimistic message id, outbox entry, and start timestamp. This preserves one visual message and one timer across the home-to-thread transition while keeping recovery and cross-client synchronization authoritative.

## Findings: Authoritative New-thread Handoff and Threadless Retry (2026-07-17)

- Windows Codex `26.707.91948` creates the authoritative conversation before launching its first turn and uses `returnAfterOptimisticTurn` so navigation does not wait for the first request to settle.
- CX-Codex now announces the real thread immediately after `thread/start`, routes to it while `/runtime/send` continues, and keeps the same optimistic message id across the provisional and authoritative surfaces.
- If no thread id is ever obtained, bounded exhaustion no longer removes the outbox or moves the content silently back into the composer. The same bubble becomes `发送失败`, survives reload/foreground recovery, and offers explicit edit or retry actions. Retry creates a fresh idempotency key while retaining the visual message id; edit restores the exact content to the composer and clears only the known-failed attempt.

## Findings: Cross-page Delivery Deletion Convergence (2026-07-17)

- Windows Codex `26.707.91948` keeps stable `clientUserMessageId` ownership inside its conversation signal layer; once authoritative delivery replaces local pending state, an older renderer snapshot must not recreate that pending send.
- Multiple CX-Codex 7420 pages share localStorage but receive storage events asynchronously. Entry-only last-write merging can therefore resurrect an outbox row that another page already confirmed and removed.
- CX-Codex now persists bounded seven-day deletion markers alongside the existing outbox payload. A stale page may merge newer message state, but cannot recreate a client message whose deletion timestamp is at least as new as that stale entry; no server protocol or dependency is added.
- Storage-event convergence merges and writes the combined state instead of replacing memory. Recovery also revalidates the entry after each authoritative await, so a late lookup cannot recreate a preview that a newer page already removed; same-payload retries rebind the existing preview to the fresh id.

## Findings: Stable Conversation-tail Activity Surface (2026-07-17)

- Windows Codex `26.707.91948` represents working time as one stable timeline item whose label changes between working, completed, and stopped states while retaining the same start and completion timestamps.
- CX-Codex therefore keeps one collapsed activity surface at the conversation tail while thinking, command execution, and assistant text streaming alternate. The first visible assistant text must not unmount the activity surface or reset its elapsed time.
- Only the latest active command belongs in this surface. It is hidden from the normal message history while running, becomes inspectable from the activity detail sheet, and returns to history as a collapsed command row after completion. Pending approvals remain expanded because they require immediate user action.

## Findings: Terminal Convergence and Native Reply Idempotency (2026-07-18)

- Windows Codex `26.707.12708` keeps completion behind stable conversation state and correlates outgoing work with durable client message identifiers; a recovered terminal event must clear local running residue without replaying the user's prompt.
- CX-Codex treats `sync_degraded` as confirmation-pending rather than proof of a running turn, keeps those requests eligible for authoritative reconciliation, and applies idempotent terminal cleanup to replayed completion events.
- Android task-pet polling rejects older non-zero event sequences and presents stale, partial, or disconnected state as waiting. Direct reply reuses one persisted `clientMessageId` for the same thread and message until running or terminal state is confirmed.
