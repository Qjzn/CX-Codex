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

## Findings: Durable Send Before Thread Resume (2026-07-18)

- Windows Codex `26.707.12708` keeps outgoing work correlated by stable client user-message identifiers and presents bounded reconnect progress instead of treating a renderer transport interruption as an authoritative turn failure.
- CX-Codex existing-thread sends must enter `/codex-api/runtime/send` before any fallible renderer-side `thread/resume` preflight. The persisted request is the delivery boundary; if `turn/start` reports `thread not found`, the 7420 server resumes once and retries under the same `clientMessageId`.
- After bounded mobile retries, transport-only exhaustion becomes `等待网络`. Foreground, network, storage, or realtime reconnection reconciles the original idempotency key and automatically resumes only when the server still has no authoritative request.

## Findings: Activity Identity and Authoritative Terminal Cleanup (2026-07-18)

- Windows Codex `26.707.12708` retains elapsed time for one stable working timeline item, not merely for any consecutive renderer state that happens to be marked running.
- CX-Codex therefore needs a stable activity identity across thinking, execution, and streaming labels. A new local submission or different authoritative `turnId` starts a new timer, while a transient overlay gap within the same activity retains the original timestamp.
- Fresh terminal snapshots settle only local optimistic feedback whose creation time is no later than the authoritative completion time. The visual bubble stays until history reconciliation, preventing both false running state and a transient message disappearance without allowing an older completion to affect a newer follow-up.

## Findings: Task-Pet Canonical Conversation Route (2026-07-18)

- Windows Codex avatar rows preserve one exact `localConversationId` through `open-in-main-window`; the host location is not allowed to reinterpret that identity as a home-page navigation.
- CX-Codex Android connection setup accepts addresses copied from a browser, so the native shell must remove an existing hash route and query before composing `/#/thread/:threadId`. Appending to a saved `/#/` creates `#/#/thread/...`, which Vue correctly treats as an unknown route and redirects home.
- Exact-thread regression must cover both warm and cold Activity launches with bare-host, trailing-slash, home-hash, and existing-thread URLs. Source-only lifecycle checks are insufficient for this cross-boundary behavior.

## Findings: Foreground Task Recovery Feedback (2026-07-18)

- Windows Codex keeps connection recovery compact: connecting and restarting use one small spinner, while the conversation's stable working timeline continues to own elapsed time.
- CX-Codex foreground recovery follows the same presentation hierarchy. Android or browser resume temporarily marks the existing conversation-tail activity as `正在恢复任务`; it does not mount a second loader or replace the activity identity and start timestamp.
- A matching realtime execution event or runtime snapshot settles the transient feedback after a 500 ms minimum visible interval. An 8-second visual timeout prevents a failed recovery check from becoming a new indefinite loading state, and reduced-motion keeps the text while disabling rotation.

## Findings: Mobile Resume, Unread, and Queue Convergence (2026-07-18)

- Windows Codex keeps queued follow-ups in a separate composer-adjacent queue signal; the presence of queued text is not evidence that the preceding turn is still running. CX-Codex must clear terminal turn residue from an accepted Runtime Store snapshot before advancing the queue.
- Sidebar completion attention should be driven by a terminal conversation event, not by generic thread `updatedAt` changes. CX-Codex persists only event-backed unread completion state so token usage, renames, first startup, and cross-client list reconciliation cannot mark every row unread.
- On mobile resume, CX-Codex applies the lightweight Runtime Store snapshot before a potentially slow full-history RPC. The visible activity timer uses the earlier authoritative `lastStartedAtIso`, while cached messages remain in place until history reconciliation completes.
- Item-level progress remains owned by the realtime activity stream. `item/completed` and generic thread metadata changes should not force repeated full-history reads; turn/thread terminal events remain the authoritative history reconciliation boundary.

## Findings: Paused Queue Failure Recovery (2026-07-18)

- Windows Codex `26.707.91948` keeps a queued follow-up in place when it cannot be sent, marks the queue as paused, and offers retry, edit, and delete actions. Its visible remedy explicitly says one of those actions is required before later queued messages continue.
- CX-Codex follows the same conservative state machine: automatic queue submission never loops on a failed first item. Manual retry resets only that item, editing returns it to the composer, and deletion releases the next item.
- Because multiple 7420 pages can observe the same terminal event, each CX-Codex queued item also keeps one stable `clientMessageId`. Runtime idempotency prevents duplicate execution, while storage events synchronize display state without making background tabs auto-run the queue.
- Dense output events keep only their newest sequence outside Vue reactive state while content deltas are batch-rendered. This preserves stale-snapshot protection without rerendering the conversation chrome for every token, and terminal state is never revived by a delayed delta.
- Durable outbox recovery restores the existing message bubble before awaiting runtime lookup or resume. Mobile re-entry therefore shows immediate `等待网络` feedback and later updates the same bubble, instead of leaving the conversation visually blank during bounded recovery.

## Findings: Recent Project Ordering (2026-07-18)

