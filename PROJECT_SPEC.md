# CX-Codex Project Specification

## Document role

This file records verified architecture and product behavior in the current repository. It is not a feature wish list.

- `PRODUCT.md` defines the durable product character.
- `PRODUCT_GOAL.md` defines the current productization gates and unfinished work.
- `release-capabilities.json` is the machine-readable installer and release contract.
- `tests.md` records acceptance contracts and dated evidence.

## Product boundary

CX-Codex is a lightweight self-hosted control layer for an OpenAI Codex runtime already available on the host. It provides a browser workspace, Windows service/install flows and an Android shell without replacing Codex Runtime or becoming a multi-user SaaS or full IDE.

The repository is maintained at <https://github.com/Qjzn/CX-Codex> under the MIT license.

## Runtime architecture

```text
Browser / Android WebView
        │ HTTP + WebSocket, SSE fallback
        ▼
Node.js 22 bridge (Express 5)
        ├─ authentication and local setup
        ├─ workspace-root file boundary
        ├─ Runtime Store (SQLite)
        ├─ replayable notification stream
        └─ one managed codex app-server child
                          │ newline JSON-RPC
                          ▼
                    Codex Runtime
```

### Authority and ownership

- Codex App Server and persisted Runtime snapshots are authoritative for thread and turn state.
- The browser durable outbox owns a send until the Runtime Store accepts the same stable `clientMessageId`.
- Runtime Store persists accepted requests, queue ownership, replay events and bounded recovery state in SQLite.
- WebSocket is the preferred notification transport; SSE is the fallback. Transport events wake reconciliation, while accepted event order and authoritative snapshots decide state.
- A 7420 process owns one managed App Server child and multiplexes JSON-RPC calls through a bounded queue.

### Safety defaults

- A new App Server launch defaults to `approvalPolicy=on-request` and `sandboxMode=workspace-write`.
- `never + danger-full-access` remains an explicit legacy high-trust compatibility choice and is surfaced as such in diagnostics.
- `--no-password` is accepted only on loopback bindings. Non-loopback and wildcard bindings require authentication before the port is opened.
- Local file browse, read, open and edit routes resolve the real path and require it to remain inside an allowed workspace root, including across Windows junctions and symbolic links.
- Detailed diagnostics pass through a final recursive redaction layer before leaving the server.

## Current technology

| Layer | Current repository contract |
|---|---|
| Runtime | Node.js `>=22.13.0` |
| Frontend | Vue `^3.5`, Vue Router `^4.6`, TypeScript `^5.7` |
| Styling/build | Tailwind CSS `^4.1`, Vite `^8.1`, vue-tsc `^3.3` |
| Server | Express `^5.1`, `ws` `^8.21`, better-sqlite3 `^12.11` |
| CLI | Commander `^15`, tsup `^8.4` |
| Android | Capacitor `^8.4` with the native Android project under `android/` |

`package.json` and the lockfile remain the version authority; this table is a readable snapshot, not an independent dependency policy.

## Major source boundaries

```text
src/
├─ App.vue                                  application shell and routing orchestration
├─ api/
│  ├─ codexGateway.ts                       typed browser-to-bridge operations
│  └─ normalizers/v2.ts                     App Server DTO to UI normalization
├─ components/
│  ├─ content/ThreadConversation.vue        virtualized conversation and feedback surfaces
│  ├─ content/ThreadComposer.vue            send, model, effort and mode controls
│  └─ sidebar/SidebarThreadTree.vue          project/thread navigation
├─ composables/
│  ├─ useDesktopState.ts                    frontend orchestration boundary
│  ├─ messageOutboxPersistence.ts           bounded cross-page durable outbox journal
│  ├─ notificationReplayCoordinator.ts      stream generation, gaps and replay
│  ├─ runtimeSnapshotOrdering.ts             stale snapshot and terminal-turn guards
│  ├─ threadFirstScreenMetrics.ts            bounded cache-first timing
│  └─ foregroundRecoveryMetrics.ts           bounded foreground convergence timing
├─ server/
│  ├─ httpServer.ts                          Express assembly and route mounting
│  ├─ appServerProcess.ts                    managed App Server transport
│  ├─ runtimeStore.ts                        SQLite Runtime Store
│  ├─ runtimeMessageQueue.ts                 persistent queue ownership
│  ├─ appServerRuntimeStart.ts               idempotent start lifecycle
│  └─ appServerRuntimeReconcileScheduler.ts  cold-start recovery and reconciliation
└─ cli/
   ├─ index.ts                               command entry point
   └─ accessPolicy.ts                        bind/authentication guard
```

Large orchestration files remain, but new independent policies belong in focused pure modules with narrow tests instead of adding another state authority.

## Implemented product capabilities

### Threads and conversations