- Windows Codex `26.707.91948` exposes `sidebarElectron.groupByMenu.recentProjects` and a `sidebarElectron.sortMenu.updated` choice alongside manual ordering, confirming that project groups may be organized by their latest conversation activity rather than only by saved workspace-root order.
- The same sidebar exposes explicit project pinning. CX-Codex therefore keeps pinned projects first by pin rank, sorts every unpinned project by its newest thread timestamp, and uses the incoming order only as a stable tie-breaker.
- Empty workspace roots remain visible after projects with conversation activity; recent ordering is a presentation rule and does not rewrite persisted workspace-root order.

## Findings: Per-turn Activity Timer Boundary (2026-07-18)

- Windows Codex `26.707.12708` models working duration on a per-turn timeline item and initializes the reasoning timer when that turn becomes active. A later turn must not inherit the previous turn's start timestamp.
- CX-Codex Runtime Store writes a fresh provisional `lastStartedAtIso` at `markStarting`; the authoritative `turn/started` notification may refine that timestamp without restarting the same turn's visible timer.
- Renderer recovery accepts an older authoritative start only when it is newer than `lastCompletedAtIso`. This rejects provably stale prior-turn timestamps while preserving legitimate tasks that have continued in the background for an hour or longer.

## Findings: Server-first New-thread Acceptance (2026-07-18)

- Windows Codex creates the authoritative conversation before its first turn, but its desktop renderer is not subject to Android WebView suspension between those two operations.
- CX-Codex mobile must dispatch the idempotent `/codex-api/runtime/send` request before any fallible renderer-side `thread/start`. The 7420 server persists `pending_start` under `clientMessageId` first, then creates the thread and starts the turn after the HTTP body has been accepted.
- The home route keeps the existing memory-only provisional conversation during that work. Once the Runtime request returns or foreground recovery finds its thread id, the authoritative conversation adopts the same optimistic message id without duplicating the prompt.

## Findings: Android Completion Notification Separation (2026-07-18)

- Codex desktop keeps passive connection/activity state visually quiet while completion attention is a separate event. A persistent host-status surface should not own the user's completion alert semantics.
- CX-Codex Android therefore keeps the foreground task-monitor notification on a low-importance channel and emits completion through a distinct high-importance channel. Android channel importance is immutable after creation, so correcting an older low-importance design requires a new channel id.
- Completion notifications open the exact owning thread and prefer the Runtime Store's bounded latest assistant reply over a generic completed label.

## Findings: Overlay-independent Android Task Monitoring (2026-07-18)

- Codex desktop's avatar overlay is a presentation surface over durable conversation state; closing or hiding the mascot does not define whether the underlying task continues.
- CX-Codex Android follows that separation by keeping its existing foreground monitor alive while active tasks remain, even when the pet overlay is disabled or `SYSTEM_ALERT_WINDOW` is unavailable. The overlay preference controls only the visual window.
- Once no active task remains and no overlay should be shown, the service stops itself. This preserves background completion alerts without turning the task monitor into an always-on battery cost.

## Findings: Provisional Android New-thread Tracking (2026-07-18)

- Windows Codex binds optimistic first-turn feedback and the later authoritative conversation to the same client user-message id. Android must preserve that identity even if its WebView is suspended before the new conversation id returns.
- CX-Codex therefore registers the provisional `clientMessageId` with the native foreground monitor immediately after the durable browser outbox write and before `/runtime/send`. The native service resolves `/codex-api/runtime/request` until a `threadId` exists, then switches the same task row to batched runtime snapshot polling.
- A provisional row cannot open or reply to a nonexistent conversation. It becomes actionable only after resolution, and the next active-task snapshot removes it if the renderer definitively fails or abandons the send.

## Findings: Contextual Android Completion Permission (2026-07-18)

- Windows Codex `26.707.12708` exposes turn-completion notifications as an independent setting and provides an explicit `Enable notifications` onboarding action; completion attention is not coupled to ordinary composer dispatch.
- Android 13 adds a runtime permission boundary that the desktop host does not have. CX-Codex therefore requests it only after a real message has durable delivery ownership and `/runtime/send` has already been dispatched; a queued follow-up uses its durable queue write because the current task is already running.
- The automatic prompt is recorded in native app storage before launch so denial cannot produce repeated prompts across WebView reloads or server-address changes. The Settings action remains an explicit manual recovery path, and the native bridge resolves only after Android reports the user's decision.
- Like Codex desktop's explicit system-settings action, CX-Codex opens the app-specific Android notification settings after a permanent denial or system-level disable and refreshes permission state when the Activity regains focus; automatic task submission never opens Settings.

## Findings: Bounded Android Screen-off Monitoring (2026-07-18)

- Codex desktop keeps task execution in a persistent host process, but its renderer parity does not imply that Android polling survives screen-off CPU suspension or deep Doze.
- CX-Codex Android therefore holds a non-reference-counted partial wake lock only while native task records are active. Each visible state, event-sequence, or reply update renews a 30-minute progress window; no active task releases it immediately, and a stalled task cannot hold it forever.
- Deep Doze still suspends ordinary network access and ignores wake locks. The mobile Settings surface exposes the current battery-optimization allowlist state and opens only Android's general manual settings; task submission never requests a direct exemption or claims guaranteed real-time delivery without a push channel.

## Findings: Long-task No-progress Attention (2026-07-18)

- Windows Codex `26.707.12708` keeps long-running work as one stable timeline item (`workingFor` / `workedFor`) and exposes turn-completion notification policy separately. Elapsed time is status, not proof of failure.
- Its avatar notification tray keeps open, dismiss, reply, and follow-up actions tied to the exact owning conversation. CX-Codex Android therefore treats ten minutes without progress as a separate actionable notification, never as an execution-state mutation.
- One reminder is allowed per unchanged progress timestamp and the deduplication marker persists with the native task record. A real state, event-sequence, detail, or reply update removes the stale reminder and starts a new window; completion cancels it and emits the existing terminal notification with the latest reply.

## Findings: Native Terminal Ownership Across Frontend Omission (2026-07-18)

- Windows Codex `26.707.91948` routes an avatar notification action to the exact owning conversation and keeps notification open/action separate from dismiss. Renderer omission therefore cannot be interpreted as task deletion or read acknowledgement.
- CX-Codex Android retains running, waiting, and unread-completed native records when a later WebView snapshot omits them. The foreground monitor stops only after authoritative terminal reconciliation leaves no active task, independent of whether the overlay is visible.
- A threadless provisional record has a separate non-acceptance boundary: only an omitted record with three consecutive authoritative request lookups returning not found is removed. Network failures remain recoverable and cannot manufacture either completion or deletion.
- Native terminal settlement removes the stale renderer-active preference before notifying, so a later service restart cannot resurrect the completed task as running.

## Findings: Same-conversation Native Turn Generation (2026-07-18)

- Windows Codex `26.707.12708` keeps working duration on a stable per-turn timeline item and correlates outgoing work with a client user-message identity. Conversation identity alone is therefore insufficient to decide which turn a delayed terminal signal owns.
- CX-Codex sends the current renderer activity id, activity start time, and Runtime Store event sequence with every Android task snapshot. A different activity in the same thread is accepted only when its event sequence or start time proves that it is newer.
- Each native poll retains the generation present when the request began. If the WebView starts a follow-up before that response returns, the result is discarded before it can change state, overwrite the latest reply, clear active persistence, or emit completion attention.
- Older persisted records without generation metadata remain readable and converge through the existing event-sequence checks; generation isolation becomes strict as soon as a current renderer snapshot is available.

## Findings: Native Event-woken Reply Reconciliation (2026-07-18)

- Windows Codex `26.707.12708` drives working and completion surfaces from host notifications instead of waiting for a renderer polling interval. Android should likewise use events for wake timing while keeping one authoritative state reader.
- CX-Codex Android listens to the existing authenticated SSE notification route only while tasks are active. Relevant assistant, request, turn, and thread events wake the existing Runtime Store snapshot path; event payloads never mutate task state directly.
- Reply deltas are throttled to a 750 ms wake cadence, terminal signals bypass the throttle, and an event received during a poll retains exactly one immediate follow-up. This improves visible reply freshness without parallel request storms.
- SSE is an optimization rather than a second authority. A 1.5-second reconnect and the existing 3-second batch poll preserve convergence through proxy or stream failures, and deep Android Doze still requires a future high-priority push channel for guaranteed timely delivery.

## Findings: Quiet Native Monitor Diagnostics (2026-07-19)

- Windows Codex keeps connection and completion feedback attached to compact task surfaces; transport internals are not promoted into persistent conversation chrome.
- CX-Codex Android therefore exposes sanitized task-monitor evidence through the native bridge without adding another always-visible status card. The bounded snapshot records only lifecycle state, counts, timestamps, HTTP status, and notification result—never message text, conversation ids, or server addresses.
- SSE remains a wake optimization and Runtime Store snapshots remain authoritative. Diagnostics must observe that path without mutating task state, triggering retries, or becoming a second source of completion truth.

## Findings: Android Completion Channel Recovery (2026-07-19)

- Codex desktop `26.707.91948` presents turn-completion notifications as their own setting and retains an explicit `Enable notifications` action; task completion is not inferred from a generic host-status permission.
- Android 8+ lets users disable an individual channel while leaving app-level notifications allowed. CX-Codex must therefore report the `cx_codex_task_completion_v2` channel separately and reject a false successful delivery when its importance is `IMPORTANCE_NONE`.
- Manual recovery opens the exact task-completion channel settings when only that channel is blocked. Automatic message submission remains interruption-free and never navigates to system settings.

## Findings: Periodic Long-task Review (2026-07-19)