- List, search, select, create, rename, archive, unarchive, fork and rollback threads.
- Render bounded recent history first, load older windows on demand and preserve the reading anchor.
- Stream assistant, reasoning, plan, command, file-change and MCP progress updates.
- Display runtime state, elapsed time, token usage, rate limits and pending approval requests.
- Support execute/plan collaboration modes, model/effort selection, attachments, skills and queued follow-ups.

### Reliability

- Stable `clientMessageId` identity across retry, page reload, Android handoff and 7420 restart.
- Bounded browser outbox with per-message journals and removal tombstones for cross-tab convergence.
- Replayable notification cursor with stream-generation reset, gap recovery and stale snapshot rejection.
- Transport-uncertain start/interrupt states that reconcile instead of blindly repeating an RPC.
- Cold-start resume only for a complete `pending_start` payload whose identity and prompt hash still match; a request is persisted as `starting` before `turn/start` is called.
- Cached thread messages, session-log fallback and deferred authoritative refresh for a readable first screen.

### Windows, remote access and Android

- Windows bootstrap, install, preserving/full uninstall, managed restart, active-task drain and watchdog flows.
- Password-protected local/LAN access plus optional Tailscale or Cloudflare tunnel management.
- Android WebView shell, task monitoring, foreground recovery, network recovery, notifications, optional FCM deep-Doze wake and task-pet overlay.
- Android official and debug packages use separate identities; release signing remains a release-workflow responsibility.

### Local files and diagnostics

- Workspace-scoped browse, open, preview and text editing, plus bounded attachment uploads.
- Markdown, image, PDF and DOCX preview paths.
- Health, Runtime Store, App Server, tunnel, mobile-push and timing diagnostics with sensitive-field redaction.

## Deliberate non-goals

- No organization accounts, billing, multi-tenant authorization or cloud project storage.
- No default PostgreSQL, Redis, object storage or external queue dependency.
- No promise that every experimental App Server method is surfaced.
- No automatic public exposure, high-trust sandbox, commit, push, deployment or release.

Protocol availability is tracked in `docs/app-server-protocol-matrix.zh-CN.md`; absence from the UI is not automatically a roadmap item.

## Key HTTP surfaces

| Surface | Purpose |
|---|---|
| `/auth/login` | Password login and session cookie issuance |
| `/codex-api/health` | Redacted health snapshot |
| `/codex-api/diagnostics` | Detailed redacted diagnostics |
| `/codex-api/rpc` | Restricted generic App Server RPC bridge |
| `/codex-api/ws` | Preferred realtime notification transport |
| `/codex-api/events` | SSE notification fallback |
| `/codex-api/events/replay` | Bounded persisted replay |
| `/codex-api/runtime/send` | Durable Runtime Store acceptance for a send |
| `/codex-api/runtime/request` | Lookup by request or stable client message identity |
| `/codex-api/runtime/snapshot`, `/codex-api/runtime/snapshots` | Authoritative single/batch Runtime snapshots |
| `/codex-api/state/thread/:threadId` | Bounded thread state and cached history |
| `/codex-local-image`, `/codex-local-file`, `/codex-local-browse/*`, `/codex-local-edit/*` | Workspace-scoped local file operations |
| `/codex-api/upload-file` | Bounded attachment upload |

Route modules under `src/server/` are the exact endpoint authority. The generic RPC route is not a bypass around Runtime Store ownership or local access policy.

## Browser persistence

Browser storage is an optimization and recovery aid, not a second server authority. Current bounded categories include:

- selected thread, project order/names and sidebar preferences;
- recent thread groups and recent message windows;
- durable outbox entries, per-message journals and removal tombstones;
- notification cursor/sequence, unread state and scroll anchors;
- queued follow-ups and timing-only diagnostics.

Message caches, outbox journals and timing histories have TTL/count limits. Prompt or reply text is not copied into timing diagnostics.

## Routing

| Route family | Behavior |
|---|---|
| `/` | New task/home workspace |
| `/thread/:threadId` | Conversation and task state |
| `/skills`, `/workbench`, `/github-trending`, `/diagnostics` | Secondary product surfaces; settings use an in-app modal |
| `/local-setup` | Loopback-only Windows management and pairing |
| `/__regression/*` | Deterministic local test fixtures, not navigation features |

## Development and verification

```powershell
npm ci
npm.cmd run build:frontend
npm.cmd run build:cli
npm.cmd run verify:frontend-normalizers
npm.cmd run verify:server-modules
npm.cmd run verify:governance
```

Additional gates are scope-dependent:

- `npm.cmd run test:7420:frontend` for browser behavior and performance budgets;
- `npm.cmd run verify:windows-productization` for isolated Windows lifecycle smoke;
- focused Gradle unit/lint tasks and a connected device for Android lifecycle claims;
- `npm.cmd run test:7420:soak` and explicit release verification for a release candidate.

Build success is not evidence of a browser performance pass, physical Android behavior, remote deployment or publication. Current completion state and external blockers are recorded in `PRODUCT_GOAL.md`.