- Codex desktop `26.707.91948` keeps elapsed work in the stable `workingFor` / `workedFor` timeline state; elapsed time alone neither marks failure nor stops execution.
- Its avatar notification actions remain bound to the owning conversation and support opening, replying, and dismissing independently. Android reminders must therefore stay actionable without mutating the native task state.
- CX-Codex now reminds after the first 10-minute silent window and then at a bounded 20-minute review cadence. The actual reminder time persists across service restarts, progress resets the cadence, and completion replaces the reminder with the terminal notification.

## Findings: Android Default-network Recovery Wake (2026-07-19)

- Codex desktop `26.707.91948` presents app-server reconnecting/restarting as bounded connection state while retaining the same conversation task; transport recovery does not directly mutate authoritative task state.
- Android default-network availability is therefore only a wake signal. CX-Codex immediately schedules the existing Runtime Store snapshot and rebuilds SSE after a known network recovery or handoff, while the snapshot remains the sole task-state authority.
- The service records its initial default network to suppress registration noise, coalesces behind an in-flight snapshot, and unregisters the callback on destruction. Network recovery counters and timestamps remain content-free diagnostics for physical-device latency review.

## Findings: Durable Native Direct-reply Confirmation (2026-07-19)

- Windows Codex `26.707.12708` binds response visibility to `clientUserMessageId` and renders reconnecting attempts as explicit bounded progress. A renderer/network exception is not authoritative proof that the user's message was rejected.
- CX-Codex Android therefore restores every dispatched task-pet reply from its persisted thread, draft, and stable `clientMessageId`, then queries `/runtime/request` before returning to thread-snapshot monitoring. Service recreation and network recovery resume confirmation without automatically replaying the prompt.
- Running or settled authority clears the reply attempt. A definite failure, or three consecutive successful not-found lookups, preserves the full draft as a non-active manual-retry row, releases SSE/poll/wake-lock ownership, emits a retry notification, and assigns a fresh id only when the user retries.

## Findings: Existing-thread Native Ownership at Submit (2026-07-19)

- Windows Codex `26.707.91948` creates outgoing conversation work under a stable `clientUserMessageId`, returns after the optimistic turn is owned by its persistent host, and marks first-response visibility against that same id. It does not wait for a renderer debounce before host ownership exists.
- CX-Codex existing-thread sends must therefore hand the durable `clientMessageId` to the Android foreground monitor immediately after optimistic activity is established. The normal 180 ms renderer watcher remains only a later convergence path, and a submit-time handoff may pass an older bridge call without delaying `/runtime/send`.
- Because an existing thread already has a terminal snapshot from its preceding turn, the native monitor must confirm the new Runtime request before polling that thread. Persisted request acceptance prevents service recreation from either rechecking the old turn as new work or falsely completing the fresh send.

## Findings: Deep-Doze Terminal Wake Authority (2026-07-19)

- Codex desktop `26.707.91948` keeps turn-completion notification policy independent from passive host status, and avatar notification actions remain bound to the exact `localConversationId`. A remote wake transport must preserve that task identity instead of broadcasting generic activity.
- CX-Codex FCM therefore targets only Android registrations subscribed to the terminal event's thread and carries only identity, method, and event sequence. Prompt and assistant content stay on the authenticated 7420 snapshot path.
- FCM is timing authority only: a delivered high-priority terminal message may wake the existing Android foreground monitor, but Runtime Store snapshots remain state authority and the existing per-task completion notification remains attention authority. Downgraded, duplicate, unrelated, or unconfigured pushes cannot settle a task.
- Device-side dedupe becomes durable only after the foreground monitor accepts the wake. A system-rejected background start records failure but cannot claim the event sequence, so a later delivery retains one recovery opportunity; successful concurrent duplicates still converge by thread and sequence.

## Findings: Non-blocking Stale Sidebar Search (2026-07-19)

- Windows Codex `26.707.12708` keeps sidebar thread identity in dedicated signal/key modules and lets `AppPrefetchImpl` start independent `startup_prefetch` queries without replacing the rendered sidebar with one blocking full-list barrier.
- CX-Codex therefore keeps persisted `thread/list` pages renderable after structural invalidation or App Server restart, marks them stale, and reconciles them in the background. Cache generations prevent a response started before the structural change from overwriting newer authority.
- A stale server search index extends the currently loaded local title filter instead of replacing it. This keeps just-created or just-renamed local rows discoverable while the full active/archived index rebuild remains non-blocking.
- First-screen supplemental rows and later cursor pages converge by stable thread identity before grouping, retaining the first visible row instead of rendering duplicate sidebar entries.

## Findings: Local Mobile Response Review (2026-07-19)

- Windows Codex `26.707.91948` implements `turn_first_response_visible` as a timing span with `request_dispatched`, `turn_started`, `first_data_received`, and `first_response_visible` marks. Its extracted renderer does not expose those latency values as a user-facing settings or diagnostics panel.
- CX-Codex keeps the desktop correlation stages but exposes its device-local rolling summary only on the optional diagnostics route because mobile send/return latency needs periodic field review. The main conversation surface remains quiet, and the stored records remain timing-and-identifier only.
- A stage needs five local samples before P95 can mark it on target or needing review. Crossing a review target is diagnostic evidence, not task failure or runtime authority; task state still comes from Runtime Store and Android uses the existing native monitor path.

## Findings: Native FCM Token Recovery Ownership (2026-07-19)

- Codex desktop owns completion attention in a persistent host and does not depend on a renderer surviving long enough to reacquire a mobile push token. Android must move that recovery boundary into the native foreground monitor whenever an active task exists.
- CX-Codex now retries a missing Firebase token from native monitor startup and later authoritative snapshot convergence. A persisted 30-second token-attempt timestamp and one process-wide in-flight guard prevent task updates or service recreation from producing a request storm.
- Token recovery changes only wake-channel readiness. Existing Runtime Store snapshots remain task authority, active-thread registration remains content-free, and builds without Firebase configuration do not start repeated token work.

## Findings: Persistent Latest-reply Authority (2026-07-19)

- Codex desktop keeps response visibility under its persistent host and correlates first data with the active turn; recreating a renderer is not a valid reason to discard already observed assistant progress.
- CX-Codex therefore serves both single and Android batch runtime snapshots through the persisted local recovery path. A restarted bridge restores the bounded reply accumulator before applying the next event, while SSE remains only a wake signal.
- The task-pet label means the newest assistant reply: streaming chunks retain separator continuity, and a completed reply longer than the mobile cache keeps its latest tail. Terminal settlement cannot replace a visible conclusion with the beginning of the same response.
- A turn may emit multiple user-visible assistant items, including commentary followed by a final answer. CX-Codex persists the owning agent item id so the first delta of a newer item replaces the previous message immediately, while later deltas for that same item continue the bounded accumulator.
- Completion diagnostics record only whether the notification body came from the authoritative latest reply, a generic terminal detail, or a reply-retry prompt. This keeps field verification possible without copying assistant content into diagnostics or delaying the terminal wake path.

## Findings: Durable Acceptance and Turn-start Timing (2026-07-19)

- Codex desktop distinguishes the request-dispatched span from `turn_started` and first-response visibility. A successful host response is already meaningful acceptance even when the final turn identity arrives on a later notification.
- CX-Codex therefore records a successful `/runtime/send` 200/202 response as server acknowledgement immediately, including the durable `starting` and `pending_start` states. Later Runtime events enrich the same timing row with turn identity and authoritative start time instead of moving the acknowledgement timestamp.
- A clean empty thread is a valid cold first-turn surface. Mobile parity regression recognizes the rendered empty state plus an enabled composer without requiring a warm-up exchange or fabricating a zero-message cache entry.

## Findings: Activity-independent Mobile Task Ownership (2026-07-19)

- Codex desktop keeps active turns in a persistent host outside any one renderer window. Closing or recreating a renderer is not task cancellation and does not erase completion attention.
- CX-Codex Android therefore keeps its foreground task-monitor Service independent from the Activity task with `stopWithTask=false`. A recent-task removal records evidence but does not stop monitoring; a genuine process recreation uses `START_STICKY` and restores persisted tasks before rebuilding polling and SSE.
- Lifecycle diagnostics expose only counts, timestamps, and a bounded start reason. They do not contain server addresses, thread identities, prompts, or replies, and they never initiate recovery themselves.

## Findings: Device-confirmed Deep-Doze Completion Wake (2026-07-19)

- Windows Codex `26.707.12708` keeps execution and completion attention in a persistent host; a transport provider accepting a signal is not equivalent to the host applying terminal conversation state or attempting notification delivery.
- CX-Codex therefore retains each FCM-accepted terminal wake in the Runtime Store outbox until the owning Android app instance reports an observed event sequence after authoritative terminal reconciliation and its completion-notification attempt. The acknowledgement contains only app-instance, thread, and event-sequence identity.
- Android persists separate claimed, locally reconciled, and server-acknowledged boundaries. A monitor killed after claim but before snapshot may be restarted by the same high-priority event; once local reconciliation is durable, redelivery retries only the authenticated acknowledgement and cannot duplicate completion attention.
- FCM remains timing authority, Runtime Store remains state authority, and the local completion channel remains attention authority. Physical Doze verification must time all three through terminal-to-notification and terminal-to-device-acknowledgement evidence.

## Findings: Trailing-edge Native Reply Refresh (2026-07-19)

- Windows Codex `26.707.12708` records `first_data_received` separately from `first_response_visible` and refreshes avatar notification rows from persistent-host conversation state. Receiving a stream event alone is therefore not proof that current reply text became visible.
- CX-Codex Android keeps SSE as a wake signal and Runtime Store snapshots as reply authority, but a reply delta coalesced inside the 750 ms leading-edge window must retain one trailing snapshot wake. Otherwise the last chunk can wait for the 3-second fallback poll when no later event arrives.
- Physical reply verification must record content-free event, snapshot-application, and expanded-overlay-render boundaries with covering event sequences. A strict latency gate may fail without copying the assistant reply into diagnostics or making the event stream a second state source.

## Findings: Token-independent Claimed-push Acknowledgement (2026-07-19)

- Windows Codex `26.707.12708` keeps avatar activity under persistent conversation state and exposes turn-completion notification policy independently from transient renderer state. A temporary local transport credential gap is therefore not proof that already applied completion attention should be forgotten.
- CX-Codex keeps the normal stored-token path as an early acknowledgement watermark, but an FCM event already claimed by the native monitor also owns a durable acknowledgement even if the cached token is temporarily absent during process recovery. Registration recovery later retries that persisted work.
- A normal completion with neither a stored token, a claimed push, nor existing pending work remains a no-op. This prevents builds without Firebase configuration from accumulating acknowledgement rows while preserving the device-confirmed outbox boundary for real push deliveries.

## Findings: Durable Exact-thread Notification Navigation (2026-07-19)

- Windows Codex `26.707.12708` avatar notification rows retain their local conversation identity and open the exact owning conversation through the persistent host.
- CX-Codex Android therefore persists the notification or overlay thread target before consuming the one-shot Intent, including before first-run server setup, and replays it after Activity, WebView, or process recreation.
- Dispatching `loadUrl` is not acknowledgement. Only Vue confirming the exact rendered thread with visible conversation content clears the pending target; another, empty, failed, or still-switching thread cannot clear it.

## Findings: Visible Navigation and Terminal Read Are Separate (2026-07-19)

- Windows Codex `26.707.12708` keeps avatar notification activation and dismissal as separate actions around the owning `localConversationId`; opening a live activity is not a request to keep reopening it until the turn stops.
- CX-Codex therefore acknowledges a persisted Android navigation target as soon as the exact thread has visible messages, even while that task is active. This prevents an active or no-progress notification from stealing navigation again on every Activity resume.
- Unread completion cleanup remains stricter: the same visible-content boundary must be met and the Vue task must no longer be running. Native state still refuses to remove any record that is not authoritatively completed.

## Findings: Terminal-before-registration Push Catch-up (2026-07-19)

- Codex desktop keeps terminal attention in a persistent host, so a renderer or credential becoming ready slightly after task completion does not erase the completed turn. Android FCM registration must preserve that ownership boundary when token acquisition or active-thread subscription loses the race with the terminal event.
- CX-Codex now checks each newly registered active thread against its persisted Runtime Store snapshot. Only a snapshot that is still terminal and whose last applied event is the matching terminal event may enter the existing content-free outbox for that device.
- A newer running/starting/waiting snapshot rejects the older terminal event. Re-registration, a simultaneous terminal callback, an earlier device acknowledgement, or service restart still converges through the existing delivery identity and acknowledgement ledger instead of creating a second wake.

## Findings: Doze-safe Periodic Long-task Review (2026-07-19)

- Windows Codex `26.707.12708` keeps long-running work under persistent `workingFor` / `workedFor` conversation state; elapsed time alone is neither failure nor authority to stop the task. Android periodic attention must preserve that boundary.
- CX-Codex therefore schedules an inexact local `setAndAllowWhileIdle` review from each persisted active-task snapshot. The review only posts attention for the exact owning conversation and advances the persisted reminder watermark; it never performs network work, invents Runtime state, or changes a task to failed/completed.
- When the foreground monitor is alive, the alarm delegates to its in-memory reconciliation. After ordinary process death, a non-exported receiver performs the same persisted dedupe directly and schedules the next review without trying to restart a killed foreground service. Progress and terminal snapshots cancel or recalculate attention; Doze delivery remains approximate rather than a false exact-time promise.

## Findings: Deep-Doze Push Readiness Proof (2026-07-19)

- Codex desktop owns execution and completion attention inside one installed persistent host; Android FCM splits that ownership across an APK Firebase client, a 7420 service credential, a registered device, and an active conversation subscription. Source support alone is not parity evidence that the wake channel is ready.
- CX-Codex therefore treats configuration, device registration, and active subscription as separate readiness gates. Android and server Firebase projects must match, the running server must have actually loaded its credential, and a real task subscription must exist before deep-Doze terminal delivery is called ready.
- Readiness diagnostics remain content-free: they expose only bounded states/counts and never print the private key, service-account email, device token, credential path, or Firebase project identity. Missing configuration is actionable deployment evidence, not a task failure or Runtime state transition.

## Findings: Immediate Active-thread Runtime Ownership (2026-07-19)

- Windows Codex `26.707.12708` was re-extracted from the installed ASAR. `app-server-manager-signals-Csn7-AWv.js` classifies `thread/start`, `turn/start`, and `turn/steer` as critical requests, commits the optimistic turn before `markRequestDispatched`, and tracks `request_dispatched` separately inside `turn_first_response_visible`.
- CX-Codex therefore must not place a fallible Runtime snapshot read between its durable browser outbox/native handoff and `/runtime/send`, even when the current thread is already active. Submit-time activity is sufficient to preserve the previous running surface if the new send fails; Runtime Store and App Server remain execution authority.
- A queued follow-up promoted through `引用` is another immediate submission boundary, not only a queue edit. It forwards the same timing and Android native-monitor callbacks as the composer path so locking the screen directly after that action cannot leave ownership dependent on the later renderer watcher.
- Promotion is a one-way ownership transfer after synchronous rejection guards: remove the queue owner before awaiting the durable send, then let its outgoing outbox bubble own offline reconnect, edit, and retry. Retaining both owners after a transport failure can duplicate the same prompt when connectivity returns.

## Findings: Complete Internal-submit Native Handoff (2026-07-19)

- Windows Codex `26.707.12708` keeps every outgoing turn under the persistent host's stable client user-message identity; retry or follow-up provenance does not make renderer lifetime the execution owner.
- CX-Codex therefore installs submit lifecycle callbacks once at the App-to-state boundary. Direct composer calls may override them, while failed-message retry, failed-new-thread retry, dictation rollback resend, and automatic queue promotion inherit the same native handoff and post-dispatch notification boundary.
- Conservative queue failure semantics remain separate from Android monitoring identity. During automatic promotion, the queue row stays the durable retry owner until acceptance, but its stable `clientMessageId` is exposed to the native task snapshot before the first await so the previous turn's terminal snapshot cannot settle the new work.

## Findings: Visible Reply Cadence and Provisional Durable Acceptance (2026-07-19)

- Windows Codex `26.707.12708` separates `request_dispatched`, `turn_started`, `first_data_received`, and `first_response_visible`. CX-Codex must likewise treat a durable threadless HTTP 202 as server acceptance without pretending that thread or turn startup has already completed.
- The provisional new-thread timing row remains bound to its stable client message id. A 202 marks server acknowledgement against `__new-thread__`, later thread binding rebinds that same row, and Runtime events add the authoritative turn identity/start time without moving the original acknowledgement timestamp.
- Browser reply rendering keeps the first assistant delta immediate, batches later deltas for at most 48 ms, and force-flushes pending tails before item/turn completion. On Android, Runtime Store remains reply authority while the expanded overlay uses a 250 ms event-wake cadence; collapsed/background monitoring stays at 750 ms, retains one trailing poll, and lets terminal events bypass throttling.
- With more active tasks than visible rows, receiving new text is not enough: the authoritative reply with the newest global event sequence promotes its owning task to the first row. Renderer snapshots are then ordered by the native progress timestamp so stale thread-list order cannot hide that reply again.
- Native diagnostics distinguish construction from visibility. A matching reply row increments render evidence only while the panel is expanded, shown, and nontransparent; a collapsed-to-expanded transition waits until its opening animation completes, so physical-device parity cannot pass on a hidden prebuilt row.

## Findings: Service-recreated Reply Visibility and Terminal Commit Boundaries (2026-07-19)

- Windows Codex `26.707.12708` keeps avatar activity and turn-completion attention under one persistent host. Recreating a renderer cannot turn an already observed reply back into unseen data or revive a terminal activity as running.
- CX-Codex Android therefore persists the exact content-free pending reply-render identity and covering global event sequence while the task panel is collapsed. Service recreation restores that boundary only when the same persisted task still owns a nonempty reply and covers the sequence; visibility is committed after the expanded panel is actually shown.
- Content-free reply, snapshot, terminal, and notification counters remain monotonic across Service recreation so a physical process-death run can compare evidence collected before and after recovery.
- Terminal attention follows a per-task durable commit boundary: the native completed snapshot and stale frontend-active removal are synchronously committed before notification delivery. Multiple tasks may settle in one batch, but process death after one notification cannot duplicate that task or erase later tasks; attempted and posted counters let the device verifier require each expected completion.

## Findings: Recovering Frontend Reply Monotonicity (2026-07-19)

- Codex desktop keeps already observed assistant progress under persistent host authority. A renderer that has restored activity metadata before message history cannot make the host forget a visible reply.
- CX-Codex Android therefore retains its persisted nonempty latest reply when an empty WebView snapshot belongs to the same task generation and carries an equal or absent event sequence. This covers renderer recovery without making the frontend a second reply authority.
- A higher event sequence or different task generation remains allowed to clear the old reply. New turns cannot inherit stale assistant content merely because both surfaces share a conversation id.

## Findings: Native Settled-state Monotonicity (2026-07-19)

- Windows Codex `26.707.91948` derives avatar-session status from persistent local-conversation state and maps only the current host-owned turn to running, waiting, failed, review, or idle. A newly recreated renderer does not own a reverse transition from settled back to active.
- CX-Codex Android therefore treats native `completed` and manual `retry` records as absorbing for every same-generation frontend `running` or `waiting` snapshot. Rejection also removes the exact stale frontend-active preference row so Service recreation cannot retry the regression.
- Event sequence is an ordering cursor, not a generation identity: the same turn may emit higher-sequence token or status metadata after its assistant item completes. Only a provably different `turnId`/activity generation remains eligible to become active, preserving legitimate follow-ups without letting recovery ordering duplicate monitoring or completion attention.

## Findings: Cross-source Task-generation Ordering (2026-07-19)

- Windows Codex `26.707.91948` keeps avatar activity rows under persistent `localConversationId` plus per-turn `turnKey`; conversation identity and turn freshness are separate host-owned boundaries.
- CX-Codex frontend task-pet payloads intentionally combine renderer activity identity/time with the independent Runtime Store event cursor. During recovery or parallel-page convergence, an older activity can therefore temporarily carry a newer cursor; event sequence alone is not proof that the activity itself is newer.
- Android different-generation reconciliation uses known `startedAtMs` values before event sequence. A later start wins, an earlier start loses even with a newer cursor, equal starts use sequence as a tie-breaker, and sequence remains the compatibility fallback only when both starts are unknown.

## Findings: Reply-content Version Ownership (2026-07-19)

- Windows Codex `26.707.91948` keeps avatar reply/session content under persistent host-owned conversation and turn state; a renderer-local message cache is not allowed to manufacture host freshness for older text.
- CX-Codex Runtime Store therefore versions `latestReply` with a dedicated `latestReplyEventSeq`. Generic task metadata may advance `lastEventSeq` without advancing the reply pair, and a new turn clears both reply text and its version.
- Renderer-local live/history text remains a fast provisional fallback but crosses the Android bridge with reply version `0`. The native monitor may seed an empty row from it, but once a versioned native reply exists, only a strictly newer authoritative reply version or a different task generation may replace it.

## Findings: Archived-thread Exclusion and Provisional Send Failure (2026-07-20)

- Windows Codex `26.707.12708` keeps archive operations in a dedicated archive context: active-thread listing is separate from `thread/unarchive`, and archived conversation ids are suppressed from the active store after archive.
- In `app-server-manager-signals-Csn7-AWv.js`, `thread/start`, `turn/start`, and `turn/steer` are critical requests. The first-turn optimistic path resolves only after its `beforeSendRequest` dispatch boundary, while background failure remains a separate rejected outcome.
- `request_dispatched`, `turn_started`, `first_data_received`, and `first_response_visible` remain separate timing marks. A provisional HTTP acceptance may show confirmation, but only an authoritative running/settled request may remove the durable outbox entry and present `已发送`.
- CX-Codex active-list augmentation must inspect each supplemental thread's session path and reject the `archived_sessions` segment. A pre-start completed `thread/read` older than `lastStartedAtIso` is history, not evidence that the new turn completed.

## Findings: Compact Latest-reply Task Preview (2026-07-20)

- Windows Codex `26.707.12708` keeps avatar activity notifications bound to their exact `localConversationId`, derives compact copy from the latest turn items, and opens that conversation through `open-in-main-window`.
- CX-Codex keeps the existing multi-task tray but adds a collapsed single-reply preview: the newest authoritative reply is primary, conversation/project context is secondary, and tapping the preview opens the exact `threadId`.
- The idle state remains the existing 48 dp bubble. A running task restores the pet plus compact reply preview, while tapping the mascot still exposes the full tray for multiple tasks and reply actions.
- Visible-reply diagnostics accept either an actually shown expanded row or an actually shown compact preview; hidden prebuilt views remain ineligible.

## Findings: Conversation Viewport Ownership and Status Layering (2026-07-20)

- The Codex desktop code extracted from the installed `26.707.12708` Windows package uses one bottom-distance scroll owner: a 24 px bottom threshold, `overflow-anchor: none`, resize-aware follow behavior, and a centered return-to-bottom control whenever the user has moved away from the live tail.
- CX-Codex follows the same ownership boundary. User scroll-away disables automatic following, returning within 24 px restores it, and the return action remains available even when no new output arrived; pending output may change the label but does not own button visibility.
- Runtime state is split by scope instead of repeated in every surface: the thread header owns compact connection/recovery, the conversation tail owns task progress, and each outgoing message owns delivery state. The former desktop thread-level phase rail was removed because it duplicated the tail state and reduced message space.
- Browser parity evidence covered 1440x900 and 393x852. At mobile width, moving 420 px away from the tail exposed the centered return action while the composer remained fixed and usable.

## Findings: Local Project Identity Mapping (2026-07-23)

- Windows Codex `26.715.72359` stores `project-order` and `pinned-project-ids` as project identities rather than filesystem paths. Local identities resolve through `local-projects`, whose records contain `id`, `name`, and `rootPaths`.
- `electron-saved-workspace-roots` remains a path list. CX-Codex must resolve local project identities to roots for its path-based sidebar model, use the local project name as the visible label, and map reordered roots back to identities before writing global state.
- Remote or otherwise unresolved project identities must remain preserved on write but stay out of the local filesystem sidebar; rendering them as `local-*` or UUID project groups is a data-model leak.
