# Tests

This file tracks manual regression and feature verification steps.

## Template

### Feature: <name>

#### Prerequisites
- <required setup>

#### Steps
1. <action>
2. <action>

#### Expected Results
- <result>

#### Rollback/Cleanup
- <cleanup action, if any>

### Feature: Regression gate for older history fallback cache isolation

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Node dependencies are installed.

#### Steps
1. Run `npm.cmd run verify:server-modules`.
2. Confirm the RPC proxy smoke covers a normal `thread/read` recent request.
3. Confirm the smoke covers `thread/read` with `responseView=older`, `beforeTurnIndex`, and `turnLimit`.
4. Confirm the smoke covers malformed-session fallback for both recent and older-history reads.

#### Expected Results
- Local-only history window parameters are stripped before forwarding to Codex app-server.
- Normal older-history reads return the requested older turn window and do not update the recent thread-read cache.
- Malformed-session fallback older-history reads are still sliced as an older window and do not update the recent thread-read cache.
- Recent fallback reads can still be cached, so corrupted session recovery remains fast without polluting the cache with an older slice.

#### Rollback/Cleanup
- To roll back, revert `src/server/rpcProxyRoute.ts`, `scripts/server-module-smoke.ts`, `docs/changelog.zh-CN.md`, and this test section.

### Feature: Unified load-more affordance for remote older history

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.

#### Steps
1. Open `http://127.0.0.1:7420/#/__regression/conversation-blocks?regression=frontend`.
2. Confirm the fixture contains a `history.notice` message but no locally hidden message window.
3. Confirm the main conversation load-more affordance is visible and reads `继续加载较早历史`.
4. Click the main load-more affordance twice in quick succession.
5. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- The same load-more button handles both local window reveal and remote older-history retrieval.
- When only `history.notice` remains, clicking the button emits exactly one `loadOlderHistory` request and stays disabled while the remote older-history request is in flight.
- The frontend regression fails if the remote older-history affordance disappears, stops emitting, or emits duplicate requests on rapid taps.

#### Rollback/Cleanup
- To roll back, revert `src/components/content/ThreadConversation.vue`, `src/components/content/ConversationRegressionFixture.vue`, `scripts/regression-7420-frontend.ps1`, `docs/changelog.zh-CN.md`, and this test section.

### Feature: Regression gate for lightweight load-more window reveal

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- The real regression thread `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available and shows `继续查看更多`.

#### Steps
1. Open `http://127.0.0.1:7420/#/thread/019f27ae-0ecd-7c50-9701-8ec003e66447` at a phone viewport.
2. Wait until the route background refresh window has settled.
3. Record visible conversation item count, scrollTop, and scrollHeight.
4. Click `继续查看更多`.
5. Wait about 1.4 seconds.
6. Click `继续查看更多` again.
7. Wait about 1.4 seconds.
8. Confirm each step increases visible items or decreases the `剩余 N 条` counter by a small bounded amount, not a full-history expansion.
9. Confirm visible user context and Codex response are still present after each step.
10. Confirm scrollTop shifted roughly with scrollHeight so the reading anchor remains stable after each step.
11. Treat unrelated background `thread/list` refreshes as allowed; the load-more assertion is based on bounded DOM reveal and scroll stability.
12. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- `继续查看更多` advances only a bounded local window of earlier rendered items; virtualized DOM may reuse rows, so `剩余 N 条` decreasing is also valid progress.
- The visible window remains useful: at least one user-context item and one Codex/assistant item.
- If the currently loaded server slice contains no ordinary user message after internal context is hidden, a lightweight `当前任务` context preview remains visible after load-more.
- Repeating load-more twice on the real `分析项目` phone thread keeps each reveal bounded and preserves the reading anchor.
- The reading anchor remains stable enough that the page does not jump unexpectedly.

#### Rollback/Cleanup
- To roll back, revert `scripts/regression-7420-frontend.ps1`, `docs/changelog.zh-CN.md`, and this test section.

### Feature: Large session-log fallback history recovery

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- The real regression thread `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.

#### Steps
1. Run `npm.cmd run verify:server-modules`.
2. Restart 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
3. Open `http://127.0.0.1:7420/#/thread/019f27ae-0ecd-7c50-9701-8ec003e66447` at a phone viewport.
4. Wait until the route background refresh has settled.
5. Confirm the recovered conversation is not limited to only the current run's assistant status messages.
6. Confirm `继续查看更多` is visible when the recovered fallback history has more than one visible window.
7. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- Server smoke confirms response message lines are parsed while reasoning/compaction lines are skipped.
- Large fallback sessions retain up to 40 recent turns before frontend trimming.
- The browser shows a usable latest window and can reveal earlier recovered messages through bounded `继续查看更多` steps.

#### Rollback/Cleanup
- To roll back, revert `src/server/appServerSessionLogThreadRead.ts`, `scripts/server-module-smoke.ts`, `scripts/regression-7420-frontend.ps1`, `docs/changelog.zh-CN.md`, and this test section.

### Feature: Thread detail first usable performance gate

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- The real regression thread `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.

#### Steps
1. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.
2. In the `thread-phone` phase, confirm the script opens the real phone route.
3. Confirm the script waits for both visible user context and visible Codex/assistant response before checking settled request counts.
4. Confirm the route still passes the 9 second settle checks for duplicate state/runtime/token/root/status requests.

#### Expected Results
- The real thread becomes usable within 12 seconds, where usable means at least one user-context row and one Codex/assistant row are visible.
- The settled request-count checks still pass after the first usable content appears.
- The same run continues into the repeated `继续查看更多` bounded-progress assertions.

#### Rollback/Cleanup
- To roll back, revert `scripts/regression-7420-frontend.ps1`, `docs/changelog.zh-CN.md`, and this test section.

### Feature: Backfill visible user context in latest conversation window

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- The real regression thread `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.

#### Steps
1. Open `http://127.0.0.1:7420/#/thread/019f27ae-0ecd-7c50-9701-8ec003e66447` at a phone viewport.
2. Wait about 3 seconds and inspect the visible conversation window.
3. Confirm the visible window contains either a real user message or a lightweight previous-user context preview, and at least one Codex/assistant response.
4. Confirm the page still does not expose an actual internal context block such as `<codex_internal_context source=...>`.
5. Confirm entering the thread does not trigger `/codex-api/rpc` `thread/list` during the first visible-window check.
6. Run `npm.cmd run build`.
7. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
8. Run `npm.cmd run verify:server-modules`.
9. Run `npm.cmd run verify:frontend-normalizers`.
10. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
11. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- The latest conversation window is no longer assistant-only when a previous user message can provide context.
- Context backfill uses a lightweight preview when the previous user message is too far away, so it does not expand the full history.
- The frontend regression fails if the real thread first visible window lacks either user context or an assistant response.
- The real thread remains nonblank, keeps the correct title, and does not show internal context.

#### Rollback/Cleanup
- To roll back, revert `src/components/content/ThreadConversation.vue`, `scripts/regression-7420-frontend.ps1`, `docs/changelog.zh-CN.md`, and this test section.

### Feature: Hide internal Codex context messages from conversation UI

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- The real regression thread `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available and contains an internal goal/context message.

#### Steps
1. Open `http://127.0.0.1:7420/#/thread/019f27ae-0ecd-7c50-9701-8ec003e66447` at a phone viewport.
2. Wait about 2.5 seconds and inspect the visible conversation body.
3. Confirm the page title still shows `分析项目`.
4. Confirm `document.body.innerText` does not include `<codex_internal_context`.
5. Run `npm.cmd run build`.
6. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
7. Run `npm.cmd run verify:server-modules`.
8. Run `npm.cmd run verify:frontend-normalizers`.
9. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
10. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- Internal Codex context messages are hidden from the normal conversation UI.
- The real `分析项目` thread remains nonblank and keeps the correct title.
- The frontend regression fails if any checked page exposes `<codex_internal_context` in visible text.
- Sidebar data and frontend gates still pass with the required `分析项目` thread.

#### Rollback/Cleanup
- To roll back, revert `src/App.vue`, `src/components/content/ThreadConversation.vue`, `scripts/regression-7420-frontend.ps1`, `docs/changelog.zh-CN.md`, and this test section.

### Feature: Use cached title for route-only thread header

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- The real regression thread `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.
- Browser request capture can inspect `/codex-api/rpc` calls during startup.

#### Steps
1. Open `http://127.0.0.1:7420/#/thread/019f27ae-0ecd-7c50-9701-8ec003e66447` at a 390x844 phone viewport.
2. Wait about 2.5 seconds and inspect the header title.
3. Confirm visible content is from the target conversation, not an empty page.
4. Capture `/codex-api/rpc` requests for the first 5 seconds after navigation.
5. Confirm no `thread/list` RPC runs in the first 5 seconds.
6. Run `npm.cmd run build`.
7. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
8. Run `npm.cmd run verify:server-modules`.
9. Run `npm.cmd run verify:frontend-normalizers`.
10. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
11. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- The route-only thread header shows `分析项目` from the lightweight title cache instead of the first message fallback.
- Internal context such as `<codex_internal_context ...>` never appears as the visible title.
- The current thread content still renders before the delayed full thread-list refresh.
- The first 5 second `/codex-api/rpc` window does not include `thread/list`.
- The 7420 sidebar and frontend regression gates still pass with the required `分析项目` thread.

#### Rollback/Cleanup
- To roll back, revert `src/App.vue`, `src/composables/useDesktopState.ts`, `docs/changelog.zh-CN.md`, and this test section.

### Feature: Defer startup model preference refresh after first screen

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- The real regression thread `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.

#### Steps
1. Open `http://127.0.0.1:7420/#/thread/019f27ae-0ecd-7c50-9701-8ec003e66447` at a phone viewport.
2. Inspect `/codex-api/rpc` request bodies and timings during startup.
3. Confirm startup `model/list` and `config/read` do not start in the initial thread message load window.
4. Confirm the Composer still renders the locally saved selected model before model metadata refresh finishes.
5. Confirm explicit `refreshAll()` paths that do not request deferral still refresh model preferences immediately.
6. Run `npm.cmd run verify:server-modules`.
7. Run `npm.cmd run verify:frontend-normalizers`.
8. Run `npm.cmd run build`.
9. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
10. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
11. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- Startup initialization schedules model preference refresh after the short idle delay instead of immediately racing the real thread first screen.
- Local selected model state remains available for Composer before metadata refresh completes.
- Workbench/manual refresh paths that call `refreshAll()` without deferral still trigger immediate model preference refresh.
- The real `分析项目` phone thread page and conversation fixtures remain nonblank.

#### Rollback/Cleanup
- To roll back, revert `src/App.vue`, `src/composables/useDesktopState.ts`, `docs/changelog.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-07 measurement before fix: opening the real `分析项目` phone thread produced `model/list` and `config/read` at about `267ms`; `config/read` took about `242ms` in that run, while another run showed `model/list` can take more than 2 seconds.
- 2026-07-07 post-fix CDP measurement: opening the same real phone thread produced only `thread/list` in the first startup RPC window; `skills/list`, `config/read`, and `model/list` all started around `2537ms` or later, while the page still rendered one message card and local selected model text.
- 2026-07-07 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`.
- 2026-07-07 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-07 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-07 deploy: latest build was restarted on local 7420 as PID `52272`, version `2.2.8`, with `/health` returning `ok`.
- 2026-07-07 gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed with required thread project `codexui`.
- 2026-07-07 gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation fixtures, and the real phone thread page.

### Feature: Defer thread route list refresh past first screen

#### Prerequisites
- Local 7420 can be rebuilt and restarted from `E:\javaword\CXCodex\codexui`.
- The real regression thread `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.
- A browser context can open the thread route at phone width and capture `/codex-api/rpc` requests.

#### Steps
1. Open `http://127.0.0.1:7420/#/thread/019f27ae-0ecd-7c50-9701-8ec003e66447` at phone width.
2. Capture `/codex-api/rpc` requests for the first 5 seconds after navigation.
3. Confirm the current thread content renders without `thread/list` in that first 5 second request window.
4. Continue capturing until at least 11 seconds after navigation.
5. Confirm first notification recovery and active sync boost keep `thread/list` out of the first 5 seconds while an active thread is selected.
6. Confirm the delayed background `thread/list` refresh still runs later and may continue normal cursor pagination.
7. Confirm manual refresh and `test:7420:sidebar-data` still read full thread-list pagination.
8. Run `npm.cmd run build`.
9. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
10. Run `npm.cmd run verify:server-modules`.
11. Run `npm.cmd run verify:frontend-normalizers`.
12. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
13. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- The real `分析项目` thread page remains nonblank and usable at phone width.
- Direct thread route entry no longer performs full `thread/list` pagination in the first 5 seconds.
- Delayed background refresh still updates the sidebar after the first screen and lower-priority model/skills work have had time to complete.
- Sidebar data and real thread browser regression continue to pass.

#### Rollback/Cleanup Notes
- To roll back, revert `src/App.vue`, `src/composables/useDesktopState.ts`, `docs/changelog.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-07 measurement before fix: phone-width open of the real `分析项目` thread rendered content, but the first 5 second RPC window still contained two `thread/list` pages.
- 2026-07-07 measurement after fix: phone-width open of the same real thread rendered visible message cards while the first 5 second `/codex-api/rpc` window was empty; by the later background window, normal `thread/list` cursor pagination, selected cwd `skills/list`, and model/config refresh had started.
- 2026-07-07 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-07 deploy: latest build was restarted on local 7420 as PID `42068`, version `2.2.8`, with `/health` returning `ok`.
- 2026-07-07 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`.
- 2026-07-07 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-07 gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed with `activeFirstPageCount=120`, `archivedFirstPageCount=100`, and required thread project `codexui`.
- 2026-07-07 gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation fixtures, and the real phone thread page.

### Feature: Defer selected thread skills after first background window

#### Prerequisites
- Local 7420 can be rebuilt and restarted from `E:\javaword\CXCodex\codexui`.
- The real regression thread `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.
- A browser context can open the thread route at phone width and capture `/codex-api/rpc` requests.

#### Steps
1. Open `http://127.0.0.1:7420/#/thread/019f27ae-0ecd-7c50-9701-8ec003e66447` at phone width.
2. Capture `/codex-api/rpc` requests for the first 5 seconds after navigation.
3. Confirm the thread title and message cards render without a selected cwd `skills/list` request.
4. Continue capturing until at least 9 seconds after navigation.
5. Confirm the selected cwd `skills/list` runs as delayed background work if the same thread is still selected.
6. Confirm skills changed notifications and explicit skill-center refresh paths still use their existing immediate or short-debounce refresh behavior.
7. Run `npm.cmd run build`.
8. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
9. Run `npm.cmd run verify:server-modules`.
10. Run `npm.cmd run verify:frontend-normalizers`.
11. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
12. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- The real `分析项目` thread page remains nonblank and usable at phone width.
- Selected cwd `skills/list` no longer runs in the first 5 seconds of real thread entry.
- The selected cwd skills refresh still happens later as background work for the active thread.
- Sidebar data and real thread browser regression continue to pass.

#### Rollback/Cleanup Notes
- To roll back, revert `src/composables/useDesktopState.ts`, `docs/changelog.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-07 measurement before fix: phone-width open of the real `分析项目` thread rendered content, but selected cwd `skills/list` still appeared in the first 5 second request window.
- 2026-07-07 measurement after fix: phone-width open of the same real thread rendered `分析项目` with visible message cards; the first 5 second RPC window contained only `thread/list`, and selected cwd `skills/list` appeared later in the background window.
- 2026-07-07 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-07 deploy: latest build was restarted on local 7420 as PID `55128`, version `2.2.8`, with `/health` returning `ok`.
- 2026-07-07 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`.
- 2026-07-07 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-07 gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed with `activeFirstPageCount=120`, `archivedFirstPageCount=100`, and required thread project `codexui`.
- 2026-07-07 gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation fixtures, and the real phone thread page.

### Feature: Defer model preferences past thread first screen

#### Prerequisites
- Local 7420 can be rebuilt and restarted from `E:\javaword\CXCodex\codexui`.
- The real regression thread `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.
- A browser context can open the thread route at phone width and capture `/codex-api/rpc` requests.

#### Steps
1. Open `http://127.0.0.1:7420/#/thread/019f27ae-0ecd-7c50-9701-8ec003e66447` at phone width.
2. Capture `/codex-api/rpc` requests for the first 5 seconds after navigation.
3. Confirm the thread title and latest conversation content render without waiting for `model/list` or `config/read`.
4. Continue capturing until at least 8 seconds after navigation.
5. Confirm `model/list` and `config/read` run as delayed background work after the first thread screen is already usable.
6. Run `npm.cmd run build`.
7. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
8. Run `npm.cmd run verify:server-modules`.
9. Run `npm.cmd run verify:frontend-normalizers`.
10. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
11. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- The real `分析项目` thread page remains nonblank and usable at phone width.
- `model/list` and `config/read` no longer run around 2 seconds after thread reload.
- Composer still shows the locally selected model/reasoning settings before the delayed model metadata refresh completes.
- Sidebar data and real thread browser regression continue to pass.

#### Rollback/Cleanup Notes
- To roll back, revert `src/composables/useDesktopState.ts`, `docs/changelog.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-07 measurement before fix: phone-width open of the real `分析项目` thread rendered content, but still requested `model/list` and `config/read` during the early startup window alongside delayed background list/skills work.
- 2026-07-07 measurement after fix: phone-width open of the same real thread rendered `分析项目` with visible message cards, and `model/list` / `config/read` moved to the later background window after the first screen was already usable.
- 2026-07-07 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-07 deploy: latest build was restarted on local 7420 as PID `69612`, version `2.2.8`, with `/health` returning `ok`.
- 2026-07-07 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`.
- 2026-07-07 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-07 gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed with `activeFirstPageCount=120`, `archivedFirstPageCount=100`, and required thread project `codexui`.
- 2026-07-07 gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation fixtures, and the real phone thread page.

### Feature: Defer thread selection skills refresh after first screen

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- The real regression thread `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.

#### Steps
1. Open `http://127.0.0.1:7420/#/thread/019f27ae-0ecd-7c50-9701-8ec003e66447` at a phone viewport.
2. Inspect `/codex-api/rpc` request bodies for the first few seconds.
3. Confirm thread messages render before the selected cwd `skills/list` request starts.
4. Confirm switching away before the delay cancels the stale selected-thread skills refresh.
5. Run `npm.cmd run verify:server-modules`.
6. Run `npm.cmd run verify:frontend-normalizers`.
7. Run `npm.cmd run build`.
8. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
9. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
10. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- Opening a thread does not start selected cwd `skills/list` during the initial message load path.
- The selected cwd skills refresh runs after the short idle delay if the user is still on the same thread.
- Skills changed notifications and explicit page-level refreshes still call the immediate skills refresh path.
- The real `分析项目` phone thread page and conversation fixtures remain nonblank.

#### Rollback/Cleanup
- To roll back, revert `src/composables/useDesktopState.ts`, `docs/changelog.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-07 measurement before fix: opening the real `分析项目` phone thread produced a selected cwd `skills/list` RPC at about `460ms` after the first RPC, with about `615ms` duration.
- 2026-07-07 post-fix CDP measurement: opening the same real phone thread delayed the selected cwd `skills/list`; a 10 second check showed it running in the background at about `2061ms`, with cwd `E:\javaword\CXCodex\codexui`.
- 2026-07-07 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`.
- 2026-07-07 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-07 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-07 deploy: latest build was restarted on local 7420 as PID `14316`, version `2.2.8`, with `/health` returning `ok`.
- 2026-07-07 gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed with required thread project `codexui`.
- 2026-07-07 gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation fixtures, and the real phone thread page.

### Feature: Skip duplicate settled thread/read after fresh state snapshot

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- The real regression thread `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.

#### Steps
1. Open `http://127.0.0.1:7420/#/thread/019f27ae-0ecd-7c50-9701-8ec003e66447` at a phone viewport.
2. Inspect the first few seconds of `/codex-api/` requests.
3. Confirm `/codex-api/state/thread/<threadId>` can provide the fresh message snapshot.
4. Confirm the frontend does not immediately issue an extra settled `thread/read` RPC when that fresh snapshot has not dropped existing messages.
5. Run `npm.cmd run verify:server-modules`.
6. Run `npm.cmd run verify:frontend-normalizers`.
7. Run `npm.cmd run build`.
8. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
9. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
10. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- Fresh settled `/codex-api/state/thread` responses mark their refresh key as already synced for message补齐.
- The duplicate settled `thread/read`补读 is skipped when the state snapshot already contains fresh messages and does not miss previously retained messages.
- If older history has already been loaded or a snapshot drops previous messages, the existing protection still allows补读/preserve behavior.
- The 7420 frontend regression continues to pass the path-specific thread state/runtime/token usage guards for the real thread page.

#### Rollback/Cleanup
- To roll back, revert `src/composables/useDesktopState.ts`, `docs/changelog.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-07 measurement before fix: opening the real `分析项目` phone thread produced `/codex-api/state/thread/019f27ae-0ecd-7c50-9701-8ec003e66447` at about `299ms` with about `2653ms` duration, followed by another `/codex-api/rpc` at about `3016ms` with about `582ms` duration.
- 2026-07-07 post-fix CDP measurement: opening the same real phone thread produced RPC methods `thread/list`, `thread/list`, `model/list`, `config/read`, and `skills/list`; no immediate settled `thread/read`补读 appeared after the fresh `/state/thread` snapshot.
- 2026-07-07 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`.
- 2026-07-07 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-07 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-07 deploy: latest build was restarted on local 7420 as PID `11416`, version `2.2.8`, with `/health` returning `ok`.
- 2026-07-07 gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed with required thread project `codexui`.
- 2026-07-07 gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation fixtures, and the real phone thread page.

### Feature: Compact conversation and composer chrome

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- Screenshot capture directory `output/regression-7420/compact-conversation-ui/` may be regenerated for visual confirmation.

#### Steps
1. Open a thread route at desktop width and confirm the runtime status strip is a compact single-row control, not a tall explanatory banner.
2. Confirm normal settled/running states do not show low-value explanatory text such as "latest result landed" or microphone usage tutorials.
3. Confirm guided turn summaries render as a compact `阶段回复` control with a short count.
4. Open `http://127.0.0.1:7420/#/__regression/composer-shell?regression=frontend` at 1440x900, 393x852, and 884x1104.
5. Confirm the empty Composer starts from one textarea row, has no idle dictation helper text, and keeps a lighter shadow.
6. Run `git diff --check -- scripts/regression-7420-frontend.ps1 src/style.css src/components/content/RuntimeStatusBar.vue src/components/content/ThreadConversation.vue src/components/content/ThreadComposer.vue`.
7. Run `npm.cmd run build:frontend`.
8. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -CaptureScreenshots -ScreenshotTaskName compact-conversation-ui`.

#### Expected Results
- Runtime status bar height is at most 40px on desktop conversation fixtures and at most 48px on phone fixtures.
- Composer fixture does not render `.thread-composer-dictation-helper` while idle.
- Composer shell height stays between 82px and 112px in the regression fixture.
- `composer-shell-fixture-desktop.png`, `composer-shell-fixture-phone.png`, and `conversation-blocks-fixture.png` show less explanatory chrome and reduced vertical occupancy.
- The 7420 frontend health precondition tolerates bounded read-only status polling backlog from `mcpServerStatus/list` / `account/rateLimits/read`, but still blocks pending server requests, active plan-mode turns, uncertain runtime requests, and non-status queued work.

#### Rollback/Cleanup Notes
- Screenshot files under `output/regression-7420/compact-conversation-ui/` are local verification artifacts and are not required in git.
- To roll back, revert `src/components/content/RuntimeStatusBar.vue`, `src/components/content/ThreadConversation.vue`, `src/components/content/ThreadComposer.vue`, `src/style.css`, `scripts/regression-7420-frontend.ps1`, changelog entry, and this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check -- scripts/regression-7420-frontend.ps1 src/style.css src/components/content/RuntimeStatusBar.vue src/components/content/ThreadConversation.vue src/components/content/ThreadComposer.vue` passed.
- 2026-07-05 frontend build: `npm.cmd run build:frontend` passed, including `vue-tsc --noEmit` and Vite build; Vite still reports the existing large chunk warning.
- 2026-07-05 screenshot regression: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -CaptureScreenshots -ScreenshotTaskName compact-conversation-ui` passed.
- 2026-07-05 visual evidence: regenerated `output/regression-7420/compact-conversation-ui/composer-shell-fixture-desktop.png` showed a shorter empty Composer with no dictation helper text, and `output/regression-7420/compact-conversation-ui/conversation-blocks-fixture.png` showed the runtime status as a compact single-row strip.

### Feature: P4 sidebar primary actions parity baseline

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- Screenshot capture directory `output/regression-7420/p5-screenshot-baseline/` may be regenerated for visual confirmation.

#### Steps
1. Open `http://127.0.0.1:7420/#/` at 1440x900.
2. Confirm the sidebar starts with small auxiliary toolbar icons only for shell controls, followed by textual `新会话` and `搜索` rows.
3. Confirm `新会话` and `搜索` align with the command-list rhythm below them instead of rendering as round icon-only buttons.
4. Reopen the home route at 884x1104 and confirm the primary action rows stay vertical without horizontal overflow.
5. Run `git diff --check -- src/App.vue scripts/regression-7420-frontend.ps1`.
6. Run `npm.cmd run build:frontend`.
7. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -CaptureScreenshots -ScreenshotTaskName p5-screenshot-baseline`.

#### Expected Results
- Sidebar primary actions contain at least two `.sidebar-primary-action` rows and matching `.sidebar-primary-action-icon` icons.
- The primary action group uses `display: flex` with `flex-direction: column`.
- Primary action row radius stays no larger than 10px and minimum row height stays at least 30px.
- `home-desktop.png` shows `新会话` and `搜索` as left-aligned icon + label rows above `工作台`.
- `home-foldable.png` keeps the same primary-action layout with no horizontal overflow.
- The 7420 frontend health precondition still blocks queued RPC, pending server requests, active plan turns, and uncertain runtime requests, while tolerating up to two background status RPC calls.

#### Rollback/Cleanup Notes
- Screenshot files under `output/regression-7420/p5-screenshot-baseline/` are local verification artifacts and are not required in git.
- To roll back, revert `src/App.vue`, `scripts/regression-7420-frontend.ps1`, changelog entry, and this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check -- src/App.vue scripts/regression-7420-frontend.ps1` passed.
- 2026-07-05 frontend build: `npm.cmd run build:frontend` passed, including `vue-tsc --noEmit` and Vite build; Vite still reports the existing large chunk warning.
- 2026-07-05 screenshot regression: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -CaptureScreenshots -ScreenshotTaskName p5-screenshot-baseline` passed.
- 2026-07-05 health note: `/codex-api/health` reported `pendingRpcCount=2`, `queuedRpcCount=0`, `pendingServerRequestCount=0`, `activePlanModeTurnCount=0`, and `uncertainRequestCount=0`; the persistent pending calls matched background `mcpServerStatus/list` polling, so the frontend regression gate now tolerates that background condition while still blocking real queued or uncertain work.
- 2026-07-05 visual evidence: regenerated `output/regression-7420/p5-screenshot-baseline/home-desktop.png` and `home-foldable.png` showed `新会话` and `搜索` as vertical icon + label primary rows above the command list.

### Feature: P4 sidebar command list parity baseline

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- Screenshot capture directory `output/regression-7420/p5-screenshot-baseline/` may be regenerated for visual confirmation.

#### Steps
1. Open `http://127.0.0.1:7420/#/` at 1440x900.
2. Confirm the sidebar top navigation renders as a vertical icon + label command list instead of a 2x2 button grid.
3. Confirm command rows use compact neutral styling, small radius, left-aligned labels, and a consistent icon style.
4. Reopen the home route at 884x1104 and confirm the command list remains vertical without pushing the main content too narrow.
5. Run `git diff --check -- src/App.vue scripts/regression-7420-frontend.ps1`.
6. Run `npm.cmd run build:frontend`.
7. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -CaptureScreenshots -ScreenshotTaskName p5-screenshot-baseline`.

#### Expected Results
- Sidebar top navigation contains at least three `.sidebar-command-link` rows and matching `.sidebar-command-icon` icons.
- The command list uses `display: flex` with `flex-direction: column`, not a two-column grid.
- Command row radius stays no larger than 10px and minimum row height stays at least 30px.
- `home-desktop.png` shows a continuous left command list above thread groups.
- `home-foldable.png` keeps the same command-list layout with no horizontal overflow.

#### Rollback/Cleanup Notes
- Screenshot files under `output/regression-7420/p5-screenshot-baseline/` are local verification artifacts and are not required in git.
- To roll back, revert `src/App.vue`, `scripts/regression-7420-frontend.ps1`, changelog entry, and this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check -- src/App.vue scripts/regression-7420-frontend.ps1` passed.
- 2026-07-05 frontend build: `npm.cmd run build:frontend` passed, including `vue-tsc --noEmit` and Vite build; Vite still reports the existing large chunk warning.
- 2026-07-05 screenshot regression: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -CaptureScreenshots -ScreenshotTaskName p5-screenshot-baseline` passed.
- 2026-07-05 visual evidence: regenerated `output/regression-7420/p5-screenshot-baseline/home-desktop.png` showed the sidebar command area as vertical icon + label rows instead of the previous 2x2 entry grid.

### Feature: P5 frontend screenshot regression capture

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- `agent-browser` is available in `PATH`.
- Built-in regression fixture routes `/#/__regression/sidebar-rows`, `/#/__regression/composer-shell`, and `/#/__regression/conversation-blocks` are available.

#### Steps
1. Run `git diff --check -- scripts/regression-7420-frontend.ps1`.
2. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -CaptureScreenshots -ScreenshotTaskName p5-screenshot-baseline`.
3. Open `output/regression-7420/p5-screenshot-baseline/`.
4. Confirm the directory contains screenshots for home desktop/foldable, phone utility pages, sidebar fixture, Composer desktop/phone/foldable, and conversation desktop/phone/foldable.
5. Confirm screenshot capture remains opt-in; running `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420` should still perform DOM assertions without writing screenshots.

#### Expected Results
- The script creates `output/regression-7420/p5-screenshot-baseline/` when `-CaptureScreenshots` is supplied.
- Screenshot filenames are stable and sanitized from regression result names.
- The home foldable screenshot is captured after the settings panel is closed, and the foldable shell assertion fails if `.sidebar-settings-panel` is still open.
- The screenshot matrix includes:
  - `home-desktop.png`
  - `home-foldable.png`
  - `skills-phone.png`
  - `github-trending-phone.png`
  - `diagnostics-phone.png`
  - `local-preview-phone.png`
  - `sidebar-rows-fixture-phone.png`
  - `composer-shell-fixture-desktop.png`
  - `composer-shell-fixture-phone.png`
  - `composer-shell-fixture-foldable.png`
  - `conversation-blocks-fixture.png`
  - `conversation-blocks-fixture-phone.png`
  - `conversation-blocks-fixture-foldable.png`
- The regression still runs all DOM assertions before or alongside screenshot capture, including desktop, phone, and 884x1104 foldable checks.

#### Rollback/Cleanup Notes
- Screenshot files under `output/regression-7420/p5-screenshot-baseline/` are local verification artifacts and are not required in git.
- To clean local artifacts, delete `output/regression-7420/p5-screenshot-baseline/`.
- To roll back the feature, revert `scripts/regression-7420-frontend.ps1`, changelog entry, and this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check -- scripts/regression-7420-frontend.ps1` passed.
- 2026-07-05 screenshot regression: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -CaptureScreenshots -ScreenshotTaskName p5-screenshot-baseline` passed.
- 2026-07-05 generated screenshots: `output/regression-7420/p5-screenshot-baseline/` contained 13 PNG files: `home-desktop.png`, `home-foldable.png`, `skills-phone.png`, `github-trending-phone.png`, `diagnostics-phone.png`, `local-preview-phone.png`, `sidebar-rows-fixture-phone.png`, `composer-shell-fixture-desktop.png`, `composer-shell-fixture-phone.png`, `composer-shell-fixture-foldable.png`, `conversation-blocks-fixture.png`, `conversation-blocks-fixture-phone.png`, and `conversation-blocks-fixture-foldable.png`.
- 2026-07-05 screenshot pollution guard: regenerated `home-foldable.png` showed the normal home shell instead of the settings panel, and the foldable shell assertion now checks that `.sidebar-settings-panel` is absent.
- 2026-07-05 screenshot capture note: screenshots are produced by `agent-browser screenshot`, not Playwright, so this remains compatible with the project rule that Playwright runs only when explicitly requested.

### Feature: App Server runtime thread reconciler helper

#### Prerequisites
- Current repository includes `src/server/appServerRuntimeRequestReconciliation.ts`, `src/server/codexAppServerBridge.ts`, and `scripts/server-module-smoke.ts`.
- Dependencies are installed so TypeScript, Vite, tsup, and the server module smoke verifier can run.

#### Steps
1. Run `git diff --check`.
2. Run `node scripts\verify-server-modules.mjs`.
3. Run `node_modules\.bin\vue-tsc.cmd --noEmit`.
4. Run `node_modules\.bin\vite.cmd build`.
5. Run `node_modules\.bin\tsup.cmd`.
6. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
7. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- Runtime reconciliation still reads a fresh thread runtime snapshot before updating runtime requests.
- Active runtime requests are still selected with `RUNTIME_REQUEST_RECONCILE_ACTIVE_STATUSES`.
- Runtime requests are still patched from the reconciled snapshot state, active turn id, and last error.
- `codexAppServerBridge.ts` creates `reconcileRuntimeThread` through `createRuntimeThreadReconciler()` instead of owning the reconciliation closure body.

#### Rollback/Cleanup Notes
- No runtime artifacts need cleanup beyond normal build output in `dist/`, `dist-cli/`, and `output/`.
- To roll back, revert `src/server/appServerRuntimeRequestReconciliation.ts`, `src/server/codexAppServerBridge.ts`, `scripts/server-module-smoke.ts`, and this test section.

#### Regression Evidence
- 2026-07-04 static verification: `git diff --check` passed.
- 2026-07-04 server module smoke: `node scripts\verify-server-modules.mjs` passed, including `createRuntimeThreadReconciler()` coverage for reading a runtime snapshot, selecting active runtime requests, patching request state from the reconciled snapshot, and returning the same snapshot.
- 2026-07-04 typecheck/build: `node_modules\.bin\vue-tsc.cmd --noEmit`, `node_modules\.bin\vite.cmd build`, and `node_modules\.bin\tsup.cmd` passed; Vite still reports the existing large chunk warning.
- 2026-07-04 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-04 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: App Server unknown thread item fallback

#### Prerequisites
- Current repository includes `src/api/normalizers/v2.ts`, `scripts/verify-frontend-normalizers.mjs`, `package.json`, and `docs/app-server-protocol-matrix.zh-CN.md`.
- Dependencies are installed so esbuild, TypeScript, Vite, tsup, server module smoke, governance, and release verification can run.

#### Steps
1. Open `src/api/normalizers/v2.ts` and confirm unknown top-level `ThreadItem.type` values return a `UiMessage` with `role: 'system'`, `messageType: 'unhandled.<type>'`, `rawPayload`, and `isUnhandled: true`.
2. Confirm invalid/non-object turn items are wrapped as `type: 'invalidItem'` before normalization instead of throwing or being silently skipped.
3. Run `node scripts\verify-frontend-normalizers.mjs`.
4. Run `git diff --check`.
5. Run `node scripts\verify-server-modules.mjs`.
6. Run `node_modules\.bin\vue-tsc.cmd --noEmit`.
7. Run `node_modules\.bin\vite.cmd build`.
8. Run `node_modules\.bin\tsup.cmd`.
9. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
10. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- Known `agentMessage` items still render as assistant messages.
- Unknown App Server turn items such as `threadShellCommandOutput` render as an unhandled system raw message with the original payload preserved for diagnostics.
- Invalid items such as `null` do not crash normalization and become `unhandled.invalidItem`.
- Server module smoke remains focused on server modules; frontend normalizer behavior is covered by `verify:frontend-normalizers`.
- Typecheck, build, governance, and release verification complete without new errors.

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required beyond normal build output in `dist/`, `dist-cli/`, `output/frontend-normalizer-smoke/`, `output/server-module-smoke/`, and `output/release-package-smoke/`.
- To roll back, restore the previous unknown item skip behavior in `src/api/normalizers/v2.ts`, remove `scripts/verify-frontend-normalizers.mjs` and its `package.json` script, then revert the protocol matrix, changelog, and this test section.

#### Regression Evidence
- 2026-07-04 frontend normalizer smoke: `node scripts\verify-frontend-normalizers.mjs` passed with `frontend normalizer smoke ok`, covering known item, unknown `threadShellCommandOutput`, and invalid `null` item normalization.
- 2026-07-04 static verification: `git diff --check` passed.
- 2026-07-04 server module smoke: `node scripts\verify-server-modules.mjs` passed with `server module smoke ok`.
- 2026-07-04 typecheck/build: `node_modules\.bin\vue-tsc.cmd --noEmit`, `node_modules\.bin\vite.cmd build`, and `node_modules\.bin\tsup.cmd` passed; Vite still reports the existing large chunk warning.
- 2026-07-04 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-04 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: App Server thread source read-only metadata

#### Prerequisites
- Current repository includes `src/api/normalizers/v2.ts`, `src/types/codex.ts`, `src/composables/useDesktopState.ts`, `scripts/verify-frontend-normalizers.mjs`, and `docs/app-server-protocol-matrix.zh-CN.md`.
- Dependencies are installed so esbuild, TypeScript, Vite, tsup, server module smoke, governance, and release verification can run.

#### Steps
1. Open `src/api/normalizers/v2.ts` and confirm `Thread.source` is normalized into `UiThread.sourceKind`.
2. Confirm string sources such as `cli` stay unchanged, `subAgent` tagged union values become `subAgent.<variant>`, and future unknown tagged sources keep their tag name instead of throwing.
3. Open `src/composables/useDesktopState.ts` and confirm `areThreadFieldsEqual(...)` compares `sourceKind`, so source changes are not hidden by object reuse.
4. Run `node scripts\verify-frontend-normalizers.mjs`.
5. Run `git diff --check`.
6. Run `node scripts\verify-server-modules.mjs`.
7. Run `node_modules\.bin\vue-tsc.cmd --noEmit`.
8. Run `node_modules\.bin\vite.cmd build`.
9. Run `node_modules\.bin\tsup.cmd`.
10. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
11. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- Thread list normalization preserves App Server source metadata without adding a user-facing source filter or changing thread grouping.
- `cli`, `subAgent.thread_spawn`, and future unknown tagged source values are retained as read-only `sourceKind`.
- Existing unknown item fallback coverage in `verify-frontend-normalizers` continues to pass.
- Typecheck, build, governance, and release verification complete without new errors.

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required beyond normal build output in `dist/`, `dist-cli/`, `output/frontend-normalizer-smoke/`, `output/server-module-smoke/`, and `output/release-package-smoke/`.
- To roll back, remove `UiThread.sourceKind`, source normalization helpers, the equality comparison, the frontend normalizer smoke assertions, and the protocol matrix/changelog/test documentation updates.

#### Regression Evidence
- 2026-07-04 frontend normalizer smoke: `node scripts\verify-frontend-normalizers.mjs` passed with `frontend normalizer smoke ok`, covering `cli`, `subAgent.thread_spawn`, and future tagged source normalization.
- 2026-07-04 static verification: `git diff --check` passed.
- 2026-07-04 server module smoke: `node scripts\verify-server-modules.mjs` passed with `server module smoke ok`.
- 2026-07-04 typecheck/build: `node_modules\.bin\vue-tsc.cmd --noEmit`, `node_modules\.bin\vite.cmd build`, and `node_modules\.bin\tsup.cmd` passed; Vite still reports the existing large chunk warning.
- 2026-07-04 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-04 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: App Server turn items view fallback

#### Prerequisites
- Current repository includes `src/api/normalizers/v2.ts`, `scripts/verify-frontend-normalizers.mjs`, `docs/app-server-protocol-matrix.zh-CN.md`, and the raw schema audit output that records `Turn.itemsView`.
- Dependencies are installed so esbuild, TypeScript, Vite, tsup, server module smoke, governance, and release verification can run.

#### Steps
1. Open `output/app-server-schema-audit/20260704-141839/typescript/v2/Turn.ts` and confirm raw App Server schema includes `itemsView: TurnItemsView`.
2. Open `output/app-server-schema-audit/20260704-141839/typescript/v2/TurnItemsView.ts` and confirm values include `notLoaded`, `summary`, and `full`.
3. Open `src/api/normalizers/v2.ts` and confirm a turn with non-`full` `itemsView` and no items becomes an `isUnhandled` raw system message.
4. Run `node scripts\verify-frontend-normalizers.mjs`.
5. Run `git diff --check`.
6. Run `node scripts\verify-server-modules.mjs`.
7. Run `node_modules\.bin\vue-tsc.cmd --noEmit`.
8. Run `node_modules\.bin\vite.cmd build`.
9. Run `node_modules\.bin\tsup.cmd`.
10. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
11. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- `Turn.itemsView: full` keeps existing item rendering behavior.
- `Turn.itemsView: summary` or `notLoaded` with an empty `items` array no longer silently produces an empty message list.
- The fallback message includes `messageType: unhandled.turnItemsView.<value>`, `rawPayload`, `isUnhandled: true`, and the original `turnIndex`.
- Existing unknown item and thread source normalizer coverage continues to pass.
- Typecheck, build, governance, and release verification complete without new errors.

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required beyond normal build output in `dist/`, `dist-cli/`, `output/frontend-normalizer-smoke/`, `output/server-module-smoke/`, and `output/release-package-smoke/`.
- To roll back, remove the `itemsView` fallback branch, remove the frontend normalizer smoke assertions, and revert the protocol matrix, changelog, and this test section.

#### Regression Evidence
- 2026-07-04 frontend normalizer smoke: `node scripts\verify-frontend-normalizers.mjs` passed with `frontend normalizer smoke ok`, covering `itemsView: summary` fallback plus the existing unknown item and source metadata cases.
- 2026-07-04 static verification: `git diff --check` passed.
- 2026-07-04 server module smoke: `node scripts\verify-server-modules.mjs` passed with `server module smoke ok`.
- 2026-07-04 typecheck/build: `node_modules\.bin\vue-tsc.cmd --noEmit`, `node_modules\.bin\vite.cmd build`, and `node_modules\.bin\tsup.cmd` passed; Vite still reports the existing large chunk warning.
- 2026-07-04 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-04 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: App Server thread mutation RPC cache invalidation

#### Prerequisites
- Current repository includes `src/server/appServerRpcCache.ts`, `scripts/server-module-smoke.ts`, `docs/app-server-protocol-matrix.zh-CN.md`, and the raw schema audit output for App Server `thread/shellCommand` and `thread/inject_items`.
- Dependencies are installed so TypeScript, Vite, tsup, server module smoke, governance, and release verification can run.

#### Steps
1. Open `output/app-server-schema-audit/20260704-141839/typescript/ClientRequest.ts` and confirm official App Server schema includes `thread/shellCommand` and `thread/inject_items` request methods.
2. Open `output/app-server-schema-audit/20260704-141839/typescript/v2/ThreadShellCommandParams.ts` and confirm the command payload is tied to a `threadId` and the schema comment says it preserves shell syntax and runs unsandboxed with full access.
3. Open `output/app-server-schema-audit/20260704-141839/typescript/v2/ThreadInjectItemsParams.ts` and confirm `items` are raw Responses API items appended to the thread model-visible history.
4. Open `src/server/appServerRpcCache.ts` and confirm both methods invalidate thread list/search cache and thread read cache when called through the generic App Server RPC path.
5. Run `git diff --check`.
6. Run `node scripts\verify-server-modules.mjs`.
7. Run `node_modules\.bin\vue-tsc.cmd --noEmit`.
8. Run `node_modules\.bin\vite.cmd build`.
9. Run `node_modules\.bin\tsup.cmd`.
10. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
11. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- `thread/shellCommand` and `thread/inject_items` are still treated as non-shareable write/mutation RPC methods, not as cached read calls.
- Calling either method through the generic RPC route invalidates cached thread list/search/read data so the UI can fetch the updated thread state.
- This change does not expose a new shell-command UI, auto-approve unsandboxed shell commands, or append raw items without an explicit caller.
- Typecheck, build, governance, and release verification complete without new errors.

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required beyond normal build output in `dist/`, `dist-cli/`, `output/server-module-smoke/`, and `output/release-package-smoke/`.
- To roll back, remove the two methods from RPC cache invalidation helpers, remove the server module smoke assertions, and revert the protocol matrix, changelog, and this test section.

#### Regression Evidence
- 2026-07-04 static verification: `git diff --check` passed after removing trailing whitespace from this test section.
- 2026-07-04 server module smoke: `node scripts\verify-server-modules.mjs` passed with `server module smoke ok`, including RPC cache invalidation assertions for `thread/shellCommand` and `thread/inject_items`.
- 2026-07-04 typecheck/build: `node_modules\.bin\vue-tsc.cmd --noEmit`, `node_modules\.bin\vite.cmd build`, and `node_modules\.bin\tsup.cmd` passed; Vite still reports the existing large chunk warning.
- 2026-07-04 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-04 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: App Server additional thread mutation RPC cache invalidation

#### Prerequisites
- Current repository includes `src/server/appServerRpcCache.ts`, `scripts/server-module-smoke.ts`, `docs/app-server-protocol-matrix.zh-CN.md`, and the raw schema audit output for App Server thread mutation methods.
- Dependencies are installed so TypeScript, Vite, tsup, server module smoke, governance, and release verification can run.

#### Steps
1. Open `output/app-server-schema-audit/20260704-141839/typescript/ClientRequest.ts` and confirm official App Server schema includes `thread/metadata/update`, `thread/unarchive`, `thread/compact/start`, `thread/approveGuardianDeniedAction`, and `turn/steer`.
2. Open `output/app-server-schema-audit/20260704-141839/typescript/v2/ThreadMetadataUpdateParams.ts` and confirm it patches stored Git metadata for a `threadId`.
3. Open `output/app-server-schema-audit/20260704-141839/typescript/v2/ThreadUnarchiveParams.ts` and `ThreadCompactStartParams.ts` and confirm both target a `threadId`.
4. Open `output/app-server-schema-audit/20260704-141839/typescript/v2/ThreadApproveGuardianDeniedActionParams.ts` and confirm it submits a guardian assessment event for a `threadId`.
5. Open `output/app-server-schema-audit/20260704-141839/typescript/v2/TurnSteerParams.ts` and confirm it sends additional user input against a required `expectedTurnId` active-turn precondition.
6. Open `src/server/appServerRpcCache.ts` and confirm these write/mutation methods invalidate thread list/search cache or thread read cache according to their affected surface.
7. Run `git diff --check`.
8. Run `node scripts\verify-server-modules.mjs`.
9. Run `node_modules\.bin\vue-tsc.cmd --noEmit`.
10. Run `node_modules\.bin\vite.cmd build`.
11. Run `node_modules\.bin\tsup.cmd`.
12. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
13. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- Additional official write/mutation RPC methods are still non-shareable and never use cached read responses.
- `thread/metadata/update`, `thread/unarchive`, and `thread/compact/start` invalidate thread list/search cache because they can affect list-visible thread metadata or archive/compaction state.
- `thread/metadata/update`, `thread/unarchive`, `thread/compact/start`, `thread/approveGuardianDeniedAction`, and `turn/steer` invalidate cached thread reads so detail views can fetch updated thread state after a generic RPC call.
- This change does not expose new metadata, compact, guardian approval, or steer UI actions; it only prevents stale caches when an existing explicit caller uses the generic RPC path.
- Typecheck, build, governance, and release verification complete without new errors.

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required beyond normal build output in `dist/`, `dist-cli/`, `output/server-module-smoke/`, and `output/release-package-smoke/`.
- To roll back, remove these additional methods from RPC cache invalidation helpers, remove the server module smoke assertions, and revert the protocol matrix, changelog, and this test section.

#### Regression Evidence
- 2026-07-04 static verification: `git diff --check` passed.
- 2026-07-04 server module smoke: `node scripts\verify-server-modules.mjs` passed with `server module smoke ok`, including RPC cache invalidation assertions for `thread/metadata/update`, `thread/unarchive`, `thread/compact/start`, `thread/approveGuardianDeniedAction`, and `turn/steer`.
- 2026-07-04 typecheck/build: `node_modules\.bin\vue-tsc.cmd --noEmit`, `node_modules\.bin\vite.cmd build`, and `node_modules\.bin\tsup.cmd` passed; Vite still reports the existing large chunk warning.
- 2026-07-04 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-04 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: App Server thread detail notification cache invalidation

#### Prerequisites
- Current repository includes `src/server/appServerRpcCache.ts`, `scripts/server-module-smoke.ts`, `docs/app-server-protocol-matrix.zh-CN.md`, and the raw schema audit output for App Server thread/turn notifications.
- Dependencies are installed so TypeScript, Vite, tsup, server module smoke, governance, and release verification can run.

#### Steps
1. Open `output/app-server-schema-audit/20260704-141839/typescript/ServerNotification.ts` and confirm official App Server schema includes `thread/goal/updated`, `thread/goal/cleared`, `thread/compacted`, `turn/diff/updated`, `turn/plan/updated`, `rawResponseItem/completed`, and streaming delta/progress/output notifications.
2. Open `output/app-server-schema-audit/20260704-141839/typescript/v2/ThreadGoalUpdatedNotification.ts`, `TurnDiffUpdatedNotification.ts`, `TurnPlanUpdatedNotification.ts`, `RawResponseItemCompletedNotification.ts`, and `AgentMessageDeltaNotification.ts` and confirm these notifications carry `threadId` plus turn/item detail changes.
3. Open `src/server/appServerRpcCache.ts` and confirm these thread-detail-changing notifications invalidate cached `thread/read` data.
4. Confirm `thread/tokenUsage/updated` is intentionally not included in `shouldInvalidateThreadReadCacheForNotification()`, because token usage has a separate cache and should not trigger message/list reloads.
5. Run `git diff --check`.
6. Run `node scripts\verify-server-modules.mjs`.
7. Run `node_modules\.bin\vue-tsc.cmd --noEmit`.
8. Run `node_modules\.bin\vite.cmd build`.
9. Run `node_modules\.bin\tsup.cmd`.
10. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
11. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- Goal, compaction, turn diff, turn plan, raw response item, message/reasoning/command/file/MCP/process streaming notifications delete the cached `thread/read` snapshot for the affected thread.
- Existing frontend live delta handling remains unchanged; this server-side change only prevents later `thread/read` calls from reusing a stale cached detail snapshot.
- `thread/tokenUsage/updated` still updates token usage through its dedicated path and does not trigger thread detail or list cache invalidation.
- Typecheck, build, governance, and release verification complete without new errors.

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required beyond normal build output in `dist/`, `dist-cli/`, `output/server-module-smoke/`, and `output/release-package-smoke/`.
- To roll back, remove the additional notification methods from `shouldInvalidateThreadReadCacheForNotification()`, remove the server module smoke assertions, and revert the protocol matrix, changelog, and this test section.

#### Regression Evidence
- 2026-07-04 static verification: `git diff --check` passed.
- 2026-07-04 server module smoke: `node scripts\verify-server-modules.mjs` passed with `server module smoke ok`, including notification cache invalidation assertions for goal, compaction, turn diff/plan, raw response, message/reasoning/command/file/MCP/process streaming notifications, and the `thread/tokenUsage/updated` no-invalidation guard.
- 2026-07-04 typecheck/build: `node_modules\.bin\vue-tsc.cmd --noEmit`, `node_modules\.bin\vite.cmd build`, and `node_modules\.bin\tsup.cmd` passed; Vite still reports the existing large chunk warning.
- 2026-07-04 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-04 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: App Server remote control status diagnostics

#### Prerequisites
- Current repository includes `src/server/appServerNotificationDiagnostics.ts`, `src/components/content/DiagnosticsPanel.vue`, `scripts/server-module-smoke.ts`, `docs/app-server-protocol-matrix.zh-CN.md`, and the raw schema audit output for App Server remote control and turn environment types.
- Dependencies are installed so TypeScript, Vite, tsup, server module smoke, governance, and release verification can run.

#### Steps
1. Open `output/app-server-schema-audit/20260704-141839/typescript/v2/RemoteControlStatusChangedNotification.ts` and confirm official App Server schema exposes `status` plus `environmentId`.
2. Open `output/app-server-schema-audit/20260704-141839/typescript/v2/RemoteControlConnectionStatus.ts` and confirm known status values include `disabled`, `connecting`, `connected`, and `errored`.
3. Open `output/app-server-schema-audit/20260704-141839/typescript/v2/TurnEnvironmentParams.ts`, `TurnStartParams.ts`, and `ThreadStartParams.ts` and confirm `TurnEnvironmentParams` exists as a type but is not referenced by current thread/turn start params.
4. Open `src/server/appServerNotificationDiagnostics.ts` and confirm `remoteControl/status/changed` is a known notification that records only status and environment id fields in `recentRemoteControlNotifications`.
5. Open `src/components/content/DiagnosticsPanel.vue` and confirm the Remote Control card reads the diagnostics snapshot without triggering connection, setup, or environment-switch actions.
6. Run `git diff --check`.
7. Run `node scripts\verify-server-modules.mjs`.
8. Run `node_modules\.bin\vue-tsc.cmd --noEmit`.
9. Run `node_modules\.bin\vite.cmd build`.
10. Run `node_modules\.bin\tsup.cmd`.
11. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
12. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- `remoteControl/status/changed` no longer increments `unknownNotificationCount`.
- `/codex-api/health` and `/codex-api/diagnostics` can expose `notificationDiagnostics.recentRemoteControlNotifications` with status, environment id, and `hasEnvironmentId`.
- The diagnostics UI displays remote control status read-only and marks `errored` as warning without opening a remote-control or environment-switching workflow.
- No `TurnEnvironmentParams` request payload is fabricated while the official start params do not reference it.
- Typecheck, build, governance, and release verification complete without new errors.

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required beyond normal build output in `dist/`, `dist-cli/`, `output/server-module-smoke/`, and `output/release-package-smoke/`.
- To roll back, remove the remote control diagnostics record/snapshot fields, remove the Remote Control diagnostics UI section, remove the server module smoke assertions, and revert the protocol matrix, changelog, and this test section.

#### Regression Evidence
- 2026-07-04 static verification: `git diff --check` passed.
- 2026-07-04 server module smoke: `node scripts\verify-server-modules.mjs` passed with `server module smoke ok`, including `remoteControl/status/changed` as a known notification and sanitized `recentRemoteControlNotifications` snapshot coverage.
- 2026-07-04 typecheck/build: `node_modules\.bin\vue-tsc.cmd --noEmit`, `node_modules\.bin\vite.cmd build`, and `node_modules\.bin\tsup.cmd` passed; Vite still reports the existing large chunk warning.
- 2026-07-04 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-04 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: App Server official notification known classification

#### Prerequisites
- Current repository includes `src/server/appServerNotificationDiagnostics.ts`, `scripts/server-module-smoke.ts`, `docs/app-server-protocol-matrix.zh-CN.md`, and the raw schema audit output for App Server server notifications.
- Dependencies are installed so TypeScript, Vite, tsup, server module smoke, governance, and release verification can run.

#### Steps
1. Open `output/app-server-schema-audit/20260704-141839/typescript/ServerNotification.ts` and confirm the current raw schema lists 64 official `ServerNotification` methods.
2. Open `src/server/appServerNotificationDiagnostics.ts` and confirm `KNOWN_NOTIFICATION_METHODS` includes the official streaming, account, fuzzy file search, thread goal/compaction, raw response item, and server request resolved notifications.
3. Run the one-off comparison command:
   `node -e 'const fs=require("fs");const s=fs.readFileSync("output/app-server-schema-audit/20260704-141839/typescript/ServerNotification.ts","utf8");const official=Array.from(s.matchAll(/"method": "([^"]+)"/g)).map(m=>m[1]);const d=fs.readFileSync("src/server/appServerNotificationDiagnostics.ts","utf8");const setBlock=(d.match(/const KNOWN_NOTIFICATION_METHODS = new Set\(\[([\s\S]*?)\]\)/)||[])[1]||"";const known=Array.from(setBlock.matchAll(/\x27([^\x27]+)\x27/g)).map(m=>m[1]);const suffixes=["/archived","/created","/deleted","/forked","/moved","/removed","/unarchived"];const isKnown=m=>known.includes(m)||m.endsWith("/failed")||m.includes("error")||(m.startsWith("thread/")&&suffixes.some(s=>m.endsWith(s)));console.log(JSON.stringify({officialCount:official.length,knownCount:known.length,unknownOfficial:official.filter(m=>!isKnown(m))},null,2));'`
4. Confirm the comparison reports `"officialCount": 64` and `"unknownOfficial": []`.
5. Run `git diff --check`.
6. Run `node scripts\verify-server-modules.mjs`.
7. Run `node_modules\.bin\vue-tsc.cmd --noEmit`.
8. Run `node_modules\.bin\vite.cmd build`.
9. Run `node_modules\.bin\tsup.cmd`.
10. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
11. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- Every current official `ServerNotification` method from the raw schema audit is classified as known by `isKnownAppServerNotificationMethod()`.
- `unknownNotificationCount` remains reserved for future schema drift or genuinely non-current methods rather than known official streaming/account/fuzzy-file-search notifications.
- Existing specialized diagnostics for model, Windows sandbox, hooks, guardian review, protocol alerts, realtime, and remote control still record their sanitized snapshots.
- Typecheck, build, governance, and release verification complete without new errors.

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required beyond normal build output in `dist/`, `dist-cli/`, `output/server-module-smoke/`, and `output/release-package-smoke/`.
- To roll back, remove the added known notification methods, remove the server module smoke assertions, and revert the protocol matrix, changelog, and this test section.

#### Regression Evidence
- 2026-07-04 schema comparison: the one-off Node comparison reported `officialCount: 64` and `unknownOfficial: []` for `output/app-server-schema-audit/20260704-141839/typescript/ServerNotification.ts` against `KNOWN_NOTIFICATION_METHODS`.
- 2026-07-04 static verification: `git diff --check` passed.
- 2026-07-04 server module smoke: `node scripts\verify-server-modules.mjs` passed with `server module smoke ok`, including the full current official `ServerNotification` known-classification guard.
- 2026-07-04 typecheck/build: `node_modules\.bin\vue-tsc.cmd --noEmit`, `node_modules\.bin\vite.cmd build`, and `node_modules\.bin\tsup.cmd` passed; Vite still reports the existing large chunk warning.
- 2026-07-04 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-04 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: App Server raw JSON method catalog baseline

#### Prerequisites
- Current repository includes `src/server/appServerMethodCatalog.ts`, `scripts/server-module-smoke.ts`, `docs/app-server-protocol-matrix.zh-CN.md`, and `output/app-server-schema-audit/20260704-141839/json`.
- Dependencies are installed so TypeScript, Vite, tsup, server module smoke, governance, and release verification can run.

#### Steps
1. Open `output/app-server-schema-audit/20260704-141839/json/ClientRequest.json` and confirm method enums are stored under `oneOf[].properties.method.enum`.
2. Open `output/app-server-schema-audit/20260704-141839/json/ServerNotification.json` and confirm method enums use the same JSON schema shape.
3. Open `src/server/appServerMethodCatalog.ts` and confirm `extractMethodCatalogFromSchema()` deduplicates and sorts non-empty string enum items.
4. Open `src/server/appServerMethodCatalog.ts` and confirm `listMethods()` plus `listNotificationMethods()` read from a shared catalog cache/promise instead of generating schema independently.
5. Open `scripts/server-module-smoke.ts` and confirm `smokeAppServerMethodCatalog()` reads both raw JSON schema files and asserts `ClientRequest` extracts 75 methods while `ServerNotification` extracts 63 methods.
6. Confirm the smoke documents the current catalog boundary where `rawResponseItem/completed` is covered by the TypeScript union diagnostics path but is absent from `ServerNotification.json`.
7. Confirm the smoke instantiates `AppServerMethodCatalog` with a generated schema fixture and asserts concurrent method/notification reads call the generator once.
8. Run `git diff --check`.
9. Run `node scripts\verify-server-modules.mjs`.
10. Run `node_modules\.bin\vue-tsc.cmd --noEmit`.
11. Run `node_modules\.bin\vite.cmd build`.
12. Run `node_modules\.bin\tsup.cmd`.
13. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
14. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- The method catalog extractor remains schema-shape driven rather than maintaining a hardcoded client request list.
- Method and notification catalog reads share one generated schema output and cache within the same `AppServerMethodCatalog` instance.
- Current raw JSON schema audit extraction returns 75 client request methods and 63 server notification methods.
- Catalog smoke covers recent official request and notification methods such as `thread/shellCommand`, `thread/inject_items`, `turn/steer`, `windowsSandbox/readiness`, `remoteControl/status/changed`, and fuzzy file search notifications.
- `rawResponseItem/completed` remains covered by notification diagnostics but is not claimed as part of the JSON notification catalog until the upstream JSON schema includes it.
- Typecheck, build, governance, and release verification complete without new errors.

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required beyond normal build output in `dist/`, `dist-cli/`, `output/server-module-smoke/`, and `output/release-package-smoke/`.
- To roll back, remove the raw JSON schema assertions from `smokeAppServerMethodCatalog()` and revert the protocol matrix, changelog, and this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 server module smoke: `node scripts\verify-server-modules.mjs` passed with `server module smoke ok`, including raw JSON schema catalog assertions for 75 `ClientRequest` methods, 63 `ServerNotification` methods, and shared method/notification catalog generation/cache coverage.
- 2026-07-05 typecheck/build: `node_modules\.bin\vue-tsc.cmd --noEmit`, `node_modules\.bin\vite.cmd build`, and `node_modules\.bin\tsup.cmd` passed; Vite still reports the existing large chunk warning.
- 2026-07-05 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-05 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `Frontend normalizer smoke`, `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: Isolated server module smoke output

#### Prerequisites
- Current repository includes `scripts/verify-server-modules.mjs`, `scripts/verify-release.ps1`, `scripts/server-module-smoke.ts`, and `docs/changelog.zh-CN.md`.
- Dependencies are installed so the server module smoke verifier and release gate can run.

#### Steps
1. Open `scripts/verify-server-modules.mjs` and confirm it creates a unique `output/server-module-smoke/run-*` directory with `mkdtempSync()` for each invocation.
2. Confirm the verifier does not recursively delete the shared `output/server-module-smoke` parent directory before compiling.
3. Confirm the verifier removes only its own run directory by default, with `CX_CODEX_KEEP_SERVER_MODULE_SMOKE_OUTPUT=1` available for debugging.
4. Run `git diff --check`.
5. Run `node scripts\verify-server-modules.mjs`.
6. Run two verification commands concurrently: one `node scripts\verify-server-modules.mjs` and one `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.
7. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
8. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- Concurrent server module smoke and release verification no longer fail with a missing `output\server-module-smoke\scripts\server-module-smoke.js` module.
- Each server module smoke invocation compiles and runs from its own run directory, so one verifier cannot delete another verifier's compiled entry.
- By default, completed run directories are cleaned up; setting `CX_CODEX_KEEP_SERVER_MODULE_SMOKE_OUTPUT=1` keeps the per-run output for debugging.
- Governance and release verification complete without new errors.

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required beyond normal build output in `output/server-module-smoke/` and `output/release-package-smoke/`.
- To roll back, restore the fixed `output/server-module-smoke` compile directory in `scripts/verify-server-modules.mjs` and remove this test section plus the changelog note.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 server module smoke: `node scripts\verify-server-modules.mjs` passed with `server module smoke ok`.
- 2026-07-05 concurrent smoke/release verification: one `node scripts\verify-server-modules.mjs` process and one `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` process ran concurrently and both exited `0`; the release process completed its internal server smoke, CLI CJS launcher smoke, release package smoke, npm package smoke, and skipped schema audit as requested.
- 2026-07-05 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-05 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: Import-graph server module smoke compilation

#### Prerequisites
- Current repository includes `scripts/verify-server-modules.mjs`, `scripts/verify-governance.ps1`, `scripts/server-module-smoke.ts`, and `docs/changelog.zh-CN.md`.
- Dependencies are installed so TypeScript, governance, and release verification can run.

#### Steps
1. Open `scripts/verify-server-modules.mjs` and confirm the generated `tsconfig.json` includes `scripts/server-module-smoke.ts` as the only explicit compile entry.
2. Confirm `scripts/verify-server-modules.mjs` no longer contains any `join(repoRoot, 'src', 'server'...)` manual include entries.
3. Open `scripts/verify-governance.ps1` and confirm it fails if `scripts/verify-server-modules.mjs` reintroduces a manual `src/server` include list.
4. Run `git diff --check`.
5. Run `node scripts\verify-server-modules.mjs`.
6. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
7. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- TypeScript follows the import graph from `scripts/server-module-smoke.ts`, so adding a new smoke-covered helper does not require editing the verifier include list.
- Governance keeps the verifier on the import-graph model and prevents the old hand-maintained `src/server` include list from returning.
- Server module smoke, governance, and release verification complete without new errors.

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required beyond normal build output in `output/server-module-smoke/` and `output/release-package-smoke/`.
- To roll back, restore the previous explicit `src/server` include entries in `scripts/verify-server-modules.mjs`, remove the governance guard, and remove this test section plus the changelog note.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 server module smoke: `node scripts\verify-server-modules.mjs` passed with `server module smoke ok`.
- 2026-07-05 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-05 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: Frontend normalizer release gate smoke

#### Prerequisites
- Current repository includes `scripts/verify-release.ps1`, `scripts/verify-frontend-normalizers.mjs`, `scripts/verify-governance.ps1`, `RELEASE.md`, and `docs/dependency-maintenance.zh-CN.md`.
- Dependencies are installed so the frontend normalizer smoke, governance gate, and release gate can run.

#### Steps
1. Open `scripts/verify-release.ps1` and confirm it runs `scripts/verify-frontend-normalizers.mjs` with the label `Frontend normalizer smoke`.
2. Open `scripts/verify-governance.ps1` and confirm it requires the release gate, `RELEASE.md`, and dependency maintenance docs to mention the frontend normalizer smoke.
3. Run `git diff --check`.
4. Run `node scripts\verify-frontend-normalizers.mjs`.
5. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
6. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- Release verification runs the frontend normalizer smoke before the server module smoke, so App Server thread/message normalizer compatibility is covered by local release checks and CI.
- Governance fails if the release gate or release/dependency documentation drops the frontend normalizer smoke requirement.
- Frontend normalizer smoke, governance, and release verification complete without new errors.

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required beyond normal build output in `output/frontend-normalizer-smoke/`, `output/server-module-smoke/`, and `output/release-package-smoke/`.
- To roll back, remove the frontend normalizer smoke invocation from `scripts/verify-release.ps1`, remove the governance assertions, and revert this test section plus the documentation/changelog notes.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 frontend normalizer smoke: `node scripts\verify-frontend-normalizers.mjs` passed with `frontend normalizer smoke ok`.
- 2026-07-05 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-05 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `Frontend normalizer smoke`, `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: Isolated frontend normalizer smoke output

#### Prerequisites
- Current repository includes `scripts/verify-frontend-normalizers.mjs`, `scripts/verify-release.ps1`, `scripts/verify-governance.ps1`, and `docs/changelog.zh-CN.md`.
- Dependencies are installed so the frontend normalizer smoke and release gate can run.

#### Steps
1. Open `scripts/verify-frontend-normalizers.mjs` and confirm it creates a unique `output/frontend-normalizer-smoke/run-*` directory with `mkdtempSync()` for each invocation.
2. Confirm the verifier removes only its own run directory by default, with `CX_CODEX_KEEP_FRONTEND_NORMALIZER_SMOKE_OUTPUT=1` available for debugging.
3. Open `scripts/verify-governance.ps1` and confirm it requires the isolated frontend normalizer smoke output behavior.
4. Run `git diff --check`.
5. Run `node scripts\verify-frontend-normalizers.mjs`.
6. Run two verification commands concurrently: one `node scripts\verify-frontend-normalizers.mjs` and one `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.
7. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
8. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- Concurrent frontend normalizer smoke and release verification no longer share or delete the same `output/frontend-normalizer-smoke` bundle files.
- Each frontend normalizer smoke invocation compiles and runs from its own run directory.
- By default, completed run directories are cleaned up; setting `CX_CODEX_KEEP_FRONTEND_NORMALIZER_SMOKE_OUTPUT=1` keeps the per-run output for debugging.
- Governance and release verification complete without new errors.

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required beyond normal build output in `output/frontend-normalizer-smoke/`, `output/server-module-smoke/`, and `output/release-package-smoke/`.
- To roll back, restore the fixed `output/frontend-normalizer-smoke` directory in `scripts/verify-frontend-normalizers.mjs`, remove the governance assertions, and revert this test section plus the changelog note.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 frontend normalizer smoke: `node scripts\verify-frontend-normalizers.mjs` passed with `frontend normalizer smoke ok`.
- 2026-07-05 concurrent frontend/release verification: one `node scripts\verify-frontend-normalizers.mjs` process and one `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` process ran concurrently and both exited `0`; the release process completed frontend normalizer smoke, server module smoke, CLI CJS launcher smoke, release package smoke, npm package smoke, and skipped schema audit as requested.
- 2026-07-05 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-05 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `Frontend normalizer smoke`, `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: Frontend normalizer release package smoke coverage

#### Prerequisites
- Current repository includes `scripts/verify-release.ps1`, `scripts/verify-governance.ps1`, `scripts/verify-frontend-normalizers.mjs`, and `docs/changelog.zh-CN.md`.
- Dependencies are installed and build artifacts exist, or release verification is run with `-SkipBuild` after a previous successful build.

#### Steps
1. Open `scripts/verify-release.ps1` and confirm `Assert-ZipContains` requires `scripts\verify-frontend-normalizers.mjs`.
2. Open `scripts/verify-governance.ps1` and confirm governance requires the same release package smoke entry.
3. Run `git diff --check`.
4. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
5. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- Release package smoke fails if the source zip omits `scripts\verify-frontend-normalizers.mjs`.
- Governance fails if the release package smoke stops requiring the frontend normalizer smoke script.
- Release verification completes with `Frontend normalizer smoke`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required beyond normal build output in `output/frontend-normalizer-smoke/`, `output/server-module-smoke/`, and `output/release-package-smoke/`.
- To roll back, remove `scripts\verify-frontend-normalizers.mjs` from the release package smoke required entries, remove the governance assertion, and revert this test section plus the changelog note.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-05 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `Frontend normalizer smoke`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: Explicit frontend normalizer esbuild dependency

#### Prerequisites
- Current repository includes `package.json`, `package-lock.json`, `scripts/verify-frontend-normalizers.mjs`, `scripts/verify-governance.ps1`, and `docs/dependency-maintenance.zh-CN.md`.
- Dependencies are installed so npm can resolve direct devDependencies and the frontend normalizer smoke can run.

#### Steps
1. Open `scripts/verify-frontend-normalizers.mjs` and confirm it directly imports `esbuild`.
2. Open `package.json` and confirm `esbuild` is listed in `devDependencies`.
3. Open `scripts/verify-governance.ps1` and confirm governance requires both the direct `esbuild` import and the `package.json` dependency entry.
4. Run `npm ls esbuild --depth=0`.
5. Run `git diff --check`.
6. Run `node scripts\verify-frontend-normalizers.mjs`.
7. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
8. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- `npm ls esbuild --depth=0` shows `esbuild` as a top-level dev dependency, not only through `vite` or `tsup`.
- Frontend normalizer smoke still prints `frontend normalizer smoke ok`.
- Governance fails if the direct `esbuild` dependency declaration or the smoke script import is removed.
- Release verification completes with the frontend normalizer smoke still included in the gate.

#### Rollback/Cleanup Notes
- No runtime cleanup is required beyond normal generated output in `output/frontend-normalizer-smoke/`, `output/server-module-smoke/`, and `output/release-package-smoke/`.
- To roll back, remove the direct `esbuild` devDependency, remove the governance assertions, and revert this test section plus the dependency maintenance and changelog notes.

#### Regression Evidence
- 2026-07-05 dependency tree: `npm ls esbuild --depth=0` passed and showed `esbuild@0.27.7` as a top-level dependency.
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 frontend normalizer smoke: `node scripts\verify-frontend-normalizers.mjs` passed with `frontend normalizer smoke ok`.
- 2026-07-05 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-05 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `Frontend normalizer smoke`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: App Server local runtime snapshot reader helper

#### Prerequisites
- Current repository includes `src/server/appServerLocalRuntimeSnapshot.ts`, `src/server/codexAppServerBridge.ts`, and `scripts/server-module-smoke.ts`.
- Dependencies are installed so TypeScript, Vite, tsup, and the server module smoke verifier can run.

#### Steps
1. Run `git diff --check`.
2. Run `node scripts\verify-server-modules.mjs`.
3. Run `node_modules\.bin\vue-tsc.cmd --noEmit`.
4. Run `node_modules\.bin\vite.cmd build`.
5. Run `node_modules\.bin\tsup.cmd`.
6. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
7. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- Local runtime snapshot reads still normalize the incoming thread id before reading cached snapshots, pending requests, and token usage.
- Persisted local snapshots still merge current pending requests and token usage without creating a current snapshot.
- Missing persisted snapshots still create and persist a current runtime snapshot with pending request and token usage overlays.
- `codexAppServerBridge.ts` creates `readLocalRuntimeSnapshot` through `createAppServerLocalRuntimeSnapshotReader()` instead of owning the reader closure body.

#### Rollback/Cleanup Notes
- No runtime artifacts need cleanup beyond normal build output in `dist/`, `dist-cli/`, and `output/`.
- To roll back, revert `src/server/appServerLocalRuntimeSnapshot.ts`, `src/server/codexAppServerBridge.ts`, `scripts/server-module-smoke.ts`, and this test section.

#### Regression Evidence
- 2026-07-04 static verification: `git diff --check` passed.
- 2026-07-04 server module smoke: `node scripts\verify-server-modules.mjs` passed, including `createAppServerLocalRuntimeSnapshotReader()` coverage for current snapshot fallback, pending request overlay, token usage overlay, and current snapshot persistence.
- 2026-07-04 typecheck/build: `node_modules\.bin\vue-tsc.cmd --noEmit`, `node_modules\.bin\vite.cmd build`, and `node_modules\.bin\tsup.cmd` passed; Vite still reports the existing large chunk warning.
- 2026-07-04 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-04 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`
---

### Feature: App Server thread runtime snapshot reader helper

#### Prerequisites
- Current repository includes `src/server/appServerThreadRuntimeSnapshot.ts`, `src/server/codexAppServerBridge.ts`, and `scripts/server-module-smoke.ts`.
- Dependencies are installed so TypeScript, Vite, tsup, and the server module smoke verifier can run.

#### Steps
1. Run `git diff --check`.
2. Run `node scripts\verify-server-modules.mjs`.
3. Run `node_modules\.bin\vue-tsc.cmd --noEmit`.
4. Run `node_modules\.bin\vite.cmd build`.
5. Run `node_modules\.bin\tsup.cmd`.
6. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
7. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- Thread runtime snapshot reads still perform light `thread/read` first and heavy `thread/read` only when the cached read is missing or stale.
- Fresh cached thread reads still avoid the heavy `thread/read` request.
- Recoverable light/heavy read failures still fall back to cached thread reads and write warnings without crashing.
- Heavy read results are still cached through `rememberCachedThreadRead`.
- `codexAppServerBridge.ts` creates `readThreadRuntimeSnapshot` through `createAppServerThreadRuntimeSnapshotReader()` instead of owning the reader closure body.

#### Rollback/Cleanup Notes
- No runtime artifacts need cleanup beyond normal build output in `dist/`, `dist-cli/`, and `output/`.
- To roll back, revert `src/server/appServerThreadRuntimeSnapshot.ts`, `src/server/codexAppServerBridge.ts`, `scripts/server-module-smoke.ts`, and this test section.

#### Regression Evidence
- 2026-07-04 static verification: `git diff --check` passed.
- 2026-07-04 server module smoke: `node scripts\verify-server-modules.mjs` passed, including `createAppServerThreadRuntimeSnapshotReader()` coverage for light/heavy `thread/read`, heavy-read caching, token usage extraction, and snapshot persistence.
- 2026-07-04 typecheck/build: `node_modules\.bin\vue-tsc.cmd --noEmit`, `node_modules\.bin\vite.cmd build`, and `node_modules\.bin\tsup.cmd` passed; Vite still reports the existing large chunk warning.
- 2026-07-04 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-04 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`
---

### Feature: App Server runtime snapshot persister helper

#### Prerequisites
- Current repository includes `src/server/appServerRuntimeSnapshotPersistence.ts`, `src/server/codexAppServerBridge.ts`, and `scripts/server-module-smoke.ts`.
- Dependencies are installed so TypeScript, Vite, tsup, and the server module smoke verifier can run.

#### Steps
1. Run `git diff --check`.
2. Run `node scripts\verify-server-modules.mjs`.
3. Run `node_modules\.bin\vue-tsc.cmd --noEmit`.
4. Run `node_modules\.bin\vite.cmd build`.
5. Run `node_modules\.bin\tsup.cmd`.
6. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
7. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- Runtime snapshot persistence still strips `threadRead`, `pendingServerRequests`, and `tokenUsage` before writing persistable snapshots.
- Provided snapshots still persist without calling current snapshot, pending request, or token usage readers.
- Generated snapshots still include current pending request and token usage overlays before being persisted.
- `codexAppServerBridge.ts` creates `persistRuntimeSnapshot` through `createAppServerRuntimeSnapshotPersister()` instead of owning the persistence closure body.

#### Rollback/Cleanup Notes
- No runtime artifacts need cleanup beyond normal build output in `dist/`, `dist-cli/`, and `output/`.
- To roll back, revert `src/server/appServerRuntimeSnapshotPersistence.ts`, `src/server/codexAppServerBridge.ts`, `scripts/server-module-smoke.ts`, and this test section.

#### Regression Evidence
- 2026-07-04 static verification: `git diff --check` passed.
- 2026-07-04 server module smoke: `node scripts\verify-server-modules.mjs` passed, including `createAppServerRuntimeSnapshotPersister()` coverage for generated snapshots, sanitized persisted payloads, and provided snapshot persistence.
- 2026-07-04 typecheck/build: `node_modules\.bin\vue-tsc.cmd --noEmit`, `node_modules\.bin\vite.cmd build`, and `node_modules\.bin\tsup.cmd` passed; Vite still reports the existing large chunk warning.
- 2026-07-04 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-04 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`
---

### Feature: App Server thread token usage resolver helper

#### Prerequisites
- Current repository includes `src/server/threadTokenUsage.ts`, `src/server/codexAppServerBridge.ts`, and `scripts/server-module-smoke.ts`.
- Dependencies are installed so TypeScript, Vite, tsup, and the server module smoke verifier can run.

#### Steps
1. Run `git diff --check`.
2. Run `node scripts\verify-server-modules.mjs`.
3. Run `node_modules\.bin\vue-tsc.cmd --noEmit`.
4. Run `node_modules\.bin\vite.cmd build`.
5. Run `node_modules\.bin\tsup.cmd`.
6. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
7. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- Runtime state routes still call `readCachedThreadTokenUsage` with the requested thread id.
- Empty thread ids still short-circuit to `null` without consulting cached token usage or cached thread reads.
- Cached token usage is returned before consulting cached thread reads.
- Cached thread reads and session log fallback behavior continue to use `resolveThreadTokenUsage`.
- `codexAppServerBridge.ts` no longer owns the token usage source resolution closure.

#### Rollback/Cleanup Notes
- No runtime artifacts need cleanup beyond normal build output in `dist/`, `dist-cli/`, and `output/`.
- To roll back, revert `src/server/threadTokenUsage.ts`, `src/server/codexAppServerBridge.ts`, `scripts/server-module-smoke.ts`, and this test section.

#### Regression Evidence
- 2026-07-04 static verification: `git diff --check` passed.
- 2026-07-04 server module smoke: `node scripts\verify-server-modules.mjs` passed, including `createThreadTokenUsageResolver()` coverage for empty thread id short-circuit, cached token usage priority, and cached thread read fallback behavior.
- 2026-07-04 typecheck/build: `node_modules\.bin\vue-tsc.cmd --noEmit`, `node_modules\.bin\vite.cmd build`, and `node_modules\.bin\tsup.cmd` passed; Vite still reports the existing large chunk warning.
- 2026-07-04 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-04 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`
---

### Feature: OpenAI official docs review refresh

#### Prerequisites
- Current repository includes `docs/openai-docs-review.zh-CN.md`, `docs/changelog.zh-CN.md`, and `scripts/verify-governance.ps1`.
- Network access is available for official OpenAI documentation checks, and the Codex manual helper can refresh the local manual cache.

#### Steps
1. Run `node %USERPROFILE%\.codex\skills\.system\openai-docs\scripts\fetch-codex-manual.mjs`.
2. Open the official Codex App Server page and confirm the App Server handshake, transport, and `experimentalApi` guidance still match the review handrail.
3. Open the official OpenAI Speech to text page and confirm the diarize transcription example still uses `gpt-4o-transcribe-diarize`, `response_format=diarized_json`, and `chunking_strategy=auto`.
4. Open `docs/openai-docs-review.zh-CN.md` and confirm the latest review timestamp and current conclusion reflect this check.
5. Run `git diff --check`.
6. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
7. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- The review handbook keeps a current absolute review timestamp.
- The current conclusion still distinguishes Codex App Server protocol alignment from supplemental OpenAI API usage.
- The Speech to text conclusion keeps the diarize multipart constraints tied to official docs.
- Governance and release verification continue to package and enforce `docs/openai-docs-review.zh-CN.md`.

#### Rollback/Cleanup Notes
- No runtime cleanup is required beyond normal generated output in `output/frontend-normalizer-smoke/`, `output/server-module-smoke/`, and `output/release-package-smoke/`.
- To roll back, restore the previous review timestamp/conclusion and remove this test section plus the changelog note.

#### Regression Evidence
- 2026-07-05 official Codex manual check: `node %USERPROFILE%\.codex\skills\.system\openai-docs\scripts\fetch-codex-manual.mjs` returned `local manual was already current`.
- 2026-07-05 official docs check: official Codex App Server documentation still records `initialize`/`initialized`, WebSocket experimental/auth guidance, and `capabilities.experimentalApi`; official Speech to text documentation still records `gpt-4o-transcribe-diarize`, `diarized_json`, and `chunking_strategy=auto`.
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-05 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `Frontend normalizer smoke`, `server module smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: App Server initialize capabilities schema alignment

#### Prerequisites
- Current repository includes `src/server/appServerInitialization.ts`, `documentation/app-server-schemas/typescript/InitializeCapabilities.ts`, and `scripts/server-module-smoke.ts`.
- Official Codex manual has been refreshed with `node %USERPROFILE%\.codex\skills\.system\openai-docs\scripts\fetch-codex-manual.mjs`.
- Dependencies are installed so TypeScript, Vite, tsup, and the server module smoke verifier can run.

#### Steps
1. Confirm the official Codex App Server manual says clients initialize first, then send `initialized`, and that `capabilities.experimentalApi` controls experimental API opt-in.
2. Confirm `documentation/app-server-schemas/typescript/InitializeCapabilities.ts` declares `experimentalApi: boolean`.
3. Run `git diff --check`.
4. Run `node scripts\verify-server-modules.mjs`.
5. Run `node_modules\.bin\vue-tsc.cmd --noEmit`.
6. Run `node_modules\.bin\vite.cmd build`.
7. Run `node_modules\.bin\tsup.cmd`.
8. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
9. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- Default initialization still omits `capabilities`, keeping the bridge on the stable App Server API surface.
- Explicit `experimentalApi: false` without other capabilities still omits `capabilities`, preserving the previous default payload.
- Explicit `experimentalApi: true` sends `capabilities.experimentalApi: true`.
- Notification opt-out payloads send `capabilities.experimentalApi: false` alongside `optOutNotificationMethods`, matching the generated official `InitializeCapabilities` schema.
- Combining `experimentalApi: true` with notification opt-out sends both fields unchanged.

#### Rollback/Cleanup Notes
- No runtime artifacts need cleanup beyond normal build output in `dist/`, `dist-cli/`, and `output/`.
- To roll back, revert `src/server/appServerInitialization.ts`, `scripts/server-module-smoke.ts`, `docs/app-server-protocol-matrix.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-04 official docs check: `node %USERPROFILE%\.codex\skills\.system\openai-docs\scripts\fetch-codex-manual.mjs` returned `local manual was already current`; the Codex App Server section documents initialize before `initialized` and `capabilities.experimentalApi` as the experimental API opt-in.
- 2026-07-04 schema check: `documentation/app-server-schemas/typescript/InitializeCapabilities.ts` declares `experimentalApi: boolean` and optional `optOutNotificationMethods`.
- 2026-07-04 static verification: `git diff --check` passed.
- 2026-07-04 server module smoke: `node scripts\verify-server-modules.mjs` passed, including default stable initialize payload, experimental opt-in payload, opt-out payload with `experimentalApi: false`, and combined experimental opt-in plus opt-out coverage.
- 2026-07-04 typecheck/build: `node_modules\.bin\vue-tsc.cmd --noEmit`, `node_modules\.bin\vite.cmd build`, and `node_modules\.bin\tsup.cmd` passed; Vite still reports the existing large chunk warning.
- 2026-07-04 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-04 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`
---

### Feature: App Server thread-read cache store

#### Prerequisites
- Current repository includes `src/server/appServerThreadReadCache.ts`, `src/server/codexAppServerBridge.ts`, and `scripts/server-module-smoke.ts`.
- Dependencies are installed so TypeScript, Vite, tsup, and the server module smoke verifier can run.

#### Steps
1. Run `git diff --check`.
2. Run `node scripts\verify-server-modules.mjs`.
3. Run `node_modules\.bin\vue-tsc.cmd --noEmit`.
4. Run `node_modules\.bin\vite.cmd build`.
5. Run `node_modules\.bin\tsup.cmd`.
6. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
7. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- Middleware thread-read cache behavior remains unchanged while bridge code uses `AppServerThreadReadCacheStore` instead of a local `Map`.
- Fresh cached `thread/read` payloads are returned through `getCachedThreadRead()` for runtime snapshots and token usage recovery.
- Runtime notification sync and RPC proxy invalidation still remove cached thread reads by thread id.
- Remembering the same thread id replaces the cached payload without increasing cache size.
- Clearing the cache removes all remembered thread reads without throwing.

#### Rollback/Cleanup Notes
- No runtime artifacts need cleanup beyond normal build output in `dist/`, `dist-cli/`, and `output/`.
- To roll back, revert `src/server/appServerThreadReadCache.ts`, `src/server/codexAppServerBridge.ts`, `scripts/server-module-smoke.ts`, and this test section.

#### Regression Evidence
- 2026-07-04 static verification: `git diff --check` passed.
- 2026-07-04 server module smoke: `node scripts\verify-server-modules.mjs` passed, including `AppServerThreadReadCacheStore` coverage for remember, get, replace, delete, idempotent delete, count, and clear behavior.
- 2026-07-04 typecheck/build: `node_modules\.bin\vue-tsc.cmd --noEmit`, `node_modules\.bin\vite.cmd build`, and `node_modules\.bin\tsup.cmd` passed; Vite still reports the existing large chunk warning.
- 2026-07-04 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-04 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`
---

### Feature: GitHub Issues #2 and #3 long prompt safety

#### Prerequisites
- App server is running from this repository.
- A workspace path is selected on the home page.

#### Steps
1. Paste a prompt longer than 3000 characters into the home composer and submit it.
2. Confirm the app enters the newly created thread before the first turn finishes.
3. Confirm the user prompt is shown as a collapsed preview with `展开完整 Prompt` and `复制全文`.
4. Expand the prompt, collapse it again, and copy the full prompt.
5. Hover or focus a message action bar and click `回滚` once.
6. Click outside or wait 4 seconds, then click `回滚` twice on the same message.

#### Expected Results
- Long first prompts no longer leave the user on the home page while the task starts.
- If the first turn fails after the thread is created, the thread and optimistic prompt remain visible with an error instead of disappearing.
- The collapsed long prompt clearly says it is a preview and the full prompt was sent.
- Rollback requires a second confirmation click; a single accidental click does not mutate the thread.
- Rollback is visually separated from favorite/copy actions.

#### Rollback/Cleanup
- Archive or delete the test thread if it is not needed.

### Feature: Web settings permission policy

#### Prerequisites
- App server is running from this repository.
- Settings panel can be opened from the sidebar.

#### Steps
1. Open Settings and locate `权限控制`.
2. Toggle `完全放行权限请求`.
3. Confirm `命令执行权限`、`文件变更权限`、`MCP 工具权限` become disabled while full allow is on.
4. Turn full allow off and cycle each permission row between `自动允许` and `每次询问`.
5. Restart the app server and reopen Settings.
6. Trigger a command approval or MCP tool permission request.

#### Expected Results
- Permission changes are saved to `~/.codex/web-bridge-settings.json`.
- Saved permission state survives restart.
- When a permission is set to `自动允许`, matching permission requests are approved without showing a pending card.
- When a permission is set to `每次询问`, matching requests show the normal confirmation card.
- Telegram settings and Telegram endpoints are no longer present.

#### Rollback/Cleanup
- Delete `~/.codex/web-bridge-settings.json` to restore defaults.

### Feature: Mobile dictation control

#### Prerequisites
- App is served from HTTPS or localhost.
- Browser microphone permission is available.

#### Steps
1. Open a thread on a mobile-sized viewport.
2. Confirm the microphone button is visible in the compact composer.
3. Tap or hold the microphone according to the dictation mode.
4. Speak a short sentence and stop recording.
5. Confirm the transcript appears in the composer or auto-sends according to Settings.

#### Expected Results
- Mobile compact layout no longer hides the microphone button.
- Insecure HTTP origins show a clear browser/security limitation instead of silently failing.
- Transcription accepts `text`、`transcript`、`data.text` 或 `data.transcript` response shapes.

#### Rollback/Cleanup
- Revoke browser microphone permission if needed.

### Feature: Skills dropdown closes after selection in composer

#### Prerequisites
- App is running from this repository.
- At least one thread exists and can be selected.
- At least one installed skill is available.

#### Steps
1. Open an existing thread so the message composer is enabled.
2. Click the `Skills` dropdown in the composer footer.
3. Click any skill option in the dropdown list.
4. Re-open the `Skills` dropdown and click the same skill again to unselect it.

#### Expected Results
- The skills dropdown closes immediately after each selection click.
- Selected skill appears as a chip above the composer input when checked.
- Skill chip is removed when the skill is unchecked on the next selection.

#### Rollback/Cleanup
- Remove the selected skill chip(s) before leaving the thread, if needed.

### Feature: Skills Hub manual search trigger

#### Prerequisites
- App is running from this repository.
- Open the `Skills Hub` view.

#### Steps
1. Type a unique query value in the Skills Hub search input (for example: `docker`), but do not press Enter or click Search yet.
2. Confirm the browse results do not refresh immediately while typing.
3. Click the `Search` button.
4. Change the query text to another value and press Enter in the input.
5. Clear the query, then click `Search` to reload the default browse list.

#### Expected Results
- Typing alone does not trigger remote Skills Hub search requests.
- Results refresh only after explicit submit via the `Search` button or Enter key.
- Empty-state text (if shown) references the last submitted query.
- Submitting an empty query returns the default skills listing.

#### Rollback/Cleanup
- Clear the search input and run a blank search to return to default listing.

### Feature: Dark theme for trending GitHub projects and local project dropdown

#### Prerequisites
- App is running from this repository.
- Home/new-thread screen is open.
- Appearance is set to `Dark` in Settings.
- `GitHub trending projects` setting is enabled.

#### Steps
1. On the home/new-thread screen, inspect the `Choose folder` dropdown trigger.
2. Open the `Choose folder` dropdown and confirm menu/option contrast remains readable in dark mode.
3. Inspect the `Trending GitHub projects` section title, scope dropdown, and project cards.
4. Hover a trending project card and the scope dropdown trigger.
5. Toggle appearance back to `Light`, then return to `Dark`.

#### Expected Results
- Local project dropdown trigger/value uses dark theme colors with readable contrast.
- Trending section title, empty/loading text, scope dropdown, and cards use dark backgrounds/borders/text.
- Hover states in dark mode stay visible and do not switch to light backgrounds.
- Theme switch back/forth preserves correct styling for both controls.

#### Rollback/Cleanup
- Reset appearance to the previous user preference.

### Feature: Dark theme for worktree runtime selector and Skills Hub

#### Prerequisites
- App is running from this repository.
- Appearance is set to `Dark` in Settings.
- Skills Hub route is accessible.

#### Steps
1. Open the home/new-thread screen and inspect the `Local project / New worktree` runtime selector trigger.
2. Open the runtime selector and verify menu title, options, selected state, and checkmark visibility in dark mode.
3. Trigger a worktree action that shows worktree status and verify running/error status blocks remain readable in dark mode.
4. Open `Skills Hub` and verify header/subtitle, search bar, search/sort buttons, sync panel, badges, and status text.
5. Verify at least one skill card surface (title, owner, description, date, browse icon) in dark mode.
6. Open a skill detail modal and verify panel, title/owner, close button, README/body text, and footer actions in dark mode.

#### Expected Results
- Runtime dropdown trigger and menu use dark backgrounds, borders, and readable text/icons.
- Worktree status blocks use dark-friendly contrast for both running and error states.
- Skills Hub controls and sync panel are fully dark-themed with consistent hover/active states.
- Skill cards and the skill detail modal render with dark theme colors and accessible contrast.

#### Rollback/Cleanup
- Reset appearance to the previous user preference.

### Feature: Markdown file links with backticks and parentheses render correctly

#### Prerequisites
- App is running from this repository.
- An active thread is open.
- Local file exists at `/root/New Project (1)/qwe.txt`.

#### Steps
1. Send a message containing: `Done. Created [`/root/New Project (1)/qwe.txt`](/root/New Project (1)/qwe.txt) with content:`.
2. In the rendered assistant message, click the `/root/New Project (1)/qwe.txt` link.
3. Right-click the same link and choose `Copy link` from the context menu.
4. Paste the copied link into a text field and inspect it.

#### Expected Results
- The markdown link renders as one clickable file link (not split into partial tokens).
- Clicking opens the local browse route for the full file path.
- Copied link includes the full encoded path and still resolves to the same file.

#### Rollback/Cleanup
- Delete `/root/New Project (1)/qwe.txt` if it was created only for this test.

### Feature: Runtime selector uses a toggle-style control

#### Prerequisites
- App is running from this repository.
- Home/new-thread screen is open.

#### Steps
1. On the home/new-thread screen, locate the runtime control below `Choose folder`.
2. Verify both options (`Local project` and `New worktree`) are visible at once without opening a menu.
3. Click `New worktree` and confirm it becomes the selected option style.
4. Click `Local project` and confirm selection returns.
5. Set Appearance to `Dark` in Settings and verify selected/unselected contrast remains readable.

#### Expected Results
- Runtime mode is presented as a two-option toggle (segmented control), not a dropdown menu.
- Clicking each option immediately switches the selected state.
- Selected option has a distinct active background/border in both light and dark themes.

#### Rollback/Cleanup
- Leave runtime mode and appearance at the previous user preference.

### Feature: Dark theme states for runtime mode toggle

#### Prerequisites
- App is running from this repository.
- Home/new-thread screen is open.
- Appearance is set to `Dark` in Settings.

#### Steps
1. Locate the runtime mode toggle (`Local project` and `New worktree`) under `Choose folder`.
2. Hover each option and verify hover state is visible against dark backgrounds.
3. Select `New worktree`, then select `Local project` and compare active/inactive contrast.
4. Tab to the toggle options with keyboard navigation and verify the focus ring is visible.
5. Confirm icon color remains readable for selected and unselected options.

#### Expected Results
- Toggle container, options, and text/icons use dark-friendly colors.
- Hover and selected states are clearly distinguishable in dark mode.
- Keyboard focus ring is visible and does not blend into the background.

#### Rollback/Cleanup
- Return appearance and runtime selection to the previous user preference.

### Feature: pnpm dev script installs dependencies and starts Vite

#### Prerequisites
- `pnpm` is installed globally (`npm i -g pnpm` or via corepack).
- Repository is cloned and `node_modules/` does not exist (or may be stale).

#### Steps
1. Remove `node_modules/` if present: `rm -rf node_modules`.
2. Run `pnpm run dev`.
3. Wait for Vite dev server to start and display the local URL.
4. Open the displayed URL in a browser.

#### Expected Results
- `pnpm install` runs automatically before Vite starts (dependencies are installed).
- Vite dev server starts successfully and serves the app.
- No `npm` commands are invoked.

#### Rollback/Cleanup
- None.

### Feature: Stop button interrupts active turn without missing turnId

#### Prerequisites
- App is running from this repository.
- At least one thread can run a long response (for example, request a large code explanation).

#### Steps
1. Send a prompt that keeps the assistant generating for several seconds.
2. Immediately click the `Stop` button before the first assistant chunk fully completes.
3. Confirm generation halts.
4. Repeat with a resumed/existing in-progress thread (reload app while a turn is running, then click `Stop`).

#### Expected Results
- No error appears saying `turn/interrupt requires turnId`.
- Turn is interrupted successfully in both immediate-stop and resumed-thread scenarios.
- Thread state exits in-progress and the stop control returns to idle.

#### Rollback/Cleanup
- None.

### Feature: Revert PR #16 mobile viewport and chat scroll behavior changes

#### Prerequisites
- App is running from this repository.
- A thread exists with enough messages to scroll.
- Test on a mobile-sized viewport (for example 375x812).

#### Steps
1. Open an existing thread and scroll up to the middle of the chat history.
2. Wait for an assistant response to stream while staying at the same scroll position.
3. Send a follow-up message and observe chat positioning when completion finishes.
4. Open the composer on mobile and drag within the composer area.
5. Open/close the on-screen keyboard on mobile and verify the page layout remains usable.

#### Expected Results
- Chat behavior matches pre-PR #16 baseline (no PR #16 scroll-preservation logic active).
- No regressions from reverting PR #16 changes in conversation rendering and composer behavior.
- Mobile layout no longer includes PR #16 visual-viewport sync changes.

#### Rollback/Cleanup
- Re-apply PR #16 commits if the reverted behavior is not desired.

### Feature: Thread load capped to latest 10 turns

#### Prerequisites
- App is running from this repository.
- At least one thread exists with more than 10 turns/messages.

#### Steps
1. Open a long thread that previously caused UI lag during initial load.
2. While the thread is loading, immediately click another thread in the sidebar.
3. Return to the long thread.
4. Count visible loaded history blocks and confirm only the newest portion is shown.
5. Call `/codex-api/rpc` with method `thread/read` for the same thread and inspect `result.thread.turns.length`.
6. Call `/codex-api/rpc` with method `thread/resume` for the same thread and inspect `result.thread.turns.length`.

#### Expected Results
- Initial thread load renders only the most recent 10 turns.
- UI remains responsive during thread load.
- You can switch to another thread without the UI freezing.
- `thread/read` and `thread/resume` RPC responses contain at most 10 turns.

#### Rollback/Cleanup
- No cleanup required.

### Feature: Empty thread first message materializes the thread route

#### Prerequisites
- App is running from this repository.
- Browser DevTools Console is available.
- A valid workspace path is available for `thread/start` (for example this repository root).

#### Steps
1. In the browser DevTools Console, run:
   ```js
   const created = await fetch('/codex-api/rpc', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({
       method: 'thread/start',
       params: { cwd: 'C:/Users/SW/Documents/Playground/codexui' },
     }),
   }).then((res) => res.json());
   window.__emptyThreadId = created.result?.thread?.id || '';
   window.__emptyThreadId;
   ```
2. Open `#/thread/<emptyThreadId>` with the returned id.
3. Confirm the page renders the empty-thread state: title/status show `空会话`, subtitle explains the thread has no messages yet, and the body shows `当前会话还没有消息。`
4. In the same empty thread, type a unique first prompt in the composer and submit it.
5. Confirm the UI stays on the same thread route instead of jumping back to `#/home`, and the empty-thread copy disappears.
6. Wait for the first turn to start rendering or for the in-progress state to appear.
7. Call `/codex-api/rpc` with method `thread/read` for the same thread id and inspect `result.thread.turns`.

#### Expected Results
- `thread/start` returns a thread id even before the first user message is sent.
- The empty-thread route is usable: composer accepts input and send works from that route directly.
- Submitting the first message materializes the thread without a permanent `is not materialized yet`, `before first user message`, or `rollout is empty` error surfacing to the user.
- The route remains on the same thread id and conversation content replaces the empty-thread state.
- `thread/read` returns at least one turn for the thread after the first message is sent.

#### Rollback/Cleanup
- Archive the temporary test thread from the UI, or call `/codex-api/rpc` with method `thread/archive` for the created thread id.

### Feature: Skills list request scoped to active thread cwd

#### Prerequisites
- App is running from this repository.
- Browser DevTools Network tab is open.
- At least two threads exist with different `cwd` values.

#### Steps
1. Reload the app and wait for initial data load.
2. In Network tab, inspect `/codex-api/rpc` requests with method `skills/list`.
3. Verify request params contain `cwds` with only the currently selected thread cwd.
4. Switch to another thread with a different cwd.
5. Inspect the next `skills/list` request and verify `cwds` now contains only the new selected thread cwd.

#### Expected Results
- `skills/list` no longer sends every thread cwd in one request.
- Each `skills/list` call includes at most one cwd for the active thread context.
- Skills list still updates when changing selected thread.

#### Rollback/Cleanup
- No cleanup required.

---

### Feature: GitHub Website Redesign — OpenClaw-Inspired Design + Web Demo Link

#### Prerequisites
- The `docs/index.html` file has been updated with the new design.
- A browser is available to view the page locally or via GitHub Pages.

#### Steps
1. Open `docs/index.html` in a browser (local file or via GitHub Pages).
2. Verify the fixed **navigation bar** at top with brand logo, section links, and "Get the App" CTA.
3. Verify the **announcement banner** below nav shows the XCodex WASM link.
4. Verify **hero section** displays lobster emoji, "AnyClaw" title with gradient, tagline, and four CTA buttons: "Try Web Demo", "Google Play", "Download APK", "GitHub".
5. Click **"Try Web Demo"** button — confirm it navigates to `https://xcodex.slrv.md/#/`.
6. Verify the **stats bar** shows key metrics (2 AI Agents, 1 APK, 0 Root Required, 73MB, infinity).
7. Scroll to **Live Demo** section — verify embedded iframe loads `https://xcodex.slrv.md/#/` with mock browser chrome.
8. Scroll to **Screenshots** section — verify four images render (2 desktop, 2 mobile).
9. Scroll to **Features** section — verify 6 feature cards in a 3-column grid.
10. Scroll to **Testimonials** section — verify two rows of auto-scrolling marquee cards (row 2 scrolls reverse). Hover to pause.
11. Scroll through **Architecture**, **Boot Sequence**, **Quick Start**, and **Tech Stack** sections — verify content renders.
12. Verify the **footer** includes a "Web Demo" link to `https://xcodex.slrv.md/#/`.
13. Test responsive at 768px and 480px — nav links collapse, grids single-column, buttons stack vertically.

#### Expected Results
- Page has a dark, premium feel with gradient accents, grain overlay, and smooth animations.
- All links to `https://xcodex.slrv.md/#/` work (announcement, hero CTA, demo section, quick start text, footer).
- Marquee testimonials scroll continuously and pause on hover.
- Embedded iframe demo loads successfully.
- Mobile responsive layout works at all breakpoints.

#### Rollback/Cleanup
- Revert `docs/index.html` to previous commit if needed.

---

### Feature: 会话切换轻量加载态与执行中输入区下拉可用

#### Prerequisites
- `7420` 服务正在运行，且前端资源已更新到本轮构建版本。
- 至少存在两个有消息历史的会话，方便来回切换观察。
- 当前线程可以进入执行中状态，或可手动触发一次长任务。

#### Steps
1. 打开 `7420` 页面并进入任意已有消息的会话。
2. 在左侧连续切换到另一个有历史消息的会话。
3. 观察切换过程中的会话区加载反馈。
4. 确认不会同时出现大骨架、切换遮罩和顶部同步条等多套加载动画。
5. 确认仅保留一个轻量顶部状态提示，旧内容会轻微淡出，而不是整块突然清空跳变。
6. 让当前线程进入执行中状态。
7. 在执行中点击输入框下方的 `模型`、`技能`、`思考强度` 三个控件。
8. 分别确认三个控件都可以正常打开并选择，不会因为执行中而被禁用。

#### Expected Results
- 会话切换时只出现一套低感知加载提示，不再叠加多个加载动画。
- 会话内容切换过程更平滑，旧内容短暂保留并淡出，新内容加载完成后自然替换。
- 执行任务过程中，`模型`、`技能`、`思考强度` 三个按钮仍可点击和打开。
- 修改这些控件不会打断当前正在执行的 turn，只影响后续发送或排队消息。

#### Rollback/Cleanup
- 无需额外清理；若需回退，恢复本轮前端构建前的 `ThreadComposer.vue`、`ThreadConversation.vue` 与 `App.vue` 版本。

---

### Feature: 会话滚动流畅度与全局壳层减重

#### Prerequisites
- `7420` 服务运行中，前端资源已更新到本轮构建版本。
- 准备一个长会话，至少包含 40 条以上消息，最好带命令卡片与图片消息。
- 同时准备桌面端和手机端各做一轮滚动体验验证。

#### Steps
1. 打开长会话，连续上下快速滚动消息列表。
2. 观察滚动过程中是否出现明显掉帧、白块、延迟跟手或 hover 控件抖动。
3. 在会话中切换到另一条有历史消息的线程，观察切换时顶部加载提示和内容过渡。
4. 打开侧栏，再关闭侧栏，检查遮罩、抽屉和主内容切换是否仍然平滑。
5. 在消息列表底部观察“回到底部”按钮、消息卡片、队列区、标题栏和输入区的视觉层级是否更轻。

#### Expected Results
- 长会话滚动时，页面跟手更稳定，不应再出现明显连续掉帧。
- 会话切换仅保留低感知过渡，不出现滤镜感或重阴影拖影。
- 标题栏、消息卡片、队列区和输入区整体更平、更轻，视觉层级更统一。
- 侧栏抽屉与主内容的切换应顺滑，不应因遮罩或重模糊造成明显性能负担。

#### Rollback/Cleanup
- 若需回退，恢复本轮前的 `ThreadConversation.vue`、`DesktopLayout.vue`、`ContentHeader.vue`、`ThreadComposer.vue`、`QueuedMessages.vue` 与 `App.vue` 版本。

---

### Feature: Android 恢复优先 runtime 状态同步

#### Prerequisites
- `7420` 服务运行中，前端资源已更新到本轮构建版本。
- Android CX-Codex 或移动端 WebView 可以访问当前服务。
- 准备一个可运行长任务的会话，用于观察锁屏/切后台恢复。

#### Steps
1. 在 Android 端打开一个会话并发送一条会执行较久的任务。
2. 等待界面出现执行中状态后，锁屏 10-20 秒。
3. 解锁回到 CX-Codex。
4. 观察页面是否先恢复“执行中/等待确认/已完成”等状态，而不是长时间卡在空白或旧状态。
5. 如果任务已完成，等待 2-3 秒，确认最终消息会自动补齐。
6. 再次切后台 10 秒后回到应用，重复观察一次。
7. 在桌面浏览器打开同一会话，确认 Web 端状态仍能正常跟随，不受 Android 恢复策略影响。

#### Expected Results
- Android 恢复后第一轮同步先走 runtime snapshot 和事件回放，不应立即触发明显卡顿的全量刷新。
- 任务执行中应显示执行态；任务完成后不应长期停留在“思考中”。
- 若有授权请求，应显示等待确认状态，并保留停止/发送队列逻辑。
- 第二轮补偿同步会按需刷新消息和线程列表，最终内容应自动补齐。
- `/codex-api/health` 中近期 `recentTimeouts` 不应因为恢复动作快速增加。

#### Rollback/Cleanup
- 无需清理。若需回退，恢复本轮 `src/composables/useDesktopState.ts`、`src/api/codexGateway.ts`、`src/App.vue` 和 `src/server/codexAppServerBridge.ts` 的改动。

---

### Feature: Android release 版本号与自动化回归

#### Prerequisites
- `7420` 服务运行中。
- 本机已安装 Android SDK、JDK，并存在 release 签名配置。
- 前端和 Android 资源已更新到当前版本。

#### Steps
1. 执行 `npm run test:7420 -- -ScreenshotDir output\regression-7420`。
2. 确认本机 `/health`、`/codex-api/health`、事件回放、公网 `/health` 均通过。
3. 确认桌面 `1440x900`、手机 `390x844`、折叠屏 `884x1104` 三个视口均无横向溢出和页面错误。
4. 执行 `npm run mobile:android:sync`。
5. 执行 `.\gradlew.bat assembleRelease`。
6. 检查 release APK 的 `versionName` 为当前 `package.json` 版本，`versionCode` 按 `major * 10000 + minor * 100 + patch` 递增。
7. 推送数字 tag 触发 GitHub Release 时，确认 `.github/workflows/release.yml` 未覆盖 `APP_VERSION_CODE`，Actions 构建也应使用同一套版本码规则。

#### Expected Results
- 自动化回归全部通过。
- Android Web 资源同步成功。
- release APK 构建成功。
- 本地和 GitHub Actions 产出的数字版本都对应 `major * 10000 + minor * 100 + patch` 版本码，可覆盖安装上一版构建。

#### Rollback/Cleanup
- 若需回退，恢复 `package.json`、`package-lock.json`、`android/app/build.gradle`、`.github/workflows/release.yml` 与 `docs/changelog.zh-CN.md`。

---

### Feature: 后台同步减少重型线程列表轮询

#### Prerequisites
- `7420` 服务运行中。
- 至少有一个已加载会话。
- 浏览器或 Android 壳能够连接通知流。

#### Steps
1. 打开任意会话并保持页面可见 2 分钟；可同时打开多个页面模拟旧客户端或多端访问。
2. 观察 `/codex-api/health` 的 `rpcDiagnostics.recentSlowRpc`。
3. 在会话执行中，确认前端仍能显示运行态、停止按钮和当前会话增量内容。
4. 锁屏或切后台后回到 Android 壳，确认 resume 首次恢复不会强制拉完整线程列表。
5. 手动点击刷新，确认仍会刷新线程列表和当前会话内容。
6. 观察任务完成、状态变化、通知流重连时，确认它们不会单独触发完整 `thread/list`，只有新建/归档/重命名等列表结构变化才触发。

#### Expected Results
- 后台心跳不再因为通知流陈旧或会话执行中而固定触发 `thread/list`。
- Android resume 主要走事件回放、runtime snapshot 和当前会话消息同步。
- 手动刷新、首次加载、通知明确指示列表变化时，线程列表仍会更新。
- RPC 队列中不应再持续出现每 30 秒左右一次的慢 `thread/list`。
- `turn/completed`、`thread/status/changed` 等运行态通知只刷新当前会话，不刷新完整列表。
- 多页面或旧客户端短时间重复请求相同 `thread/list` 时，后端应返回短缓存；新建/归档/重命名等结构变化会让缓存失效。

#### Rollback/Cleanup
- 若需回退，恢复 `src/composables/useDesktopState.ts` 中后台同步间隔和线程列表刷新判断。

---

### Feature: 7420 稳定性浸泡测试脚本

#### Prerequisites
- `7420` 服务运行中。
- 本机可访问 `http://127.0.0.1:7420/health` 与 `http://127.0.0.1:7420/codex-api/health`。
- 若传入 `-PublicHealthUrl`，公网入口 `/health` 可访问。

#### Steps
1. 短时验证脚本：执行 `npm run test:7420:soak -- -DurationSeconds 90 -IntervalSeconds 15`。
2. 发布前浸泡：执行 `npm run test:7420:soak -- -DurationSeconds 7200 -IntervalSeconds 15`。
3. 如只验证本机稳定性，可追加 `-SkipPublic`。
4. 查看 `output\soak-7420\soak-*.json` 报告。

#### Expected Results
- 脚本在每个采样点输出本机、公网、API、pending/queued RPC、timeout 和慢 `thread/list` 信息。
- 没有连续健康检查失败。
- `queuedRpcCount` 与 `pendingRpcCount` 不超过阈值。
- 浸泡窗口内不出现新的 RPC timeout。
- 脚本退出码为 `0`，JSON 报告 `summary.passed=true`。

#### Rollback/Cleanup
- 若需回退，移除 `scripts/soak-7420.ps1`，并恢复 `package.json` 和本测试说明。

---

### Feature: 2.1.3 稳定版发布验证

#### Prerequisites
- `7420` 服务运行中。
- 本轮后台同步减压和浸泡脚本改动已构建进前端与 CLI。
- Android SDK、JDK、release 签名配置可用。

#### Steps
1. 执行 `npm run build`。
2. 执行 `npm run test:7420 -- -ScreenshotDir output\regression-7420-2.1.3`。
3. 执行 `npm run mobile:android:sync`。
4. 在 `android` 目录执行 `.\gradlew.bat assembleRelease`。
5. 检查 APK `versionName=2.1.3`、`versionCode=20103`。
6. 核对 2 小时浸泡报告：`soak-20260427-025140.json`、`soak-20260427-032159.json`、`soak-20260427-035212.json`、`soak-20260427-042233.json`。

#### Expected Results
- Web/CLI 构建通过。
- 本机、公网、事件回放、通知游标恢复、桌面/手机/折叠屏自动化回归通过。
- 四段浸泡累计 480 个采样点均通过，新增 RPC timeout 为 `0`，最大 `queuedRpcCount=2`，最大 `pendingRpcCount=1`。
- Android release APK 构建通过并可作为 `2.1.3` GitHub Release 资产发布。

#### Rollback/Cleanup
- 若需回退，恢复 `package.json`、`package-lock.json`、`docs/changelog.zh-CN.md` 与本测试记录。

---

### Feature: thread/list stale-while-revalidate 缓存

#### Prerequisites
- `7420` 服务运行中。
- 至少有一个会话列表缓存可由 `thread/list` 建立。
- `/codex-api/health` 可查看 RPC 队列和慢请求诊断。

#### Steps
1. 连续打开 Web 端和 Android 端，模拟多端同时访问会话列表。
2. 等待 `thread/list` 首次成功返回并写入缓存。
3. 在 3 分钟新鲜期内重复触发后台同步或手动进入页面。
4. 超过新鲜期后再次触发列表读取，观察页面是否先返回已有列表，同时后台刷新缓存。
5. 查看 `/codex-api/health` 的 `queuedRpcCount`、`pendingRpcCount` 和 `recentTimeouts`。
6. 新建、归档或重命名会话，确认结构变化仍会清理列表缓存并刷新列表。

#### Expected Results
- 新鲜期内重复 `thread/list` 不进入 app-server RPC 队列。
- 缓存过期但仍在兜底窗口内时，前端不等待慢列表 RPC 才恢复页面。
- 后台刷新同一缓存键时只保留一轮 in-flight 请求。
- 结构变化后缓存失效，列表最终反映新建、归档或重命名结果。
- `recentTimeouts` 不应因为列表刷新增加。

#### Rollback/Cleanup
- 若需回退，恢复 `src/server/codexAppServerBridge.ts` 中 `thread/list` 缓存读取和刷新逻辑。

---

### Feature: Android 启动地址兜底

#### Prerequisites
- Android release APK 已构建。
- 可用 `aapt` 检查 APK 版本和 Manifest。
- 真机可安装 APK 时，优先连接 `adb` 抓启动日志。

#### Steps
1. 构建未显式传入 `CAP_SERVER_URL` 的 APK。
2. 启动 App，确认不会因为空 `serverUrl` 在原生初始化阶段闪退。
3. 构建默认公网地址 APK，检查 `android/app/src/main/assets/capacitor.config.json` 包含 `server.url`。
4. 安装默认公网地址 APK，打开 App。
5. 如仍闪退，连接真机执行 `adb logcat -d -t 300 | Select-String "com.cxcodex.bridge|AndroidRuntime|FATAL EXCEPTION"`。

#### Expected Results
- 未配置远程地址时，原生层不会把空字符串传给 Capacitor `serverUrl`。
- 默认打包脚本不写入任何服务地址；如需私有预置包，必须显式传入 `-ServerUrl`。
- APK 可启动到 WebView；公网不可用时应显示页面加载错误或 Web 侧状态，而不是原生闪退。

#### Rollback/Cleanup
- 若需回退，恢复 `android/app/src/main/java/com/cxcodex/bridge/MainActivity.java` 与 `scripts/package-android-release.ps1`。

---

### Feature: 2.1.15 公开发行文档与脱敏截图

#### Prerequisites
- Playwright Chromium 已可用。
- 当前工作区已包含 2.1.15 代码、README、Release 文案和截图资产。
- 不使用真实账号、真实路径、Token、公网地址或私人会话作为截图内容。

#### Steps
1. 运行 Playwright/Chromium 截图脚本，生成 `docs/screenshots/chat.png`、`chat-mobile.png`、`android-setup.png`、`github-trending.png`。
2. 打开 `README.md`，确认首屏介绍的是 `OpenAI Codex Web UI`、Android、自托管远程访问和 Windows 友好部署。
3. 搜索 README、Release 和包装文案，确认不再引用旧图 `one-command-windows.svg`、`social-preview.svg`、`skills-hub.png`、`skills-hub-mobile.png`。
4. 打开 `RELEASE.md` 和 `docs/release-template.zh-CN.md`，确认版本命名为 `2.1.x`，没有 `bridge`、`beta`、`rc` 等英文后缀。
5. 打开 `.github/release-body.md`，确认版本号和本次用户可感知变化对应当前 Release。
6. 打开 `docs/operations-plan.zh-CN.md`，确认包含版本节奏、Issue 运营、搜索关键词和近期路线。
7. 执行 `npm.cmd run package:release -- -Version 2.1.15`，确认即使 Windows PowerShell 缺少 `Get-FileHash` 也能生成 sha256。

#### Expected Results
- README 不包含旧截图引用。
- 所有公开截图都使用演示数据。
- Release 文案不包含私人地址、密钥、真实路径或私人会话。
- GitHub 搜索关键词覆盖 Codex Web UI、Android client、self-hosted、Windows、remote access。
- 运营规划能直接指导后续版本维护和项目推广。
- Release zip 和 sha256 文件生成成功。

#### Rollback/Cleanup
- 若需回退，恢复 `README.md`、`RELEASE.md`、`.github/release-body.md`、`docs/github-launch-kit.zh-CN.md`、`docs/release-template.zh-CN.md`、`docs/operations-plan.zh-CN.md` 与 `docs/screenshots/`。

---

### Feature: 移动端会话阅读舒适度优化

#### Prerequisites
- Web 或 Android 端可打开已有长会话。
- 会话中至少包含一条长用户消息、一条长助手回复、收藏按钮、复制/回滚操作和底部输入框。

#### Steps
1. 在 375px 宽度手机视口或 Android 真机打开会话内容页。
2. 查看长用户消息，确认气泡宽度不撑满屏幕，圆角、背景和正文行距不会显得厚重。
3. 查看长助手回复，确认白色阅读卡片边框更轻、阴影更弱、正文行距更紧凑。
4. 点击或聚焦一条可操作消息，确认复制/回滚按钮仍可出现，但默认视觉干扰降低。
5. 确认收藏按钮和复制/回滚在同一条操作栏内，默认不占用正文右侧独立列。
6. 点击卡片前确认收藏、复制、回滚操作栏隐藏；点击卡片后确认操作栏出现且收藏态清晰。
7. 查看底部输入框默认状态，确认未输入时占用高度更小，技能、设置、语音、发送/停止按钮仍可点击。
8. 输入多行文字，确认输入框可继续增长并滚动，不遮挡主要按钮。
9. 在桌面宽度打开同一会话，确认消息卡片和输入区仍保持可读，不出现布局挤压。

#### Expected Results
- 手机端一屏可见内容增加，长文本阅读疲劳降低。
- 消息正文、代码片段、链接和图片预览仍可正常显示。
- 复制、回滚、收藏仍可用，且触控反馈正常。
- 底部输入区默认更紧凑，多行输入时仍可用。
- 页面不出现横向滚动或按钮遮挡正文。

#### Rollback/Cleanup
- 若需回退，恢复 `src/style.css`、`src/components/content/ThreadConversation.vue` 和 `src/components/content/ThreadComposer.vue` 中本节对应样式。

---

### Feature: 会话列表重命名弹窗稳定输入

#### Prerequisites
- Web 或 Android 端可打开会话列表。
- 至少存在一个普通会话、一个置顶会话或一个正在运行会话。

#### Steps
1. 打开会话列表，点击某条会话右侧操作按钮。
2. 点击 `重命名会话`。
3. 确认重命名弹窗不会闪退，输入框自动聚焦且标题文本被选中。
4. 直接输入新标题，确认输入内容不会被菜单关闭、会话切换或遮罩点击打断。
5. 点击保存，确认弹窗关闭并触发会话重命名。
6. 再次打开重命名弹窗，点击弹窗外遮罩，确认仅在用户明确点遮罩时关闭。
7. 在手机触控环境重复上述步骤，确认不会出现弹窗闪现后不可输入。

#### Expected Results
- 菜单项点击只打开弹窗，不触发会话行点击。
- 弹窗打开后输入框稳定可输入。
- 同一次点击不会被误判为遮罩点击导致弹窗关闭。
- 保存、取消、Esc 和遮罩关闭行为保持可用。

#### Rollback/Cleanup
- 若需回退，恢复 `src/components/sidebar/SidebarThreadTree.vue` 中重命名弹窗和线程菜单事件处理。

---

### Feature: 会话切换主内容优先加载

#### Prerequisites
- `7420` 服务运行中，当前构建已包含 `2.1.5` 切换链路优化。
- 至少准备两个已有消息会话，其中一个会话上下文进度尚未缓存或 token 统计可能需要从 session log 补齐。

#### Steps
1. 打开 Web 或 Android 端会话列表。
2. 从会话 A 切换到会话 B。
3. 观察主内容区消息是否优先出现。
4. 打开 `/codex-api/health`，观察切换时 `recentSlowRpc` 中是否还先出现无必要的 `thread/resume`。
5. 观察上下文进度条：未就绪时可显示占位，稍后后台补齐。
6. 直接通过 URL 打开一个会话路由，确认不会先等待完整 runtime snapshot 校验再进入页面。
7. 连续快速切换两个会话，观察 Network 中同一会话是否只保留一条主 `/codex-api/state/thread/:id` 读取。
8. 等待一次后台 `thread/list` 慢刷新，再切换会话，确认主内容读取不会长期排在列表刷新后面。

#### Expected Results
- 正常已有会话切换不应先发 `thread/resume`，主 `thread/read` 优先执行。
- 上下文 token 统计不阻塞消息首屏显示。
- 同一会话不会因为后台同步和点击选择同时触发重复主内容读取。
- 慢 `thread/list` 只能后台更新列表，不应阻塞当前会话主内容首屏。
- 如果会话确实未物化，才允许执行 `thread/resume` 后重试读取。
- 路由进入会话时先选择会话并加载主内容，失败再由内容加载链路呈现错误。

#### Rollback/Cleanup
- 若需回退，恢复 `src/composables/useDesktopState.ts`、`src/server/codexAppServerBridge.ts`、`src/api/codexGateway.ts` 与 `src/App.vue`。

---

### Feature: Android 锁屏恢复后清理残留执行态

#### Prerequisites
- Android 端已连接 7420，能进入一个可执行命令的会话。
- 准备一个会产生命令执行并持续一段时间的任务。

#### Steps
1. 在 Android 端会话内容页发送任务。
2. 等待页面出现思考或执行命令卡片。
3. 切到其他应用或锁屏 2-5 分钟。
4. 解锁回到 CX-Codex。
5. 等待首轮自动同步完成，不手动点刷新。
6. 查看会话中是否已经出现新的助手回复。
7. 如果回复已完成，确认底部不再保留 `思考中` 或 `执行命令` 运行卡片，停止按钮也不继续显示。
8. 再次切换应用后返回，确认不会重新出现旧的运行卡片。
9. 如果旧版本状态下仍显示停止按钮，点击停止，确认前端会刷新并清理已结束任务的残留运行态。
10. 在任务完成回复已经显示后，如果底部仍残留旧命令卡片，等待一次自动刷新或手动点刷新，确认旧命令卡片会消失。
11. 在会话顶部点击刷新按钮，确认按钮等待真实刷新完成后才恢复可点，且刷新后不再显示残留 `思考中`。

#### Expected Results
- Android 回到前台后会立即强制刷新当前会话消息。
- 如果 runtime snapshot 已过期且 fresh 消息中已有后续助手回复，旧的 `inProgress` 命令不会继续作为强运行信号。
- 已完成任务不会卡在 `思考中`、`执行命令` 或显示虚假的已运行时长。
- 停止已结束任务时不会继续保留无效的 `思考中` 卡片或错误停止状态。
- 即使 App 后台期间漏掉 `turn/completed` 通知，残留 live 命令也不会追加在完成回复后继续显示。
- 会话顶部刷新按钮执行强恢复刷新：中断旧同步、重拉 runtime snapshot/消息/pending requests/thread list，并收敛本地残留运行态。
- 真正仍在运行、仍有 fresh runtime/通知/权限请求/队列信号的任务仍保持运行态。

#### Rollback/Cleanup
- 若需回退，恢复 `src/composables/useDesktopState.ts` 中 runtime stale、残留命令结算和 Android resume 强制刷新逻辑。

---

### Feature: Android 不显示桌面端不可用

#### Prerequisites
- Android 端已连接 7420。
- 当前机器的 7420 `/health` 和 `/codex-api/health` 正常。

#### Steps
1. 打开 Android CX-Codex。
2. 进入任意会话内容页。
3. 查看标题下方状态胶囊。
4. 切换会话、锁屏后返回，再次查看状态胶囊。
5. 在 Web 浏览器打开同一服务，确认非 Android 环境仍可显示官方桌面端刷新状态。

#### Expected Results
- Android shell 不显示 `桌面端 不可用`。
- Android 状态优先显示会话运行、同步、连接或未读状态。
- Web 端桌面刷新能力仍保留，不影响设置里的刷新桌面端入口。

#### Rollback/Cleanup
- 若需回退，恢复 `src/App.vue` 中 `showDesktopStatusPill` 的 Android shell 过滤逻辑。

---

### Feature: 计划模式接近桌面端行为

#### Prerequisites
- `7420` 服务运行中，当前构建已包含计划模式优化。
- 使用移动宽度或 Android 端打开 CX-Codex。

#### Steps
1. 打开新会话或任意已有会话。
2. 点击输入区的 `计划`。
3. 输入一个只需要制定计划的任务并发送。
4. 观察回复内容是否只给计划，不执行命令、不读写文件。
5. 等待回复完成后查看输入区模式。
6. 打开 `/codex-api/health`，确认 `activePlanModeTurnCount` 回到 `0`。
7. 再输入 `开始执行`，确认默认已处于 `执行`，不会继续被计划模式拦截。

#### Expected Results
- 前端发送计划时使用原生 `mode: plan`，不再把整段 Plan Mode 规则注入用户消息。
- 如果后端不支持原生 `mode: plan`，才降级注入只读计划提示。
- 计划消息发送后输入区自动切回 `执行`。
- 计划完成后不残留停止按钮、思考中状态或 `activePlanModeTurnCount`。

#### Rollback/Cleanup
- 若需回退，恢复 `src/server/codexAppServerBridge.ts`、`src/composables/useDesktopState.ts` 和 `src/components/content/ThreadComposer.vue` 的计划模式相关改动。

---

### Feature: 会话列表排除归档线程，搜索仍覆盖历史线程

#### Prerequisites
- `7420` 服务运行中，当前构建已包含会话列表与搜索范围修复。
- 本机 Codex 存在活跃线程与归档线程。

#### Steps
1. 打开 7420 侧边栏会话列表。
2. 与桌面端主列表对比，确认已归档会话不会出现在普通列表中。
3. 在 7420 中删除/归档一个临时活跃会话并刷新列表。
4. 搜索一个只存在于历史/归档线程标题中的关键词。
5. 调用 `/codex-api/thread-search`，确认 `indexedThreadCount` 仍覆盖历史线程。

#### Expected Results
- 7420 普通会话列表只使用 active 线程，删除/归档后不会因为 archived 回流再次出现。
- 线程搜索索引仍可包含 active 与 archived 线程。
- 搜索仍只匹配会话标题，不用正文内容污染结果。
- 若桌面端显示的是 prompt history 或 ambient suggestion，而不是实际线程，7420 不会伪造成可点击线程。

#### Rollback/Cleanup
- 若需回退，恢复 `src/api/codexGateway.ts` 和 `src/server/codexAppServerBridge.ts` 的归档线程读取逻辑。

---

### Feature: 思考中状态稳定收敛

#### Prerequisites
- `7420` 服务运行中，当前构建已包含 runtime 收敛修复。
- `/codex-api/health` 中 `pendingRpcCount`、`queuedRpcCount`、`pendingServerRequestCount` 为 0 时再重启验证。

#### Steps
1. 打开任意会话，发送一个会产生短命令或短回复的任务。
2. 任务执行期间保持页面打开，确认思考/命令卡片正常出现。
3. 等待任务完成，确认最终回复出现后思考/命令卡片自动消失。
4. 再发送一个任务，任务执行期间切换应用或锁屏 2 分钟后返回。
5. 等待自动同步完成，确认没有旧的 `思考中` 残留。
6. 搜索历史线程标题，确认搜索不会造成大量 `thread/read` 慢调用。
7. 打开 `/codex-api/health`，确认没有因为普通 `thread/read` 留下 `queued` 执行态。

#### Expected Results
- 普通 `thread/read` 不会被记录成执行队列状态。
- 过期运行态在没有 fresh `thread/read` 佐证时降级为 `sync_degraded`，不会继续展示为思考中。
- 搜索索引只用 `session_index.jsonl` 的标题补齐历史记录，不逐个读取历史线程。
- 计划模式完成、失败或中断后，`/codex-api/health` 中 `activePlanModeTurnCount` 回到 `0`。
- 安卓前台恢复会按通知 replay、runtime snapshot、消息详情的顺序强制收敛当前会话。
- 会话顶部刷新可清理已结束任务留下的旧 `liveOverlay`、`activeTurnId`、运行中命令卡片和停止按钮。
- 新启动日志不再输出明文 `Password:` 值，敏感 token/query 参数会被脱敏。
- 真正仍在执行且 fresh `thread/read` 仍显示 inProgress 的任务继续显示运行态。

#### Rollback/Cleanup
- 若需回退，恢复 `src/server/codexAppServerBridge.ts`、`src/composables/useDesktopState.ts` 和启动脚本的稳定性收敛改动。

---

### Feature: 点击停止后立即清理思考中卡片

#### Prerequisites
- `7420` 服务运行中，当前构建已包含停止收敛修复。
- `/codex-api/health` 可访问。

#### Steps
1. 打开 Android 或移动宽度浏览器。
2. 在任意会话发送一个会持续一段时间的任务。
3. 等待底部出现 `思考中` 或执行卡片，并确认输入区显示停止按钮。
4. 点击停止按钮。
5. 立即观察底部运行卡片和停止按钮。
6. 等待 5-10 秒，再打开 `/codex-api/health`。
7. 如果后端 `turn/interrupt` 发生 timeout，刷新当前会话再观察。

#### Expected Results
- 点击停止后前端立即隐藏 `思考中` 卡片和停止按钮，不等待 `turn/interrupt` RPC 返回。
- 本地 `activeTurnId`、`liveOverlay`、运行中命令残影和 pending turn request 会同步清理。
- 如果 `turn/interrupt` 超时或 app-server 已无 active turn，后端 runtime snapshot 会收敛为 `interrupted`，不会继续返回 `stopping`。
- 刷新当前会话后不会重新出现旧的 `思考中` 卡片。

#### Rollback/Cleanup
- 若需回退，恢复 `src/composables/useDesktopState.ts` 的 `settleInterruptedThreadState` 调用，以及 `src/server/codexAppServerBridge.ts` 中 interrupt timeout 的本地收敛逻辑。

---

### Feature: 完成快照清理本地 pending turn

#### Prerequisites
- `7420` 服务运行中，当前构建已包含 runtime snapshot 收敛修复。
- 已存在一个后端快照显示 `executionState=completed`、`inProgress=false` 的会话。

#### Steps
1. 打开一个此前出现过 `思考中` 残留的会话。
2. 调用 `/codex-api/runtime/snapshot?threadId=<threadId>`。
3. 确认返回 `completed`、`canStop=false`、`pendingServerRequests=[]`。
4. 刷新当前会话页面。
5. 观察底部 live overlay 和输入区停止按钮。

#### Expected Results
- 后端快照已经 settled 时，前端会清理本地 `pendingTurnRequest`。
- `pendingTurnRequest` 不再阻止 `clearSettledRuntimeResidue` 执行。
- 页面不再因为旧 optimistic/pending 状态继续显示 `思考中`。
- 停止按钮不会在已完成会话里残留。

#### Regression Evidence
- 2026-05-13 验证线程 `019e15aa-f206-7e01-8258-9361cc4768ce`：
  - `/codex-api/runtime/snapshot` 返回 `executionState=completed`、`inProgress=false`、`canStop=false`。
  - 浏览器回归断言 `hasThinking=false`、`hasStop=false`。

#### Rollback/Cleanup
- 若需回退，恢复 `src/composables/useDesktopState.ts` 中 `applyRuntimeSnapshotState` 对 settled 快照清理 `pendingTurnRequest` 的逻辑。

---

### Feature: 完成快照强制补齐最新消息

#### Prerequisites
- `7420` 服务运行中，当前构建已包含 settled runtime message refresh 修复。
- 存在一个老线程：`thread/read(includeTurns:false)` 的 `updatedAt` 不随最新 turn 变化，但 `thread/read(includeTurns:true)` 已能读到最终回复。

#### Steps
1. 在当前线程发送任务。
2. 任务执行期间关闭页面、切换应用或让通知流断开。
3. 等待后端任务完成。
4. 重新打开同一线程。
5. 等待一次后台同步或点击顶部刷新。
6. 观察页面尾部消息和底部 live overlay。

#### Expected Results
- `/codex-api/runtime/snapshot` 返回 `completed`、`interrupted`、`failed`、`idle` 或 `sync_degraded` 时，前端把它视为非运行态。
- 即使线程列表版本号没有变化，前端也会按 runtime 的完成事件 key 对当前线程强制重拉一次消息详情。
- 服务端不能仅因 `thread/read(includeTurns:false)` 的 `updatedAt` 与缓存一致就复用旧 turns；当 runtime 已完成且缓存早于完成事件时，必须重读完整 turns。
- 前端遇到 settled runtime 的补齐场景时，会额外走一次直接 `thread/read(includeTurns:true)`，避免旧状态快照缓存遮住最终回复。
- 若后续轮询返回的状态快照比本地已补齐的消息更旧，前端会保留本地较新的消息，不允许旧快照倒退覆盖。
- 最新用户消息和最终回复会补齐显示。
- 旧的 `思考中` 卡片、停止按钮和运行中命令残影不会继续出现。

#### Regression Evidence
- 2026-05-13 浏览器自动化验证线程 `019e15aa-f206-7e01-8258-9361cc4768ce`：
  - 页面命中最新问题 `为什么生产环境的回复比测试环境慢`。
  - 页面命中最终回复关键词 `生产比测试慢` / `生产链路更长`。
  - 等待 7 秒后仍为 `hasThinking=false`、`hasNoCommand=false`，旧状态快照未再覆盖新消息。

#### Rollback/Cleanup
- 若需回退，恢复 `src/composables/useDesktopState.ts` 中 `settledRuntimeMessageRefreshKeyByThreadId` 和 `sync_degraded` settled 判定相关改动。

---

### Feature: SQLite runtime store 任务状态中枢

#### Prerequisites
- 当前构建已包含 `~/.cx-codex/runtime.sqlite` runtime store。
- 不通过重启 7420 修复运行中任务。

#### Steps
1. 启动 7420 后打开任意已有会话。
2. 发送一个短任务，等待出现运行态。
3. 查询 `/codex-api/health`，确认返回 `runtimeStore`。
4. 查询 `/codex-api/runtime/thread/<threadId>`，确认返回本地 snapshot 和 request。
5. 调用 `/codex-api/runtime/events?afterSeq=0&limit=20`，确认事件带递增 `seq`。
6. 关闭页面后等待任务完成，再重新打开同一线程。
7. 点击顶部刷新，确认会调用 reconcile 并按后端状态收敛。

#### Expected Results
- `runtimeStore.path` 指向 `~/.cx-codex/runtime.sqlite`。
- `runtimeStore.latestSeq` 随 app-server notification 增长。
- 发送请求先产生 runtime request，再进入 `running` 或 `start_uncertain`。
- `start_uncertain` 不会无限显示普通 `思考中`，而是显示 `确认任务状态中`。
- 页面恢复优先读取 runtime snapshot，再按需补消息。
- SQLite 事件 replay 不依赖内存 buffer，页面关闭后仍可补游标。

#### Regression Evidence
- 2026-05-13 静态验证：`git diff --check` 通过。
- 2026-05-13 构建验证：`npm.cmd run build` 通过。
- 2026-05-13 重启 7420 后健康检查通过：
  - `/health` 返回 `status=ok`。
  - `/codex-api/health` 返回 `runtimeStore.path=~\.cx-codex\runtime.sqlite`、`pendingRpcCount=0`、`queuedRpcCount=0`、`pendingServerRequestCount=0`、`activePlanModeTurnCount=0`。
- 2026-05-13 浏览器自动化移动视口验证线程 `019e2206-b4dd-7ee1-906b-ed2aae1b4531`：
  - 短任务最终回复 `7420-runtime-ok`。
  - 20 秒 PowerShell 等待任务发送后关闭页面，等待完成后重新打开同一线程，最终回复 `7420-runtime-sleep-ok` 可见。
  - 重新打开后断言 `hasThinking=false`、`hasProcessing=false`、`hasStop=false`。

---

### Feature: 手动刷新保持当前线程

#### Prerequisites
- 当前构建已包含 `loadThreads({ preserveMissingSelected: true })` 的手动刷新和后台同步保护。
- 当前打开的线程可能暂时不在 `thread/list` 返回的当前批次里。

#### Steps
1. 打开线程 `019e2206-b4dd-7ee1-906b-ed2aae1b4531`。
2. 点击顶部“刷新当前会话内容”按钮。
3. 等待刷新完成。
4. 检查 URL、最终回复、运行卡片和后端健康状态。

#### Expected Results
- 刷新当前线程时不会因为 `thread/list` 缺少当前线程而跳到列表第一项。
- URL 保持当前线程。
- 已完成任务不会重新触发。
- 页面不出现 `思考中`、`正在处理` 或停止按钮。

#### Regression Evidence
- 2026-05-13 浏览器自动化移动视口验证：
  - 点击刷新前后 URL 均为 `#/thread/019e2206-b4dd-7ee1-906b-ed2aae1b4531`。
  - 页面仍显示 `7420-runtime-sleep-ok`。
  - 刷新后断言 `hasThinking=false`、`hasProcessing=false`、`hasStop=false`。
  - 5 秒后 `/codex-api/health` 收敛为 `pendingRpcCount=0`、`queuedRpcCount=0`、`pendingServerRequestCount=0`、`runtimeStore.uncertainRequestCount=0`。

---

### Feature: Runtime store 产品化风险加固

#### Prerequisites
- 当前构建已包含 SQLite runtime store。
- 7420 已重启并加载最新 `dist-cli`。

#### Steps
1. 在移动视口打开 7420。
2. 发送短任务并等待完成。
3. 查询最新 `runtime_requests.payload_json`。
4. 发送长任务后关闭页面，等待后台完成再重新打开线程。
5. 点击顶部刷新。
6. 发送长任务并点击停止。

#### Expected Results
- `runtime_requests.payload_json` 不保存完整用户提示词，只保留计数、模式、模型和哈希等摘要。
- `runtime_events` 有保留上限，避免长期流式事件无限增长。
- 7420 或 app-server 重启后，早于当前 app-server 启动时间的 active 快照会降级为 `sync_degraded`。
- 页面恢复、手动刷新、停止后都不残留 `思考中`、`正在处理` 或停止按钮。

#### Regression Evidence
- 2026-05-14 静态验证：`git diff --check` 通过。
- 2026-05-14 构建验证：`npm.cmd run build` 通过。
- 2026-05-14 重启 7420 后健康检查通过：
  - `/health` 返回 `status=ok`。
  - `/codex-api/health` 返回 `pendingRpcCount=0`、`queuedRpcCount=0`、`pendingServerRequestCount=0`、`activePlanModeTurnCount=0`。
- 2026-05-14 浏览器自动化移动视口验证线程 `019e2222-3f5f-7260-8034-15412b0062e4`：
  - 短任务最终回复 `7420-risk-ok`，页面断言 `hasThinking=false`、`hasProcessing=false`、`hasStop=false`。
  - 技能按钮为图标触发器，尺寸约 `36x36`。
  - 最新 `runtime_requests.payload_json` 不包含 `7420-risk-smoke`，`promptHash` 长度为 64。
  - 25 秒后台任务发送后关闭页面，等待完成后重新打开同一线程，最终回复 `7420-risk-background-close-ok` 可见。
  - 点击顶部刷新后 URL 保持 `#/thread/019e2222-3f5f-7260-8034-15412b0062e4`。
  - 45 秒任务点击停止后，事件 replay 显示 `turn/completed.status=interrupted`，页面最终断言 `hasThinking=false`、`hasProcessing=false`、`hasStop=false`。

---

### Feature: 停止按钮确认式收敛

#### Prerequisites
- 当前构建已包含 `/codex-api/runtime/interrupt`。
- 当前会话存在一个可停止的运行中 turn。

#### Steps
1. 发送一个会运行 30 秒以上的任务。
2. 等停止按钮出现后点击停止。
3. 观察按钮和底部运行卡片。
4. 如果 `turn/interrupt` 正常返回，确认运行卡片消失。
5. 如果 `turn/interrupt` 超时，确认页面显示 `停止确认中`。
6. 点击顶部刷新或等待后台 reconciler，确认最终进入 stopped/completed/running 中的一种真实状态。

#### Expected Results
- 点击停止后不再直接假设任务已停止。
- timeout 不会被当成成功；会进入 `stop_uncertain`。
- `stop_uncertain` 下停止按钮禁用，避免重复误点。
- reconcile 发现仍在运行时恢复运行态，发现已完成/已中断时清理旧卡片。

#### Regression Evidence
- 2026-05-13 静态验证：`git diff --check` 通过。
- 2026-05-13 构建验证：`npm.cmd run build` 通过。
- 2026-05-13 浏览器自动化移动视口验证线程 `019e2206-b4dd-7ee1-906b-ed2aae1b4531`：
  - 发送 60 秒 PowerShell 等待任务，运行态出现后点击停止。
  - 事件 replay 显示 `turn/completed` 的 `status=interrupted`。
  - 页面最终断言 `hasThinking=false`、`hasStop=false`。
  - `/codex-api/health` 收敛为 `pendingRpcCount=0`、`queuedRpcCount=0`、`pendingServerRequestCount=0`、`runtimeStore.uncertainRequestCount=0`。

---

### Feature: 技能中心 / GitHub 热门直达路由

#### Prerequisites
- 当前构建使用 hash router。
- 7420 服务已启动并能访问 `http://127.0.0.1:7420`。

#### Steps
1. 直接打开 `http://127.0.0.1:7420/skills`。
2. 直接打开 `http://127.0.0.1:7420/github-trending`。
3. 分别确认页面内容和控制台状态。

#### Expected Results
- `/skills` 自动规范化为 `/#/skills` 并显示技能中心。
- `/github-trending` 自动规范化为 `/#/github-trending` 并显示 GitHub 热门。
- 两个入口都不落回首页，不出现白屏或空内容区。
- 控制台无前端运行时错误。

#### Regression Evidence
- 2026-05-15 静态验证：`git diff --check` 通过。
- 2026-05-15 构建验证：`npm.cmd run build:frontend` 通过。
- 2026-05-15 浏览器自动化验证：
  - 打开 `/skills?cb=<timestamp>` 后 URL 为 `/#/skills?cb=<timestamp>`，页面显示 `技能中心`、`安装、管理并发现 GitHub 上的 Codex 技能`、`已安装（63）`。
  - 打开 `/github-trending?cb=<timestamp>` 后 URL 为 `/#/github-trending?cb=<timestamp>`，页面显示 `GitHub 热门`、`热门仓库`、`进入主页`。
  - 两个页面控制台均无 error，Network 未捕获 404。

---

### Feature: 本地文档预览

#### Prerequisites
- 当前构建已包含 `local-preview.html`。
- 本地文件通过 `/codex-local-browse/*path` 或 `/local-preview.html?path=<absolutePath>` 打开。

#### Steps
1. 打开 Markdown 文件。
2. 打开 DOCX 文件。
3. 打开图片文件。
4. 打开 PDF 文件。
5. 从 `/codex-local-browse/*path` 打开一个可预览文件。

#### Expected Results
- Markdown 在本地页面渲染为 HTML，并清洗原始 HTML。
- DOCX 在浏览器内预览；复杂排版可继续使用系统打开或下载。
- PDF 使用本地 `pdf.js` worker 渲染，支持放大和缩小。
- 图片在预览页内展示。
- `/codex-local-browse/*path` 对可预览文件跳转到 `local-preview.html`。
- 文档内容不上传到第三方在线预览服务。

#### Regression Evidence
- 2026-05-28 静态验证：`git diff --check` 通过。
- 2026-05-28 构建验证：`npm.cmd run build` 通过。
- 2026-05-28 浏览器自动化验证：
  - `README.md` 显示 `预览已就绪`，页面存在 `.markdown-body`。
  - DOCX 示例文件显示 `Word 预览已就绪`，页面存在 `.docx-body .docx`。
  - `cx-codex-logo.png` 显示 `预览已就绪`，页面存在 `.image-body img`。
  - 临时 PDF 显示 `PDF 预览已就绪，共 1 页`，页面存在 `.pdf-page canvas`。
  - `/codex-local-browse/.../README.md` 自动跳转到 `/local-preview.html?path=...`。
- 2026-05-28 7420 实机前端回归：
  - 重启后 `/health` 正常，`/codex-api/health` 显示 `pendingRpcCount=0`、`queuedRpcCount=0`、`pendingServerRequestCount=0`、`activePlanModeTurnCount=0`。
  - 首页 `/#/` 加载出侧栏和输入框。
  - `/skills` 规范化为 `/#/skills`，技能中心无白屏。
  - `/github-trending` 规范化为 `/#/github-trending`，GitHub 热门无白屏。
  - `/codex-local-file?inline=1` 返回 `Content-Disposition: inline`，`download=1` 返回 `attachment`。
  - 393x852 移动视口下 DOCX 预览无横向溢出，`scrollWidth == clientWidth`，操作按钮未越界。
- 2026-05-28 Android 兼容回归：
  - `git diff --check` 通过。
  - `npm.cmd run build` 通过。
  - `android\gradlew.bat assembleDebug` 通过。
  - 使用临时 17422 服务和 393x852 视口验证：模拟 Android 原生 `downloadFileFromUrl` 不返回时，12 秒后状态从 `正在请求系统下载...` 收敛为兼容下载提示，打开/下载按钮恢复可点，页面无横向溢出；再次点击下载会直接走兼容下载，不再重复等待原生回调。
  - 模拟 Android 原生 `openFileFromUrl` 返回 `started` 时，页面显示 `已开始后台打开，完成后会自动唤起系统应用。`。
  - 点击 `返回会话` 后 URL 回到 `/#/`，避免文件预览页返回后停在不可操作的全屏列表状态。
- 2026-05-28 公开地址 PDF 回归：
  - URL：`http://116.62.234.104:17420/local-preview.html?path=E%3A%2Fjavaword%2FCXCodex%2Ffinal_multi_target_resume%2F%E9%82%B5%E5%8D%AB-%E6%9C%80%E7%BB%88%E6%8A%95%E9%80%92%E7%AE%80%E5%8E%86-%E4%BA%A7%E5%93%81%E7%BB%8F%E7%90%86%E8%A7%A3%E5%86%B3%E6%96%B9%E6%A1%88%E9%A1%B9%E7%9B%AE%E7%BB%8F%E7%90%86-2026-05-27.pdf`。
  - 登录后 393x852 移动视口显示 `PDF 预览已就绪，共 2 页。`，页面 `scrollWidth == clientWidth`。
  - `复制路径` 在公开 HTTP 页面可用，状态显示 `路径已复制。`，干净会话 `errors=[]`。
  - 模拟 Android 原生 `downloadFileFromUrl` 不返回时，12 秒后不再卡在 `正在请求系统下载...`，按钮恢复，状态显示兼容下载提示；再次点击下载直接进入兼容下载。
- 2026-05-31 Android 下载稳定性回归：
  - `git diff --check` 通过。
  - `npm.cmd run build` 通过。
  - 浏览器自动化打开本地 `local-preview.html?path=README.md`，注入 Android 环境和不会返回的 `downloadFileFromUrl` 后点击 `下载`，页面直接显示 `已请求系统下载...`，`nativeDownloadCalled=false`，不再出现 `原生下载未确认`。
  - 393x852 移动视口下 `scrollWidth <= clientWidth`，下载状态和按钮不造成横向溢出。
  - 构建产物 `dist-cli/index.js` 已包含 `/codex-local-browse/*path` 文件操作页的 Android 分支：点击 `下载` 先触发浏览器/WebView 下载，不再等待原生下载 Promise。

---

### Feature: 新会话发送失败保护与超长消息展示

#### Prerequisites
- 当前构建已包含 runtime 发送接口。
- 使用临时服务 `http://127.0.0.1:17422` 验证，不影响正在运行的 7420。

#### Steps
1. 在新会话页拦截 `/codex-api/runtime/send` 后点击发送。
2. 确认页面仍停留在新会话页，输入框保留原始草稿。
3. 打开包含 1 万字以上用户首条消息的历史线程。
4. 确认超长用户消息默认折叠，支持展开、收起、复制全文。
5. 点击回滚时必须先出现确认框。

#### Expected Results
- 新会话发送失败不会先创建空线程，也不会清空输入框内容。
- 超长用户消息不会把会话滚动区撑到几千像素高，回复不再从中间位置露出。
- 展开全文后消息体在卡片内滚动，不撑坏整页。
- 回滚是危险操作，必须二次确认。

#### Regression Evidence
- 2026-06-01 静态验证：`git diff --check` 通过。
- 2026-06-01 构建验证：`npm.cmd run build` 通过。
- 2026-06-01 浏览器自动化验证：
  - 临时 17422 服务健康，打开 `/#/` 后拦截 `http://127.0.0.1:17422/codex-api/runtime/send`，发送测试草稿后仍停留在 `新会话`，输入框保留原始草稿。
  - 打开长 prompt 线程 `/#/thread/019e8166-4f20-7183-9c8a-f2fe56246e95`，页面存在 `.message-text-flow--long-collapsed`，显示 `展开全文`、`复制全文` 和 `已发送完整内容 · 1.1万 字`。
  - 展开全文后页面存在 `.message-text-flow--long-expanded`，高度为 760px 且内部可滚动。
  - 触发回滚按钮时弹出 `确认回滚` 确认框，取消后 URL 保持在当前线程。

---

### Feature: 产品化运行状态与强制恢复

#### Prerequisites
- 当前构建已包含 runtime 状态摘要和统一任务状态条。
- 使用临时服务 `http://127.0.0.1:17423` 验证，不影响正在运行的 7420。

#### Steps
1. 打开一个已有线程页面。
2. 确认线程顶部显示运行状态条，包含发送、接收、执行、收敛四段状态。
3. 点击状态条里的强制恢复按钮。
4. 切换到 393x852 移动视口，确认状态条不会造成横向滚动。

#### Expected Results
- 用户可以直接看到当前任务是否发送、执行、收敛或需要恢复。
- 强制恢复按钮调用同一套 reconcile 流程，不重复触发任务。
- 恢复成功后显示轻量 Toast，不用阻塞式弹窗。
- 移动端状态条保持一行紧凑展示，按钮收敛为图标尺寸。

#### Regression Evidence
- 2026-06-01 静态验证：`git diff --check` 通过。
- 2026-06-01 构建验证：`npm.cmd run build` 通过。
- 2026-06-01 浏览器自动化验证：
  - 临时 17423 服务健康，打开线程 `/#/thread/019e8166-4f20-7183-9c8a-f2fe56246e95` 后存在 `.runtime-status-bar`。
  - 状态条显示 `状态已收敛`、`发送`、`接收`、`执行`、`收敛` 和 `强制恢复`。
  - 点击状态条里的强制恢复按钮后，页面显示 Toast `当前会话状态已强制恢复。`，停止按钮未残留。
  - 桌面视口 `scrollWidth == clientWidth`。
  - 393x852 移动视口下状态条宽度 349px，高度 50px，强制恢复按钮宽度 32px，`scrollWidth == clientWidth`。
- 2026-06-01 本地 7420 更新后回归：
  - `npm.cmd run build` 通过后重启正式 7420，服务 PID 为 `13664`，`/health` 正常。
  - `/codex-api/health` 显示 `pendingRpcCount=0`、`queuedRpcCount=0`、`pendingServerRequestCount=0`、`activePlanModeTurnCount=0`、`runtimeStore.uncertainRequestCount=0`。
  - 首页 `/#/` 加载出侧栏、线程列表和输入框，无前端运行时错误。
  - 线程 `/#/thread/019e8166-4f20-7183-9c8a-f2fe56246e95` 显示 `.runtime-status-bar`，强制恢复按钮可点击并显示 Toast `当前会话状态已强制恢复。`。
  - 该线程长首条消息仍默认折叠，显示 `展开全文` 和 `复制全文`。
  - 393x852 移动视口下状态条宽度 349px，高度 50px，强制恢复按钮宽度 32px，`scrollWidth == clientWidth`。
  - `/skills` 自动规范化到 `/#/skills`，技能中心非白屏。
  - `/github-trending` 自动规范化到 `/#/github-trending`，GitHub 热门非白屏。
  - `local-preview.html?path=C%3A%2FUsers%2FSW%2FDocuments%2FPlayground%2Fcodexui%2FREADME.md` 显示 `预览已就绪`，存在 `.markdown-body`，移动视口无横向溢出。

---

### Feature: 运行诊断中心与前端回归脚本

#### Prerequisites
- 当前构建包含 `/diagnostics` 路由和 `/codex-api/diagnostics` 只读接口。
- 本机已安装 `agent-browser`。

#### Steps
1. 打开 `/diagnostics`。
2. 确认页面展示后端服务、Runtime Store、恢复队列、慢 RPC 和最近事件。
3. 执行 `npm.cmd run test:7420:frontend -- -BaseUrl <url>`。
4. 可选传入 `-ThreadId <threadId>`，额外验证线程页运行状态条。

#### Expected Results
- 诊断中心不触发任务、不修改 runtime store，只展示状态。
- 诊断接口不返回 prompt payload、token、auth header、密码等敏感字段。
- 前端回归脚本覆盖首页、技能中心、GitHub 热门、诊断中心、本地预览和移动端横向溢出检查。
- 传入线程 ID 后，脚本额外校验线程页 `.runtime-status-bar`。

#### Regression Evidence
- 2026-06-01 静态验证：`git diff --check` 通过。
- 2026-06-01 构建验证：`npm.cmd run build` 通过。
- 2026-06-01 临时 17424 服务验证：
  - `/health` 正常。
  - `/codex-api/diagnostics` 返回 `appServer`、`runtimeStore`、`runtime.uncertainRequests`、`runtime.recentEvents`，且不包含请求 payload。
  - `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:17424 -ThreadId 019e8166-4f20-7183-9c8a-f2fe56246e95` 通过。
  - 脚本验证了 `/#/`、`/#/skills`、`/#/github-trending`、`/#/diagnostics`、`local-preview.html` 和线程页，移动视口均无横向溢出。

---

### Feature: Codex App Server 协议兼容审计流程

#### Prerequisites
- 本机已安装可用的 Codex CLI，并能执行 `codex app-server generate-ts` 和 `codex app-server generate-json-schema`。
- 当前仓库保留 `documentation/app-server-schemas/typescript/` 和 `documentation/app-server-schemas/json/` 基线目录。
- 使用 PowerShell 运行命令。

#### Steps
1. 执行 `npm run audit:app-server-schemas`。
2. 查看命令输出里的 `output/app-server-schema-audit/<timestamp>` 审计目录。
3. 如果脚本返回退出码 `1`，使用输出中的差异统计定位变更，再按需运行 `powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/audit-app-server-schemas.ps1 -FullDiff` 查看完整 diff。
4. 对照 `docs/protocol-compatibility.zh-CN.md` 的兼容门槛，确认新增或变化的 method、event、field 是否需要更新 normalizer、runtime 状态机、停止/审批处理、README 或安全说明。
5. 执行 `git diff --check`，确认新增文档和脚本无空白格式问题。

#### Expected Results
- 无协议差异时，脚本返回退出码 `0`，并显示 `No schema differences found.`。
- 有协议差异时，脚本返回退出码 `1`，并显示审计目录和差异统计；这表示需要人工审计，不代表 schema 生成失败。
- 生成失败、Codex CLI 不可用或基线目录缺失时，脚本以非 `0/1` 的错误状态结束。
- 仓库基线不会被脚本直接覆盖，只有临时审计目录会新增输出。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 配置验证：`node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json ok')"` 输出 `package.json ok`。
- 2026-07-03 脚本基础路径验证：`powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/audit-app-server-schemas.ps1 -SkipGenerate` 通过，确认基线目录、输出目录和 Codex CLI 解析路径正常。
- 2026-07-03 完整审计验证：`npm.cmd run audit:app-server-schemas` 成功生成官方 schema，退出码 `1`，确认当前官方 schema 与仓库基线存在差异，需要进入协议差异审计阶段。

#### Rollback / Cleanup
- 审计完成后可删除 `output/app-server-schema-audit/<timestamp>` 临时目录。
- 如果确认官方 schema 变化需要纳入仓库，先更新代码兼容层和文档，再有意覆盖 `documentation/app-server-schemas/` 基线并记录验证证据。

---

### Feature: 官方 App Server transport / handshake 对齐

#### Prerequisites
- 可访问 OpenAI 官方 Codex App Server 文档：`https://developers.openai.com/codex/app-server`。
- 当前仓库包含 `docs/protocol-compatibility.zh-CN.md`、`docs/app-server-protocol-matrix.zh-CN.md` 和 `scripts/verify-governance.ps1`。

#### Steps
1. 打开官方 Codex App Server 文档，核对 App Server 用途、JSON-RPC wire format、transport、WebSocket auth、overload 和 schema generate 说明。
2. 执行 `npm.cmd run verify:governance`。
3. 执行 `git diff --check`。
4. 执行 `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipCliSmoke -SchemaAudit skip`。
5. 代码审查确认 `docs/protocol-compatibility.zh-CN.md` 明确记录 `stdio` JSONL 默认 transport、WebSocket experimental/unsupported、`/readyz`/`/healthz`、`--ws-token-file`、`-32001`、`initialize`/`initialized` 和“schema 与当前 Codex 版本精确对应”。

#### Expected Results
- 协议兼容文档不再只泛称 JSON-RPC，而是记录官方 wire format 会省略 `"jsonrpc":"2.0"`。
- 文档明确 CI/自动化作业优先使用 Codex SDK，本项目定位为 Web/Android rich-client bridge。
- WebSocket 不被宣传为稳定生产 transport；如未来接入，必须先处理 auth、Origin、health probes 和 overload retry。
- `verify-governance` 会检查上述官方约束文本，防止 release gate 放过弱化后的协议文档。
- Release 快速门禁在跳过构建和 CLI smoke 时仍执行 governance docs check。

#### Rollback / Cleanup
- 若官方文档后续变更，先更新 `docs/protocol-compatibility.zh-CN.md` 和 `docs/app-server-protocol-matrix.zh-CN.md`，再同步调整 `verify-governance.ps1` 的必需文本。

#### Regression Evidence
- 2026-07-03 官方文档核对：对照 `https://developers.openai.com/codex/app-server`，补充 rich-client 用途、JSON-RPC wire format、transport、WebSocket auth、overload 和 schema generate 约束。
- 2026-07-03 治理门禁验证：`npm.cmd run verify:governance` 通过，输出 `Governance docs check passed.`。
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 快速 release gate：`pwsh -NoProfile -File ./scripts/verify-release.ps1 -AllowDirty -SkipBuild -SkipCliSmoke -SchemaAudit skip` 通过，包含 governance docs check 和 server module smoke。
- 2026-07-03 完整 release gate：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 governance docs check、构建、server module smoke 和 CLI smoke。

---

### Feature: App Server 协议差异矩阵和审计摘要

#### Prerequisites
- 当前仓库已包含 `scripts/audit-app-server-schemas.ps1`。
- 本机存在可执行的 Codex CLI，或只做 `-SkipGenerate` 脚本路径验证。

#### Steps
1. 执行 `powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/audit-app-server-schemas.ps1 -SkipGenerate`。
2. 执行 `git diff --check`。
3. 阅读 `docs/app-server-protocol-matrix.zh-CN.md`，确认矩阵包含 Thread/Turn、Runtime、权限、Command、File System、MCP、Plugins、Skills、Hooks、Realtime、Windows Sandbox、Notifications、Release governance 等能力域。
4. 后续完整审计时执行 `npm.cmd run audit:app-server-schemas`，确认输出目录包含 `audit-summary.json`。

#### Expected Results
- `-SkipGenerate` 能验证脚本基础路径，不要求生成 schema。
- 完整审计会在 `output/app-server-schema-audit/<timestamp>/audit-summary.json` 写入基线与生成 schema 的文件名差异摘要。
- 协议差异矩阵能作为后续阶段的兼容 backlog，不直接覆盖 schema 基线。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 脚本路径验证：`powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/audit-app-server-schemas.ps1 -SkipGenerate` 通过。
- 2026-07-03 schema 证据验证：确认 `output/app-server-schema-audit/20260703-192708` 中存在 `codex_app_server_protocol.v2.schemas.json`、`PermissionsRequestApprovalParams.ts`、`ThreadGoal.ts`、`FsReadFileParams.ts`、`PluginListParams.ts`、`ThreadRealtimeTranscriptDeltaNotification.ts`。
- 2026-07-03 完整审计验证：`npm.cmd run audit:app-server-schemas` 生成 `output/app-server-schema-audit/20260703-193428/audit-summary.json`，命令退出码为 `1`，符合“发现协议差异需要审计”的预期。
- 2026-07-03 摘要计数：`audit-summary.json` 显示 TypeScript v2 新增 260、移除 14；JSON v2 新增 110、移除 10。

#### Rollback / Cleanup
- 可删除 `output/app-server-schema-audit/<timestamp>` 临时输出。
- 如矩阵中的能力域判断发生变化，只更新对应行并补充验证证据。

---

### Feature: App Server overload retry

#### Prerequisites
- 当前仓库包含 `src/server/appServerRpcErrors.ts` 和 `src/server/appServerRpcQueue.ts`。
- 官方 App Server 文档约定 bounded queue 满时可能返回 JSON-RPC error code `-32001`，客户端应使用指数退避和 jitter 重试。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run build`。
4. 执行 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
6. 代码审查确认 `src/server/codexAppServerBridge.ts` 收到 JSON-RPC error 时保留 `code`，且 `AppServerRpcQueue` 只对 `-32001` 做有界重试。

#### Expected Results
- `AppServerJsonRpcError` 保留 app-server JSON-RPC error code 和 message。
- `isAppServerOverloadedError()` 只把 code `-32001` 识别为 overload。
- 队列中的普通 RPC 在 app-server overload 时最多重试 3 次，并使用指数退避和 jitter。
- 高优先级直连 RPC 仍由 `AppServerProcess.rpc()` 原路径处理，不因队列重试隐藏用户交互错误。
- Server module smoke 覆盖 overload 重试后成功、重试耗尽后抛回原 JSON-RPC error、以及非 overload 错误不被误判。
- 构建、server module smoke、CJS 启动烟测和 release gate 均通过。

#### Rollback / Cleanup
- 若重试导致交互延迟或错误可见性问题，回滚 `src/server/appServerRpcErrors.ts`、`src/server/appServerRpcQueue.ts`、`src/server/codexAppServerBridge.ts`、验证脚本和本测试章节，再重新评估是否只对后台读请求启用 retry。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 Server module smoke：首次运行暴露 retry smoke 与共享 diagnostics 的微任务时序问题；隔离 retry/exhausted diagnostics 后，`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-03 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-03 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"` 输出 `cli cjs launcher smoke ok`。
- 2026-07-03 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 governance docs check、构建、server module smoke 和 CLI smoke。

---

### Feature: App Server official wire handshake

#### Prerequisites
- 当前仓库包含 `src/server/appServerJsonRpcWire.ts` 和 `src/server/codexAppServerBridge.ts`。
- 官方 Codex App Server 文档说明 JSON-RPC 2.0 message 在 wire 上省略 `"jsonrpc":"2.0"` header，连接后需先发送 `initialize` request，再发送 `initialized` notification。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run build`。
4. 执行 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
6. 代码审查确认 `src/server/codexAppServerBridge.ts` 通过 `createAppServerRpcRequest()`、`createAppServerRpcNotification()`、`createAppServerRpcSuccessResponse()` 和 `createAppServerRpcErrorResponse()` 生成出站 App Server wire message，不再内联 `"jsonrpc":"2.0"` 字段。

#### Expected Results
- App Server request、server request reply 和 client notification 均按官方 wire 形态发送，不包含 `"jsonrpc":"2.0"` 字段。
- `ensureInitialized()` 在 `initialize` 成功后发送 `initialized` notification，再把连接标记为 initialized。
- `clientInfo` 包含 `name`、`title` 和当前 CX-Codex 版本，方便官方合规日志识别集成来源。
- Server module smoke 覆盖 request、notification、success response、error response 均不含 `jsonrpc` 字段，并覆盖 `initialized` notification。
- `docs/app-server-protocol-matrix.zh-CN.md` 中 Transport / handshake / auth 行反映当前实现状态。
- 构建、server module smoke、CJS 启动烟测和 release gate 均通过。

#### Rollback / Cleanup
- 若某个旧版 Codex App Server 只接受带 `"jsonrpc":"2.0"` 的消息，回滚 `src/server/appServerJsonRpcWire.ts`、bridge wire 调整、验证脚本和本测试章节，再考虑通过兼容开关按 Codex CLI 版本选择 wire 形态。

#### Regression Evidence
- 2026-07-03 官方文档核对：刷新 `https://developers.openai.com/codex/codex-manual.md` 后确认 Codex App Server 章节说明 wire 上省略 `"jsonrpc":"2.0"`，且 quickstart/lifecycle 要求 `initialize` 后发送 `initialized` notification。
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-03 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-03 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"` 输出 `cli cjs launcher smoke ok`。
- 2026-07-03 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 governance docs check、构建、server module smoke 和 CLI smoke。

---

### Feature: App Server initialize capabilities 边界

#### Prerequisites
- 当前仓库包含 `src/server/appServerInitialization.ts`、`src/server/appServerClientInfo.ts` 和 `src/server/codexAppServerBridge.ts`。
- 官方 Codex App Server 文档说明 `initialize.params.capabilities.experimentalApi` 需要显式 opt-in，未设置或为 `false` 时保持稳定 API surface。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run build`。
4. 执行 `node dist-cli\index.js --help`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
6. 代码审查确认 `ensureInitialized()` 通过 `createAppServerInitializeParams(clientInfo)` 生成初始化参数，不再在 bridge 主文件内拼装 `initialize` payload。

#### Expected Results
- 默认初始化 payload 只包含 `clientInfo`，不发送 `capabilities.experimentalApi`，保持稳定 App Server API。
- 显式传入 `{ experimentalApi: true }` 时才生成 `capabilities: { experimentalApi: true }`。
- `optOutNotificationMethods` 只保留非空字符串，未来如需精确 opt-out notification，可在同一模块集中接入。
- Server module smoke 覆盖默认稳定模式、显式 experimental false、显式 experimental true 和 notification opt-out 归一化。
- `docs/app-server-protocol-matrix.zh-CN.md` 中 Transport / handshake / auth 行记录 experimental capability 的接入边界。

#### Rollback / Cleanup
- 如需回滚，撤销 `src/server/appServerInitialization.ts`、bridge import/call 调整、server module smoke、verify-server-modules、协议矩阵、changelog 和本节测试记录。

#### Regression Evidence
- 2026-07-04 官方文档核对：`node %USERPROFILE%\.codex\skills\.system\openai-docs\scripts\fetch-codex-manual.mjs` 返回 current manual，Codex App Server 章节说明 `experimentalApi` capability 需要显式 opt-in。
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-04 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-04 CLI smoke：`node dist-cli\index.js --help` 通过并输出 `CX-Codex Web bridge for Codex app-server`。
- 2026-07-04 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 whitespace、package parse、governance docs、构建、server module smoke 和 CLI smoke；schema audit 按本阶段命令跳过。

---

### Feature: App Server 启动策略模块化与环境覆盖

#### Prerequisites
- 当前仓库包含 `src/server/appServerLaunch.ts` 和 `src/server/codexAppServerBridge.ts`。
- `docs/security-hardening.zh-CN.md` 已记录 Codex sandbox / approval 的安全边界。
- 官方 Codex 文档记录常见 sandbox 模式为 `read-only`、`workspace-write`、`danger-full-access`，常见 approval policy 为 `untrusted`、`on-request`、`never`。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run build`。
4. 执行 `node dist-cli\index.js --help`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
6. 代码审查确认 `src/server/codexAppServerBridge.ts` 不再内联 app-server approval/sandbox 参数，只调用 `createAppServerArgs(resolveAppServerLaunchPolicy())`。

#### Expected Results
- `appServerLaunch.ts` 集中声明当前 legacy high-trust 默认策略：`approvalPolicy: never`、`sandboxMode: danger-full-access`。
- `createAppServerArgs()` 生成与既有行为一致的 `codex app-server -c approval_policy="never" -c sandbox_mode="danger-full-access"` 参数。
- `resolveAppServerLaunchPolicy()` 支持 `CX_CODEX_APP_SERVER_APPROVAL_POLICY` / `CODEXUI_APP_SERVER_APPROVAL_POLICY` 和 `CX_CODEX_APP_SERVER_SANDBOX_MODE` / `CODEXUI_APP_SERVER_SANDBOX_MODE`。
- 只接受官方常见枚举值；非法值回退到 legacy 默认策略。
- `/codex-api/health`、`/codex-api/diagnostics` 和诊断页的后端服务卡片展示有效 launch policy，只包含 `approvalPolicy`、`sandboxMode` 和 `legacyHighTrust`，不展示环境变量原文。
- Server module smoke 覆盖默认策略、官方枚举、自定义策略参数生成、环境变量 trim、`CX_CODEX_` 优先级、`CODEXUI_` fallback、非法值回退和脱敏策略快照。
- README 和安全文档记录更保守的 `on-request` + `workspace-write` 覆盖方式。

#### Rollback / Cleanup
- 如需回滚，撤销 `src/server/appServerLaunch.ts`、bridge import/call 调整、server module smoke、verify-server-modules、README、changelog、安全文档和本节测试记录。

#### Regression Evidence
- 2026-07-04 官方文档核对：`node %USERPROFILE%\.codex\skills\.system\openai-docs\scripts\fetch-codex-manual.mjs` 返回 current manual，Codex sandbox/approval 章节记录常见 sandbox 和 approval policy 值。
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-04 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-04 CLI smoke：`node dist-cli\index.js --help` 通过并输出 `CX-Codex Web bridge for Codex app-server`。
- 2026-07-04 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 whitespace、package parse、governance docs、构建、server module smoke 和 CLI smoke；schema audit 按本阶段命令跳过。

---

### Feature: App Server method catalog 模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerMethodCatalog.ts` 和 `src/server/codexAppServerBridge.ts`。
- Codex CLI 支持 `codex app-server generate-json-schema --out <dir>`。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run build`。
4. 执行 `node dist-cli\index.js --help`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
6. 代码审查确认 `/codex-api/meta/methods` 和 `/codex-api/meta/notifications` 通过 `AppServerMethodCatalog` 读取 schema method 列表，`src/server/codexAppServerBridge.ts` 不再内联 `MethodCatalog`。

#### Expected Results
- `AppServerMethodCatalog` 负责调用 `codex app-server generate-json-schema`、读取 `ClientRequest.json` / `ServerNotification.json`、提取 method enum、缓存结果并清理临时 schema 目录。
- `extractMethodCatalogFromSchema()` 对重复 method 去重、排序，并忽略空字符串和非字符串 enum 项。
- bridge 主文件只保留 shared state、HTTP 路由和 App Server 编排。
- 构建、server module smoke、CLI smoke 和 release gate 均通过。

#### Rollback / Cleanup
- 如需回滚，撤销 `src/server/appServerMethodCatalog.ts`、bridge import/shared state 调整、`scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs`、协议矩阵、changelog 和本节测试记录。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`，覆盖 method schema 去重、排序和异常结构 fallback。
- 2026-07-03 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-03 CLI smoke：`node dist-cli\index.js --help` 通过并输出 `CX-Codex Web bridge for Codex app-server`。
- 2026-07-03 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 whitespace、package parse、governance docs、构建、server module smoke 和 CLI smoke；schema audit 按本阶段命令跳过。

---

### Feature: App Server clientInfo 版本跟随 package

#### Prerequisites
- 当前仓库包含 `src/server/appServerClientInfo.ts` 和 `src/server/codexAppServerBridge.ts`。
- `package.json` 包含当前 CX-Codex 版本。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run build`。
4. 执行 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
6. 代码审查确认 `ensureInitialized()` 使用 `createAppServerClientInfo(await readPackageVersion())`，不再硬编码 `clientInfo.version`。

#### Expected Results
- App Server `initialize.params.clientInfo` 仍包含 `name: codex-web-local` 和 `title: CX-Codex`。
- `clientInfo.version` 从 `package.json` 读取；打包或测试路径读取失败时回退为 `unknown`，不阻断 App Server 初始化。
- Server module smoke 覆盖版本归一化、临时 `package.json` 读取、空版本回退和 clientInfo 生成。
- 构建、server module smoke、CJS 启动烟测和 release gate 均通过。

#### Rollback / Cleanup
- 若某个发布包布局无法读取 root `package.json` 且官方日志必须记录精确版本，保留 `appServerClientInfo` 模块并改为构建期注入版本，不要回到 bridge 内硬编码。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`；该 smoke 覆盖 `createAppServerClientInfo()`、`normalizePackageVersion()` 和临时 `package.json` 读取。
- 2026-07-03 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-03 CLI 启动烟测：`node dist-cli\index.js --help` 通过，输出 `CX-Codex Web bridge for Codex app-server`。
- 2026-07-03 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 governance docs check、构建、server module smoke 和 CLI smoke。

---

### Feature: App Server 未知 notification 诊断

#### Prerequisites
- 当前仓库包含 `src/server/appServerNotificationDiagnostics.ts`、`src/server/codexAppServerBridge.ts` 和 `src/components/content/DiagnosticsPanel.vue`。
- `docs/app-server-protocol-matrix.zh-CN.md` 中 Notifications 行要求未知 notification 不阻断 replay/runtime 流，并能在诊断输出中被识别。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run build`。
4. 执行 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
6. 代码审查确认 notification replay 仍会调用 `runtimeStore.appendEvent()`、`runtimeStateStore.observeEvent()` 和 SSE listener；未知 notification 只新增聚合诊断，不会被丢弃或阻断当前线程刷新。

#### Expected Results
- 已知 notification 方法和 bridge 已处理的通配模式不会计入未知诊断。
- 新增或暂未接入的 App Server notification 会按 method 聚合 `unknownNotificationCount` 和 `recentUnknownNotifications`。
- `/codex-api/health` 与 `/codex-api/diagnostics` 返回 `notificationDiagnostics`。
- 诊断中心展示“未知通知”卡片；有未知 notification 时整体状态进入 warning。
- 协议矩阵 Notifications 行反映当前未知 notification 容错与诊断状态。
- 构建、server module smoke、CJS 启动烟测和 release gate 均通过。

#### Rollback / Cleanup
- 若某个官方 notification 被误判为未知且造成噪声，将对应 method 或通配规则加入 `isKnownAppServerNotificationMethod()`；不要删除 diagnostics store，因为它用于后续协议漂移审计。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 Server module smoke：`node ./scripts/verify-server-modules.mjs` 通过，输出 `server module smoke ok`；该 smoke 覆盖已知 notification 判定、未知 notification 聚合计数、最近未知 method 裁剪和 clear。
- 2026-07-03 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-03 CLI 启动烟测：`node dist-cli\index.js --help` 通过，输出 `CX-Codex Web bridge for Codex app-server`。
- 2026-07-03 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 governance docs check、构建、server module smoke 和 CLI smoke。

---

### Feature: Release 验证脚本

#### Prerequisites
- 本机可运行 `npm.cmd run build`。
- 如需执行 schema audit，Codex CLI 可用并支持 `app-server generate-ts` 和 `app-server generate-json-schema`。
- 如需发版前 clean-git 门禁，当前工作树和 index 均无未提交改动。

#### Steps
1. 快速验证脚本路径：执行 `powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/verify-release.ps1 -AllowDirty -SkipBuild -SkipCliSmoke -SkipPackageSmoke -SchemaAudit skip`。
2. 完整构建验证：执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
3. CJS 启动器验证：执行 `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip`，确认 CLI smoke 后继续输出 `cli cjs launcher smoke ok`。
4. Release package smoke 验证：执行 `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipCliSmoke -SchemaAudit skip`，确认输出 `Release package smoke` 和 `release package smoke ok`。
5. 协议审计验证：执行 `powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/verify-release.ps1 -AllowDirty -SkipBuild -SkipCliSmoke -SkipPackageSmoke -SchemaAudit warn`。
6. 发版候选验证：在 clean worktree 上执行 `npm.cmd run verify:release -- -RequireCleanGit -SchemaAudit warn`。
7. 已完成 schema 基线升级并要求严格阻断时，执行 `npm.cmd run verify:release -- -RequireCleanGit -SchemaAudit strict`。

#### Expected Results
- 快速验证执行 `git diff --check` 和 `package.json` 解析检查。
- 完整构建验证执行 `npm.cmd run build`、`node dist-cli/index.js --help` CLI smoke 和 CommonJS `node -e` 启动器 smoke。
- `-SkipCliSmoke` 会同时跳过普通 CLI help smoke 和 CLI CJS launcher smoke。
- 默认 release gate 会生成 `output/release-package-smoke/CX-Codex-verify-smoke.zip` 和 `.sha256`，并检查包内 README、RELEASE、安全/支持/贡献文件、协议审计摘要、Release 正文、PR/Issue 模板、Release workflow、`dist/index.html` 和 `dist-cli/index.js`。
- `-SkipPackageSmoke` 只用于快速脚本路径或排查构建问题；正式发版验证不应跳过。
- `-SchemaAudit warn` 遇到 schema drift 时继续完成，但输出 warning 和最新 `audit-summary.json` 路径。
- `-SchemaAudit strict` 遇到 schema drift 时失败，阻止未审计协议差异进入 release。
- `-RequireCleanGit` 会在发版候选阶段阻止未提交 worktree 或 index。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 配置验证：`node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json ok')"` 输出 `package.json ok`。
- 2026-07-03 快速脚本验证：`powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/verify-release.ps1 -AllowDirty -SkipBuild -SkipCliSmoke -SchemaAudit skip` 通过。
- 2026-07-03 主路径验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 `vue-tsc --noEmit`、`vite build`、`tsup` 和 `node dist-cli/index.js --help` CLI smoke。
- 2026-07-03 schema warn 验证：`powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/verify-release.ps1 -AllowDirty -SkipBuild -SkipCliSmoke -SchemaAudit warn` 通过，生成 `output/app-server-schema-audit/20260703-193751/audit-summary.json`，并将 schema drift 作为 warning 输出。
- 2026-07-03 schema warn 摘要计数：TypeScript v2 新增 260、移除 14；JSON v2 新增 110、移除 10。
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 治理门禁验证：`npm.cmd run verify:governance` 通过，确认 release 文档和脚本已锁定 `CLI CJS launcher smoke`。
- 2026-07-04 CJS 启动器验证：`npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip` 通过，输出 `CLI CJS launcher smoke` 和 `cli cjs launcher smoke ok`。
- 2026-07-04 完整 release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含构建、server module smoke、普通 CLI smoke 和 CLI CJS launcher smoke。
- 2026-07-04 跳过路径验证：`npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipCliSmoke -SchemaAudit skip` 通过，输出 `CLI smoke skipped`，确认普通 CLI smoke 和 CJS launcher smoke 同步跳过。
- 2026-07-04 快速跳过路径验证：`npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipCliSmoke -SkipPackageSmoke -SchemaAudit skip` 通过，输出 `CLI smoke skipped` 和 `Release package smoke skipped`。
- 2026-07-04 Package smoke 验证：`npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipCliSmoke -SchemaAudit skip` 通过，输出 `Release package smoke` 和 `release package smoke ok`。
- 2026-07-04 默认完整 release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含构建、server module smoke、普通 CLI smoke、CLI CJS launcher smoke、Release package smoke 和 schema audit skip。

#### Rollback / Cleanup
- 可删除 `output/app-server-schema-audit/<timestamp>` 和 `output/release-package-smoke` 临时输出。
- 如验证步骤发生变化，同步更新 `RELEASE.md` 和本节证据。

---

### Feature: Release 包开源治理文件清单

#### Prerequisites
- 本机可运行 `npm.cmd run build` 和 `npm.cmd run package:release`。
- 构建产物 `dist/` 和 `dist-cli/` 已存在，或先执行完整 release gate。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:governance`。
3. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
4. 执行 `npm.cmd run package:release -- -Version governance-smoke -OutputDir output\package-release-smoke`。
5. 打开 `output\package-release-smoke\CX-Codex-governance-smoke.zip`，确认包含 `SECURITY.md`、`SUPPORT.md`、`CONTRIBUTING.md`、`.github\release-body.md`、`.github\PULL_REQUEST_TEMPLATE.md`、`.github\ISSUE_TEMPLATE\protocol_compatibility.yml` 和 `.github\workflows\release.yml`。

#### Expected Results
- Web Release zip 除运行产物、源码和 docs 外，还包含贡献、支持、安全、Release 正文、PR 模板、协议兼容 Issue 模板和 Release workflow。
- 默认 `verify:release` 会执行 Release package smoke，生成 `output\release-package-smoke\CX-Codex-verify-smoke.zip` 并校验包内关键文件。
- `verify:governance` 会校验 `scripts/package-release.ps1` 的必需开源治理打包清单，避免后续误删。
- Release zip 和 `.sha256` 校验文件都生成在指定 `OutputDir`。

#### Rollback / Cleanup
- 可删除 `output\package-release-smoke` 临时目录。
- 如需回滚，撤销 `scripts/package-release.ps1` 的治理文件清单、`scripts/verify-governance.ps1` 的打包清单断言和本测试章节。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 治理门禁验证：`npm.cmd run verify:governance` 通过，确认 package release 清单已锁定贡献、支持、安全、PR、Issue 和 Release 正文文件。
- 2026-07-04 完整 release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含构建、server module smoke、普通 CLI smoke 和 CLI CJS launcher smoke。
- 2026-07-04 打包验证：`npm.cmd run package:release -- -Version governance-smoke -OutputDir output\package-release-smoke` 通过，生成 `CX-Codex-governance-smoke.zip` 和 `.sha256`。
- 2026-07-04 Zip 清单验证：PowerShell `System.IO.Compression.ZipFile` 检查通过，确认 zip 包含 `SECURITY.md`、`SUPPORT.md`、`CONTRIBUTING.md`、`.github\release-body.md`、`.github\PULL_REQUEST_TEMPLATE.md` 和 `.github\ISSUE_TEMPLATE\protocol_compatibility.yml`。
- 2026-07-04 Release workflow 打包清单验证：`npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipCliSmoke -SchemaAudit skip` 通过，Release package smoke 确认 zip 包含 `.github\workflows\release.yml`、`docs\app-server-schema-audit-summary.json`、`dist\index.html` 和 `dist-cli\index.js`。

---

### Feature: Dependabot 依赖维护治理

#### Prerequisites
- 仓库包含 `package.json`、`package-lock.json`、`.github/workflows/ci.yml` 和 `.github/workflows/release.yml`。
- 本机可运行 `npm.cmd run verify:governance` 和 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:governance`。
3. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
4. 检查 `.github/dependabot.yml`，确认包含 `npm` 和 `github-actions` 两个 ecosystem。
5. 检查 `CONTRIBUTING.md`，确认依赖更新说明指向 `.github/dependabot.yml`。
6. 检查 release package smoke 输出，确认 Web zip 包含 `.github\dependabot.yml`。

#### Expected Results
- Dependabot 每周检查 npm 依赖和 GitHub Actions 依赖。
- minor/patch 更新按 ecosystem 分组，避免维护者被大量小 PR 打断。
- `verify:governance` 会阻止 Dependabot 配置、贡献说明或发布包清单遗漏。
- 默认 release gate 的 Release package smoke 会校验 Web zip 内包含 `.github\dependabot.yml`。

#### Rollback / Cleanup
- 如需回滚，删除 `.github/dependabot.yml`，并撤销 CONTRIBUTING、package release、governance、release smoke 和本测试章节中的相关引用。
- 可删除 `output\release-package-smoke` 临时输出。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 治理门禁验证：`npm.cmd run verify:governance` 通过，确认 Dependabot 配置、贡献说明、发布包清单和 release smoke 均已锁定 `.github/dependabot.yml`。
- 2026-07-04 完整 release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含构建、server module smoke、普通 CLI smoke、CLI CJS launcher smoke、Release package smoke 和 schema audit skip。
- 2026-07-04 Release package smoke：默认 release gate 输出 `release package smoke ok`，确认 Web zip 包内包含 `.github\dependabot.yml`。

---

### Feature: Dependabot 依赖维护手册

#### Prerequisites
- 当前仓库包含 `.github/dependabot.yml`。
- 当前仓库包含 `docs/dependency-maintenance.zh-CN.md`。

#### Steps
1. 检查 `README.md` 的文档列表，确认包含 `docs/dependency-maintenance.zh-CN.md`。
2. 检查 `CONTRIBUTING.md` 的 Pull Request 要求，确认依赖更新说明指向依赖维护手册。
3. 检查 `docs/dependency-maintenance.zh-CN.md`，确认覆盖 npm、GitHub Actions、runtime、frontend、build、mobile、ci 影响分类。
4. 检查依赖维护手册，确认 Codex App Server 或 OpenAI API 相关更新需要运行 `npm.cmd run audit:app-server-schemas`。
5. 执行 `npm.cmd run verify:governance`。
6. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。

#### Expected Results
- 维护者可以从 README 和贡献指南进入依赖维护手册。
- 手册明确 Dependabot PR 的审查步骤、验证命令、major 更新策略和回滚路径。
- 治理门禁会校验手册存在，并确认 README、CONTRIBUTING 和手册内容互相引用。
- Release gate 保持通过，说明新增治理文档不会破坏发布包、CLI smoke 或 release package smoke。

#### Rollback/Cleanup
- 如需回滚，删除 `docs/dependency-maintenance.zh-CN.md`，并撤销 README、CONTRIBUTING、governance 和本测试章节中的相关引用。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 治理门禁验证：`npm.cmd run verify:governance` 通过，确认依赖维护手册、README、CONTRIBUTING 和 governance 断言已互相锁定。
- 2026-07-04 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含构建、server module smoke、普通 CLI smoke、CLI CJS launcher smoke、Release package smoke 和 schema audit skip。

---

### Feature: OpenAI 官方文档审查手册

#### Prerequisites
- 当前仓库包含 `docs/openai-docs-review.zh-CN.md`。
- 本机可访问 OpenAI 官方开发者文档，或已通过官方 Codex manual helper 获取当前 manual 摘要。

#### Steps
1. 执行 `node %USERPROFILE%\.codex\skills\.system\openai-docs\scripts\fetch-codex-manual.mjs`，确认 Codex manual 可刷新或缓存仍是 current。
2. 检查 `docs/openai-docs-review.zh-CN.md`，确认包含 Codex App Server、Agent approvals & security、Remote connections 和 Speech to text 官方入口。
3. 检查手册，确认 Codex App Server 相关变更需要运行 `npm.cmd run audit:app-server-schemas`。
4. 检查 `README.md` 的快速入口和文档列表，确认均链接到 `docs/openai-docs-review.zh-CN.md`。
5. 检查 `CONTRIBUTING.md` 的 Pull Request 要求，确认 Codex App Server 兼容改动需要先按官方文档审查手册复核。
6. 执行 `npm.cmd run verify:governance`。
7. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。

#### Expected Results
- 官方文档审查入口集中记录在 `docs/openai-docs-review.zh-CN.md`。
- 维护者可以从 README 和贡献指南进入该手册。
- 治理门禁会阻止手册缺失、官方入口缺失或 schema audit 要求缺失。
- Release gate 保持通过，说明新增治理文档不会破坏构建、CLI smoke 或 release package smoke。

#### Rollback/Cleanup
- 如需回滚，删除 `docs/openai-docs-review.zh-CN.md`，并撤销 README、CONTRIBUTING、governance 和本测试章节中的相关引用。

#### Regression Evidence
- 2026-07-04 官方文档刷新：`node %USERPROFILE%\.codex\skills\.system\openai-docs\scripts\fetch-codex-manual.mjs` 通过，输出 `Manual status: local manual was already current.`。
- 2026-07-04 官方页面核对：确认 `https://developers.openai.com/codex/app-server`、`https://developers.openai.com/codex/agent-approvals-security`、`https://developers.openai.com/codex/remote-connections` 和 `https://developers.openai.com/api/docs/guides/speech-to-text` 可访问。
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 治理门禁验证：`npm.cmd run verify:governance` 通过，确认官方文档审查手册、README、CONTRIBUTING 和 governance 断言已互相锁定。
- 2026-07-04 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含构建、server module smoke、普通 CLI smoke、CLI CJS launcher smoke、Release package smoke 和 schema audit skip。

---

### Feature: Release package 关键治理文档烟测

#### Prerequisites
- 当前仓库包含 `scripts/verify-release.ps1` 和 `scripts/package-release.ps1`。
- 当前仓库包含 `docs/openai-docs-review.zh-CN.md`、`docs/dependency-maintenance.zh-CN.md`、`docs/security-hardening.zh-CN.md`、`docs/protocol-compatibility.zh-CN.md` 和 `docs/app-server-protocol-matrix.zh-CN.md`。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:governance`。
3. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
4. 检查 release gate 输出包含 `Release package smoke` 和 `release package smoke ok`。
5. 检查 `scripts/verify-release.ps1`，确认 `Assert-ZipContains` 会校验关键治理文档在 Web zip 内。

#### Expected Results
- Release package smoke 会阻止关键治理文档从发布 zip 中遗漏。
- 治理门禁会阻止 release package smoke 断言被删弱。
- 完整 release gate 保持通过，说明新增 zip 断言与现有打包脚本一致。

#### Rollback/Cleanup
- 如需回滚，撤销 `scripts/verify-release.ps1`、`scripts/verify-governance.ps1` 和本测试章节中的相关引用。
- 可删除 `output\release-package-smoke` 临时输出。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 治理门禁验证：`npm.cmd run verify:governance` 通过，确认 release smoke 关键治理文档断言已被 governance 锁定。
- 2026-07-04 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含构建、server module smoke、普通 CLI smoke、CLI CJS launcher smoke、Release package smoke 和 schema audit skip。
- 2026-07-04 Release package smoke：输出 `release package smoke ok`，确认发布 zip 包含关键治理文档。

---

### Feature: Release package checksum 内容校验

#### Prerequisites
- 当前仓库包含 `scripts/verify-release.ps1` 和 `scripts/package-release.ps1`。
- 本机可运行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:governance`。
3. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
4. 检查 release gate 输出包含 `Release package smoke` 和 `release package smoke ok`。
5. 检查 `scripts/verify-release.ps1`，确认 release smoke 会读取 `.sha256` 文件，校验第一列 SHA256 与 zip 实际哈希一致，并校验 checksum 文件名与 zip 文件名一致。

#### Expected Results
- Release package smoke 不只检查 `.sha256` 文件存在，还会检查 checksum 内容和 zip 真实哈希一致。
- checksum 文件为空、格式错误、哈希不一致或文件名不一致时，release gate 会失败。
- 治理门禁会阻止 checksum 内容校验被删弱。

#### Rollback/Cleanup
- 如需回滚，撤销 `scripts/verify-release.ps1`、`scripts/verify-governance.ps1` 和本测试章节中的相关引用。
- 可删除 `output\release-package-smoke` 临时输出。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 治理门禁验证：`npm.cmd run verify:governance` 通过，确认 checksum 内容校验已被 governance 锁定。
- 2026-07-04 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含构建、server module smoke、普通 CLI smoke、CLI CJS launcher smoke、Release package smoke 和 schema audit skip。
- 2026-07-04 Release package smoke：输出 `release package smoke ok`，确认 `.sha256` 文件内容与 zip 实际 SHA256 和文件名一致。

---

### Feature: GitHub Release artifact checksum 验证

#### Prerequisites
- 当前仓库包含 `scripts/verify-release-artifacts.ps1`。
- `output\release-package-smoke` 中已有 release package smoke 生成的 zip 和 `.sha256`，或可先运行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 生成。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:governance`。
3. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
4. 执行 `npm.cmd run verify:release-artifacts -- -OutputDir output\release-package-smoke`。
5. 检查 `.github/workflows/release.yml`，确认发布前调用 `./scripts/verify-release-artifacts.ps1` 验证 `${{ runner.temp }}/release` 下全部 `.sha256`。

#### Expected Results
- 本地 release package smoke 生成的 `.sha256` 能被 `verify-release-artifacts.ps1` 成功校验。
- Release workflow 在发布 GitHub Release 前会校验 Web zip 和 Android APK 的 `.sha256` 内容。
- release 目录没有 `.zip` / `.apk`、artifact 缺少 `.sha256`、checksum 文件为空、格式错误、引用子路径、缺少目标文件或哈希不一致时，脚本会失败。
- 治理门禁会阻止 artifact checksum 验证脚本、npm 命令入口或 release workflow 调用被删除。

#### Rollback/Cleanup
- 如需回滚，删除 `scripts/verify-release-artifacts.ps1`，并撤销 `package.json`、`.github/workflows/release.yml`、`scripts/verify-governance.ps1` 和本测试章节中的相关引用。
- 可删除 `output\release-package-smoke` 临时输出。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 治理门禁验证：`npm.cmd run verify:governance` 通过，确认 artifact checksum 验证脚本和 Release workflow 调用已被 governance 锁定。
- 2026-07-04 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，生成 `output\release-package-smoke\CX-Codex-verify-smoke.zip` 和 `.sha256`。
- 2026-07-04 Artifact checksum 验证：`npm.cmd run verify:release-artifacts -- -OutputDir output\release-package-smoke` 通过，输出 `checksum ok: CX-Codex-verify-smoke.zip` 和 `Release artifact checksum verification passed.`。
- 2026-07-04 负向 smoke：构造 `output\artifact-negative-smoke\missing-checksum.zip` 且不生成 `.sha256`，执行 `verify-release-artifacts.ps1` 失败并输出 `Release artifact is missing checksum: missing-checksum.zip`；临时目录已删除。

---

### Feature: 开源社区行为准则

#### Prerequisites
- 仓库包含 `CODE_OF_CONDUCT.md`、`README.md`、`CONTRIBUTING.md`、`scripts/verify-governance.ps1` 和 `scripts/package-release.ps1`。
- 本机可运行 `npm.cmd run verify:governance` 和 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:governance`。
3. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
4. 检查 `README.md` 的文档列表和反馈与贡献区域，确认链接到 `CODE_OF_CONDUCT.md`。
5. 检查 `CONTRIBUTING.md`，确认贡献入口要求先阅读行为准则。
6. 检查 `output\release-package-smoke\CX-Codex-verify-smoke.zip`，确认包含 `CODE_OF_CONDUCT.md`。

#### Expected Results
- 仓库具备 GitHub 社区健康所需的行为准则入口。
- 行为准则覆盖尊重协作、脱敏、凭据泄露、安全漏洞、Codex sandbox / approval 和 Issue / PR 处理边界。
- `verify:governance` 会阻止 README、CONTRIBUTING、行为准则内容或 release package 清单遗漏行为准则。
- 默认 release gate 的 Release package smoke 会校验 Web zip 内包含 `CODE_OF_CONDUCT.md`。

#### Rollback / Cleanup
- 如需回滚，删除 `CODE_OF_CONDUCT.md`，并撤销 README、CONTRIBUTING、package release、governance、release smoke 和本测试章节中的相关引用。
- 可删除 `output\release-package-smoke` 临时输出。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 治理门禁验证：`npm.cmd run verify:governance` 通过，确认 README、CONTRIBUTING、行为准则内容、release package 清单和 release smoke 均已锁定 `CODE_OF_CONDUCT.md`。
- 2026-07-04 完整 release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含构建、server module smoke、普通 CLI smoke、CLI CJS launcher smoke、Release package smoke 和 schema audit skip。
- 2026-07-04 Release package smoke：默认 release gate 输出 `release package smoke ok`，确认 Web zip 包内包含 `CODE_OF_CONDUCT.md`。

---

### Feature: GitHub Actions Release 验证门禁

#### Prerequisites
- 仓库包含 `.github/workflows/ci.yml` 和 `.github/workflows/release.yml`。
- 本机可运行 PowerShell 7 (`pwsh`) 和 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
3. 检查 `.github/workflows/ci.yml`，确认 Linux CI 使用 `pwsh` 调用 `./scripts/verify-release.ps1 -SchemaAudit skip`。
4. 检查 `.github/workflows/release.yml`，确认发版 workflow 在打包前执行 `./scripts/verify-release.ps1 -RequireCleanGit -SchemaAudit skip`。
5. 检查 `package.json`，确认 `verify:release` 使用 `pwsh`。
6. 检查 `.github/PULL_REQUEST_TEMPLATE.md`，确认 PR 验证清单包含 `verify:release`。

#### Expected Results
- CI、Release workflow 和本地维护者命令共用同一个 release verification 脚本。
- `verify-release.ps1` 在 Windows 使用 `npm.cmd`，在 Linux/macOS 使用 `npm`，能被 GitHub Actions `pwsh` 调用。
- `package.json` 通过 `pwsh` 暴露同一套 `verify:release` 本地门禁，适合跨平台贡献者使用。
- GitHub Actions 默认 `-SchemaAudit skip`，避免 runner 因没有 Codex CLI 而失败；正式发版仍由维护者本地执行 `warn` 或 `strict` 并记录摘要。
- PR 模板提醒贡献者运行 `verify:release` 或说明未运行原因。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 本地 release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 `git diff --check`、`package.json` 解析、`npm.cmd run build` 和 `node dist-cli/index.js --help`。
- 2026-07-03 兼容修正验证：Windows PowerShell 5 环境下 `verify-release.ps1` 使用 .NET `RuntimeInformation` 识别 Windows，并正确调用 `npm.cmd`。
- 2026-07-03 npm 脚本审查：`verify:release` 改为 `pwsh -NoProfile -File ./scripts/verify-release.ps1`，与 GitHub Actions 执行环境一致。
- 2026-07-03 workflow 审查：CI workflow 使用 `pwsh` 直接调用 `./scripts/verify-release.ps1 -SchemaAudit skip`；Release workflow 在打包前调用 `./scripts/verify-release.ps1 -RequireCleanGit -SchemaAudit skip`。

---

### Feature: OpenAI 官方语音转写与停止请求审计

#### Prerequisites
- 本机可运行 `npm.cmd run build`。
- 如需验证官方转写链路，配置 `CX_CODEX_OPENAI_API_KEY` 或 `OPENAI_API_KEY`。
- 如需验证旧链路回退，确保未配置 OpenAI API key，并保留可用的 Codex / ChatGPT 登录态。

#### Steps
1. 执行 `npm.cmd run build`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 配置 OpenAI API key 后，在前端录音或上传音频文件，确认 `/codex-api/transcribe` 返回包含 `text` 的 JSON。
4. 构造自带 `model=whisper-1` 和 `response_format=text` 的 multipart 请求，确认官方链路转发前会规范化为服务端模型配置和 `response_format=json`。
5. 未配置 OpenAI API key 时重复转写，确认后端仍回退到原 ChatGPT 登录态代理链路。
6. 上传超过默认请求体限制的音频 multipart 请求，确认接口返回 `413` 和可读错误。
7. 在移动端或窄屏开始一次任务后，立即观察底部停止按钮，确认短暂防误触窗口内不会展示停止按钮。
8. 任务进行中点击 composer 停止按钮和运行状态条停止按钮，确认 `/codex-api/runtime/interrupt` payload 分别包含 `source=composer-stop` 或 `source=runtime-status-stop`，并带有 `requestedAtIso`、`clientElapsedMs`、截断后的 `userAgent`。

#### Expected Results
- 官方转写链路默认补齐 `model=gpt-4o-transcribe` 和 `response_format=json`，前端能继续从返回 JSON 中提取文本。
- 官方转写链路会移除客户端 multipart 里已有的 `model`、`response_format` 和 `chunking_strategy` 字段，再追加服务端规范化字段，避免绕过官方模型格式约束。
- 未配置官方 API key 时，不破坏既有 Codex / ChatGPT 登录态转写。
- 过大转写请求在本地服务端被拒绝，不继续代理到上游。
- 停止请求带来源和耗时审计字段，便于定位误触、移动端重复点击和状态条停止行为。
- 移动端刚发送任务后的短暂窗口不会立即展示停止按钮，降低误触概率。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 配置验证：`node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json ok')"` 输出 `package.json ok`。
- 2026-07-03 Server module smoke：`npm.cmd run verify:server-modules` 通过，覆盖官方转写 multipart 字段规范化、文件 payload 保留和 `response_format=json`。
- 2026-07-03 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-03 构建期间仅出现 Vite 大 chunk 提示和 npm update config store 提示，未出现 TypeScript 或打包错误。

---

### Feature: 转写代理 bridge 模块化

#### Prerequisites
- 当前仓库已包含 `src/server/transcriptionProxy.ts`。
- 本机可运行 `npm.cmd run build`。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run build`。
3. 执行 `node dist-cli/index.js --help`。
4. 执行 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; console.log('cli cjs launcher smoke ok')"`。
5. 代码审查确认 `/codex-api/transcribe` 仍按配置优先调用 OpenAI 官方转写，未配置 API key 时回退到 ChatGPT/Codex 登录态代理。

#### Expected Results
- `src/server/codexAppServerBridge.ts` 不再内联 OpenAI/ChatGPT 转写代理实现，只保留路由、请求体读取、鉴权选择和响应转发。
- `src/server/transcriptionProxy.ts` 封装 OpenAI 官方转写、ChatGPT 回退、multipart 默认字段、curl-impersonate fallback 和上传大小配置。
- 构建和 CLI smoke 通过，证明拆分后的服务端模块导入正常。
- 由于项目是 ESM package，没有公开 CJS entry；CJS 启动烟测通过即可作为本次模块加载兼容证据。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-03 CLI smoke：`node dist-cli/index.js --help` 通过并输出 `CX-Codex Web bridge for Codex app-server`。
- 2026-07-03 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; console.log('cli cjs launcher smoke ok')"` 输出 `cli cjs launcher smoke ok`。

---

### Feature: HTTP body helper 模块化与 JSON 请求体保护

#### Prerequisites
- 当前仓库已包含 `src/server/httpBody.ts`。
- 本机可运行 `npm.cmd run build`。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run build`。
3. 执行 `node dist-cli/index.js --help`。
4. 执行 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; console.log('cli cjs launcher smoke ok')"`。
5. 可选设置 `CX_CODEX_JSON_BODY_MAX_BYTES=64` 后向任意 JSON POST API 发送大于 64 字节的 JSON 请求，确认返回 `413`。

#### Expected Results
- `src/server/codexAppServerBridge.ts` 不再内联通用 `readRawBody`、`readJsonBody`、`readHeaderValue` 和 `RequestBodyTooLargeError`。
- 普通 JSON API 请求体默认限制为 2MiB，并可通过 `CX_CODEX_JSON_BODY_MAX_BYTES`、`CODEXUI_JSON_BODY_MAX_BYTES` 或 `JSON_BODY_MAX_BYTES` 覆盖。
- 转写上传继续使用独立的 25 MB 官方文件限制上限，不受普通 JSON API 上限影响。
- 超限请求返回 `413`，不会落入通用 `502` bridge error。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-03 CLI smoke：`node dist-cli/index.js --help` 通过并输出 `CX-Codex Web bridge for Codex app-server`。
- 2026-07-03 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; console.log('cli cjs launcher smoke ok')"` 输出 `cli cjs launcher smoke ok`。

---

### Feature: HTTP JSON response helper 模块化

#### Prerequisites
- 当前仓库包含 `src/server/httpJsonResponse.ts` 和 `src/server/codexAppServerBridge.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 JSON response helper 的 status、header 和 body 行为。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
4. 代码审查确认 `src/server/codexAppServerBridge.ts` 通过 `setJson()` 写 JSON 响应，不再内联通用 response writer。
5. 代码审查确认 `src/server/httpJsonResponse.ts` 保留原有语义：设置状态码、`Content-Type: application/json; charset=utf-8`，并用 `JSON.stringify()` 结束响应。

#### Expected Results
- `src/server/httpJsonResponse.ts` 集中维护 HTTP JSON response helper。
- bridge 仍负责路由分发、状态码选择和响应 payload 选择。
- server module smoke 直接覆盖 `setJson()` 输出；release gate 通过，证明拆分后的 ESM import、server helper 和 CLI/package 构建链路正常。

#### Rollback/Cleanup
- 如需回滚，删除 `src/server/httpJsonResponse.ts`，撤销 `scripts/server-module-smoke.ts` 中的 HTTP JSON response smoke，并把 `setJson()` 恢复到 `src/server/codexAppServerBridge.ts`。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-04 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 governance docs check、构建、server module smoke、CLI smoke、CJS launcher smoke 和 release package smoke。

---

### Feature: Bridge error message helper 模块化

#### Prerequisites
- 当前仓库包含 `src/server/errorMessage.ts` 和 `src/server/codexAppServerBridge.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 Error、`error` 字符串、嵌套 `error.message` 和 fallback 行为。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
4. 代码审查确认 `src/server/codexAppServerBridge.ts` 从 `errorMessage.ts` 导入 `getErrorMessage()`，不再内联通用错误文案解析。
5. 代码审查确认 `src/server/errorMessage.ts` 保留原有语义：优先使用非空 `Error.message`，其次使用 `payload.error` 字符串，再使用嵌套 `payload.error.message`，否则返回 fallback。

#### Expected Results
- `src/server/errorMessage.ts` 集中维护 bridge HTTP/runtime 错误文案解析 helper。
- bridge 仍负责路由状态码、日志上下文和 runtime 状态处理。
- server module smoke 直接覆盖 `getErrorMessage()` 输出；release gate 通过，证明拆分后的 ESM import、server helper 和 CLI/package 构建链路正常。

#### Rollback/Cleanup
- 如需回滚，删除 `src/server/errorMessage.ts`，撤销 `scripts/server-module-smoke.ts` 中的 error message smoke，并把 `getErrorMessage()` 恢复到 `src/server/codexAppServerBridge.ts`。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-04 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 governance docs check、构建、server module smoke、CLI smoke、CJS launcher smoke 和 release package smoke。

---

### Feature: Codex App Server 兼容性 Issue 治理

#### Prerequisites
- 仓库包含 `.github/ISSUE_TEMPLATE/`、`CONTRIBUTING.md`、`SUPPORT.md`。
- 本机可运行 `git diff --check`。

#### Steps
1. 执行 `git diff --check`。
2. 检查 `.github/ISSUE_TEMPLATE/protocol_compatibility.yml`，确认包含 CX-Codex 版本、Codex CLI/App Server 版本、transport、受影响 method/event、脱敏 payload 和安全确认字段。
3. 检查 `.github/ISSUE_TEMPLATE/bug_report.yml`，确认通用 Bug 模板收集 Codex CLI/App Server 版本，并提示协议升级问题使用兼容性模板。
4. 检查 `.github/ISSUE_TEMPLATE/config.yml`，确认 contact links 包含官方 Codex App Server 文档。
5. 检查 `CONTRIBUTING.md` 和 `SUPPORT.md`，确认协议兼容改动和反馈说明覆盖官方文档、版本、method/event、schema audit 或测试记录。

#### Expected Results
- App Server 协议漂移、审批、状态同步、工具请求、interrupt 等问题有独立 Issue 入口，不再混在普通 Bug 或安装求助里。
- 维护者能从 Issue 中直接获得版本、transport、受影响 method/event 和最小脱敏 payload，便于复现和更新 schema audit。
- 文档持续提醒贡献者不要公开敏感 header、Token、Cookie、真实公网地址、私人目录或业务日志。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 Issue Form 烟测：Node 脚本确认所有 `.github/ISSUE_TEMPLATE/*.yml` 具备必需根字段，且各表单字段 id 无重复。
- 2026-07-03 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 whitespace check、`package.json` 解析、前端/CLI 构建和 `node dist-cli/index.js --help`。
- 2026-07-03 模板审查：新增 `protocol_compatibility.yml` 覆盖版本、transport、method/event、脱敏 payload、期望兼容行为和安全确认。
- 2026-07-03 文档审查：`CONTRIBUTING.md`、`SUPPORT.md` 和 Issue config 已指向 App Server 兼容问题的标准收集路径。

---

### Feature: 安全硬化清单与发版复核

#### Prerequisites
- 仓库包含 `SECURITY.md`、`RELEASE.md`、`.github/PULL_REQUEST_TEMPLATE.md` 和 `docs/`。
- 本机可运行 `git diff --check`。

#### Steps
1. 执行 `git diff --check`。
2. 执行文档入口检查，确认 `README.md` 和 `SECURITY.md` 链接到 `docs/security-hardening.zh-CN.md`。
3. 检查 `docs/security-hardening.zh-CN.md`，确认覆盖默认访问边界、Codex App Server transport、Codex sandbox / approval、OpenAI API key、远程访问、贡献发版检查和事故处理。
4. 检查 `RELEASE.md`，确认发版流程包含安全边界复核步骤。
5. 检查 `.github/PULL_REQUEST_TEMPLATE.md`，确认 PR 隐私与安全清单覆盖 App Server transport、权限确认、转写代理和日志输出。
6. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。

#### Expected Results
- 维护者和贡献者能在一个固定文档中复核自托管远程访问、App Server transport、权限确认和凭据处理。
- 发版前必须检查安全边界，不再只依赖构建成功。
- README、SECURITY、Release 和 PR 模板都指向同一套安全硬化口径。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 文档入口审查：`README.md`、`SECURITY.md`、`RELEASE.md` 和 `.github/PULL_REQUEST_TEMPLATE.md` 均已串联 `docs/security-hardening.zh-CN.md` 或等价检查项。
- 2026-07-03 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 whitespace check、`package.json` 解析、前端/CLI 构建和 `node dist-cli/index.js --help`。

---

### Feature: 开源治理文档自动门禁

#### Prerequisites
- 仓库包含 `scripts/verify-governance.ps1`。
- 本机可运行 PowerShell 7 (`pwsh`) 和 `npm.cmd`。

#### Steps
1. 执行 `npm.cmd run verify:governance`。
2. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
3. 检查 `scripts/verify-release.ps1`，确认默认执行 `Governance docs check`，且仅在显式 `-SkipGovernance` 时跳过。
4. 检查 `package.json`，确认暴露 `verify:governance`。
5. 故障注入可选：临时移除 README 中的 `docs/app-server-protocol-matrix.zh-CN.md` 链接，确认 `verify:governance` 会失败；恢复后重新通过。
6. 故障注入可选：临时移除 README 中的 `CX_CODEX_APP_SERVER_APPROVAL_POLICY=on-request` 或安全文档中的 `src/server/appServerLaunch.ts`，确认 `verify:governance` 会失败；恢复后重新通过。

#### Expected Results
- `verify:governance` 能检查 README、SECURITY、RELEASE、SUPPORT、CONTRIBUTING、Issue 模板、CI/Release workflow、安全硬化文档和 App Server 协议矩阵的关键入口。
- `verify:governance` 能检查 App Server launch policy 的公开说明，确保安全文档保留 `appServerLaunch.ts`、legacy high-trust 边界、`on-request` + `workspace-write` 覆盖方式和诊断脱敏要求。
- `verify:release` 默认包含治理文档检查，避免只构建成功但开源治理入口缺失。
- 缺少关键文档、模板或官方协议/安全口径时，命令应失败并给出具体文件和缺失文本。

#### Regression Evidence
- 2026-07-03 故障注入验证：README 缺少 `docs/app-server-protocol-matrix.zh-CN.md` 时，`npm.cmd run verify:governance` 失败并指出缺失文本。
- 2026-07-03 故障注入验证：协议矩阵缺少完整 `Codex App Server` 术语时，`npm.cmd run verify:governance` 失败并指出缺失文本；补齐后通过。
- 2026-07-03 治理门禁验证：`npm.cmd run verify:governance` 通过，输出 `Governance docs check passed.`。
- 2026-07-03 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 `Governance docs check`、构建和 CLI smoke。
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 治理门禁验证：`npm.cmd run verify:governance` 通过，确认 App Server launch policy 文档断言已纳入治理检查。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-04 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-04 CLI smoke：`node dist-cli\index.js --help` 通过并输出 `CX-Codex Web bridge for Codex app-server`；PowerShell CJS smoke 输出 `cli cjs launcher smoke ok`。
- 2026-07-04 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含新增 launch policy governance docs check、构建、server module smoke 和 CLI smoke。

---

### Feature: Runtime payload helper 模块化

#### Prerequisites
- 当前仓库包含 `src/server/runtimePayload.ts`。
- 本机可运行 `npm.cmd run build`。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run build`。
3. 执行 `node dist-cli/index.js --help`。
4. 执行 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
6. 代码审查确认 `src/server/codexAppServerBridge.ts` 通过 `runtimePayload.ts` 导入 request id/hash、runtime payload summary、turn options 和 plan-mode fallback helper，不再内联这些纯函数。

#### Expected Results
- `src/server/runtimePayload.ts` 封装 runtime request id、prompt hash、turn options、payload summary 和 plan-mode 参数兼容逻辑。
- `src/server/codexAppServerBridge.ts` 保留 runtime 状态机、HTTP 路由和 App Server RPC 编排，不再承载 runtime payload 纯函数实现。
- 构建、CLI smoke、CJS 启动烟测和 release gate 均通过，证明拆分后的 ESM import 和 CLI 入口正常。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-03 CLI smoke：`node dist-cli/index.js --help` 通过并输出 `CX-Codex Web bridge for Codex app-server`。
- 2026-07-03 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"` 输出 `cli cjs launcher smoke ok`。
- 2026-07-03 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 governance docs check、构建和 CLI smoke。

---

### Feature: Bridge 日志脱敏模块化

#### Prerequisites
- 当前仓库包含 `src/server/bridgeLog.ts`。
- 本机可运行 `npm.cmd run build`。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run build`。
3. 执行 `node dist-cli/index.js --help`。
4. 执行 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
6. 代码审查确认 `src/server/codexAppServerBridge.ts` 通过 `bridgeLog.ts` 导入 `writeBridgeLog` 和 `logBridgeError`，不再内联日志脱敏实现。

#### Expected Results
- `src/server/bridgeLog.ts` 集中封装敏感字段脱敏、深度限制、数组截断和 stderr JSON 日志输出。
- `src/server/codexAppServerBridge.ts` 保留 App Server 进程、RPC、runtime 和 HTTP 编排，不再直接维护日志脱敏细节。
- 构建、CLI smoke、CJS 启动烟测和 release gate 均通过，证明拆分后的 ESM import 和 CLI 入口正常。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-03 CLI smoke：`node dist-cli/index.js --help` 通过并输出 `CX-Codex Web bridge for Codex app-server`。
- 2026-07-03 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"` 输出 `cli cjs launcher smoke ok`。
- 2026-07-03 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 governance docs check、构建和 CLI smoke。

---

### Feature: Runtime state store 模块化

#### Prerequisites
- 当前仓库包含 `src/server/runtimeState.ts`。
- 本机可运行 `npm.cmd run build`。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run build`。
3. 执行 `node dist-cli/index.js --help`。
4. 执行 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
6. 代码审查确认 `src/server/codexAppServerBridge.ts` 通过 reader 注入初始化 `RuntimeStateStore`，运行态状态机已迁移到 `src/server/runtimeState.ts`。

#### Expected Results
- `src/server/runtimeState.ts` 集中维护 runtime 状态类型、active/settled 判断、pending server request、stale snapshot、snapshot 持久化清理和 `RuntimeStateStore`。
- `src/server/codexAppServerBridge.ts` 保留 App Server payload 读取、RPC 编排和 HTTP 路由，并把 payload reader 函数注入给运行态 store。
- 构建、CLI smoke、CJS 启动烟测和 release gate 均通过，证明拆分后的 ESM import、CLI 入口和发版门禁正常。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-03 CLI smoke：`node dist-cli/index.js --help` 通过并输出 `CX-Codex Web bridge for Codex app-server`。
- 2026-07-03 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"` 输出 `cli cjs launcher smoke ok`。
- 2026-07-03 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 governance docs check、构建和 CLI smoke。

---

### Feature: App Server RPC error 分类模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerRpcErrors.ts` 和 `src/server/codexAppServerBridge.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 RPC overloaded、thread materializing、timeout 和 interrupt settled 错误分类。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
4. 代码审查确认 `src/server/codexAppServerBridge.ts` 从 `appServerRpcErrors.ts` 导入错误分类 helper，不再内联 `isThreadMaterializingError()`、`createRpcTimeoutError()`、`isRpcTimeoutError()` 和 `isInterruptSettledError()`。
5. 代码审查确认 `src/server/appServerRpcErrors.ts` 同时覆盖 JSON-RPC overloaded、thread materializing、timeout error name 和 interrupt settled 字符串兼容。

#### Expected Results
- `src/server/appServerRpcErrors.ts` 集中维护 App Server RPC 相关错误类型、构造和分类逻辑。
- `src/server/codexAppServerBridge.ts` 继续负责 RPC 编排和恢复流程，不再承载错误字符串兼容细节。
- server module smoke 覆盖 overloaded code、materializing 消息、timeout error name/message、普通同文案 Error 非 timeout、interrupt settled 消息和 timeout 不被误判为 settled interrupt；release gate 通过，证明拆分后的 ESM import、server helper 和 CLI/package 构建链路正常。

#### Rollback/Cleanup
- 如需回滚，撤销 `src/server/appServerRpcErrors.ts` 中新增 helper，撤销 `scripts/server-module-smoke.ts` 中的 RPC error smoke，并把错误分类 helper 恢复到 `src/server/codexAppServerBridge.ts`。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-04 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 governance docs check、构建、server module smoke、CLI smoke、CJS launcher smoke 和 release package smoke。

---

### Feature: Local runtime snapshot 恢复分支模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerRuntimeSnapshotRecovery.ts` 和 `src/server/codexAppServerBridge.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 persisted runtime snapshot 恢复和无 persisted snapshot 时的当前 snapshot 创建/持久化回退分支。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
4. 代码审查确认 `src/server/codexAppServerBridge.ts` 的 `readLocalRuntimeSnapshot()` 调用 `createLocalRuntimeSnapshot()`。
5. 代码审查确认有 persisted snapshot 时不会创建/持久化当前 snapshot，无 persisted snapshot 时仍通过 `runtimeStateStore.snapshot()` 创建并通过 `persistRuntimeSnapshot()` 持久化。

#### Expected Results
- 本地 runtime snapshot 的 persisted 恢复和 current fallback 分支集中在 `appServerRuntimeSnapshotRecovery.ts`。
- persisted snapshot 仍经过 `createLocalRuntimeSnapshotFromPersisted()` 处理 App Server 重启和 stale 降级逻辑。
- 无 persisted snapshot 时仍返回已持久化的当前 runtime snapshot。
- release gate 通过，证明拆分后的 ESM import、server helper 和 CLI/package 构建链路正常。

#### Rollback/Cleanup
- 如需回滚，删除 `createLocalRuntimeSnapshot()` 和对应 smoke 断言，并把 persisted/current 分支恢复到 `src/server/codexAppServerBridge.ts` 的 `readLocalRuntimeSnapshot()` 内。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-04 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 governance docs check、构建、server module smoke、CLI smoke、CJS launcher smoke 和 release package smoke。

---

### Feature: Runtime reconcile scheduler 模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerRuntimeReconcileScheduler.ts`、`src/server/appServerRuntimeRequestReconciliation.ts` 和 `src/server/codexAppServerBridge.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 runtime reconcile 候选筛选、running/still_running 节流、批量限制、批处理成功记录和失败 patch/log。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `node scripts\verify-server-modules.mjs`。
3. 执行 `node_modules\.bin\vue-tsc.cmd --noEmit`。
4. 执行 `node_modules\.bin\vite.cmd build`。
5. 执行 `node_modules\.bin\tsup.cmd`。
6. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`。
7. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`。
8. 代码审查确认 `src/server/codexAppServerBridge.ts` 只通过 `createRuntimeReconcileScheduler(...)` 组装依赖，不再内联 reconcile 定时器循环。
9. 代码审查确认 `src/server/appServerRuntimeReconcileScheduler.ts` 使用 `selectRuntimeRequestsForReconcile()` 选择候选请求，并在失败时使用 `createRuntimeReconcileFailurePatch()` 更新请求状态、lastError 和 retryCount。
10. 确认 release package smoke 必检 `src\server\appServerRuntimeReconcileScheduler.ts`。

#### Expected Results
- 空 threadId 的 runtime request 不会进入 reconcile 候选。
- 非 running/still_running 的 uncertain request 仍可立即进入候选。
- running 和 still_running request 仍按 10 秒 thread 级节流进入候选。
- scheduler tick 仍一次最多从 runtime store 读取 10 个 uncertain requests，并按既有批量限制选择候选。
- reconcile 成功时记录 thread 级最近 reconcile 时间；reconcile 失败时写入统一 warn log detail。
- stopping request reconcile 失败时仍转为 `stop_uncertain`，其他状态失败时保持原状态并递增 retry。
- `appServerRuntimeReconcileScheduler.ts` 被 TypeScript server smoke、governance gate 和 release zip 清单覆盖。

#### Rollback/Cleanup
- 如需回滚，删除 `src/server/appServerRuntimeReconcileScheduler.ts`，把定时器候选筛选、批处理、失败 patch 和 warn log 逻辑恢复到 `src/server/codexAppServerBridge.ts`，并撤销 `scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs`、`scripts/verify-release.ps1`、`scripts/verify-governance.ps1` 和本测试章节。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`node scripts\verify-server-modules.mjs` 通过，输出 `server module smoke ok`，覆盖 `runRuntimeReconcileBatch()` 的成功记录、失败 patch、失败 warn detail 和处理数量。
- 2026-07-04 构建验证：`node_modules\.bin\vue-tsc.cmd --noEmit`、`node_modules\.bin\vite.cmd build` 和 `node_modules\.bin\tsup.cmd` 通过。
- 2026-07-04 治理门禁：`node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate：`node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` 通过，输出 `server module smoke ok`、`release package smoke ok`、`npm package smoke ok` 和 `Release verification completed.`；zip 必检清单包含 `src\server\appServerRuntimeReconcileScheduler.ts`。

---

### Feature: Runtime request snapshot patch 应用模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerRuntimeRequestReconciliation.ts` 和 `src/server/codexAppServerBridge.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 active runtime request 查询、snapshot patch 生成和批量更新调用。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
4. 代码审查确认通知事件持久化后和 `/codex-api/runtime/thread/:threadId/reconcile` 都调用 `updateRuntimeRequestsFromSnapshot(threadId, snapshot, runtimeStore)`。
5. 代码审查确认 `src/server/codexAppServerBridge.ts` 不再内联遍历 active runtime requests 并逐条调用 `runtimeStore.updateRequest()`。

#### Expected Results
- active runtime request 的 snapshot patch 应用逻辑集中在 `appServerRuntimeRequestReconciliation.ts`。
- active request 查询仍使用 `RUNTIME_REQUEST_RECONCILE_ACTIVE_STATUSES`。
- 每个 active request 仍通过 `createRuntimeRequestSnapshotPatch()` 生成状态、threadId、turnId 和 lastError patch。
- server module smoke 能证明批量更新函数返回更新数量，并把统一状态集合传给 `runtimeStore.listRequestsByThread()`。
- release gate 通过，证明拆分后的 ESM import、server helper 和 CLI/package 构建链路正常。

#### Rollback/Cleanup
- 如需回滚，删除 `updateRuntimeRequestsFromSnapshot()` 和对应 smoke 断言，并把 active request 遍历更新逻辑恢复到 `src/server/codexAppServerBridge.ts`。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-04 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 governance docs check、构建、server module smoke、CLI smoke、CJS launcher smoke 和 release package smoke。

---

### Feature: Thread token usage fallback 模块化

#### Prerequisites
- 当前仓库包含 `src/server/threadTokenUsage.ts` 和 `src/server/codexAppServerBridge.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 token usage 归一化、session log 解析缓存，以及 `resolveThreadTokenUsage()` 的三层读取优先级。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
4. 代码审查确认 `/codex-api/thread-token-usage` 使用的桥接函数委托 `resolveThreadTokenUsage()`，而不是在 `src/server/codexAppServerBridge.ts` 内联三层 fallback。
5. 代码审查确认 token usage 读取优先级仍为 App Server token usage cache、thread/read cached payload、session log fallback。

#### Expected Results
- thread token usage fallback 逻辑集中在 `threadTokenUsage.ts`。
- 空 threadId 仍短路返回 `null`。
- App Server token usage cache 命中时不读取 thread/read 缓存。
- thread/read cached payload 命中时不读取 session log。
- thread/read 无 token usage 但有 session path 时，继续从 session log 读取 token usage。
- release gate 通过，证明拆分后的 ESM import、server helper 和 CLI/package 构建链路正常。

#### Rollback/Cleanup
- 如需回滚，删除 `resolveThreadTokenUsage()` 和对应 smoke 断言，并把 token usage 三层 fallback 恢复到 `src/server/codexAppServerBridge.ts` 的本地 helper 内。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-04 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 governance docs check、构建、server module smoke、CLI smoke、CJS launcher smoke 和 release package smoke。

---

### Feature: Runtime thread state payload 模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerRuntimeRequestReconciliation.ts` 和 `src/server/codexAppServerBridge.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 runtime thread state payload 生成和 active runtime request 状态过滤集合。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
4. 代码审查确认 `/codex-api/runtime/thread/:threadId` 和 `/codex-api/runtime/thread/:threadId/reconcile` 都使用 `createRuntimeThreadStatePayload()` 返回 `snapshot` 与 `requests`。
5. 代码审查确认 runtime thread state payload 仍使用 `RUNTIME_REQUEST_RECONCILE_ACTIVE_STATUSES` 过滤 `pending_start`、`start_uncertain`、`running`、`stopping`、`stop_uncertain` 和 `still_running` 请求。

#### Expected Results
- runtime thread 本地状态查询和 reconcile 查询共享同一 active request 过滤口径。
- `src/server/codexAppServerBridge.ts` 不再在两个 HTTP 分支内重复手写 active request 状态数组。
- server module smoke 能证明 payload helper 返回原有 `{ snapshot, requests }` 结构，并把统一状态集合传给 `runtimeStore.listRequestsByThread()`。
- release gate 通过，证明拆分后的 ESM import、server helper 和 CLI/package 构建链路正常。

#### Rollback/Cleanup
- 如需回滚，删除 `createRuntimeThreadStatePayload()` 和对应 smoke 断言，并把两个 runtime thread HTTP 分支恢复为直接返回 `snapshot` 与 `runtimeStore.listRequestsByThread(threadId, [...])`。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-04 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 governance docs check、构建、server module smoke、CLI smoke、CJS launcher smoke 和 release package smoke。

---

### Feature: Thread read cache entry 构造模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerThreadReadCache.ts` 和 `src/server/codexAppServerBridge.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 thread/read 缓存行构造和 runtime stale 判定。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
4. 代码审查确认 `src/server/codexAppServerBridge.ts` 的 `rememberCachedThreadRead()` 只调用 `createCachedThreadRead()` 并写入本地 Map。
5. 代码审查确认 `createCachedThreadRead()` 仍从 thread/read payload 中提取 `inProgress`、`activeTurnId`、`updatedAtIso`、`sessionPath` 和 `cachedAtIso`。

#### Expected Results
- thread/read 缓存行构造集中在 `appServerThreadReadCache.ts`，桥接主文件不再内联拼装 `CachedThreadRead` 字段。
- 缓存命中、缓存过期、heavy thread/read 降级到缓存、runtime snapshot 持久化等分支语义保持不变。
- server module smoke 能证明构造函数输出字段和既有 stale 判定分支正常。
- release gate 通过，证明拆分后的 ESM import、server helper 和 CLI/package 构建链路正常。

#### Rollback/Cleanup
- 如需回滚，删除 `createCachedThreadRead()` 和对应 smoke 断言，并把 `CachedThreadRead` 字段构造恢复到 `src/server/codexAppServerBridge.ts` 的 `rememberCachedThreadRead()` 内。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-04 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 governance docs check、构建、server module smoke、CLI smoke、CJS launcher smoke 和 release package smoke。

---

### Feature: Runtime API payload parsing 模块化

#### Prerequisites
- 当前仓库包含 `src/server/runtimePayload.ts` 和 `src/server/codexAppServerBridge.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 `/codex-api/runtime/send` 和 `/codex-api/runtime/interrupt` payload 解析、别名字段、必填校验、turn options 注入、摘要生成、clientElapsedMs 归一化和 userAgent 截断。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
4. 代码审查确认 `src/server/codexAppServerBridge.ts` 使用 `parseRuntimeSendPayload()` 和 `parseRuntimeInterruptPayload()`，不再内联 runtime API payload 解析校验。
5. 代码审查确认 runtime send 仍保留 plan mode 参数兼容重试、thread/start 缺省启动、attachments/model/effort 传递，以及 interrupt 的 `turn/interrupt` 调用语义。

#### Expected Results
- runtime send payload 的 requestId、clientMessageId、mode、model、cwd、threadId、input、attachments、effort、turnOptions 和 payload summary 在 `runtimePayload.ts` 中集中解析。
- 空 input 仍返回 `runtime/send requires input` 错误，非法 body 仍返回 `Invalid body: expected runtime send payload`。
- runtime interrupt payload 仍支持 `threadId/thread_id`、`turnId/turn_id/activeTurnId`，缺失 threadId 或 turnId 时保持原错误。
- interrupt payload 仍把空 source 归一化为 `unknown`，把 clientElapsedMs 四舍五入到非负整数，并把 userAgent 截断到 240 字符。
- server module smoke 覆盖上述分支；release gate 通过，证明拆分后的 ESM import、server helper 和 CLI/package 构建链路正常。

#### Rollback/Cleanup
- 如需回滚，撤销 `src/server/runtimePayload.ts` 中的 parser 增量，撤销 `scripts/server-module-smoke.ts` 中的 runtime payload parsing smoke，并把 send/interrupt payload 解析恢复到 `src/server/codexAppServerBridge.ts`。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-04 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 governance docs check、构建、server module smoke、CLI smoke、CJS launcher smoke 和 release package smoke。

---

### Feature: App Server runtime snapshot recovery 模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerRuntimeSnapshotRecovery.ts` 和 `src/server/codexAppServerBridge.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 persisted runtime snapshot 恢复时的新鲜 active snapshot、超时 active snapshot、App Server 重启后的 active snapshot，以及存在 pending server request 时不降级的分支。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
4. 代码审查确认 `src/server/codexAppServerBridge.ts` 在 `readLocalRuntimeSnapshot()` 中通过 `createLocalRuntimeSnapshotFromPersisted()` 恢复 persisted snapshot，不再内联 stale/restarted 判定。
5. 代码审查确认 active persisted snapshot 在无 pending request 且超时或 App Server 重启后仍降级为 `sync_degraded`，避免前端长期显示假运行态。

#### Expected Results
- persisted snapshot 恢复逻辑集中在 `src/server/appServerRuntimeSnapshotRecovery.ts`。
- 新鲜 active persisted snapshot 仍保留原 execution state、`inProgress` 和 `canStop`。
- 超时 active persisted snapshot 降级为 `sync_degraded`，`stale` 为 true，`degradedReason` 为 `persisted runtime snapshot is stale`。
- App Server 启动时间晚于 persisted event 时间时，active persisted snapshot 降级并标记 `app-server restarted after active runtime snapshot`。
- 存在 pending server request 时不按 stale/restart 降级，避免权限等待场景被误判为同步降级。
- server module smoke 覆盖上述分支；release gate 通过，证明拆分后的 ESM import、server helper 和 CLI/package 构建链路正常。

#### Rollback/Cleanup
- 如需回滚，删除 `src/server/appServerRuntimeSnapshotRecovery.ts`，撤销 `scripts/server-module-smoke.ts` 中的 runtime snapshot recovery smoke，并把 persisted snapshot stale/restarted 判定恢复到 `src/server/codexAppServerBridge.ts`。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-04 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 governance docs check、构建、server module smoke、CLI smoke、CJS launcher smoke 和 release package smoke。

---

### Feature: App Server runtime request reconciliation 模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerRuntimeRequestReconciliation.ts` 和 `src/server/codexAppServerBridge.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 runtime request reconciliation 的 active status 列表、snapshot execution state 到 request status 的映射、stopping/stop_uncertain 仍运行时的 `still_running` 特例、activeTurnId fallback 和 lastError 传递。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
4. 代码审查确认 `src/server/codexAppServerBridge.ts` 使用 `RUNTIME_REQUEST_RECONCILE_ACTIVE_STATUSES` 查询待同步 request，并用 `createRuntimeRequestSnapshotPatch()` 生成 `runtimeStore.updateRequest()` patch。
5. 代码审查确认 `stopping` / `stop_uncertain` 且 snapshot 仍 `inProgress` 时仍同步为 `still_running`，没有把真实仍运行任务误标为已停止。

#### Expected Results
- runtime request reconciliation 的状态规则集中在 `src/server/appServerRuntimeRequestReconciliation.ts`，主 bridge 只负责读取 active requests 和写回 patch。
- active status 查询仍覆盖 `pending_start`、`start_uncertain`、`running`、`stopping`、`stop_uncertain` 和 `still_running`。
- snapshot 已完成/失败/中断/降级时仍按 execution state 映射 request status。
- snapshot 缺少 activeTurnId 时继续保留 request 原 turnId，避免同步过程丢失 turn 关联。
- server module smoke 覆盖上述分支；release gate 通过，证明拆分后的 ESM import、server helper 和 CLI/package 构建链路正常。

#### Rollback/Cleanup
- 如需回滚，删除 `src/server/appServerRuntimeRequestReconciliation.ts`，撤销 `scripts/server-module-smoke.ts` 中的 reconciliation smoke，并把 active status 列表和 `updateRuntimeRequestsFromSnapshot()` 的 patch 生成逻辑恢复到 `src/server/codexAppServerBridge.ts`。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-04 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 governance docs check、构建、server module smoke、CLI smoke、CJS launcher smoke 和 release package smoke。

---

### Feature: App Server notification replay 模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerNotificationReplay.ts` 和 `src/server/codexAppServerBridge.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 notification replay 的 seq 初始化、事件持久化形状、诊断观察、内存 buffer 裁剪、持久 replay 优先和内存 fallback。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
4. 代码审查确认 `src/server/codexAppServerBridge.ts` 使用 `AppServerNotificationReplay` 管理 notification seq、runtimeStore event append、diagnostics observe 和 replay list，不再内联 notification replay buffer。
5. 代码审查确认 `/codex-api/notifications`、`/codex-api/runtime/events` 和 SSE ready 事件仍返回相同的 `{ notifications, latestSeq, oldestSeq }` / `latestSeq` 语义。

#### Expected Results
- 新 notification 到达时仍写入 runtime event store，并继续为 diagnostics 提供 method、threadId、turnId 和 atIso。
- 持久事件可覆盖页面恢复或重连后的 replay；当持久 store 无更新且内存 buffer 有新事件时，仍可从内存 buffer 返回。
- 内存 buffer 仍按上限裁剪，避免长时间运行导致无界增长。
- SSE ready 事件仍暴露当前最新 seq，前端可继续用 seq 做 catch-up。
- server module smoke 覆盖上述 replay 分支；release gate 通过，证明拆分后的 ESM import、server helper 和 CLI/package 构建链路正常。

#### Rollback/Cleanup
- 如需回滚，删除 `src/server/appServerNotificationReplay.ts`，撤销 `scripts/server-module-smoke.ts` 中的 notification replay smoke，并把 notification seq、runtimeStore append、diagnostics observe、内存 replay buffer 和 `listNotificationEventsAfter()` 逻辑恢复到 `src/server/codexAppServerBridge.ts`。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-04 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 governance docs check、构建、server module smoke、CLI smoke、CJS launcher smoke 和 release package smoke。

---

### Feature: App Server thread/list pinned summary augment 模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerThreadListAugment.ts` 和 `src/server/codexAppServerBridge.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 active/default 首屏 pinned thread 补全、archived 列表不补全、cursor 分页不补全、existing thread 去重、TTL 缓存、失败缓存和每轮最大补读数。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
4. 代码审查确认 `src/server/codexAppServerBridge.ts` 使用 `AppServerThreadListAugmenter` 处理 `thread/list` 的 pinned summary 补全，不再内联 supplemental thread summary cache。
5. 代码审查确认 `readThreadById` 仍调用 `thread/read` 且参数保持 `{ threadId, includeTurns: false }`。

#### Expected Results
- `thread/list` 只在 active/default 且没有 cursor 的第一页结果中补充缺失 pinned thread；archived 列表和 cursor 分页结果保持原样。
- 结果中已有的 thread id 不会被重复追加。
- 单轮最多读取 `SUPPLEMENTAL_THREAD_SUMMARY_MAX_READS` 个未缓存 pinned thread，失败读取被短期缓存，避免缺失历史线程拖慢列表。
- 补全结果保持原 result 字段，并在 `data` 尾部追加补到的 thread summary。
- server module smoke 覆盖成功/失败缓存和 TTL 过期；release gate 通过，证明拆分后的 ESM import、server helper 和 CLI/package 构建链路正常。

#### Rollback/Cleanup
- 如需回滚，删除 `src/server/appServerThreadListAugment.ts`，撤销 `scripts/server-module-smoke.ts` 中的 thread list augment smoke，并把 supplemental thread summary cache 与 `augmentThreadListRpcResult()` 逻辑恢复到 `src/server/codexAppServerBridge.ts`。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-04 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 governance docs check、构建、server module smoke、CLI smoke、CJS launcher smoke 和 release package smoke。

---

### Feature: App Server rollback git helper 模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerRollbackGit.ts` 和 `src/server/codexAppServerBridge.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 rollback git helper 的提交消息归一化、私有 rollback git 路径、`.codex/.gitignore` 幂等写入、rollback repo 初始化、提交查找和 dirty worktree 检测。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
4. 代码审查确认 `src/server/codexAppServerBridge.ts` 从 `appServerRollbackGit.ts` 导入 `ensureRepoHasInitialCommit()`、`normalizeCommitMessage()`、`ensureRollbackGitRepo()`、`runRollbackGit*()`、`findRollbackCommitByExactMessage()` 和 `hasRollbackGitWorkingTreeChanges()`，不再内联 rollback git helper。
5. 代码审查确认 `/codex-api/worktree/auto-commit` 和 `/codex-api/worktree/rollback-to-message` 的 HTTP 状态码、响应字段和错误处理逻辑未改变。

#### Expected Results
- `src/server/appServerRollbackGit.ts` 集中维护私有 `.codex/rollbacks/.git` 初始化、命令包装、提交消息归一化和 rollback commit 查找。
- `.codex/.gitignore` 仍只追加 `rollbacks/` 且重复执行保持幂等。
- rollback repo 初始化后仍配置本地提交身份，并保留 `Initialize rollback history` 空提交 fallback。
- auto-commit 和 rollback-to-message 路由继续复用原有 helper 行为，不扩大主 bridge 的职责。
- server module smoke 覆盖临时目录内的真实 git 初始化、commit、status 和 message lookup；release gate 通过，证明拆分后的 ESM import、server helper 和 CLI/package 构建链路正常。

#### Rollback/Cleanup
- 如需回滚，删除 `src/server/appServerRollbackGit.ts`，撤销 `scripts/server-module-smoke.ts` 中的 rollback git smoke，并把 rollback git helper 恢复到 `src/server/codexAppServerBridge.ts`。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-04 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 governance docs check、构建、server module smoke、CLI smoke、CJS launcher smoke 和 release package smoke。

---

### Feature: App Server runtime bridge helper 模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerRuntimeBridge.ts` 和 `src/server/codexAppServerBridge.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 runtime execution state 到 runtime request status 的映射，以及 persisted runtime event replay 的响应形状。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
4. 代码审查确认 `src/server/codexAppServerBridge.ts` 从 `appServerRuntimeBridge.ts` 导入 `BridgeNotificationEvent`、`readRuntimeRequestStatusFromExecutionState()` 和 `normalizeRuntimeEventForReplay()`，不再内联这些 runtime bridge helper。
5. 代码审查确认 runtime request reconciliation 和 notification replay 调用点仍保持原有状态映射和 event shape。

#### Expected Results
- `src/server/appServerRuntimeBridge.ts` 集中维护 runtime execution state 到 runtime request status 的纯映射。
- queued/idle/unknown settled fallback 仍映射为 `stopped`；running/starting/waiting_permission 仍映射为 `running`；uncertain、stopping、failed、interrupted、completed 和 sync_degraded 状态保持原映射。
- notification replay 仍输出 `{ seq, method, params, atIso }`，不额外暴露 payload 或敏感字段。
- server module smoke 覆盖全部 `RuntimeExecutionState` 分支和 replay event shape；release gate 通过，证明拆分后的 ESM import、runtime helper 和 CLI/package 构建链路正常。

#### Rollback/Cleanup
- 如需回滚，删除 `src/server/appServerRuntimeBridge.ts`，撤销 `scripts/server-module-smoke.ts` 中的 runtime bridge smoke，并把 `BridgeNotificationEvent`、`readRuntimeRequestStatusFromExecutionState()` 和 `normalizeRuntimeEventForReplay()` 恢复到 `src/server/codexAppServerBridge.ts`。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-04 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 governance docs check、构建、server module smoke、CLI smoke、CJS launcher smoke 和 release package smoke。

---

### Feature: App Server thread/read cache 新鲜度模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerThreadReadCache.ts` 和 `src/server/codexAppServerBridge.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 timestamp 解析和 runtime snapshot 驱动的 cached thread/read stale 判断。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
4. 代码审查确认 `src/server/codexAppServerBridge.ts` 从 `appServerThreadReadCache.ts` 导入 `CachedThreadRead`、`readIsoTimestampMs()` 和 `isCachedThreadReadStaleForRuntime()`，不再内联 heavy thread/read cache stale 判断。
5. 代码审查确认 `readLocalRuntimeSnapshot()` 仍复用同一个 `readIsoTimestampMs()`，前台恢复时 stale persisted runtime snapshot 的判断不变。

#### Expected Results
- `src/server/appServerThreadReadCache.ts` 集中维护 heavy `thread/read(includeTurns:true)` cache 是否可复用的纯判断。
- light thread/read 仍在运行时，cached heavy read 不会被标记 stale。
- runtime snapshot 处于 active 或 `completed_pending_sync` 时，cached heavy read 会被标记 stale。
- runtime completion 时间晚于 cache 时间，或 cache 时间无效时，cached heavy read 会被标记 stale。
- 无有效 completion 时间时，cached heavy read 不会因为 completion 时间判断被误标 stale。
- server module smoke 覆盖上述分支；release gate 通过，证明拆分后的 ESM import、runtime/cache helper 和 CLI/package 构建链路正常。

#### Rollback/Cleanup
- 如需回滚，删除 `src/server/appServerThreadReadCache.ts`，撤销 `scripts/server-module-smoke.ts` 中的 thread/read cache smoke，并把 `CachedThreadRead`、`readIsoTimestampMs()` 和 `isCachedThreadReadStaleForRuntime()` 恢复到 `src/server/codexAppServerBridge.ts`。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-04 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 governance docs check、构建、server module smoke、CLI smoke、CJS launcher smoke 和 release package smoke。

---

### Feature: App Server thread runtime snapshot reader 模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerThreadRuntimeSnapshot.ts`、`src/server/appServerThreadReadCache.ts`、`src/server/runtimeState.ts` 和 `src/server/codexAppServerBridge.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 light `thread/read`、heavy `thread/read` cache 命中、recoverable read 失败、cached message fallback 和 runtime snapshot 持久化。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `node scripts\verify-server-modules.mjs`。
3. 执行 `node_modules\.bin\vue-tsc.cmd --noEmit`。
4. 执行 `node_modules\.bin\vite.cmd build`。
5. 执行 `node_modules\.bin\tsup.cmd`。
6. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`。
7. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`。
8. 代码审查确认 `src/server/codexAppServerBridge.ts` 的 `readThreadRuntimeSnapshot(...)` 只调用 `readAppServerThreadRuntimeSnapshot(...)` 并注入 RPC、cache、runtime store、diagnostics 和日志依赖。
9. 代码审查确认 `src/server/appServerThreadRuntimeSnapshot.ts` 负责 light/heavy thread read、cached message 复用、recoverable fallback、runtime observe 和 persisted snapshot 生成。
10. 确认 release package smoke 必检 `src\server\appServerThreadRuntimeSnapshot.ts`。

#### Expected Results
- 空 threadId 仍抛出 `Missing thread id`。
- light `thread/read(includeTurns:false)` 成功且 cached heavy read 新鲜时，不再额外请求 heavy `thread/read(includeTurns:true)`。
- heavy `thread/read(includeTurns:true)` 成功时仍裁剪 turns、写入 cache，并以 `messageState=fresh` 持久化 snapshot。
- light/heavy read 的 materializing 或 timeout 错误仍被视为可恢复；有 cached heavy read 时回落到 `messageState=cached`，没有 cache 时标记 degraded。
- runtime observe 仍按 fresh thread read 使用 `source=thread-read`，cached fallback 使用 `source=cache`。
- `appServerThreadRuntimeSnapshot.ts` 被 TypeScript server smoke、governance gate 和 release zip 清单覆盖。

#### Rollback/Cleanup
- 如需回滚，删除 `src/server/appServerThreadRuntimeSnapshot.ts`，把 light/heavy thread read、cache fallback、runtime observe 和 persisted snapshot 组装恢复到 `src/server/codexAppServerBridge.ts` 的 `readThreadRuntimeSnapshot(...)` 内，并撤销 `scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs`、`scripts/verify-release.ps1`、`scripts/verify-governance.ps1` 和本测试章节。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`node scripts\verify-server-modules.mjs` 通过，输出 `server module smoke ok`，覆盖 `readAppServerThreadRuntimeSnapshot()` 的 cache hit 避免 heavy read、cached fallback、warning、runtime observe source 和 persisted snapshot。
- 2026-07-04 构建验证：`node_modules\.bin\vue-tsc.cmd --noEmit`、`node_modules\.bin\vite.cmd build` 和 `node_modules\.bin\tsup.cmd` 通过。
- 2026-07-04 治理门禁：`node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate：`node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` 通过，输出 `server module smoke ok`、`release package smoke ok`、`npm package smoke ok` 和 `Release verification completed.`；zip 必检清单包含 `src\server\appServerThreadRuntimeSnapshot.ts`。

---

### Feature: App Server RPC cache invalidation 模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerRpcCache.ts` 和 `src/server/codexAppServerBridge.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 thread/list 与 thread/read 的 RPC/notification cache invalidation 规则。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
4. 代码审查确认 `src/server/codexAppServerBridge.ts` 从 `appServerRpcCache.ts` 导入 `shouldInvalidateThreadListCacheForNotification()`、`shouldInvalidateThreadReadCacheForRpc()` 和 `shouldInvalidateThreadReadCacheForNotification()`，不再内联这些规则。
5. 代码审查确认原有 invalidation method 列表未改变，缓存清理调用点仍在 notification、RPC proxy 和 runtime path 中执行。

#### Expected Results
- `src/server/appServerRpcCache.ts` 集中维护 shareable RPC key、thread/model list cache 和 thread cache invalidation 策略。
- `thread/list` cache 仍会被 thread start/fork/archive/name set RPC 和 thread created/archived/unarchived/deleted/removed/forked/moved/name updated notification 清理。
- `thread/read` cache 仍会被 turn start/interrupt、thread resume/rollback/archive/name set RPC，以及 turn/item completion、interrupt、error 和 failed notification 清理。
- server module smoke 覆盖 RPC 与 notification 正反样例；release gate 通过，证明拆分后的 ESM import、cache helper 和 CLI/package 构建链路正常。

#### Rollback/Cleanup
- 如需回滚，撤销 `src/server/appServerRpcCache.ts` 中新增 invalidation helper，撤销 `scripts/server-module-smoke.ts` 中的新增断言，并把 helper 恢复到 `src/server/codexAppServerBridge.ts`。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-04 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 governance docs check、构建、server module smoke、CLI smoke、CJS launcher smoke 和 release package smoke。

---

### Feature: App Server RPC timeout policy 模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerRpcTimeoutPolicy.ts` 和 `src/server/codexAppServerBridge.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 initialize、thread/read、thread/resume 和默认 RPC timeout 策略。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
4. 代码审查确认 `src/server/codexAppServerBridge.ts` 从 `appServerRpcTimeoutPolicy.ts` 导入 `getRpcTimeoutMs()`，不再内联 initialize、thread/read、thread/resume 和默认 RPC timeout 常量。
5. 代码审查确认队列大小、慢调用诊断和重启阈值仍留在 bridge/AppServerProcess 范围内，本次没有改变进程调度和重启策略。

#### Expected Results
- `src/server/appServerRpcTimeoutPolicy.ts` 集中维护 App Server RPC method 到 timeout 毫秒数的映射。
- `initialize`、heavy `thread/read(includeTurns:true)`、`thread/resume` 仍为 60 秒，light `thread/read` 仍为 30 秒，其他 RPC 仍为 60 秒。
- 非布尔 `includeTurns` 不会被当作 heavy read。
- server module smoke 覆盖上述 timeout 分支；release gate 通过，证明拆分后的 ESM import、server helper 和 CLI/package 构建链路正常。

#### Rollback/Cleanup
- 如需回滚，删除 `src/server/appServerRpcTimeoutPolicy.ts`，撤销 `scripts/server-module-smoke.ts` 中的 timeout policy smoke，并把 timeout 常量和 `getRpcTimeoutMs()` 恢复到 `src/server/codexAppServerBridge.ts`。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-04 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 governance docs check、构建、server module smoke、CLI smoke、CJS launcher smoke 和 release package smoke。

---

### Feature: App Server payload ID 解析模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerPayloadIds.ts` 和 `src/server/codexAppServerBridge.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 threadId、turnId、itemId 和 alias 解析行为。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
4. 代码审查确认 `src/server/codexAppServerBridge.ts` 从 `appServerPayloadIds.ts` 导入 payload ID 解析器，不再内联 `readStringByAliases()`、`readThreadIdFromPayload()`、`readTurnIdFromPayload()` 和 `readItemIdFromPayload()`。
5. 代码审查确认 `scripts/server-module-smoke.ts` 的 runtime state store smoke 使用正式 payload ID 解析器，而不是脚本内简化 reader。

#### Expected Results
- `src/server/appServerPayloadIds.ts` 集中维护 App Server payload 中 threadId、turnId 和 itemId 的兼容解析。
- 兼容来源包括 root、`request`、`request.params`、`params`、`thread`、`turn` 和 `item` 中的 camelCase/snake_case 字段。
- `src/server/codexAppServerBridge.ts` 继续负责 runtime、通知、RPC 和 HTTP 编排，不再承载 payload ID 字段探测细节。
- server module smoke 覆盖 alias fallback、空值 trim、嵌套 request/params/thread/turn/item 来源和非字符串忽略；release gate 通过，证明拆分后的 ESM import、runtime store 注入和 CLI/package 构建链路正常。

#### Rollback/Cleanup
- 如需回滚，删除 `src/server/appServerPayloadIds.ts`，撤销 `scripts/server-module-smoke.ts` 中的 payload ID smoke，并把 payload ID helper 恢复到 `src/server/codexAppServerBridge.ts`。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-04 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 governance docs check、构建、server module smoke、CLI smoke、CJS launcher smoke 和 release package smoke。

---

### Feature: App Server thread/read payload 解析模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerThreadPayload.ts` 和 `src/server/codexAppServerBridge.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 thread/read payload 中 active turn、运行态、更新时间和 session path 解析。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
4. 代码审查确认 `src/server/codexAppServerBridge.ts` 从 `appServerThreadPayload.ts` 导入 thread/read payload 解析器，不再内联 active turn、in-progress、updatedAt 和 session path helper。
5. 代码审查确认 `src/server/appServerThreadPayload.ts` 保留原有兼容来源：`thread.activeTurnId`、`thread.status.activeTurnId`、`thread.status.turnId`、最新 `inProgress` turn、`thread.inProgress`、`thread.turnStatus`、`thread.status`、`thread.updatedAt` 和 `thread.path`/根 `path`。

#### Expected Results
- `src/server/appServerThreadPayload.ts` 集中维护 thread/read payload 的协议兼容解析逻辑。
- `src/server/codexAppServerBridge.ts` 继续负责 App Server 进程、RPC、runtime 和 HTTP 编排，不再承载 thread/read payload 细节。
- server module smoke 覆盖 direct active turn、status turn fallback、turn fallback、运行态状态别名、completed 非运行态、session path fallback 和非法 updatedAt；release gate 通过，证明拆分后的 ESM import、server helper 和 CLI/package 构建链路正常。

#### Rollback/Cleanup
- 如需回滚，删除 `src/server/appServerThreadPayload.ts`，撤销 `scripts/server-module-smoke.ts` 中的 thread payload smoke，并把 thread/read payload 解析 helper 恢复到 `src/server/codexAppServerBridge.ts`。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-04 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 governance docs check、构建、server module smoke、CLI smoke、CJS launcher smoke 和 release package smoke。

---

### Feature: App Server RPC result turns 裁剪模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerRpcResult.ts` 和 `src/server/codexAppServerBridge.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 thread turns 裁剪行为。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
4. 代码审查确认 `src/server/codexAppServerBridge.ts` 从 `appServerRpcResult.ts` 导入 `trimThreadTurnsInRpcResult()`，不再内联 thread turns 裁剪常量和 helper。
5. 代码审查确认 `src/server/appServerRpcResult.ts` 仍只对 `thread/read`、`thread/resume`、`thread/fork` 和 `thread/rollback` 裁剪 `thread.turns`，且最多保留最后 10 个 turn。

#### Expected Results
- `src/server/appServerRpcResult.ts` 集中维护 App Server RPC result 的 thread turns 裁剪逻辑。
- 非 thread-turns RPC result 保持原对象返回，不改变其他 method 的 response shape。
- server module smoke 直接覆盖非目标 method 不变、10 个以内不变、超过 10 个只保留最后 10 个；release gate 通过，证明拆分后的 ESM import、server helper 和 CLI/package 构建链路正常。

#### Rollback/Cleanup
- 如需回滚，删除 `src/server/appServerRpcResult.ts`，撤销 `scripts/server-module-smoke.ts` 中的 RPC result smoke，并把 thread turns 裁剪常量和 `trimThreadTurnsInRpcResult()` 恢复到 `src/server/codexAppServerBridge.ts`。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-04 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 governance docs check、构建、server module smoke、CLI smoke、CJS launcher smoke 和 release package smoke。

---

### Feature: App Server RPC cache 模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerRpcCache.ts`。
- 本机可运行 `npm.cmd run build`。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run build`。
3. 执行 `node dist-cli/index.js --help`。
4. 执行 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
6. 代码审查确认 `src/server/codexAppServerBridge.ts` 通过 `AppServerRpcCache` 管理 shareable RPC、`thread/list` 缓存、`model/list` 缓存和后台刷新，不再内联缓存 Map 与 TTL 逻辑。

#### Expected Results
- `src/server/appServerRpcCache.ts` 集中维护 `thread/list` / `model/list` fresh/stale TTL、后台刷新节流、共享 in-flight RPC Promise 和 `getShareableRpcKey`。
- `src/server/codexAppServerBridge.ts` 保留 App Server 进程、RPC 队列、permission request、runtime 和 HTTP 编排，不再承载共享读缓存细节。
- `thread/read` 仍只共享 in-flight Promise；`thread/list` 和 `model/list` 继续支持 stale cache 返回并触发后台刷新。
- 构建、CLI smoke、CJS 启动烟测和 release gate 均通过，证明拆分后的 ESM import、CLI 入口和发版门禁正常。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-03 代码审查：`rg` 确认 `cachedThreadListRpcByKey`、`cachedModelListRpcByKey` 和 `sharedReadRpcByKey` 只存在于 `src/server/appServerRpcCache.ts`。
- 2026-07-03 CLI smoke：`node dist-cli/index.js --help` 通过并输出 `CX-Codex Web bridge for Codex app-server`。
- 2026-07-03 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"` 输出 `cli cjs launcher smoke ok`。
- 2026-07-03 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 governance docs check、构建和 CLI smoke。

---

### Feature: Pending server request store 模块化

#### Prerequisites
- 当前仓库包含 `src/server/pendingServerRequests.ts`。
- 本机可运行 `npm.cmd run build`。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run build`。
3. 执行 `node dist-cli/index.js --help`。
4. 执行 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
6. 代码审查确认 `src/server/codexAppServerBridge.ts` 通过 `PendingServerRequestStore` 管理 pending request 记录、消费、清理、列表和按 thread 过滤；自动审批、plan-mode decline、unsupported request 响应和 `server/request/resolved` 通知仍由 bridge 业务逻辑控制。

#### Expected Results
- `src/server/pendingServerRequests.ts` 集中维护 `PendingServerRequest` 类型、pending request Map、`record`、`consume`、`clear`、`list` 和 `listForThread`。
- `src/server/runtimeState.ts` 只从 pending request 模块引用类型，不再定义 pending server request 类型。
- `src/server/codexAppServerBridge.ts` 不再直接操作 pending request Map，但仍保留 App Server permission request 的响应策略、JSON-RPC reply 和通知语义。
- 构建、CLI smoke、CJS 启动烟测和 release gate 均通过，证明拆分后的 ESM import、CLI 入口和发版门禁正常。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-03 代码审查：`rg` 确认 `pendingById` 和 pending request Map 读写只存在于 `src/server/pendingServerRequests.ts`。
- 2026-07-03 CLI smoke：`node dist-cli/index.js --help` 通过并输出 `CX-Codex Web bridge for Codex app-server`。
- 2026-07-03 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"` 输出 `cli cjs launcher smoke ok`。
- 2026-07-03 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 governance docs check、构建和 CLI smoke。

---

### Feature: App Server RPC diagnostics 模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerRpcDiagnostics.ts`。
- 本机可运行 `npm.cmd run build`。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run build`。
3. 执行 `node dist-cli/index.js --help`。
4. 执行 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
6. 代码审查确认 `src/server/codexAppServerBridge.ts` 通过 `AppServerRpcDiagnostics` 管理 active RPC count、队列峰值、队列积压告警、慢 RPC 记录、timeout 记录和 timeout restart window；RPC 队列排序、并发 drain、JSON-RPC call 和 app-server restart 仍由 bridge 控制。

#### Expected Results
- `src/server/appServerRpcDiagnostics.ts` 集中维护 `RpcDiagnosticRecord`、`RpcDiagnostics`、slow RPC 记录、timeout 记录、queue peak、queue backlog warning、active count 和 diagnostics snapshot。
- startup grace 内的 timeout 仍写入 recent timeout diagnostics，但不参与 repeated timeout restart window。
- `thread/list` 和 `thread/read` timeout 仍不触发 app-server restart window。
- 构建、CLI smoke、CJS 启动烟测和 release gate 均通过，证明拆分后的 ESM import、CLI 入口和发版门禁正常。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-03 代码审查：`rg` 确认 `recentSlowRpcRecords`、`recentTimeoutRecords`、`recentTimeoutsAtMs`、`queuePeakCount`、`queuePeakAtIso`、`activeRpcCalls` 和 `lastRpcQueueWarnAtMs` 只存在于 `src/server/appServerRpcDiagnostics.ts`。
- 2026-07-03 CLI smoke：`node dist-cli/index.js --help` 通过并输出 `CX-Codex Web bridge for Codex app-server`。
- 2026-07-03 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"` 输出 `cli cjs launcher smoke ok`。
- 2026-07-03 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 governance docs check、构建和 CLI smoke。

---

### Feature: App Server health snapshot 模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerHealth.ts` 和 `src/server/codexAppServerBridge.ts`。
- 本机可运行 `npm.cmd run verify:server-modules` 和 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
4. 代码审查确认 `scripts/server-module-smoke.ts` 直接断言 `createAppServerHealthSnapshot()` 的字段结构。
5. 代码审查确认 `src/server/codexAppServerBridge.ts` 通过 `createAppServerHealthSnapshot()` 生成 `getStatus()` 返回值，不再内联 `AppServerHealth` 类型和健康状态 object shape。
6. 代码审查确认 `src/server/appServerHealth.ts` 保留原有字段：running、initialized、stopping、pid、pendingRpcCount、queuedRpcCount、pendingServerRequestCount、activePlanModeTurnCount、launchPolicy 和 rpcDiagnostics。

#### Expected Results
- `src/server/appServerHealth.ts` 集中维护 App Server health snapshot 的 public shape。
- `getStatus()` 仍返回与原先一致的 running、initialized、stopping、pid、RPC/pending request/plan-mode 计数、launch policy 和 RPC diagnostics。
- server module smoke 直接覆盖 health snapshot shape，release gate 证明拆分后的 ESM import、server helper 和 CLI/package 构建链路正常。

#### Rollback/Cleanup
- 如需回滚，删除 `src/server/appServerHealth.ts`，撤销 `scripts/server-module-smoke.ts` 中的 health smoke，并把 `AppServerHealth` 类型和 `getStatus()` object literal 恢复到 `src/server/codexAppServerBridge.ts`。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-04 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 governance docs check、构建、server module smoke、CLI smoke、CJS launcher smoke 和 release package smoke。

---

### Feature: Server module smoke 自动化门禁

#### Prerequisites
- 当前仓库包含 `scripts/verify-server-modules.mjs` 和 `scripts/server-module-smoke.ts`。
- 本机已安装项目依赖，可运行本地 TypeScript compiler。

#### Steps
1. 执行 `npm.cmd run verify:server-modules`。
2. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
3. 检查 `scripts/verify-release.ps1`，确认 release gate 在构建之后执行 `Server module smoke`。
4. 检查 `package.json`，确认暴露 `verify:server-modules`。
5. 代码审查确认 smoke 覆盖 `AppServerRpcCache`、`AppServerRpcDiagnostics`、`PendingServerRequestStore` 和 `RuntimeStateStore` 的关键行为。

#### Expected Results
- `verify:server-modules` 会用本地 `tsc` 把 server 模块和 smoke 入口编译到 `output/server-module-smoke/`，再用 Node 执行真实行为断言。
- smoke 覆盖 shareable RPC key、thread/model cache stale、后台刷新、pending request consume/list/filter、RPC queue priority/concurrency/capacity/rejectAll、RPC diagnostics timeout/restart window、runtime stale/completed snapshot 和 persistable snapshot 清理。
- `verify:release` 默认包含 server module smoke，避免这些核心 bridge 小模块只被 build 覆盖。

#### Regression Evidence
- 2026-07-03 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-03 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"` 输出 `cli cjs launcher smoke ok`。
- 2026-07-03 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 `Server module smoke`、governance docs check、构建和 CLI smoke。

---

### Feature: App Server RPC queue 模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerRpcQueue.ts`。
- `scripts/server-module-smoke.ts` 已覆盖队列行为。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run build`。
3. 执行 `npm.cmd run verify:server-modules`。
4. 执行 `node dist-cli/index.js --help`。
5. 执行 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"`。
6. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
7. 代码审查确认 `src/server/codexAppServerBridge.ts` 通过 `AppServerRpcQueue` 管理排队、排序、容量限制、并发 drain 和 rejectAll；JSON-RPC call、timeout、App Server 生命周期和直接优先级 0 RPC 仍由 bridge 控制。

#### Expected Results
- `src/server/appServerRpcQueue.ts` 集中维护 `QueuedRpcTask`、`getAppServerRpcQueuePriority`、队列容量检查、优先级排序、并发调度和 rejectAll。
- `turn/start`、`turn/interrupt`、`thread/start`、`thread/resume` 和 `server/request/respond` 仍返回优先级 0，并在 bridge 中直接调用 `call()`。
- Server module smoke 验证 max-in-flight 为 1 时高优先级排队请求先于低优先级请求执行，并验证满队列错误和 rejectAll。
- 构建、server module smoke、CLI smoke、CJS 启动烟测和 release gate 均通过。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-03 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-03 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"` 输出 `cli cjs launcher smoke ok`。
- 2026-07-03 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 `Server module smoke`、构建和 CLI smoke。

---

### Feature: 语音转写安全诊断快照

#### Prerequisites
- 当前仓库包含 `src/server/transcriptionProxy.ts` 和诊断页 `src/components/content/DiagnosticsPanel.vue`。
- 本机可运行 `npm.cmd run verify:server-modules` 和 `npm.cmd run build`。
- 如需验证官方 API provider，可临时配置 `CX_CODEX_OPENAI_API_KEY` 或 `OPENAI_API_KEY`；不要把真实 key 写入仓库或截图。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`，确认 server smoke 覆盖默认转写配置、`CX_CODEX_` 环境变量优先级、请求体上限和 endpoint 脱敏。
3. 执行 `npm.cmd run build`。
4. 执行 `node dist-cli\index.js --help`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
6. 手工检查 `/codex-api/health` 和 `/codex-api/diagnostics` 的 `data.transcription`，确认只包含 provider、officialApiConfigured、model、responseFormat、requestBodyLimitBytes、requestBodyLimitMiB、endpoint.host、endpoint.path、endpoint.isDefault、endpoint.configured 和 endpoint.valid。
7. 打开诊断页，确认“语音转写”显示官方 API 或登录态回退、模型、响应格式、上传上限和脱敏 endpoint。

#### Expected Results
- 未配置官方 API key 时，`provider` 为 `chatgpt`，诊断页显示“登录态回退”，整体健康状态不因此变成告警。
- 配置 `CX_CODEX_OPENAI_API_KEY` 或 `OPENAI_API_KEY` 后，`provider` 为 `openai`，诊断页显示“官方 API”。
- 自定义 `CX_CODEX_OPENAI_TRANSCRIBE_URL` 时，诊断快照只展示生效 host/path 和配置有效性布尔值，不展示 URL query、API key、Authorization、Cookie、原始非法 URL 或其他凭据。
- 默认模型仍为 `gpt-4o-transcribe`，默认 `responseFormat` 为 `json`，默认上传上限按官方 25 MB 文件限制收紧为 `25000000` bytes。

#### Rollback/Cleanup
- 如需回滚，移除诊断快照函数、health/diagnostics 中的 `transcription` 字段、诊断页“语音转写”区块，以及 server smoke 中的转写配置断言。
- 临时设置过的 `CX_CODEX_OPENAI_API_KEY`、`OPENAI_API_KEY`、`CX_CODEX_OPENAI_TRANSCRIBE_URL` 等环境变量应在验证后清理。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-03 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-03 CLI smoke：`node dist-cli\index.js --help` 通过并输出 `CX-Codex Web bridge for Codex app-server`。
- 2026-07-03 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 governance docs check、构建、server module smoke 和 CLI smoke。

---

### Feature: App Server schema audit 摘要门禁

#### Prerequisites
- 当前仓库包含 `docs/app-server-schema-audit-summary.json`、`docs/app-server-protocol-matrix.zh-CN.md` 和 `scripts/verify-governance.ps1`。
- 本机可运行 PowerShell 7 (`pwsh`) 和 `npm.cmd`。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:governance`。
3. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
4. 检查 `docs/app-server-schema-audit-summary.json`，确认不包含本机绝对路径、用户目录、Token 或未脱敏 URL query。
5. 检查 `docs/app-server-protocol-matrix.zh-CN.md`，确认“当前证据”引用 `docs/app-server-schema-audit-summary.json`。
6. 可选故障注入：临时删除 `docs/app-server-schema-audit-summary.json` 中的 `comparison.jsonV2.addedCount`，确认 `npm.cmd run verify:governance` 失败；恢复后重新通过。

#### Expected Results
- schema audit 摘要作为可提交文档存在，不依赖被 `.gitignore` 忽略的 `output/` 临时目录。
- governance/release gate 能解析摘要 JSON，并校验官方文档链接、审计命令、`drift-recorded` 状态和四组 comparison 计数字段。
- `-SchemaAudit skip` 仍可用于 CI 或快速本地预检，但 release 文档要求正式发版前重新执行 `warn` 或 `strict` 并同步摘要。

#### Rollback/Cleanup
- 如需回滚，移除 `docs/app-server-schema-audit-summary.json`，从 `scripts/verify-governance.ps1` 删除对应校验，并恢复协议矩阵、release 文档、changelog 和本节测试记录。
- 如果做过故障注入，恢复 JSON 后重新运行 `npm.cmd run verify:governance`。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 治理门禁验证：`npm.cmd run verify:governance` 通过，输出 `Governance docs check passed.`。
- 2026-07-03 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 schema audit summary 结构校验、governance docs check、构建、server module smoke 和 CLI smoke。

---

### Feature: Composer file search 模块化

#### Prerequisites
- 当前仓库包含 `src/server/composerFileSearch.ts`。
- 本机安装依赖已完成，`node_modules/typescript` 可用于 `verify:server-modules`。
- 如需真实接口验证，测试目录内需有可被 `rg --files` 枚举的文件。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run build`。
4. 执行 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
6. 代码审查确认 `src/server/codexAppServerBridge.ts` 的 `/codex-api/composer-file-search` 路由只负责读取 payload、调用 `searchComposerFiles()`、映射 `ComposerFileSearchError` 状态码和返回 JSON。

#### Expected Results
- `src/server/composerFileSearch.ts` 集中维护 cwd 归一化、cwd 存在性校验、limit 截断、候选文件打分、排序和 `rg --files` 枚举。
- 缺失 `cwd` 返回 400；`cwd` 指向文件返回 400；`cwd` 不存在返回 404；`rg --files` 或运行时异常返回 500。
- 空 query 保留原行为：全部候选分数为 0，并按路径字典序返回前 N 个。
- 非空 query 仍按 basename 精确匹配、basename 前缀、basename 包含、路径分段、路径包含的优先级排序，并过滤不匹配候选。
- Server module smoke 覆盖 limit 边界、cwd 错误状态码、打分优先级、空 query 排序和候选裁剪。
- 构建、server module smoke、CJS 启动烟测和 release gate 均通过。

#### Rollback / Cleanup
- 若验证失败，回滚 `src/server/composerFileSearch.ts`、`src/server/codexAppServerBridge.ts`、`scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs` 和本测试章节，再重新运行相关门禁。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-03 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-03 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"` 输出 `cli cjs launcher smoke ok`。
- 2026-07-03 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 whitespace、package parse、governance docs、构建、server module smoke 和 CLI smoke；schema audit 按本阶段命令跳过。

---

### Feature: GitHub Trending 服务模块化

#### Prerequisites
- 当前仓库包含 `src/server/githubTrending.ts`。
- 本机安装依赖已完成，`node_modules/typescript` 可用于 `verify:server-modules`。
- 如需真实接口验证，当前网络需能访问 GitHub Trending；server module smoke 不依赖外部网络。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run build`。
4. 执行 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
6. 代码审查确认 `src/server/codexAppServerBridge.ts` 的 `/codex-api/github-trending` 和 `/codex-api/github-trending/translate` 路由只负责读取 query/body、调用 `githubTrending.ts`、映射 502/fallback 响应和返回 JSON。

#### Expected Results
- `src/server/githubTrending.ts` 集中维护 `since` 默认值、limit 截断、翻译 batch 截断、GitHub Trending HTML 解析、HTML entity 清理、Google Translate payload 读取和翻译缓存。
- `/codex-api/github-trending` 的 `since` 仅接受 `daily`、`weekly`、`monthly`，非法值回退到 `daily`；`limit` 限制在 1 到 10，非法值回退到 6。
- GitHub Trending fetch 失败仍返回 502，错误文案来自原始错误或 `Failed to fetch GitHub trending` fallback。
- 翻译接口最多处理 10 条描述，非字符串描述转为空字符串；翻译失败时仍返回原描述数组，保持前端可用。
- Server module smoke 覆盖 HTML 解析去重、stars 数字解析、limit 裁剪、since/limit 归一化、翻译 payload 归一化、CJK/no-letter 跳过翻译和 Google Translate JSON 拼接。
- 构建、server module smoke、CJS 启动烟测和 release gate 均通过。

#### Rollback / Cleanup
- 若验证失败，回滚 `src/server/githubTrending.ts`、`src/server/codexAppServerBridge.ts`、`scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs` 和本测试章节，再重新运行相关门禁。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-03 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-03 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"` 输出 `cli cjs launcher smoke ok`。
- 2026-07-03 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 whitespace、package parse、governance docs、构建、server module smoke 和 CLI smoke；schema audit 按本阶段命令跳过。

---

### Feature: Command runner 模块化

#### Prerequisites
- 当前仓库包含 `src/server/commandRunner.ts`。
- 本机安装依赖已完成，`node_modules/typescript` 可用于 `verify:server-modules`。
- 当前 Node 可执行文件可被子进程调用。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run build`。
4. 执行 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
6. 代码审查确认 `src/server/codexAppServerBridge.ts` 不再内联 `runCommand()`、`runCommandCapture()` 和 `runCommandWithOutput()`，worktree/rollback/Git 初始化仍通过 `src/server/commandRunner.ts` 调用子进程。

#### Expected Results
- `src/server/commandRunner.ts` 集中维护 command spawn、`cwd`、`process.env`、stdout/stderr 收集、trim 输出和错误格式。
- `runCommand()` 成功时不返回输出；`runCommandCapture()` 和 `runCommandWithOutput()` 成功时返回 trim 后的 stdout。
- 命令失败时错误文案保持 `Command failed (<command> <args>)` 格式，并附带 stderr/stdout 细节。
- Server module smoke 使用当前 Node 可执行文件覆盖成功退出、cwd 传递、输出 trim 和失败 stderr/stdout 拼接。
- 构建、server module smoke、CJS 启动烟测和 release gate 均通过。

#### Rollback / Cleanup
- 若验证失败，回滚 `src/server/commandRunner.ts`、`src/server/codexAppServerBridge.ts`、`scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs` 和本测试章节，再重新运行相关门禁。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-03 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-03 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"` 输出 `cli cjs launcher smoke ok`。
- 2026-07-03 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 whitespace、package parse、governance docs、构建、server module smoke 和 CLI smoke；schema audit 按本阶段命令跳过。

---

### Feature: Thread title cache 模块化

#### Prerequisites
- 当前仓库包含 `src/server/threadTitleCache.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 thread title cache 归一化、持久 state 读写和 `session_index.jsonl` 解析。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run build`。
4. 执行 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
6. 代码审查确认 `src/server/codexAppServerBridge.ts` 只负责传入 `getCodexGlobalStatePath()` / `getCodexSessionIndexPath()`，标题缓存归一化、合并、读写和 session index 扫描均来自 `src/server/threadTitleCache.ts`。

#### Expected Results
- `src/server/threadTitleCache.ts` 集中维护 `thread-titles` state 归一化、最近标题顺序、删除、合并和 JSON 写回。
- `session_index.jsonl` 解析会跳过坏行和空标题，同一 thread 保留最新 `updated_at` 标题，并按更新时间降序生成 order。
- `/codex-api/thread-titles` GET 仍返回持久标题和 session index 标题的合并结果；PUT 仍只更新持久 `thread-titles`。
- Thread 搜索索引仍能用 session index 标题补充 app-server 未返回的历史 thread。
- 构建、server module smoke、CJS 启动烟测和 release gate 均通过。

#### Rollback/Cleanup
- 如需回滚，移除 `src/server/threadTitleCache.ts`，将 bridge 重新改回内联 helper，并从 `scripts/verify-server-modules.mjs` 与 `scripts/server-module-smoke.ts` 移除对应 smoke 覆盖。

---

### Feature: Workspace roots state 模块化

#### Prerequisites
- 当前仓库包含 `src/server/workspaceRootsState.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 workspace roots state 归一化、全局 state 读写和项目根目录 upsert 行为。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run build`。
4. 执行 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
6. 代码审查确认 `src/server/codexAppServerBridge.ts` 只负责路由、路径存在性检查和传入 `getCodexGlobalStatePath()`，workspace roots state 的归一化、读写和 upsert 均来自 `src/server/workspaceRootsState.ts`。

#### Expected Results
- `src/server/workspaceRootsState.ts` 集中维护 `electron-saved-workspace-roots`、`electron-workspace-root-labels` 和 `active-workspace-roots` 三个全局 state key。
- 重复 workspace root 会去重并保持最近项目在最前；新增项目根目录会同时更新 order 和 active。
- 写回 workspace roots state 时会保留 `.codex-global-state.json` 中不相关的其他字段。
- `/codex-api/workspace-roots-state` GET/PUT 和 `/codex-api/project-root` 的行为与拆分前一致。
- 构建、server module smoke、CJS 启动烟测和 release gate 均通过。

#### Rollback/Cleanup
- 如需回滚，移除 `src/server/workspaceRootsState.ts`，将 bridge 重新改回内联 workspace roots helper，并从 `scripts/verify-server-modules.mjs` 与 `scripts/server-module-smoke.ts` 移除对应 smoke 覆盖。

---

### Feature: Thread search index 模块化

#### Prerequisites
- 当前仓库包含 `src/server/threadSearchIndex.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 thread search row 归一化、thread/list 翻页索引、session index 标题补充、搜索匹配和索引 store clear 行为。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run build`。
4. 执行 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
6. 代码审查确认 `src/server/codexAppServerBridge.ts` 只负责提供 `appServer.rpc('thread/list')` 和 `readThreadTitlesFromSessionIndex(getCodexSessionIndexPath())`，thread search 索引构建、缓存、搜索和清理均来自 `src/server/threadSearchIndex.ts`。

#### Expected Results
- `src/server/threadSearchIndex.ts` 集中维护 thread search document、thread/list 翻页读取、归档/未归档合并、session index 标题补充和精确短语匹配。
- `/codex-api/thread-search` 空查询仍返回空结果；非空查询返回 `{ threadIds, indexedThreadCount }`。
- `thread/start`、`thread/archive`、`thread/name/set` 等会影响 thread list 的 RPC 成功后会清理 thread search index；`runtime/send` 新建 thread 成功后也会清理索引，下次搜索重新构建。
- 重复 thread id 只保留 app-server thread/list 首次返回的记录，session index 只补充缺失 thread。
- 构建、server module smoke、CJS 启动烟测和 release gate 均通过。

#### Rollback/Cleanup
- 如需回滚，移除 `src/server/threadSearchIndex.ts`，将 bridge 重新改回内联 thread search helper，并从 `scripts/verify-server-modules.mjs` 与 `scripts/server-module-smoke.ts` 移除对应 smoke 覆盖。

---

### Feature: Multipart file upload 模块化与大小限制

#### Prerequisites
- 当前仓库包含 `src/server/fileUpload.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 multipart boundary 读取、文件 part 解析、文件名净化、CRLF 裁剪、缺失文件错误、请求体大小限制、环境变量覆盖和临时目录写入。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run build`。
4. 执行 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
6. 代码审查确认 `/codex-api/upload-file` route 只负责调用 `handleMultipartFileUpload()` 和返回 JSON；multipart 解析、文件名净化和临时文件写入均来自 `src/server/fileUpload.ts`。

#### Expected Results
- 缺少 multipart boundary 时仍返回 400 和 `Missing multipart boundary`。
- 请求中没有文件 part 时仍返回 400 和 `No file in request`。
- 超过上传请求体上限时返回 413，默认上限为 50MiB，可通过 `CX_CODEX_FILE_UPLOAD_MAX_BYTES` 或 `FILE_UPLOAD_MAX_BYTES` 覆盖。
- 上传文件名中的 `/` 和 `\` 会替换为 `_`，避免路径穿越。
- 上传文件仍写入系统临时目录下的 `codex-web-uploads/f-*` 子目录，并返回 `{ path }`。
- 构建、server module smoke、CJS 启动烟测和 release gate 均通过。

#### Rollback/Cleanup
- 如需回滚，移除 `src/server/fileUpload.ts`，将 bridge 重新改回内联 multipart upload helper，并从 `scripts/verify-server-modules.mjs` 与 `scripts/server-module-smoke.ts` 移除对应 smoke 覆盖。

---

### Feature: Multipart file upload route 模块化

#### Prerequisites
- 当前仓库包含 `src/server/fileUploadRoute.ts`、`src/server/fileUpload.ts`、`src/server/codexAppServerBridge.ts`、`scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs`、`scripts/verify-governance.ps1` 和 `scripts/verify-release.ps1`。
- 本机可运行 server module smoke、governance gate 和 release gate；route smoke 使用注入依赖，不需要真实写入上传文件。

#### Steps
1. 打开 `src/server/codexAppServerBridge.ts`，确认 `/codex-api/upload-file` 统一委托 `handleFileUploadRoute(...)`。
2. 打开 `src/server/fileUploadRoute.ts`，确认 route 模块只负责 method/path 匹配、调用 `handleMultipartFileUpload(...)`、映射 `FileUploadError.statusCode` 和返回 JSON。
3. 执行 `git diff --check`。
4. 执行 `node scripts\verify-server-modules.mjs`。
5. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`。
6. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`。
7. 确认 release package smoke 必检 `src\server\fileUploadRoute.ts`。

#### Expected Results
- `POST /codex-api/upload-file` 成功时继续返回 `handleMultipartFileUpload(...)` 的 `{ path }`。
- `FileUploadError` 仍按自身 `statusCode` 返回，例如 missing boundary/no file 为 400、body too large 为 413。
- 非 `FileUploadError` 仍返回 500，并通过 `getErrorMessage(...)` 输出错误文案或 fallback。
- 未匹配 method/path 返回 `false`，不吞掉后续 route。
- `fileUploadRoute.ts` 被 TypeScript server smoke、governance gate 和 release zip 清单覆盖。

#### Rollback/Cleanup Notes
- 如需回滚，撤销 `src/server/fileUploadRoute.ts`、`src/server/codexAppServerBridge.ts`、`scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs`、`scripts/verify-governance.ps1`、`scripts/verify-release.ps1` 和本节测试记录中的相关改动。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`node scripts\verify-server-modules.mjs` 通过，输出 `server module smoke ok`，覆盖 upload route 成功、`FileUploadError` status 映射、通用 500 fallback 和未匹配 route 返回 `false`。
- 2026-07-04 治理门禁：`node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate：`node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` 通过，输出 `server module smoke ok`、`release package smoke ok`、`npm package smoke ok` 和 `Release verification completed.`；zip 必检清单包含 `src\server\fileUploadRoute.ts`。

---

### Feature: Project root 模块化

#### Prerequisites
- 当前仓库包含 `src/server/projectRoots.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 project root 路径归一化、目录校验、缺失目录创建、workspace state upsert 和默认项目名 suggestion。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run build`。
4. 执行 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
6. 代码审查确认 `/codex-api/project-root` 和 `/codex-api/project-root-suggestion` route 只负责读取请求参数、调用 `projectRoots.ts` 和写 JSON response；路径校验、创建和 suggestion 逻辑均来自 `src/server/projectRoots.ts`。

#### Expected Results
- 缺少 project path 时仍返回 400 和 `Missing path`。
- path 存在但不是目录时仍返回 400 和 `Path exists but is not a directory`。
- path 不存在且未设置 `createIfMissing` 时仍返回 404 和 `Directory does not exist`。
- `createIfMissing=true` 时会创建目录，并通过 workspace roots state 将项目置顶到 order 和 active。
- `project-root-suggestion` 会跳过已存在的 `New Project (n)`，返回第一个可用名称；basePath 缺失、不是目录或不存在时仍返回对应 400/404。
- 构建、server module smoke、CJS 启动烟测和 release gate 均通过。

#### Rollback/Cleanup
- 如需回滚，移除 `src/server/projectRoots.ts`，将 bridge 重新改回内联 project-root helper，并从 `scripts/verify-server-modules.mjs` 与 `scripts/server-module-smoke.ts` 移除对应 smoke 覆盖。

---

### Feature: App Server stdout line buffer 模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerLineBuffer.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 stdout chunk 分行行为。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run build`。
3. 执行 `npm.cmd run verify:server-modules`。
4. 执行 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
6. 代码审查确认 `src/server/codexAppServerBridge.ts` 通过 `AppServerLineBuffer` 管理 stdout chunk 缓冲、空行跳过和进程生命周期清理；JSON 解析、RPC response、notification 和 server request 分发仍由 bridge 的 `handleLine()` 控制。

#### Expected Results
- `src/server/appServerLineBuffer.ts` 集中维护 App Server stdout 的 partial chunk 缓冲、按 `\n` 分行、trim 后空行跳过和 `clear()`。
- App Server 进程 `error`、`exit`、restart 和 dispose 时仍清空未完成 stdout 行，避免旧进程残留数据污染新进程。
- Server module smoke 验证跨 chunk 的 JSON 行拼接、连续空行跳过、尾部 partial pending length 和 clear 重置。
- 构建、server module smoke、CJS 启动烟测和 release gate 均通过。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-03 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-03 代码审查：`rg` 确认旧 `readBuffer` 字段和直接字符串缓冲逻辑已从 `src/server/codexAppServerBridge.ts` 移除。
- 2026-07-03 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"` 输出 `cli cjs launcher smoke ok`。
- 2026-07-03 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 `Server module smoke`、构建和 CLI smoke。

---

### Feature: App Server stderr logger 模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerStderrLogger.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 stderr 日志节流行为。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run build`。
3. 执行 `npm.cmd run verify:server-modules`。
4. 执行 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
6. 代码审查确认 `src/server/codexAppServerBridge.ts` 通过 `AppServerStderrLogger` 管理 App Server stderr 的 30 秒节流、suppressed count 和 1200 字符截断；bridge 仍只负责进程 stderr chunk trim 和空消息跳过。

#### Expected Results
- `src/server/appServerStderrLogger.ts` 集中维护 stderr warn 日志节流、压制计数、消息截断和默认 `writeBridgeLog('warn', 'Codex app-server stderr', ...)` 写入。
- Server module smoke 使用注入时钟和写日志回调验证首条日志写入、窗口内消息压制、窗口后日志恢复并携带 `suppressedCount`。
- bridge 中不再保留 `lastAppServerStderrLogAtMs`、`appServerStderrSuppressedCount` 或 `logAppServerStderr()`。
- 构建、server module smoke、CJS 启动烟测和 release gate 均通过。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-03 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-03 代码审查：`rg` 确认旧 stderr 节流字段和 `logAppServerStderr()` 已从 `src/server/codexAppServerBridge.ts` 移除。
- 2026-07-03 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"` 输出 `cli cjs launcher smoke ok`。
- 2026-07-03 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 `Server module smoke`、构建和 CLI smoke。

---

### Feature: Plan mode turn store 模块化

#### Prerequisites
- 当前仓库包含 `src/server/planModeTurnStore.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 plan-mode turn 状态行为。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run build`。
3. 执行 `npm.cmd run verify:server-modules`。
4. 执行 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
6. 代码审查确认 `src/server/codexAppServerBridge.ts` 通过 `PlanModeTurnStore` 管理 active plan-mode turn 标记、按 thread/turn 清理、server request active 判断和进程生命周期清空。

#### Expected Results
- `src/server/planModeTurnStore.ts` 集中维护 `mark`、`clear`、`clearByThreadOrTurn`、`isActiveRequest`、`clearAll`、`count` 和 `list`。
- 指定 turnId 的清理不会误清其他 active plan turn；只有 turnId 的完成/失败通知仍能清理对应 thread 的 active plan。
- App Server process error、exit、restart 和 dispose 时清空 active plan turns，避免旧进程残留的 plan-mode 状态影响后续 server request 自动拒绝逻辑。
- Server module smoke 验证 thread/turn trim、turnId 匹配、防误清、按 turnId 清理和 clearAll。
- 构建、server module smoke、CJS 启动烟测和 release gate 均通过。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-03 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-03 代码审查：`rg` 确认旧 `planModeTurnsByThreadId` Map 已从 `src/server/codexAppServerBridge.ts` 移除，bridge 改用 `PlanModeTurnStore`。
- 2026-07-03 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"` 输出 `cli cjs launcher smoke ok`。
- 2026-07-03 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 `Server module smoke`、构建和 CLI smoke。

---

### Feature: Thread token usage 模块化

#### Prerequisites
- 当前仓库包含 `src/server/threadTokenUsage.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 token usage 归一化、thread 缓存和 session log fallback。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run build`。
3. 执行 `npm.cmd run verify:server-modules`。
4. 执行 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
6. 代码审查确认 `src/server/codexAppServerBridge.ts` 从 `threadTokenUsage.ts` 引用 `ThreadTokenUsage`、`ThreadTokenUsageStore`、`readThreadTokenUsageFromThreadReadPayload` 和 `readThreadTokenUsageFromSessionLog`，不再内联 token usage 解析、session log token cache 或 `threadTokenUsageByThreadId` Map。

#### Expected Results
- `src/server/threadTokenUsage.ts` 集中维护 token usage 类型、camel/snake 字段兼容、used percent/remaining tokens 派生、thread/read payload 读取、session log `token_count` 扫描和 session log token usage LRU 缓存。
- App Server `thread/tokenUsage/updated` 通知仍会更新当前 thread token usage；无效 token usage payload 会清理该 thread 的缓存值。
- `readCachedThreadTokenUsage()` 仍按内存缓存、cached thread/read payload、session log fallback 的顺序读取。
- Server module smoke 验证 camel/snake 归一化、百分比截断、remaining token 下限、通知 store 更新/删除、session log 最新 token_count 读取和 missing path fallback。
- 构建、server module smoke、CJS 启动烟测和 release gate 均通过。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-03 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-03 代码审查：`rg` 确认 token usage 归一化、session log token cache 和 `ThreadTokenUsageStore` 均在 `src/server/threadTokenUsage.ts`。
- 2026-07-03 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"` 输出 `cli cjs launcher smoke ok`。
- 2026-07-03 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 `Server module smoke`、构建和 CLI smoke。

---

### Feature: Server request policy 模块化

#### Prerequisites
- 当前仓库包含 `src/server/serverRequestPolicy.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 server request 策略行为。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run build`。
3. 执行 `npm.cmd run verify:server-modules`。
4. 执行 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
6. 代码审查确认 `src/server/codexAppServerBridge.ts` 通过 `evaluateServerRequestPolicy()` 处理 plan-mode decline、auto-approve 和 unsupported tool-call；bridge 仍负责 JSON-RPC reply、warn 日志、`server/request/resolved` 通知和 pending request 记录。

#### Expected Results
- `src/server/serverRequestPolicy.ts` 集中维护 `PermissionDecision`、`WebBridgeSettings` 类型、MCP elicitation/tool permission 判断、plan-mode 自动拒绝、权限自动批准和 unsupported `item/tool/call` 结果。
- plan-mode permission request 优先于 allow-for-session 自动批准，仍返回 `{ decision: 'decline' }` 或 MCP `{ action: 'decline' }`。
- allow-for-session 权限仍自动批准 command/file request；MCP tool permission 仍返回 `{ action: 'accept' }`。
- unsupported `item/tool/call` 仍自动返回不能代执行工具的中文结果，并由 bridge 写 warn 日志。
- Server module smoke 验证 MCP 正常/历史拼写方法名、allow/ask 权限、plan decline 优先级、queue fallback 和 unsupported tool-call。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-03 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-03 代码审查：`rg` 确认 MCP permission 和 server request policy helper 已集中到 `src/server/serverRequestPolicy.ts`，bridge 只调用 `evaluateServerRequestPolicy()`。
- 2026-07-03 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"` 输出 `cli cjs launcher smoke ok`。
- 2026-07-03 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 `Server module smoke`、构建和 CLI smoke。

---

### Feature: Server request reply payload 模块化

#### Prerequisites
- 当前仓库包含 `src/server/serverRequestReply.ts` 和 `src/server/codexAppServerBridge.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 server request reply payload 的成功、错误和非法输入行为。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
4. 代码审查确认 `src/server/codexAppServerBridge.ts` 通过 `readServerRequestReplyPayload()` 解析 `/codex-api/server-requests/respond` payload，不再内联 response payload 校验。
5. 代码审查确认 `src/server/serverRequestReply.ts` 保留原有语义：`id` 必须是整数、`error.message` 会 trim、无效 error code 默认 `-32000`、缺少 `result` 和 `error` 时失败。

#### Expected Results
- `src/server/serverRequestReply.ts` 集中维护手动 server request response payload 的 public parser 和 `ServerRequestReply` 类型。
- bridge 仍负责确保 App Server 初始化、消费 pending request、发送 JSON-RPC reply 和发出 `server/request/resolved` 通知。
- server module smoke 直接覆盖 result reply、error reply、默认拒绝错误和非法 payload；release gate 通过，证明拆分后的 ESM import、server helper 和 CLI/package 构建链路正常。

#### Rollback/Cleanup
- 如需回滚，删除 `src/server/serverRequestReply.ts`，撤销 `scripts/server-module-smoke.ts` 中的 reply payload smoke，并把 `ServerRequestReply` 类型和 `respondToServerRequest()` payload 校验恢复到 `src/server/codexAppServerBridge.ts`。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-04 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 governance docs check、构建、server module smoke、CLI smoke、CJS launcher smoke 和 release package smoke。

---

### Feature: Web bridge settings 模块化

#### Prerequisites
- 当前仓库包含 `src/server/webBridgeSettings.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 Web bridge settings 默认值、归一化和读写行为。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run build`。
3. 执行 `npm.cmd run verify:server-modules`。
4. 执行 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
6. 代码审查确认 `src/server/codexAppServerBridge.ts` 通过 `codexPaths.ts` 获取 settings 路径，默认值、`normalizeWebBridgeSettings()`、`readWebBridgeSettings()` 和 `writeWebBridgeSettings()` 均来自 `src/server/webBridgeSettings.ts`。

#### Expected Results
- `src/server/webBridgeSettings.ts` 集中维护默认权限、permission decision 归一化、settings payload 归一化、配置 JSON 读取和写入。
- 配置文件路径由 `src/server/codexPaths.ts` 的 `getWebBridgeSettingsPath()` 生成，保持原来的 `web-bridge-settings.json` 位置，并跟随 `CODEX_HOME`。
- 缺失或非法 JSON 配置会回退到默认权限；写入接口会先归一化再持久化。
- Server module smoke 验证 `ask`/`allowForSession` 判定、非法值回退、missing/invalid file 读取、写入归一化和再次读取一致。
- 构建、server module smoke、CJS 启动烟测和 release gate 均通过。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-03 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`。
- 2026-07-03 代码审查：`rg` 确认 settings 默认值、归一化和读写 helper 已集中到 `src/server/webBridgeSettings.ts`。
- 2026-07-03 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; if (!r.stdout.includes('CX-Codex Web bridge for Codex app-server')) { throw new Error('unexpected cli help output') }; console.log('cli cjs launcher smoke ok')"` 输出 `cli cjs launcher smoke ok`。
- 2026-07-03 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 `Server module smoke`、构建和 CLI smoke。

---

### Feature: Codex 本机路径模块化

#### Prerequisites
- 当前仓库包含 `src/server/codexPaths.ts`。
- 本机可运行 `npm.cmd run verify:server-modules` 和 `npm.cmd run build`。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run build`。
4. 执行 `node dist-cli\index.js --help`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
6. 代码审查确认 `codexAppServerBridge.ts`、`webUiState.ts`、`skillsRoutes.ts` 和 `skillsHubService.ts` 不再各自实现 `getCodexHomeDir()`，统一从 `codexPaths.ts` 获取 Codex home、auth、global state、web settings、skills 和 worktrees 路径。

#### Expected Results
- `CODEX_HOME` 为空或空白时默认回退到用户目录下的 `.codex`。
- 设置 `CODEX_HOME` 时，auth、global state、session index、web settings、Web UI state、favorites、pinned thread ids、skills、skills sync state 和 worktrees 路径都跟随该目录。
- Web UI state 和 skills 服务不再忽略 `CODEX_HOME`。
- Server module smoke 覆盖默认回退和所有关键路径构造。
- 构建、server module smoke、CLI smoke 和 release gate 均通过。

#### Rollback / Cleanup
- 如需回滚，撤销 `src/server/codexPaths.ts`、bridge/webUiState/skillsRoutes/skillsHubService import 调整、server module smoke、verify-server-modules、changelog 和本节测试记录。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`，覆盖 `CODEX_HOME` trim、默认回退和 Codex auth/global state/session/settings/Web UI/skills/worktrees 路径。
- 2026-07-03 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-03 CLI smoke：`node dist-cli\index.js --help` 通过并输出 `CX-Codex Web bridge for Codex app-server`。
- 2026-07-03 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 whitespace、package parse、governance docs、构建、server module smoke 和 CLI smoke；schema audit 按本阶段命令跳过。

---

### Feature: Codex auth 读取模块化

#### Prerequisites
- 当前仓库包含 `src/server/codexAuth.ts` 和 `src/server/codexPaths.ts`。
- 本机可运行 `npm.cmd run verify:server-modules` 和 `npm.cmd run build`。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run build`。
4. 执行 `node dist-cli\index.js --help`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
6. 代码审查确认 `src/server/codexAppServerBridge.ts` 不再内联 `auth.json` 读取和解析，只在语音转写 ChatGPT 回退路径调用 `readCodexAuth()`。

#### Expected Results
- `readCodexAuth()` 从 `codexPaths.ts` 的 `getCodexAuthPath()` 读取 `auth.json`。
- 缺失文件、非法 JSON、缺少 `tokens.access_token` 时返回 `null`。
- 有 access token 时只返回 `{ accessToken, accountId? }` 给调用方，不写日志、不进入 health/diagnostics。
- 官方 OpenAI API key 未配置且本地 auth 不可用时，`/codex-api/transcribe` 继续返回 `401 No auth token available for transcription`。
- Server module smoke 使用临时 `CODEX_HOME` 覆盖 missing、invalid、missing token 和 valid auth。

#### Rollback / Cleanup
- 如需回滚，撤销 `src/server/codexAuth.ts`、bridge import 调整、server module smoke、verify-server-modules、changelog 和本节测试记录。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`，覆盖 auth missing、invalid、missing token 和 valid token/account id。
- 2026-07-03 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-03 CLI smoke：`node dist-cli\index.js --help` 通过并输出 `CX-Codex Web bridge for Codex app-server`。
- 2026-07-03 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 whitespace、package parse、governance docs、构建、server module smoke 和 CLI smoke；schema audit 按本阶段命令跳过。

---

### Feature: 置顶线程状态模块化

#### Prerequisites
- 当前仓库包含 `src/server/pinnedThreads.ts`、`src/server/webUiState.ts` 和 `src/server/codexPaths.ts`。
- 本机可运行 `npm.cmd run verify:server-modules` 和 `npm.cmd run build`。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run build`。
4. 执行 `node dist-cli\index.js --help`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
6. 代码审查确认 `src/server/codexAppServerBridge.ts` 不再内联 desktop pinned thread 读取、写入和 Web/Desktop 合并逻辑，`/codex-api/pinned-threads` 和 `thread/list` 补齐均通过 `pinnedThreads.ts`。

#### Expected Results
- `normalizePinnedThreadIds()` 会 trim、去空、去重，并忽略非字符串值。
- `readMergedPinnedThreadIds()` 合并 Web pinned 文件和桌面 `.codex-global-state.json` 中的 `pinned-thread-ids`。
- `writeMergedPinnedThreadIds()` 同步写入 Web pinned 文件和桌面 global state，且保留 global state 中的其他字段。
- Server module smoke 使用临时 `CODEX_HOME` 覆盖 Web/Desktop 合并和双写。
- 构建、server module smoke、CLI smoke 和 release gate 均通过。

#### Rollback / Cleanup
- 如需回滚，撤销 `src/server/pinnedThreads.ts`、bridge import 调整、server module smoke、verify-server-modules、changelog 和本节测试记录。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`，覆盖 pinned thread 归一化、Web/Desktop 合并、双写和 global state 其他字段保留。
- 2026-07-03 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-03 CLI smoke：`node dist-cli\index.js --help` 通过并输出 `CX-Codex Web bridge for Codex app-server`。
- 2026-07-03 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 whitespace、package parse、governance docs、构建、server module smoke 和 CLI smoke；schema audit 按本阶段命令跳过。

---

### Feature: App Server 未知状态诊断

#### Prerequisites
- 当前仓库包含 `src/server/appServerStatusDiagnostics.ts`。
- 本地 Codex App Server 可通过 bridge 执行 `thread/read`，或至少可以运行 server module smoke。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run build`。
4. 执行 CJS 启动烟测：`node dist-cli\index.js --help`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
6. 手工打开诊断中心，确认页面存在“未知状态”区域。
7. 在本地 bridge 运行后请求 `/codex-api/diagnostics`，确认响应 `data.statusDiagnostics` 包含 `unknownStatusCount` 和 `recentUnknownStatuses`。

#### Expected Results
- `thread.status`、`thread.status.type`、`thread.turnStatus` 和最新 `thread.turns[].status` 中的已知状态不会增加未知状态计数。
- 未知状态会按 `source + normalizedValue` 聚合，保留 count、first/last seen、threadId。
- `/codex-api/health` 和 `/codex-api/diagnostics` 都返回 `statusDiagnostics`，不暴露用户 prompt 或敏感 payload。
- 诊断中心在出现未知状态时整体进入 warning，并展示来源、原始值、计数和最近出现时间。
- Runtime 状态机仍只把明确 active 状态映射为运行态；未知 status 不会因为名字存在就被当成 running。

#### Rollback/Cleanup Notes
- 如需回滚，移除 `src/server/appServerStatusDiagnostics.ts`，并撤销 bridge、诊断面板、server module smoke、协议矩阵、changelog 和本测试说明中的相关引用。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`，覆盖未知状态聚合与裁剪。
- 2026-07-03 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-03 CJS 启动烟测：`node dist-cli\index.js --help` 通过，输出 `CX-Codex Web bridge for Codex app-server`。
- 2026-07-03 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 whitespace、governance docs、build、server module smoke 和 CLI smoke。

---

### Feature: 诊断中心 schema audit 摘要

#### Prerequisites
- 当前仓库包含 `docs/app-server-schema-audit-summary.json`。
- 当前仓库包含 `src/server/appServerSchemaAuditSummary.ts`。
- 如需 UI 手工检查，本地 bridge 能访问 `/codex-api/diagnostics`。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run build`。
4. 执行 CJS 启动烟测：`node dist-cli\index.js --help`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
6. 请求 `/codex-api/diagnostics`，确认 `data.schemaAudit` 包含 `available`、`reviewStatus`、`generatedAtIso`、`officialDocsUrl`、`comparison` 和 `totals`。
7. 手工打开诊断中心，确认顶部区域存在“协议审计”卡片，能展示审计状态、生成时间、新增/移除总数和四组 schema diff 计数。
8. 检查 `package.json`，确认 npm `files` 包含 `docs/app-server-schema-audit-summary.json`。

#### Expected Results
- `docs/app-server-schema-audit-summary.json` 能被后端解析为脱敏诊断快照，不暴露本机绝对路径、Token 或用户 prompt。
- 文件缺失或解析失败时，`schemaAudit.available` 为 `false`，诊断接口仍返回成功。
- 诊断中心在 `reviewStatus` 为 `drift-recorded` 时显示 warning，提醒维护者当前官方 schema drift 已记录但未覆盖基线。
- 发布包包含 schema audit 摘要文件，打包后 CLI 旁边的诊断接口仍有治理摘要来源。
- Server module smoke 覆盖摘要归一化、总数计算、代表项裁剪和缺失文件 fallback。

#### Rollback/Cleanup Notes
- 如需回滚，移除 `src/server/appServerSchemaAuditSummary.ts`，撤销 bridge、诊断面板、server module smoke、`package.json`、协议矩阵、changelog 和本节测试记录中的相关引用。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`，覆盖 schema audit 摘要归一化、总数计算、代表项裁剪和缺失文件 fallback。
- 2026-07-03 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-03 CJS 启动烟测：`node dist-cli\index.js --help` 通过，输出 `CX-Codex Web bridge for Codex app-server`。
- 2026-07-03 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 whitespace、package parse、governance docs、构建、server module smoke 和 CLI smoke。
- 2026-07-03 打包清单验证：`npm.cmd pack --dry-run` 通过，Tarball Contents 包含 `docs/app-server-schema-audit-summary.json`。

---

### Feature: 诊断中心权限请求队列

#### Prerequisites
- 本地 bridge 可访问 `/codex-api/diagnostics`。
- App Server 可能产生 `server/request` pending 请求；没有 pending 请求时也应显示空状态。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run build`。
4. 执行 CJS 启动烟测：`node dist-cli\index.js --help`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
6. 请求 `/codex-api/health` 和 `/codex-api/diagnostics`，确认 `data.serverRequestDiagnostics` 包含 `pendingRequestCount`、`pendingByKind` 和 `pendingRequests`。
7. 请求 `/codex-api/server-requests/pending/diagnostics`，确认 `data.pendingRequests` 只包含 `id`、`method`、`kind`、`receivedAtIso`，不包含原始 `params`。
8. 请求原始 `/codex-api/server-requests/pending`，确认该接口仍保留审批交互所需的原始 pending 数据，不作为诊断中心展示来源。
9. 打开诊断中心，确认存在“权限请求队列”区域。
10. 当队列为空时，区域显示没有 App Server permission、approval 或 elicitation 请求；当存在 pending 请求时，表格展示 ID、方法、类型和等待时间。

#### Expected Results
- 诊断中心能直接看到 pending server request 数量，不需要查看日志或 Network payload。
- pending 请求会让整体诊断状态进入 warning。
- UI 仅展示服务端输出的脱敏字段，不显示原始 prompt、文件路径 payload、工具参数或凭据。
- 服务端会按 permission、approval、elicitation、tool 做粗分类并输出 `pendingByKind`；未知方法显示为普通请求。
- 兼容字段 `pendingServerRequests` 继续返回脱敏列表；诊断中心优先读取 `serverRequestDiagnostics.pendingRequests`。
- 原始 `/codex-api/server-requests/pending` 继续服务审批 UI，不被改成脱敏诊断响应。
- 不影响现有恢复队列、未知通知、未知状态和 schema audit 展示。

#### Rollback/Cleanup Notes
- 如需回滚，撤销 `src/server/serverRequestDiagnostics.ts`、`src/server/codexAppServerBridge.ts`、`src/components/content/DiagnosticsPanel.vue`、`scripts/server-module-smoke.ts`、`docs/app-server-protocol-matrix.zh-CN.md`、`docs/changelog.zh-CN.md` 和本节测试记录中的相关改动。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`，覆盖 pending server request 分类、脱敏输出不含 `params`、快照总数和按类型计数。
- 2026-07-03 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-03 CJS 启动烟测：`node dist-cli\index.js --help` 通过，输出 `CX-Codex Web bridge for Codex app-server`。
- 2026-07-03 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 whitespace、package parse、governance docs、构建、server module smoke 和 CLI smoke。

---

### Feature: OpenAI diarize 转写响应格式对齐

#### Prerequisites
- 当前仓库包含 `src/server/transcriptionProxy.ts`。
- 本机可访问 OpenAI 官方 Speech to text 文档：`https://developers.openai.com/api/docs/guides/speech-to-text`。
- 如需真实 API 验证，配置 `CX_CODEX_OPENAI_API_KEY` 或 `OPENAI_API_KEY`；不要把真实 key 写入仓库、日志或截图。

#### Steps
1. 打开官方 Speech to text 文档，确认 `gpt-4o-transcribe` / `gpt-4o-mini-transcribe` 支持 `json` 或 `text`，`gpt-4o-transcribe-diarize` 使用 `diarized_json`，长音频需要 `chunking_strategy` 且推荐 `auto`。
2. 执行 `git diff --check`。
3. 执行 `npm.cmd run verify:server-modules`。
4. 执行 `npm.cmd run verify:governance`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
6. 设置 `CX_CODEX_OPENAI_TRANSCRIBE_MODEL=gpt-4o-transcribe-diarize` 后请求 `/codex-api/diagnostics`，确认 `data.transcription.responseFormat` 为 `diarized_json`。
7. 构造自带 `model=whisper-1`、`response_format=text` 和 `chunking_strategy=manual` 的 multipart 请求，确认服务端转发前会按配置覆盖为 `gpt-4o-transcribe-diarize`、`diarized_json` 和 `chunking_strategy=auto`。
8. 前端收到 diarized JSON 且只有 `segments[].text` 时，确认语音输入能拼接段落文本并写入 composer。

#### Expected Results
- 默认模型仍为 `gpt-4o-transcribe`，默认响应格式仍为 `json`。
- `gpt-4o-mini-transcribe` 仍使用 `json`，不改变既有语音输入链路。
- `gpt-4o-transcribe-diarize` 使用官方要求的 `diarized_json`，并补齐官方推荐的 `chunking_strategy=auto`，不会被固定覆盖成 `json`。
- 诊断接口只展示 provider、模型、响应格式、上传上限和 endpoint host/path，不展示 API key、Authorization、Cookie 或 URL query。
- OpenAI API 仍只作为语音转写补充能力，不替代 Codex App Server 的线程、审批、恢复和事件协议。

#### Rollback/Cleanup Notes
- 如需回滚，撤销 `src/server/transcriptionProxy.ts`、`src/composables/useDictation.ts`、`src/components/content/DiagnosticsPanel.vue`、`scripts/server-module-smoke.ts`、`scripts/verify-governance.ps1`、README、OpenAI 文档审查手册、协议兼容文档和本节测试记录中的相关改动。

#### Regression Evidence
- 2026-07-04 官方文档核对：确认 `https://developers.openai.com/api/docs/guides/speech-to-text` 中 `/v1/audio/transcriptions` 示例使用 `gpt-4o-transcribe`；文档说明 `gpt-4o-transcribe` / `gpt-4o-mini-transcribe` 支持 `json` 或 `text`，`gpt-4o-transcribe-diarize` 使用 `diarized_json`，长音频需要 `chunking_strategy` 且推荐 `auto`。
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`，覆盖默认 `json`、`gpt-4o-mini-transcribe` 的 `json`、非 diarize 清理 `chunking_strategy` 和 `gpt-4o-transcribe-diarize` 的 `diarized_json` / `chunking_strategy=auto` multipart 规范化。
- 2026-07-04 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-04 CLI 启动烟测：`node dist-cli\index.js --help` 通过，输出 `CX-Codex Web bridge for Codex app-server`。
- 2026-07-04 Governance / release gate：`pwsh -NoLogo -NoProfile -Command "Write-Output ok"` 在本机执行层无输出并持续挂起，因此 `npm.cmd run verify:governance` 和 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 本轮未能可靠完成；代码路径已由 server smoke、前端 typecheck/build 和 CLI smoke 覆盖。

---

### Feature: OpenAI 转写上传上限与 diarize chunking 对齐

#### Prerequisites
- 当前仓库包含 `src/server/transcriptionProxy.ts`、`scripts/server-module-smoke.ts`、`README.md`、`docs/protocol-compatibility.zh-CN.md`、`docs/openai-docs-review.zh-CN.md` 和诊断页。
- 本机可访问 OpenAI 官方 Speech to text 文档：`https://developers.openai.com/api/docs/guides/speech-to-text`。
- 本机可运行 server smoke、`vue-tsc`、`vite build`、`tsup`、governance 和 release gate。

#### Steps
1. 打开官方 Speech to text 文档，确认 `/v1/audio/transcriptions` 使用 multipart，`gpt-4o-transcribe-diarize` 使用 `diarized_json`，长音频需要 `chunking_strategy` 且推荐 `auto`，文件上传限制为 25 MB。
2. 执行 `git diff --check`。
3. 执行 `npm.cmd run verify:server-modules`。
4. 执行 `npm.cmd run build`。
5. 执行 `npm.cmd run verify:governance`。
6. 执行 `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipCliSmoke -SkipPackageSmoke -SchemaAudit skip`。
7. 代码审查 `prepareOpenAiTranscribeBody()`，确认普通模型清理客户端自带 `chunking_strategy`，diarize 模型写入 `chunking_strategy=auto`。
8. 代码审查 `getTranscribeRequestBodyLimitBytes()` 和诊断快照，确认默认上限为 `25000000` bytes，诊断页按 MiB 展示约 `23.8 MiB`。
9. 代码审查 `README.md` 和 `docs/protocol-compatibility.zh-CN.md`，确认公开说明包含三层 OpenAI 转写环境变量、25 MB / `25000000` bytes、`chunking_strategy=auto`、HTTP(S) endpoint 回退、endpoint 配置/有效性布尔值和不展示原始非法 URL。

#### Expected Results
- 默认转写模型仍为 `gpt-4o-transcribe`，响应格式仍为 `json`。
- `gpt-4o-mini-transcribe` 不携带 diarize-only 的 `chunking_strategy`。
- `gpt-4o-transcribe-diarize` 的 multipart 请求包含 `response_format=diarized_json` 和 `chunking_strategy=auto`。
- 服务端默认上传上限不高于官方 25 MB 文件限制，避免把明显过大的音频继续代理到 OpenAI。
- 诊断快照仍不展示 API key、Authorization、Cookie、URL query 或原始非法 URL。
- README 公开说明完整列出 `CX_CODEX_`、`CODEXUI_` 和裸 OpenAI 转写环境变量前缀，与服务端 `readTranscribeEnv()` 解析顺序一致。
- README 与协议兼容文档描述和实现一致，不再保留旧的 multipart 开销预留口径。
- `verify:governance` 会阻止 README 或协议边界文档遗漏 `CODEXUI_` 转写变量、`chunking_strategy=auto`、`25000000`、endpoint 配置/有效性布尔值或原始非法 URL 脱敏约束。

#### Rollback/Cleanup Notes
- 如需回滚，恢复 `src/server/transcriptionProxy.ts` 的旧上传上限和 multipart 字段规范化逻辑，并撤销 `scripts/server-module-smoke.ts`、`src/components/content/DiagnosticsPanel.vue`、`README.md`、`docs/protocol-compatibility.zh-CN.md`、`docs/changelog.zh-CN.md`、`docs/openai-docs-review.zh-CN.md` 和本测试章节中的相关改动。
- 如验证时临时设置过 `CX_CODEX_OPENAI_TRANSCRIBE_MODEL`、`CODEXUI_OPENAI_TRANSCRIBE_MODEL`、`CX_CODEX_OPENAI_TRANSCRIBE_MAX_BYTES`、`CODEXUI_OPENAI_TRANSCRIBE_MAX_BYTES` 或 OpenAI API key，验证后清理本机环境变量。

#### Regression Evidence
- 2026-07-04 官方文档核对：确认 `https://developers.openai.com/api/docs/guides/speech-to-text` 说明文件上传限制为 25 MB；`gpt-4o-transcribe` / `gpt-4o-mini-transcribe` 支持 `json` 或 `text`；`gpt-4o-transcribe-diarize` 使用 `diarized_json`，长音频需要 `chunking_strategy` 且推荐 `auto`。
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`，覆盖默认上传上限 `25000000` bytes、非 diarize 清理 `chunking_strategy` 和 diarize 写入 `chunking_strategy=auto`。
- 2026-07-04 README / 协议文档收口：`README.md` 和 `docs/protocol-compatibility.zh-CN.md` 已同步记录三层 OpenAI 转写环境变量、25 MB / `25000000` bytes、`chunking_strategy=auto`、HTTP(S) endpoint 回退、endpoint 配置/有效性布尔值和原始非法 URL 脱敏约束。
- 2026-07-04 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-04 Governance 验证：`npm.cmd run verify:governance` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Governance 自检验证：`scripts/verify-governance.ps1` 已要求自身保留 `Assert-ContentExcludes "tests.md"`、`unfinished placeholder text` 和占位符阻断文案。
- 2026-07-04 Release gate 快速路径：`npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipPackageSmoke -SchemaAudit skip` 通过，覆盖 whitespace、package parse、governance docs、server module smoke、CLI smoke 和 CLI CJS launcher smoke。

---

### Feature: 语音转写路由模块化

#### Prerequisites
- 当前仓库包含 `src/server/codexAppServerBridge.ts`、`src/server/transcriptionRoute.ts`、`src/server/transcriptionProxy.ts` 和 `scripts/server-module-smoke.ts`。
- 本机可运行 `npm.cmd run verify:server-modules`、`npm.cmd run build`、`npm.cmd run verify:governance` 和 release gate。

#### Steps
1. 代码审查 `src/server/codexAppServerBridge.ts`，确认 `/codex-api/transcribe` 分支只调用 `handleTranscriptionRoutes(req, res, url)`，不再内联 route path/method 判断或 OpenAI/ChatGPT 转写代理细节。
2. 代码审查 `src/server/transcriptionRoute.ts`，确认 `handleTranscriptionRoutes()` 只处理 `POST /codex-api/transcribe`，并把请求转交给 `handleTranscriptionRoute()`。
3. 代码审查 `src/server/transcriptionRoute.ts`，确认 `handleTranscriptionRoute()` 保留原有行为：读取 body 上限、读取 content-type、优先 OpenAI API key、无 key 时读取 Codex auth 并走 ChatGPT 回退。
4. 执行 `git diff --check`。
5. 执行 `npm.cmd run verify:server-modules`。
6. 执行 `node_modules\.bin\vue-tsc.cmd --noEmit`。
7. 执行 `node_modules\.bin\vite.cmd build`。
8. 执行 `node_modules\.bin\tsup.cmd`。
9. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`。
10. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`。
11. 代码审查 `scripts/verify-release.ps1` 和 `scripts/verify-governance.ps1`，确认 release package smoke 会检查 `src\server\transcriptionRoute.ts`，且 governance 会保护该检查不被误删。

#### Expected Results
- bridge 主文件不再直接 import `getOpenAiTranscribeApiKey`、`getTranscribeRequestBodyLimitBytes`、`proxyOpenAiTranscribe`、`proxyChatGptTranscribe` 或 `readCodexAuth`。
- `handleTranscriptionRoutes()` 对 `POST /codex-api/transcribe` 返回 `true`，对非 POST 或非目标 path 返回 `false`，不会吞掉后续路由。
- 未配置 OpenAI API key 且没有 Codex auth 时，route smoke 返回 `401 No auth token available for transcription`。
- 超过转写请求体上限时，route smoke 返回 `413` 且包含最大请求体大小。
- 通用 bridge 错误处理仍保留 `RequestBodyTooLargeError`，不影响其它 JSON/file upload 路由。
- Release package smoke 会在 zip 缺少 `src\server\transcriptionRoute.ts` 时失败，避免源码包遗漏新抽出的转写路由模块。

#### Rollback/Cleanup Notes
- 如需回滚，删除 `src/server/transcriptionRoute.ts`，把 `handleTranscriptionRoute()` 的逻辑恢复到 `src/server/codexAppServerBridge.ts` 的 `/codex-api/transcribe` 分支，并撤销 `scripts/server-module-smoke.ts`、`docs/changelog.zh-CN.md` 和本测试章节中的相关改动。
- 验证不需要真实 OpenAI API key；route smoke 使用临时 `CODEX_HOME` 和环境变量隔离。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`，覆盖 `handleTranscriptionRoute()` 的无 auth `401` 和超限 `413` 分支，以及 `handleTranscriptionRoutes()` 的 POST 命中和 GET 放行分支。
- 2026-07-04 构建验证：`node_modules\.bin\vue-tsc.cmd --noEmit`、`node_modules\.bin\vite.cmd build` 和 `node_modules\.bin\tsup.cmd` 通过。
- 2026-07-04 Governance 验证：`node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release package smoke：`node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` 通过，覆盖 whitespace、package parse、governance docs、server module smoke、CLI smoke、CLI CJS launcher smoke、Release package smoke、artifact checksum smoke 和 NPM package smoke；zip 必检清单包含 `src\server\transcriptionRoute.ts`。

---

### Feature: OpenAI 转写自定义 endpoint 安全回退

#### Prerequisites
- 当前仓库包含 `src/server/transcriptionProxy.ts`、`src/components/content/DiagnosticsPanel.vue` 和 `scripts/server-module-smoke.ts`。
- 本机可运行 `npm.cmd run verify:server-modules`、`npm.cmd run build`、`npm.cmd run verify:governance` 和 release gate 快速路径。

#### Steps
1. 代码审查 `resolveOpenAiTranscribeEndpoint()`，确认未配置 endpoint 时使用 `https://api.openai.com/v1/audio/transcriptions`。
2. 设置合法 `CX_CODEX_OPENAI_TRANSCRIBE_URL=https://audio.example.test/v1/audio/transcriptions?token=secret`，执行 server smoke，确认诊断快照只保留 `host=audio.example.test`、`path=/v1/audio/transcriptions`、`configured=true` 和 `valid=true`。
3. 设置非法或非 HTTP(S) endpoint，例如 `file:///tmp/audio`，执行 server smoke，确认代理回退默认 OpenAI endpoint，诊断快照为 `configured=true`、`valid=false`，且不保留原始非法 URL。
4. 执行 `git diff --check`。
5. 执行 `npm.cmd run verify:server-modules`。
6. 执行 `npm.cmd run build`。
7. 执行 `npm.cmd run verify:governance`。
8. 执行 `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipPackageSmoke -SchemaAudit skip`。

#### Expected Results
- 合法 `http` / `https` 自定义 endpoint 仍可用于本机代理或测试服务。
- 非法 URL、`file:`、`ftp:` 等非 HTTP(S) endpoint 不会传给上游请求层，统一回退官方默认 endpoint。
- 诊断页 endpoint 标签对非法自定义配置显示“自定义无效，已回退”，且仍只展示生效 host/path。
- 诊断 JSON 不展示 API key、Authorization、Cookie、URL query 或原始非法 URL。

#### Rollback/Cleanup Notes
- 如需回滚，恢复 `src/server/transcriptionProxy.ts` 直接读取 `OPENAI_TRANSCRIBE_URL` 的旧逻辑，并撤销诊断页 endpoint 字段、server smoke、changelog、OpenAI 文档审查手册和本测试章节中的相关改动。
- 验证后清理临时设置的 `CX_CODEX_OPENAI_TRANSCRIBE_URL`、`OPENAI_TRANSCRIBE_URL` 或 `CODEXUI_OPENAI_TRANSCRIBE_URL`。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`，覆盖合法自定义 endpoint 脱敏快照和非 HTTP(S) endpoint 回退默认 OpenAI endpoint。
- 2026-07-04 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-04 Governance 验证：`npm.cmd run verify:governance` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate 快速路径：`npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipPackageSmoke -SchemaAudit skip` 通过，覆盖 whitespace、package parse、governance docs、server module smoke、CLI smoke 和 CLI CJS launcher smoke。

---

### Feature: 测试证据占位符治理门禁

#### Prerequisites
- 当前仓库包含 `tests.md`、`scripts/verify-governance.ps1` 和 `scripts/verify-release.ps1`。
- 本机可运行 `npm.cmd run verify:governance` 和 release gate 快速路径。

#### Steps
1. 检查 `scripts/verify-governance.ps1`，确认 `Assert-ContentExcludes "tests.md"` 覆盖未完成测试证据占位文本。
2. 检查 `scripts/verify-governance.ps1`，确认 governance 自检会要求自身保留 `Assert-ContentExcludes` 和占位符阻断文案。
3. 执行 `git diff --check`。
4. 执行 `npm.cmd run verify:governance`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipPackageSmoke -SchemaAudit skip`。
6. 搜索 `tests.md`，确认不存在 governance 脚本列出的三类未完成测试证据占位文本。

#### Expected Results
- `verify:governance` 会在 `tests.md` 残留未完成测试证据占位文本时失败。
- `verify:governance` 会自检 `Assert-ContentExcludes "tests.md"`，避免占位符阻断逻辑被无声删除。
- `verify:release` 默认调用 governance check，因此发布前也会阻止不完整测试记录。
- 当前 `tests.md` 不包含未完成测试证据占位文本。

#### Rollback/Cleanup Notes
- 如需回滚，删除 `scripts/verify-governance.ps1` 中的 `Assert-ContentExcludes` 函数和针对 `tests.md` 的调用，并撤销 `docs/changelog.zh-CN.md` 与本测试章节。

#### Regression Evidence
- 2026-07-04 负向验证：首次执行 `npm.cmd run verify:governance` 时，因 `tests.md` 残留被阻断的未完成证据占位文本而失败，输出 `tests.md contains unfinished placeholder text`；随后已移除误伤文本。
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 占位符搜索：分别执行 `rg -n` 检查 governance 脚本列出的三类未完成测试证据占位文本，均无命中。
- 2026-07-04 Governance 验证：`npm.cmd run verify:governance` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate 快速路径：`npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipPackageSmoke -SchemaAudit skip` 通过，覆盖 whitespace、package parse、governance docs、server module smoke、CLI smoke 和 CLI CJS launcher smoke。

---

### Feature: OpenAI 官方文档审查手册治理门禁

#### Prerequisites
- 当前仓库包含 `docs/openai-docs-review.zh-CN.md` 和 `scripts/verify-governance.ps1`。
- 本机可运行 OpenAI docs skill 的 Codex manual helper。
- 本机可运行 `npm.cmd run verify:governance` 和 release gate 快速路径。

#### Steps
1. 执行 `node %USERPROFILE%\.codex\skills\.system\openai-docs\scripts\fetch-codex-manual.mjs`，确认官方 Codex manual 可刷新或已为 current。
2. 审查 `docs/openai-docs-review.zh-CN.md`，确认包含最近审查时间、官方来源清单、Codex manual helper 命令、必查主题、审查流程和当前审查结论。
3. 审查 `scripts/verify-governance.ps1`，确认 governance 会校验 `docs/openai-docs-review.zh-CN.md` 中的官方来源 URL、manual helper、`experimentalApi`、auto-review、安全边界、speech-to-text 转写约束和“不能直接声明已经对齐最新 App Server 协议”的结论。
4. 执行 `git diff --check`。
5. 执行 `npm.cmd run verify:governance`。
6. 执行 `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipPackageSmoke -SchemaAudit skip`。

#### Expected Results
- 官方文档审查手册不会只剩链接列表；必须保留审查时间、刷新入口、来源范围、执行流程和当前结论。
- governance 会阻止误删 Codex App Server、Agent approvals/security、Remote connections、Codex open source boundary、Codex access tokens 和 OpenAI speech-to-text 等官方入口。
- governance 会阻止误删 `gpt-4o-transcribe-diarize`、`diarized_json`、`chunking_strategy=auto`、`25 MB`、非法 endpoint 回退和不展示原始非法 URL 等语音转写约束。
- governance 会阻止把 `experimentalApi`、auto-review 或 schema drift 状态描述成默认稳定或完全对齐。

#### Rollback/Cleanup Notes
- 如需回滚，撤销 `scripts/verify-governance.ps1` 中针对 `docs/openai-docs-review.zh-CN.md` 的新增必需文本，并撤销 `docs/changelog.zh-CN.md` 和本测试章节。

#### Regression Evidence
- 2026-07-04 官方文档刷新：`node %USERPROFILE%\.codex\skills\.system\openai-docs\scripts\fetch-codex-manual.mjs` 通过，输出 `Manual status: local manual was already current.`。
- 2026-07-04 官方 speech-to-text 核对：官方文档显示 `gpt-4o-transcribe`、`gpt-4o-mini-transcribe` 和 `gpt-4o-transcribe-diarize`，文件上传限制为 `25 MB`，diarize 支持 `diarized_json`，并要求长音频使用 `chunking_strategy`，推荐 `auto`。
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Governance 验证：`npm.cmd run verify:governance` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate 快速路径：`npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipPackageSmoke -SchemaAudit skip` 通过，覆盖 whitespace、package parse、governance docs、server module smoke、CLI smoke 和 CLI CJS launcher smoke；Release package smoke、artifact checksum smoke 和 NPM package smoke 按命令显式跳过。

---

### Feature: PowerShell 验证入口自动回退

#### Prerequisites
- 当前仓库包含 `scripts/run-powershell-script.mjs`。
- 当前仓库包含 `scripts/verify-governance.ps1`、`scripts/verify-release.ps1` 和 `scripts/verify-release-artifacts.ps1`。
- 本机至少存在一个可用 PowerShell 命令，例如 Windows PowerShell `powershell.exe` 或 PowerShell 7 `pwsh`。

#### Steps
1. 执行 `node scripts/run-powershell-script.mjs scripts/verify-governance.ps1`，确认会先探测 PowerShell，然后运行治理检查。
2. 执行 `npm.cmd run verify:governance`，确认 npm 入口走同一个运行器。
3. 执行 `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipCliSmoke -SkipPackageSmoke -SchemaAudit skip`，确认 release gate 的快速路径可完成。
4. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`，确认完整 release gate 可完成。
5. 检查 `scripts/verify-release.ps1`，确认内部调用治理检查、打包 smoke 和 schema audit 时优先复用 `CX_CODEX_POWERSHELL_COMMAND`。
6. 检查 `.github/PULL_REQUEST_TEMPLATE.md`，确认不再把本地验证硬绑定为必须使用 `pwsh`。

#### Expected Results
- `scripts/run-powershell-script.mjs` 会用 5 秒超时探测候选 PowerShell；`pwsh` 不可用、失败或挂起时会尝试下一个候选。
- 选中的 PowerShell 会通过 `CX_CODEX_POWERSHELL_COMMAND` 传给 `verify-release.ps1`，避免 release gate 内部重新选择挂起的 `pwsh`。
- `verify:governance`、`verify:release` 和 `verify:release-artifacts` npm 脚本都走同一个运行器。
- CI / Release workflow 仍可直接使用 GitHub runner 的 `pwsh` 调用 `.ps1` 脚本；本地 npm 脚本获得更稳的 Windows 回退能力。

#### Rollback/Cleanup Notes
- 如需回滚，删除 `scripts/run-powershell-script.mjs`，恢复 `package.json` 中三个验证脚本为直接 `pwsh` 调用，并撤销 `scripts/verify-release.ps1`、`scripts/verify-governance.ps1`、`.github/PULL_REQUEST_TEMPLATE.md`、`docs/changelog.zh-CN.md` 和本节测试记录中的相关改动。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 运行器直连治理检查：`node scripts\run-powershell-script.mjs scripts\verify-governance.ps1` 通过，输出 `Using PowerShell: powershell.exe (5.1.26100.8655)` 和 `Governance docs check passed.`。
- 2026-07-04 npm 治理入口：`npm.cmd run verify:governance` 通过，同样自动回退到 `powershell.exe`；仅出现 npm 本机 update config 权限提示，不影响验证结果。
- 2026-07-04 Release gate 快速路径：`npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipCliSmoke -SkipPackageSmoke -SchemaAudit skip` 通过，覆盖 whitespace、package parse、governance docs 和 server module smoke；server smoke 仍输出预期的合成 slow RPC / queue warning。
- 2026-07-04 完整 Release gate：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 `vue-tsc --noEmit`、`vite build`、`tsup`、server module smoke、CLI help smoke、CLI CJS launcher smoke 和 release package smoke；Vite 仍有既有 large chunk warning，schema audit 按命令跳过。

---

### Feature: 本地 npm PowerShell 入口统一回退

#### Prerequisites
- 当前仓库包含 `scripts/run-powershell-script.mjs`。
- 当前仓库的 `package.json` 包含 `package:release`、`setup:windows`、`test:7420`、`test:7420:frontend`、`test:7420:soak`、`audit:app-server-schemas`、`verify:governance`、`verify:release` 和 `verify:release-artifacts`。
- 本机至少存在一个可用 PowerShell 命令，例如 Windows PowerShell `powershell.exe` 或 PowerShell 7 `pwsh`。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:governance`，确认治理门禁校验所有本地 npm PowerShell 入口都走统一运行器。
3. 执行 `npm.cmd run package:release -- -Version local-wrapper-smoke -OutputDir output\package-wrapper-smoke`。
4. 执行 `npm.cmd run verify:release-artifacts -- -OutputDir output\package-wrapper-smoke`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipCliSmoke -SkipPackageSmoke -SchemaAudit skip`。
6. 检查 `RELEASE.md`，确认本地 release 验证说明不再写死必须使用 `pwsh`。

#### Expected Results
- `package:release`、`setup:windows`、`test:7420*`、`audit:app-server-schemas` 和 release 验证脚本都通过 `node ./scripts/run-powershell-script.mjs` 启动。
- 本地 npm 脚本会先探测 `pwsh`，不可用、失败或挂起时回退到 Windows PowerShell。
- release 打包 smoke 会生成 zip 和 `.sha256`，checksum 验证通过。
- CI / Release workflow 仍可直接使用 runner 的 `pwsh` 调用 `.ps1` 脚本。

#### Rollback/Cleanup Notes
- 如需回滚，恢复 `package.json` 中相关 npm 脚本为直接 PowerShell 调用，并撤销 `scripts/verify-governance.ps1`、`RELEASE.md`、`docs/changelog.zh-CN.md` 和本节测试记录。
- 验证后可删除 `output\package-wrapper-smoke`。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 治理门禁：`npm.cmd run verify:governance` 通过，输出 `Using PowerShell: powershell.exe (5.1.26100.8655)` 和 `Governance docs check passed.`，并校验所有本地 npm PowerShell 入口都走统一运行器。
- 2026-07-04 打包入口 smoke：`npm.cmd run package:release -- -Version local-wrapper-smoke -OutputDir output\package-wrapper-smoke` 通过，生成 `CX-Codex-local-wrapper-smoke.zip` 和 `.sha256`；运行器自动回退到 `powershell.exe`。
- 2026-07-04 Release artifact checksum：`npm.cmd run verify:release-artifacts -- -OutputDir output\package-wrapper-smoke` 通过，输出 `checksum ok: CX-Codex-local-wrapper-smoke.zip` 和 `Release artifact checksum verification passed.`。
- 2026-07-04 Release gate 快速路径：`npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipCliSmoke -SkipPackageSmoke -SchemaAudit skip` 通过，覆盖 whitespace、package parse、governance docs 和 server module smoke；server smoke 仍输出预期的合成 slow RPC / queue warning。
- 2026-07-04 Cleanup：已删除验证产物目录 `output\package-wrapper-smoke`；npm 本机 update config 权限提示为非阻塞环境提示。

---

### Feature: App Server schema audit 脱敏摘要更新

#### Prerequisites
- 当前仓库包含 `scripts/update-app-server-schema-audit-summary.mjs`。
- 本机已经有至少一次 raw schema audit 输出，例如 `output\app-server-schema-audit\20260703-193751\audit-summary.json`。
- 不要把 `output\app-server-schema-audit\` 下的原始生成目录提交到仓库。

#### Steps
1. 执行 `node --check scripts\update-app-server-schema-audit-summary.mjs`。
2. 执行 `npm.cmd run audit:app-server-schemas:update-summary -- --input output\app-server-schema-audit\20260703-193751\audit-summary.json --output output\schema-summary-smoke.json`。
3. 检查 `output\schema-summary-smoke.json`，确认 `repository`、`generated`、本机绝对路径和完整 added/removed 列表不会进入摘要。
4. 执行 `npm.cmd run verify:governance`，确认治理门禁校验该脚本和 npm 入口。
5. 执行 `git diff --check`。
6. 验证结束后删除 `output\schema-summary-smoke.json`。

#### Expected Results
- 脚本能从 raw `audit-summary.json` 生成可提交摘要。
- 输出摘要只保留官方文档 URL、规范化审计命令、相对路径、计数和 `representativeAdded` / `representativeRemoved`。
- 输出摘要不包含本机绝对路径、完整 schema 生成目录、完整 added/removed 大列表或私有信息。
- 治理门禁会阻止脚本、npm 入口或摘要更新规则丢失。

#### Rollback/Cleanup Notes
- 如需回滚，删除 `scripts/update-app-server-schema-audit-summary.mjs`，移除 `package.json` 的 `audit:app-server-schemas:update-summary`，并撤销协议矩阵、依赖维护手册、changelog、governance 和本节测试记录。
- 删除 smoke 输出：`output\schema-summary-smoke.json`。

#### Regression Evidence
- 2026-07-04 语法检查：`node --check scripts\update-app-server-schema-audit-summary.mjs` 通过。
- 2026-07-04 摘要 smoke：`npm.cmd run audit:app-server-schemas:update-summary -- --input output\app-server-schema-audit\20260703-193751\audit-summary.json --output output\schema-summary-smoke.json` 通过，输出 `Schema audit summary updated: output\schema-summary-smoke.json` 和 `Review status: drift-recorded`。
- 2026-07-04 脱敏检查：`output\schema-summary-smoke.json` 只包含相对路径、计数和 `representativeAdded` / `representativeRemoved`；`rg -n "E:" output\schema-summary-smoke.json`、`rg -n "repository|generated" output\schema-summary-smoke.json`、`findstr /n /c:"\"added\"" /c:"\"removed\"" output\schema-summary-smoke.json` 均无匹配。
- 2026-07-04 正式摘要保护：同一 raw audit 写入 `docs\app-server-schema-audit-summary.json` 后，`git diff -- docs\app-server-schema-audit-summary.json` 无输出，说明计数不变时保留现有人工代表项。
- 2026-07-04 治理门禁：`npm.cmd run verify:governance` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Release gate 快速路径：`npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipCliSmoke -SkipPackageSmoke -SchemaAudit skip` 通过，覆盖 whitespace、package parse、governance docs 和 server module smoke。

---

### Feature: schema audit 摘要脱敏治理门禁

#### Prerequisites
- 当前仓库包含 `docs/app-server-schema-audit-summary.json`。
- 当前仓库包含 `scripts/verify-governance.ps1`。
- 本机可运行 `npm.cmd run verify:governance`。

#### Steps
1. 执行 `npm.cmd run verify:governance`，确认当前摘要通过治理门禁。
2. 审查 `scripts/verify-governance.ps1`，确认门禁禁止摘要包含 raw audit 的 `repository`、`generated`、`comparison.*.added` 和 `comparison.*.removed` 字段。
3. 审查 `scripts/verify-governance.ps1`，确认 `auditOutput`、`baseline.typescript` 和 `baseline.json` 必须是相对仓库路径。
4. 审查 `scripts/verify-governance.ps1`，确认 `representativeAdded` 和 `representativeRemoved` 最多保留 3 个非空字符串。
5. 执行 `git diff --check`。
6. 执行 `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipCliSmoke -SkipPackageSmoke -SchemaAudit skip`。

#### Expected Results
- 未脱敏 raw audit 字段不会被允许进入已提交摘要。
- 本机绝对路径不会被允许进入 `docs/app-server-schema-audit-summary.json`。
- schema diff 代表项保持小列表，避免把完整 generated schema 名称集合提交为治理摘要。
- release 快速门禁继续通过。

#### Rollback/Cleanup Notes
- 如需回滚，撤销 `scripts/verify-governance.ps1` 中的 schema audit 脱敏校验、changelog 和本节测试记录。

#### Regression Evidence
- 2026-07-04 治理门禁：`npm.cmd run verify:governance` 通过，输出 `Using PowerShell: powershell.exe (5.1.26100.8655)` 和 `Governance docs check passed.`。
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Release gate 快速路径：`npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipCliSmoke -SkipPackageSmoke -SchemaAudit skip` 通过，覆盖 whitespace、package parse、governance docs 和 server module smoke；server smoke 仍输出预期的合成 slow RPC / queue warning。

---

### Feature: Web 登录请求体大小限制

#### Prerequisites
- 当前仓库包含 `src/server/authMiddleware.ts` 和 `src/server/httpBody.ts`。
- 本机可运行 `npm.cmd run verify:server-modules`、`npm.cmd run build` 和 release gate。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:server-modules`。
3. 执行 `npm.cmd run build`。
4. 执行 `npm.cmd run verify:governance`。
5. 执行 `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipCliSmoke -SkipPackageSmoke -SchemaAudit skip`。
6. 代码审查确认 `/auth/login` 通过 `readJsonBody()` 读取登录 JSON，不再手动累加无限制 body。
7. 代码审查确认默认登录请求体上限为 16KiB，并可通过 `CX_CODEX_AUTH_LOGIN_BODY_MAX_BYTES`、`CODEXUI_AUTH_LOGIN_BODY_MAX_BYTES` 或 `AUTH_LOGIN_BODY_MAX_BYTES` 覆盖。

#### Expected Results
- `readAuthLoginPassword()` 只返回字符串密码字段，非对象、数组或非字符串密码视为无效密码。
- 超过登录请求体上限时抛出 `RequestBodyTooLargeError`，中间件返回 `413` 和可读错误。
- JSON 格式错误返回 `400`，不会回显提交的密码、Cookie 或 token。
- 登录请求体大小限制记录在 changelog、安全硬化手册和本测试章节中。

#### Rollback/Cleanup Notes
- 如需回滚，撤销 `src/server/authMiddleware.ts`、`scripts/server-module-smoke.ts`、`docs/changelog.zh-CN.md`、`docs/security-hardening.zh-CN.md` 和本节测试记录中的相关改动。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`，覆盖登录请求体默认 16KiB、`CX_CODEX_AUTH_LOGIN_BODY_MAX_BYTES` 覆盖、密码字段解析和超限 `RequestBodyTooLargeError`。
- 2026-07-04 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建；Vite 仍有既有 large chunk warning。
- 2026-07-04 治理门禁：`npm.cmd run verify:governance` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate 快速路径：`npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipCliSmoke -SkipPackageSmoke -SchemaAudit skip` 通过，覆盖 whitespace、package parse、governance docs 和 server module smoke；server smoke 仍输出预期的合成 slow RPC / queue warning。

---

### Feature: App Server Auto-review 审批复核通知脱敏诊断

#### Prerequisites
- 当前仓库包含 `src/server/appServerNotificationDiagnostics.ts`、`src/components/content/DiagnosticsPanel.vue` 和最近 raw schema audit 输出 `output\app-server-schema-audit\20260703-193751`。
- 本机 raw schema audit 已确认 `item/autoApprovalReview/started` 与 `item/autoApprovalReview/completed` 为 App Server notification methods，且 `GuardianApprovalReview` 与对应 notification payload 标注 `[UNSTABLE]`。
- 官方 Codex manual 已确认 auto-review 是审批边界上的 reviewer swap，不扩大 sandbox、network 或 filesystem 权限。

#### Steps
1. 执行官方 manual helper：`node %USERPROFILE%\.codex\skills\.system\openai-docs\scripts\fetch-codex-manual.mjs`。
2. 检查 raw schema audit，确认 `GuardianApprovalReviewAction` 中的 command、cwd、network target、request permission reason 和 review rationale 属于不能进入诊断快照的敏感 payload。
3. 执行 `git diff --check`。
4. 执行 `npm.cmd run verify:server-modules`。
5. 执行 `npm.cmd run build`。
6. 执行 `npm.cmd run verify:governance`。
7. 执行 `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipCliSmoke -SkipPackageSmoke -SchemaAudit skip`。

#### Expected Results
- 服务端 notification diagnostics 把 `item/autoApprovalReview/started` 与 `item/autoApprovalReview/completed` 视为已知不稳定通知，不计入 unknown notification。
- `/codex-api/health` 和 `/codex-api/diagnostics` 的 `notificationDiagnostics.recentGuardianReviewNotifications` 只包含 method、时间、threadId、turnId、reviewId、targetItemId、status、riskLevel、userAuthorization、actionType、decisionSource、durationMs、hasRationale 和少量计数字段。
- command、cwd、本机路径、network host/target、request permission reason 和 rationale 不会出现在诊断 JSON、诊断中心或测试快照中；独立 `networkAccess` action 会被标记为网络权限请求，独立 `applyPatch` action 会被标记为文件系统权限请求且只记录文件数量。
- 诊断中心展示 “Auto-review” 卡片；只读展示自动审批复核生命周期，不审批、不拒绝、不覆盖现有 permission policy。

#### Rollback/Cleanup Notes
- 如需回滚，撤销 `src/server/appServerNotificationDiagnostics.ts`、`src/components/content/DiagnosticsPanel.vue`、`scripts/server-module-smoke.ts`、`docs/app-server-protocol-matrix.zh-CN.md`、`docs/changelog.zh-CN.md` 和本节测试记录中的相关改动。

---

### Feature: App Server session store cleanup 模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerSessionCleanup.ts` 和 `src/server/codexAppServerBridge.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 pending server requests、shared RPC reads、thread list cache、thread token usage 和 plan mode turn store 的清理顺序。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `node scripts\verify-server-modules.mjs`。
3. 执行 `node_modules\.bin\vue-tsc.cmd --noEmit`。
4. 执行 `node_modules\.bin\vite.cmd build`。
5. 执行 `node_modules\.bin\tsup.cmd`。
6. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`。
7. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`。
8. 代码审查确认 `src/server/codexAppServerBridge.ts` 的 process error、exit、restart 和 dispose 路径均通过 `clearSessionStores()` 清理 session stores。

#### Expected Results
- App Server session store cleanup 集中在 `src/server/appServerSessionCleanup.ts`。
- process error、unexpected exit、restart 和 dispose 仍清理 pending server requests、shared reads、thread list cache、thread token usage 和 plan mode turn store。
- pending RPC reject、queued RPC reject、process 标志重置和 stdout line buffer 清理顺序保持在 bridge 主类内，不被 helper 隐藏。
- server module smoke、构建、治理门禁和 release gate 均通过。

#### Rollback/Cleanup Notes
- 如需回滚，删除 `src/server/appServerSessionCleanup.ts`，撤销 `scripts/server-module-smoke.ts` 中的 session cleanup smoke，并把 store 清理调用恢复到 `src/server/codexAppServerBridge.ts` 的 process error、exit、restart 和 dispose 路径。

---

### Feature: App Server process termination 模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerProcessTermination.ts` 和 `src/server/codexAppServerBridge.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 stdin close、SIGTERM、延迟 SIGKILL、timer unref 和已 killed 进程不再强制 kill。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `node scripts\verify-server-modules.mjs`。
3. 执行 `node_modules\.bin\vue-tsc.cmd --noEmit`。
4. 执行 `node_modules\.bin\vite.cmd build`。
5. 执行 `node_modules\.bin\tsup.cmd`。
6. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`。
7. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`。
8. 代码审查确认 `src/server/codexAppServerBridge.ts` 的 restart 和 dispose 路径均通过 `terminateAppServerProcess()` 关闭当前 app-server process。

#### Expected Results
- app-server process 终止细节集中在 `src/server/appServerProcessTermination.ts`。
- restart 和 dispose 仍先完成 bridge 状态重置、pending RPC reject、queued RPC reject 和 session store 清理，再终止进程。
- 进程终止仍按原顺序执行 `stdin.end()`、`SIGTERM`、1500ms 后按需 `SIGKILL`，并保留 timer `unref()` 行为。
- server module smoke、构建、治理门禁和 release gate 均通过。

#### Rollback/Cleanup Notes
- 如需回滚，删除 `src/server/appServerProcessTermination.ts`，撤销 `scripts/server-module-smoke.ts` 中的 process termination smoke，并把 `stdin.end()`、`SIGTERM`、延迟 `SIGKILL` 逻辑恢复到 `src/server/codexAppServerBridge.ts` 的 restart 和 dispose 路径。

---

### Feature: App Server server request immediate policy 模块化

#### Prerequisites
- 当前仓库包含 `src/server/serverRequestPolicy.ts` 和 `src/server/codexAppServerBridge.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 queue policy、auto-approve policy 和 reject-unsupported policy 的 immediate-resolution 判断。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `node scripts\verify-server-modules.mjs`。
3. 执行 `node_modules\.bin\vue-tsc.cmd --noEmit`。
4. 执行 `node_modules\.bin\vite.cmd build`。
5. 执行 `node_modules\.bin\tsup.cmd`。
6. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`。
7. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`。
8. 代码审查确认 `src/server/codexAppServerBridge.ts` 的 `handleServerRequest()` 仅对 immediate policy 统一回包并发出 `server/request/resolved`，queue policy 仍记录 pending request 并发出 `server/request`。

#### Expected Results
- server request policy 的 immediate-resolution 判断集中在 `src/server/serverRequestPolicy.ts`。
- plan-decline、auto-approve 和 reject-unsupported 仍自动回包并发出 `server/request/resolved`。
- reject-unsupported 仍额外写入脱敏 warning log。
- queue policy 仍保持人工处理路径，不被自动回包。
- server module smoke、构建、治理门禁和 release gate 均通过。

#### Rollback/Cleanup Notes
- 如需回滚，删除 `isImmediateServerRequestPolicyDecision()`，撤销 `scripts/server-module-smoke.ts` 中的 immediate policy 断言，并把 `src/server/codexAppServerBridge.ts` 的三个自动完成分支恢复为独立判断。

---

### Feature: App Server server/request/resolved notification 模块化

#### Prerequisites
- 当前仓库包含 `src/server/pendingServerRequests.ts` 和 `src/server/codexAppServerBridge.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 `server/request/resolved` notification 的 method、id、method、threadId、mode 和 resolvedAtIso 字段。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `node scripts\verify-server-modules.mjs`。
3. 执行 `node_modules\.bin\vue-tsc.cmd --noEmit`。
4. 执行 `node_modules\.bin\vite.cmd build`。
5. 执行 `node_modules\.bin\tsup.cmd`。
6. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`。
7. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`。
8. 代码审查确认 `src/server/codexAppServerBridge.ts` 的 automatic 和 manual server request resolution 均通过 `createServerRequestResolvedNotification()` 发出相同 payload。

#### Expected Results
- `server/request/resolved` notification payload 构造集中在 `src/server/pendingServerRequests.ts`。
- automatic 和 manual resolution 仍发出 `server/request/resolved`，包含 request id、request method、threadId、mode 和 resolvedAtIso。
- threadId 仍通过 bridge 当前的 `readServerRequestThreadId()` 读取，避免改变 payload 兼容性。
- server module smoke、构建、治理门禁和 release gate 均通过。

#### Rollback/Cleanup Notes
- 如需回滚，删除 `createServerRequestResolvedNotification()`，撤销 `scripts/server-module-smoke.ts` 中的 resolved notification 断言，并把 `src/server/codexAppServerBridge.ts` 的 `emitServerRequestResolved()` 恢复为内联 notification payload。

---

### Feature: App Server JSON-RPC line 分类模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerJsonRpcWire.ts` 和 `src/server/codexAppServerBridge.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 JSON-RPC response、notification、server request、非 pending response id 和非法 JSON line。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `node scripts\verify-server-modules.mjs`。
3. 执行 `node_modules\.bin\vue-tsc.cmd --noEmit`。
4. 执行 `node_modules\.bin\vite.cmd build`。
5. 执行 `node_modules\.bin\tsup.cmd`。
6. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`。
7. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`。
8. 代码审查确认 `src/server/codexAppServerBridge.ts` 的 `handleLine()` 只根据 `readAppServerJsonRpcLineEvent()` 的分类执行已有副作用。

#### Expected Results
- JSON-RPC line 解析和分类集中在 `src/server/appServerJsonRpcWire.ts`。
- pending response id 仍优先走 pending RPC finalize、slow RPC 记录和 resolve/reject。
- notification 仍先更新 notification-derived cache/runtime state，再广播给 listeners。
- server-initiated request 仍进入 `handleServerRequest()`；非法 JSON 和非 pending response id 被忽略。
- server module smoke、构建、治理门禁和 release gate 均通过。

#### Rollback/Cleanup Notes
- 如需回滚，从 `src/server/appServerJsonRpcWire.ts` 删除 `readAppServerJsonRpcLineEvent()`，撤销 `scripts/server-module-smoke.ts` 中的 line 分类断言，并把 `src/server/codexAppServerBridge.ts` 的 `handleLine()` 恢复为内联 JSON.parse 和分支判断。

---

### Feature: App Server RPC timeout recovery 模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerRpcTimeoutRecovery.ts` 和 `src/server/codexAppServerBridge.ts`。
- `scripts/server-module-smoke.ts` 已覆盖启动宽限、initialize 超时和重复超时重启三个分支。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `node scripts\verify-server-modules.mjs`。
3. 执行 `node_modules\.bin\vue-tsc.cmd --noEmit`。
4. 执行 `node_modules\.bin\vite.cmd build`。
5. 执行 `node_modules\.bin\tsup.cmd`。
6. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`。
7. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`。
8. 代码审查确认 `src/server/codexAppServerBridge.ts` 的 `noteRpcTimeout()` 只负责写启动宽限日志或调用 `restartAppServer()`，不再内联恢复决策。

#### Expected Results
- RPC timeout 恢复决策集中在 `src/server/appServerRpcTimeoutRecovery.ts`。
- 每次超时都会先调用 diagnostics `recordTimeout()`，保留最近超时诊断。
- 非 `initialize` RPC 在 App Server cold start grace 内只写 `App-server RPC timed out during startup grace`，不计入重启窗口。
- `initialize` 超时不走启动宽限，仍进入 restartable timeout 计数。
- 达到重复超时阈值时返回 `restart` 决策，并保留 `thread/read` 的 `includeTurns` 诊断布尔值。
- server module smoke、构建、治理门禁和 release gate 均通过。

#### Rollback/Cleanup Notes
- 如需回滚，删除 `src/server/appServerRpcTimeoutRecovery.ts`，撤销 `scripts/server-module-smoke.ts` 中的 RPC timeout recovery smoke，并把 `recordTimeout()`、启动宽限判断和重复超时重启逻辑恢复到 `src/server/codexAppServerBridge.ts` 的 `noteRpcTimeout()` 内。

---

### Feature: App Server pending RPC store 模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerPendingRpcStore.ts` 和 `src/server/codexAppServerBridge.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 pending RPC 记录、命中判断、finalize 清理、missing finalize 和 rejectAll 分支。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `node scripts\verify-server-modules.mjs`。
3. 执行 `node_modules\.bin\vue-tsc.cmd --noEmit`。
4. 执行 `node_modules\.bin\vite.cmd build`。
5. 执行 `node_modules\.bin\tsup.cmd`。
6. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`。
7. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`。
8. 代码审查确认 `src/server/codexAppServerBridge.ts` 通过 `AppServerPendingRpcStore` 管理 pending RPC，不再内联 pending Map、finalize 或 rejectAll 逻辑。

#### Expected Results
- pending RPC 的记录、`has()`、`finalize()`、timeout 清理和批量 reject 集中在 `src/server/appServerPendingRpcStore.ts`。
- App Server stdout 响应、RPC timeout、进程 error/exit、restart 和 dispose 仍按原语义清理 pending RPC。
- `pendingRpcCount` 仍来自当前 pending RPC 数量，健康快照和重启/退出日志语义不变。
- server module smoke、构建、治理门禁和 release gate 均通过。

#### Rollback/Cleanup Notes
- 如需回滚，删除 `src/server/appServerPendingRpcStore.ts`，撤销 `scripts/server-module-smoke.ts` 中的 pending RPC store smoke，并把 pending Map、`finalizePendingRpc()` 和 `rejectAllPending()` 恢复到 `src/server/codexAppServerBridge.ts`。

---

### Feature: App Server thread/read includeTurns 参数判定模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerThreadReadParams.ts`、`src/server/appServerRpcTimeoutPolicy.ts`、`src/server/appServerRpcTimeoutRecovery.ts`、`src/server/rpcProxyRoute.ts` 和 `src/server/codexAppServerBridge.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 `includeTurns: true`、`includeTurns: false`、缺失参数、非对象参数和非 `thread/read` method 分支。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `node scripts\verify-server-modules.mjs`。
3. 执行 `node_modules\.bin\vue-tsc.cmd --noEmit`。
4. 执行 `node_modules\.bin\vite.cmd build`。
5. 执行 `node_modules\.bin\tsup.cmd`。
6. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`。
7. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`。
8. 代码审查确认 `codexAppServerBridge.ts`、`appServerRpcTimeoutPolicy.ts`、`appServerRpcTimeoutRecovery.ts` 和 `rpcProxyRoute.ts` 均复用 `appServerThreadReadParams.ts`，不再各自内联 `includeTurns === true` 判定。

#### Expected Results
- `thread/read` heavy read 判定集中在 `src/server/appServerThreadReadParams.ts`。
- `getRpcTimeoutMs('thread/read', { includeTurns: true })` 仍返回 heavy timeout，`false`、缺失和非对象参数仍返回 light timeout。
- RPC timeout recovery 和 bridge slow/timeout 诊断仍对 `thread/read` 返回布尔 `includeTurns`，对非 `thread/read` 返回 `undefined`。
- `rpcProxyRoute` 仍只在 `thread/read` 且 `includeTurns === true` 时记忆 cached thread/read。
- server module smoke、构建、治理门禁和 release gate 均通过。

#### Rollback/Cleanup Notes
- 如需回滚，删除 `src/server/appServerThreadReadParams.ts`，撤销 `scripts/server-module-smoke.ts` 中的 thread/read params smoke，并把 `includeTurns === true` 判定恢复到 `codexAppServerBridge.ts`、`appServerRpcTimeoutPolicy.ts`、`appServerRpcTimeoutRecovery.ts` 和 `rpcProxyRoute.ts` 的原调用点。

---

### Feature: Workspace/meta 路由模块化

#### Prerequisites
- 当前仓库包含 `src/server/workspaceMetaRoutes.ts`、`src/server/codexAppServerBridge.ts`、`scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs`、`scripts/verify-governance.ps1` 和 `scripts/verify-release.ps1`。
- `dist/` 与 `dist-cli/` 已存在，或可用完整 release gate 重新构建。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `node scripts\verify-server-modules.mjs`。
3. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`。
4. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`。
5. 检查 release package smoke 输出，确认 zip 必检清单包含 `src\server\workspaceMetaRoutes.ts`。

#### Expected Results
- `/codex-api/meta/methods` 和 `/codex-api/meta/notifications` 继续返回 method catalog 数据。
- `/codex-api/workspace-roots-state` 的 GET/PUT 继续读写 `~/.codex/global-state.json` 中的 workspace roots state，并保持既有归一化规则。
- `/codex-api/home-directory` 继续返回当前用户 home directory。
- `codexAppServerBridge.ts` 不再内联这些 meta/workspace/home route 分支，而是委托 `handleWorkspaceMetaRoutes`。
- Server module smoke 覆盖 GET meta methods、GET notification methods、GET/PUT workspace roots state、非法 PUT body 和 home directory 未命中方法。
- Release package smoke 会在 zip 缺少 `src\server\workspaceMetaRoutes.ts` 时失败。

#### Rollback/Cleanup Notes
- 如需回滚，撤销 `src/server/workspaceMetaRoutes.ts`、`src/server/codexAppServerBridge.ts`、`scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs`、`scripts/verify-governance.ps1`、`scripts/verify-release.ps1` 和本节测试记录中的相关改动。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`node scripts\verify-server-modules.mjs` 通过，输出 `server module smoke ok`，覆盖 workspace/meta route 委托和状态写入归一化。
- 2026-07-04 治理门禁：`node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate：`node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` 通过，输出 `release package smoke ok`、`npm package smoke ok` 和 `Release verification completed.`。

---

### Feature: Project root routes 模块化

#### Prerequisites
- 当前仓库包含 `src/server/projectRootRoutes.ts`、`src/server/projectRoots.ts`、`src/server/workspaceRootsState.ts`、`src/server/codexAppServerBridge.ts`、`scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs`、`scripts/verify-governance.ps1` 和 `scripts/verify-release.ps1`。
- `dist/` 与 `dist-cli/` 已存在，或可用完整 release gate 重新构建。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `node scripts\verify-server-modules.mjs`。
3. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`。
4. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`。
5. 检查 release package smoke 输出，确认 zip 必检清单包含 `src\server\projectRootRoutes.ts`。

#### Expected Results
- `POST /codex-api/project-root` 继续读取当前 workspace roots state，调用 `resolveProjectRoot`，写回新的 workspace roots state，并返回 `{ data: { path } }`。
- `GET /codex-api/project-root-suggestion` 继续返回 `suggestProjectRoot` 的项目名和路径建议。
- `ProjectRootError` 继续映射为其原始 HTTP status 和错误消息，未知错误继续交给 bridge 顶层错误处理。
- `codexAppServerBridge.ts` 不再内联 project root route 分支，而是委托 `handleProjectRootRoutes`。
- Server module smoke 覆盖 project root 创建、缺失 path、project root suggestion、缺失 basePath 和未命中方法。
- Release package smoke 会在 zip 缺少 `src\server\projectRootRoutes.ts` 时失败。

#### Rollback/Cleanup Notes
- 如需回滚，撤销 `src/server/projectRootRoutes.ts`、`src/server/codexAppServerBridge.ts`、`scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs`、`scripts/verify-governance.ps1`、`scripts/verify-release.ps1` 和本节测试记录中的相关改动。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`node scripts\verify-server-modules.mjs` 通过，输出 `server module smoke ok`，覆盖 project root route 委托、workspace state 写回和 `ProjectRootError` status 映射。
- 2026-07-04 治理门禁：`node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate：`node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` 通过，输出 `release package smoke ok`、`npm package smoke ok` 和 `Release verification completed.`。

---

### Feature: Composer file search route 模块化

#### Prerequisites
- 当前仓库包含 `src/server/composerFileSearchRoutes.ts`、`src/server/composerFileSearch.ts`、`src/server/codexAppServerBridge.ts`、`scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs`、`scripts/verify-governance.ps1` 和 `scripts/verify-release.ps1`。
- `dist/` 与 `dist-cli/` 已存在，或可用完整 release gate 重新构建。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `node scripts\verify-server-modules.mjs`。
3. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`。
4. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`。
5. 检查 release package smoke 输出，确认 zip 必检清单包含 `src\server\composerFileSearchRoutes.ts`。

#### Expected Results
- `POST /codex-api/composer-file-search` 继续从 JSON body 读取 `cwd`、trim 后的 `query` 和原始 `limit`，并调用 `searchComposerFiles`。
- 成功时继续返回 `{ data: [...] }`。
- `ComposerFileSearchError` 继续映射为其原始 HTTP status 和错误消息。
- 未知错误继续返回 500，并使用 `getErrorMessage(error, 'Failed to search files')` 生成错误文案。
- `codexAppServerBridge.ts` 不再内联 composer file search route 分支，而是委托 `handleComposerFileSearchRoutes`。
- Server module smoke 覆盖成功搜索、缺失 cwd、未知错误 fallback 和非 POST 未命中。
- Release package smoke 会在 zip 缺少 `src\server\composerFileSearchRoutes.ts` 时失败。

#### Rollback/Cleanup Notes
- 如需回滚，撤销 `src/server/composerFileSearchRoutes.ts`、`src/server/codexAppServerBridge.ts`、`scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs`、`scripts/verify-governance.ps1`、`scripts/verify-release.ps1` 和本节测试记录中的相关改动。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`node scripts\verify-server-modules.mjs` 通过，输出 `server module smoke ok`，覆盖 composer file search route 委托、query trim、错误 status 映射和 500 fallback。
- 2026-07-04 治理门禁：`node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate：`node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` 通过，输出 `release package smoke ok`、`npm package smoke ok` 和 `Release verification completed.`。

---

### Feature: Thread routes 模块化

#### Prerequisites
- 当前仓库包含 `src/server/threadRoutes.ts`、`src/server/threadTitleCache.ts`、`src/server/threadSearchIndex.ts`、`src/server/codexAppServerBridge.ts`、`scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs`、`scripts/verify-governance.ps1` 和 `scripts/verify-release.ps1`。
- `dist/` 与 `dist-cli/` 已存在，或可用完整 release gate 重新构建。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `node scripts\verify-server-modules.mjs`。
3. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`。
4. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`。
5. 检查 release package smoke 输出，确认 zip 必检清单包含 `src\server\threadRoutes.ts`。

#### Expected Results
- `GET /codex-api/thread-titles` 继续合并读取全局 state 和 session index 中的线程标题缓存，并返回 `{ data: cache }`。
- `POST /codex-api/thread-search` 继续 trim `query`、将 `limit` 限制在 1 到 1000，空 query 直接返回空结果，非空 query 调用 `threadSearchIndexStore.search`。
- `PUT /codex-api/thread-titles` 继续要求 `id`，有 `title` 时更新缓存，空 `title` 时移除缓存，并写回全局 state。
- `codexAppServerBridge.ts` 不再内联 thread titles/search route 分支，而是委托 `handleThreadRoutes`。
- Server module smoke 覆盖标题读取、搜索、空搜索、标题更新、标题移除、缺失 id 和未命中方法。
- Release package smoke 会在 zip 缺少 `src\server\threadRoutes.ts` 时失败。

#### Rollback/Cleanup Notes
- 如需回滚，撤销 `src/server/threadRoutes.ts`、`src/server/codexAppServerBridge.ts`、`scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs`、`scripts/verify-governance.ps1`、`scripts/verify-release.ps1` 和本节测试记录中的相关改动。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`node scripts\verify-server-modules.mjs` 通过，输出 `server module smoke ok`，覆盖 thread route 委托、标题缓存读写、搜索 limit 归一化和空搜索短路。
- 2026-07-04 治理门禁：`node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate：`node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` 通过，输出 `release package smoke ok`、`npm package smoke ok` 和 `Release verification completed.`。

---

### Feature: Status routes 模块化

#### Prerequisites
- 当前仓库包含 `src/server/statusRoutes.ts`、`src/server/desktopAppRefresh.ts`、`src/server/tunnelStatus.ts`、`src/server/codexAppServerBridge.ts`、`scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs`、`scripts/verify-governance.ps1` 和 `scripts/verify-release.ps1`。
- `dist/` 与 `dist-cli/` 已存在，或可用完整 release gate 重新构建。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `node scripts\verify-server-modules.mjs`。
3. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`。
4. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`。
5. 检查 release package smoke 输出，确认 zip 必检清单包含 `src\server\statusRoutes.ts`。

#### Expected Results
- `GET /codex-api/desktop-app/status` 继续返回官方 Codex 桌面端刷新状态。
- `POST /codex-api/desktop-app/refresh` 成功时继续返回 202 和刷新请求结果；失败时继续返回 409 和错误文案。
- `GET /codex-api/tunnel-status` 继续返回 Cloudflare Tunnel 状态。
- `PUT /codex-api/tunnel-status` 继续从 JSON body 读取 `enabled` 和 `cloudflaredCommand`，并调用 `updateTunnelConfig`。
- `codexAppServerBridge.ts` 不再内联 desktop/tunnel status route 分支，而是委托 `handleStatusRoutes`。
- Server module smoke 覆盖桌面状态读取、刷新成功、刷新失败、隧道状态读取、隧道配置更新、非法 body 归一化和未命中方法。
- Release package smoke 会在 zip 缺少 `src\server\statusRoutes.ts` 时失败。

#### Rollback/Cleanup Notes
- 如需回滚，撤销 `src/server/statusRoutes.ts`、`src/server/codexAppServerBridge.ts`、`scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs`、`scripts/verify-governance.ps1`、`scripts/verify-release.ps1` 和本节测试记录中的相关改动。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`node scripts\verify-server-modules.mjs` 通过，输出 `server module smoke ok`，覆盖 status route 委托、刷新错误映射和 tunnel update body 归一化。
- 2026-07-04 治理门禁：`node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate：`node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` 通过，输出 `release package smoke ok`、`npm package smoke ok` 和 `Release verification completed.`。

---

### Feature: GitHub trending routes 模块化

#### Prerequisites
- 当前仓库包含 `src/server/githubTrendingRoutes.ts`、`src/server/githubTrending.ts`、`src/server/codexAppServerBridge.ts`、`scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs`、`scripts/verify-governance.ps1` 和 `scripts/verify-release.ps1`。
- 本机可运行 server module smoke、governance gate 和 release gate；route smoke 使用注入依赖，不需要真实访问 GitHub 或翻译服务。

#### Steps
1. 打开 `src/server/codexAppServerBridge.ts`，确认 `/codex-api/github-trending` 和 `/codex-api/github-trending/translate` 统一委托 `handleGithubTrendingRoutes(...)`。
2. 打开 `src/server/githubTrendingRoutes.ts`，确认 route 模块只负责 query/body 归一化、调用 `githubTrending.ts` service、映射 502/fallback 响应和返回 JSON。
3. 执行 `git diff --check`。
4. 执行 `node scripts\verify-server-modules.mjs`。
5. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`。
6. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`。
7. 确认 release package smoke 必检 `src\server\githubTrendingRoutes.ts`。

#### Expected Results
- `GET /codex-api/github-trending` 继续归一化 `since` 和 `limit`，成功时返回 `{ data: [...] }`。
- GitHub trending fetch 失败时继续返回 502，错误文案来自 `getErrorMessage(...)`。
- `POST /codex-api/github-trending/translate` 继续把 descriptions 归一化为最多 10 条，翻译成功时返回翻译结果。
- 翻译服务失败时继续返回原始归一化 descriptions，不阻断热门项目列表展示。
- 未匹配 method/path 返回 `false`，不吞掉后续 route。
- `githubTrendingRoutes.ts` 被 TypeScript server smoke、governance gate 和 release zip 清单覆盖。

#### Rollback/Cleanup Notes
- 如需回滚，撤销 `src/server/githubTrendingRoutes.ts`、`src/server/codexAppServerBridge.ts`、`scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs`、`scripts/verify-governance.ps1`、`scripts/verify-release.ps1` 和本节测试记录中的相关改动。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`node scripts\verify-server-modules.mjs` 通过，输出 `server module smoke ok`，覆盖 GitHub trending route 委托、query normalization、fetch 502、translation normalization/fallback 和未匹配 route 返回 `false`。
- 2026-07-04 治理门禁：`node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate：`node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` 通过，输出 `server module smoke ok`、`release package smoke ok`、`npm package smoke ok` 和 `Release verification completed.`；zip 必检清单包含 `src\server\githubTrendingRoutes.ts`。

---

### Feature: RPC proxy route 模块化

#### Prerequisites
- 当前仓库包含 `src/server/rpcProxyRoute.ts`、`src/server/codexAppServerBridge.ts`、`src/server/runtimePayload.ts`、`src/server/appServerRpcCache.ts`、`src/server/appServerRpcErrors.ts`、`src/server/appServerRpcResult.ts`、`scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs`、`scripts/verify-governance.ps1` 和 `scripts/verify-release.ps1`。
- 本机可运行 server module smoke、governance gate 和 release gate；route smoke 使用注入依赖模拟 App Server RPC、runtime state store、thread cache 和搜索索引清理。

#### Steps
1. 打开 `src/server/codexAppServerBridge.ts`，确认 `/codex-api/rpc` 统一委托 `handleRpcProxyRoute(...)`，bridge 只注入 appServer/runtime/cache/search 副作用。
2. 打开 `src/server/rpcProxyRoute.ts`，确认 route 模块保留 invalid body 400、plan-mode native/fallback、runtime mark/persist、interrupt settled local settle、thread materializing 容错、thread/list augment、thread/read turns trimming/cache 写入行为。
3. 执行 `git diff --check`。
4. 执行 `node scripts\verify-server-modules.mjs`。
5. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`。
6. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`。
7. 确认 release package smoke 必检 `src\server\rpcProxyRoute.ts`。

#### Expected Results
- `POST /codex-api/rpc` body 不是对象或缺少非空 `method` 时返回 400 `{ error: "Invalid body: expected { method, params? }" }`。
- `turn/start` plan mode 先带 `mode=plan` 调用；遇到 native mode 不兼容错误时，删除 native mode 并用 plan prompt fallback 重试。
- `turn/start`、`turn/interrupt`、`thread/resume` 继续标记 runtime state 并持久化 snapshot；interrupt settled 错误继续返回 200、本地置为 interrupted。
- `thread/resume` / `thread/archive` 的 thread materializing 错误继续返回 `{ result: null }`，避免首条消息前读取失败打断 UI。
- `thread/list` 继续经过 supplemental augment；`thread/read includeTurns=true` 继续裁剪 turns 并写入 thread read cache。
- 未匹配 method/path 返回 `false`，不吞掉后续 route。
- `rpcProxyRoute.ts` 被 TypeScript server smoke、governance gate 和 release zip 清单覆盖。

#### Rollback/Cleanup Notes
- 如需回滚，撤销 `src/server/rpcProxyRoute.ts`、`src/server/codexAppServerBridge.ts`、`scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs`、`scripts/verify-governance.ps1`、`scripts/verify-release.ps1` 和本节测试记录中的相关改动。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`node scripts\verify-server-modules.mjs` 通过，输出 `server module smoke ok`，覆盖 invalid body 400、plan mode fallback、interrupt settled local settle、thread materializing 容错、thread/list augment、thread/read trim/cache 和未匹配 route 返回 `false`。
- 2026-07-04 治理门禁：`node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate：`node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` 通过，输出 `server module smoke ok`、`release package smoke ok`、`npm package smoke ok` 和 `Release verification completed.`；zip 必检清单包含 `src\server\rpcProxyRoute.ts`。

---

### Feature: Worktree routes 模块化

#### Prerequisites
- 当前仓库包含 `src/server/worktreeRoutes.ts`、`src/server/appServerRollbackGit.ts`、`src/server/codexPaths.ts`、`src/server/codexAppServerBridge.ts`、`scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs`、`scripts/verify-governance.ps1` 和 `scripts/verify-release.ps1`。
- 本机可运行 server module smoke、governance gate 和 release gate；route smoke 使用注入依赖模拟文件系统与 Git 命令，不创建真实 worktree。

#### Steps
1. 打开 `src/server/codexAppServerBridge.ts`，确认 `/codex-api/worktree/create`、`/codex-api/worktree/auto-commit` 和 `/codex-api/worktree/rollback-to-message` 统一委托 `handleWorktreeRoutes(...)`。
2. 打开 `src/server/worktreeRoutes.ts`，确认 route 模块保留 Codex desktop worktree 布局 `~/.codex/worktrees/<id>/<repoName>`、`codex/<id>` 分支命名、非 Git 仓库初始化、空 HEAD 初始提交重试和 rollback stash/reset 行为。
3. 执行 `git diff --check`。
4. 执行 `node scripts\verify-server-modules.mjs`。
5. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`。
6. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`。
7. 确认 release package smoke 必检 `src\server\worktreeRoutes.ts`。

#### Expected Results
- `POST /codex-api/worktree/create` 缺少 `sourceCwd` 返回 400，source 不存在返回 404，source 不是目录返回 400；成功时返回 `{ cwd, branch, gitRoot }`。
- create worktree 对非 Git 目录继续执行 `git init`，对缺少 `HEAD` 的仓库继续调用 `ensureRepoHasInitialCommit(...)` 后重试 `git worktree add`。
- `POST /codex-api/worktree/auto-commit` 继续对空变更返回 `{ committed: false }`，有 staged 变更时提交并返回 `{ committed: true }`，Git/rollback 异常返回 500。
- `POST /codex-api/worktree/rollback-to-message` 找不到提交返回 404，匹配提交无 parent 返回 409，存在工作区变更时先 stash 再 reset，成功返回 `{ reset: true, commitSha, resetTargetSha, stashed }`。
- 未匹配 method/path 返回 `false`，不吞掉后续 route。
- `worktreeRoutes.ts` 被 TypeScript server smoke、governance gate 和 release zip 清单覆盖。

#### Rollback/Cleanup Notes
- 如需回滚，撤销 `src/server/worktreeRoutes.ts`、`src/server/codexAppServerBridge.ts`、`scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs`、`scripts/verify-governance.ps1`、`scripts/verify-release.ps1` 和本节测试记录中的相关改动。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`node scripts\verify-server-modules.mjs` 通过，输出 `server module smoke ok`，覆盖 worktree create 400/404/200、非 Git 初始化、缺少 HEAD 初始提交重试、auto-commit 200/500、rollback 404/409/200/stash/reset 和未匹配 route 返回 `false`。
- 2026-07-04 治理门禁：`node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate：`node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` 通过，输出 `server module smoke ok`、`release package smoke ok`、`npm package smoke ok` 和 `Release verification completed.`；zip 必检清单包含 `src\server\worktreeRoutes.ts`。

---

### Feature: Server request routes 模块化

#### Prerequisites
- 当前仓库包含 `src/server/serverRequestRoutes.ts`、`src/server/serverRequestDiagnostics.ts`、`src/server/codexAppServerBridge.ts`、`scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs`、`scripts/verify-governance.ps1` 和 `scripts/verify-release.ps1`。
- 本机可运行 server module smoke、governance gate 和 release gate；route smoke 使用注入依赖，不需要启动真实 Codex App Server。

#### Steps
1. 打开 `src/server/codexAppServerBridge.ts`，确认 `/codex-api/server-requests/respond`、`/codex-api/server-requests/pending` 和 `/codex-api/server-requests/pending/diagnostics` 统一委托 `handleServerRequestRoutes(...)`。
2. 打开 `src/server/serverRequestRoutes.ts`，确认 route 模块只通过注入依赖读取 JSON body、响应 server request、读取 pending request 列表，并复用 `createServerRequestDiagnosticsSnapshot(...)`。
3. 执行 `git diff --check`。
4. 执行 `node scripts\verify-server-modules.mjs`。
5. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`。
6. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`。
7. 确认 release package smoke 必检 `src\server\serverRequestRoutes.ts`。

#### Expected Results
- `POST /codex-api/server-requests/respond` 继续读取 JSON body、调用 App Server request response 入口，并返回 `{ ok: true }`。
- `GET /codex-api/server-requests/pending` 继续返回原始 pending request 列表。
- `GET /codex-api/server-requests/pending/diagnostics` 继续返回脱敏 diagnostics snapshot，不包含 request params。
- 未匹配 method/path 返回 `false`，不吞掉后续 route。
- `serverRequestRoutes.ts` 被 TypeScript server smoke、governance gate 和 release zip 清单覆盖。

#### Rollback/Cleanup Notes
- 如需回滚，撤销 `src/server/serverRequestRoutes.ts`、`src/server/codexAppServerBridge.ts`、`scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs`、`scripts/verify-governance.ps1`、`scripts/verify-release.ps1` 和本节测试记录中的相关改动。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`node scripts\verify-server-modules.mjs` 通过，输出 `server module smoke ok`，覆盖 server request respond、pending list、diagnostics snapshot 和未匹配 route 返回 `false`。
- 2026-07-04 治理门禁：`node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate：`node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` 通过，输出 `server module smoke ok`、`release package smoke ok`、`npm package smoke ok` 和 `Release verification completed.`；zip 必检清单包含 `src\server\serverRequestRoutes.ts`。

---

### Feature: Local state routes 模块化

#### Prerequisites
- 当前仓库包含 `src/server/localStateRoutes.ts`、`src/server/codexAppServerBridge.ts` 和 `scripts/server-module-smoke.ts`。
- 本机可运行 server module smoke、governance gate 和 release gate。

#### Steps
1. 打开 `src/server/codexAppServerBridge.ts`，确认 `/codex-api/web-settings`、`/codex-api/favorites` 和 `/codex-api/pinned-threads` 统一委托 `handleLocalStateRoutes(...)`。
2. 打开 `src/server/localStateRoutes.ts`，确认生产默认依赖仍使用 `webBridgeSettings.ts`、`webUiState.ts` 和 `pinnedThreads.ts` 的原有读写函数。
3. 执行 `git diff --check`。
4. 执行 `node scripts\verify-server-modules.mjs`。
5. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`。
6. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`。
7. 确认 release package smoke 必检 `src\server\localStateRoutes.ts`。

#### Expected Results
- web settings、favorites 和 pinned threads 三组本地状态 HTTP 路由共用 `localStateRoutes.ts`，bridge 主文件减少内联状态读写逻辑。
- GET/PUT 响应结构保持 `{ data: ... }`，web settings 读写后仍同步 `appServer.setWebBridgeSettings(...)`。
- 非对象 PUT body 会按既有逻辑回退为空对象，未匹配 method/path 返回 `false`，不吞掉后续 route。
- `localStateRoutes.ts` 被 TypeScript server smoke、governance gate 和 release zip 清单覆盖。

#### Rollback/Cleanup Notes
- 如需回滚，撤销 `src/server/localStateRoutes.ts`、`src/server/codexAppServerBridge.ts`、`scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs`、`scripts/verify-release.ps1`、`scripts/verify-governance.ps1` 和本节测试记录。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`node scripts\verify-server-modules.mjs` 通过，覆盖 local state route 的 web settings GET/PUT、favorites GET/PUT、pinned threads GET/PUT 和未匹配 route 返回 `false`。
- 2026-07-04 治理门禁：`node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate：`node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` 通过，输出 `server module smoke ok`、`release package smoke ok`、`npm package smoke ok` 和 `Release verification completed.`；zip 必检清单包含 `src\server\localStateRoutes.ts`。

---

### Feature: Notification SSE route 模块化

#### Prerequisites
- 当前仓库包含 `src/server/notificationSseRoute.ts`、`src/server/codexAppServerBridge.ts` 和 `scripts/server-module-smoke.ts`。
- 本机可运行 server module smoke、governance gate 和 release gate。

#### Steps
1. 打开 `src/server/codexAppServerBridge.ts`，确认 `/codex-api/events` 统一委托 `handleNotificationSseRoute(...)`。
2. 打开 `src/server/notificationSseRoute.ts`，确认 SSE route 设置 `text/event-stream`、`Cache-Control: no-cache, no-transform`、`Connection: keep-alive` 和 `X-Accel-Buffering: no`。
3. 确认 ready event 包含 `latestSeq`，notification listener 写入 `data: ...`，heartbeat 使用 `bridge/heartbeat`，`close`/`aborted` 会清理 interval、取消订阅并结束响应。
4. 执行 `git diff --check`。
5. 执行 `node scripts\verify-server-modules.mjs`。
6. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`。
7. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`。
8. 确认 release package smoke 必检 `src\server\notificationSseRoute.ts`。

#### Expected Results
- `/codex-api/events` SSE route 从 bridge 主文件抽出，保持 ready、notification、heartbeat 和连接关闭清理行为不变。
- 未匹配 method/path 返回 `false`，不吞掉后续 route。
- `notificationSseRoute.ts` 被 TypeScript server smoke、governance gate 和 release zip 清单覆盖。

#### Rollback/Cleanup Notes
- 如需回滚，撤销 `src/server/notificationSseRoute.ts`、`src/server/codexAppServerBridge.ts`、`scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs`、`scripts/verify-release.ps1`、`scripts/verify-governance.ps1` 和本节测试记录。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`node scripts\verify-server-modules.mjs` 通过，覆盖 SSE headers、ready event、notification 写入、heartbeat、close cleanup、unsubscribe 和未匹配 route 返回 `false`。
- 2026-07-04 治理门禁：`node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate：`node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` 通过，输出 `server module smoke ok`、`release package smoke ok`、`npm package smoke ok` 和 `Release verification completed.`；zip 必检清单包含 `src\server\notificationSseRoute.ts`。

---

### Feature: Runtime action routes 模块化

#### Prerequisites
- 当前仓库包含 `src/server/runtimeActionRoutes.ts`、`src/server/runtimePayload.ts`、`src/server/runtimeStore.ts`、`src/server/codexAppServerBridge.ts`、`scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs`、`scripts/verify-governance.ps1` 和 `scripts/verify-release.ps1`。
- 本机可运行 server module smoke、governance gate 和 release gate；route smoke 使用注入依赖，不需要启动真实 Codex App Server runtime。

#### Steps
1. 打开 `src/server/codexAppServerBridge.ts`，确认 `/codex-api/runtime/send`、`/codex-api/runtime/request` 和 `/codex-api/runtime/interrupt` 统一委托 `handleRuntimeActionRoutes(...)`。
2. 打开 `src/server/runtimeActionRoutes.ts`，确认 route 模块只负责读取 JSON body/query、调用 `startRuntimeTurn(...)` / `interruptRuntimeTurn(...)` / `getLatestRequestByClientMessageId(...)`，并映射 200/202/400/404 响应。
3. 执行 `git diff --check`。
4. 执行 `node scripts\verify-server-modules.mjs`。
5. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`。
6. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`。
7. 确认 release package smoke 必检 `src\server\runtimeActionRoutes.ts`。

#### Expected Results
- `POST /codex-api/runtime/send` 继续在 `status=start_uncertain` 时返回 202，其余状态返回 200。
- `GET /codex-api/runtime/request` 缺少 `clientMessageId` 时返回 400；找不到 request 时返回 404 `{ data: null }`；找到时返回 `{ data: request }`。
- `POST /codex-api/runtime/interrupt` 继续在 `status=stop_uncertain` 时返回 202，其余状态返回 200。
- 未匹配 method/path 返回 `false`，不吞掉后续 route。
- `runtimeActionRoutes.ts` 被 TypeScript server smoke、governance gate 和 release zip 清单覆盖。

#### Rollback/Cleanup Notes
- 如需回滚，撤销 `src/server/runtimeActionRoutes.ts`、`src/server/codexAppServerBridge.ts`、`scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs`、`scripts/verify-governance.ps1`、`scripts/verify-release.ps1` 和本节测试记录中的相关改动。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`node scripts\verify-server-modules.mjs` 通过，输出 `server module smoke ok`，覆盖 runtime send 200/202、runtime request 400/404/200、runtime interrupt 200/202 和未匹配 route 返回 `false`。
- 2026-07-04 治理门禁：`node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate：`node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` 通过，输出 `server module smoke ok`、`release package smoke ok`、`npm package smoke ok` 和 `Release verification completed.`；zip 必检清单包含 `src\server\runtimeActionRoutes.ts`。

---

### Feature: Runtime state routes 模块化

#### Prerequisites
- 当前仓库包含 `src/server/runtimeStateRoutes.ts`、`src/server/codexAppServerBridge.ts` 和 `scripts/server-module-smoke.ts`。
- 本机可运行 server module smoke、governance gate 和 release gate。

#### Steps
1. 打开 `src/server/codexAppServerBridge.ts`，确认 `/codex-api/runtime/thread/*`、`/codex-api/runtime/snapshot`、`/codex-api/runtime/snapshots`、`/codex-api/state/thread/*` 和 `/codex-api/thread-token-usage` 统一委托 `handleRuntimeStateRoutes(...)`。
2. 打开 `src/server/runtimeStateRoutes.ts`，确认 route 模块只通过注入依赖读取 runtime request store、runtime state store、pending server requests、token usage 和 legacy snapshot。
3. 执行 `git diff --check`。
4. 执行 `node scripts\verify-server-modules.mjs`。
5. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`。
6. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`。
7. 确认 release package smoke 必检 `src\server\runtimeStateRoutes.ts`。

#### Expected Results
- runtime 状态查询和 reconcile HTTP 路由从 bridge 主文件抽出，返回结构保持 `{ data: ... }` 或既有 400 错误文案。
- `/runtime/thread/:id` 和 `/runtime/thread/:id/reconcile` 仍通过 `createRuntimeThreadStatePayload(...)` 附带 active runtime requests。
- `/runtime/snapshot(s)` 仍把 pending server requests 和 token usage 作为 overlay 注入 runtime snapshot。
- 未匹配 method/path 返回 `false`，不吞掉后续 route。
- `runtimeStateRoutes.ts` 被 TypeScript server smoke、governance gate 和 release zip 清单覆盖。

#### Rollback/Cleanup Notes
- 如需回滚，撤销 `src/server/runtimeStateRoutes.ts`、`src/server/codexAppServerBridge.ts`、`scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs`、`scripts/verify-release.ps1`、`scripts/verify-governance.ps1` 和本节测试记录。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`node scripts\verify-server-modules.mjs` 通过，覆盖 runtime thread GET、runtime thread reconcile POST、runtime snapshot、runtime snapshots、legacy state/thread、thread token usage、缺失 threadId 400 和未匹配 route 返回 `false`。
- 2026-07-04 治理门禁：`node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate：`node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` 通过，输出 `server module smoke ok`、`release package smoke ok`、`npm package smoke ok` 和 `Release verification completed.`；zip 必检清单包含 `src\server\runtimeStateRoutes.ts`。

---

### Feature: Diagnostics routes 模块化

#### Prerequisites
- 当前仓库包含 `src/server/diagnosticsRoutes.ts`、`src/server/codexAppServerBridge.ts` 和 `scripts/server-module-smoke.ts`。
- 本机可运行 server module smoke、governance gate 和 release gate。

#### Steps
1. 打开 `src/server/codexAppServerBridge.ts`，确认 `/codex-api/health` 和 `/codex-api/diagnostics` 统一委托 `handleDiagnosticsRoutes(...)`。
2. 打开 `src/server/diagnosticsRoutes.ts`，确认 route 模块通过注入依赖读取 app-server status、notification diagnostics、status diagnostics、server request diagnostics、hook diagnostics、schema audit、Windows sandbox readiness、transcription diagnostics 和 runtime store。
3. 执行 `git diff --check`。
4. 执行 `node scripts\verify-server-modules.mjs`。
5. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`。
6. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`。
7. 确认 release package smoke 必检 `src\server\diagnosticsRoutes.ts`。

#### Expected Results
- health 和 diagnostics HTTP 路由从 bridge 主文件抽出，返回结构保持 `status: "ok"` 与既有 `data` 字段。
- `/codex-api/diagnostics` 仍只返回 runtime recent event 的 seq/method/时间/threadId/turnId，不暴露 event params。
- uncertain runtime requests 仍只返回 requestId/clientMessageId/threadId/turnId/status/retryCount/updatedAtIso/lastError，不暴露 payload。
- pending server requests 继续使用脱敏后的 `createServerRequestDiagnosticsSnapshot(...)`。
- 未匹配 method/path 返回 `false`，不吞掉后续 route。

#### Rollback/Cleanup Notes
- 如需回滚，撤销 `src/server/diagnosticsRoutes.ts`、`src/server/codexAppServerBridge.ts`、`scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs`、`scripts/verify-release.ps1`、`scripts/verify-governance.ps1` 和本节测试记录。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`node scripts\verify-server-modules.mjs` 通过，覆盖 health 响应、diagnostics 响应、pending request 脱敏分类、recent events 截断且不含 params、uncertain request 不含 payload 和未匹配 route 返回 `false`。
- 2026-07-04 治理门禁：`node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate：`node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` 通过，输出 `server module smoke ok`、`release package smoke ok`、`npm package smoke ok` 和 `Release verification completed.`；zip 必检清单包含 `src\server\diagnosticsRoutes.ts`。

---

### Feature: Notification replay route 模块化

#### Prerequisites
- 当前仓库包含 `src/server/notificationReplayRoute.ts`、`src/server/codexAppServerBridge.ts` 和 `scripts/server-module-smoke.ts`。
- 本机可运行 server module smoke、governance gate 和 release gate。

#### Steps
1. 打开 `src/server/codexAppServerBridge.ts`，确认 `/codex-api/events/replay` 与 `/codex-api/runtime/events` 统一委托 `handleNotificationReplayRoute(...)`。
2. 打开 `src/server/notificationReplayRoute.ts`，确认 `afterSeq` 优先于 `after`，非法整数回退为 `0` 或 `200`，非 GET 或非 replay 路径返回 `false`。
3. 执行 `git diff --check`。
4. 执行 `node scripts\verify-server-modules.mjs`。
5. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`。
6. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`。
7. 确认 release package smoke 必检 `src\server\notificationReplayRoute.ts`。

#### Expected Results
- 两个事件 replay HTTP 端点共用同一个 route 模块，bridge 主文件减少内联路由逻辑。
- 非法 query 不会把 `NaN` 传入 replay lister。
- `notificationReplayRoute.ts` 被 TypeScript server smoke、governance gate 和 release zip 清单覆盖。

#### Rollback/Cleanup Notes
- 如需回滚，撤销 `src/server/notificationReplayRoute.ts`、`src/server/codexAppServerBridge.ts`、`scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs`、`scripts/verify-release.ps1`、`scripts/verify-governance.ps1` 和本节测试记录。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`node scripts\verify-server-modules.mjs` 通过，覆盖 replay query 解析、GET handler 响应、POST 不处理和 `notificationReplayRoute.ts` 编译。
- 2026-07-04 治理门禁：`node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate：`node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` 通过，输出 `server module smoke ok`、`release package smoke ok`、`npm package smoke ok` 和 `Release verification completed.`；zip 必检清单包含 `src\server\notificationReplayRoute.ts`。

---

### Feature: App Server notification runtime sync 模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerNotificationRuntimeSync.ts`、`src/server/codexAppServerBridge.ts` 和 `scripts/server-module-smoke.ts`。
- 本机可运行 server module smoke、governance gate、release gate 和直接构建命令。

#### Steps
1. 打开 `src/server/codexAppServerBridge.ts`，确认 `appServer.onNotification(...)` 只组装依赖并调用 `syncBridgeNotificationRuntimeState(...)`。
2. 打开 `src/server/appServerNotificationRuntimeSync.ts`，确认它负责记入 replay event、调用 `runtimeStateStore.observeEvent(...)`、按 threadId 持久化 runtime snapshot、reconcile runtime requests、按通知清理 thread read cache，并广播 bridge notification。
3. 执行 `git diff --check`。
4. 执行 `node scripts\verify-server-modules.mjs`。
5. 执行 `node_modules\.bin\vue-tsc.cmd --noEmit`。
6. 执行 `node_modules\.bin\vite.cmd build`。
7. 执行 `node_modules\.bin\tsup.cmd`。
8. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`。
9. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`。
10. 确认 release package smoke 必检 `src\server\appServerNotificationRuntimeSync.ts`。

#### Expected Results
- notification replay、runtime state observe、runtime request reconcile、thread read cache invalidation 和前端 listener 广播仍按原顺序发生。
- 带 `threadId` 的 `turn/completed` 通知会持久化 runtime snapshot、更新 active runtime request，并删除对应 cached thread read。
- 不带 `threadId` 的通知仍会进入 replay/广播，但不会持久化 snapshot、不会 reconcile request，也不会误删 cached thread read。
- `appServerNotificationRuntimeSync.ts` 被 TypeScript server smoke、governance gate 和 release zip 清单覆盖。

#### Rollback/Cleanup Notes
- 如需回滚，把 `syncBridgeNotificationRuntimeState(...)` 的逻辑恢复到 `src/server/codexAppServerBridge.ts` 的 `appServer.onNotification(...)` 回调中，并撤销 `src/server/appServerNotificationRuntimeSync.ts`、`scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs`、`scripts/verify-release.ps1`、`scripts/verify-governance.ps1` 和本测试章节。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`node scripts\verify-server-modules.mjs` 通过，覆盖 `syncBridgeNotificationRuntimeState()` 的 replay 记入、runtime observe、snapshot persist、runtime request reconcile、cache invalidation、listener emit 和无 threadId 不持久化/不清缓存分支。
- 2026-07-04 构建验证：`node_modules\.bin\vue-tsc.cmd --noEmit`、`node_modules\.bin\vite.cmd build` 和 `node_modules\.bin\tsup.cmd` 通过。
- 2026-07-04 治理门禁：`node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate：`node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` 通过，输出 `server module smoke ok`、`release package smoke ok`、`npm package smoke ok` 和 `Release verification completed.`；zip 必检清单包含 `src\server\appServerNotificationRuntimeSync.ts`。

---

### Feature: Runtime start 执行模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerRuntimeStart.ts`、`src/server/codexAppServerBridge.ts` 和 `scripts/server-module-smoke.ts`。
- 本机可运行 server module smoke、governance gate、release gate 和直接构建命令。

#### Steps
1. 打开 `src/server/codexAppServerBridge.ts`，确认 `startRuntimeTurn(...)` 只组装 runtime store、runtime state、App Server RPC、thread search cache、snapshot persist 和 plan-mode mark 依赖，然后调用 `startRuntimeTurnWithAppServer(...)`。
2. 打开 `src/server/appServerRuntimeStart.ts`，确认它负责解析 `/codex-api/runtime/send` payload、创建 `pending_start` request、必要时调用 `thread/start`、调用 `turn/start`、处理 plan-mode native/fallback 参数、更新 runtime state/request，并处理 timeout 和 failed 分支。
3. 执行 `git diff --check`。
4. 执行 `node scripts\verify-server-modules.mjs`。
5. 执行 `node_modules\.bin\vue-tsc.cmd --noEmit`。
6. 执行 `node_modules\.bin\vite.cmd build`。
7. 执行 `node_modules\.bin\tsup.cmd`。
8. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`。
9. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`。
10. 确认 release package smoke 必检 `src\server\appServerRuntimeStart.ts`。

#### Expected Results
- 没有 `threadId` 的 runtime send 会先调用 `thread/start`，成功后清理 thread search index，并把 request 保持在 `pending_start` 后继续 `turn/start`。
- plan mode `turn/start` 会先尝试官方 native `mode=plan` 参数；遇到 mode 兼容错误时会回退为 prompt wrapper，不误伤 execute 模式。
- 成功启动时返回 `running`，标记 runtime running、持久化 snapshot，并使用 App Server 返回的 turnId 或 snapshot activeTurnId 更新 request。
- `turn/start` 超时时返回 `start_uncertain`，标记 runtime start uncertain、持久化 snapshot，并把 request patch 为 `start_uncertain`。
- 其他 RPC 失败会把 request patch 为 `failed` 并继续抛出原始错误。
- `appServerRuntimeStart.ts` 被 TypeScript server smoke、governance gate 和 release zip 清单覆盖。

#### Rollback/Cleanup Notes
- 如需回滚，删除 `src/server/appServerRuntimeStart.ts`，把 `startRuntimeTurn(...)` 的解析、thread/start、turn/start、plan fallback 和状态收敛逻辑恢复到 `src/server/codexAppServerBridge.ts` 内，并撤销 `scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs`、`scripts/verify-release.ps1`、`scripts/verify-governance.ps1` 和本测试章节。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`node scripts\verify-server-modules.mjs` 通过，覆盖 `startRuntimeTurnWithAppServer()` 的 new-thread plan fallback success、snapshot activeTurnId fallback、timeout start_uncertain 和 failed 四条路径。
- 2026-07-04 构建验证：`node_modules\.bin\vue-tsc.cmd --noEmit`、`node_modules\.bin\vite.cmd build` 和 `node_modules\.bin\tsup.cmd` 通过。
- 2026-07-04 治理门禁：`node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate：`node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` 通过，输出 `server module smoke ok`、`release package smoke ok`、`npm package smoke ok` 和 `Release verification completed.`；zip 必检清单包含 `src\server\appServerRuntimeStart.ts`。

---

### Feature: Local runtime snapshot 读取模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerLocalRuntimeSnapshot.ts`、`src/server/appServerRuntimeSnapshotRecovery.ts`、`src/server/codexAppServerBridge.ts` 和 `scripts/server-module-smoke.ts`。
- 本机可运行 server module smoke、governance gate、release gate 和直接构建命令。

#### Steps
1. 打开 `src/server/codexAppServerBridge.ts`，确认 `readLocalRuntimeSnapshot(...)` 只调用 `readAppServerLocalRuntimeSnapshot(...)` 并注入 persisted snapshot、pending server requests、token usage、App Server started time、runtime state snapshot 和持久化依赖。
2. 打开 `src/server/appServerLocalRuntimeSnapshot.ts`，确认它会 trim threadId，并继续委托 `createLocalRuntimeSnapshot(...)` 处理 persisted/current 分支。
3. 确认存在 persisted snapshot 时不会创建或持久化 current snapshot，只会把 pending server requests 与 token usage 合并到返回值。
4. 确认没有 persisted snapshot 时会用 pending server requests 与 token usage overlay 创建 current snapshot，并调用 `persistRuntimeSnapshot(...)`。
5. 执行 `git diff --check`。
6. 执行 `node scripts\verify-server-modules.mjs`。
7. 执行 `node_modules\.bin\vue-tsc.cmd --noEmit`。
8. 执行 `node_modules\.bin\vite.cmd build`。
9. 执行 `node_modules\.bin\tsup.cmd`。
10. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`。
11. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`。
12. 确认 release package smoke 必检 `src\server\appServerLocalRuntimeSnapshot.ts`。

#### Expected Results
- persisted local runtime snapshot 的 stale/restarted 判定仍由 `appServerRuntimeSnapshotRecovery.ts` 处理，bridge 不再内联这层恢复输入组装。
- 返回给 `/codex-api/runtime/snapshot` 的 local snapshot 仍包含最新 pending server requests 和 token usage。
- current fallback snapshot 仍会被持久化，保证后续读取有 persisted snapshot。
- `appServerLocalRuntimeSnapshot.ts` 被 TypeScript server smoke、governance gate 和 release zip 清单覆盖。

#### Rollback/Cleanup Notes
- 如需回滚，删除 `src/server/appServerLocalRuntimeSnapshot.ts`，把 `readLocalRuntimeSnapshot(...)` 的 normalized threadId、pending request/token usage 读取、`runtimeStore.getSnapshot(...)` 和 `createLocalRuntimeSnapshot(...)` 调用恢复到 `src/server/codexAppServerBridge.ts` 内，并撤销 `scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs`、`scripts/verify-release.ps1`、`scripts/verify-governance.ps1` 和本测试章节。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`node scripts\verify-server-modules.mjs` 通过，覆盖 `readAppServerLocalRuntimeSnapshot()` 的 persisted snapshot 分支、current snapshot fallback、threadId trim、pending request/token usage overlay 和 current snapshot persist。
- 2026-07-04 构建验证：`node_modules\.bin\vue-tsc.cmd --noEmit`、`node_modules\.bin\vite.cmd build` 和 `node_modules\.bin\tsup.cmd` 通过。
- 2026-07-04 治理门禁：`node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate：`node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` 通过，输出 `server module smoke ok`、`release package smoke ok`、`npm package smoke ok` 和 `Release verification completed.`；zip 必检清单包含 `src\server\appServerLocalRuntimeSnapshot.ts`。

---

### Feature: Runtime snapshot 持久化模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerRuntimeSnapshotPersistence.ts`、`src/server/runtimeState.ts`、`src/server/runtimeStore.ts` 和 `src/server/codexAppServerBridge.ts`。
- 本机可运行 server module smoke、governance gate、release gate 和直接构建命令。

#### Steps
1. 打开 `src/server/codexAppServerBridge.ts`，确认 `persistRuntimeSnapshot(...)` 只调用 `persistAppServerRuntimeSnapshot(...)` 并注入 runtime state、pending server request、token usage 和 runtime store upsert 依赖。
2. 打开 `src/server/appServerRuntimeSnapshotPersistence.ts`，确认未传入 snapshot 时会读取 pending server requests 与 token usage 作为 overlay 创建当前 runtime snapshot。
3. 确认传入 snapshot 时不会重新读取 pending request、token usage 或当前 runtime state。
4. 确认写入 `runtimeStore.upsertSnapshot(...)` 前会调用 `toPersistableRuntimeSnapshot(...)`，避免把 `threadRead`、`pendingServerRequests` 和 `tokenUsage` 持久化进 snapshot JSON。
5. 执行 `git diff --check`。
6. 执行 `node scripts\verify-server-modules.mjs`。
7. 执行 `node_modules\.bin\vue-tsc.cmd --noEmit`。
8. 执行 `node_modules\.bin\vite.cmd build`。
9. 执行 `node_modules\.bin\tsup.cmd`。
10. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`。
11. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`。
12. 确认 release package smoke 必检 `src\server\appServerRuntimeSnapshotPersistence.ts`。

#### Expected Results
- runtime snapshot 持久化字段仍包含 `threadId`、`executionState`、`activeTurnId`、`activeItemId`、`canStop`、`stopRequested`、`lastEventSeq` 和 `updatedAtIso`。
- 返回值仍是完整的当前 snapshot，调用方可以继续读取非持久化的 overlay 字段。
- 持久化 snapshot JSON 不包含 heavy `threadRead`、ephemeral `pendingServerRequests` 或 token usage。
- `appServerRuntimeSnapshotPersistence.ts` 被 TypeScript server smoke、governance gate 和 release zip 清单覆盖。

#### Rollback/Cleanup Notes
- 如需回滚，删除 `src/server/appServerRuntimeSnapshotPersistence.ts`，把 `persistRuntimeSnapshot(...)` 的 snapshot overlay、`runtimeStore.upsertSnapshot(...)` 字段拼装和 `toPersistableRuntimeSnapshot(...)` 调用恢复到 `src/server/codexAppServerBridge.ts` 内，并撤销 `scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs`、`scripts/verify-release.ps1`、`scripts/verify-governance.ps1` 和本测试章节。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`node scripts\verify-server-modules.mjs` 通过，覆盖 `persistAppServerRuntimeSnapshot()` 的 overlay snapshot 生成、provided snapshot 直写、upsert 字段和 persistable snapshot 脱重字段。
- 2026-07-04 构建验证：`node_modules\.bin\vue-tsc.cmd --noEmit`、`node_modules\.bin\vite.cmd build` 和 `node_modules\.bin\tsup.cmd` 通过。
- 2026-07-04 治理门禁：`node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate：`node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` 通过，输出 `server module smoke ok`、`release package smoke ok`、`npm package smoke ok` 和 `Release verification completed.`；zip 必检清单包含 `src\server\appServerRuntimeSnapshotPersistence.ts`。

---

### Feature: Runtime interrupt 执行模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerRuntimeInterrupt.ts`、`src/server/codexAppServerBridge.ts` 和 `scripts/server-module-smoke.ts`。
- 本机可运行 server module smoke、governance gate、release gate 和直接构建命令。

#### Steps
1. 打开 `src/server/codexAppServerBridge.ts`，确认 `interruptRuntimeTurn(...)` 只组装 runtime store、runtime state、App Server RPC、snapshot persist 和 plan-mode 清理依赖，然后调用 `interruptRuntimeTurnWithAppServer(...)`。
2. 打开 `src/server/appServerRuntimeInterrupt.ts`，确认它负责解析 `/codex-api/runtime/interrupt` payload、创建 `stopping` request、标记 runtime stopping、调用官方 `turn/interrupt` RPC，并处理 stopped、already settled、timeout 和 failed 四条路径。
3. 执行 `git diff --check`。
4. 执行 `node scripts\verify-server-modules.mjs`。
5. 执行 `node_modules\.bin\vue-tsc.cmd --noEmit`。
6. 执行 `node_modules\.bin\vite.cmd build`。
7. 执行 `node_modules\.bin\tsup.cmd`。
8. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`。
9. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`。
10. 确认 release package smoke 必检 `src\server\appServerRuntimeInterrupt.ts`。

#### Expected Results
- 成功中断时返回 `stopped`，清理 plan-mode turn、标记 interrupted、持久化 runtime snapshot，并把 request patch 为 `stopped`。
- App Server 返回 already settled 类错误时仍收敛为 `stopped`，但保留本地 interrupted lastError 便于诊断。
- `turn/interrupt` 超时时返回 `stop_uncertain`，标记 runtime `stop_uncertain`，持久化 snapshot，并把 request patch 为 `stop_uncertain`。
- 其他 RPC 失败会把 request patch 为 `failed` 并继续抛出原始错误，避免把权限或 transport 失败误报为已停止。
- `appServerRuntimeInterrupt.ts` 被 TypeScript server smoke、governance gate 和 release zip 清单覆盖。

#### Rollback/Cleanup Notes
- 如需回滚，删除 `src/server/appServerRuntimeInterrupt.ts`，把 `interruptRuntimeTurn(...)` 的解析、RPC 和状态收敛逻辑恢复到 `src/server/codexAppServerBridge.ts` 内，并撤销 `scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs`、`scripts/verify-release.ps1`、`scripts/verify-governance.ps1` 和本测试章节。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`node scripts\verify-server-modules.mjs` 通过，覆盖 `interruptRuntimeTurnWithAppServer()` 的 success、already settled、timeout 和 failed 四条路径。
- 2026-07-04 构建验证：`node_modules\.bin\vue-tsc.cmd --noEmit`、`node_modules\.bin\vite.cmd build` 和 `node_modules\.bin\tsup.cmd` 通过。
- 2026-07-04 治理门禁：`node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate：`node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` 通过，输出 `server module smoke ok`、`release package smoke ok`、`npm package smoke ok` 和 `Release verification completed.`；zip 必检清单包含 `src\server\appServerRuntimeInterrupt.ts`。

---

### Feature: App Server notification state capture 模块化

#### Prerequisites
- 当前仓库包含 `src/server/appServerNotificationState.ts`、`src/server/codexAppServerBridge.ts` 和 `scripts/server-module-smoke.ts`。
- `scripts/server-module-smoke.ts` 已覆盖 thread-list cache 清理、plan-mode turn 清理和 token usage 更新三条 notification state capture 分支。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `node scripts\verify-server-modules.mjs`。
3. 执行 `node_modules\.bin\vue-tsc.cmd --noEmit`。
4. 执行 `node_modules\.bin\vite.cmd build`。
5. 执行 `node_modules\.bin\tsup.cmd`。
6. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`。
7. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`。
8. 代码审查确认 `src/server/codexAppServerBridge.ts` 的 `captureNotificationState(...)` 只调用 `captureAppServerNotificationState(...)` 并注入 store/cache 副作用。
9. 代码审查确认 `src/server/appServerNotificationState.ts` 集中维护 notification method 到 thread-list cache、plan-mode turn 和 token usage 的状态捕获规则。
10. 确认 release package smoke 必检 `src\server\appServerNotificationState.ts`。

#### Expected Results
- `thread/name/updated` 等 thread-list notification 仍会清理 thread-list cache。
- `turn/completed`、`thread/interrupted`、`error` 和 `*/failed` notification 仍会按 threadId/turnId 清理 plan-mode turn。
- `thread/tokenUsage/updated` 仍会更新 thread token usage cache。
- `AppServerProcess` 不再内联 notification state capture 规则，只保留实际 store/cache 依赖。
- `appServerNotificationState.ts` 被 TypeScript server smoke、governance gate 和 release zip 清单覆盖。

#### Rollback/Cleanup Notes
- 如需回滚，删除 `src/server/appServerNotificationState.ts`，把 thread-list cache 清理、plan-mode turn 清理和 token usage 更新规则恢复到 `src/server/codexAppServerBridge.ts` 的 `captureNotificationState(...)` 内，并撤销 `scripts/server-module-smoke.ts`、`scripts/verify-server-modules.mjs`、`scripts/verify-release.ps1`、`scripts/verify-governance.ps1` 和本测试章节。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`node scripts\verify-server-modules.mjs` 通过，输出 `server module smoke ok`，覆盖 `captureAppServerNotificationState()` 的 thread-list cache 清理、plan-mode turn 清理、token usage 更新和结束/失败通知判定。
- 2026-07-04 构建验证：`node_modules\.bin\vue-tsc.cmd --noEmit`、`node_modules\.bin\vite.cmd build` 和 `node_modules\.bin\tsup.cmd` 通过。
- 2026-07-04 治理门禁：`node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate：`node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` 通过，输出 `server module smoke ok`、`release package smoke ok`、`npm package smoke ok` 和 `Release verification completed.`；zip 必检清单包含 `src\server\appServerNotificationState.ts`。

---

### Feature: App Server schema audit 摘要刷新

#### Prerequisites
- 本机可运行 Codex manual helper：`node %USERPROFILE%\.codex\skills\.system\openai-docs\scripts\fetch-codex-manual.mjs`。
- 本机可运行 App Server schema audit：`npm.cmd run audit:app-server-schemas`。
- 当前仓库包含 `docs/app-server-schema-audit-summary.json`、`docs/app-server-protocol-matrix.zh-CN.md` 和 `docs/openai-docs-review.zh-CN.md`。

#### Steps
1. 执行官方 manual helper，确认 Codex manual 缓存状态和 App Server/Auto-review/Remote connections 等章节入口。
2. 执行 `npm.cmd run audit:app-server-schemas`，生成新的 `output/app-server-schema-audit/<timestamp>/audit-summary.json`。
3. 如果 audit 因 schema drift 返回 1，确认输出中包含 “Schema differences found. Exit code 1 means review is required, not that generation failed.”。
4. 执行 `node scripts\update-app-server-schema-audit-summary.mjs`，刷新提交用脱敏摘要。
5. 检查 `docs/app-server-schema-audit-summary.json` 只包含相对路径、计数和 representative 列表，不包含本机绝对路径或完整 generated/raw schema 列表。
6. 更新协议矩阵和 OpenAI 文档审查手册中的审计时间、输出目录或最近审查时间。
7. 执行 `git diff --check`、`npm.cmd run verify:governance` 和 release gate。

#### Expected Results
- Codex manual helper 返回可用 manual/outline 路径，并说明本地 manual 是否当前。
- 新 schema audit 输出目录记录到 `docs/app-server-schema-audit-summary.json` 和协议矩阵。
- 如果 schema drift 计数未变化，协议矩阵继续保持“不能声明已完全对齐最新 App Server”的结论。
- `docs/app-server-schema-audit-summary.json` 不提交 raw schema diff，也不包含 `repository` 或 `generated` 绝对路径字段。

#### Rollback/Cleanup Notes
- 可删除 `output/app-server-schema-audit/` 下的本地生成目录；它不应提交。
- 如需回滚，撤销 `docs/app-server-schema-audit-summary.json`、`docs/app-server-protocol-matrix.zh-CN.md`、`docs/openai-docs-review.zh-CN.md` 和本节测试记录。

#### Regression Evidence
- 2026-07-04 官方 manual helper：`node C:\Users\SW\.codex\skills\.system\openai-docs\scripts\fetch-codex-manual.mjs` 通过，输出 `Manual status: local manual was already current.`，manual outline 仍包含 Codex App Server、Auto-review、Permissions、Remote connections 和 Open Source 等章节。
- 2026-07-04 Schema audit：`npm.cmd run audit:app-server-schemas` 生成 `output\app-server-schema-audit\20260704-141839\audit-summary.json`；命令因已知 schema drift 返回 1，并输出 “Exit code 1 means review is required, not that generation failed.”。
- 2026-07-04 摘要更新：`node scripts\update-app-server-schema-audit-summary.mjs` 通过，输出 `Schema audit summary updated: docs\app-server-schema-audit-summary.json`，来源为 `output\app-server-schema-audit\20260704-141839\audit-summary.json`。

---

### Feature: Release gate 直接执行 server module smoke

#### Prerequisites
- 当前仓库包含 `scripts/verify-release.ps1`、`scripts/verify-server-modules.mjs` 和 `src/server/transcriptionRoute.ts`。
- 本机可运行 `node`、PowerShell 和已有构建产物 `dist-cli/index.js`。

#### Steps
1. 执行 `node scripts\verify-server-modules.mjs`。
2. 确认 server module smoke 编译列表包含 `src/server/transcriptionRoute.ts`。
3. 执行 `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SkipPackageSmoke -SchemaAudit skip`。
4. 确认 release gate 的 `Server module smoke` 阶段直接输出 `Compile server module smoke` 和 `Run server module smoke`，不再通过 `npm run verify:server-modules` 包装。
5. 确认 release verifier 初始化 `output\npm-cache` 作为 npm verification cache，并关闭 npm update notifier/fund/audit 噪声。
6. 确认后续 CLI smoke、CLI CJS launcher smoke 和 schema audit skip 正常完成。

#### Expected Results
- `transcriptionRoute.ts` 被 TypeScript server module smoke 覆盖，避免路由拆分后只被 release zip 清单覆盖、未被编译 smoke 覆盖。
- Release gate 的 server module smoke 不依赖 npm 全局日志清理状态；即使 npm 包装层因旧日志 EPERM 失败，也不会污染这一阶段结果。
- Release gate 中仍需调用 npm 的 build/package dry-run 阶段使用仓库内 `output\npm-cache`，不读取或清理全局 `D:\nvm\node_global\_logs`。
- 快速 release gate 输出 `Release verification completed.`。

#### Rollback/Cleanup Notes
- 如需回滚，撤销 `scripts/verify-release.ps1`、`scripts/verify-server-modules.mjs`、`scripts/verify-governance.ps1` 和本节测试记录。

#### Regression Evidence
- 2026-07-04 Server module smoke：`node scripts\verify-server-modules.mjs` 通过，输出 `server module smoke ok`，并通过更新后的 include 列表编译 `src/server/transcriptionRoute.ts`。
- 2026-07-04 Release gate 快速路径：`node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SkipPackageSmoke -SchemaAudit skip` 通过，输出 `server module smoke ok`、`cli cjs launcher smoke ok` 和 `Release verification completed.`。
- 2026-07-04 Release package / npm smoke：`node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` 通过，输出 `Release artifact checksum verification passed.`、`release package smoke ok`、`npm package smoke ok` 和 `Release verification completed.`，未再出现全局 npm 日志 EPERM。
- 2026-07-04 完整 Release gate：`node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SchemaAudit skip` 通过，包含 `vue-tsc --noEmit`、Vite build、`tsup` CLI 构建、server module smoke、CLI help smoke、CLI CJS launcher smoke、Release package smoke、artifact checksum smoke 和 NPM package smoke；Vite 仍有既有 large chunk warning。

#### Regression Evidence
- 2026-07-04 官方文档/Schema 核对：Codex manual helper 返回 `local manual was already current`；manual 的 Auto-review 章节确认 auto-review 只替换审批 reviewer，不扩大 sandbox、network 或 filesystem 权限；raw schema audit `output\app-server-schema-audit\20260703-193751` 显示 `item/autoApprovalReview/started` 和 `item/autoApprovalReview/completed` 为官方 notification，`GuardianApprovalReview` 与对应 notification payload 标注 `[UNSTABLE]`。
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`，覆盖 Auto-review 通知已知分类、started/completed 记录、status/risk/action 类型、duration、`requestPermissions`、独立 `networkAccess` 与独立 `applyPatch` 的权限请求标记、文件数量统计、command/cwd/network target/reason/rationale 不外泄和 clear。
- 2026-07-04 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建；Vite 仍有既有 large chunk warning。
- 2026-07-04 治理门禁：`npm.cmd run verify:governance` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate 快速路径：`npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipCliSmoke -SkipPackageSmoke -SchemaAudit skip` 通过，覆盖 whitespace、package parse、governance docs 和 server module smoke；server smoke 仍输出预期的合成 slow RPC / queue warning。

---

### Feature: App Server Windows sandbox 通知诊断可见

#### Prerequisites
- 当前仓库包含 `src/server/appServerNotificationDiagnostics.ts`、`src/components/content/DiagnosticsPanel.vue` 和最近 raw schema audit 输出 `output\app-server-schema-audit\20260703-193751`。
- 本机 raw schema audit 已确认 `windows/worldWritableWarning` 和 `windowsSandbox/setupCompleted` 为官方 App Server notification methods。

#### Steps
1. 检查 raw schema audit，确认 `ServerNotification.ts` 包含 `windows/worldWritableWarning` 与 `windowsSandbox/setupCompleted`，并确认 `WindowsWorldWritableWarningNotification.ts` 的 `samplePaths` 不应原样暴露到诊断 API。
2. 执行 `git diff --check`。
3. 执行 `npm.cmd run verify:server-modules`。
4. 执行 `npm.cmd run build`。
5. 执行 `npm.cmd run verify:governance`。
6. 执行 `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipCliSmoke -SkipPackageSmoke -SchemaAudit skip`。

#### Expected Results
- 服务端 notification diagnostics 把 `windows/worldWritableWarning` 和 `windowsSandbox/setupCompleted` 视为已知通知，不计入 unknown notification。
- `/codex-api/health` 和 `/codex-api/diagnostics` 的 `notificationDiagnostics.recentWindowsSandboxNotifications` 只包含 mode、success、error、samplePathCount、extraCount、failedScan 等脱敏字段，不暴露具体本机路径。
- 诊断中心展示“Windows 安全”卡片；这些通知只作为只读诊断信号，不自动触发 `windowsSandbox/setupStart`。

#### Rollback/Cleanup Notes
- 如需回滚，撤销 `src/server/appServerNotificationDiagnostics.ts`、`src/components/content/DiagnosticsPanel.vue`、`scripts/server-module-smoke.ts`、`docs/app-server-protocol-matrix.zh-CN.md`、`docs/changelog.zh-CN.md` 和本节测试记录中的相关改动。

#### Regression Evidence
- 2026-07-04 官方文档/Schema 核对：Codex manual helper 返回 `local manual was already current`；raw schema audit `output\app-server-schema-audit\20260703-193751\typescript\ServerNotification.ts` 显示 `windows/worldWritableWarning` 与 `windowsSandbox/setupCompleted` 为官方 `ServerNotification` method，`WindowsWorldWritableWarningNotification.ts` 包含 `samplePaths`、`extraCount`、`failedScan`，测试确认诊断输出不包含原始 sample path。
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`，覆盖 Windows sandbox 通知已知分类、脱敏 recent Windows sandbox notification 记录、路径不外泄和 clear。
- 2026-07-04 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建；Vite 仍有既有 large chunk warning。
- 2026-07-04 治理门禁：`npm.cmd run verify:governance` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate 快速路径：`npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipCliSmoke -SkipPackageSmoke -SchemaAudit skip` 通过，覆盖 whitespace、package parse、governance docs 和 server module smoke；server smoke 仍输出预期的合成 slow RPC / queue warning。

---

### Feature: App Server Windows sandbox readiness 只读诊断

#### Prerequisites
- 当前仓库包含 `src/server/windowsSandboxDiagnostics.ts`、`src/server/codexAppServerBridge.ts`、`src/components/content/DiagnosticsPanel.vue` 和最近 raw schema audit 输出 `output\app-server-schema-audit\20260703-193751`。
- 本机 raw schema audit 已确认 `ClientRequest.ts` 包含 `windowsSandbox/readiness`，`WindowsSandboxReadinessResponse.ts` 返回 `status`，`WindowsSandboxReadiness.ts` 枚举 `ready`、`notConfigured`、`updateRequired`。

#### Steps
1. 执行官方 manual helper：`node %USERPROFILE%\.codex\skills\.system\openai-docs\scripts\fetch-codex-manual.mjs`。
2. 检查 raw schema audit，确认 `windowsSandbox/readiness` 是官方 App Server client request，且 `setupStart` 是独立 method。
3. 执行 `git diff --check`。
4. 执行 `npm.cmd run verify:server-modules`。
5. 执行 `npm.cmd run build`。
6. 执行 `npm.cmd run verify:governance`。
7. 执行 `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipCliSmoke -SkipPackageSmoke -SchemaAudit skip`。

#### Expected Results
- `/codex-api/health` 和 `/codex-api/diagnostics` 返回 `windowsSandbox` readiness 快照，包含 `status`、`available`、`checkedAtIso`、`source` 和脱敏 `error`。
- Windows 平台只调用只读 `windowsSandbox/readiness`，并通过 TTL 缓存避免诊断页 15 秒刷新反复打 RPC；非 Windows 平台返回 `unsupported`。
- 诊断中心“Windows 安全”卡片展示 readiness 状态、来源、检查时间和错误；不会提供或触发 `windowsSandbox/setupStart`。

#### Rollback/Cleanup Notes
- 如需回滚，撤销 `src/server/windowsSandboxDiagnostics.ts`、`src/server/codexAppServerBridge.ts`、`src/components/content/DiagnosticsPanel.vue`、`scripts/server-module-smoke.ts`、`docs/app-server-protocol-matrix.zh-CN.md`、`docs/changelog.zh-CN.md` 和本节测试记录中的相关改动。

#### Regression Evidence
- 2026-07-04 官方文档/Schema 核对：Codex manual helper 返回 `local manual was already current`；raw schema audit `output\app-server-schema-audit\20260703-193751\typescript\ClientRequest.ts` 显示 `windowsSandbox/setupStart` 与 `windowsSandbox/readiness` 为独立官方 client request，readiness 的 `params: undefined`；`WindowsSandboxReadiness.ts` 枚举 `ready`、`notConfigured`、`updateRequired`，`WindowsSandboxReadinessResponse.ts` 返回 `{ status: WindowsSandboxReadiness }`。
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`，覆盖 readiness payload 归一化、未知状态降级、错误长度限制、非支持平台快照、TTL 缓存命中、TTL 过期刷新和 RPC 失败降级。
- 2026-07-04 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建；Vite 仍有既有 large chunk warning。
- 2026-07-04 治理门禁：`npm.cmd run verify:governance` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate 快速路径：`npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipCliSmoke -SkipPackageSmoke -SchemaAudit skip` 通过，覆盖 whitespace、package parse、governance docs 和 server module smoke；server smoke 仍输出预期的合成 slow RPC / queue warning。

---

### Feature: App Server Hooks 只读诊断可见

#### Prerequisites
- 当前仓库包含 `src/server/appServerHookDiagnostics.ts`、`src/server/appServerNotificationDiagnostics.ts`、`src/server/codexAppServerBridge.ts`、`src/components/content/DiagnosticsPanel.vue` 和最近 raw schema audit 输出 `output\app-server-schema-audit\20260703-193751`。
- 本机 raw schema audit 已确认 `ClientRequest.ts` 包含 `hooks/list`，`HooksListParams.ts` 的参数为 `cwds?: string[]`，`HooksListResponse.ts` 返回 `data: HooksListEntry[]`。
- 官方 Codex manual 已确认 hooks 默认启用、非托管 command hooks 需要 review/trust，且 hook 配置可能来自用户、项目、系统或插件来源。

#### Steps
1. 执行官方 manual helper：`node %USERPROFILE%\.codex\skills\.system\openai-docs\scripts\fetch-codex-manual.mjs`。
2. 检查 raw schema audit，确认 `hooks/list`、`hook/started`、`hook/completed`、`HookMetadata` 和 `HookRunSummary` 字段。
3. 执行 `git diff --check`。
4. 执行 `npm.cmd run verify:server-modules`。
5. 执行 `npm.cmd run build`。
6. 执行 `npm.cmd run verify:governance`。
7. 执行 `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipCliSmoke -SkipPackageSmoke -SchemaAudit skip`。

#### Expected Results
- `/codex-api/health` 和 `/codex-api/diagnostics` 返回 `hookDiagnostics` 只读快照，包含 hook 数量、启用/禁用、managed、untrusted/modified、warning/error 计数、按 event/source/trust 聚合和脱敏 recent hooks。
- 服务端 notification diagnostics 把 `hook/started` 和 `hook/completed` 视为已知通知，不计入 unknown notification，并只记录 run id、event、handler、status、duration、source 和 output entry 数量。
- 诊断中心展示 “Hooks” 卡片；不暴露 hook command、sourcePath、currentHash 或完整输出，也不执行、编辑、trust 或 disable hook。

#### Rollback/Cleanup Notes
- 如需回滚，撤销 `src/server/appServerHookDiagnostics.ts`、`src/server/appServerNotificationDiagnostics.ts`、`src/server/codexAppServerBridge.ts`、`src/components/content/DiagnosticsPanel.vue`、`scripts/server-module-smoke.ts`、`docs/app-server-protocol-matrix.zh-CN.md`、`docs/changelog.zh-CN.md` 和本节测试记录中的相关改动。

#### Regression Evidence
- 2026-07-04 官方文档/Schema 核对：Codex manual helper 返回 `local manual was already current`；官方 manual 的 Hooks 章节说明 hooks 默认启用，非托管 command hooks 需 review/trust；raw schema audit `output\app-server-schema-audit\20260703-193751\typescript\ClientRequest.ts` 显示 `hooks/list` 为官方 client request，`HooksListParams.ts` 只有 `cwds?: string[]`，`HooksListResponse.ts` 返回 `{ data: HooksListEntry[] }`，`HookMetadata.ts` 包含 `command`、`sourcePath`、`currentHash` 等必须脱敏字段，`ServerNotification.ts` 包含 `hook/started` 与 `hook/completed`。
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`，覆盖 `hooks/list` 汇总、command/sourcePath/currentHash/key 不外泄、hook started/completed 已知通知、运行通知脱敏、TTL 缓存命中、TTL 过期刷新和 RPC 失败降级。
- 2026-07-04 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建；Vite 仍有既有 large chunk warning。
- 2026-07-04 治理门禁：`npm.cmd run verify:governance` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate 快速路径：`npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipCliSmoke -SkipPackageSmoke -SchemaAudit skip` 通过，覆盖 whitespace、package parse、governance docs 和 server module smoke；server smoke 仍输出预期的合成 slow RPC / queue warning。

---

### Feature: App Server 协议告警通知脱敏诊断

#### Prerequisites
- 当前仓库包含 `src/server/appServerNotificationDiagnostics.ts`、`src/components/content/DiagnosticsPanel.vue` 和最近 raw schema audit 输出 `output\app-server-schema-audit\20260703-193751`。
- 本机 raw schema audit 已确认 `ServerNotification.ts` 包含 `warning`、`guardianWarning`、`deprecationNotice`、`configWarning`、`fs/changed` 和 `externalAgentConfig/import/completed`。

#### Steps
1. 执行官方 manual helper：`node %USERPROFILE%\.codex\skills\.system\openai-docs\scripts\fetch-codex-manual.mjs`。
2. 检查 raw schema audit，确认 warning/config/fs/import notification 字段，尤其是 `configWarning.path` 与 `fs/changed.changedPaths` 需要脱敏。
3. 执行 `git diff --check`。
4. 执行 `npm.cmd run verify:server-modules`。
5. 执行 `npm.cmd run build`。
6. 执行 `npm.cmd run verify:governance`。
7. 执行 `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipCliSmoke -SkipPackageSmoke -SchemaAudit skip`。

#### Expected Results
- 服务端 notification diagnostics 把这些官方通知视为已知通知，不计入 unknown notification。
- `/codex-api/health` 和 `/codex-api/diagnostics` 的 `notificationDiagnostics.recentProtocolAlerts` 只包含 method、时间、threadId、摘要、details、`hasPath`、`changedPathCount` 和 watchId 等脱敏字段。
- 诊断中心展示“协议告警”卡片；不暴露 `configWarning.path`、`fs/changed.changedPaths`，也不开放 App Server fs API 或外部 agent import 操作。

#### Rollback/Cleanup Notes
- 如需回滚，撤销 `src/server/appServerNotificationDiagnostics.ts`、`src/components/content/DiagnosticsPanel.vue`、`scripts/server-module-smoke.ts`、`docs/app-server-protocol-matrix.zh-CN.md`、`docs/changelog.zh-CN.md` 和本节测试记录中的相关改动。

#### Regression Evidence
- 2026-07-04 官方文档/Schema 核对：Codex manual helper 返回 `local manual was already current`；raw schema audit `output\app-server-schema-audit\20260703-193751\typescript\ServerNotification.ts` 显示 `warning`、`guardianWarning`、`deprecationNotice`、`configWarning`、`fs/changed` 和 `externalAgentConfig/import/completed` 为官方 notification；`ConfigWarningNotification.ts` 包含可选 `path`，`FsChangedNotification.ts` 包含 `changedPaths`，测试确认这些路径不进入诊断输出。
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`，覆盖协议告警通知已知分类、config path 脱敏、fs changed path 计数、external agent import completed 只读记录和 clear。
- 2026-07-04 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建；Vite 仍有既有 large chunk warning。
- 2026-07-04 治理门禁：`npm.cmd run verify:governance` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate 快速路径：`npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipCliSmoke -SkipPackageSmoke -SchemaAudit skip` 通过，覆盖 whitespace、package parse、governance docs 和 server module smoke；server smoke 仍输出预期的合成 slow RPC / queue warning。

---

### Feature: App Server 模型通知诊断可见

#### Prerequisites
- 当前仓库包含 `src/server/appServerNotificationDiagnostics.ts`、`src/server/appServerNotificationReplay.ts`、`src/components/content/DiagnosticsPanel.vue` 和最近 raw schema audit 输出 `output\app-server-schema-audit\20260703-193751`。
- 本机 raw schema audit 已确认 `model/rerouted` 和 `model/verification` 为官方 App Server notification methods。

#### Steps
1. 检查 raw schema audit，确认 `ServerNotification.ts` 包含 `model/rerouted` 和 `model/verification`，并确认对应 payload 字段只需要记录模型、reason、verification 数量等脱敏诊断字段。
2. 执行 `git diff --check`。
3. 执行 `npm.cmd run verify:server-modules`。
4. 执行 `npm.cmd run build`。
5. 执行 `npm.cmd run verify:governance`。
6. 执行 `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipCliSmoke -SkipPackageSmoke -SchemaAudit skip`。

#### Expected Results
- 服务端 notification diagnostics 把 `model/rerouted` 和 `model/verification` 视为已知通知，不计入 unknown notification。
- `/codex-api/health` 和 `/codex-api/diagnostics` 的 `notificationDiagnostics.recentModelNotifications` 只包含脱敏字段，不暴露完整 notification params。
- 诊断中心展示“模型通知”卡片；模型 reroute/verification 只作为只读诊断信号，不改写线程内容、运行态或用户选择模型。

#### Rollback/Cleanup Notes
- 如需回滚，撤销 `src/server/appServerNotificationDiagnostics.ts`、`src/server/appServerNotificationReplay.ts`、`src/components/content/DiagnosticsPanel.vue`、`scripts/server-module-smoke.ts`、`docs/app-server-protocol-matrix.zh-CN.md`、`docs/changelog.zh-CN.md` 和本节测试记录中的相关改动。

#### Regression Evidence
- 2026-07-04 官方文档/Schema 核对：OpenAI App Server 文档仍是当前对接入口；raw schema audit `output\app-server-schema-audit\20260703-193751\typescript\ServerNotification.ts` 显示 `model/rerouted` 和 `model/verification` 为官方 `ServerNotification` method，`ModelReroutedNotification.ts` 包含 `fromModel`、`toModel`、`reason`，`ModelVerificationNotification.ts` 包含 `verifications`。
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`，覆盖模型通知已知分类、脱敏 recent model notification 记录、clear 以及 replay params 传递。
- 2026-07-04 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建；Vite 仍有既有 large chunk warning。
- 2026-07-04 治理门禁：`npm.cmd run verify:governance` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate 快速路径：`npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipCliSmoke -SkipPackageSmoke -SchemaAudit skip` 通过，覆盖 whitespace、package parse、governance docs 和 server module smoke；server smoke 仍输出预期的合成 slow RPC / queue warning。

---

### Feature: App/MCP/RateLimit 状态通知兼容

#### Prerequisites
- 当前仓库包含 `src/composables/useDesktopState.ts`、`src/server/appServerNotificationDiagnostics.ts` 和最近 raw schema audit 输出 `output\app-server-schema-audit\20260703-193751`。
- 本机 raw schema audit 已确认 `app/list/updated`、`mcpServer/startupStatus/updated` 和 `account/rateLimits/updated` 为官方 App Server notification methods。

#### Steps
1. 检查 raw schema audit，确认 `ServerNotification.ts` 包含 `app/list/updated`、`mcpServer/startupStatus/updated` 和 `account/rateLimits/updated`。
2. 执行 `git diff --check`。
3. 执行 `npm.cmd run verify:server-modules`。
4. 执行 `npm.cmd run build`。
5. 执行 `npm.cmd run verify:governance`。
6. 执行 `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipCliSmoke -SkipPackageSmoke -SchemaAudit skip`。

#### Expected Results
- `app/list/updated` 和 `mcpServer/startupStatus/updated` 只触发 composer 插件/App 列表防抖刷新，不触发线程消息或线程列表同步。
- `mcpServer/oauthLogin/completed` 继续刷新 composer 插件/App 列表，但走同一防抖路径。
- `account/rateLimits/updated` 继续触发现有限额刷新，并在通知诊断中作为已知 method。
- 服务端 notification diagnostics 不再把这些官方状态通知计入 unknown notification。

#### Rollback/Cleanup Notes
- 如需回滚，撤销 `src/composables/useDesktopState.ts`、`src/server/appServerNotificationDiagnostics.ts`、`scripts/server-module-smoke.ts`、`docs/app-server-protocol-matrix.zh-CN.md`、`docs/changelog.zh-CN.md` 和本节测试记录中的相关改动。

#### Regression Evidence
- 2026-07-04 官方文档/Schema 核对：OpenAI App Server 文档确认 `app/list/updated` 会在 accessible apps 或 directory apps 加载完成后发送最新合并 App 列表；raw schema audit `output\app-server-schema-audit\20260703-193751\typescript\ServerNotification.ts` 显示 `mcpServer/startupStatus/updated`、`account/rateLimits/updated`、`app/list/updated` 和 `mcpServer/oauthLogin/completed` 都是官方 `ServerNotification` method。
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`，覆盖新增官方通知 method 的已知分类。
- 2026-07-04 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建；Vite 仍有既有 large chunk warning。
- 2026-07-04 治理门禁：`npm.cmd run verify:governance` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate 快速路径：`npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipCliSmoke -SkipPackageSmoke -SchemaAudit skip` 通过，覆盖 whitespace、package parse、governance docs 和 server module smoke；server smoke 仍输出预期的合成 slow RPC / queue warning。

---

### Feature: App Server skills/changed 通知兼容

#### Prerequisites
- 当前仓库包含 `src/composables/useDesktopState.ts` 和 `src/server/appServerNotificationDiagnostics.ts`。
- 本机已通过官方 Codex manual 或 raw schema audit 确认 `skills/changed` 是 `SkillsChangedNotification` 的 method。

#### Steps
1. 执行官方 manual helper：`node %USERPROFILE%\.codex\skills\.system\openai-docs\scripts\fetch-codex-manual.mjs`。
2. 检查 raw schema audit，确认 `SkillsChangedNotification` 的说明要求客户端把它作为 invalidation signal，并重新运行 `skills/list`。
3. 执行 `git diff --check`。
4. 执行 `npm.cmd run verify:server-modules`。
5. 执行 `npm.cmd run build`。
6. 执行 `npm.cmd run verify:governance`。
7. 执行 `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipCliSmoke -SkipPackageSmoke -SchemaAudit skip`。

#### Expected Results
- 前端通知流收到 `skills/changed` 后防抖调用 `refreshSkills()`，按当前选中会话 cwd 重新请求 `skills/list`。
- `skills/changed` 不触发线程消息或线程列表同步，不打断当前对话流。
- 服务端通知诊断把 `skills/changed` 视为已知官方通知，不再计入 unknown notification。
- 协议矩阵和 changelog 已记录该兼容行为。

#### Rollback/Cleanup Notes
- 如需回滚，撤销 `src/composables/useDesktopState.ts`、`src/server/appServerNotificationDiagnostics.ts`、`scripts/server-module-smoke.ts`、`docs/app-server-protocol-matrix.zh-CN.md`、`docs/changelog.zh-CN.md` 和本节测试记录中的相关改动。

#### Regression Evidence
- 2026-07-04 官方文档/Schema 核对：`node %USERPROFILE%\.codex\skills\.system\openai-docs\scripts\fetch-codex-manual.mjs` 确认 Codex manual 当前；raw schema audit `output\app-server-schema-audit\20260703-193751` 显示 `skills/changed` 对应 `SkillsChangedNotification`，说明为 invalidation signal，客户端应重新运行 `skills/list`。
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 Server module smoke：`npm.cmd run verify:server-modules` 通过，输出 `server module smoke ok`，覆盖 `skills/changed` 已知通知分类。
- 2026-07-04 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建；Vite 仍有既有 large chunk warning。
- 2026-07-04 治理门禁：`npm.cmd run verify:governance` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate 快速路径：`npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipCliSmoke -SkipPackageSmoke -SchemaAudit skip` 通过，覆盖 whitespace、package parse、governance docs 和 server module smoke；server smoke 仍输出预期的合成 slow RPC / queue warning。

---

### Feature: Release 包测试手册与治理资产强制校验

#### Prerequisites
- 仓库已完成前端和 CLI 构建，或可运行完整 `npm.cmd run verify:release` 触发构建。
- `scripts/package-release.ps1`、`scripts/verify-release.ps1`、`scripts/verify-governance.ps1` 和 `tests.md` 均在当前工作区。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:governance`。
3. 执行 `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip`。
4. 检查 release package smoke 阶段是否生成 `output/release-package-smoke/CX-Codex-verify-smoke.zip` 与 `.sha256`。
5. 打开生成的 zip，确认包含 `tests.md`、`scripts/package-release.ps1`、`scripts/verify-governance.ps1`、`scripts/verify-release.ps1`、`docs/changelog.zh-CN.md`、`docs/operations-plan.zh-CN.md`、`docs/roadmap.zh-CN.md`、`src\server\codexAppServerBridge.ts` 和 `src\server\transcriptionRoute.ts`。

#### Expected Results
- `tests.md` 是 release 打包必备资产，缺失时 `package-release.ps1` 直接失败，而不是静默跳过。
- `verify:release` 的 release package smoke 会在 zip 缺少测试手册、治理脚本或关键治理文档时失败。
- `verify:release` 的 release package smoke 会在 zip 缺少 bridge 主入口或新抽出的转写路由模块时失败。
- `verify:governance` 会校验 release smoke 的必检列表和打包清单，避免后续维护时误删这些开源复核入口。
- checksum 文件引用生成的 zip 文件名，且 SHA256 与 zip 实际内容一致。

#### Rollback/Cleanup Notes
- 可删除 `output/release-package-smoke/` 下的本地 smoke 产物；不影响源码。
- 如需回滚，撤销 `scripts/package-release.ps1`、`scripts/verify-release.ps1`、`scripts/verify-governance.ps1`、`docs/changelog.zh-CN.md` 和本节测试记录的改动。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 治理门禁：`npm.cmd run verify:governance` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release package smoke：`npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip` 通过，输出 `release package smoke ok` 和 `Release verification completed.`；zip 必检清单包含 `src\server\codexAppServerBridge.ts` 和 `src\server\transcriptionRoute.ts`。

---

### Feature: Release gate 复用 artifact checksum verifier

#### Prerequisites
- `scripts/verify-release.ps1`、`scripts/package-release.ps1` 和 `scripts/verify-release-artifacts.ps1` 存在。
- 本地已有构建产物，或可运行完整 `npm.cmd run verify:release` 生成构建产物。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:governance`。
3. 执行 `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip`。
4. 在 release gate 输出中确认出现 `==> Release artifact checksum smoke`。
5. 确认输出包含 `Release artifact checksum verification passed.`。
6. 再次执行同一条 release gate，确认不会因上一次生成的 `output/release-package-smoke` 产物残留而失败。
7. 确认后续仍输出 `release package smoke ok` 和 `npm package smoke ok`。

#### Expected Results
- `verify:release` 的 package smoke 生成 zip 与 `.sha256` 后，会调用 `scripts/verify-release-artifacts.ps1` 校验产物。
- 本地 release gate 和 GitHub Release workflow 复用同一套 zip/APK checksum 校验逻辑。
- 每次 package smoke 前会先通过 `Resolve-ReleasePackageSmokeDir` 将输出目录规范化，并确认目标仍位于仓库 `output` 目录下，然后再清理固定的 `output/release-package-smoke` 目录，避免旧 zip/APK 残留污染 artifact checksum 验证。
- `-SkipPackageSmoke` 会同时跳过 Release package smoke、Release artifact checksum smoke 和 NPM package smoke。
- `verify:governance` 会阻止 release verifier 漏掉 artifact checksum smoke、固定 smoke 输出目录 helper 和路径边界检查的关键文案。

#### Rollback/Cleanup Notes
- 可删除 `output/release-package-smoke/` 下的本地 smoke 产物；不影响源码。
- 如需回滚，撤销 `scripts/verify-release.ps1`、`scripts/verify-governance.ps1`、`docs/changelog.zh-CN.md` 和本节测试记录的改动。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 治理门禁：`npm.cmd run verify:governance` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate：`npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip` 通过，输出 `Release artifact checksum verification passed.`、`release package smoke ok`、`npm package smoke ok` 和 `Release verification completed.`；连续第二次执行同一命令仍通过，确认 smoke 目录会先通过 `Resolve-ReleasePackageSmokeDir` 完成路径边界检查，再清理并打包。

---

### Feature: 当前累计改动完整 Release gate 验证

#### Prerequisites
- 当前工作区包含 App Server 协议诊断、OpenAI 转写、release governance 和测试文档相关未提交改动。
- `dist/` 与 `dist-cli/` 可由当前源码重新生成。

#### Steps
1. 执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
2. 确认输出包含 `Build frontend and CLI`。
3. 确认前端构建执行 `vue-tsc --noEmit && vite build` 并成功生成 `dist/index.html`。
4. 确认 CLI 构建执行 `tsup` 并成功生成 `dist-cli/index.js`。
5. 确认后续输出包含 `server module smoke ok`、`cli cjs launcher smoke ok`、`Release artifact checksum verification passed.`、`release package smoke ok`、`npm package smoke ok` 和 `Release verification completed.`。

#### Expected Results
- 当前累计改动可以通过完整 release gate，而不是只依赖 `-SkipBuild` 快速路径。
- 构建后的 Web/CLI 产物可被 release package smoke 和 npm package smoke 识别。
- Vite large chunk warning 仍属于现有体积提示，不阻断 release gate。
- server module smoke 中的合成 slow RPC / queue warning 仍为预期测试场景，最终输出 `server module smoke ok`。

#### Rollback/Cleanup Notes
- 可删除 `output/release-package-smoke/` 下的本地 smoke 产物；`dist/` 和 `dist-cli/` 是构建输出，可按需重新生成。
- 如需回滚，撤销本节测试记录；不涉及源码逻辑改动。

#### Regression Evidence
- 2026-07-04 完整 Release gate：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 `vue-tsc --noEmit`、`vite build`、`tsup`、server module smoke、CLI help smoke、CLI CJS launcher smoke、Release package smoke、Release artifact checksum smoke、NPM package smoke 和 schema audit skip。
- 2026-07-04 构建输出：Vite 生成 `dist/index.html`，tsup 生成 `dist-cli\index.js`；Vite 仍有既有 large chunk warning。
- 2026-07-04 Release smoke 输出：`server module smoke ok`、`cli cjs launcher smoke ok`、`Release artifact checksum verification passed.`、`release package smoke ok`、`npm package smoke ok` 和 `Release verification completed.`。

---

### Feature: GitHub Release 正文版本中性治理

#### Prerequisites
- `.github/release-body.md` 存在，并被 `.github/workflows/release.yml` 的 `body_path` 使用。
- 当前仓库包含 `docs/changelog.zh-CN.md`、`docs/security-hardening.zh-CN.md`、`docs/openai-docs-review.zh-CN.md` 和 `docs/app-server-protocol-matrix.zh-CN.md`。

#### Steps
1. 打开 `.github/release-body.md`。
2. 确认标题为 `CX-Codex Release`，正文不包含固定旧版本号，例如 `2.2.7`。
3. 确认正文说明 release zip、APK、debug APK fallback、checksum、release workflow 验证和本地 schema audit 建议。
4. 执行 `git diff --check`。
5. 执行 `npm.cmd run verify:governance`。
6. 执行 `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip`。

#### Expected Results
- GitHub Release 正文可复用于任意 tag，不会把旧版本号或旧版本卖点发布到新 Release。
- Release 正文包含 changelog、安全、OpenAI/Codex App Server 兼容文档入口。
- Release 正文说明 zip/APK/checksum 资产用途、workflow 验证步骤和本地 schema audit 要求。
- `verify:governance` 会阻止 `.github/release-body.md` 中残留固定旧版本号或旧版说明标题。

#### Rollback/Cleanup Notes
- 无运行产物需要清理。
- 如需回滚，撤销 `.github/release-body.md`、`scripts/verify-governance.ps1`、`docs/changelog.zh-CN.md` 和本节测试记录的改动。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 治理门禁：`npm.cmd run verify:governance` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate：`npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip` 通过，输出 `release package smoke ok`、`npm package smoke ok` 和 `Release verification completed.`。

---

### Feature: RELEASE.md 发版手册与自动门禁一致性

#### Prerequisites
- `RELEASE.md`、`scripts/verify-release.ps1`、`scripts/verify-release-artifacts.ps1` 和 `scripts/verify-governance.ps1` 存在。
- 本地已有构建产物，或可运行完整 `npm.cmd run verify:release` 生成构建产物。

#### Steps
1. 打开 `RELEASE.md`。
2. 确认本地检查清单说明 `verify:release` 会执行 Release package smoke 和 NPM package smoke。
3. 确认 `RELEASE.md` 说明 `npm pack --dry-run --json` 的 npm 包 dry-run 校验边界。
4. 确认最终资产检查步骤包含 `npm.cmd run verify:release-artifacts -- -OutputDir artifacts`。
5. 执行 `git diff --check`。
6. 执行 `npm.cmd run verify:governance`。
7. 执行 `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip`。

#### Expected Results
- `RELEASE.md` 描述的本地发版步骤与 `verify-release.ps1` 当前真实门禁一致。
- 手册明确 `-SkipPackageSmoke` 会同时跳过 Release package smoke 和 NPM package smoke，正式发版不能使用。
- 手册要求最终发布前运行 artifact checksum 验证，覆盖 zip / APK 与 `.sha256`。
- `verify:governance` 会阻止发版手册遗漏 NPM package smoke、npm dry-run 或 artifact checksum 验证说明。

#### Rollback/Cleanup Notes
- 无运行产物需要清理。
- 如需回滚，撤销 `RELEASE.md`、`scripts/verify-governance.ps1`、`docs/changelog.zh-CN.md` 和本节测试记录的改动。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 治理门禁：`npm.cmd run verify:governance` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate：`npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip` 通过，输出 `release package smoke ok`、`npm package smoke ok` 和 `Release verification completed.`。

---

### Feature: npm 发布包 dry-run 内容门禁

#### Prerequisites
- 仓库已完成前端和 CLI 构建，确保 `dist/index.html` 与 `dist-cli/index.js` 存在。
- `package.json` 的 `files` 字段仍用于限制 npm 发布包范围。

#### Steps
1. 执行 `git diff --check`。
2. 执行 `npm.cmd run verify:governance`。
3. 执行 `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip`。
4. 在 release gate 输出中确认出现 `==> NPM package smoke` 和 `npm package smoke ok`。
5. 如需单独复核，执行 `npm.cmd pack --dry-run --json`，检查文件列表。

#### Expected Results
- npm dry-run 文件列表包含 `package.json`、`README.md`、`LICENSE`、`dist/index.html`、`dist-cli/index.js` 和 `docs/app-server-schema-audit-summary.json`。
- npm dry-run 文件列表不包含 `src/server/codexAppServerBridge.ts`、`scripts/verify-release.ps1` 或 `tests.md`。
- `verify:governance` 会校验 release verifier 中保留 npm package smoke 的关键断言，避免发布包门禁被后续维护误删。

#### Rollback/Cleanup Notes
- `npm pack --dry-run --json` 不生成 `.tgz` 产物，无需清理。
- 如需回滚，撤销 `scripts/verify-release.ps1`、`scripts/verify-governance.ps1`、`docs/changelog.zh-CN.md` 和本节测试记录的改动。

#### Regression Evidence
- 2026-07-04 静态验证：`git diff --check` 通过。
- 2026-07-04 治理门禁：`npm.cmd run verify:governance` 通过，输出 `Governance docs check passed.`。
- 2026-07-04 Release gate：`npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip` 通过，输出 `npm package smoke ok` 和 `Release verification completed.`。

### Feature: App Server realtime 实验通知脱敏诊断

#### Prerequisites
- 当前仓库包含 `src/server/appServerNotificationDiagnostics.ts`、`src/components/content/DiagnosticsPanel.vue` 和最近 raw schema audit 输出 `output\app-server-schema-audit\20260703-193751`。
- 本机 raw schema audit 已确认 `thread/realtime/started`、`thread/realtime/itemAdded`、`thread/realtime/transcript/delta`、`thread/realtime/transcript/done`、`thread/realtime/outputAudio/delta`、`thread/realtime/sdp`、`thread/realtime/error` 和 `thread/realtime/closed` 为 EXPERIMENTAL App Server notifications。
- 当前语音能力仍走 OpenAI 官方 audio transcription API，不启用 App Server realtime 产品入口。

#### Steps
1. 执行官方 manual helper：`node %USERPROFILE%\.codex\skills\.system\openai-docs\scripts\fetch-codex-manual.mjs`。
2. 检查 raw schema audit，确认 realtime transcript 的 `delta/text`、audio 的 `data`、WebRTC 的 `sdp` 属于不能进入诊断快照的敏感 payload。
3. 执行 `git diff --check`。
4. 执行 `npm.cmd run verify:server-modules`。
5. 执行 `npm.cmd run build`。
6. 执行 `npm.cmd run verify:governance`。
7. 执行 `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SkipCliSmoke -SkipPackageSmoke -SchemaAudit skip`。

#### Expected Results
- 服务端 notification diagnostics 把 `thread/realtime/*` 视为已知实验通知，不计入 unknown notification。
- `/codex-api/health` 和 `/codex-api/diagnostics` 的 `notificationDiagnostics.recentRealtimeNotifications` 只包含 method、时间、threadId、itemId/messageId、eventCount、byteCount、errorCode 和 errorMessage。
- transcript 原文、audio base64 和 WebRTC SDP 不会出现在诊断 JSON、诊断中心或测试快照中。
- 诊断中心展示 “Realtime” 卡片，并明确标识为实验通知；不会提供 App Server realtime 入口或改变现有语音转写链路。

#### Rollback/Cleanup Notes
- 如需回滚，撤销 `src/server/appServerNotificationDiagnostics.ts`、`src/components/content/DiagnosticsPanel.vue`、`scripts/server-module-smoke.ts`、`docs/app-server-protocol-matrix.zh-CN.md`、`docs/changelog.zh-CN.md` 和本节测试记录中的相关改动。
---

### Feature: App Server shareable RPC read cache helper

#### Prerequisites
- Current repository includes `src/server/appServerRpcCache.ts`, `src/server/codexAppServerBridge.ts`, and `scripts/server-module-smoke.ts`.
- Dependencies are installed so TypeScript, Vite, tsup, and the server module smoke verifier can run.

#### Steps
1. Run `git diff --check`.
2. Run `node scripts\verify-server-modules.mjs`.
3. Run `node_modules\.bin\vue-tsc.cmd --noEmit`.
4. Run `node_modules\.bin\vite.cmd build`.
5. Run `node_modules\.bin\tsup.cmd`.
6. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
7. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- `AppServerProcess.rpc()` still bypasses the queue for priority-0 RPCs and still queues non-shareable RPCs directly.
- Shareable `thread/list`, `model/list`, and `thread/read` RPCs are handled through `AppServerRpcCache.executeShareableRead()`.
- Fresh cached `thread/list` and `model/list` responses return without queueing another RPC.
- Stale cached `thread/list` and `model/list` responses return immediately while a throttled background refresh updates the cache.
- Concurrent shareable `thread/read` calls with the same params reuse one in-flight promise and clear the shared-read entry after settlement.

#### Rollback/Cleanup Notes
- No runtime artifacts need cleanup beyond normal build output in `dist/`, `dist-cli/`, and `output/`.
- To roll back, revert `src/server/appServerRpcCache.ts`, `src/server/codexAppServerBridge.ts`, `scripts/server-module-smoke.ts`, and this test section.

#### Regression Evidence
- 2026-07-04 static verification: `git diff --check` passed.
- 2026-07-04 server module smoke: `node scripts\verify-server-modules.mjs` passed, including `AppServerRpcCache.executeShareableRead()` coverage for `model/list` cache writes and shared `thread/read` promise reuse.
- 2026-07-04 typecheck/build: `node_modules\.bin\vue-tsc.cmd --noEmit`, `node_modules\.bin\vite.cmd build`, and `node_modules\.bin\tsup.cmd` passed; Vite still reports the existing large chunk warning.
- 2026-07-04 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-04 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`
---

### Feature: App Server notification listener helper

#### Prerequisites
- Current repository includes `src/server/appServerNotificationListeners.ts`, `src/server/codexAppServerBridge.ts`, and `scripts/server-module-smoke.ts`.
- Dependencies are installed so TypeScript, Vite, tsup, and the server module smoke verifier can run.

#### Steps
1. Run `git diff --check`.
2. Run `node scripts\verify-server-modules.mjs`.
3. Run `node_modules\.bin\vue-tsc.cmd --noEmit`.
4. Run `node_modules\.bin\vite.cmd build`.
5. Run `node_modules\.bin\tsup.cmd`.
6. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
7. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- `AppServerProcess.onNotification()` still returns an unsubscribe function and emits each app-server notification to active listeners.
- Middleware `subscribeNotifications()` still returns an unsubscribe function and emits replayed bridge notification events to active listeners.
- Unsubscribed listeners stop receiving later notifications while remaining listeners continue receiving them.
- Clearing listener collections during middleware disposal removes active subscribers without throwing.
- Notification payload objects are forwarded unchanged.

#### Rollback/Cleanup Notes
- No runtime artifacts need cleanup beyond normal build output in `dist/`, `dist-cli/`, and `output/`.
- To roll back, revert `src/server/appServerNotificationListeners.ts`, `src/server/codexAppServerBridge.ts`, `scripts/server-module-smoke.ts`, `scripts/verify-server-modules.mjs`, and this test section.

#### Regression Evidence
- 2026-07-04 static verification: `git diff --check` passed.
- 2026-07-04 server module smoke: `node scripts\verify-server-modules.mjs` passed, including `AppServerNotificationListeners` coverage for subscribe, emit, unsubscribe, idempotent unsubscribe, and clear behavior.
- 2026-07-04 typecheck/build: `node_modules\.bin\vue-tsc.cmd --noEmit`, `node_modules\.bin\vite.cmd build`, and `node_modules\.bin\tsup.cmd` passed; Vite still reports the existing large chunk warning.
- 2026-07-04 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-04 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`
---

### Feature: App Server server-request reply response helper

#### Prerequisites
- Current repository includes `src/server/serverRequestReply.ts`, `src/server/codexAppServerBridge.ts`, and `scripts/server-module-smoke.ts`.
- Dependencies are installed so TypeScript, Vite, tsup, and the server module smoke verifier can run.

#### Steps
1. Run `git diff --check`.
2. Run `node scripts\verify-server-modules.mjs`.
3. Run `node_modules\.bin\vue-tsc.cmd --noEmit`.
4. Run `node_modules\.bin\vite.cmd build`.
5. Run `node_modules\.bin\tsup.cmd`.
6. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
7. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- `AppServerProcess.sendServerRequestReply()` still sends one JSON-RPC response line back to the app-server.
- `ServerRequestReply` success payloads are converted to JSON-RPC success responses with the same `result`.
- `ServerRequestReply` error payloads are converted to JSON-RPC error responses with the same `code` and `message`.
- Empty success replies still default to `{}` to preserve the previous bridge behavior.
- Manual pending-request replies and automatic policy replies continue using the same response construction path.

#### Rollback/Cleanup Notes
- No runtime artifacts need cleanup beyond normal build output in `dist/`, `dist-cli/`, and `output/`.
- To roll back, revert `src/server/serverRequestReply.ts`, `src/server/codexAppServerBridge.ts`, `scripts/server-module-smoke.ts`, and this test section.

#### Regression Evidence
- 2026-07-04 static verification: `git diff --check` passed.
- 2026-07-04 server module smoke: `node scripts\verify-server-modules.mjs` passed, including `createServerRequestReplyResponse()` coverage for success result, error response, and empty-result default `{}` behavior.
- 2026-07-04 typecheck/build: `node_modules\.bin\vue-tsc.cmd --noEmit`, `node_modules\.bin\vite.cmd build`, and `node_modules\.bin\tsup.cmd` passed; Vite still reports the existing large chunk warning.
- 2026-07-04 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-04 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`
---

### Feature: App Server RPC response settle helper

#### Prerequisites
- Current repository includes `src/server/appServerRpcResponse.ts`, `src/server/codexAppServerBridge.ts`, and `scripts/server-module-smoke.ts`.
- Dependencies are installed so TypeScript, Vite, tsup, and the server module smoke verifier can run.

#### Steps
1. Run `git diff --check`.
2. Run `node scripts\verify-server-modules.mjs`.
3. Run `node_modules\.bin\vue-tsc.cmd --noEmit`.
4. Run `node_modules\.bin\vite.cmd build`.
5. Run `node_modules\.bin\tsup.cmd`.
6. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
7. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- `AppServerProcess.handleLine()` still parses app-server JSON-RPC lines through `readAppServerJsonRpcLineEvent()`.
- Response events are settled through `settleAppServerRpcResponse()` without changing notification or server-request handling.
- Successful response events finalize the pending RPC, log the slow-RPC diagnostic outcome as `success`, and resolve the original promise with `result`.
- Error response events finalize the pending RPC, log the slow-RPC diagnostic outcome as `error`, and reject the original promise with `AppServerJsonRpcError`.
- Unknown response ids are ignored without resolving, rejecting, or logging diagnostics.

#### Rollback/Cleanup Notes
- No runtime artifacts need cleanup beyond normal build output in `dist/`, `dist-cli/`, and `output/`.
- To roll back, revert `src/server/appServerRpcResponse.ts`, `src/server/codexAppServerBridge.ts`, `scripts/server-module-smoke.ts`, `scripts/verify-server-modules.mjs`, and this test section.

#### Regression Evidence
- 2026-07-04 static verification: `git diff --check` passed.
- 2026-07-04 server module smoke: `node scripts\verify-server-modules.mjs` passed, including `settleAppServerRpcResponse()` coverage for success resolve, error reject, slow-RPC outcome logging, and unknown response id ignore behavior.
- 2026-07-04 typecheck/build: `node_modules\.bin\vue-tsc.cmd --noEmit`, `node_modules\.bin\vite.cmd build`, and `node_modules\.bin\tsup.cmd` passed; Vite still reports the existing large chunk warning.
- 2026-07-04 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-04 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: App Server runtime turn starter factory

#### Prerequisites
- Current repository includes `src/server/appServerRuntimeStart.ts`, `src/server/codexAppServerBridge.ts`, and `scripts/server-module-smoke.ts`.
- Dependencies are installed so TypeScript, Vite, tsup, and the server module smoke verifier can run.

#### Steps
1. Open `src/server/appServerRuntimeStart.ts` and confirm `createAppServerRuntimeTurnStarter(dependencies)` returns a payload handler backed by `startRuntimeTurnWithAppServer(payload, dependencies)`.
2. Open `src/server/codexAppServerBridge.ts` and confirm `startRuntimeTurn` is created from `createAppServerRuntimeTurnStarter(...)` with the same runtime store, runtime state, App Server RPC, thread search cache, snapshot persist, and plan-mode mark dependencies.
3. Run `git diff --check`.
4. Run `node scripts\verify-server-modules.mjs`.
5. Run `node_modules\.bin\vue-tsc.cmd --noEmit`.
6. Run `node_modules\.bin\vite.cmd build`.
7. Run `node_modules\.bin\tsup.cmd`.
8. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
9. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- The bridge no longer owns an inline `startRuntimeTurn(...)` wrapper; it only assembles dependencies for the factory-created starter.
- Runtime start behavior remains unchanged for new-thread plan-mode fallback, existing-thread snapshot fallback, timeout `start_uncertain`, and failed start paths.
- `scripts/server-module-smoke.ts` exercises the new factory-created starter as well as the existing lower-level `startRuntimeTurnWithAppServer()` paths.
- Typecheck, build, governance, and release verification complete without new errors.

#### Rollback/Cleanup Notes
- No runtime artifacts need cleanup beyond normal build output in `dist/`, `dist-cli/`, and `output/`.
- To roll back, revert `src/server/appServerRuntimeStart.ts`, `src/server/codexAppServerBridge.ts`, `scripts/server-module-smoke.ts`, and this test section.

#### Regression Evidence
- 2026-07-04 static verification: `git diff --check` passed.
- 2026-07-04 server module smoke: `node scripts\verify-server-modules.mjs` passed, including coverage for `createAppServerRuntimeTurnStarter()` plus the existing runtime start success, snapshot fallback, timeout, and failure paths.
- 2026-07-04 typecheck/build: `node_modules\.bin\vue-tsc.cmd --noEmit`, `node_modules\.bin\vite.cmd build`, and `node_modules\.bin\tsup.cmd` passed; Vite still reports the existing large chunk warning.
- 2026-07-04 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-04 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: App Server runtime turn interrupter factory

#### Prerequisites
- Current repository includes `src/server/appServerRuntimeInterrupt.ts`, `src/server/codexAppServerBridge.ts`, and `scripts/server-module-smoke.ts`.
- Dependencies are installed so TypeScript, Vite, tsup, and the server module smoke verifier can run.

#### Steps
1. Open `src/server/appServerRuntimeInterrupt.ts` and confirm `createAppServerRuntimeTurnInterrupter(dependencies)` returns a payload handler backed by `interruptRuntimeTurnWithAppServer(payload, dependencies)`.
2. Open `src/server/codexAppServerBridge.ts` and confirm `interruptRuntimeTurn` is created from `createAppServerRuntimeTurnInterrupter(...)` with the same runtime store, runtime state, App Server RPC, snapshot persist, and plan-mode cleanup dependencies.
3. Run `git diff --check`.
4. Run `node scripts\verify-server-modules.mjs`.
5. Run `node_modules\.bin\vue-tsc.cmd --noEmit`.
6. Run `node_modules\.bin\vite.cmd build`.
7. Run `node_modules\.bin\tsup.cmd`.
8. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
9. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- The bridge no longer owns an inline `interruptRuntimeTurn(...)` wrapper; it only assembles dependencies for the factory-created interrupter.
- Runtime interrupt behavior remains unchanged for success, already-settled, timeout `stop_uncertain`, and failed interrupt paths.
- `scripts/server-module-smoke.ts` exercises the new factory-created interrupter as well as the existing lower-level `interruptRuntimeTurnWithAppServer()` paths.
- Typecheck, build, governance, and release verification complete without new errors.

#### Rollback/Cleanup Notes
- No runtime artifacts need cleanup beyond normal build output in `dist/`, `dist-cli/`, and `output/`.
- To roll back, revert `src/server/appServerRuntimeInterrupt.ts`, `src/server/codexAppServerBridge.ts`, `scripts/server-module-smoke.ts`, and this test section.

#### Regression Evidence
- 2026-07-04 static verification: `git diff --check` passed.
- 2026-07-04 server module smoke: `node scripts\verify-server-modules.mjs` passed, including coverage for `createAppServerRuntimeTurnInterrupter()` plus the existing runtime interrupt success, already-settled, timeout, and failure paths.
- 2026-07-04 typecheck/build: `node_modules\.bin\vue-tsc.cmd --noEmit`, `node_modules\.bin\vite.cmd build`, and `node_modules\.bin\tsup.cmd` passed; Vite still reports the existing large chunk warning.
- 2026-07-04 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-04 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: App Server hook diagnostics reader factory

#### Prerequisites
- Current repository includes `src/server/appServerHookDiagnostics.ts`, `src/server/codexAppServerBridge.ts`, and `scripts/server-module-smoke.ts`.
- Dependencies are installed so TypeScript, Vite, tsup, and the server module smoke verifier can run.

#### Steps
1. Open `src/server/appServerHookDiagnostics.ts` and confirm `createAppServerHookDiagnosticsReader(...)` reads hook diagnostics through `AppServerHookDiagnosticsCache.read(...)`.
2. Confirm the reader invokes App Server RPC method `hooks/list` with `cwds` from the injected `getCwds()` dependency.
3. Open `src/server/codexAppServerBridge.ts` and confirm `readAppServerHookDiagnostics` is created from the factory with the bridge's hook diagnostics cache, App Server RPC, and current working directory.
4. Run `git diff --check`.
5. Run `node scripts\verify-server-modules.mjs`.
6. Run `node_modules\.bin\vue-tsc.cmd --noEmit`.
7. Run `node_modules\.bin\vite.cmd build`.
8. Run `node_modules\.bin\tsup.cmd`.
9. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
10. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- `codexAppServerBridge.ts` no longer owns the hook diagnostics RPC wrapper details.
- Hook diagnostics still call `hooks/list` with the active cwd list and still normalize/cache results through `AppServerHookDiagnosticsCache`.
- `scripts/server-module-smoke.ts` covers the factory-created reader and verifies the RPC method and params.
- Typecheck, build, governance, and release verification complete without new errors.

#### Rollback/Cleanup Notes
- No runtime artifacts need cleanup beyond normal build output in `dist/`, `dist-cli/`, and `output/`.
- To roll back, revert `src/server/appServerHookDiagnostics.ts`, `src/server/codexAppServerBridge.ts`, `scripts/server-module-smoke.ts`, and this test section.

#### Regression Evidence
- 2026-07-04 static verification: `git diff --check` passed.
- 2026-07-04 server module smoke: `node scripts\verify-server-modules.mjs` passed, including coverage for `createAppServerHookDiagnosticsReader()` method/params wiring and existing hook diagnostics normalization/cache behavior.
- 2026-07-04 typecheck/build: `node_modules\.bin\vue-tsc.cmd --noEmit`, `node_modules\.bin\vite.cmd build`, and `node_modules\.bin\tsup.cmd` passed; Vite still reports the existing large chunk warning.
- 2026-07-04 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-04 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: Windows Sandbox readiness reader factory

#### Prerequisites
- Current repository includes `src/server/windowsSandboxDiagnostics.ts`, `src/server/codexAppServerBridge.ts`, and `scripts/server-module-smoke.ts`.
- Dependencies are installed so TypeScript, Vite, tsup, and the server module smoke verifier can run.

#### Steps
1. Open `src/server/windowsSandboxDiagnostics.ts` and confirm `createWindowsSandboxReadinessReader(...)` owns the platform check and cache-backed App Server readiness RPC call.
2. Confirm the reader returns `createWindowsSandboxReadinessUnsupported()` without calling RPC when the injected platform check says Windows is unsupported.
3. Confirm the reader invokes App Server RPC method `windowsSandbox/readiness` with `undefined` params when Windows support is available.
4. Open `src/server/codexAppServerBridge.ts` and confirm `readWindowsSandboxReadinessDiagnostics` is created from the factory with the bridge's readiness cache, App Server RPC, and `process.platform === 'win32'` platform check.
5. Run `git diff --check`.
6. Run `node scripts\verify-server-modules.mjs`.
7. Run `node_modules\.bin\vue-tsc.cmd --noEmit`.
8. Run `node_modules\.bin\vite.cmd build`.
9. Run `node_modules\.bin\tsup.cmd`.
10. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
11. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- `codexAppServerBridge.ts` no longer owns the Windows Sandbox readiness platform/RPC wrapper details.
- Windows Sandbox readiness still reports unsupported on non-Windows platforms without calling App Server RPC.
- Windows Sandbox readiness still calls `windowsSandbox/readiness` and normalizes/caches results through `WindowsSandboxReadinessCache` on Windows.
- `scripts/server-module-smoke.ts` covers both factory-created reader paths: supported RPC and unsupported no-RPC.
- Typecheck, build, governance, and release verification complete without new errors.

#### Rollback/Cleanup Notes
- No runtime artifacts need cleanup beyond normal build output in `dist/`, `dist-cli/`, and `output/`.
- To roll back, revert `src/server/windowsSandboxDiagnostics.ts`, `src/server/codexAppServerBridge.ts`, `scripts/server-module-smoke.ts`, and this test section.

#### Regression Evidence
- 2026-07-04 static verification: `git diff --check` passed.
- 2026-07-04 server module smoke: `node scripts\verify-server-modules.mjs` passed, including coverage for `createWindowsSandboxReadinessReader()` supported RPC wiring and unsupported no-RPC behavior.
- 2026-07-04 typecheck/build: `node_modules\.bin\vue-tsc.cmd --noEmit`, `node_modules\.bin\vite.cmd build`, and `node_modules\.bin\tsup.cmd` passed; Vite still reports the existing large chunk warning.
- 2026-07-04 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-04 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: App Server thread-list RPC result augmenter factory

#### Prerequisites
- Current repository includes `src/server/appServerThreadListAugment.ts`, `src/server/codexAppServerBridge.ts`, and `scripts/server-module-smoke.ts`.
- Dependencies are installed so TypeScript, Vite, tsup, and the server module smoke verifier can run.

#### Steps
1. Open `src/server/appServerThreadListAugment.ts` and confirm `createAppServerThreadListRpcResultAugmenter(...)` wraps `AppServerThreadListAugmenter.augmentThreadListRpcResult(...)`.
2. Confirm the factory-created augmenter reads pinned thread ids from the injected dependency and reads supplemental thread summaries through App Server RPC method `thread/read` with `includeTurns: false`.
3. Open `src/server/codexAppServerBridge.ts` and confirm `augmentThreadListRpcResult` is created from the factory with the shared supplemental augmenter, merged pinned thread id reader, and App Server RPC.
4. Run `git diff --check`.
5. Run `node scripts\verify-server-modules.mjs`.
6. Run `node_modules\.bin\vue-tsc.cmd --noEmit`.
7. Run `node_modules\.bin\vite.cmd build`.
8. Run `node_modules\.bin\tsup.cmd`.
9. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
10. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- `codexAppServerBridge.ts` no longer owns the supplemental thread-list RPC wrapper details.
- Active/default first-page `thread/list` augmentation uses merged pinned thread ids and best-effort `thread/read` summaries; archived and cursor pages stay unchanged.
- Supplemental summary reads still call `thread/read` with `includeTurns: false`.
- `scripts/server-module-smoke.ts` covers the factory-created augmenter and verifies the RPC method and params.
- Typecheck, build, governance, and release verification complete without new errors.

#### Rollback/Cleanup Notes
- No runtime artifacts need cleanup beyond normal build output in `dist/`, `dist-cli/`, and `output/`.
- To roll back, revert `src/server/appServerThreadListAugment.ts`, `src/server/codexAppServerBridge.ts`, `scripts/server-module-smoke.ts`, and this test section.

#### Regression Evidence
- 2026-07-04 static verification: `git diff --check` passed.
- 2026-07-04 server module smoke: `node scripts\verify-server-modules.mjs` passed, including coverage for `createAppServerThreadListRpcResultAugmenter()` `thread/read` method/params wiring and existing thread-list augmentation behavior.
- 2026-07-04 typecheck/build: `node_modules\.bin\vue-tsc.cmd --noEmit`, `node_modules\.bin\vite.cmd build`, and `node_modules\.bin\tsup.cmd` passed; Vite still reports the existing large chunk warning.
- 2026-07-04 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-04 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: App Server notification replay accessors factory

#### Prerequisites
- Current repository includes `src/server/appServerNotificationReplay.ts`, `src/server/codexAppServerBridge.ts`, and `scripts/server-module-smoke.ts`.
- Dependencies are installed so TypeScript, Vite, tsup, and the server module smoke verifier can run.

#### Steps
1. Open `src/server/appServerNotificationReplay.ts` and confirm `createAppServerNotificationReplayAccessors(...)` exposes `rememberNotificationEvent(...)` and `listNotificationEventsAfter(...)` from an `AppServerNotificationReplay` instance.
2. Open `src/server/codexAppServerBridge.ts` and confirm bridge notification sync and replay routes use the factory-created accessors instead of local wrapper functions.
3. Run `git diff --check`.
4. Run `node scripts\verify-server-modules.mjs`.
5. Run `node_modules\.bin\vue-tsc.cmd --noEmit`.
6. Run `node_modules\.bin\vite.cmd build`.
7. Run `node_modules\.bin\tsup.cmd`.
8. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
9. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- `codexAppServerBridge.ts` no longer owns notification replay accessor wrapper functions.
- Notification replay behavior remains unchanged for remembered notification sequence ids, persisted event appends, diagnostics observations, in-memory replay, and persisted replay fallback.
- `scripts/server-module-smoke.ts` covers the factory-created accessors and existing `AppServerNotificationReplay` behavior.
- Typecheck, build, governance, and release verification complete without new errors.

#### Rollback/Cleanup Notes
- No runtime artifacts need cleanup beyond normal build output in `dist/`, `dist-cli/`, and `output/`.
- To roll back, revert `src/server/appServerNotificationReplay.ts`, `src/server/codexAppServerBridge.ts`, `scripts/server-module-smoke.ts`, and this test section.

#### Regression Evidence
- 2026-07-04 static verification: `git diff --check` passed.
- 2026-07-04 server module smoke: `node scripts\verify-server-modules.mjs` passed, including coverage for `createAppServerNotificationReplayAccessors()` and existing notification replay behavior.
- 2026-07-04 typecheck/build: `node_modules\.bin\vue-tsc.cmd --noEmit`, `node_modules\.bin\vite.cmd build`, and `node_modules\.bin\tsup.cmd` passed; Vite still reports the existing large chunk warning.
- 2026-07-04 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-04 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: Codex bridge startup task runner

#### Prerequisites
- Current repository includes `src/server/codexBridgeStartupTasks.ts`, `src/server/codexAppServerBridge.ts`, and `scripts/server-module-smoke.ts`.
- Dependencies are installed so TypeScript, Vite, tsup, and the server module smoke verifier can run.

#### Steps
1. Open `src/server/codexBridgeStartupTasks.ts` and confirm `startCodexBridgeStartupTasks(...)` starts skills sync, App Server warmup, and web settings load as fire-and-forget tasks.
2. Confirm failed startup tasks are logged with the same messages: `Startup skills sync failed`, `App server warmup failed`, and `Web settings load failed`.
3. Open `src/server/codexAppServerBridge.ts` and confirm middleware creation delegates startup task scheduling to `startCodexBridgeStartupTasks(...)`.
4. Run `git diff --check`.
5. Run `node scripts\verify-server-modules.mjs`.
6. Run `node_modules\.bin\vue-tsc.cmd --noEmit`.
7. Run `node_modules\.bin\vite.cmd build`.
8. Run `node_modules\.bin\tsup.cmd`.
9. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
10. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- `codexAppServerBridge.ts` no longer owns inline startup task scheduling for skills sync, warmup, and web settings load.
- Startup behavior remains fire-and-forget and continues applying loaded web bridge settings to the App Server process.
- Startup task failures continue to be logged without breaking middleware creation.
- `scripts/server-module-smoke.ts` covers successful startup scheduling and all three failure log messages.
- Typecheck, build, governance, and release verification complete without new errors.

#### Rollback/Cleanup Notes
- No runtime artifacts need cleanup beyond normal build output in `dist/`, `dist-cli/`, and `output/`.
- To roll back, delete `src/server/codexBridgeStartupTasks.ts`, restore the inline startup task scheduling in `src/server/codexAppServerBridge.ts`, and revert `scripts/server-module-smoke.ts` plus this test section.

#### Regression Evidence
- 2026-07-04 static verification: `git diff --check` passed.
- 2026-07-04 server module smoke: `node scripts\verify-server-modules.mjs` passed, including coverage for `startCodexBridgeStartupTasks()` success scheduling and all three startup failure log messages.
- 2026-07-04 typecheck/build: `node_modules\.bin\vue-tsc.cmd --noEmit`, `node_modules\.bin\vite.cmd build`, and `node_modules\.bin\tsup.cmd` passed; Vite still reports the existing large chunk warning.
- 2026-07-04 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-04 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: Thread search index store factory

#### Prerequisites
- Current repository includes `src/server/threadSearchIndex.ts`, `src/server/codexAppServerBridge.ts`, and `scripts/server-module-smoke.ts`.
- Dependencies are installed so TypeScript, Vite, tsup, and the server module smoke verifier can run.

#### Steps
1. Open `src/server/threadSearchIndex.ts` and confirm `createThreadSearchIndexStore(...)` creates a `ThreadSearchIndexStore` from injected `listThreads`, `getSessionIndexPath`, and `readThreadTitlesFromSessionIndex` dependencies.
2. Open `src/server/codexAppServerBridge.ts` and confirm the bridge creates `threadSearchIndexStore` through the factory with App Server RPC method `thread/list`, `getCodexSessionIndexPath`, and `readThreadTitlesFromSessionIndex`.
3. Confirm the thread search index still combines active/archived `thread/list` rows with session-index titles and keeps the store cache/clear behavior.
4. Open `scripts/server-module-smoke.ts` and confirm `smokeThreadSearchIndex()` covers concurrent `ThreadSearchIndexStore.search()` calls sharing one build and `clear()` during an in-flight build not caching the stale result.
5. Run `git diff --check`.
6. Run `node scripts\verify-server-modules.mjs`.
7. Run `node_modules\.bin\vue-tsc.cmd --noEmit`.
8. Run `node_modules\.bin\vite.cmd build`.
9. Run `node_modules\.bin\tsup.cmd`.
10. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
11. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- `codexAppServerBridge.ts` no longer owns inline `ThreadSearchIndexStore` construction details.
- Thread search still calls `thread/list` for active and archived pages, reads the Codex session index path, and includes session-index-only thread titles.
- `ThreadSearchIndexStore.clear()` still invalidates the cached index.
- `scripts/server-module-smoke.ts` covers the factory-created store, verifies injected dependency calls, confirms concurrent searches share one in-flight build, and confirms `clear()` during an in-flight build prevents that stale build from becoming the cached index.
- Typecheck, build, governance, and release verification complete without new errors.

#### Rollback/Cleanup Notes
- No runtime artifacts need cleanup beyond normal build output in `dist/`, `dist-cli/`, and `output/`.
- To roll back, revert `src/server/threadSearchIndex.ts`, `src/server/codexAppServerBridge.ts`, `scripts/server-module-smoke.ts`, and this test section.

#### Regression Evidence
- 2026-07-04 static verification: `git diff --check` passed.
- 2026-07-04 server module smoke: `node scripts\verify-server-modules.mjs` passed, including coverage for `createThreadSearchIndexStore()` dependency wiring, session-index title loading, active/archived `thread/list` calls, and store cache reuse.
- 2026-07-04 typecheck/build: `node_modules\.bin\vue-tsc.cmd --noEmit`, `node_modules\.bin\vite.cmd build`, and `node_modules\.bin\tsup.cmd` passed; Vite still reports the existing large chunk warning.
- 2026-07-04 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-04 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 server module smoke: `node scripts\verify-server-modules.mjs` passed with `server module smoke ok`, including concurrent search build reuse and clear-during-build stale-cache prevention coverage.
- 2026-07-05 typecheck/build: `node_modules\.bin\vue-tsc.cmd --noEmit`, `node_modules\.bin\vite.cmd build`, and `node_modules\.bin\tsup.cmd` passed; Vite still reports the existing large chunk warning.
- 2026-07-05 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-05 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `Frontend normalizer smoke`, `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: App Server notification runtime sync subscriber

#### Prerequisites
- Current repository includes `src/server/appServerNotificationRuntimeSync.ts`, `src/server/codexAppServerBridge.ts`, and `scripts/server-module-smoke.ts`.
- Dependencies are installed so TypeScript, Vite, tsup, and the server module smoke verifier can run.

#### Steps
1. Open `src/server/appServerNotificationRuntimeSync.ts` and confirm `subscribeBridgeNotificationRuntimeSync(...)` subscribes to App Server notifications and forwards each notification through `syncBridgeNotificationRuntimeState(...)`.
2. Open `src/server/codexAppServerBridge.ts` and confirm the bridge uses `subscribeBridgeNotificationRuntimeSync(...)` with `appServer.onNotification(...)`, notification replay accessors, runtime stores, cached thread-read invalidation, and bridge notification listeners.
3. Confirm the returned unsubscribe function is retained and still called during middleware disposal.
4. Run `git diff --check`.
5. Run `node scripts\verify-server-modules.mjs`.
6. Run `node_modules\.bin\vue-tsc.cmd --noEmit`.
7. Run `node_modules\.bin\vite.cmd build`.
8. Run `node_modules\.bin\tsup.cmd`.
9. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
10. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- `codexAppServerBridge.ts` no longer owns the inline App Server notification sync callback.
- Notification replay, runtime event observation, runtime request reconciliation, cached thread-read invalidation, and bridge listener emission continue to run through the same sync function.
- Middleware disposal still unsubscribes from App Server notifications.
- `scripts/server-module-smoke.ts` covers the subscriber helper and verifies notification forwarding plus unsubscribe behavior.
- Typecheck, build, governance, and release verification complete without new errors.

#### Rollback/Cleanup Notes
- No runtime artifacts need cleanup beyond normal build output in `dist/`, `dist-cli/`, and `output/`.
- To roll back, revert `src/server/appServerNotificationRuntimeSync.ts`, `src/server/codexAppServerBridge.ts`, `scripts/server-module-smoke.ts`, and this test section.

#### Regression Evidence
- 2026-07-04 static verification: `git diff --check` passed.
- 2026-07-04 server module smoke: `node scripts\verify-server-modules.mjs` passed, including coverage for `subscribeBridgeNotificationRuntimeSync()` notification forwarding and unsubscribe behavior.
- 2026-07-04 typecheck/build: `node_modules\.bin\vue-tsc.cmd --noEmit`, `node_modules\.bin\vite.cmd build`, and `node_modules\.bin\tsup.cmd` passed; Vite still reports the existing large chunk warning.
- 2026-07-04 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-04 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: App Server runtime readers factory

#### Prerequisites
- Current repository includes `src/server/appServerRuntimeReaders.ts`, `src/server/codexAppServerBridge.ts`, and `scripts/server-module-smoke.ts`.
- Dependencies are installed so TypeScript, Vite, tsup, and the server module smoke verifier can run.

#### Steps
1. Open `src/server/appServerRuntimeReaders.ts` and confirm `createAppServerRuntimeReaders(...)` returns `readThreadRuntimeSnapshot`, `readLocalRuntimeSnapshot`, and `readCachedThreadTokenUsage`.
2. Open `src/server/codexAppServerBridge.ts` and confirm the bridge creates all three runtime readers through `createAppServerRuntimeReaders(...)`.
3. Confirm the factory still wires App Server `thread/read`, thread-read cache access, runtime state snapshots, local runtime snapshots, pending server requests, token usage, and warning logging through the same dependencies.
4. Run `git diff --check`.
5. Run `node scripts\verify-server-modules.mjs`.
6. Run `node_modules\.bin\vue-tsc.cmd --noEmit`.
7. Run `node_modules\.bin\vite.cmd build`.
8. Run `node_modules\.bin\tsup.cmd`.
9. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
10. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- `codexAppServerBridge.ts` no longer owns three separate runtime reader factory calls.
- Thread runtime snapshots still perform light and heavy `thread/read` calls, persist snapshots, and remember cached thread reads.
- Local runtime snapshots still merge pending server requests and cached token usage.
- Cached token usage resolution still reads from cached App Server token usage first and cached thread-read payloads second.
- `scripts/server-module-smoke.ts` covers the combined runtime readers factory across thread, local, and cached token usage readers.
- Typecheck, build, governance, and release verification complete without new errors.

#### Rollback/Cleanup Notes
- No runtime artifacts need cleanup beyond normal build output in `dist/`, `dist-cli/`, and `output/`.
- To roll back, delete `src/server/appServerRuntimeReaders.ts`, restore the three separate reader factory calls in `src/server/codexAppServerBridge.ts`, and revert `scripts/server-module-smoke.ts` plus this test section.

#### Regression Evidence
- 2026-07-04 static verification: `git diff --check` passed.
- 2026-07-04 server module smoke: `node scripts\verify-server-modules.mjs` passed, including coverage for `createAppServerRuntimeReaders()` thread runtime snapshot, local runtime snapshot, and cached token usage reader wiring.
- 2026-07-04 typecheck/build: `node_modules\.bin\vue-tsc.cmd --noEmit`, `node_modules\.bin\vite.cmd build`, and `node_modules\.bin\tsup.cmd` passed; Vite still reports the existing large chunk warning.
- 2026-07-04 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-04 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: App Server runtime actions factory

#### Prerequisites
- Current repository includes `src/server/appServerRuntimeActions.ts`, `src/server/codexAppServerBridge.ts`, and `scripts/server-module-smoke.ts`.
- Dependencies are installed so TypeScript, Vite, tsup, and the server module smoke verifier can run.

#### Steps
1. Open `src/server/appServerRuntimeActions.ts` and confirm `createAppServerRuntimeActions(...)` returns `startRuntimeTurn` and `interruptRuntimeTurn`.
2. Open `src/server/codexAppServerBridge.ts` and confirm the bridge creates runtime start and interrupt handlers through `createAppServerRuntimeActions(...)`.
3. Confirm the factory still wires runtime request creation/update, App Server RPC, thread search index clearing, runtime state marks, runtime snapshot persistence, plan-mode turn tracking, and error-message handling through the same dependencies.
4. Run `git diff --check`.
5. Run `node scripts\verify-server-modules.mjs`.
6. Run `node_modules\.bin\vue-tsc.cmd --noEmit`.
7. Run `node_modules\.bin\vite.cmd build`.
8. Run `node_modules\.bin\tsup.cmd`.
9. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
10. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- `codexAppServerBridge.ts` no longer owns separate runtime start and interrupt factory calls.
- Runtime start still calls `turn/start`, marks the thread starting/running, persists snapshots, and updates runtime requests.
- Runtime interrupt still calls `turn/interrupt`, marks the thread stopping/interrupted, clears plan-mode tracking, persists snapshots, and updates runtime requests.
- `scripts/server-module-smoke.ts` covers the combined runtime actions factory across start and interrupt paths.
- Typecheck, build, governance, and release verification complete without new errors.

#### Rollback/Cleanup Notes
- No runtime artifacts need cleanup beyond normal build output in `dist/`, `dist-cli/`, and `output/`.
- To roll back, delete `src/server/appServerRuntimeActions.ts`, restore the two separate runtime action factory calls in `src/server/codexAppServerBridge.ts`, and revert `scripts/server-module-smoke.ts` plus this test section.

#### Regression Evidence
- 2026-07-04 static verification: `git diff --check` passed.
- 2026-07-04 server module smoke: `node scripts\verify-server-modules.mjs` passed, including coverage for `createAppServerRuntimeActions()` start and interrupt handler wiring.
- 2026-07-04 typecheck/build: `node_modules\.bin\vue-tsc.cmd --noEmit`, `node_modules\.bin\vite.cmd build`, and `node_modules\.bin\tsup.cmd` passed; Vite still reports the existing large chunk warning.
- 2026-07-04 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-04 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: App Server diagnostics readers factory

#### Prerequisites
- Current repository includes `src/server/appServerDiagnosticsReaders.ts`, `src/server/codexAppServerBridge.ts`, and `scripts/server-module-smoke.ts`.
- Dependencies are installed so TypeScript, Vite, tsup, and the server module smoke verifier can run.

#### Steps
1. Open `src/server/appServerDiagnosticsReaders.ts` and confirm `createAppServerDiagnosticsReaders(...)` returns `readAppServerHookDiagnostics` and `readWindowsSandboxReadinessDiagnostics`.
2. Open `src/server/codexAppServerBridge.ts` and confirm the bridge creates both diagnostics readers through `createAppServerDiagnosticsReaders(...)`.
3. Confirm the factory still wires `hooks/list` with the injected cwd list and `windowsSandbox/readiness` with the injected platform check and shared App Server RPC.
4. Run `git diff --check`.
5. Run `node scripts\verify-server-modules.mjs`.
6. Run `node_modules\.bin\vue-tsc.cmd --noEmit`.
7. Run `node_modules\.bin\vite.cmd build`.
8. Run `node_modules\.bin\tsup.cmd`.
9. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
10. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- `codexAppServerBridge.ts` no longer owns separate diagnostics reader factory calls.
- Hook diagnostics still call App Server RPC method `hooks/list` with the configured cwd list.
- Windows sandbox diagnostics still avoid RPC on unsupported platforms and call `windowsSandbox/readiness` on Windows.
- `scripts/server-module-smoke.ts` covers the combined diagnostics readers factory across both diagnostics paths.
- Typecheck, build, governance, and release verification complete without new errors.

#### Rollback/Cleanup Notes
- No runtime artifacts need cleanup beyond normal build output in `dist/`, `dist-cli/`, and `output/`.
- To roll back, delete `src/server/appServerDiagnosticsReaders.ts`, restore the two separate diagnostics reader factory calls in `src/server/codexAppServerBridge.ts`, and revert `scripts/server-module-smoke.ts` plus this test section.

#### Regression Evidence
- 2026-07-04 static verification: `git diff --check` passed.
- 2026-07-04 server module smoke: `node scripts\verify-server-modules.mjs` passed, including coverage for `createAppServerDiagnosticsReaders()` hook diagnostics and Windows sandbox readiness reader wiring.
- 2026-07-04 typecheck/build: `node_modules\.bin\vue-tsc.cmd --noEmit`, `node_modules\.bin\vite.cmd build`, and `node_modules\.bin\tsup.cmd` passed; Vite still reports the existing large chunk warning.
- 2026-07-04 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-04 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: App Server runtime reconciliation factory

#### Prerequisites
- Current repository includes `src/server/appServerRuntimeReconciliation.ts`, `src/server/codexAppServerBridge.ts`, and `scripts/server-module-smoke.ts`.
- Dependencies are installed so TypeScript, Vite, tsup, and the server module smoke verifier can run.

#### Steps
1. Open `src/server/appServerRuntimeReconciliation.ts` and confirm `createAppServerRuntimeReconciliation(...)` returns `reconcileRuntimeThread` and `runtimeReconcileScheduler`.
2. Open `src/server/codexAppServerBridge.ts` and confirm the bridge creates runtime reconciliation through `createAppServerRuntimeReconciliation(...)`.
3. Confirm the factory still wires thread runtime snapshot reads, runtime request reconciliation, uncertain-request scheduling, runtime request updates, and reconcile failure logging through the same dependencies.
4. Run `git diff --check`.
5. Run `node scripts\verify-server-modules.mjs`.
6. Run `node_modules\.bin\vue-tsc.cmd --noEmit`.
7. Run `node_modules\.bin\vite.cmd build`.
8. Run `node_modules\.bin\tsup.cmd`.
9. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
10. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- `codexAppServerBridge.ts` no longer owns separate runtime reconciler and reconcile scheduler factory calls.
- Runtime reconciliation still reads the App Server thread runtime snapshot and updates active runtime requests from the snapshot.
- Runtime reconcile scheduling still uses uncertain runtime requests and logs reconcile failures through the injected warning writer.
- `scripts/server-module-smoke.ts` covers the combined runtime reconciliation factory.
- Typecheck, build, governance, and release verification complete without new errors.

#### Rollback/Cleanup Notes
- No runtime artifacts need cleanup beyond normal build output in `dist/`, `dist-cli/`, and `output/`.
- To roll back, delete `src/server/appServerRuntimeReconciliation.ts`, restore the separate runtime reconciler and scheduler factory calls in `src/server/codexAppServerBridge.ts`, and revert `scripts/server-module-smoke.ts` plus this test section.

#### Regression Evidence
- 2026-07-04 static verification: `git diff --check` passed.
- 2026-07-04 server module smoke: `node scripts\verify-server-modules.mjs` passed, including coverage for `createAppServerRuntimeReconciliation()` reconciler and scheduler wiring.
- 2026-07-04 typecheck/build: `node_modules\.bin\vue-tsc.cmd --noEmit`, `node_modules\.bin\vite.cmd build`, and `node_modules\.bin\tsup.cmd` passed; Vite still reports the existing large chunk warning.
- 2026-07-04 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-04 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: App Server notification replay bundle factory

#### Prerequisites
- Current repository includes `src/server/appServerNotificationReplay.ts`, `src/server/codexAppServerBridge.ts`, and `scripts/server-module-smoke.ts`.
- Dependencies are installed so TypeScript, Vite, tsup, and the server module smoke verifier can run.

#### Steps
1. Open `src/server/appServerNotificationReplay.ts` and confirm `createAppServerNotificationReplayBundle(...)` returns the `notificationReplay` instance plus `rememberNotificationEvent` and `listNotificationEventsAfter` accessors.
2. Open `src/server/codexAppServerBridge.ts` and confirm the bridge creates notification replay state through `createAppServerNotificationReplayBundle(...)`.
3. Confirm replay still initializes from `runtimeStore.getLatestEventSeq()`, persists events through `runtimeStore.appendEvent(...)`, lists persisted events through `runtimeStore.listEventsAfter(...)`, and observes notification diagnostics.
4. Run `git diff --check`.
5. Run `node scripts\verify-server-modules.mjs`.
6. Run `node_modules\.bin\vue-tsc.cmd --noEmit`.
7. Run `node_modules\.bin\vite.cmd build`.
8. Run `node_modules\.bin\tsup.cmd`.
9. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
10. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- `codexAppServerBridge.ts` no longer owns separate notification replay construction and accessor extraction.
- Notification replay sequence ids, persisted event append/list behavior, and bridge replay accessors remain unchanged.
- `scripts/server-module-smoke.ts` covers the bundled replay factory and verifies replay latest sequence, remembered event, listed replay, and appended event payload.
- Typecheck, build, governance, and release verification complete without new errors.

#### Rollback/Cleanup Notes
- No runtime artifacts need cleanup beyond normal build output in `dist/`, `dist-cli/`, and `output/`.
- To roll back, remove `createAppServerNotificationReplayBundle(...)`, restore the separate replay constructor and accessor factory call in `src/server/codexAppServerBridge.ts`, and revert `scripts/server-module-smoke.ts` plus this test section.

#### Regression Evidence
- 2026-07-04 static verification: `git diff --check` passed.
- 2026-07-04 server module smoke: `node scripts\verify-server-modules.mjs` passed, including coverage for `createAppServerNotificationReplayBundle()` replay instance, accessor, list, and append wiring.
- 2026-07-04 typecheck/build: `node_modules\.bin\vue-tsc.cmd --noEmit`, `node_modules\.bin\vite.cmd build`, and `node_modules\.bin\tsup.cmd` passed; Vite still reports the existing large chunk warning.
- 2026-07-04 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-04 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: OpenAI official docs alignment snapshot

#### Prerequisites
- Network access to official OpenAI documentation under `developers.openai.com`.
- Current repository includes `docs/openai-docs-review.zh-CN.md` and `docs/protocol-compatibility.zh-CN.md`.

#### Steps
1. Run `node C:\Users\SW\.codex\skills\.system\openai-docs\scripts\fetch-codex-manual.mjs` and confirm the manual is current or refreshed successfully.
2. Open `https://developers.openai.com/codex/app-server` and confirm the page still documents `initialize` followed by `initialized`, version-specific schema generation, and `capabilities.experimentalApi` as the experimental API opt-in.
3. Open `https://developers.openai.com/codex/remote-connections` and confirm remote Codex work still uses SSH/VPN/mesh style boundaries rather than direct public App Server exposure.
4. Open `https://developers.openai.com/api/docs/guides/speech-to-text` and `https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create`; confirm ordinary transcription still supports JSON output and diarized transcription still uses `gpt-4o-transcribe-diarize`, `response_format=diarized_json`, and `chunking_strategy=auto`.
5. Open `https://developers.openai.com/api/reference/responses/overview` and `https://developers.openai.com/api/docs/guides/migrate-to-responses`; confirm Responses is the recommended unified API for new general OpenAI applications, but has a different response/items object model from Codex App Server thread/turn/runtime/approval events.
6. Check `docs/openai-docs-review.zh-CN.md` and confirm the official source list and current review conclusions include App Server, remote security, Speech to text, audio transcription reference, and Responses boundary.
7. Check `docs/protocol-compatibility.zh-CN.md` and confirm the OpenAI API boundary section says Responses API is not a Codex App Server replacement.
8. Run `git diff --check`.
9. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
10. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- Official docs review records the latest source URLs and the current 2026-07-04 review timestamp.
- Project documentation keeps Codex App Server as the only source of truth for thread, turn, runtime, approval, restore, interrupt, and notification behavior.
- Speech to text remains a separate server-side supplemental capability with service-side model/format/chunking normalization and no browser-exposed API key.
- Responses API is documented as useful for general OpenAI integrations, not as a replacement for Codex rich-client App Server.
- Governance and release verification complete without new errors.

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required for this documentation-only change beyond normal release smoke output under `output\release-package-smoke`.
- To roll back, revert the OpenAI docs snapshot additions in `docs/openai-docs-review.zh-CN.md`, `docs/protocol-compatibility.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-04 official Codex manual refresh: `node C:\Users\SW\.codex\skills\.system\openai-docs\scripts\fetch-codex-manual.mjs` passed and reported `Manual status: local manual was already current.`
- 2026-07-04 static verification: `git diff --check` passed.
- 2026-07-04 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-04 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: App Server thread status diagnostics compatibility

#### Prerequisites
- Current repository includes `src/server/appServerStatusDiagnostics.ts`, `src/server/appServerNotificationReplay.ts`, `src/server/rpcProxyRoute.ts`, `src/server/codexAppServerBridge.ts`, and `scripts/server-module-smoke.ts`.
- Dependencies are installed so server module smoke, TypeScript, Vite, tsup, governance, and release verification can run.

#### Steps
1. Open `src/server/appServerStatusDiagnostics.ts` and confirm status candidates are classified as thread status, thread active flag, or thread unsubscribe status.
2. Confirm `notLoaded`, `systemError`, `waitingOnApproval`, `waitingOnUserInput`, `notSubscribed`, and `unsubscribed` are treated as known App Server v2 status values.
3. Open `src/server/codexAppServerBridge.ts` and confirm notification replay observations forward `thread/status/changed` payloads into `statusDiagnostics.observeStatusNotification(...)`.
4. Open `src/server/rpcProxyRoute.ts` and confirm successful `thread/unsubscribe` responses are sent to `observeThreadUnsubscribeResponse(...)`.
5. Open `docs/app-server-protocol-matrix.zh-CN.md` and confirm the Thread / Turn row records status diagnostics coverage for `thread.status`, `thread/status/changed.status`, `activeFlags`, and `thread/unsubscribe` response status.
6. Run `git diff --check`.
7. Run `node scripts\verify-server-modules.mjs`.
8. Run `node_modules\.bin\vue-tsc.cmd --noEmit`.
9. Run `node_modules\.bin\vite.cmd build`.
10. Run `node_modules\.bin\tsup.cmd`.
11. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
12. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- Unknown App Server thread status values from `thread/read` still aggregate in `statusDiagnostics` without exposing user prompt or raw payload.
- Known v2 thread status values and active flags do not inflate unknown status counters.
- Unknown `thread/status/changed.status.activeFlags` values are recorded as sanitized status diagnostics instead of being lost as notification-only data.
- `thread/unsubscribe` response status values are observed by diagnostics, including future unknown unsubscribe statuses.
- Server module smoke covers the new candidate readers, known-value helpers, notification observation path, and RPC unsubscribe response observation path.
- Typecheck, build, governance, and release verification complete without new errors.

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required beyond normal build output in `dist/`, `dist-cli/`, `output/server-module-smoke/`, and `output/release-package-smoke/`.
- To roll back, revert `src/server/appServerStatusDiagnostics.ts`, `src/server/codexAppServerBridge.ts`, `src/server/rpcProxyRoute.ts`, `scripts/server-module-smoke.ts`, `docs/app-server-protocol-matrix.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-04 static verification: `git diff --check` passed.
- 2026-07-04 server module smoke: `node scripts\verify-server-modules.mjs` passed, including coverage for known v2 thread statuses, active flags, `thread/status/changed` status observation, and `thread/unsubscribe` response observation.
- 2026-07-04 typecheck/build: `node_modules\.bin\vue-tsc.cmd --noEmit`, `node_modules\.bin\vite.cmd build`, and `node_modules\.bin\tsup.cmd` passed; Vite still reports the existing large chunk warning.
- 2026-07-04 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-04 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: App Server thread status changed known notification

#### Prerequisites
- Current repository includes `src/server/appServerNotificationDiagnostics.ts`, `src/server/appServerStatusDiagnostics.ts`, `scripts/server-module-smoke.ts`, and `docs/app-server-protocol-matrix.zh-CN.md`.
- Dependencies are installed so server module smoke, TypeScript, Vite, tsup, governance, and release verification can run.

#### Steps
1. Open `src/server/appServerNotificationDiagnostics.ts` and confirm `thread/status/changed` is listed in `KNOWN_NOTIFICATION_METHODS`.
2. Open `src/server/codexAppServerBridge.ts` and confirm notification replay still forwards `thread/status/changed` payloads to `statusDiagnostics.observeStatusNotification(...)`.
3. Open `scripts/server-module-smoke.ts` and confirm `isKnownAppServerNotificationMethod('thread/status/changed')` is asserted as true.
4. Confirm the smoke observes a `thread/status/changed` notification and `unknownNotificationCount` remains driven only by genuinely unknown methods.
5. Open `docs/app-server-protocol-matrix.zh-CN.md` and confirm the Notifications row documents `thread/status/changed` as an official known runtime notification whose field-level unknown values are handled by status diagnostics.
6. Run `git diff --check`.
7. Run `node scripts\verify-server-modules.mjs`.
8. Run `node_modules\.bin\vue-tsc.cmd --noEmit`.
9. Run `node_modules\.bin\vite.cmd build`.
10. Run `node_modules\.bin\tsup.cmd`.
11. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
12. Run `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- `thread/status/changed` no longer appears in `recentUnknownNotifications`.
- Unknown status fields inside `thread/status/changed` still flow through status diagnostics.
- Notification diagnostics still records genuinely unknown methods by method name.
- Typecheck, build, governance, and release verification complete without new errors.

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required beyond normal build output in `dist/`, `dist-cli/`, `output/server-module-smoke/`, and `output/release-package-smoke/`.
- To roll back, remove `thread/status/changed` from `KNOWN_NOTIFICATION_METHODS`, revert the smoke assertion and observation, revert the matrix note, and remove this test section.

#### Regression Evidence
- 2026-07-04 static verification: `git diff --check` passed.
- 2026-07-04 server module smoke: `node scripts\verify-server-modules.mjs` passed, including coverage for `thread/status/changed` as a known notification that does not increment `unknownNotificationCount`.
- 2026-07-04 typecheck/build: `node_modules\.bin\vue-tsc.cmd --noEmit`, `node_modules\.bin\vite.cmd build`, and `node_modules\.bin\tsup.cmd` passed; Vite still reports the existing large chunk warning.
- 2026-07-04 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Governance docs check passed.`
- 2026-07-04 release gate: `node scripts\run-powershell-script.mjs .\scripts\verify-release.ps1 -AllowDirty -SkipBuild -SchemaAudit skip` passed with `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: CI release verification package runner alignment

#### Prerequisites
- Current repository includes `.github/workflows/ci.yml`, `package.json`, `scripts/run-powershell-script.mjs`, `scripts/verify-release.ps1`, and `scripts/verify-governance.ps1`.
- Dependencies are installed so the package-script release gate and governance verification can run.

#### Steps
1. Open `.github/workflows/ci.yml` and confirm the build job runs `npm run verify:release -- -SchemaAudit skip`.
2. Open `package.json` and confirm `verify:release` invokes `node ./scripts/run-powershell-script.mjs ./scripts/verify-release.ps1`.
3. Open `scripts/verify-governance.ps1` and confirm it requires the CI workflow to use `npm run verify:release -- -SchemaAudit skip`.
4. Open `docs/changelog.zh-CN.md` and confirm the unpublished protocol governance section records the CI runner alignment.
5. Run `git diff --check`.
6. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
7. Run `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- CI release verification uses the same package-script PowerShell runner path as local release verification.
- Governance verification fails if `.github/workflows/ci.yml` regresses to a direct `verify-release.ps1` invocation for the build job.
- Release verification still completes through the package script without requiring a direct PowerShell workflow command.

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required beyond normal release smoke output in `output/release-package-smoke/`.
- To roll back, restore the direct CI `verify-release.ps1` invocation, revert the governance assertion, and remove this changelog/test record.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Using PowerShell: pwsh (7.5.5)` and `Governance docs check passed.`
- 2026-07-05 package-script release gate: `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip` passed through `node ./scripts/run-powershell-script.mjs ./scripts/verify-release.ps1`, completing `frontend normalizer smoke ok`, `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: GitHub funding placeholder cleanup

#### Prerequisites
- Current repository includes `.github/FUNDING.yml`, `scripts/package-release.ps1`, `scripts/verify-release.ps1`, `scripts/verify-governance.ps1`, and `docs/changelog.zh-CN.md`.
- Dependencies are installed so governance and release package smoke can run.

#### Steps
1. Open `.github/FUNDING.yml` and confirm it no longer contains GitHub default placeholder text such as `Replace with`.
2. Confirm `.github/FUNDING.yml` explicitly says funding is not configured yet and keeps `custom: []`.
3. Open `scripts/package-release.ps1` and confirm `.github\FUNDING.yml` is included in the release package source list.
4. Open `scripts/verify-release.ps1` and confirm Release package smoke requires `.github\FUNDING.yml` inside the generated zip.
5. Open `scripts/verify-governance.ps1` and confirm governance rejects Funding placeholder text and requires the intentional no-funding marker.
6. Run `git diff --check`.
7. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
8. Run `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- The repository no longer ships the default GitHub Funding placeholder template.
- Governance verification fails if placeholder funding text returns.
- Release package smoke fails if `.github\FUNDING.yml` is omitted from the Web source zip.

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required beyond normal release smoke output in `output/release-package-smoke/`.
- To roll back, revert `.github/FUNDING.yml`, package/release smoke assertions, governance checks, changelog note, and this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Using PowerShell: pwsh (7.5.5)` and `Governance docs check passed.`
- 2026-07-05 release gate: `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip` passed with `frontend normalizer smoke ok`, `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: Release readiness checkpoint audit

#### Prerequisites
- Current repository includes `docs/release-readiness-audit.zh-CN.md`, `docs/app-server-schema-audit-summary.json`, `docs/app-server-protocol-matrix.zh-CN.md`, `scripts/verify-governance.ps1`, `scripts/verify-release.ps1`, `README.md`, and `docs/changelog.zh-CN.md`.
- Dependencies are installed, Codex CLI is available for App Server schema audit, and `dist/` plus `dist-cli/` already exist or can be rebuilt.

#### Steps
1. Run `git status --short --branch` and confirm the audit starts from a clean local `main` state.
2. Run `npm.cmd run audit:app-server-schemas` and confirm schema drift still exits `1` with an audit output directory, not a generation failure.
3. Open `output/app-server-schema-audit/<latest>/audit-summary.json` and confirm TypeScript/JSON root and v2 counts match the readiness audit summary.
4. Open `docs/release-readiness-audit.zh-CN.md` and confirm it states the project is suitable for an internal checkpoint or candidate branch, but not for claiming complete latest App Server alignment.
5. Open `README.md` and confirm the Release readiness audit is linked from quick entries and the documentation list.
6. Open `scripts/verify-release.ps1` and confirm Release package smoke requires `docs\release-readiness-audit.zh-CN.md`.
7. Run `git diff --check`.
8. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
9. Run `npm.cmd run build`.
10. Run `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- The readiness audit records current repo state, long-goal pause status, schema drift grouping, and recommended short next goal.
- The audit does not claim full latest App Server alignment while `docs/app-server-schema-audit-summary.json` remains `drift-recorded`.
- Governance fails if the readiness audit loses the paused-goal judgment, schema audit output reference, P0/P1/P2/P3 grouping, or “do not continue unbounded” recommendation.
- Release package smoke fails if the readiness audit is omitted from the Web source zip.

#### Rollback/Cleanup Notes
- Raw schema audit output under `output/app-server-schema-audit/` is generated evidence and should not be committed.
- To roll back, remove `docs/release-readiness-audit.zh-CN.md`, README links, release/governance assertions, changelog entry, and this test section from the same commit.

#### Regression Evidence
- 2026-07-05 schema audit: `npm.cmd run audit:app-server-schemas` generated `output\app-server-schema-audit\20260705-093004` and exited `1` with `Schema differences found. Exit code 1 means review is required, not that generation failed.`
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 build: `npm.cmd run build` passed, including `vue-tsc --noEmit`, Vite production build, and `tsup` CLI build; Vite still reports the existing large chunk warning.
- 2026-07-05 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Using PowerShell: pwsh (7.5.5)` and `Governance docs check passed.`
- 2026-07-05 release gate: `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip` passed with `frontend normalizer smoke ok`, `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: App Server process server request runtime extraction

#### Prerequisites
- Current repository includes `src/server/appServerProcess.ts`, `src/server/appServerProcessServerRequests.ts`, `src/server/appServerServerRequestHandler.ts`, `scripts/server-module-smoke.ts`, `scripts/verify-governance.ps1`, and `scripts/verify-release.ps1`.
- Dependencies are installed and `dist/` plus `dist-cli/` already exist, or run release verification without `-SkipBuild`.

#### Steps
1. Open `src/server/appServerProcessServerRequests.ts` and confirm `AppServerProcessServerRequests` owns pending server request storage, plan-mode turn bookkeeping, thread-id reading, request enqueueing, and manual request resolution.
2. Open `src/server/appServerProcess.ts` and confirm `AppServerProcess` delegates `handleServerRequest(...)`, `resolvePendingServerRequest(...)`, plan-mode count changes, pending request listing, and health pending/plan counts to `AppServerProcessServerRequests`.
3. Open `scripts/server-module-smoke.ts` and confirm `smokeAppServerProcessServerRequests()` covers plan-mode turn marking/clearing, pending request enqueue/listing by thread, manual resolution, notification emission, and reply forwarding without starting Codex CLI.
4. Open `scripts/verify-release.ps1` and confirm Release package smoke requires `src\server\appServerProcessServerRequests.ts` inside the release zip.
5. Run `git diff --check`.
6. Run `node scripts\verify-server-modules.mjs`.
7. Run `npm.cmd run build`.
8. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
9. Run `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- `AppServerProcess` no longer owns the pending server request store or plan-mode turn store directly.
- Server request policy evaluation remains in `appServerServerRequestHandler.ts`; this extraction only moves process-level bookkeeping and dependency wiring.
- Server module smoke validates the extracted runtime without requiring app-server startup.
- Release package smoke fails if the new process server request runtime module is omitted from the Web source zip.

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required beyond normal output in `output/server-module-smoke/` and `output/release-package-smoke/`.
- To roll back, move `AppServerProcessServerRequests` methods and stores back into `src/server/appServerProcess.ts`, delete `src/server/appServerProcessServerRequests.ts`, remove smoke/governance/release package references, revert changelog updates, and remove this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 server module smoke: `node scripts\verify-server-modules.mjs` passed, including `smokeAppServerProcessServerRequests()` coverage for plan-mode bookkeeping, pending request enqueue/listing, manual resolution, notification emission, and reply forwarding.
- 2026-07-05 build: `npm.cmd run build` passed, including `vue-tsc --noEmit`, Vite production build, and `tsup` CLI build; Vite still reports the existing large chunk warning.
- 2026-07-05 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Using PowerShell: pwsh (7.5.5)` and `Governance docs check passed.`
- 2026-07-05 release gate: `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip` passed with `frontend normalizer smoke ok`, `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: GitHub Release workflow npm runner alignment

#### Prerequisites
- Current repository includes `.github/workflows/release.yml`, `.github/release-body.md`, `package.json`, `scripts/run-powershell-script.mjs`, `scripts/verify-governance.ps1`, and `docs/changelog.zh-CN.md`.
- Dependencies are installed so governance and release verification can run.

#### Steps
1. Open `.github/workflows/release.yml` and confirm the release verification step runs `npm run verify:release -- -RequireCleanGit -SchemaAudit skip`.
2. Confirm the release bundle step runs `npm run package:release -- -Version "${env:GITHUB_REF_NAME}" -OutputDir "${env:RUNNER_TEMP}\release"`.
3. Confirm the artifact checksum step runs `npm run verify:release-artifacts -- -OutputDir "${env:RUNNER_TEMP}\release"`.
4. Open `.github/release-body.md` and confirm its workflow summary lists the same npm script entrypoints.
5. Open `scripts/verify-governance.ps1` and confirm governance requires the npm script workflow entrypoints and rejects the old direct `./scripts/*.ps1` release workflow commands.
6. Run `git diff --check`.
7. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
8. Run `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- CI and tag-triggered GitHub Release verification use the same package-script PowerShell runner path as local release verification.
- Release workflow no longer calls `verify-release.ps1`, `package-release.ps1`, or `verify-release-artifacts.ps1` directly for the main release gate, zip packaging, or checksum verification.
- Governance verification fails if the old direct release workflow commands return.

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required beyond normal release smoke output in `output/release-package-smoke/`.
- To roll back, restore the direct release workflow PowerShell commands, revert release-body/governance/changelog updates, and remove this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Using PowerShell: pwsh (7.5.5)` and `Governance docs check passed.`
- 2026-07-05 package wrapper smoke: `npm.cmd run package:release -- -Version workflow-runner-smoke -OutputDir output\release-workflow-runner-smoke` passed through `node ./scripts/run-powershell-script.mjs ./scripts/package-release.ps1`, producing `CX-Codex-workflow-runner-smoke.zip` and `.sha256`.
- 2026-07-05 artifact wrapper smoke: `npm.cmd run verify:release-artifacts -- -OutputDir output\release-workflow-runner-smoke` passed through `node ./scripts/run-powershell-script.mjs ./scripts/verify-release-artifacts.ps1`, outputting `checksum ok: CX-Codex-workflow-runner-smoke.zip` and `Release artifact checksum verification passed.`
- 2026-07-05 release gate: `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip` passed with `frontend normalizer smoke ok`, `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: Release gate package smoke npm runner alignment

#### Prerequisites
- Current repository includes `scripts/verify-release.ps1`, `package.json`, `scripts/run-powershell-script.mjs`, `scripts/package-release.ps1`, `scripts/verify-release-artifacts.ps1`, `scripts/verify-governance.ps1`, and `docs/changelog.zh-CN.md`.
- Dependencies are installed and `dist/` plus `dist-cli/` already exist, or run release verification without `-SkipBuild`.

#### Steps
1. Open `scripts/verify-release.ps1` and confirm `Release package smoke` invokes `$npmCommand` with `run package:release -- -Version verify-smoke -OutputDir <smoke-dir>`.
2. Confirm `Release artifact checksum smoke` invokes `$npmCommand` with `run verify:release-artifacts -- -OutputDir <smoke-dir>`.
3. Confirm the existing zip entry assertions and NPM package dry-run smoke still run after the npm-script package and artifact smoke.
4. Open `scripts/verify-governance.ps1` and confirm governance requires `package:release` and `verify:release-artifacts` references inside `scripts/verify-release.ps1`.
5. Run `git diff --check`.
6. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
7. Run `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- The local release gate continuously verifies the same npm package-script entrypoints used by the GitHub Release workflow.
- Release package smoke still generates `output/release-package-smoke/CX-Codex-verify-smoke.zip` and `.sha256`.
- Artifact checksum smoke still validates the generated zip checksum before zip content assertions run.
- Governance verification fails if `scripts/verify-release.ps1` no longer references the package and artifact npm scripts.

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required beyond normal release smoke output in `output/release-package-smoke/`.
- To roll back, restore direct PowerShell script invocation inside `scripts/verify-release.ps1`, revert governance/changelog updates, and remove this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Using PowerShell: pwsh (7.5.5)` and `Governance docs check passed.`
- 2026-07-05 release gate: `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip` passed; its internal `Release package smoke` ran `npm run package:release -- -Version verify-smoke -OutputDir ...`, its `Release artifact checksum smoke` ran `npm run verify:release-artifacts -- -OutputDir ...`, and the gate completed `frontend normalizer smoke ok`, `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: App Server server request handler extraction

#### Prerequisites
- Current repository includes `src/server/codexAppServerBridge.ts`, `src/server/appServerServerRequestHandler.ts`, `src/server/serverRequestPolicy.ts`, `src/server/pendingServerRequests.ts`, `scripts/server-module-smoke.ts`, `scripts/verify-governance.ps1`, and `scripts/verify-release.ps1`.
- Dependencies are installed and `dist/` plus `dist-cli/` already exist, or run release verification without `-SkipBuild`.

#### Steps
1. Open `src/server/appServerServerRequestHandler.ts` and confirm it owns `handleAppServerServerRequest(...)` plus the resolved-notification helper.
2. Open `src/server/codexAppServerBridge.ts` and confirm `AppServerProcess.handleServerRequest(...)` delegates policy resolution, automatic replies, pending queue creation, and `server/request` notification emission to the helper.
3. Open `scripts/server-module-smoke.ts` and confirm `smokeAppServerServerRequestHandler()` covers command auto-approval, unsupported `item/tool/call` rejection, and ordinary pending queue emission.
4. Open `scripts/verify-release.ps1` and confirm Release package smoke requires `src\server\appServerServerRequestHandler.ts` inside the release zip.
5. Run `git diff --check`.
6. Run `node scripts\verify-server-modules.mjs`.
7. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
8. Run `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- `server/request` handling behavior stays unchanged while bridge main file no longer contains the policy/pending branching implementation.
- Automatic permission approvals still send an immediate success reply and emit `server/request/resolved`.
- Unsupported tool calls still send the unsupported result, emit a resolved notification, and record a sanitized warning path.
- Non-immediate requests still enter `PendingServerRequestStore` and emit `server/request`.
- Release package smoke fails if the new helper module is omitted from the Web source zip.

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required beyond normal output in `output/server-module-smoke/` and `output/release-package-smoke/`.
- To roll back, move the helper logic back into `AppServerProcess.handleServerRequest(...)`, delete `src/server/appServerServerRequestHandler.ts`, remove smoke/governance/release package references, revert changelog updates, and remove this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 server module smoke: `node scripts\verify-server-modules.mjs` passed, including `smokeAppServerServerRequestHandler()` coverage for automatic command approval, unsupported `item/tool/call` rejection, and pending queue emission.
- 2026-07-05 build: `npm.cmd run build` passed, including `vue-tsc --noEmit`, Vite production build, and `tsup` CLI build; Vite still reports the existing large chunk warning.
- 2026-07-05 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Using PowerShell: pwsh (7.5.5)` and `Governance docs check passed.`
- 2026-07-05 release gate: `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip` passed with `frontend normalizer smoke ok`, `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: App Server process class extraction

#### Prerequisites
- Current repository includes `src/server/codexAppServerBridge.ts`, `src/server/appServerProcess.ts`, `scripts/server-module-smoke.ts`, `scripts/verify-governance.ps1`, and `scripts/verify-release.ps1`.
- Dependencies are installed and `dist/` plus `dist-cli/` already exist, or run release verification without `-SkipBuild`.

#### Steps
1. Open `src/server/appServerProcess.ts` and confirm `AppServerProcess` owns app-server process startup, JSON-RPC initialization, timeout recovery, pending RPC/session stores, server request handling, notifications, plan-mode bookkeeping, and health snapshots.
2. Open `src/server/codexAppServerBridge.ts` and confirm it imports `AppServerProcess` and only keeps shared state plus Codex bridge middleware assembly.
3. Open `scripts/server-module-smoke.ts` and confirm `smokeAppServerProcess()` covers the non-spawning initial health snapshot, pending request reads, plan-mode count changes, notification subscription cleanup, and dispose on a never-started instance.
4. Open `scripts/verify-release.ps1` and confirm Release package smoke requires `src\server\appServerProcess.ts` inside the release zip.
5. Run `git diff --check`.
6. Run `node scripts\verify-server-modules.mjs`.
7. Run `npm.cmd run build`.
8. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
9. Run `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- `codexAppServerBridge.ts` is reduced to bridge middleware composition and no longer owns the app-server process class.
- `AppServerProcess` behavior remains unchanged for runtime calls because the class body moved intact to the new module.
- Server module smoke validates the new public module without requiring Codex CLI startup.
- Release package smoke fails if the extracted process module is omitted from the Web source zip.

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required beyond normal output in `output/server-module-smoke/` and `output/release-package-smoke/`.
- To roll back, move `AppServerProcess` back into `src/server/codexAppServerBridge.ts`, delete `src/server/appServerProcess.ts`, remove smoke/governance/release package references, revert changelog updates, and remove this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 server module smoke: `node scripts\verify-server-modules.mjs` passed, including `smokeAppServerProcess()` coverage for initial health, pending request reads, plan-mode bookkeeping, notification unsubscribe, and dispose without starting Codex CLI.
- 2026-07-05 build: `npm.cmd run build` passed, including `vue-tsc --noEmit`, Vite production build, and `tsup` CLI build; Vite still reports the existing large chunk warning.
- 2026-07-05 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Using PowerShell: pwsh (7.5.5)` and `Governance docs check passed.`
- 2026-07-05 release gate: `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip` passed with `frontend normalizer smoke ok`, `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: App Server JSON-RPC line dispatcher extraction

#### Prerequisites
- Current repository includes `src/server/codexAppServerBridge.ts`, `src/server/appServerLineDispatcher.ts`, `src/server/appServerJsonRpcWire.ts`, `src/server/appServerRpcResponse.ts`, `scripts/server-module-smoke.ts`, `scripts/verify-governance.ps1`, and `scripts/verify-release.ps1`.
- Dependencies are installed and `dist/` plus `dist-cli/` already exist, or run release verification without `-SkipBuild`.

#### Steps
1. Open `src/server/appServerLineDispatcher.ts` and confirm `dispatchAppServerJsonRpcLine(...)` parses a stdout JSON-RPC line and delegates response, notification, and server-request events through injected dependencies.
2. Open `src/server/codexAppServerBridge.ts` and confirm `AppServerProcess.handleLine(...)` only binds bridge state dependencies into `dispatchAppServerJsonRpcLine(...)`.
3. Open `scripts/server-module-smoke.ts` and confirm `smokeAppServerLineDispatcher()` covers invalid JSON, pending response settlement, notification capture/emit, and server-request forwarding.
4. Open `scripts/verify-release.ps1` and confirm Release package smoke requires `src\server\appServerLineDispatcher.ts` inside the release zip.
5. Run `git diff --check`.
6. Run `node scripts\verify-server-modules.mjs`.
7. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
8. Run `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- Invalid stdout lines remain ignored.
- Pending response lines still finalize pending RPC state and log slow-RPC outcome.
- Notification lines still update notification-derived state before being emitted.
- Server-request lines still forward to the bridge server-request handler.
- Release package smoke fails if the new dispatcher module is omitted from the Web source zip.

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required beyond normal output in `output/server-module-smoke/` and `output/release-package-smoke/`.
- To roll back, move the dispatcher logic back into `AppServerProcess.handleLine(...)`, delete `src/server/appServerLineDispatcher.ts`, remove smoke/governance/release package references, revert changelog updates, and remove this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 server module smoke: `node scripts\verify-server-modules.mjs` passed, including `smokeAppServerLineDispatcher()` coverage for invalid JSON, pending response settlement, notification capture/emit, and server-request forwarding.
- 2026-07-05 build: `npm.cmd run build` passed, including `vue-tsc --noEmit`, Vite production build, and `tsup` CLI build; Vite still reports the existing large chunk warning.
- 2026-07-05 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Using PowerShell: pwsh (7.5.5)` and `Governance docs check passed.`
- 2026-07-05 release gate: `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip` passed with `frontend normalizer smoke ok`, `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: App Server pending server request resolution extraction

#### Prerequisites
- Current repository includes `src/server/codexAppServerBridge.ts`, `src/server/appServerServerRequestHandler.ts`, `src/server/pendingServerRequests.ts`, `src/server/serverRequestReply.ts`, `scripts/server-module-smoke.ts`, `scripts/verify-governance.ps1`, and `scripts/verify-release.ps1`.
- Dependencies are installed and `dist/` plus `dist-cli/` already exist, or run release verification without `-SkipBuild`.

#### Steps
1. Open `src/server/appServerServerRequestHandler.ts` and confirm it exports `resolveAppServerPendingServerRequest(...)`.
2. Open `src/server/codexAppServerBridge.ts` and confirm `AppServerProcess.resolvePendingServerRequest(...)` delegates pending consumption, reply writing, and `server/request/resolved` notification emission to `resolveAppServerPendingServerRequest(...)`.
3. Open `scripts/server-module-smoke.ts` and confirm `smokeAppServerServerRequestHandler()` covers manual pending request resolution and the missing pending request error branch.
4. Run `git diff --check`.
5. Run `node scripts\verify-server-modules.mjs`.
6. Run `npm.cmd run build`.
7. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
8. Run `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- Manual approval responses still consume exactly one pending request and write the corresponding JSON-RPC reply.
- A successful manual response emits `server/request/resolved` with `mode: "manual"` and the original request method/thread id.
- Responding to an unknown or already consumed request id still throws `No pending server request found for id ...`.
- Bridge main file no longer owns pending request resolution internals, reducing the surface that must change when request policy or notification behavior evolves.

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required beyond normal output in `output/server-module-smoke/` and `output/release-package-smoke/`.
- To roll back, move the pending consume/reply/resolved-notification logic back into `AppServerProcess.resolvePendingServerRequest(...)`, remove `resolveAppServerPendingServerRequest(...)`, revert smoke/changelog updates, and remove this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 server module smoke: `node scripts\verify-server-modules.mjs` passed, including `smokeAppServerServerRequestHandler()` coverage for manual pending request resolution and the missing pending request error branch.
- 2026-07-05 build: `npm.cmd run build` passed, including `vue-tsc --noEmit`, Vite production build, and `tsup` CLI build; Vite still reports the existing large chunk warning.
- 2026-07-05 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Using PowerShell: pwsh (7.5.5)` and `Governance docs check passed.`
- 2026-07-05 release gate: `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip` passed with `frontend normalizer smoke ok`, `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: App Server process handler extraction

#### Prerequisites
- Current repository includes `src/server/codexAppServerBridge.ts`, `src/server/appServerProcessHandlers.ts`, `scripts/server-module-smoke.ts`, `scripts/verify-governance.ps1`, and `scripts/verify-release.ps1`.
- Dependencies are installed and `dist/` plus `dist-cli/` already exist, or run release verification without `-SkipBuild`.

#### Steps
1. Open `src/server/appServerProcessHandlers.ts` and confirm `attachAppServerProcessHandlers(...)` owns stdout, stderr, stdin error, process error, and process exit event binding.
2. Open `src/server/codexAppServerBridge.ts` and confirm `AppServerProcess.start()` delegates process event binding to `attachAppServerProcessHandlers(...)` while retaining bridge state reset, restart, and pending request cleanup decisions.
3. Open `scripts/server-module-smoke.ts` and confirm `smokeAppServerProcessHandlers()` covers stdout forwarding, stderr trim/blank suppression, stale stdin/process error suppression, and exit forwarding.
4. Open `scripts/verify-release.ps1` and confirm Release package smoke requires `src\server\appServerProcessHandlers.ts` inside the release zip.
5. Run `git diff --check`.
6. Run `node scripts\verify-server-modules.mjs`.
7. Run `npm.cmd run build`.
8. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
9. Run `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- App Server stdout chunks still feed the JSON-RPC line buffer.
- Non-empty stderr chunks are trimmed and logged, while blank stderr chunks are ignored.
- Stale stdin and process error events do not trigger bridge recovery callbacks.
- Process exit events still reach the bridge so existing expected/unexpected exit handling remains authoritative.
- Release package smoke fails if the process handler helper is omitted from the Web source zip.

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required beyond normal output in `output/server-module-smoke/` and `output/release-package-smoke/`.
- To roll back, move the process event binding code back into `AppServerProcess.start()`, delete `src/server/appServerProcessHandlers.ts`, remove smoke/governance/release package references, revert changelog updates, and remove this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 server module smoke: `node scripts\verify-server-modules.mjs` passed, including `smokeAppServerProcessHandlers()` coverage for stdout forwarding, stderr trim/blank suppression, stale stdin/process error suppression, and exit forwarding.
- 2026-07-05 build: `npm.cmd run build` passed, including `vue-tsc --noEmit`, Vite production build, and `tsup` CLI build; Vite still reports the existing large chunk warning.
- 2026-07-05 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Using PowerShell: pwsh (7.5.5)` and `Governance docs check passed.`
- 2026-07-05 release gate: `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip` passed with `frontend normalizer smoke ok`, `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: App Server process runtime cleanup extraction

#### Prerequisites
- Current repository includes `src/server/codexAppServerBridge.ts`, `src/server/appServerProcessCleanup.ts`, `scripts/server-module-smoke.ts`, `scripts/verify-governance.ps1`, and `scripts/verify-release.ps1`.
- Dependencies are installed and `dist/` plus `dist-cli/` already exist, or run release verification without `-SkipBuild`.

#### Steps
1. Open `src/server/appServerProcessCleanup.ts` and confirm `cleanupAppServerProcessRuntime(...)` owns pending RPC rejection, optional queued RPC rejection, and session store cleanup.
2. Open `src/server/codexAppServerBridge.ts` and confirm process error, process exit, restart, and dispose flows delegate shared runtime cleanup to `cleanupProcessRuntime(...)` while keeping process identity, initialization flags, stdout buffer clearing, cooldown, and termination decisions in the bridge.
3. Open `scripts/server-module-smoke.ts` and confirm `smokeAppServerProcessCleanup()` covers default pending/queued/session cleanup and the dispose-style `rejectQueuedRpcCalls: false` branch.
4. Open `scripts/verify-release.ps1` and confirm Release package smoke requires `src\server\appServerProcessCleanup.ts` inside the release zip.
5. Run `git diff --check`.
6. Run `node scripts\verify-server-modules.mjs`.
7. Run `npm.cmd run build`.
8. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
9. Run `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- Process error, unexpected exit, and restart cleanup still reject pending RPCs, reject queued RPCs, and clear App Server session stores.
- Dispose still reuses the shared cleanup while avoiding a second queued RPC rejection after its existing pre-check rejection.
- Bridge lifecycle decisions stay local to `codexAppServerBridge.ts`; only repeated runtime cleanup moves out.
- Release package smoke fails if the cleanup helper is omitted from the Web source zip.

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required beyond normal output in `output/server-module-smoke/` and `output/release-package-smoke/`.
- To roll back, move the pending/queued/session cleanup calls back into `AppServerProcess` branches, delete `src/server/appServerProcessCleanup.ts`, remove smoke/governance/release package references, revert changelog updates, and remove this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 server module smoke: `node scripts\verify-server-modules.mjs` passed, including `smokeAppServerProcessCleanup()` coverage for default pending/queued/session cleanup and the dispose-style queued rejection skip branch.
- 2026-07-05 build: `npm.cmd run build` passed, including `vue-tsc --noEmit`, Vite production build, and `tsup` CLI build; Vite still reports the existing large chunk warning.
- 2026-07-05 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Using PowerShell: pwsh (7.5.5)` and `Governance docs check passed.`
- 2026-07-05 release gate: `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip` passed with `frontend normalizer smoke ok`, `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: App Server JSON-RPC writer extraction

#### Prerequisites
- Current repository includes `src/server/codexAppServerBridge.ts`, `src/server/appServerJsonRpcWriter.ts`, `scripts/server-module-smoke.ts`, `scripts/verify-governance.ps1`, and `scripts/verify-release.ps1`.
- Dependencies are installed and `dist/` plus `dist-cli/` already exist, or run release verification without `-SkipBuild`.

#### Steps
1. Open `src/server/appServerJsonRpcWriter.ts` and confirm `sendAppServerJsonRpcLine(...)` owns process presence validation, JSON line serialization, stdin write, and write-failure callback dispatch.
2. Open `src/server/codexAppServerBridge.ts` and confirm `AppServerProcess.sendLine(...)` delegates to `sendAppServerJsonRpcLine(...)` while retaining the `stdin write failed` restart reason.
3. Open `scripts/server-module-smoke.ts` and confirm `smokeAppServerJsonRpcWriter()` covers normal JSON line writes, missing process errors, and write failures that invoke the recovery callback before rethrowing.
4. Open `scripts/verify-release.ps1` and confirm Release package smoke requires `src\server\appServerJsonRpcWriter.ts` inside the release zip.
5. Run `git diff --check`.
6. Run `node scripts\verify-server-modules.mjs`.
7. Run `npm.cmd run build`.
8. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
9. Run `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- App Server RPC requests, notifications, and server request replies still write as one JSON line ending with `\n`.
- Calling the writer without a running process still throws `codex app-server is not running`.
- A synchronous stdin write failure still calls the bridge recovery callback and rethrows the original error.
- Release package smoke fails if the writer helper is omitted from the Web source zip.

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required beyond normal output in `output/server-module-smoke/` and `output/release-package-smoke/`.
- To roll back, move the JSON stringify/stdin write logic back into `AppServerProcess.sendLine(...)`, delete `src/server/appServerJsonRpcWriter.ts`, remove smoke/governance/release package references, revert changelog updates, and remove this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 server module smoke: `node scripts\verify-server-modules.mjs` passed, including `smokeAppServerJsonRpcWriter()` coverage for normal JSON line writes, missing process errors, and stdin write failures that invoke the recovery callback before rethrowing.
- 2026-07-05 build: `npm.cmd run build` passed, including `vue-tsc --noEmit`, Vite production build, and `tsup` CLI build; Vite still reports the existing large chunk warning.
- 2026-07-05 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Using PowerShell: pwsh (7.5.5)` and `Governance docs check passed.`
- 2026-07-05 release gate: `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip` passed with `frontend normalizer smoke ok`, `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: Codex bridge request error extraction

#### Prerequisites
- Current repository includes `src/server/codexAppServerBridge.ts`, `src/server/codexBridgeRequestError.ts`, `scripts/server-module-smoke.ts`, `scripts/verify-governance.ps1`, and `scripts/verify-release.ps1`.
- Dependencies are installed and `dist/` plus `dist-cli/` already exist, or run release verification without `-SkipBuild`.

#### Steps
1. Open `src/server/codexBridgeRequestError.ts` and confirm `writeCodexBridgeRequestError(...)` owns bridge request 413 and 502 JSON responses.
2. Open `src/server/codexAppServerBridge.ts` and confirm the middleware catch block delegates to `writeCodexBridgeRequestError(...)` while passing request method and path.
3. Open `scripts/server-module-smoke.ts` and confirm `smokeCodexBridgeRequestError()` covers `RequestBodyTooLargeError` as 413 and ordinary bridge failure as 502.
4. Open `scripts/verify-release.ps1` and confirm Release package smoke requires `src\server\codexBridgeRequestError.ts` inside the release zip.
5. Run `git diff --check`.
6. Run `node scripts\verify-server-modules.mjs`.
7. Run `npm.cmd run build`.
8. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
9. Run `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- Oversized JSON request body errors still return status 413 with the existing maximum-size message.
- Ordinary bridge request failures still log the request method/path and return status 502 with the normalized error message.
- The main bridge middleware no longer owns HTTP error response formatting.
- Release package smoke fails if the request error helper is omitted from the Web source zip.

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required beyond normal output in `output/server-module-smoke/` and `output/release-package-smoke/`.
- To roll back, move the catch-block error response logic back into `createCodexBridgeMiddleware()`, delete `src/server/codexBridgeRequestError.ts`, remove smoke/governance/release package references, revert changelog updates, and remove this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 server module smoke: `node scripts\verify-server-modules.mjs` passed, including `smokeCodexBridgeRequestError()` coverage for `RequestBodyTooLargeError` as 413 and ordinary bridge failure as 502.
- 2026-07-05 build: `npm.cmd run build` passed, including `vue-tsc --noEmit`, Vite production build, and `tsup` CLI build; Vite still reports the existing large chunk warning.
- 2026-07-05 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Using PowerShell: pwsh (7.5.5)` and `Governance docs check passed.`
- 2026-07-05 release gate: `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip` passed with `frontend normalizer smoke ok`, `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: Codex bridge route dispatch extraction

#### Prerequisites
- Current repository includes `src/server/codexAppServerBridge.ts`, `src/server/codexBridgeRouteDispatch.ts`, `scripts/server-module-smoke.ts`, `scripts/verify-governance.ps1`, and `scripts/verify-release.ps1`.
- Dependencies are installed and `dist/` plus `dist-cli/` already exist, or run release verification without `-SkipBuild`.

#### Steps
1. Open `src/server/codexBridgeRouteDispatch.ts` and confirm `runCodexBridgeRouteHandlers(...)` owns ordered route handler execution and first-match stopping.
2. Open `src/server/codexAppServerBridge.ts` and confirm the middleware still binds each route dependency locally, but delegates sequential route handling to `runCodexBridgeRouteHandlers(...)`.
3. Open `scripts/server-module-smoke.ts` and confirm `smokeCodexBridgeRouteDispatch()` covers sync and async handlers, first true stopping, and all-false unhandled results.
4. Open `scripts/verify-release.ps1` and confirm Release package smoke requires `src\server\codexBridgeRouteDispatch.ts` inside the release zip.
5. Run `git diff --check`.
6. Run `node scripts\verify-server-modules.mjs`.
7. Run `npm.cmd run build`.
8. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
9. Run `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- Route handlers still run in their existing order.
- Dispatch stops after the first handler returns true, including async handlers.
- If every handler returns false, middleware continues to `next()`.
- Release package smoke fails if the route dispatch helper is omitted from the Web source zip.

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required beyond normal output in `output/server-module-smoke/` and `output/release-package-smoke/`.
- To roll back, restore the explicit `if (await handleRoute(...)) return` sequence in `createCodexBridgeMiddleware()`, delete `src/server/codexBridgeRouteDispatch.ts`, remove smoke/governance/release package references, revert changelog updates, and remove this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 server module smoke: `node scripts\verify-server-modules.mjs` passed, including `smokeCodexBridgeRouteDispatch()` coverage for sync and async handlers, first true stopping, and all-false unhandled results.
- 2026-07-05 build: `npm.cmd run build` passed, including `vue-tsc --noEmit`, Vite production build, and `tsup` CLI build; Vite still reports the existing large chunk warning.
- 2026-07-05 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Using PowerShell: pwsh (7.5.5)` and `Governance docs check passed.`
- 2026-07-05 release gate: `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip` passed with `frontend normalizer smoke ok`, `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: Codex bridge middleware dispose extraction

#### Prerequisites
- Current repository includes `src/server/codexAppServerBridge.ts`, `src/server/codexBridgeMiddlewareDispose.ts`, `scripts/server-module-smoke.ts`, `scripts/verify-governance.ps1`, and `scripts/verify-release.ps1`.
- Dependencies are installed and `dist/` plus `dist-cli/` already exist, or run release verification without `-SkipBuild`.

#### Steps
1. Open `src/server/codexBridgeMiddlewareDispose.ts` and confirm `disposeCodexBridgeMiddlewareResources(...)` owns the middleware resource cleanup order.
2. Open `src/server/codexAppServerBridge.ts` and confirm `middleware.dispose` delegates to `disposeCodexBridgeMiddlewareResources(...)` with the existing scheduler, stores, listeners, diagnostics, and app server.
3. Open `scripts/server-module-smoke.ts` and confirm `smokeCodexBridgeMiddlewareDispose()` covers the cleanup order.
4. Open `scripts/verify-release.ps1` and confirm Release package smoke requires `src\server\codexBridgeMiddlewareDispose.ts` inside the release zip.
5. Run `git diff --check`.
6. Run `node scripts\verify-server-modules.mjs`.
7. Run `npm.cmd run build`.
8. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
9. Run `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- Middleware disposal still disposes the runtime reconcile scheduler before clearing route/runtime caches.
- Notification listeners are cleared before app-server notification unsubscribe.
- Diagnostics caches, runtime store, and app-server process are still disposed in the existing order.
- Release package smoke fails if the dispose helper is omitted from the Web source zip.

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required beyond normal output in `output/server-module-smoke/` and `output/release-package-smoke/`.
- To roll back, move the resource cleanup sequence back into `middleware.dispose`, delete `src/server/codexBridgeMiddlewareDispose.ts`, remove smoke/governance/release package references, revert changelog updates, and remove this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 server module smoke: `node scripts\verify-server-modules.mjs` passed, including `smokeCodexBridgeMiddlewareDispose()` coverage for middleware resource cleanup order.
- 2026-07-05 build: `npm.cmd run build` passed, including `vue-tsc --noEmit`, Vite production build, and `tsup` CLI build; Vite still reports the existing large chunk warning.
- 2026-07-05 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Using PowerShell: pwsh (7.5.5)` and `Governance docs check passed.`
- 2026-07-05 release gate: `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip` passed with `frontend normalizer smoke ok`, `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: Codex bridge route handler list extraction

#### Prerequisites
- Current repository includes `src/server/codexAppServerBridge.ts`, `src/server/codexBridgeRouteHandlers.ts`, `src/server/codexBridgeRouteDispatch.ts`, `scripts/server-module-smoke.ts`, `scripts/verify-governance.ps1`, and `scripts/verify-release.ps1`.
- Dependencies are installed and `dist/` plus `dist-cli/` already exist, or run release verification without `-SkipBuild`.

#### Steps
1. Open `src/server/codexBridgeRouteHandlers.ts` and confirm `createCodexBridgeRouteHandlers(...)` owns the ordered route handler list for the Codex bridge middleware.
2. Open `src/server/codexAppServerBridge.ts` and confirm `createCodexBridgeMiddleware()` now passes local stores/readers/actions into `createCodexBridgeRouteHandlers(...)`, then delegates execution to `runCodexBridgeRouteHandlers(...)`.
3. Open `scripts/server-module-smoke.ts` and confirm `smokeCodexBridgeRouteHandlers()` covers route count, notification replay accessor binding, and an unknown URL returning unhandled.
4. Open `scripts/verify-release.ps1` and confirm Release package smoke requires `src\server\codexBridgeRouteHandlers.ts` inside the release zip.
5. Run `git diff --check`.
6. Run `node scripts\verify-server-modules.mjs`.
7. Run `npm.cmd run build`.
8. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
9. Run `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- Bridge route order remains centralized and unchanged from the previous middleware sequence.
- Notification replay still uses `listNotificationEventsAfter`, while SSE still uses `subscribeNotifications`.
- Unknown URLs remain unhandled so the middleware can call `next()`.
- Release package smoke fails if the route handler list helper is omitted from the Web source zip.

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required beyond normal output in `output/server-module-smoke/` and `output/release-package-smoke/`.
- To roll back, move the route handler array back into `createCodexBridgeMiddleware()`, delete `src/server/codexBridgeRouteHandlers.ts`, remove smoke/governance/release package references, revert changelog updates, and remove this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 server module smoke: `node scripts\verify-server-modules.mjs` passed, including `smokeCodexBridgeRouteHandlers()` coverage for route count, notification replay accessor binding, and unknown URL unhandled behavior.
- 2026-07-05 build: `npm.cmd run build` passed, including `vue-tsc --noEmit`, Vite production build, and `tsup` CLI build; Vite still reports the existing large chunk warning.
- 2026-07-05 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Using PowerShell: pwsh (7.5.5)` and `Governance docs check passed.`
- 2026-07-05 release gate: `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip` passed with `frontend normalizer smoke ok`, `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: Codex bridge shared state extraction

#### Prerequisites
- Current repository includes `src/server/codexAppServerBridge.ts`, `src/server/codexBridgeSharedState.ts`, `scripts/server-module-smoke.ts`, `scripts/verify-governance.ps1`, and `scripts/verify-release.ps1`.
- Dependencies are installed and `dist/` plus `dist-cli/` already exist, or run release verification without `-SkipBuild`.

#### Steps
1. Open `src/server/codexBridgeSharedState.ts` and confirm `getCodexBridgeSharedState(...)` owns the global shared state key and creates app-server/method catalog only on the first call.
2. Open `src/server/codexAppServerBridge.ts` and confirm `getSharedBridgeState()` delegates to `getCodexBridgeSharedState(...)` with `AppServerProcess` and `AppServerMethodCatalog` factory callbacks.
3. Open `scripts/server-module-smoke.ts` and confirm `smokeCodexBridgeSharedState()` covers repeated reads returning the same state and factory callbacks running once.
4. Open `scripts/verify-release.ps1` and confirm Release package smoke requires `src\server\codexBridgeSharedState.ts` inside the release zip.
5. Run `git diff --check`.
6. Run `node scripts\verify-server-modules.mjs`.
7. Run `npm.cmd run build`.
8. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
9. Run `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- Repeated bridge middleware creation still reuses the same shared app-server and method catalog state through the original global key.
- The helper can be smoke-tested with an injected global scope without spawning Codex app-server.
- Release package smoke fails if the shared state helper is omitted from the Web source zip.

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required beyond normal output in `output/server-module-smoke/` and `output/release-package-smoke/`.
- To roll back, move the global shared state key and creation logic back into `src/server/codexAppServerBridge.ts`, delete `src/server/codexBridgeSharedState.ts`, remove smoke/governance/release package references, revert changelog updates, and remove this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 server module smoke: `node scripts\verify-server-modules.mjs` passed, including `smokeCodexBridgeSharedState()` coverage for singleton reuse and factory invocation counts.
- 2026-07-05 build: `npm.cmd run build` passed, including `vue-tsc --noEmit`, Vite production build, and `tsup` CLI build; Vite still reports the existing large chunk warning.
- 2026-07-05 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Using PowerShell: pwsh (7.5.5)` and `Governance docs check passed.`
- 2026-07-05 release gate: `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip` passed with `frontend normalizer smoke ok`, `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: Codex bridge notification runtime extraction

#### Prerequisites
- Current repository includes `src/server/codexAppServerBridge.ts`, `src/server/codexBridgeNotificationRuntime.ts`, `scripts/server-module-smoke.ts`, `scripts/verify-governance.ps1`, and `scripts/verify-release.ps1`.
- Dependencies are installed and `dist/` plus `dist-cli/` already exist, or run release verification without `-SkipBuild`.

#### Steps
1. Open `src/server/codexBridgeNotificationRuntime.ts` and confirm `createCodexBridgeNotificationRuntime(...)` owns notification replay creation, App Server notification subscription, runtime state sync, thread/read cache invalidation, and bridge listener emission.
2. Open `src/server/codexAppServerBridge.ts` and confirm `createCodexBridgeMiddleware()` delegates the notification replay/sync/listener setup to `createCodexBridgeNotificationRuntime(...)`.
3. Open `scripts/server-module-smoke.ts` and confirm `smokeCodexBridgeNotificationRuntime()` covers one App Server notification flowing through persisted replay, diagnostics observers, runtime state observation, cache deletion, and bridge listener emission.
4. Open `scripts/verify-release.ps1` and confirm Release package smoke requires `src\server\codexBridgeNotificationRuntime.ts` inside the release zip.
5. Run `git diff --check`.
6. Run `node scripts\verify-server-modules.mjs`.
7. Run `npm.cmd run build`.
8. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
9. Run `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- App Server notifications are still remembered for replay with incrementing sequence numbers.
- Runtime state observation, diagnostics snapshots, thread/read cache invalidation, and bridge notification listeners still receive the same event.
- The App Server notification unsubscribe function is still exposed for middleware disposal.
- Release package smoke fails if the notification runtime helper is omitted from the Web source zip.

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required beyond normal output in `output/server-module-smoke/` and `output/release-package-smoke/`.
- To roll back, move the notification replay bundle, App Server notification subscription, runtime sync, and bridge listener setup back into `src/server/codexAppServerBridge.ts`, delete `src/server/codexBridgeNotificationRuntime.ts`, remove smoke/governance/release package references, revert changelog updates, and remove this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 server module smoke: `node scripts\verify-server-modules.mjs` passed, including `smokeCodexBridgeNotificationRuntime()` coverage for persisted replay, diagnostics observers, runtime observation, cache deletion, bridge listener emission, and unsubscribe.
- 2026-07-05 build: `npm.cmd run build` passed, including `vue-tsc --noEmit`, Vite production build, and `tsup` CLI build; Vite still reports the existing large chunk warning.
- 2026-07-05 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Using PowerShell: pwsh (7.5.5)` and `Governance docs check passed.`
- 2026-07-05 release gate: `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip` passed with `frontend normalizer smoke ok`, `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: Codex bridge runtime operations extraction

#### Prerequisites
- Current repository includes `src/server/codexAppServerBridge.ts`, `src/server/codexBridgeRuntimeOperations.ts`, `scripts/server-module-smoke.ts`, `scripts/verify-governance.ps1`, and `scripts/verify-release.ps1`.
- Dependencies are installed and `dist/` plus `dist-cli/` already exist, or run release verification without `-SkipBuild`.

#### Steps
1. Open `src/server/codexBridgeRuntimeOperations.ts` and confirm `createCodexBridgeRuntimeOperations(...)` owns runtime snapshot persistence, thread/local readers, cached token usage reader, runtime reconciliation, and send/interrupt action wiring.
2. Open `src/server/codexAppServerBridge.ts` and confirm `createCodexBridgeMiddleware()` delegates those runtime operations to `createCodexBridgeRuntimeOperations(...)` while still passing the same app server, runtime store, runtime state store, caches, diagnostics, and bridge logging callbacks.
3. Open `scripts/server-module-smoke.ts` and confirm `smokeCodexBridgeRuntimeOperations()` covers the factory outputs and `persistRuntimeSnapshot(...)` writing through the injected runtime store.
4. Open `scripts/verify-release.ps1` and confirm Release package smoke requires `src\server\codexBridgeRuntimeOperations.ts` inside the release zip.
5. Run `git diff --check`.
6. Run `node scripts\verify-server-modules.mjs`.
7. Run `npm.cmd run build`.
8. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
9. Run `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- Runtime snapshot persistence still enriches snapshots with pending server requests and token usage before upserting to the runtime store.
- Thread/local snapshot readers, runtime reconciliation, send, and interrupt actions are still exposed to the bridge route handlers.
- The runtime reconcile scheduler remains disposable for middleware cleanup.
- Release package smoke fails if the runtime operations helper is omitted from the Web source zip.

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required beyond normal output in `output/server-module-smoke/` and `output/release-package-smoke/`.
- To roll back, move the runtime snapshot/read/reconcile/action wiring back into `src/server/codexAppServerBridge.ts`, delete `src/server/codexBridgeRuntimeOperations.ts`, remove smoke/governance/release package references, revert changelog updates, and remove this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 server module smoke: `node scripts\verify-server-modules.mjs` passed, including `smokeCodexBridgeRuntimeOperations()` coverage for factory outputs and snapshot persistence through the injected runtime store.
- 2026-07-05 build: `npm.cmd run build` passed, including `vue-tsc --noEmit`, Vite production build, and `tsup` CLI build; Vite still reports the existing large chunk warning.
- 2026-07-05 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Using PowerShell: pwsh (7.5.5)` and `Governance docs check passed.`
- 2026-07-05 release gate: `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip` passed with `frontend normalizer smoke ok`, `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: Codex bridge middleware state extraction

#### Prerequisites
- Current repository includes `src/server/codexAppServerBridge.ts`, `src/server/codexBridgeMiddlewareState.ts`, `scripts/server-module-smoke.ts`, `scripts/verify-governance.ps1`, and `scripts/verify-release.ps1`.
- Dependencies are installed and `dist/` plus `dist-cli/` already exist, or run release verification without `-SkipBuild`.

#### Steps
1. Open `src/server/codexBridgeMiddlewareState.ts` and confirm `createCodexBridgeMiddlewareState(...)` owns the bridge middleware state creation for thread search/read cache, thread list augmentation, runtime state/store, notification/status diagnostics, hook diagnostics cache, and Windows sandbox readiness cache.
2. Open `src/server/codexAppServerBridge.ts` and confirm `createCodexBridgeMiddleware()` delegates those base stores and diagnostics to `createCodexBridgeMiddlewareState(appServer)`.
3. Open `scripts/server-module-smoke.ts` and confirm `smokeCodexBridgeMiddlewareState()` covers the factory outputs and closes the created runtime store.
4. Open `scripts/verify-release.ps1` and confirm Release package smoke requires `src\server\codexBridgeMiddlewareState.ts` inside the release zip.
5. Run `git diff --check`.
6. Run `node scripts\verify-server-modules.mjs`.
7. Run `npm.cmd run build`.
8. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
9. Run `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- Bridge middleware still creates all state stores, caches, and diagnostics needed by route handlers, notification runtime, runtime operations, and disposal.
- Thread search/list augmentation still uses the injected app-server RPC path.
- The created runtime store remains closeable for middleware disposal and smoke cleanup.
- Release package smoke fails if the middleware state helper is omitted from the Web source zip.

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required beyond normal output in `output/server-module-smoke/` and `output/release-package-smoke/`.
- To roll back, move the middleware state creation back into `src/server/codexAppServerBridge.ts`, delete `src/server/codexBridgeMiddlewareState.ts`, remove smoke/governance/release package references, revert changelog updates, and remove this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 server module smoke: `node scripts\verify-server-modules.mjs` passed, including `smokeCodexBridgeMiddlewareState()` coverage for the middleware state factory outputs.
- 2026-07-05 build: `npm.cmd run build` passed, including `vue-tsc --noEmit`, Vite production build, and `tsup` CLI build; Vite still reports the existing large chunk warning.
- 2026-07-05 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Using PowerShell: pwsh (7.5.5)` and `Governance docs check passed.`
- 2026-07-05 release gate: `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip` passed with `frontend normalizer smoke ok`, `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: OpenAI official docs review MCP source refresh

#### Prerequisites
- Current repository includes `docs/openai-docs-review.zh-CN.md`, `docs/changelog.zh-CN.md`, `scripts/verify-governance.ps1`, and `scripts/verify-release.ps1`.
- Network access is available for official OpenAI documentation checks.
- The Codex manual helper can refresh or validate the local manual cache.

#### Steps
1. Run `codex mcp add openaiDeveloperDocs --url https://developers.openai.com/mcp` and confirm the global OpenAI Docs MCP server is registered for the next Codex restart.
2. Run `node C:\Users\SW\.codex\skills\.system\openai-docs\scripts\fetch-codex-manual.mjs` and confirm the manual is current or refreshed successfully.
3. Open `https://developers.openai.com/codex/app-server` and confirm the page still documents `initialize`, `initialized`, `capabilities.experimentalApi`, WebSocket transport as experimental / unsupported, and WebSocket auth requirements.
4. Open `https://developers.openai.com/codex/remote-connections` and confirm remote project access still uses SSH with normal SSH security expectations rather than unauthenticated public listeners.
5. Open `https://developers.openai.com/api/docs/guides/speech-to-text` and confirm file uploads are still limited to 25 MB and diarize examples still use `gpt-4o-transcribe-diarize`, `response_format=diarized_json`, and `chunking_strategy=auto`.
6. Open `https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create` and confirm the API reference still lists `gpt-4o-transcribe-diarize`, `diarized_json`, and `chunking_strategy` requirements for diarized long audio.
7. Open `https://developers.openai.com/api/docs/guides/migrate-to-responses` and confirm Responses is recommended for new general OpenAI projects while retaining a distinct `Items` / `output` object model.
8. Run `git diff --check`.
9. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
10. Run `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- OpenAI Docs MCP is configured for future Codex sessions, while this no-restart session still treats official OpenAI web pages as the evidence source.
- `docs/openai-docs-review.zh-CN.md` has an absolute 2026-07-05 02:12 Asia/Shanghai review timestamp and records the source boundary clearly.
- The review still distinguishes Codex App Server protocol alignment from supplemental OpenAI API usage.
- Speech to text remains server-side and constrained by official model, response format, chunking, and upload limit requirements.
- Governance and release verification continue to package and enforce the review handbook.

#### Rollback/Cleanup Notes
- No runtime artifact cleanup is required beyond normal generated output in `output/frontend-normalizer-smoke/`, `output/server-module-smoke/`, and `output/release-package-smoke/`.
- To roll back this documentation refresh, revert the `docs/openai-docs-review.zh-CN.md`, `docs/changelog.zh-CN.md`, and `tests.md` changes from the same commit.

#### Regression Evidence
- 2026-07-05 MCP setup: `codex mcp add openaiDeveloperDocs --url https://developers.openai.com/mcp` passed with `Added global MCP server 'openaiDeveloperDocs'.`
- 2026-07-05 Codex manual check: `node C:\Users\SW\.codex\skills\.system\openai-docs\scripts\fetch-codex-manual.mjs` passed and reported `Manual status: local manual was already current.`
- 2026-07-05 official docs check: official Codex App Server documentation still records `initialize`, `initialized`, `capabilities.experimentalApi`, WebSocket transport as experimental / unsupported, and WebSocket auth; official Remote connections documentation still records SSH remote access with normal SSH security expectations.
- 2026-07-05 official API docs check: official Speech to text documentation still records the 25 MB upload limit and diarize multipart example; the audio transcription API reference still records `gpt-4o-transcribe-diarize`, `diarized_json`, and `chunking_strategy` requirements; the Responses migration guide still recommends Responses for new general OpenAI projects while documenting a distinct Items/output object model.
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 build: `npm.cmd run build` passed, including `vue-tsc --noEmit`, Vite production build, and `tsup` CLI build; Vite still reports the existing large chunk warning.
- 2026-07-05 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Using PowerShell: pwsh (7.5.5)` and `Governance docs check passed.`
- 2026-07-05 release gate: `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip` passed with `frontend normalizer smoke ok`, `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: Candidate release review

#### Prerequisites
- Current repository includes `README.md`, `.github/release-body.md`, `RELEASE.md`, `SECURITY.md`, `docs/openai-docs-review.zh-CN.md`, `docs/app-server-protocol-matrix.zh-CN.md`, `docs/release-readiness-audit.zh-CN.md`, `scripts/verify-governance.ps1`, and `scripts/verify-release.ps1`.
- OpenAI Docs MCP is available for official documentation lookup.
- Codex CLI is installed and can run `codex app-server generate-ts` plus `codex app-server generate-json-schema`.
- Working tree is clean before running the formal `-RequireCleanGit` release gate.

#### Steps
1. Run `npm.cmd run verify:release -- -RequireCleanGit -SchemaAudit warn`.
2. Confirm the command completes successfully even when schema drift warnings are emitted in warn mode.
3. Open `output/app-server-schema-audit/20260705-102346/audit-summary.json` and confirm the drift counts remain TypeScript root `236/77/15/174`, TypeScript v2 `199/445/260/14`, JSON root `37/35/5/7`, and JSON v2 `102/202/110/10`.
4. Use OpenAI Docs MCP to fetch `https://developers.openai.com/codex/app-server#protocol` and confirm WebSocket transport is still experimental / unsupported and requires auth before remote exposure.
5. Use OpenAI Docs MCP to fetch `https://developers.openai.com/api/docs/guides/speech-to-text#speaker-diarization` and confirm `gpt-4o-transcribe-diarize` requires `diarized_json`, needs `chunking_strategy` for long audio, and is not supported in Realtime API.
6. Open `docs/candidate-release-review.zh-CN.md` and confirm it records formal release gate evidence, P0/P1/P2 schema drift tasks, public claims, and experimental/incomplete capabilities.
7. Open `README.md`, `.github/release-body.md`, `RELEASE.md`, and `SECURITY.md` and confirm they do not claim full latest App Server alignment, complete plugin marketplace support, stable App Server Realtime, default fs write/remove/watch, interactive terminal stream, or complete permission-profile management.
8. Run `git diff --check`.
9. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
10. Run `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- Formal release gate passes with `SchemaAudit: warn` and produces `output/app-server-schema-audit/20260705-102346`.
- Schema drift remains `drift-recorded`, not `fully-aligned`.
- Candidate release review clearly separates P0 stability protections, P1 protocol capabilities, and P2 security-sensitive capabilities.
- README, Release body, release manual, and security policy keep public marketing claims conservative.
- Governance gate fails if `docs/candidate-release-review.zh-CN.md` or its required release boundary text is removed.
- Release package smoke fails if `docs/candidate-release-review.zh-CN.md` is missing from the source zip.

#### Rollback/Cleanup Notes
- Generated output under `output/app-server-schema-audit/20260705-102346` and `output/release-package-smoke/` can be deleted after review; do not commit raw generated schema output.
- To roll back this review, remove `docs/candidate-release-review.zh-CN.md`, revert README / Release / SECURITY wording, remove governance/release package requirements for the candidate review document, and remove this test section.

#### Regression Evidence
- 2026-07-05 formal release gate: `npm.cmd run verify:release -- -RequireCleanGit -SchemaAudit warn` passed, including build, frontend normalizer smoke, server module smoke, CLI smoke, CLI CJS launcher smoke, release package smoke, NPM package smoke, and App Server schema audit warn.
- 2026-07-05 schema audit output: `output/app-server-schema-audit/20260705-102346/audit-summary.json` was generated; schema drift warnings were expected and treated as review-required evidence.
- 2026-07-05 OpenAI Docs MCP check: Codex App Server protocol page confirmed WebSocket transport remains experimental / unsupported and remote use needs WebSocket auth; Speech to text speaker diarization page confirmed `gpt-4o-transcribe-diarize`, `diarized_json`, `chunking_strategy`, and no Realtime API support for diarize.
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Using PowerShell: pwsh (7.5.5)` and `Governance docs check passed.`
- 2026-07-05 package-level release gate: `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip` passed with `frontend normalizer smoke ok`, `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`

---

### Feature: Candidate branch PR review pack

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Current repository includes `docs/candidate-release-review.zh-CN.md`, `docs/candidate-pr-review-pack.zh-CN.md`, `README.md`, `.github/release-body.md`, `RELEASE.md`, `SECURITY.md`, `scripts/verify-governance.ps1`, and `scripts/verify-release.ps1`.
- Formal release gate evidence exists from a clean worktree run of `npm.cmd run verify:release -- -RequireCleanGit -SchemaAudit warn`.

#### Steps
1. Run `git branch --show-current` and confirm the branch is `codex/candidate-release-review`.
2. Run `git rev-list --count origin/main..HEAD` and confirm the candidate branch includes the expected candidate review range.
3. Open `docs/candidate-pr-review-pack.zh-CN.md`.
4. Confirm the document includes the branch snapshot, PR title draft, PR body draft, candidate release notes draft, review checklist, schema drift P0/P1/P2 issue list, and local main merge / PR preparation notes.
5. Confirm the PR body draft records release gate evidence, schema drift counts, public claims, and do-not-claim boundaries.
6. Confirm the issue list includes separate P0 stability, P1 protocol completion, and P2 security-sensitive capability issues with acceptance checklists.
7. Confirm the remote PR preparation section includes `git push -u origin codex/candidate-release-review` and a `gh pr create --base main --head codex/candidate-release-review` template, while making clear those commands are not already executed.
8. Confirm `README.md` links `docs/candidate-pr-review-pack.zh-CN.md`.
9. Confirm `scripts/verify-governance.ps1` requires the review pack file and key review pack phrases.
10. Confirm `scripts/verify-release.ps1` requires `docs\candidate-pr-review-pack.zh-CN.md` in the release zip.
11. Run `git diff --check`.
12. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
13. Run `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- Candidate branch exists and is named with the repository default `codex/` prefix.
- Review pack is copy-paste ready for PR preparation and candidate release review.
- Remote PR preparation commands are documented but not executed unless a maintainer explicitly chooses to push/create PR.
- P0/P1/P2 schema drift follow-up work is represented as actionable issue drafts.
- README and release package smoke expose the review pack as a maintained artifact.
- Governance fails if the review pack or its key evidence/boundary text is removed.
- Release package smoke fails if the review pack is missing from the source zip.

#### Rollback/Cleanup Notes
- No runtime cleanup is required.
- To roll back, delete `docs/candidate-pr-review-pack.zh-CN.md`, remove README/governance/release package references, remove this test section, and switch back to the previous branch if needed.

#### Regression Evidence
- 2026-07-05 branch check: `git branch --show-current` returned `codex/candidate-release-review`.
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Using PowerShell: pwsh (7.5.5)` and `Governance docs check passed.`
- 2026-07-05 package-level release gate: `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip` passed with `frontend normalizer smoke ok`, `server module smoke ok`, `cli cjs launcher smoke ok`, `release package smoke ok`, `npm package smoke ok`, and `Release verification completed.`
- 2026-07-05 PR preparation update: review pack was revised to make dynamic branch counts command-derived and to document remote push / `gh pr create` commands without executing them.

---

### Feature: Local full regression checklist and execution record

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Local 7420 has been redeployed from `E:\javaword\CXCodex\codexui\dist-cli\index.js`.
- Current repository includes `docs/local-regression-checklist.zh-CN.md`, `docs/local-regression-execution-20260705.zh-CN.md`, `README.md`, `docs/changelog.zh-CN.md`, `scripts/verify-governance.ps1`, and `scripts/verify-release.ps1`.
- Browser automation and Android true-device checks are available only when explicitly scheduled for this regression pass.

#### Steps
1. Open `docs/local-regression-checklist.zh-CN.md` and confirm it covers P0 automation gates, P0 local 7420 service checks, P1 protocol/governance review, P1 browser automation, P2 manual/device checks, long soak, and failure handling rules.
2. Open `docs/local-regression-execution-20260705.zh-CN.md` and confirm it records branch, deployment path, config path, local URL, public health URL, execution status, and current risks.
3. Confirm `README.md` links both local regression documents.
4. Confirm `docs/changelog.zh-CN.md` records the new local regression checklist and execution record.
5. Run `git diff --check`.
6. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
7. Run `npm.cmd run verify:frontend-normalizers`.
8. Run `npm.cmd run verify:server-modules`.
9. Run `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip`.
10. Run `npm.cmd run test:7420 -- -SkipBrowser -PublicHealthUrl http://116.62.234.104:17420/health`.
11. Run `npm.cmd run test:7420:soak -- -DurationSeconds 60 -IntervalSeconds 15 -PublicBaseUrl http://116.62.234.104:17420`.
12. Append command results, soak report path, and any not-run browser/Android/manual scope to `docs/local-regression-execution-20260705.zh-CN.md`.

#### Expected Results
- The checklist gives a complete release-candidate regression map instead of only package-level smoke tests.
- Governance fails if the local regression documents or required key phrases are removed.
- Release package smoke fails if either local regression document is missing from the source zip.
- Non-browser 7420 regression confirms local health, App Server health, public health, and event replay endpoints.
- Short soak completes without consecutive health failures, new RPC timeouts, or pending/queued RPC threshold failures.
- If browser automation or Android checks are not run, the execution record explicitly says visual/device regression cannot be claimed complete.

#### Rollback/Cleanup Notes
- Generated output under `output/regression-7420/`, `output/soak-7420/`, and `output/release-package-smoke/` can be deleted after review.
- To roll back, remove the two local regression docs, remove README/changelog/governance/release package references, and remove this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 governance gate: `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1` passed with `Using PowerShell: pwsh (7.5.5)` and `Governance docs check passed.`
- 2026-07-05 frontend normalizer smoke: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-05 server module smoke: `npm.cmd run verify:server-modules` passed with `server module smoke ok`; the queue/slow/error log lines are expected synthetic coverage from the smoke script.
- 2026-07-05 package-level release gate: `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip` passed with CLI, CJS launcher, release package, checksum, and NPM package smoke complete.
- 2026-07-05 7420 HTTP regression: `npm.cmd run test:7420 -- -SkipBrowser -PublicHealthUrl http://116.62.234.104:17420/health` passed for local health, App Server health, event replay, and public health; browser regression was intentionally skipped.
- 2026-07-05 short soak: `npm.cmd run test:7420:soak -- -DurationSeconds 60 -IntervalSeconds 15 -PublicBaseUrl http://116.62.234.104:17420` passed with 4 healthy samples, `maxPending=0`, `maxQueued=0`, `timeouts=0`, and `slowThreadList=0`; report path is `output\soak-7420\soak-20260705-105723.json`.
- 2026-07-05 residual risk: browser automation, Android true-device checks, voice transcription, and 2-hour soak were not executed, so visual/device/long-duration regression is not claimed complete.

---

### Feature: P1 browser regression hardening and execution

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Local 7420 is running from `E:\javaword\CXCodex\codexui\dist-cli\index.js`.
- `agent-browser` is installed and `agent-browser doctor --offline --quick` reports no failures.
- Current repository includes `scripts/regression-7420.ps1`, `scripts/regression-7420-frontend.ps1`, and `docs/local-regression-execution-20260705.zh-CN.md`.

#### Steps
1. Run `agent-browser doctor --offline --quick`.
2. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420`.
3. Run `npm.cmd run test:7420 -- -PublicHealthUrl http://116.62.234.104:17420/health -ScreenshotDir output\regression-7420\p1-browser-20260705 -AgentBrowserTimeoutSec 25`.
4. Confirm `output\regression-7420\p1-browser-20260705\desktop.png`, `phone.png`, and `fold.png` exist.
5. Open `docs/local-regression-execution-20260705.zh-CN.md` and confirm it records the P1 browser pass, screenshot paths, optional thread page skip, and remaining P2 manual/device scope.
6. Run `git diff --check`.
7. Run `node scripts\run-powershell-script.mjs .\scripts\verify-governance.ps1`.
8. Run `npm.cmd run verify:release -- -AllowDirty -SkipBuild -SchemaAudit skip`.

#### Expected Results
- `test:7420` fails within `-AgentBrowserTimeoutSec` if an `agent-browser` child command hangs instead of blocking indefinitely.
- The three viewport checks reset `codex-web-local.sidebar-collapsed.v1` before measuring layout, so foldable sidebar assertions are not affected by previous collapsed sidebar state.
- Desktop 1440x900, phone 390x844, and fold 884x1104 checks pass with composer visible, no horizontal overflow, and zero page errors.
- Fold 884x1104 reports sidebar visible after reset.
- Frontend page regression passes for home, skills, GitHub trending, diagnostics, and local README preview.
- If no `-ThreadId` is passed, the thread page check is explicitly skipped as optional.

#### Rollback/Cleanup Notes
- Generated screenshots under `output\regression-7420\p1-browser-20260705\` can be deleted after review.
- To roll back, remove `-AgentBrowserTimeoutSec`, restore direct `agent-browser` invocation in `scripts/regression-7420.ps1`, remove the sidebar reset, and revert this test section plus the local execution record/changelog entries.

#### Regression Evidence
- 2026-07-05 `agent-browser doctor --offline --quick` passed with CLI version `0.26.0` and 0 failures.
- 2026-07-05 frontend page regression: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420` passed for home desktop, skills phone, GitHub trending phone, diagnostics phone, and local preview phone; thread page check was skipped because no `-ThreadId` was supplied.
- 2026-07-05 three viewport regression: `npm.cmd run test:7420 -- -PublicHealthUrl http://116.62.234.104:17420/health -ScreenshotDir output\regression-7420\p1-browser-20260705 -AgentBrowserTimeoutSec 25` passed with notification cursor recovery, desktop 1440x900, phone 390x844, fold 884x1104, no horizontal overflow, and `pageErrors=0`.
- 2026-07-05 screenshot evidence: `output\regression-7420\p1-browser-20260705\desktop.png`, `phone.png`, and `fold.png` were generated.

---

### Feature: Conversation rendering and sidebar content polish

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Local 7420 is running from `E:\javaword\CXCodex\codexui\dist-cli\index.js`.
- Current repository includes `PRODUCT.md`, `src/components/content/ThreadConversation.vue`, `src/components/sidebar/SidebarThreadTree.vue`, and `docs/changelog.zh-CN.md`.

#### Steps
1. Open a thread list with several historical sessions and confirm each row shows title, preview, relative time, and source/status chips when available.
2. Open a thread that contains Markdown fenced code blocks such as ```` ```ts ```` and confirm they render as a code panel with language and line count.
3. Open or create a thread that contains a fenced `diff` block and confirm added/deleted/meta lines have distinct treatment.
4. Open a thread containing an unhandled App Server item or raw user content fallback and confirm the raw payload is behind a structured expandable card, not only dumped into normal text flow.
5. Verify desktop, phone, and foldable viewports have no horizontal overflow in the sidebar or conversation.
6. Run `git diff --check`.
7. Run `npm.cmd run build:frontend`.
8. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420`.
9. Run `npm.cmd run test:7420 -- -PublicHealthUrl http://116.62.234.104:17420/health -ScreenshotDir output\regression-7420\conversation-rendering-20260705 -AgentBrowserTimeoutSec 25`.

#### Expected Results
- Sidebar rows remain compact but provide enough preview content to identify a session without opening it.
- Code fences are rendered as structured code panels instead of plain paragraph text.
- Diff fences make patch additions, deletions, and hunk metadata visually scannable.
- Raw payload fallback remains available for diagnostics while normal conversation reading stays clean.
- Browser regression passes with no page errors and no horizontal overflow.

#### Rollback/Cleanup Notes
- Generated screenshots under `output\regression-7420\conversation-rendering-20260705\` can be deleted after review.
- To roll back, revert `PRODUCT.md`, `ThreadConversation.vue`, `SidebarThreadTree.vue`, changelog updates, and this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 frontend build: `npm.cmd run build:frontend` passed, including `vue-tsc --noEmit` and Vite build; Vite still reports the existing large chunk warning.
- 2026-07-05 frontend page regression: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420` passed for home desktop, skills phone, GitHub trending phone, diagnostics phone, and local preview phone; thread page check was skipped because no `-ThreadId` was supplied.
- 2026-07-05 three viewport regression: `npm.cmd run test:7420 -- -PublicHealthUrl http://116.62.234.104:17420/health -ScreenshotDir output\regression-7420\conversation-rendering-20260705 -AgentBrowserTimeoutSec 25` passed with notification cursor recovery, desktop 1440x900, phone 390x844, fold 884x1104, no horizontal overflow, and `pageErrors=0`.
- 2026-07-05 screenshot evidence: `output\regression-7420\conversation-rendering-20260705\desktop.png`, `phone.png`, and `fold.png` were generated; desktop screenshot confirms sidebar rows now show title, preview, source/status chips, and relative time.
- 2026-07-05 limitation: no dedicated fixture thread with fenced code/raw payload was created in this pass, so those branches are covered by type/template build verification rather than a content-specific browser assertion.

---

### Feature: P0 desktop parity visual baseline

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- Desktop visual reference is the user-provided Codex Desktop screenshot set from 2026-07-05.

#### Steps
1. Compare the home shell against the desktop reference and confirm the app uses a neutral white/gray surface, not the previous beige card-heavy shell.
2. Inspect the left sidebar and confirm top actions, project rows, thread rows, active rows, hover rows, source/status chips, and the settings footer use the shared UI tokens.
3. Inspect a populated thread list and confirm rows are compact, stable height, readable, and still show title, preview, relative time, and status/source metadata.
4. Inspect the bottom composer and confirm it aligns to the content column, uses a light white surface, keeps attachment/runtime/mic controls visible, and uses a dark circular send button.
5. Run `git diff --check`.
6. Run `npm.cmd run build:frontend`.
7. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420`.
8. Run `npm.cmd run test:7420 -- -PublicHealthUrl http://116.62.234.104:17420/health -ScreenshotDir output\regression-7420\p0-desktop-parity-shell-20260705 -AgentBrowserTimeoutSec 25`.

#### Expected Results
- App Shell, sidebar, header, and composer share the same neutral token baseline.
- Sidebar no longer reads as stacked warm cards; active and hover states match the quieter desktop-style gray treatment.
- Composer remains usable on desktop, phone, and fold viewports without horizontal overflow.
- Browser regression generates desktop 1440x900, phone 390x844, and fold 884x1104 screenshots with `pageErrors=0`.

#### Rollback/Cleanup Notes
- Generated screenshots under `output\regression-7420\p0-desktop-parity-shell-20260705\` can be deleted after review.
- To roll back, revert the P0 token/App Shell/sidebar/composer style changes, changelog entry, and this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 frontend build: `npm.cmd run build:frontend` passed, including `vue-tsc --noEmit` and Vite build; Vite still reports the existing large chunk warning.
- 2026-07-05 frontend page regression: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420` passed for home desktop, skills phone, GitHub trending phone, diagnostics phone, and local preview phone; thread page check was skipped because no `-ThreadId` was supplied.
- 2026-07-05 three viewport regression: `npm.cmd run test:7420 -- -PublicHealthUrl http://116.62.234.104:17420/health -ScreenshotDir output\regression-7420\p0-desktop-parity-shell-20260705 -AgentBrowserTimeoutSec 25` passed with local health, App Server health, event replay, public health, notification cursor recovery, desktop 1440x900, phone 390x844, fold 884x1104, no horizontal overflow, and `pageErrors=0`.
- 2026-07-05 screenshot evidence: `output\regression-7420\p0-desktop-parity-shell-20260705\desktop.png`, `phone.png`, and `fold.png` were generated.
- 2026-07-05 visual sanity check: desktop screenshot confirms the warm card-heavy shell has been replaced by a neutral continuous sidebar, lighter header, centered content column, and desktop-style bottom composer; phone screenshot confirms no horizontal overflow, while empty composer action visibility remains a P1 state-specific follow-up.

---

### Feature: P1 conversation code and file block polish

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- Built-in regression fixture route `/#/__regression/conversation-blocks` is available for deterministic content-specific verification.

#### Steps
1. Open `http://127.0.0.1:7420/#/__regression/conversation-blocks?regression=frontend` and confirm the fixture renders a real `ThreadConversation`.
2. Confirm fenced code blocks show language, line count, and a `复制` button.
3. Click the code block `复制` button and confirm it changes to `已复制` briefly without shifting code layout.
4. Paste the clipboard contents into a scratch editor and confirm it contains only the code block body, not surrounding Markdown fences.
5. Open a thread containing a `diff` fenced block and confirm the same copy control appears while addition/deletion/meta line coloring remains intact.
6. Open a user message with file attachments and confirm attachments render as thin bordered file cards with an icon, filename/label, and truncated path.
7. In a 390x844 viewport with an empty composer, confirm the send button remains visible but disabled instead of disappearing.
8. Run `git diff --check`.
9. Run `npm.cmd run build:frontend`.
10. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420`.
11. Run `npm.cmd run test:7420 -- -PublicHealthUrl http://116.62.234.104:17420/health -ScreenshotDir output\regression-7420\p1-conversation-block-polish-20260705 -AgentBrowserTimeoutSec 25`.

#### Expected Results
- Code and diff blocks support block-level copy with visible feedback and no layout jump.
- File attachments no longer use emoji or dense chips; they read as structured workbench file cards.
- Mobile composer action layout remains stable in empty and filled states.
- Browser regression passes with no page errors and no horizontal overflow.

#### Rollback/Cleanup Notes
- Generated screenshots under `output\regression-7420\p1-conversation-block-polish-20260705\` can be deleted after review.
- To roll back, revert `ThreadConversation.vue`, `ThreadComposer.vue`, changelog entry, and this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 frontend build: `npm.cmd run build:frontend` passed, including `vue-tsc --noEmit` and Vite build; Vite still reports the existing large chunk warning.
- 2026-07-05 frontend page regression: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420` passed for home desktop, skills phone, GitHub trending phone, diagnostics phone, local preview phone, and the `conversation-blocks-fixture`; thread page check was skipped because no `-ThreadId` was supplied.
- 2026-07-05 fixture DOM assertions: the built-in conversation fixture verified at least two code/diff blocks, diff add/delete/meta line styling, code copy buttons, file cards without emoji file icons, raw payload card, fixture marker text, and no horizontal overflow.
- 2026-07-05 fixture copy interaction: `test:7420:frontend` clicked the first `.message-code-copy` button with `navigator.clipboard.writeText` stubbed, captured code block body text containing `fixture-code-block`, confirmed Markdown fence markers were not copied, and confirmed the button changed to `已复制`.
- 2026-07-05 post-fixture three viewport regression: `npm.cmd run test:7420 -- -PublicHealthUrl http://116.62.234.104:17420/health -ScreenshotDir output\regression-7420\p1-conversation-fixture-20260705 -AgentBrowserTimeoutSec 25` passed with desktop 1440x900, phone 390x844, fold 884x1104, no horizontal overflow, and `pageErrors=0`.
- 2026-07-05 post-fixture screenshot evidence: `output\regression-7420\p1-conversation-fixture-20260705\desktop.png`, `phone.png`, and `fold.png` were generated.
- 2026-07-05 three viewport regression: `npm.cmd run test:7420 -- -PublicHealthUrl http://116.62.234.104:17420/health -ScreenshotDir output\regression-7420\p1-conversation-block-polish-20260705 -AgentBrowserTimeoutSec 25` passed with local health, App Server health, event replay, public health, notification cursor recovery, desktop 1440x900, phone 390x844, fold 884x1104, no horizontal overflow, and `pageErrors=0`.
- 2026-07-05 screenshot evidence: `output\regression-7420\p1-conversation-block-polish-20260705\desktop.png`, `phone.png`, and `fold.png` were generated.
- 2026-07-05 visual sanity check: phone screenshot confirms the empty composer keeps both mic and disabled send controls visible, reducing action-area layout jump.
- 2026-07-05 remaining limitation: system clipboard read/write is not used because headless browser permission can deny it; the regression verifies the component passes the correct code body into `navigator.clipboard.writeText` and shows copied feedback.

### Feature: P2 permission workbench fixture baseline

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- Built-in regression fixture route `/#/__regression/conversation-blocks` is available.

#### Steps
1. Open `http://127.0.0.1:7420/#/__regression/conversation-blocks?regression=frontend`.
2. Confirm the top process panel shows `待处理请求` with pending items.
3. Expand the process panel if needed and confirm the MCP permission card shows service `chrome`, tool `browser_click`, and the marker text `fixture-permission-workbench`.
4. Confirm the permission card uses neutral thin borders and compact 8px-style radius instead of warm oversized card styling.
5. Confirm the action row shows `允许并继续`, `拒绝`, and `稍后处理`.
6. Run `git diff --check`.
7. Run `npm.cmd run build:frontend`.
8. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420`.

#### Expected Results
- Permission requests have a distinct structured workbench block rather than blending into generic chat Markdown or warm cards.
- The fixture regression verifies the permission panel, service/tool labels, action labels, radius ceiling, and no horizontal overflow.
- Browser regression passes with no page errors.

#### Rollback/Cleanup Notes
- No generated screenshots are required for this narrow fixture baseline.
- To roll back, revert `ConversationRegressionFixture.vue`, `ThreadConversation.vue`, `scripts/regression-7420-frontend.ps1`, changelog entry, and this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 frontend build: `npm.cmd run build:frontend` passed, including `vue-tsc --noEmit` and Vite build; Vite still reports the existing large chunk warning.
- 2026-07-05 frontend page regression: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420` passed for home desktop, skills phone, GitHub trending phone, diagnostics phone, local preview phone, and the expanded `conversation-blocks-fixture`; thread page check was skipped because no `-ThreadId` was supplied.
- 2026-07-05 fixture permission assertions: the built-in conversation fixture verified at least one pending request card, one MCP permission panel, service `chrome`, tool `browser_click`, the marker `fixture-permission-workbench`, the action labels `允许并继续` / `拒绝` / `稍后处理`, request/permission radius no larger than 10px, and no horizontal overflow.

### Feature: P3 command output fixture baseline

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- Built-in regression fixture route `/#/__regression/conversation-blocks` is available.

#### Steps
1. Open `http://127.0.0.1:7420/#/__regression/conversation-blocks?regression=frontend`.
2. Confirm the fixture includes a completed command row for `npm.cmd run test:7420:frontend -- --fixture command-output`.
3. Click the command row and confirm the command output expands below it.
4. Confirm the expanded output includes `fixture-command-output: ok`.
5. Confirm the command row uses neutral thin borders and compact control radius instead of warm oversized card styling.
6. Run `git diff --check`.
7. Run `npm.cmd run build:frontend`.
8. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420`.

#### Expected Results
- Command execution output has a distinct structured log block rather than blending into generic Markdown.
- The fixture regression verifies the command row, output wrapper, expanded output state, command marker, radius ceiling, and no horizontal overflow.
- Browser regression passes with no page errors.

#### Rollback/Cleanup Notes
- No generated screenshots are required for this narrow fixture baseline.
- To roll back, revert `ConversationRegressionFixture.vue`, `ThreadConversation.vue`, `scripts/regression-7420-frontend.ps1`, changelog entry, and this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 frontend build: `npm.cmd run build:frontend` passed, including `vue-tsc --noEmit` and Vite build; Vite still reports the existing large chunk warning.
- 2026-07-05 frontend page regression: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420` passed for home desktop, skills phone, GitHub trending phone, diagnostics phone, local preview phone, and the expanded `conversation-blocks-fixture`; thread page check was skipped because no `-ThreadId` was supplied.
- 2026-07-05 fixture command assertions: the built-in conversation fixture verified at least one command row, command output wrapper, expanded command output state, command label containing `npm.cmd run test:7420:frontend`, output marker `fixture-command-output: ok`, command row radius no larger than 10px, and no horizontal overflow.

### Feature: P3 unsupported tool call fixture baseline

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- Built-in regression fixture route `/#/__regression/conversation-blocks` is available.
- Public reference checked: `friuns2/codex-mobile` commit `fac2291`, specifically the `ThreadPendingRequestPanel.vue` `item/tool/call` branch.

#### Steps
1. Open `http://127.0.0.1:7420/#/__regression/conversation-blocks?regression=frontend`.
2. Expand the `待处理请求` panel if needed.
3. Confirm the unsupported tool call card shows service `chrome`, tool `browser_click`, and the marker text or summary for `fixture-tool-call-workbench`.
4. Confirm the card exposes the action `让 Codex 改用文字继续`.
5. Confirm the tool call card uses neutral thin borders and compact 8px-style radius instead of the dark oversized reference styling.
6. Run `git diff --check`.
7. Run `npm.cmd run build:frontend`.
8. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420`.

#### Expected Results
- Unsupported tool calls have a distinct structured workbench block rather than appearing as a single generic pending request button.
- The fixture regression verifies the tool call panel, service/tool labels, action label, radius ceiling, and no horizontal overflow.
- Browser regression passes with no page errors.

#### Rollback/Cleanup Notes
- No generated screenshots are required for this narrow fixture baseline.
- To roll back, revert `ConversationRegressionFixture.vue`, `ThreadConversation.vue`, `scripts/regression-7420-frontend.ps1`, changelog entry, and this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 frontend build: `npm.cmd run build:frontend` passed, including `vue-tsc --noEmit` and Vite build; Vite still reports the existing large chunk warning.
- 2026-07-05 frontend page regression: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420` passed for home desktop, skills phone, GitHub trending phone, diagnostics phone, local preview phone, and the expanded `conversation-blocks-fixture`; thread page check was skipped because no `-ThreadId` was supplied.
- 2026-07-05 fixture tool call assertions: the built-in conversation fixture verified at least one unsupported tool call panel, service `chrome`, tool `browser_click`, tool call marker/summary, the action label `让 Codex 改用文字继续`, tool panel radius no larger than 10px, and no horizontal overflow.

### Feature: P4 foldable viewport regression baseline

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- Built-in regression fixture routes `/#/__regression/composer-shell` and `/#/__regression/conversation-blocks` are available.

#### Steps
1. Open `http://127.0.0.1:7420/#/` at 884x1104.
2. Confirm the sidebar is expanded with the default width and does not take over the content area.
3. Confirm the main content grid and Composer remain readable and do not overflow horizontally.
4. Open `http://127.0.0.1:7420/#/__regression/composer-shell?regression=frontend` at 884x1104 and confirm the Composer controls fit without overlap.
5. Open `http://127.0.0.1:7420/#/__regression/conversation-blocks?regression=frontend` at 884x1104 and confirm structured conversation blocks fit without horizontal scrolling.
6. Run `git diff --check`.
7. Run `npm.cmd run build:frontend`.
8. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420`.

#### Expected Results
- `test:7420:frontend` resets sidebar collapsed/width layout preferences before the foldable home check.
- Foldable home shell includes desktop layout, sidebar, main content, content grid, and Composer.
- Sidebar width stays between 260px and 370px and uses no more than 42% of the 884px viewport.
- Main content, content grid, Composer, composer fixture controls, and conversation fixture blocks fit inside the 884x1104 viewport.
- Browser regression result table includes `home-foldable`, `composer-shell-fixture-foldable`, and `conversation-blocks-fixture-foldable`.

#### Rollback/Cleanup Notes
- No generated screenshots are required for this DOM-based foldable baseline.
- To roll back, revert `scripts/regression-7420-frontend.ps1`, changelog entry, and this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check -- scripts/regression-7420-frontend.ps1` passed.
- 2026-07-05 frontend build: `npm.cmd run build:frontend` passed, including `vue-tsc --noEmit` and Vite build; Vite still reports the existing large chunk warning.
- 2026-07-05 frontend page regression: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420` passed and included `home-foldable`, `composer-shell-fixture-foldable`, and `conversation-blocks-fixture-foldable`; thread page check was skipped because no `-ThreadId` was supplied.
- 2026-07-05 foldable assertions: the built-in regression verified 884x1104 shell/sidebar/main/content-grid/Composer presence, sidebar width and ratio ceilings, minimum main/content/Composer widths, fixture fit checks, and no page-level horizontal overflow.

### Feature: P4 conversation chrome neutralization baseline

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- Built-in regression fixture route `/#/__regression/conversation-blocks` is available.
- Public reference checked: `friuns2/codex-mobile` commit `fac2291`; use it for compact runtime/queue structure and desktop-app positioning only, not for copying its whole theme.

#### Steps
1. Open `http://127.0.0.1:7420/#/__regression/conversation-blocks?regression=frontend` at a desktop viewport such as 1440x900.
2. Confirm the fixture includes a runtime status bar above the conversation, visible conversation blocks, pending request panels, and a queued message panel below the conversation.
3. Confirm runtime, queued rows, message cards, table wrappers, raw payload cards, long-text containers, guided-turn toggles, and file context menus use neutral white/gray token surfaces rather than warm beige/paper backgrounds.
4. Reopen the same fixture at a phone viewport such as 393x852.
5. Confirm the added runtime and queued-message samples do not introduce horizontal scrolling or oversized rounded cards.
6. Run `git diff --check`.
7. Run `npm.cmd run build:frontend`.
8. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420`.

#### Expected Results
- Runtime status, queued messages, message cards, tables, raw payload cards, long-text controls, and message action chrome use the shared `--ui-*` neutral token vocabulary.
- `conversation-blocks` fixture contains at least one runtime status bar, one queued message panel, and two queued rows.
- Sampled conversation chrome backgrounds do not match the blocked warm values such as `#fffdf8`, `#fffaf3`, `#fffaf2`, `#fff8df`, `#f7f1e5`, `#f8f4ec`, or `#f1ebde`.
- Sampled conversation chrome radius stays within the desktop parity ceiling and the page has no horizontal overflow on desktop or phone.
- Browser regression passes with no page errors.

#### Rollback/Cleanup Notes
- No generated screenshots are required for this narrow visual baseline.
- To roll back, revert `src/style.css`, `RuntimeStatusBar.vue`, `QueuedMessages.vue`, `ThreadConversation.vue`, `ConversationRegressionFixture.vue`, `scripts/regression-7420-frontend.ps1`, changelog entry, and this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check -- src/components/content/ConversationRegressionFixture.vue src/components/content/RuntimeStatusBar.vue src/components/content/QueuedMessages.vue src/components/content/ThreadConversation.vue scripts/regression-7420-frontend.ps1 src/style.css` passed.
- 2026-07-05 frontend build: `npm.cmd run build:frontend` passed, including `vue-tsc --noEmit` and Vite build; Vite still reports the existing large chunk warning.
- 2026-07-05 frontend page regression: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420` passed for home desktop, skills phone, GitHub trending phone, diagnostics phone, local preview phone, `sidebar-rows-fixture-phone`, desktop and phone `composer-shell-fixture`, desktop `conversation-blocks-fixture`, and phone `conversation-blocks-fixture-phone`; thread page check was skipped because no `-ThreadId` was supplied.
- 2026-07-05 fixture conversation chrome assertions: the built-in conversation fixture verified runtime status bar, queued message panel, queued rows, zero sampled warm chrome backgrounds, chrome radius no larger than 18px, structured blocks fitting inside the viewport, and no page-level horizontal overflow.

### Feature: P4 conversation blocks mobile fit baseline

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- Built-in regression fixture route `/#/__regression/conversation-blocks` is available.
- Public reference checked: `friuns2/codex-mobile` commit `fac2291`; use it for pending-request component boundaries and mobile drawer/sheet structure only, not for its dark large-radius visual theme.

#### Steps
1. Open `http://127.0.0.1:7420/#/__regression/conversation-blocks?regression=frontend` at a phone-sized viewport such as 393x852.
2. Expand the `待处理请求` panel if needed.
3. Expand the command row and confirm the command output remains inside the viewport.
4. Confirm file cards, code blocks, raw payload cards, MCP permission cards, unsupported tool call cards, and request buttons fit the phone viewport without horizontal scrolling.
5. Confirm narrow-screen request actions become easy-to-tap single-column buttons and compact workbench panels, while retaining the neutral desktop-style thin borders and small radius.
6. Run `git diff --check`.
7. Run `npm.cmd run build:frontend`.
8. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420`.

#### Expected Results
- Phone-width conversation blocks remain readable and do not require page-level horizontal scrolling.
- `test:7420:frontend` opens the `conversation-blocks` fixture on both desktop and phone viewports.
- The fixture regression checks that request cards, permission/tool panels, file cards, code blocks, raw payload cards, command rows, and command output wrappers fit within the viewport.
- Browser regression passes with no page errors.

#### Rollback/Cleanup Notes
- No generated screenshots are required for this narrow fixture baseline.
- To roll back, revert `ThreadConversation.vue`, `scripts/regression-7420-frontend.ps1`, changelog entry, and this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 frontend build: `npm.cmd run build:frontend` passed, including `vue-tsc --noEmit` and Vite build; Vite still reports the existing large chunk warning.
- 2026-07-05 frontend page regression: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420` passed for home desktop, skills phone, GitHub trending phone, diagnostics phone, local preview phone, desktop `conversation-blocks-fixture`, and phone `conversation-blocks-fixture-phone`; thread page check was skipped because no `-ThreadId` was supplied.
- 2026-07-05 fixture mobile fit assertions: the built-in conversation fixture verified request cards, permission/tool panels, file cards, code blocks, raw payload cards, command rows, and command output wrappers fit inside the 393x852 viewport with no page-level horizontal overflow.

### Feature: P4 sidebar row scannability baseline

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- Built-in regression fixture route `/#/__regression/sidebar-rows` is available.

#### Steps
1. Open `http://127.0.0.1:7420/#/__regression/sidebar-rows?regression=frontend` at a phone-sized viewport such as 393x852.
2. Confirm the fixture includes running, unread, idle, and multi-project thread rows.
3. Confirm each row reads as a continuous sidebar list row: title first, preview second, time/status weakly on the side.
4. Confirm source/status metadata appears as lightweight inline text rather than rounded pill chips.
5. Confirm running status uses a small stable indicator, not a spinning loader in the row.
6. Open thread/project menus manually and confirm they use neutral white/gray token styling, not warm beige panels.
7. Run `git diff --check`.
8. Run `npm.cmd run build:frontend`.
9. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420`.

#### Expected Results
- Sidebar rows remain compact and scannable with stable row height between 40px and 52px.
- Source/status metadata does not render as chips with pill backgrounds or borders.
- Row radius stays within the desktop parity row token ceiling.
- The fixture has no page-level horizontal overflow.
- Browser regression passes with no page errors.

#### Rollback/Cleanup Notes
- No generated screenshots are required for this narrow fixture baseline.
- To roll back, revert `SidebarThreadTree.vue`, `SidebarRegressionFixture.vue`, `router/index.ts`, `scripts/regression-7420-frontend.ps1`, changelog entry, and this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 frontend build: `npm.cmd run build:frontend` passed, including `vue-tsc --noEmit` and Vite build; Vite still reports the existing large chunk warning.
- 2026-07-05 frontend page regression: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420` passed for home desktop, skills phone, GitHub trending phone, diagnostics phone, local preview phone, `sidebar-rows-fixture-phone`, desktop `conversation-blocks-fixture`, and phone `conversation-blocks-fixture-phone`; thread page check was skipped because no `-ThreadId` was supplied.
- 2026-07-05 fixture sidebar assertions: the built-in sidebar fixture verified at least four thread rows, source/status metadata, unread/running indicators, row height between 40px and 52px, row radius no larger than 10px, source/status metadata without pill backgrounds/borders/padding, no spinner animation for the running indicator, rows fitting inside the 393x852 viewport, and no page-level horizontal overflow.

### Feature: P4 composer shell visual weight baseline

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- Built-in regression fixture route `/#/__regression/composer-shell` is available.
- Public reference checked: `friuns2/codex-mobile` commit `fac2291`; use it for Composer structure and control grouping only, not for its theme.

#### Steps
1. Open `http://127.0.0.1:7420/#/__regression/composer-shell?regression=frontend` at a desktop viewport such as 1440x900.
2. Confirm the Composer reads as a lightweight bottom workbench control, with a thin neutral border, white surface, and reduced shadow.
3. Confirm the textarea, attachment button, runtime trigger, dictation button, and submit button are visible and aligned without layout jumps.
4. Reopen the same route at a phone viewport such as 393x852.
5. Confirm the Composer fits the viewport with no horizontal scrolling and the runtime trigger remains readable.
6. Run `git diff --check`.
7. Run `npm.cmd run build:frontend`.
8. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420`.

#### Expected Results
- Composer shell height stays within the compact visual baseline and does not become a dominant card.
- Composer radius stays no larger than the desktop parity composer token.
- The shell background is neutral white/gray, not warm beige.
- Attachment, runtime, dictation, and submit controls remain visible on desktop and phone.
- Browser regression passes with no page-level horizontal overflow.

#### Rollback/Cleanup Notes
- No generated screenshots are required for this narrow fixture baseline.
- To roll back, revert `ThreadComposer.vue`, `ComposerRegressionFixture.vue`, `router/index.ts`, `App.vue`, `scripts/regression-7420-frontend.ps1`, changelog entry, and this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 frontend build: `npm.cmd run build:frontend` passed, including `vue-tsc --noEmit` and Vite build; Vite still reports the existing large chunk warning.
- 2026-07-05 frontend page regression: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420` passed for home desktop, skills phone, GitHub trending phone, diagnostics phone, local preview phone, `sidebar-rows-fixture-phone`, desktop and phone `composer-shell-fixture`, desktop `conversation-blocks-fixture`, and phone `conversation-blocks-fixture-phone`; thread page check was skipped because no `-ThreadId` was supplied.
- 2026-07-05 fixture composer assertions: the built-in Composer fixture verified form/shell/input/attachment/runtime/dictation/submit controls, shell height between 88px and 132px, shell radius no larger than 22px, thin border, non-warm shell background, minimum control sizes, runtime trigger width, all target controls fitting inside the viewport, and no page-level horizontal overflow.

### Feature: P4 App Shell settings surface neutralization

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- The sidebar is visible on the desktop home route.

#### Steps
1. Open `http://127.0.0.1:7420/#/` at a desktop viewport such as 1440x900.
2. Click the sidebar `设置` button.
3. Confirm the settings panel uses a neutral white/gray surface, thin border, restrained shadow, and desktop-parity radius.
4. Confirm the about/version block no longer appears as a blue gradient card and uses the same neutral component vocabulary as the rest of the sidebar.
5. Confirm settings input, code, value, copy, secondary action, toast, mobile setup card, and confirmation dialog styles are token-driven rather than warm beige/paper colors.
6. Run `git diff --check`.
7. Run `npm.cmd run build:frontend`.
8. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420`.

#### Expected Results
- Settings panel radius stays no larger than the Composer/system floating token.
- The about/brand block radius stays within the compact card token.
- Sampled settings panel backgrounds do not use warm beige values such as `#fffdf8`, `#fffaf3`, `#f7f3ea`, `#f1ebde`, or `#fbf8f2`.
- The opened settings panel fits the desktop viewport without horizontal overflow.
- Browser regression passes with no page errors.

#### Rollback/Cleanup Notes
- No generated screenshots are required for this narrow App Shell baseline.
- To roll back, revert `App.vue`, `scripts/regression-7420-frontend.ps1`, changelog entry, and this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 frontend build: `npm.cmd run build:frontend` passed, including `vue-tsc --noEmit` and Vite build; Vite still reports the existing large chunk warning.
- 2026-07-05 frontend page regression: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420` passed for home desktop with opened settings panel assertions, skills phone, GitHub trending phone, diagnostics phone, local preview phone, `sidebar-rows-fixture-phone`, desktop and phone `composer-shell-fixture`, desktop `conversation-blocks-fixture`, and phone `conversation-blocks-fixture-phone`; thread page check was skipped because no `-ThreadId` was supplied.
- 2026-07-05 fixture settings assertions: the home route opened the sidebar settings panel and verified panel/brand block presence, panel radius no larger than 22px, thin border, brand block radius no larger than 8px, zero sampled warm beige backgrounds, sampled control radius no larger than 22px, panel fitting inside the viewport, and no page-level horizontal overflow.

### Feature: P4 compact app chrome layout

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- The sidebar is visible on the desktop home route.
- A real thread route can be opened for manual title/status inspection.

#### Steps
1. Open a thread page at a desktop viewport such as 1440x900.
2. Confirm the thread title, cwd/context badge, runtime status, favorites, and recovery action share the top title/meta area.
3. Confirm there is no second full-width runtime status strip between the header and conversation body.
4. Confirm the header runtime status hides low-frequency phase, seq, and turn fields during normal synced/running states, while still exposing force recovery and stop when applicable.
5. Confirm the conversation body does not duplicate simple thinking/writing/switching status cards when the header already shows the runtime state; detailed command output, permission requests, errors, and reasoning details may still render in the body.
6. Open `http://127.0.0.1:7420/#/` at 884x1104 and confirm the left sidebar top actions use one compact two-column `新会话 / 搜索` row.
7. Confirm 工作台、技能中心、GitHub 热门, and 运行诊断 remain visible but use compact continuous navigation rows.
8. Click `设置`, confirm the panel opens with a visible close button in its title bar, then close it from that button.
9. Confirm generic explanation text in settings is not visually competing with settings rows, while status feedback still appears when present.
10. Run `git diff --check`.
11. Run `npm.cmd run build:frontend`.
12. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -CaptureScreenshots -ScreenshotTaskName compact-app-chrome-layout`.

#### Expected Results
- Thread status uses the existing title/header space instead of adding another row above the conversation.
- Simple runtime progress is not duplicated in the conversation body when header runtime chrome is active.
- Sidebar primary actions consume one compact row instead of two full navigation rows.
- Settings panel can be closed from its own title bar on both desktop and mobile sheet layouts.
- Browser regression passes with no page-level horizontal overflow.

#### Rollback/Cleanup Notes
- Screenshot artifacts are saved under `output/regression-7420/compact-app-chrome-layout/` when `-CaptureScreenshots` is used.
- To roll back, revert `App.vue`, `RuntimeStatusBar.vue`, `scripts/regression-7420-frontend.ps1`, changelog entry, and this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 frontend build: `npm.cmd run build:frontend` passed, including `vue-tsc --noEmit` and Vite build; Vite still reports the existing large chunk warning.
- 2026-07-05 local service recovery: `scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json` restarted 7420 as PID 48492 after `/codex-api/health` timed out during one retry run; `/codex-api/health` then returned `status: ok`.
- 2026-07-05 frontend page regression: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -CaptureScreenshots -ScreenshotTaskName compact-app-chrome-layout` passed for home desktop/foldable, skills phone, GitHub trending phone, diagnostics phone, local preview phone, `sidebar-rows-fixture-phone`, desktop/phone/foldable `composer-shell-fixture`, and desktop/phone/foldable `conversation-blocks-fixture`; thread page check was skipped because no `-ThreadId` was supplied.
- 2026-07-05 manual thread DOM check: opened `http://127.0.0.1:7420/#/thread/019ea7cc-2558-7de2-a094-778c9268f3bc`; header runtime bars = 1, runtime bars outside header = 0, legacy header status strips = 0, body inline overlays/loading/process panels = 0.
- 2026-07-05 screenshot artifacts: saved under `output/regression-7420/compact-app-chrome-layout/`, including `home-desktop.png`, `home-foldable.png`, and `thread-header-manual.png`.

### Feature: P4 hide low-value App Server fileChange noise

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- Built-in regression fixture route `/#/__regression/conversation-blocks` is available.

#### Steps
1. Open `http://127.0.0.1:7420/#/__regression/conversation-blocks?regression=frontend` at a desktop viewport such as 1440x900.
2. Confirm the fixture still shows the meaningful raw payload card with marker `fixture-raw-payload`.
3. Confirm low-value system file-change noise is absent: `fixture-hidden-file-change-noise`, `Unhandled App Server item: fileChange`, and `unhandled.fileChange` should not appear in the visible page text.
4. Run `git diff --check`.
5. Run `npm.cmd run build:frontend`.
6. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -CaptureScreenshots -ScreenshotTaskName hide-filechange-system-noise`.

#### Expected Results
- `unhandled.fileChange` system messages do not render in the normal conversation flow.
- Other unhandled/raw payload content remains available as a folded diagnostic card.
- Browser regression passes with no page-level horizontal overflow.

#### Rollback/Cleanup Notes
- Screenshot artifacts are saved under `output/regression-7420/hide-filechange-system-noise/` when `-CaptureScreenshots` is used.
- To roll back, revert `ThreadConversation.vue`, `ConversationRegressionFixture.vue`, `scripts/regression-7420-frontend.ps1`, changelog entry, and this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 frontend build: `npm.cmd run build:frontend` passed, including `vue-tsc --noEmit` and Vite build; Vite still reports the existing large chunk warning.
- 2026-07-05 frontend page regression: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -CaptureScreenshots -ScreenshotTaskName hide-filechange-system-noise` passed for home desktop/foldable, skills phone, GitHub trending phone, diagnostics phone, local preview phone, `sidebar-rows-fixture-phone`, desktop/phone/foldable `composer-shell-fixture`, and desktop/phone/foldable `conversation-blocks-fixture`; thread page check was skipped because no `-ThreadId` was supplied.
- 2026-07-05 fixture noise assertion: `conversation-blocks` includes a synthetic `unhandled.fileChange` message with marker `fixture-hidden-file-change-noise`, and the regression asserts that marker, `Unhandled App Server item: fileChange`, and `unhandled.fileChange` are absent from visible page text while `fixture-raw-payload` still renders.

### Feature: P4 sidebar desktop list ordering parity

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- Built-in regression fixture route `/#/__regression/sidebar-rows` is available.

#### Steps
1. Open `http://127.0.0.1:7420/#/__regression/sidebar-rows?regression=frontend` at a phone-sized viewport such as 393x852.
2. Confirm the first project group follows the fixture input/app-server order instead of being re-sorted by sidebar display code.
3. Confirm the running thread appears in the `正在运行` shortcut section and also remains exactly once inside its owning project list.
4. Confirm the pinned thread appears in the `置顶` shortcut section and also remains exactly once inside its owning project list.
5. Confirm project thread rows keep the upstream thread order within each project.
6. Run `git diff --check`.
7. Run `npm.cmd run build:frontend`.
8. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -CaptureScreenshots -ScreenshotTaskName sidebar-desktop-list-parity`.

#### Expected Results
- Sidebar project groups preserve the normalized App Server / workspace order passed into the component.
- Pinned and running shortcut sections do not remove those threads from project browsing.
- Project view remains the forced desktop-parity view when `desktop-list-parity` is enabled.
- Browser regression passes with no page-level horizontal overflow.

#### Rollback/Cleanup Notes
- Screenshot artifacts are saved under `output/regression-7420/sidebar-desktop-list-parity/` when `-CaptureScreenshots` is used.
- To roll back, revert `SidebarThreadTree.vue`, `SidebarRegressionFixture.vue`, `scripts/regression-7420-frontend.ps1`, changelog entry, and this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 frontend build: `npm.cmd run build:frontend` passed, including `vue-tsc --noEmit` and Vite build; Vite still reports the existing large chunk warning.
- 2026-07-05 frontend page regression: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -CaptureScreenshots -ScreenshotTaskName sidebar-desktop-list-parity` passed for home desktop/foldable, skills phone, GitHub trending phone, diagnostics phone, local preview phone, `sidebar-rows-fixture-phone`, desktop/phone/foldable `composer-shell-fixture`, and desktop/phone/foldable `conversation-blocks-fixture`; thread page check was skipped because no `-ThreadId` was supplied.
- 2026-07-05 fixture sidebar ordering assertions: `sidebar-rows` verified the first project group remains `E:/javaword/CXCodex/codexui`, the running thread appears in both the running shortcut and exactly once in its owning project list, and the pinned thread appears in both the pinned shortcut and exactly once in its owning project list.
- 2026-07-05 screenshot artifact: `output/regression-7420/sidebar-desktop-list-parity/sidebar-rows-fixture-phone.png` shows the shortcut sections and project list coexisting without sidebar horizontal overflow.

### Feature: P4 compact mobile sidebar action grid and project thread limit

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- Built-in regression fixture route `/#/__regression/sidebar-rows` is available.

#### Steps
1. Open `http://127.0.0.1:7420/#/` at a foldable/narrow tablet viewport such as 884x1104.
2. Confirm the sidebar top actions render as a compact grid with icon and short label for 新会话, 搜索, 工作台, 技能, GitHub, and 诊断 when GitHub 热门 is enabled.
3. Confirm the action grid uses no more than two rows and each action remains large enough for touch operation.
4. Open `http://127.0.0.1:7420/#/__regression/sidebar-rows?regression=frontend` at 393x852.
5. Confirm the first expanded project shows exactly 5 thread rows by default.
6. Confirm long project lists show `显示更多 N 条`; clicking it expands the rest, and clicking `收起` returns to the 5-row preview.
7. Run `git diff --check`.
8. Run `npm.cmd run build:frontend`.
9. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -CaptureScreenshots -ScreenshotTaskName compact-sidebar-action-grid`.

#### Expected Results
- Sidebar top actions consume less vertical space than the previous primary-action plus command-list layout.
- Action buttons retain visible text labels and meet mobile touch-size expectations.
- Project thread preview defaults to 5 rows in desktop-parity mode and normal project mode.
- The show-more control displays the remaining count and does not create horizontal overflow.
- Browser regression passes with no page-level horizontal overflow.

#### Rollback/Cleanup Notes
- Screenshot artifacts are saved under `output/regression-7420/compact-sidebar-action-grid/` when `-CaptureScreenshots` is used.
- To roll back, revert `App.vue`, `SidebarThreadTree.vue`, `SidebarRegressionFixture.vue`, `scripts/regression-7420-frontend.ps1`, changelog entry, and this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 frontend build: `npm.cmd run build:frontend` passed, including `vue-tsc --noEmit` and Vite build; Vite still reports the existing large chunk warning.
- 2026-07-05 frontend page regression: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -CaptureScreenshots -ScreenshotTaskName compact-sidebar-action-grid` passed for home desktop/foldable, skills phone, GitHub trending phone, diagnostics phone, local preview phone, `sidebar-rows-fixture-phone`, desktop/phone/foldable `composer-shell-fixture`, and desktop/phone/foldable `conversation-blocks-fixture`; thread page check was skipped because no `-ThreadId` was supplied.
- 2026-07-05 foldable sidebar action assertions: home foldable verified the compact sidebar action grid exists, uses CSS grid, renders in no more than two rows, stays no taller than 96px, has at least five labeled icon actions, keeps tile radius no larger than 10px, and keeps tile height at least 42px for touch.
- 2026-07-05 sidebar project limit assertions: `sidebar-rows` verified the first expanded project renders exactly 5 thread rows by default and shows `显示更多 3 条` for the remaining project sessions.
- 2026-07-05 screenshot artifacts: `output/regression-7420/compact-sidebar-action-grid/home-foldable.png` and `output/regression-7420/compact-sidebar-action-grid/sidebar-rows-fixture-phone.png`.

### Feature: P0 mobile drawer thread list recovery

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- App Server `thread/list` is expected to respond through `/codex-api/rpc`.

#### Steps
1. Open `http://127.0.0.1:7420/#/` at 393x852.
2. Tap the leading sidebar button in the header.
3. Confirm the mobile drawer opens and shows the compact action grid.
4. Confirm the drawer renders pinned/project thread rows and at least one project group instead of staying on loading skeletons.
5. Confirm the drawer has no horizontal overflow.
6. Run `git diff --check`.
7. Run `npm.cmd run build:frontend`.
8. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -CaptureScreenshots -ScreenshotTaskName mobile-drawer-thread-list-recovery`.

#### Expected Results
- `thread/list` failures do not leave the mobile drawer in an indefinite skeleton state.
- If no groups are available after loading, the sidebar shows a visible empty/retry hint instead of blank space.
- The automated 7420 regression opens the phone home drawer and asserts thread rows and project groups are present.

#### Rollback/Cleanup Notes
- Screenshot artifacts are saved under `output/regression-7420/mobile-drawer-thread-list-recovery/` when `-CaptureScreenshots` is used.
- To roll back, revert `codexRpcClient.ts`, `SidebarThreadTree.vue`, `scripts/regression-7420-frontend.ps1`, changelog entry, and this test section.

#### Regression Evidence
- 2026-07-05 root-cause evidence: before restart, `/health` returned ok but `/codex-api/health`, `/codex-api/diagnostics`, and direct `/codex-api/rpc` `thread/list` timed out; mobile drawer stayed on `thread-tree-loading` with zero `.thread-row` and zero `.project-group`.
- 2026-07-05 local service recovery: `scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json` restarted 7420 as PID 41572; direct `thread/list` then returned 20 rows and `/codex-api/health` returned `status: ok`.
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 frontend build: `npm.cmd run build:frontend` passed, including `vue-tsc --noEmit` and Vite build; Vite still reports the existing large chunk warning.
- 2026-07-05 frontend page regression: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -CaptureScreenshots -ScreenshotTaskName mobile-drawer-thread-list-recovery` passed for home desktop/foldable/mobile drawer, skills phone, GitHub trending phone, diagnostics phone, local preview phone, `sidebar-rows-fixture-phone`, desktop/phone/foldable `composer-shell-fixture`, and desktop/phone/foldable `conversation-blocks-fixture`; thread page check was skipped because no `-ThreadId` was supplied.
- 2026-07-05 mobile drawer assertions: the phone home route opened the drawer and verified compact action grid, non-loading state, rendered thread rows, rendered project groups, no empty/error text when threads are available, drawer width within viewport, and no horizontal overflow.
- 2026-07-05 screenshot artifact: `output/regression-7420/mobile-drawer-thread-list-recovery/home-mobile-drawer.png`.

### Feature: P0 7420 App Server sync recovery

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- Official Codex Desktop may be open, but this test focuses on the 7420 bridge staying responsive when App Server list/diagnostic RPCs stall.

#### Steps
1. Call `http://127.0.0.1:7420/health` and confirm the Node web service is alive.
2. Call `http://127.0.0.1:7420/codex-api/health` and confirm it returns quickly even if hook or Windows sandbox diagnostics are unavailable.
3. POST `/codex-api/rpc` with `{"jsonrpc":"2.0","id":1,"method":"thread/list","params":{"limit":5}}`.
4. If `thread/list` is slow or stuck, confirm the server-side timeout is 15 seconds instead of 60 seconds and repeated list timeouts are eligible for App Server restart.
5. Refresh the 7420 page and confirm the sidebar can recover after the App Server responds or restarts.
6. Run `git diff --check`.
7. Run `npm.cmd run verify:server-modules`.
8. Run `npm.cmd run build`.
9. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -CaptureScreenshots -ScreenshotTaskName app-server-sync-recovery`.

#### Expected Results
- `/codex-api/health` is no longer blocked indefinitely by App Server-backed diagnostic reads.
- `thread/list` failures settle fast enough for the frontend to show recovery state instead of stale loading.
- Two restartable RPC timeouts inside the restart window trigger App Server recovery instead of waiting for a third 60-second timeout.
- 7420 sidebar and project/thread list recover without requiring a full machine restart.

#### Rollback/Cleanup Notes
- Screenshot artifacts are saved under `output/regression-7420/app-server-sync-recovery/` when `-CaptureScreenshots` is used.
- To roll back, revert `appServerRpcTimeoutPolicy.ts`, `appServerRpcTimeoutRecovery.ts`, `appServerProcess.ts`, `diagnosticsRoutes.ts`, `server-module-smoke.ts`, and this test section.

#### Regression Evidence
- 2026-07-05 root-cause evidence: before the fix, `/health` returned ok while `/codex-api/health`, `/codex-api/diagnostics`, and `/codex-api/rpc` `thread/list` timed out, so the Node web process was alive but App Server-backed sync was blocked.
- 2026-07-05 server module verification: `npm.cmd run verify:server-modules` passed, including `thread/list` 15-second timeout policy, no startup-grace suppression for `thread/list`, and fast health timeout fallback for hook/sandbox diagnostics.
- 2026-07-05 build verification: `npm.cmd run build` passed for frontend and CLI; Vite still reports the existing large chunk warning.
- 2026-07-05 local service recovery: `scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json` restarted 7420 as PID 26612 with version 2.2.7.
- 2026-07-05 post-restart smoke: `/codex-api/health` returned 200 in 363ms and `thread/list` with `limit=5` returned 200 in 879ms.
- 2026-07-05 frontend page regression: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -CaptureScreenshots -ScreenshotTaskName app-server-sync-recovery` passed for home desktop/foldable/mobile drawer, skills phone, GitHub trending phone, diagnostics phone, local preview phone, `sidebar-rows-fixture-phone`, desktop/phone/foldable `composer-shell-fixture`, and desktop/phone/foldable `conversation-blocks-fixture`; thread page check was skipped because no `-ThreadId` was supplied.

### Feature: P0 Codex Desktop workspace root project parity

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- `C:\Users\SW\.codex\.codex-global-state.json` contains Codex Desktop workspace roots, including at least one root that has no current `thread/list` session.

#### Steps
1. Call `http://127.0.0.1:7420/codex-api/workspace-roots-state` and confirm the response includes desktop roots such as `E:\javaword\CXCodex\codexui`.
2. POST `/codex-api/rpc` with `{"jsonrpc":"2.0","id":1,"method":"thread/list","params":{"limit":200}}` and confirm the missing project can be absent from App Server thread rows.
3. Open `http://127.0.0.1:7420/#/` and inspect the sidebar project list.
4. Confirm desktop workspace roots are displayed in desktop order even when a root has no sessions.
5. Click the new-thread action on an empty workspace-root project and confirm the home composer selects that root as the local project folder.
6. Run `git diff --check`.
7. Run `npm.cmd run build:frontend`.
8. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -CaptureScreenshots -ScreenshotTaskName workspace-root-project-parity`.

#### Expected Results
- 7420 project groups merge Codex Desktop workspace roots with App Server `thread/list` groups instead of filtering to thread-backed projects only.
- Empty workspace-root projects render a `暂无会话` state and keep a visible project-level new-thread action.
- Existing thread-backed project ordering, labels, pinned threads, and 5-row project preview behavior remain unchanged.

#### Rollback/Cleanup Notes
- Screenshot artifacts are saved under `output/regression-7420/workspace-root-project-parity/` when `-CaptureScreenshots` is used.
- To roll back, revert `src/composables/useDesktopState.ts`, `src/types/codex.ts`, `src/App.vue`, `src/components/sidebar/SidebarRegressionFixture.vue`, `scripts/regression-7420-frontend.ps1`, and this test section.

#### Regression Evidence
- 2026-07-05 root-cause evidence: `/codex-api/workspace-roots-state` returned desktop roots including `E:\javaword\CXCodex\codexui`, while `/codex-api/rpc` `thread/list` with `limit=200` returned no current thread whose `cwd` contained `codexui`.
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 frontend build: `npm.cmd run build:frontend` passed, including `vue-tsc --noEmit` and Vite build; Vite still reports the existing large chunk warning.
- 2026-07-05 frontend page regression: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -CaptureScreenshots -ScreenshotTaskName workspace-root-project-parity` passed for home desktop/foldable/mobile drawer, skills phone, GitHub trending phone, diagnostics phone, local preview phone, `sidebar-rows-fixture-phone`, desktop/phone/foldable `composer-shell-fixture`, and desktop/phone/foldable `conversation-blocks-fixture`; thread page check was skipped because no `-ThreadId` was supplied.
- 2026-07-05 sidebar fixture assertions: `sidebar-rows` verified an empty workspace-root project is retained, renders `暂无会话`, keeps exactly one project-level new-thread action, preserves first project order, and still limits the first expanded project to 5 visible threads with `显示更多 3 条`.
- 2026-07-05 screenshot artifact: `output/regression-7420/workspace-root-project-parity/sidebar-rows-fixture-phone.png`.

### Feature: P0 real workspace root project sync acceptance

#### Prerequisites
- Current branch is `codex/candidate-release-review`.
- Local 7420 is running from `E:\javaword\CXCodex\codexui`.
- `C:\Users\SW\.codex\.codex-global-state.json` is the Codex Desktop workspace roots source for this Windows machine.

#### Steps
1. Call `GET http://127.0.0.1:7420/codex-api/workspace-roots-state`.
2. Confirm the first workspace roots include `C:\Users\SW\Documents\Playground`, `E:\javaword\CXCodex\codexui`, and `E:\javaword\ZXSAAS\mini`.
3. Call `thread/list` through `/codex-api/rpc` and confirm App Server thread rows may still omit `E:\javaword\CXCodex\codexui`.
4. Open `http://127.0.0.1:7420/#/` in an automated browser and read `.project-group` DOM rows.
5. Confirm the first project names are `Playground`, `codexui`, and `mini`, with `mini` displayed as `ZXSAAS-mini`.
6. Confirm `codexui` and `ZXSAAS-mini` render `0个会话`, `暂无会话`, and one project-level new-thread button.
7. Click the `codexui` project new-thread action and confirm the composer folder dropdown selects `codexui`.
8. Refresh the page and confirm the same project order and empty project states remain.
9. Restart local 7420 with `scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
10. Confirm `/health`, `/codex-api/health`, and the automated browser DOM check still pass after restart.
11. Run `git diff --check`.
12. Run `npm.cmd run build:frontend`.
13. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -CaptureScreenshots -ScreenshotTaskName p0-real-workspace-root-sync`.

#### Expected Results
- 7420 real sidebar follows Codex Desktop workspace root ordering for roots that have no current App Server sessions.
- Empty projects do not disappear after refresh or service restart.
- Empty project new-thread actions select the workspace-root-backed project instead of falling back to the first folder.
- App Server health remains clear after restart, with no pending or queued RPCs.

#### Rollback/Cleanup Notes
- Screenshot artifacts are saved under `output/regression-7420/p0-real-workspace-root-sync/` when `-CaptureScreenshots` is used.
- To roll back, revert `src/composables/useDesktopState.ts`, `src/types/codex.ts`, `src\App.vue`, `src/components/sidebar/SidebarRegressionFixture.vue`, `scripts/regression-7420-frontend.ps1`, and this test section.

#### Regression Evidence
- 2026-07-05 real data evidence: `/codex-api/workspace-roots-state` returned first roots `C:\Users\SW\Documents\Playground`, `E:\javaword\CXCodex\codexui`, and `E:\javaword\ZXSAAS\mini`; labels included `E:\javaword\ZXSAAS\mini=ZXSAAS-mini`; active root was `E:\javaword\CXCodex\codexui`.
- 2026-07-05 real App Server evidence: a `thread/list` sample showed current thread rows from `E:\javaword\CXCodex`, `E:\javaword\ZXSAAS`, `E:\javaword\FZYC\live`, and other roots, while `codexui` was supplied by workspace roots rather than current thread rows.
- 2026-07-05 real DOM evidence: automated browser read 19 `.project-group` rows; the first names were `Playground`, `codexui`, `mini`, `MFDW_ZJ`, `MFDW`, `znjk`, `live`, and `live-service`; `codexui` rendered `0个会话` and `暂无会话` with one new-thread button; `mini` rendered as `ZXSAAS-mini` with the same empty state.
- 2026-07-05 interaction evidence: after clicking the `codexui` empty project new-thread action, the composer folder dropdown selected `codexui`; the bug found during acceptance was that `workspaceRoot` was lost while mapping `sourceGroups` to `projectGroups`, and it was fixed by preserving `workspaceRoot` in `applyCachedTitlesToGroups` and `applyThreadFlags`.
- 2026-07-05 refresh evidence: after reloading `http://127.0.0.1:7420/#/`, the first project names still read `Playground`, `codexui`, `mini`, `MFDW_ZJ`, `MFDW`, `znjk`, `live`, and `live-service`.
- 2026-07-05 restart evidence: `scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json` restarted local 7420 as PID 43248; `/health` returned ok; `/codex-api/health` returned ok with App Server PID 57096, `pendingRpcCount: 0`, and `queuedRpcCount: 0`; post-restart DOM still showed 19 project groups with `Playground`, `codexui`, and `mini` first.
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 frontend build: `npm.cmd run build:frontend` passed, including `vue-tsc --noEmit` and Vite build; Vite still reports the existing large chunk warning.
- 2026-07-05 frontend page regression: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -CaptureScreenshots -ScreenshotTaskName p0-real-workspace-root-sync` passed for home desktop/foldable/mobile drawer, skills phone, GitHub trending phone, diagnostics phone, local preview phone, `sidebar-rows-fixture-phone`, desktop/phone/foldable `composer-shell-fixture`, and desktop/phone/foldable `conversation-blocks-fixture`; thread page check was skipped because no `-ThreadId` was supplied.
- 2026-07-05 screenshot artifact: `output/regression-7420/p0-real-workspace-root-sync/sidebar-rows-fixture-phone.png`.

### Feature: Automated workspace root project parity regression

#### Prerequisites
- Local 7420 is running from `E:\javaword\CXCodex\codexui`.
- `/codex-api/workspace-roots-state` returns the current Codex Desktop workspace root order and labels.
- `agent-browser` is available in PATH.

#### Steps
1. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -CaptureScreenshots -ScreenshotTaskName automated-workspace-root-parity`.
2. Confirm the script checks `/health`, `/codex-api/health`, `/codex-api/diagnostics`, and `/codex-api/workspace-roots-state`.
3. Confirm the home desktop check reads `.project-group` rows from the real 7420 page.
4. Confirm the first sampled project rows match the first workspace roots by project name.
5. Confirm labeled roots such as `ZXSAAS-mini` match their workspace root label.
6. Confirm each sampled project row has one project-level new-thread action.
7. Confirm sampled empty workspace projects show `暂无会话`.

#### Expected Results
- The frontend regression fails if desktop workspace roots stop appearing at the top of the home sidebar in the same order.
- The regression fails if an empty workspace-root project loses its empty-state text or new-thread action.
- The assertion is dynamic and follows the current `/codex-api/workspace-roots-state` response instead of hard-coding `codexui`.

#### Rollback/Cleanup Notes
- Screenshot artifacts are saved under `output/regression-7420/automated-workspace-root-parity/` when `-CaptureScreenshots` is used.
- To roll back, remove `Read-HomeWorkspaceProjectMetrics`, `Assert-WorkspaceRootProjectParity`, the `/codex-api/workspace-roots-state` check from `scripts/regression-7420-frontend.ps1`, and this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 frontend page regression: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -CaptureScreenshots -ScreenshotTaskName automated-workspace-root-parity` passed. The run checked `/codex-api/workspace-roots-state` before home rendering, asserted the real home sidebar project rows match the first sampled workspace roots, then passed home desktop/foldable/mobile drawer, skills phone, GitHub trending phone, diagnostics phone, local preview phone, `sidebar-rows-fixture-phone`, desktop/phone/foldable `composer-shell-fixture`, and desktop/phone/foldable `conversation-blocks-fixture`; thread page check was skipped because no `-ThreadId` was supplied.
- 2026-07-05 screenshot artifact: `output/regression-7420/automated-workspace-root-parity/home-desktop.png`.

### Feature: P1 Codex Desktop project-order sidebar parity

#### Prerequisites
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- `C:\Users\SW\.codex\.codex-global-state.json` contains Codex Desktop `project-order`, `pinned-project-ids`, and `pinned-thread-ids`.
- Codex Desktop currently orders the sidebar project list with `E:\javaword\CXCodex\codexui` before `E:\javaword\ZXSAAS\mini`.

#### Steps
1. Call `GET http://127.0.0.1:7420/codex-api/workspace-roots-state`.
2. Confirm the response includes `projectOrder` and `pinnedProjectIds` in addition to `order`, `labels`, and `active`.
3. Confirm `projectOrder` starts with desktop project entries such as `E:\javaword\CXCodex\codexui`, `E:\javaword\ZXSAAS\mini`, and `E:\javaword\MFDW_ZJ`.
4. Open `http://127.0.0.1:7420/#/` and read the first `.project-group` rows.
5. Confirm the first project rows follow `projectOrder`; fall back to `order` only for roots missing from `projectOrder`.
6. Confirm labeled roots such as `E:\javaword\ZXSAAS\mini` still render with the desktop label `ZXSAAS-mini`.
7. Confirm pinned threads still appear in the pinned section and project rows, while pinned projects are preserved in state but not rendered as a new UI section.
8. Run `git diff --check`.
9. Run `npm.cmd run verify:server-modules`.
10. Run `npm.cmd run build`.
11. Restart local 7420 with `scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
12. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -CaptureScreenshots -ScreenshotTaskName p1-project-order-parity`.

#### Expected Results
- `/codex-api/workspace-roots-state` exposes desktop `project-order` and `pinned-project-ids` without losing existing workspace roots.
- 7420 home sidebar follows Codex Desktop project ordering instead of the raw saved workspace root order.
- Empty workspace-root projects remain visible with `暂无会话` and one project-level new-thread action.
- Existing pinned thread behavior and 5-row project preview behavior do not regress.

#### Rollback/Cleanup Notes
- Screenshot artifacts are saved under `output/regression-7420/p1-project-order-parity/` when `-CaptureScreenshots` is used.
- To roll back, revert `src/server/workspaceRootsState.ts`, `src/api/codexGateway.ts`, `src/composables/useDesktopState.ts`, `scripts/server-module-smoke.ts`, `scripts/regression-7420-frontend.ps1`, and this test section.

#### Regression Evidence
- 2026-07-05 service evidence: after `npm.cmd run build`, `scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json` restarted local 7420 as PID 57748; `/health` returned ok.
- 2026-07-05 workspace state evidence: `/codex-api/workspace-roots-state` returned raw `order` starting with `C:\Users\SW\Documents\Playground`, `E:\javaword\CXCodex\codexui`, and `E:\javaword\ZXSAAS\mini`; `projectOrder` started with `E:\javaword\CXCodex\codexui`, `E:\javaword\ZXSAAS\mini`, `E:\javaword\MFDW_ZJ`, `E:\javaword\MFDW`, and `C:\Users\SW\Documents\Playground`; `pinnedProjectIds` included `E:\javaword\ZXSAAS` and `E:\javaword\ZXSAAS\mini`.
- 2026-07-05 health evidence: `/codex-api/health` returned `status: ok`, App Server PID 53684, `pendingRpcCount: 0`, `queuedRpcCount: 0`, `pendingServerRequestCount: 0`, and `uncertainRequestCount: 0`.
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 server module verification: `npm.cmd run verify:server-modules` passed with `server module smoke ok`.
- 2026-07-05 build verification: `npm.cmd run build` passed for frontend and CLI; Vite still reports the existing large chunk warning.
- 2026-07-05 frontend page regression: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -CaptureScreenshots -ScreenshotTaskName p1-project-order-parity` passed for home desktop/foldable/mobile drawer, skills phone, GitHub trending phone, diagnostics phone, local preview phone, `sidebar-rows-fixture-phone`, desktop/phone/foldable `composer-shell-fixture`, and desktop/phone/foldable `conversation-blocks-fixture`; thread page check was skipped because no `-ThreadId` was supplied.
- 2026-07-05 screenshot artifact: `output/regression-7420/p1-project-order-parity/home-desktop.png`.

### Feature: P1 Codex Desktop pinned project sidebar parity

#### Prerequisites
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- `C:\Users\SW\.codex\.codex-global-state.json` contains Codex Desktop `pinned-project-ids`.
- Current real pinned project ids include `E:\javaword\ZXSAAS` and `E:\javaword\ZXSAAS\mini`.

#### Steps
1. Call `GET http://127.0.0.1:7420/codex-api/workspace-roots-state`.
2. Confirm `data.pinnedProjectIds` is non-empty and its entries are also present through `projectOrder` or raw workspace `order`.
3. Open `http://127.0.0.1:7420/#/` and read the first `.project-group` rows.
4. Confirm the first sampled project rows follow `pinnedProjectIds`, then `projectOrder`, then raw `order`, with duplicates removed.
5. Confirm pinned project rows have `data-pinned-project="true"` and show the compact pin marker next to the project title.
6. Confirm non-pinned projects keep their previous desktop `projectOrder` relative order.
7. Confirm the `sidebar-rows` fixture still limits the first expanded project to 5 visible threads and now reports exactly one pinned project marker.
8. Run `git diff --check`.
9. Run `npm.cmd run build`.
10. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -CaptureScreenshots -ScreenshotTaskName p1-pinned-project-parity`.

#### Expected Results
- 7420 visually promotes desktop pinned projects before normal projects without duplicating the same project in the sidebar.
- Pinned project display is compact: one pin icon beside the project title, no extra explanatory row or status block.
- Existing pinned thread section, running thread section, empty workspace-root projects, project labels, and 5-row project preview behavior do not regress.

#### Rollback/Cleanup Notes
- Screenshot artifacts are saved under `output/regression-7420/p1-pinned-project-parity/` when `-CaptureScreenshots` is used.
- To roll back, revert `src/types/codex.ts`, `src/composables/useDesktopState.ts`, `src/components/sidebar/SidebarThreadTree.vue`, `src/components/sidebar/SidebarRegressionFixture.vue`, `scripts/regression-7420-frontend.ps1`, and this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 build verification: `npm.cmd run build` passed for frontend and CLI; Vite still reports the existing large chunk warning.
- 2026-07-05 service evidence: `scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json` restarted local 7420 as PID 22316; `/health` returned ok.
- 2026-07-05 frontend page regression: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -CaptureScreenshots -ScreenshotTaskName p1-pinned-project-parity` passed for home desktop/foldable/mobile drawer, skills phone, GitHub trending phone, diagnostics phone, local preview phone, `sidebar-rows-fixture-phone`, desktop/phone/foldable `composer-shell-fixture`, and desktop/phone/foldable `conversation-blocks-fixture`; thread page check was skipped because no `-ThreadId` was supplied.
- 2026-07-05 screenshot artifact: `output/regression-7420/p1-pinned-project-parity/home-desktop.png`.

### Feature: P1 project thread preview ordering

#### Prerequisites
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- The sidebar regression fixture contains an intentionally unsorted first project thread array.
- P1 workspace project order and pinned project behavior are already enabled.

#### Steps
1. Open `http://127.0.0.1:7420/#/__regression/sidebar-rows?regression=frontend` at a phone-sized viewport such as 393x852.
2. Confirm the first project renders exactly 5 thread rows by default.
3. Confirm those 5 rows are sorted by `updatedAtIso`/`createdAtIso` descending, even though the fixture input array is not sorted.
4. Confirm the first 5 thread ids are `fixture-thread-running`, `fixture-thread-unread`, `fixture-thread-idle`, `fixture-thread-four`, and `fixture-thread-five`.
5. Confirm the show-more label remains `显示更多 3 条`.
6. Confirm the running and pinned thread sections still keep their own rows while each matching project row appears exactly once inside the project list.
7. Run `git diff --check`.
8. Run `npm.cmd run build`.
9. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -CaptureScreenshots -ScreenshotTaskName p1-project-thread-order`.

#### Expected Results
- Project thread preview rows are deterministic and newest-first regardless of App Server or fixture input order.
- The preview limit remains 5 rows, and the hidden count remains accurate.
- Search mode still returns matching rows in newest-first order.
- P1 project ordering and pinned project markers do not regress.

#### Rollback/Cleanup Notes
- Screenshot artifacts are saved under `output/regression-7420/p1-project-thread-order/` when `-CaptureScreenshots` is used.
- To roll back, revert `src/components/sidebar/SidebarThreadTree.vue`, `src/components/sidebar/SidebarRegressionFixture.vue`, `scripts/regression-7420-frontend.ps1`, and this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 frontend build verification: `npm.cmd run build:frontend` passed, including `vue-tsc --noEmit` and Vite build; Vite still reports the existing large chunk warning.
- 2026-07-05 build verification: `npm.cmd run build` passed for frontend and CLI; Vite still reports the existing large chunk warning.
- 2026-07-05 service evidence: `scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json` restarted local 7420 as PID 42060; `/health` returned ok.
- 2026-07-05 frontend page regression: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -CaptureScreenshots -ScreenshotTaskName p1-project-thread-order` passed for home desktop/foldable/mobile drawer, skills phone, GitHub trending phone, diagnostics phone, local preview phone, `sidebar-rows-fixture-phone`, desktop/phone/foldable `composer-shell-fixture`, and desktop/phone/foldable `conversation-blocks-fixture`; thread page check was skipped because no `-ThreadId` was supplied.
- 2026-07-05 screenshot artifact: `output/regression-7420/p1-project-thread-order/sidebar-rows-fixture-phone.png`.

### Feature: P1 pinned thread sidebar ordering and de-duplication

#### Prerequisites
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- `/codex-api/pinned-threads` returns the merged Web + Codex Desktop pinned thread ids.
- The sidebar regression fixture pins `fixture-thread-unread` first and `fixture-thread-running` second.

#### Steps
1. Call `GET http://127.0.0.1:7420/codex-api/pinned-threads` and confirm it returns a de-duplicated ordered array.
2. Open `http://127.0.0.1:7420/#/__regression/sidebar-rows?regression=frontend` at a phone-sized viewport such as 393x852.
3. Confirm the `置顶` section shows exactly 2 rows in override order: `fixture-thread-unread`, then `fixture-thread-running`.
4. Confirm the `正在运行` section is absent or empty when the only running fixture thread is already pinned.
5. Confirm the pinned running thread appears exactly twice in the full fixture: once in `置顶`, once in its project list.
6. Confirm the pinned unread thread appears exactly twice in the full fixture: once in `置顶`, once in its project list.
7. Confirm project preview ordering and the 5-row limit still match the P1 project thread preview test.
8. Run `git diff --check`.
9. Run `npm.cmd run build`.
10. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -CaptureScreenshots -ScreenshotTaskName p1-pinned-thread-parity`.

#### Expected Results
- The pinned section follows pinned id order, not updated time.
- Pinned running threads do not duplicate into the running section.
- Pinned threads remain visible inside their project list exactly once.
- Existing pinned project, project order, empty project, and project preview behavior do not regress.

#### Rollback/Cleanup Notes
- Screenshot artifacts are saved under `output/regression-7420/p1-pinned-thread-parity/` when `-CaptureScreenshots` is used.
- To roll back, revert `src/components/sidebar/SidebarRegressionFixture.vue`, `scripts/regression-7420-frontend.ps1`, and this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 frontend build verification: `npm.cmd run build:frontend` passed, including `vue-tsc --noEmit` and Vite build; Vite still reports the existing large chunk warning.
- 2026-07-05 build verification: `npm.cmd run build` passed for frontend and CLI; Vite still reports the existing large chunk warning.
- 2026-07-05 service evidence: `scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json` restarted local 7420 as PID 34200; `/health` returned ok.
- 2026-07-05 frontend page regression: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -CaptureScreenshots -ScreenshotTaskName p1-pinned-thread-parity` passed for home desktop/foldable/mobile drawer, skills phone, GitHub trending phone, diagnostics phone, local preview phone, `sidebar-rows-fixture-phone`, desktop/phone/foldable `composer-shell-fixture`, and desktop/phone/foldable `conversation-blocks-fixture`; thread page check was skipped because no `-ThreadId` was supplied.
- 2026-07-05 screenshot artifact: `output/regression-7420/p1-pinned-thread-parity/sidebar-rows-fixture-phone.png`.

### Feature: P1 missing pinned thread supplemental hydration

#### Prerequisites
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- `/codex-api/pinned-threads` returns merged Web + Codex Desktop pinned thread ids.
- `getThreadGroupsV2` calls active `thread/list` with `archived: false`.

#### Steps
1. Confirm `AppServerThreadListAugmenter` supplements only active/default first-page `thread/list` results.
2. Confirm archived `thread/list` results are returned unchanged.
3. Confirm active `thread/list` cursor pages are returned unchanged.
4. Confirm missing pinned ids are hydrated through `thread/read` with `includeTurns: false`.
5. Confirm invalid or failed `thread/read` results do not break the original list response.
6. Run `git diff --check`.
7. Run `npm.cmd run verify:server-modules`.
8. Run `npm.cmd run build`.
9. Restart 7420 with `scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
10. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -CaptureScreenshots -ScreenshotTaskName p1-pinned-thread-supplement`.

#### Expected Results
- A pinned thread that is absent from the active first-page `thread/list` response is appended to the server data source before the sidebar groups are built.
- Archived lists and cursor pages are not polluted with supplemental pinned threads.
- Existing pinned section ordering, running-section de-duplication, pinned project order, and project preview latest-5 behavior do not regress.

#### Rollback/Cleanup Notes
- Screenshot artifacts are saved under `output/regression-7420/p1-pinned-thread-supplement/` when `-CaptureScreenshots` is used.
- To roll back, revert `src/server/appServerThreadListAugment.ts`, `scripts/server-module-smoke.ts`, and this test section.

#### Regression Evidence
- 2026-07-05 static verification: `git diff --check` passed.
- 2026-07-05 server module verification: `npm.cmd run verify:server-modules` passed with `server module smoke ok`; the smoke now covers active/default first-page supplementation, archived list skip, active cursor-page skip, max-read behavior, failed read tolerance, and `thread/read` factory params.
- 2026-07-05 build verification: `npm.cmd run build` passed for frontend and CLI; Vite still reports the existing large chunk warning.
- 2026-07-05 service evidence: `scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json` restarted local 7420 as PID 50220; `/health` returned ok.
- 2026-07-05 frontend page regression: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -CaptureScreenshots -ScreenshotTaskName p1-pinned-thread-supplement` passed for home desktop/foldable/mobile drawer, skills phone, GitHub trending phone, diagnostics phone, local preview phone, `sidebar-rows-fixture-phone`, desktop/phone/foldable `composer-shell-fixture`, and desktop/phone/foldable `conversation-blocks-fixture`; thread page check was skipped because no `-ThreadId` was supplied.
- 2026-07-05 screenshot artifact: `output/regression-7420/p1-pinned-thread-supplement/sidebar-rows-fixture-phone.png`.

### Feature: P1 real 7420 sidebar data parity gate

#### Prerequisites
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- `/codex-api/pinned-threads`, `/codex-api/workspace-roots-state`, and `/codex-api/rpc` are reachable.
- The App Server can answer `thread/list` and `thread/read(includeTurns:false)`.

#### Steps
1. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420`.
2. Confirm the script checks `/health` and `/codex-api/health`.
3. Confirm pinned thread ids from `/codex-api/pinned-threads` are non-empty strings with no duplicates.
4. Confirm readable pinned thread ids from the first 20 sampled pins are present in the active `thread/list` data source.
5. Confirm the computed pinned section preserves `/codex-api/pinned-threads` order.
6. Confirm the active first page does not exceed the requested limit plus the supplemental pinned read limit.
7. Confirm archived first page and active cursor pages do not exceed the requested `thread/list` limit.
8. Confirm workspace `pinnedProjectIds` are present in `projectOrder` or raw `order`, and the computed sidebar project order promotes pinned projects first.
9. Confirm each real project group's latest 5 thread preview is newest-first.

#### Expected Results
- The real 7420 API responses can independently prove pinned thread supplement, pinned thread order, pinned project order, and project latest-5 ordering without relying only on frontend fixtures.
- A single transient `thread/list` timeout is retried once and reported through `rpcRetryCount`; repeated timeouts still fail the gate.
- The script prints a compact JSON summary containing pinned counts, active/archived first-page counts, retry count, project order sample, and latest-5 thread samples.

#### Rollback/Cleanup Notes
- No runtime state is written by this gate.
- To roll back, remove `scripts/verify-7420-sidebar-data.mjs`, the `test:7420:sidebar-data` package script, and this test section.

#### Regression Evidence
- 2026-07-05 first real-data run exposed a transient App Server `thread/list` timeout after 15s; `/codex-api/health` stayed ok with empty pending/queued RPC and recorded the timeout in `recentTimeouts`.
- 2026-07-05 retry-capable gate verification: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420` passed with `pinnedThreadCount: 10`, `readablePinnedSampleCount: 10`, `unreadablePinnedSampleCount: 0`, `activeThreadCount: 162`, `activeFirstPageCount: 103`, `archivedFirstPageCount: 100`, `rpcRetryCount: 0`, and `projectGroupCount: 16`.

### Feature: P1 Desktop session-index sidebar parity

#### Prerequisites
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- The Codex Desktop/session search index can find the target thread title through `/codex-api/thread-search`.
- The App Server can answer `thread/read(includeTurns:false)` for matching search results.

#### Steps
1. Run `npm.cmd run verify:server-modules`.
2. Run `npm.cmd run build`.
3. Restart 7420 with `powershell -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
4. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
5. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -CaptureScreenshots -ScreenshotTaskName p1-session-index-sidebar-parity`.
6. Confirm the data gate reports `requiredThread.title` as `分析项目` and `requiredThread.projectName` as `codexui`.
7. Confirm the frontend gate passes both `home desktop` and `home mobile drawer` required-thread DOM checks.

#### Expected Results
- Recent readable Desktop/session-index threads that are missing from active `thread/list` are supplemented into the 7420 sidebar data source.
- Pinned thread supplementation still works after the session-index supplement.
- Archived `thread/list` pages and active cursor pages remain unsupplemented.
- The browser regression fails if a Desktop/session-index target such as `分析项目` is found by search but missing from the visible desktop sidebar or mobile drawer.

#### Rollback/Cleanup Notes
- Screenshot artifacts are saved under `output/regression-7420/p1-session-index-sidebar-parity/` when `-CaptureScreenshots` is used.
- To roll back, revert `src/server/appServerThreadListAugment.ts`, `src/server/codexBridgeMiddlewareState.ts`, `scripts/server-module-smoke.ts`, `scripts/verify-7420-sidebar-data.mjs`, `scripts/regression-7420-frontend.ps1`, and this test section.

#### Regression Evidence
- 2026-07-06 server module verification: `npm.cmd run verify:server-modules` passed with `server module smoke ok`; the smoke covers supplemental session-index ids before pinned ids, max-read behavior, archived list skip, active cursor-page skip, failed read tolerance, and `thread/read(includeTurns:false)` factory params.
- 2026-07-06 build verification: `npm.cmd run build` passed for frontend and CLI; Vite still reports the existing large chunk warning.
- 2026-07-06 service evidence: `powershell -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json` restarted local 7420 as PID 35140; `/health` returned ok.
- 2026-07-06 data gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed with required thread `019f27ae-0ecd-7c50-9701-8ec003e66447`, title `分析项目`, project `codexui`, `activeThreadCount: 172`, `activeFirstPageCount: 113`, `archivedFirstPageCount: 100`, and `projectGroupCount: 18`.
- 2026-07-06 frontend page regression: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -CaptureScreenshots -ScreenshotTaskName p1-session-index-sidebar-parity` passed for home desktop/foldable/mobile drawer, skills phone, GitHub trending phone, diagnostics phone, local preview phone, `sidebar-rows-fixture-phone`, desktop/phone/foldable `composer-shell-fixture`, and desktop/phone/foldable `conversation-blocks-fixture`; thread page check was skipped because no `-ThreadId` was supplied.
- 2026-07-06 screenshot artifacts: `output/regression-7420/p1-session-index-sidebar-parity/home-desktop.png` and `output/regression-7420/p1-session-index-sidebar-parity/home-mobile-drawer.png`.

### Feature: P1 bounded Desktop session-index sidebar supplement

#### Prerequisites
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- `package.json` and `package-lock.json` are on version `2.2.8`.
- The Codex Desktop/session search index can find `分析项目` through `/codex-api/thread-search`.

#### Steps
1. Confirm `AppServerThreadListAugmenter` has both a read limit and an output limit for supplemental thread summaries.
2. Confirm cached supplemental summaries do not allow active first-page output to grow beyond `thread/list` limit plus the supplemental output limit.
3. Run `npm.cmd run verify:server-modules`.
4. Run `npm.cmd run build`.
5. Restart 7420 with `powershell -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
6. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
7. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -CaptureScreenshots -ScreenshotTaskName p1-session-index-sidebar-output-limit`.
8. Run `npm.cmd run verify:release -- -SchemaAudit warn -AllowDirty`.
9. Package the release with `npm.cmd run package:release -- -Version 2.2.8 -OutputDir output\release-2.2.8`.

#### Expected Results
- Active first-page `thread/list` remains bounded at the requested limit plus 20 supplemental rows, even after supplemental summaries are cached.
- `分析项目` remains visible in the active data source, desktop sidebar, and mobile drawer.
- Archived lists and active cursor pages remain unsupplemented.
- Release verification completes; schema drift may warn in `warn` mode but must not fail the gate.
- Release zip and `.sha256` are generated and pass checksum verification.

#### Rollback/Cleanup Notes
- Screenshot artifacts are saved under `output/regression-7420/p1-session-index-sidebar-output-limit/` when `-CaptureScreenshots` is used.
- Release package artifacts are saved under `output/release-2.2.8/`.
- To roll back, revert `src/server/appServerThreadListAugment.ts`, `scripts/server-module-smoke.ts`, `docs/changelog.zh-CN.md`, `docs/release-notes-2.2.8.zh-CN.md`, `README.md`, `package.json`, `package-lock.json`, and this test section.

#### Regression Evidence
- 2026-07-06 pre-fix data gate exposed the bounded-output bug: active first page reached `160+` after supplemental cache warm-up, while `分析项目` was still present.
- 2026-07-06 server module verification: `npm.cmd run verify:server-modules` passed with `server module smoke ok`; the smoke now covers cold and cached supplemental output limiting.
- 2026-07-06 build verification: `npm.cmd run build` passed for frontend and CLI; Vite still reports the existing large chunk warning.
- 2026-07-06 service evidence: `powershell -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json` restarted local 7420 as PID 56392 on version `2.2.8`; `/health` returned ok.
- 2026-07-06 data gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed with `activeFirstPageCount: 120`, required thread `019f27ae-0ecd-7c50-9701-8ec003e66447`, title `分析项目`, project `codexui`, `archivedFirstPageCount: 100`, and `projectGroupCount: 18`.
- 2026-07-06 frontend page regression: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -CaptureScreenshots -ScreenshotTaskName p1-session-index-sidebar-output-limit` passed for home desktop/foldable/mobile drawer, skills phone, GitHub trending phone, diagnostics phone, local preview phone, `sidebar-rows-fixture-phone`, desktop/phone/foldable `composer-shell-fixture`, and desktop/phone/foldable `conversation-blocks-fixture`; thread page check was skipped because no `-ThreadId` was supplied.
- 2026-07-06 release gate: `npm.cmd run verify:release -- -SchemaAudit warn -AllowDirty` completed successfully; schema audit drift remained a warning and wrote raw output to `output/app-server-schema-audit/20260706-021030/`.
- 2026-07-06 clean release gate: after committing, `npm.cmd run verify:release -- -SchemaAudit warn -RequireCleanGit -SkipBuild` completed successfully on a clean worktree; schema audit drift remained a warning and wrote raw output to `output/app-server-schema-audit/20260706-021415/`.
- 2026-07-06 release package: `npm.cmd run package:release -- -Version 2.2.8 -OutputDir output\release-2.2.8` generated `output/release-2.2.8/CX-Codex-2.2.8.zip` and `output/release-2.2.8/CX-Codex-2.2.8.sha256`.
- 2026-07-06 release artifact verification: `npm.cmd run verify:release-artifacts -- -OutputDir output\release-2.2.8` passed with `checksum ok: CX-Codex-2.2.8.zip`.
- 2026-07-06 screenshot artifacts: `output/regression-7420/p1-session-index-sidebar-output-limit/home-desktop.png` and `output/regression-7420/p1-session-index-sidebar-output-limit/home-mobile-drawer.png`.

### Feature: P1 Android voice-to-text draft insertion

#### Prerequisites
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- The browser regression agent is available through `agent-browser`.
- For real audio verification, configure `CX_CODEX_OPENAI_API_KEY`, `CODEXUI_OPENAI_API_KEY`, or `OPENAI_API_KEY`; without a key, the existing ChatGPT login-state fallback may be used.

#### Steps
1. Open the Composer on desktop and mobile viewport.
2. Use the microphone on a secure origin, or on Android WebView / HTTP use the system recorder or audio-file upload fallback.
3. Finish recording or select an audio file and wait for transcription.
4. Confirm the recognized text is inserted into the Composer input box.
5. Confirm the message is not submitted automatically unless the user explicitly enables “转写后自动发送”.
6. Run `npm.cmd run build`.
7. Restart 7420 with `powershell -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
8. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -CaptureScreenshots -ScreenshotTaskName p1-android-dictation-draft`.
9. Run Android sync or build checks after frontend changes are compiled, for example `npm.cmd run mobile:android:sync`.

#### Expected Results
- Transcribed text appears in the Composer input as editable draft text.
- No submit event is emitted by the default dictation path or the regression fixture.
- Android fallback opens system recording / audio upload when direct WebView recording is unavailable.
- The Composer shows lightweight recording, transcribing, success, and error feedback without adding persistent helper text.
- Desktop, phone, and foldable Composer regression fixtures pass with no horizontal overflow.

#### Rollback/Cleanup Notes
- Screenshot artifacts are saved under `output/regression-7420/p1-android-dictation-draft/` when `-CaptureScreenshots` is used.
- To roll back, revert `src/components/content/ThreadComposer.vue`, `src/components/content/ComposerRegressionFixture.vue`, `src/App.vue`, `scripts/regression-7420-frontend.ps1`, `docs/changelog.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-06 diff whitespace check: `git diff --check` passed.
- 2026-07-06 build verification: `npm.cmd run build` passed for frontend and CLI; Vite still reports the existing large chunk warning.
- 2026-07-06 service evidence: `powershell -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json` restarted local 7420 as PID 18944 on version `2.2.8`; `/health` returned ok.
- 2026-07-06 frontend page regression: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -CaptureScreenshots -ScreenshotTaskName p1-android-dictation-draft` passed for home desktop/foldable/mobile drawer, skills phone, GitHub trending phone, diagnostics phone, local preview phone, `sidebar-rows-fixture-phone`, desktop/phone/foldable `composer-shell-fixture`, and desktop/phone/foldable `conversation-blocks-fixture`; Composer fixture additionally clicked the dictation probe and asserted `语音转文字回归测试` entered the input with submit count `0`.
- 2026-07-06 Android sync: `npm.cmd run mobile:android:sync` passed; Capacitor copied current `dist` assets and found `@capacitor/app@8.1.0` plus `@capacitor/network@8.0.1`.
- 2026-07-06 Android debug build: `android\gradlew.bat assembleDebug` passed with `BUILD SUCCESSFUL`; Gradle still reports existing flatDir/deprecation warnings.
- 2026-07-06 screenshot artifacts: `output/regression-7420/p1-android-dictation-draft/composer-shell-fixture-desktop.png`, `output/regression-7420/p1-android-dictation-draft/composer-shell-fixture-phone.png`, and `output/regression-7420/p1-android-dictation-draft/composer-shell-fixture-foldable.png`.

### Feature: Thread-store session metadata read failure containment

#### Prerequisites
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- A thread may reference a malformed or legacy session jsonl that App Server reports as `thread-store internal error` or `does not start with session metadata`.

#### Steps
1. Run `npm.cmd run verify:server-modules`.
2. Run `npm.cmd run build`.
3. Restart 7420 with `powershell -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
4. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -CaptureScreenshots -ScreenshotTaskName p1-thread-store-read-error`.
5. Open the affected thread on mobile and confirm the status card does not show the local `C:\Users\SW\.codex\sessions\...jsonl` path or internal thread-store read error.

#### Expected Results
- Server-side runtime snapshots treat malformed session metadata read failures as recoverable thread-read failures, using cache or degraded snapshot behavior instead of throwing to the page.
- Frontend selected-thread refresh treats the same error as recoverable and does not set the global sync error.
- Browser regression fails if any checked page exposes `thread-store internal error`, `does not start with session metadata`, or a `failed to read thread C:\...` local path.

#### Rollback/Cleanup Notes
- Screenshot artifacts are saved under `output/regression-7420/p1-thread-store-read-error/` when `-CaptureScreenshots` is used.
- To roll back, revert `src/server/appServerRpcErrors.ts`, `src/composables/useDesktopState.ts`, `scripts/server-module-smoke.ts`, `scripts/regression-7420-frontend.ps1`, `docs/changelog.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-06 diff whitespace check: `git diff --check` passed.
- 2026-07-06 server module verification: `npm.cmd run verify:server-modules` passed with `server module smoke ok`; the smoke now covers `does not start with session metadata` and `thread-store internal error: failed to read thread` as recoverable thread-read failures.
- 2026-07-06 build verification: `npm.cmd run build` passed for frontend and CLI; Vite still reports the existing large chunk warning.
- 2026-07-06 service evidence: `powershell -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json` restarted local 7420 as PID 31768 on version `2.2.8`; `/health` returned ok.
- 2026-07-06 frontend page regression: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -CaptureScreenshots -ScreenshotTaskName p1-thread-store-read-error` passed for home desktop/foldable/mobile drawer, skills phone, GitHub trending phone, diagnostics phone, local preview phone, `sidebar-rows-fixture-phone`, desktop/phone/foldable `composer-shell-fixture`, desktop/phone/foldable `conversation-blocks-fixture`, and the target `thread-phone` page; every page asserted that internal thread-store read errors were not exposed.
- 2026-07-06 service log evidence: the malformed `019f27ae-0ecd-7c50-9701-8ec003e66447` session read is logged server-side as `Heavy thread snapshot unavailable with no cache`, confirming the error is contained as a degraded snapshot instead of being thrown to the UI.
- 2026-07-06 screenshot artifact: `output/regression-7420/p1-thread-store-read-error/thread-phone.png`.

### Feature: Android settings update entry consolidation

#### Prerequisites
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- Android shell assets have been synced after the frontend build.
- For the native download prompt branch, GitHub latest release must have an Android APK asset and a version greater than the installed app version.

#### Steps
1. Run `git diff --check`.
2. Run `npm.cmd run build`.
3. Run `npm.cmd run mobile:android:sync`.
4. Restart local 7420 with `powershell -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
5. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -CaptureScreenshots -ScreenshotTaskName p1-settings-mobile-update-entry`.
6. On Android, open Settings and confirm there is no separate `APP 更新`, `版本状态`, `更新包`, or `重新安装` block.
7. Tap the `当前版本` card and confirm it shows a checking/loading state while reading GitHub release metadata.
8. If GitHub latest version is greater than the installed app version and has an Android APK asset, confirm the settings sheet closes and the download confirmation dialog appears.
9. If the installed version is current, confirm the card settles to `已是最新` and no download dialog appears.

#### Expected Results
- Settings keeps a single update entry under the app/version card: `当前版本` plus the current check/update action.
- The old App update section, repeated update package field, release page button, and same-version reinstall path are no longer shown.
- Loading feedback appears inline while checking or downloading.
- Download confirmation appears only when GitHub latest Android release is newer than the installed version and has an installable APK asset.

#### Rollback/Cleanup Notes
- Screenshot artifacts are saved under `output/regression-7420/p1-settings-mobile-update-entry/` when `-CaptureScreenshots` is used.
- To roll back, revert `src/App.vue`, `docs/changelog.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-06 diff whitespace check: `git diff --check` passed.
- 2026-07-06 build verification: `npm.cmd run build` passed for frontend and CLI; Vite still reports the existing large chunk warning.
- 2026-07-06 Android sync: `npm.cmd run mobile:android:sync` passed; Capacitor copied current `dist` assets and found `@capacitor/app@8.1.0` plus `@capacitor/network@8.0.1`.
- 2026-07-06 service evidence: `powershell -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json` restarted local 7420 as PID 47264 on version `2.2.8`; `/health` returned ok.
- 2026-07-06 frontend page regression: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -CaptureScreenshots -ScreenshotTaskName p1-settings-mobile-update-entry` passed for home desktop/foldable/mobile drawer, skills phone, GitHub trending phone, diagnostics phone, local preview phone, `sidebar-rows-fixture-phone`, desktop/phone/foldable `composer-shell-fixture`, and desktop/phone/foldable `conversation-blocks-fixture`; thread page check was skipped because no `-ThreadId` was supplied.
- 2026-07-06 screenshot artifacts: `output/regression-7420/p1-settings-mobile-update-entry/home-desktop.png`, `output/regression-7420/p1-settings-mobile-update-entry/home-mobile-drawer.png`, and `output/regression-7420/p1-settings-mobile-update-entry/composer-shell-fixture-phone.png`.

### Feature: Mobile thread list and history stability recovery

#### Prerequisites
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- The Codex account has enough sessions to exercise `thread/list` pagination.
- At least one legacy or malformed session jsonl exists where App Server heavy `thread/read` can fail with `does not start with session metadata` or `thread-store internal error`.

#### Steps
1. Run `npm.cmd run verify:server-modules`.
2. Run `npm.cmd run build`.
3. Restart local 7420 with `powershell -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
4. Call `thread/list` through `/codex-api/rpc` and confirm the first page returns without waiting for all supplemental session-index reads to finish.
5. Open the mobile page and confirm the sidebar/session list renders even if a later `nextCursor` request fails with `invalid cursor`.
6. Open a normal recent thread and confirm messages appear without a long blank loading state.
7. Open a legacy malformed thread such as `019f27ae-0ecd-7c50-9701-8ec003e66447` and confirm recent user/assistant history is shown from the local session-log fallback when App Server heavy read fails.
8. If a thread still has no recoverable messages, confirm the runtime status bar says `历史暂不可用` and offers `强制恢复` instead of silently showing an empty synced state.

#### Expected Results
- `AppServerThreadListAugmenter` keeps supplemental thread reads best-effort with a small read count, per-read timeout, and total time budget.
- Pinned threads are attempted before session-index-only supplemental threads.
- Frontend `thread/list` pagination keeps already loaded pages when a later cursor is rejected.
- Runtime snapshot reads fall back from failed heavy `thread/read` to cached messages or a bounded local session-log parse.
- Mobile users see either recovered recent history or an explicit unavailable-history state, not a misleading empty conversation.

#### Rollback/Cleanup Notes
- To roll back, revert `src/server/appServerThreadListAugment.ts`, `src/server/codexBridgeMiddlewareState.ts`, `src/server/appServerThreadRuntimeSnapshot.ts`, `src/server/appServerSessionLogThreadRead.ts`, `src/server/rpcProxyRoute.ts`, `src/api/codexGateway.ts`, `src/components/content/RuntimeStatusBar.vue`, `scripts/server-module-smoke.ts`, and this test section.

#### Regression Evidence
- 2026-07-06 pre-fix evidence: local `/codex-api/rpc` `thread/list` with `limit=20` returned 40 rows but took about `4163ms` on the first uncached call because supplemental reads were synchronous; repeated cached calls dropped to `23ms` and `13ms`.
- 2026-07-06 pre-fix evidence: full pagination hit App Server `invalid cursor: 05/15/2026 09:06:24`, proving list loading must preserve already loaded pages on cursor failure.
- 2026-07-06 pre-fix evidence: `/codex-api/state/thread/019f27ae-0ecd-7c50-9701-8ec003e66447` returned `messageState=unavailable` and zero turns while the local session jsonl existed at `C:\Users\SW\.codex\sessions\2026\07\03\rollout-2026-07-03T19-12-31-019f27ae-0ecd-7c50-9701-8ec003e66447.jsonl`.
- 2026-07-06 server module verification: `npm.cmd run verify:server-modules` passed with `server module smoke ok`; coverage includes supplemental-read timeout, session-log thread-read parsing, and runtime snapshot fallback from failed heavy `thread/read` to session-log messages.
- 2026-07-06 root-cause measurement before deploying the fallback to the main RPC path: uncached `/codex-api/rpc thread/list` took `11714ms`, cached repeat took `102ms`, and malformed `thread/read(includeTurns:true)` for `019f27ae-0ecd-7c50-9701-8ec003e66447` returned `502`.
- 2026-07-06 post-budget measurement after deploying the supplemental-read budget: uncached `/codex-api/rpc thread/list` dropped to `4491ms`, cached repeat took `47ms`, and service logs showed the remaining cold latency was App Server `thread/list` itself at `4273ms`.
- 2026-07-06 post-fallback measurement after wiring session-log fallback into `/codex-api/rpc`: malformed `thread/read(includeTurns:true)` for `019f27ae-0ecd-7c50-9701-8ec003e66447` returned `10` turns in `1670ms` with warning `thread/read fell back to local session log messages` instead of `502`.
- 2026-07-06 final P0 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`; coverage includes supplemental-read timeout, tail-bounded session-log fallback, runtime snapshot fallback, and `/codex-api/rpc thread/read` session-log recovery.
- 2026-07-06 final P0 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`; `npm.cmd run build` passed for frontend and CLI with only the existing large chunk warning.
- 2026-07-06 final deploy evidence: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.cx-codex\config.json` restarted local 7420 as PID `29528`, version `2.2.8`, and `/health` returned ok.
- 2026-07-06 final sidebar data gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed; required thread `019f27ae-0ecd-7c50-9701-8ec003e66447` appeared as title `分析项目` under project `codexui`, with `activeThreadCount=180` and `projectGroupCount=18`.
- 2026-07-06 final malformed thread-read gate: direct `/codex-api/rpc thread/read(includeTurns:true)` for `019f27ae-0ecd-7c50-9701-8ec003e66447` returned warning `thread/read fell back to local session log messages`, `threadId=019f27ae-0ecd-7c50-9701-8ec003e66447`, `turnCount=1`, and `elapsedMs=196`; this confirms the tail-bounded local fallback avoids the previous 502 while recovering recent history.
- 2026-07-06 final browser gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed; it opened the real thread page at `393x852` after desktop, foldable, phone drawer, fixture, and content-block checks.

### Feature: Hide low-value MCP tool call fallback messages

#### Prerequisites
- The frontend is built from the latest `E:\javaword\CXCodex\codexui` source.
- A conversation contains App Server `mcpToolCall` thread items, such as browser/tool automation metadata.

#### Steps
1. Run `npm.cmd run verify:frontend-normalizers`.
2. Run `npm.cmd run build:frontend`.
3. Open a mobile conversation that previously showed `未适配的 App Server 内容`, `unhandled.mcpToolCall`, or `Unhandled App Server item: mcpToolCall`.
4. Confirm the visible conversation contains the user message, assistant response, and useful command execution content, but not the internal MCP tool call fallback cards.

#### Expected Results
- `mcpToolCall` items are filtered during message normalization and do not render as system fallback messages.
- Other unknown App Server item types still produce fallback diagnostics, so genuinely new unsupported content remains visible for future adaptation.
- `commandExecution` messages still render normally.

#### Rollback/Cleanup Notes
- To roll back, revert `src/api/normalizers/v2.ts`, `scripts/verify-frontend-normalizers.mjs`, and this test section.

#### Regression Evidence
- 2026-07-06 frontend normalizer smoke: `npm.cmd run verify:frontend-normalizers` passed and asserts `mcpToolCall` items do not add `unhandled.mcpToolCall` messages.
- 2026-07-06 frontend build: `npm.cmd run build:frontend` passed; Vite still reports the existing large chunk warning.
- 2026-07-06 final frontend gate: `npm.cmd run verify:frontend-normalizers` and full `npm.cmd run build` passed; `test:7420:frontend` also passed against the live 7420 service and the `conversation-blocks` fixture across desktop, phone, and foldable viewports.

### Feature: Cache-first thread list startup

#### Prerequisites
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- The browser has loaded the home page once after this change, so `codex-web-local.thread-groups-cache.v1` can be populated.
- The account has a non-empty thread list and includes the `分析项目` thread used by the standard sidebar data gate.

#### Steps
1. Run `npm.cmd run build:frontend`.
2. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.cx-codex\config.json`.
3. Open `http://127.0.0.1:7420/#/` once in a browser session and wait until sidebar thread rows render.
4. Confirm `localStorage.getItem('codex-web-local.thread-groups-cache.v1')` is present and reasonably bounded.
5. Navigate the same browser session to `about:blank`, then reopen `http://127.0.0.1:7420/#/`.
6. Confirm sidebar thread rows render from cache quickly, before the cold App Server `thread/list` request would normally finish.
7. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
8. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- First load after no cache still performs the normal App Server `thread/list` flow and writes a bounded cache.
- Subsequent startup renders cached project/thread groups first, then refreshes the real list in the background.
- Cached startup does not clear read/scroll state for older threads outside the cache window.
- Cached startup does not replace a saved selected thread just because that thread is outside the cache window.
- The standard sidebar data gate still finds `分析项目`, proving the background refresh preserves the Desktop/session-index parity fix.

#### Rollback/Cleanup Notes
- To roll back, revert `src/composables/useDesktopState.ts`, `src/App.vue`, `scripts/regression-7420-frontend.ps1`, `docs/changelog.zh-CN.md`, and this test section.
- To clear only the local browser cache during manual testing, remove `codex-web-local.thread-groups-cache.v1` from localStorage.

#### Regression Evidence
- 2026-07-06 baseline measurement before this change: direct `/codex-api/rpc thread/list` cold call took `5387ms`; repeated cached backend call took `44ms`; target `thread/read` light/heavy recovery was not the bottleneck (`11ms` / `82ms`).
- 2026-07-06 post-change frontend build: `npm.cmd run build:frontend` passed; Vite still reports the existing large chunk warning.
- 2026-07-06 deploy evidence: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.cx-codex\config.json` restarted local 7420 as PID `63832`, version `2.2.8`, and `/health` returned ok.
- 2026-07-06 cache measurement with agent-browser desktop viewport: first page load populated `codex-web-local.thread-groups-cache.v1` at about `119831` characters with `65` rendered sidebar rows; reopening from `about:blank` rendered rows in `1058ms`.
- 2026-07-06 backend cold-list check after deploy: direct `/codex-api/rpc thread/list` still took `4167ms`, confirming the optimization improves perceived startup by rendering cached rows while preserving the real background sync path.
- 2026-07-06 sidebar data gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed; required thread `019f27ae-0ecd-7c50-9701-8ec003e66447` remained under project `codexui`.
- 2026-07-06 browser gate hardening: `scripts/regression-7420-frontend.ps1` now treats exact `thread-store internal error` and `failed to read thread C:\...` output as internal read-error exposure, while allowing normal chat text to discuss `does not start with session metadata`.
- 2026-07-06 final P1 gate: `npm.cmd run verify:server-modules`, `npm.cmd run verify:frontend-normalizers`, `npm.cmd run build`, `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`, and `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` all passed; local 7420 final restart used PID `47504`.

### Feature: Cache-first thread message startup

#### Prerequisites
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- A target conversation such as `019f27ae-0ecd-7c50-9701-8ec003e66447` has been opened once after this change, so `codex-web-local.thread-message-cache.v1` can be populated.
- The same browser session or Android WebView can retain localStorage between page opens.

#### Steps
1. Run `npm.cmd run build:frontend`.
2. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.cx-codex\config.json`.
3. Open `http://127.0.0.1:7420/#/thread/019f27ae-0ecd-7c50-9701-8ec003e66447` and wait until messages render.
4. Confirm `localStorage.getItem('codex-web-local.thread-message-cache.v1')` exists and contains an entry for the target thread.
5. Reopen the same thread route and confirm cached messages appear before a full network refresh is required.
6. Confirm the page still refreshes in the background and does not show stale running state after the real runtime snapshot arrives.
7. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- `setPersistedMessagesForThread` writes a bounded local message snapshot for recently opened threads.
- `selectThread` hydrates cached messages only when the thread is not already loaded in memory, then performs the existing silent background refresh path.
- Cache entries are limited by thread count, message count, text length, and command output length.
- Cache hydration does not overwrite running status, pending requests, queued messages, or final runtime state from the background refresh.
- If the project/thread list has not caught up yet, a route thread with cached messages uses a first-user-message title fallback instead of showing `选择会话`.

#### Rollback/Cleanup Notes
- To roll back, revert `src/composables/useDesktopState.ts`, `src/App.vue`, `docs/changelog.zh-CN.md`, and this test section.
- To clear only local message snapshots during manual testing, remove `codex-web-local.thread-message-cache.v1` from localStorage.

#### Regression Evidence
- 2026-07-06 pre-change API measurement: target `thread/read(includeTurns:true)` returned in `181ms` cold and `67ms` warm through local fallback; runtime snapshot returned in `13ms`, so this cache primarily protects larger/colder/weak-network conversations rather than the already-small target thread.
- 2026-07-06 post-change frontend build: `npm.cmd run build:frontend` passed; Vite still reports the existing large chunk warning.
- 2026-07-06 deploy evidence: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.cx-codex\config.json` restarted local 7420 as PID `60888`, version `2.2.8`, and `/health` returned ok.
- 2026-07-06 page evidence after waiting for background sync: target route `#/thread/019f27ae-0ecd-7c50-9701-8ec003e66447` rendered the P0 completion content, wrote `codex-web-local.thread-message-cache.v1` at about `8857` characters, and stored `40` cached messages for the target thread.
- 2026-07-06 final P1 message-cache gate: `npm.cmd run verify:server-modules`, `npm.cmd run verify:frontend-normalizers`, `npm.cmd run build`, `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`, and `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` all passed; local 7420 final restart used PID `21308`.

### Feature: Lazy render long conversation code blocks

#### Prerequisites
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- A conversation or regression fixture contains a fenced code block or diff block longer than 120 lines.
- The browser viewport is set to a phone-sized width such as `393x852` for the primary mobile check.

#### Steps
1. Run `npm.cmd run verify:frontend-normalizers`.
2. Run `npm.cmd run build`.
3. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.cx-codex\config.json`.
4. Open the target conversation or `/#/__regression/conversation-blocks`.
5. Locate a code/diff block longer than 120 lines.
6. Confirm the block initially renders the first 120 lines plus an `展开剩余 N 行` action.
7. Tap `展开剩余 N 行` and confirm the full block renders.
8. Tap `收起代码` and confirm the block returns to the 120-line preview.
9. Tap the code block copy button and confirm clipboard copy still contains the full code block, not only the preview.
10. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- Long code/diff blocks do not render every line into the DOM until the user explicitly expands them.
- Short code/diff blocks render exactly as before.
- Copy still uses the complete code block content.
- Switching threads clears expanded-code state, so a newly opened long conversation starts from the lightweight preview.
- Existing conversation block regression checks still pass, including code block copy, file cards, raw payload, command blocks, and mobile overflow checks.

#### Rollback/Cleanup Notes
- To roll back, revert `src/components/content/ThreadConversation.vue`, `docs/changelog.zh-CN.md`, and this test section.
- No localStorage or server data cleanup is required; the expanded-code state is in-memory only.

#### Regression Evidence
- 2026-07-06 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`.
- 2026-07-06 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-06 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-06 deploy evidence: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.cx-codex\config.json` restarted local 7420 as PID `44504`, version `2.2.8`, and `/health` returned ok.
- 2026-07-06 sidebar data gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed; required thread `019f27ae-0ecd-7c50-9701-8ec003e66447` remained under project `codexui`.
- 2026-07-06 browser gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation-blocks fixture, and the real target thread phone route.

### Feature: Recent-window conversation derived UI metadata

#### Prerequisites
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- The account has at least one real thread with a large recovered or App Server `thread/read(includeTurns:true)` payload.
- The standard real-thread check can still use `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目`.

#### Steps
1. Measure representative threads with `/codex-api/rpc` `thread/read(includeTurns:true)` and record elapsed time, JSON size, turn count, and item count.
2. Run `npm.cmd run verify:frontend-normalizers`.
3. Run `npm.cmd run build`.
4. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.cx-codex\config.json`.
5. Open a phone-sized conversation route such as `http://127.0.0.1:7420/#/thread/019f27ae-0ecd-7c50-9701-8ec003e66447`.
6. Confirm the latest messages render first without a blank page.
7. Use `继续查看更多` to reveal older messages and confirm older history still appears on demand.
8. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
9. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- `ThreadConversation` still defaults to the newest visible window and keeps old history behind the existing reveal control.
- Guided-reply collapse descriptors, guided duration labels, and worked-summary duration metadata are derived from the recent message window instead of scanning all historical messages.
- Recent/current turns keep the same guided reply folding behavior as before.
- Older history remains available when explicitly revealed, even if some old guided assistant steps no longer get recent-window folding metadata.
- The real `分析项目` thread remains readable on phone view and does not regress to an empty or internal-error page.

#### Rollback/Cleanup Notes
- To roll back, revert `src/components/content/ThreadConversation.vue`, `docs/changelog.zh-CN.md`, and this test section.
- No browser storage cleanup is required; this change only affects in-memory derived UI metadata.

#### Regression Evidence
- 2026-07-06 baseline measurement: real `分析项目` `thread/read(includeTurns:true)` returned through local session-log fallback in about `81ms` with a roughly `15KB` payload, confirming that specific thread is not currently backend-bound.
- 2026-07-06 representative-thread sampling: the largest recent sampled thread was `上传知识库并验证问答` with about `414KB`, `10` turns, `373` items, and `319ms` heavy read time; this is the current best local evidence for long-history frontend derived-metadata pressure.
- 2026-07-06 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`.
- 2026-07-06 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-06 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-06 deploy evidence: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.cx-codex\config.json` restarted local 7420 as PID `64740`, version `2.2.8`, and `/health` returned ok.
- 2026-07-06 sidebar data gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed; required thread `019f27ae-0ecd-7c50-9701-8ec003e66447` remained under project `codexui`.
- 2026-07-06 browser gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation-blocks fixture, and the real target thread phone route.

### Feature: Visible-window conversation render entries

#### Prerequisites
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- The account has a long enough conversation to show `继续查看更多`, or the standard `分析项目` real-thread route is available for regression.
- The browser viewport is set to a phone-sized width such as `393x852` for the primary mobile check.

#### Steps
1. Run `npm.cmd run verify:frontend-normalizers`.
2. Run `npm.cmd run build`.
3. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.cx-codex\config.json`.
4. Open a long conversation on the phone viewport.
5. Confirm the latest message window appears first and older history is behind `继续查看更多`.
6. Tap `继续查看更多` and confirm older messages are added without jumping away from the current reading position.
7. Use message/favorite jump if available and confirm hidden older target messages expand the visible window before scrolling, instead of scrolling to the top.
8. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
9. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- `ThreadConversation` only builds conversation render entries for `renderableMessages.slice(visibleMessageStartIndex)`, not for the entire historical message array.
- Initial entry preparation is bounded to the newest window.
- Revealing older history lowers `visibleMessageStartIndex` and intentionally expands the prepared window.
- Favorite/message focus still finds the target in the full renderable message list first, expands the visible window if needed, and then scrolls only when the target entry exists.
- Existing virtualized rendering, long code block preview, guided reply folding, and mobile overflow checks continue to pass.

#### Rollback/Cleanup Notes
- To roll back, revert `src/components/content/ThreadConversation.vue`, `docs/changelog.zh-CN.md`, and this test section.
- No localStorage or server data cleanup is required; this change only affects in-memory render entry preparation.

#### Regression Evidence
- 2026-07-06 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`.
- 2026-07-06 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-06 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-06 deploy evidence: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.cx-codex\config.json` restarted local 7420 as PID `63872`, version `2.2.8`, and `/health` returned ok.
- 2026-07-06 sidebar data gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed; required thread `019f27ae-0ecd-7c50-9701-8ec003e66447` remained under project `codexui`.
- 2026-07-06 browser gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation-blocks fixture, and the real target thread phone route.

### Feature: Recent-window conversation reactive watcher

#### Prerequisites
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- A long real conversation is available; the standard regression target is `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目`.
- The conversation contains enough messages to exercise the newest-window default and optional older-history reveal path.

#### Steps
1. Run `npm.cmd run verify:server-modules`.
2. Run `npm.cmd run verify:frontend-normalizers`.
3. Run `npm.cmd run build`.
4. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.cx-codex\config.json`.
5. Open `http://127.0.0.1:7420/#/thread/019f27ae-0ecd-7c50-9701-8ec003e66447` on a phone-sized viewport.
6. Confirm the newest messages render first and the page does not expose a blank history area or internal thread-read error.
7. If `继续查看更多` is visible, tap it and confirm older history can still be revealed without losing the newest-window position.
8. While a command is running or after a command completes, confirm visible command elapsed time and completion collapse still update for recent/current messages.
9. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
10. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- `ThreadConversation` still shows the latest visible message window first.
- Reactive message-change work for command elapsed timers, command completion collapse, and new-output signature detection is bounded to the recent watch window plus the currently expanded visible window.
- Revealed older messages remain readable on demand.
- Current/recent command cards keep their running timer and completion collapse behavior.
- The real `分析项目` thread remains present in the sidebar data gate and readable in the browser/mobile regression gate.

#### Rollback/Cleanup Notes
- To roll back, revert `src/components/content/ThreadConversation.vue`, `docs/changelog.zh-CN.md`, and this test section.
- No server state, browser storage, or session log cleanup is required; this change only affects in-memory reactive UI work.

#### Regression Evidence
- 2026-07-06 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`.
- 2026-07-06 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-06 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-06 deploy evidence: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.cx-codex\config.json` restarted local 7420 as PID `13116`, version `2.2.8`, and `/health` returned ok.
- 2026-07-06 sidebar data gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed; required thread `019f27ae-0ecd-7c50-9701-8ec003e66447` remained under project `codexui`.
- 2026-07-06 browser gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation-blocks fixture, and the real target thread phone route.

### Feature: Bounded App Server turn item payloads

#### Prerequisites
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- The standard real-thread regression target `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.
- Server module smoke is part of the verification run.

#### Steps
1. Run `npm.cmd run verify:server-modules`.
2. Confirm `smokeAppServerRpcResult` covers both recent-turn trimming and single-turn item trimming.
3. Run `npm.cmd run verify:frontend-normalizers`.
4. Run `npm.cmd run build`.
5. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.cx-codex\config.json`.
6. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
7. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- `trimThreadTurnsInRpcResult` still leaves non-thread and already-small thread responses unchanged.
- Thread responses with more than 10 turns keep only the latest 10 turns.
- A single oversized turn keeps 160 items: the first item plus the latest 159 items.
- Trimmed oversized turns expose `itemsView: recent` and `originalItemsCount` for diagnostics without rendering an extra user-facing warning card.
- The real `分析项目` thread remains present in the sidebar data gate and readable in the browser/mobile regression gate.

#### Rollback/Cleanup Notes
- To roll back, revert `src/server/appServerRpcResult.ts`, `scripts/server-module-smoke.ts`, `docs/changelog.zh-CN.md`, and this test section.
- No session files or browser storage need cleanup; this change only trims transient RPC payloads before the frontend normalizes them.

#### Regression Evidence
- 2026-07-06 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`.
- 2026-07-06 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-06 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-06 deploy evidence: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.cx-codex\config.json` restarted local 7420 as PID `51632`, version `2.2.8`, and `/health` returned ok.
- 2026-07-06 sidebar data gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed; required thread `019f27ae-0ecd-7c50-9701-8ec003e66447` remained under project `codexui`.
- 2026-07-06 browser gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation-blocks fixture, and the real target thread phone route.

### Feature: Non-fresh thread detail retry

#### Prerequisites
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- The standard real-thread regression target `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.
- Browser devtools or logs can be used for manual inspection when simulating transient App Server failure.

#### Steps
1. Run `npm.cmd run verify:server-modules`.
2. Run `npm.cmd run verify:frontend-normalizers`.
3. Run `npm.cmd run build`.
4. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.cx-codex\config.json`.
5. Open a selected thread while App Server details are healthy and confirm fresh details clear any pending non-fresh retry.
6. Simulate or observe a transient `cached` / `unavailable` thread detail state and confirm existing messages stay visible while the active selected thread is queued for delayed silent retry.
7. Confirm retries are bounded to three delays (`2500ms`, `9000ms`, `20000ms`) and are cleared on fresh detail success or polling stop.
8. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
9. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- A non-fresh selected-thread detail result does not replace visible content with a blank page.
- The frontend schedules a lightweight retry through the existing event sync queue instead of requiring manual refresh.
- Retry timers are per-thread, bounded, and do not keep firing forever when App Server remains unavailable.
- Fresh thread detail success clears pending retry state.
- The real `分析项目` thread remains present in the sidebar data gate and readable in the browser/mobile regression gate.

#### Rollback/Cleanup Notes
- To roll back, revert `src/composables/useDesktopState.ts`, `docs/changelog.zh-CN.md`, and this test section.
- No server data, browser storage, or session files need cleanup; retry state is in-memory only.

#### Regression Evidence
- 2026-07-06 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`.
- 2026-07-06 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-06 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-06 deploy evidence: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.cx-codex\config.json` restarted local 7420 as PID `43452`, version `2.2.8`, and `/health` returned ok.
- 2026-07-06 sidebar data gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed; required thread `019f27ae-0ecd-7c50-9701-8ec003e66447` remained under project `codexui`.
- 2026-07-06 browser gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation-blocks fixture, and the real target thread phone route.

### Feature: Session-log fallback thread title metadata

#### Prerequisites
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- The standard real-thread regression target `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.
- A malformed or non-standard session log can trigger local session-log fallback, or the server module smoke fixture can validate the parser directly.

#### Steps
1. Run `npm.cmd run verify:server-modules`.
2. Confirm `smokeAppServerSessionLogThreadRead` verifies fallback `thread.name` and `thread.title` are recovered from the original thread metadata or first user preview.
3. Run `npm.cmd run verify:frontend-normalizers`.
4. Run `npm.cmd run build`.
5. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.cx-codex\config.json`.
6. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
7. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- Session-log fallback still recovers recent user/assistant messages from malformed or non-standard jsonl logs.
- Fallback `thread.name` and `thread.title` are non-empty when the original light thread has a title/name or the recovered preview contains a first user message.
- Direct thread detail consumers do not receive a blank title when fallback has enough metadata to infer one.
- The real `分析项目` thread remains present in the sidebar data gate and readable in the browser/mobile regression gate.

#### Rollback/Cleanup Notes
- To roll back, revert `src/server/appServerSessionLogThreadRead.ts`, `scripts/server-module-smoke.ts`, `docs/changelog.zh-CN.md`, and this test section.
- No session files, browser storage, or server state need cleanup; this only changes fallback payload metadata.

#### Regression Evidence
- 2026-07-06 measurement before fix: real `分析项目` `thread/read(includeTurns:true)` fell back to local session-log messages, returned about `45KB`, `4` turns, and `95` items, but the fallback thread title was empty.
- 2026-07-06 measurement after fix: real `分析项目` fallback still returned local session-log messages and now included `thread.name` / `thread.title` as `分析项目`, with preview `分析此项目`.
- 2026-07-06 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`.
- 2026-07-06 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-06 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-06 deploy evidence: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.cx-codex\config.json` restarted local 7420 as PID `69172`, version `2.2.8`, and `/health` returned ok.
- 2026-07-06 sidebar data gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed; required thread `019f27ae-0ecd-7c50-9701-8ec003e66447` remained under project `codexui`.
- 2026-07-06 browser gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation-blocks fixture, and the real target thread phone route.

### Feature: Session-log fallback repeated message recovery

#### Prerequisites
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- The standard real-thread regression target `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.
- Server module smoke can validate the parser with repeated recovered messages.

#### Steps
1. Run `npm.cmd run verify:server-modules`.
2. Confirm `smokeAppServerSessionLogThreadRead` includes two separated user messages with identical text `继续`.
3. Confirm adjacent duplicate no-id agent events are still collapsed to one recovered item.
4. Run `npm.cmd run verify:frontend-normalizers`.
5. Run `npm.cmd run build`.
6. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.cx-codex\config.json`.
7. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
8. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- Session-log fallback preserves repeated user turns with the same text when they have distinct message ids or are separated by other recovered messages.
- Adjacent duplicate no-id event messages are still folded to avoid double-rendering response/event duplicates.
- Recovered turns remain capped by the existing fallback turn limit and continue to prefer recent history.
- The real `分析项目` thread remains present in the sidebar data gate and readable in the browser/mobile regression gate.

#### Rollback/Cleanup Notes
- To roll back, revert `src/server/appServerSessionLogThreadRead.ts`, `scripts/server-module-smoke.ts`, `docs/changelog.zh-CN.md`, and this test section.
- No session files, browser storage, or server state need cleanup; this only changes fallback duplicate suppression.

#### Regression Evidence
- 2026-07-06 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`.
- 2026-07-06 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-06 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-06 deploy evidence: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.cx-codex\config.json` restarted local 7420 as PID `20580`, version `2.2.8`, and `/health` returned ok.
- 2026-07-06 sidebar data gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed; required thread `019f27ae-0ecd-7c50-9701-8ec003e66447` remained under project `codexui`.
- 2026-07-06 browser gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation-blocks fixture, and the real target thread phone route.

### Feature: Thread page token usage sync throttling

#### Prerequisites
- Local 7420 is running from the latest `E:\javaword\CXCodex\codexui` build.
- The standard real-thread regression target `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.
- The target thread can be running; active state/runtime refreshes are allowed, but token usage must not be repeatedly polled during the initial settle window.

#### Steps
1. Open `http://127.0.0.1:7420/#/thread/019f27ae-0ecd-7c50-9701-8ec003e66447` in a phone viewport.
2. Wait until the title `分析项目` and composer render.
3. Keep the page open for at least 9 seconds.
4. Inspect `performance.getEntriesByType('resource')` for `/codex-api/state/thread/<threadId>`, `/codex-api/runtime/thread/<threadId>`, and `/codex-api/thread-token-usage?threadId=<threadId>`.
5. Run `npm.cmd run verify:server-modules`.
6. Run `npm.cmd run verify:frontend-normalizers`.
7. Run `npm.cmd run build`.
8. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.cx-codex\config.json`.
9. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
10. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- If thread details are already loading or were just loaded, the notification stream first-connect path does not force an extra foreground recovery.
- Missing token usage in a thread snapshot does not clear existing token usage UI state.
- Background token usage fallback is throttled; the real thread page should issue at most one `/codex-api/thread-token-usage` request during the initial 9-second settle window.
- Running threads may continue lightweight state/runtime refreshes, but they should not trigger repeated slow token usage reads.

#### Rollback/Cleanup Notes
- To roll back, revert `src/composables/useDesktopState.ts`, `scripts/regression-7420-frontend.ps1`, `docs/changelog.zh-CN.md`, and this test section.
- No browser storage cleanup is required; token usage throttling is in-memory and resets on page reload.

#### Regression Evidence
- 2026-07-07 measurement before fix: the running real `分析项目` thread issued `6` `/codex-api/thread-token-usage` requests in the measured page window, with repeated requests around 2 seconds.
- 2026-07-07 measurement after fix: the same running real thread issued `1` `/codex-api/thread-token-usage` request in a 12-second page window while state/runtime refreshes continued.
- 2026-07-07 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`.
- 2026-07-07 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-07 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-07 deploy evidence: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.cx-codex\config.json` restarted local 7420 as PID `30008`, version `2.2.8`, and `/health` returned ok.
- 2026-07-07 sidebar data gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed; required thread `019f27ae-0ecd-7c50-9701-8ec003e66447` remained under project `codexui`.
- 2026-07-07 browser gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation-blocks fixture, and the real target thread phone route with the token usage request throttle assertion enabled.

### Feature: Persistent thread/list startup cache

#### Prerequisites
- Local 7420 can be restarted from the latest `E:\javaword\CXCodex\codexui` build.
- The standard real-thread regression target `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.
- `C:\Users\SW\.codex\web-thread-list-cache.json` is writable.

#### Steps
1. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.cx-codex\config.json`.
2. POST `/codex-api/rpc` with `method=thread/list` and params `{ archived:false, limit:100, sortKey:"updated_at", cursor:null }`.
3. Confirm `C:\Users\SW\.codex\web-thread-list-cache.json` exists and includes a `thread/list` entry.
4. Restart local 7420 again.
5. Immediately repeat the same logical `thread/list` request with the params fields in a different order.
6. Run `npm.cmd run verify:server-modules`.
7. Run `npm.cmd run verify:frontend-normalizers`.
8. Run `npm.cmd run build`.
9. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
10. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- The first uncached `thread/list` may still take several seconds because it comes from upstream App Server.
- After the cache file exists, a 7420 restart should reload the persisted list snapshot and return the same logical first-page active `thread/list` quickly while refreshing stale data in the background.
- `getShareableRpcKey()` treats logically identical params with different object field order as the same cache key.
- The sidebar data gate still finds `分析项目` under project `codexui`.

#### Rollback/Cleanup Notes
- To roll back, revert `src/server/appServerRpcCache.ts`, `src/server/codexPaths.ts`, `scripts/server-module-smoke.ts`, `docs/changelog.zh-CN.md`, and this test section.
- Optional cleanup: delete `C:\Users\SW\.codex\web-thread-list-cache.json`; the cache will be recreated on the next successful `thread/list`.

#### Regression Evidence
- 2026-07-07 measurement before fix: cold active `thread/list` took about `5.6s`, and cold archived first page took about `6.0s`; repeated in-memory requests returned in tens of milliseconds.
- 2026-07-07 measurement before canonical key fix: a persisted cache file existed, but restart still returned active `thread/list` in `5486ms` because equivalent params generated different JSON keys.
- 2026-07-07 measurement after fix: after writing the new canonical cache and restarting 7420, the same logical active `thread/list` returned in `240ms` with `120` rows.
- 2026-07-07 deploy: latest build was restarted on local 7420 as PID `5380`, version `2.2.8`, with `/health` returning `ok`.
- 2026-07-07 measurement after latest restart: active `thread/list` with equivalent reordered params returned in `90ms` with `120` rows and included `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目`.
- 2026-07-07 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`.
- 2026-07-07 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-07 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-07 gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed with `activeFirstPageCount=120`, `archivedFirstPageCount=100`, and required thread project `codexui`.
- 2026-07-07 gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, fixtures, and the real phone thread page.

### Feature: Defer settled thread detail refresh from first paint

#### Prerequisites
- Local 7420 can be rebuilt and restarted from `E:\javaword\CXCodex\codexui`.
- The real regression thread `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.
- Browser local storage may contain cached messages for recently opened threads.

#### Steps
1. Open a real thread that has either runtime snapshot messages or cached browser messages.
2. Confirm the conversation renders those available messages before any settled-state supplemental `thread/read(includeTurns:true)` finishes.
3. Keep the page open briefly and confirm the background refresh can still merge newer/fresher messages without dropping existing cached messages.
4. Run `npm.cmd run build`.
5. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
6. Run `npm.cmd run verify:frontend-normalizers`.
7. Run `npm.cmd run verify:server-modules`.
8. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
9. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- Initial non-silent thread loads do not block first paint on the settled-state supplemental RPC when snapshot/cache messages are already available.
- Silent/background refresh still performs the supplemental RPC and preserves prior messages if the returned fresh payload is shorter.
- The real `分析项目` phone thread page still renders without blank state or missing required thread data.

#### Rollback/Cleanup Notes
- To roll back, revert `src/composables/useDesktopState.ts`, `docs/changelog.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-07 deploy: latest build was restarted on local 7420 as PID `62184`, version `2.2.8`, with `/health` returning `ok`.
- 2026-07-07 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-07 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`.
- 2026-07-07 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-07 gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed with `activeFirstPageCount=120`, `archivedFirstPageCount=100`, and required thread project `codexui`.
- 2026-07-07 gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, fixtures, and the real phone thread page.

### Feature: Skip redundant thread message cache writes

#### Prerequisites
- Local 7420 can be rebuilt and restarted from `E:\javaword\CXCodex\codexui`.
- The real regression thread `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.
- Browser local storage is writable.

#### Steps
1. Open `分析项目` and let the initial message snapshot load.
2. Trigger repeated silent refreshes or wait for background sync to process the same thread again.
3. Confirm unchanged message snapshots do not force a new thread-message cache write, while changed snapshots still update the in-memory conversation and cache.
4. Run `npm.cmd run build`.
5. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
6. Run `npm.cmd run verify:frontend-normalizers`.
7. Run `npm.cmd run verify:server-modules`.
8. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
9. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- The first loaded snapshot for a thread still writes the browser message cache.
- Repeated syncs with the same normalized cache payload skip redundant `localStorage` writes.
- The real `分析项目` thread still renders and refreshes normally on phone viewport.

#### Rollback/Cleanup Notes
- To roll back, revert `src/composables/useDesktopState.ts`, `docs/changelog.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-07 measurement before fix: repeated `state/thread` reads for `分析项目` returned in `51-129ms`, and repeated `thread/read(includeTurns:true)` returned in `61-134ms`; the remaining risk was redundant client-side cache writes during repeated silent sync, not upstream read latency.
- 2026-07-07 deploy: latest build was restarted on local 7420 as PID `66328`, version `2.2.8`, with `/health` returning `ok`.
- 2026-07-07 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-07 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`.
- 2026-07-07 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-07 gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed with `activeFirstPageCount=120`, `archivedFirstPageCount=100`, and required thread project `codexui`.
- 2026-07-07 gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, fixtures, and the real phone thread page.

### Feature: Binary search virtual conversation range

#### Prerequisites
- Local 7420 can be rebuilt and restarted from `E:\javaword\CXCodex\codexui`.
- The real regression thread `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.
- The conversation regression fixture can render at desktop, phone, and foldable viewports.

#### Steps
1. Open a long conversation or the conversation regression fixture.
2. Scroll through the message list and reveal older messages.
3. Confirm the same messages remain visible as before, with no blank rows, jumpy spacer height, or broken return-to-bottom behavior.
4. Run `npm.cmd run build`.
5. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
6. Run `npm.cmd run verify:frontend-normalizers`.
7. Run `npm.cmd run verify:server-modules`.
8. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
9. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- Virtualized conversation range lookup uses binary search over cumulative heights instead of linear scanning.
- Desktop, phone, and foldable fixture pages still render nonblank conversation content.
- The real `分析项目` phone thread page still renders without missing messages or blank states.

#### Rollback/Cleanup Notes
- To roll back, revert `src/components/content/ThreadConversation.vue`, `docs/changelog.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-07 measurement before fix: `ThreadConversation.vue` already virtualized long conversations at `80` entries, but visible-range start/end were found with linear scans over cumulative heights during scroll.
- 2026-07-07 deploy: latest build was restarted on local 7420 as PID `66164`, version `2.2.8`, with `/health` returning `ok`.
- 2026-07-07 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-07 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`.
- 2026-07-07 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-07 gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed with `activeFirstPageCount=120`, `archivedFirstPageCount=100`, and required thread project `codexui`.
- 2026-07-07 gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation fixtures, and the real phone thread page.

### Feature: Defer desktop app status after thread first screen

#### Prerequisites
- Local 7420 can be rebuilt and restarted from `E:\javaword\CXCodex\codexui`.
- The real regression thread `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.
- Browser automation can open `http://127.0.0.1:7420/#/thread/019f27ae-0ecd-7c50-9701-8ec003e66447`.

#### Steps
1. Open the real `分析项目` thread on a phone viewport.
2. Inspect `performance.getEntriesByType('resource')` during the first 1.5-1.8 seconds after navigation.
3. Confirm `/codex-api/desktop-app/status` does not start during first-screen thread load.
4. Confirm the automatic desktop app availability check still runs later after the initial screen settles.
5. Confirm manual desktop refresh still calls `refreshDesktopAppAvailability()` immediately after refresh completion.
6. Run `npm.cmd run build`.
7. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
8. Run `npm.cmd run verify:frontend-normalizers`.
9. Run `npm.cmd run verify:server-modules`.
10. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
11. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- The phone thread page first-screen window has no `/codex-api/desktop-app/status` request.
- Desktop app availability remains available after startup idle time and after manual desktop refresh.
- The real `分析项目` phone thread page and conversation fixture remain nonblank.

#### Rollback/Cleanup Notes
- To roll back, revert `src/App.vue`, `scripts/regression-7420-frontend.ps1`, `docs/changelog.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-07 measurement before fix: opening the real `分析项目` phone thread page started `/codex-api/desktop-app/status` at about `770ms`; the request took about `1636ms`, making it the slowest first-screen non-core request in the 1800ms window.
- 2026-07-07 post-fix measurement: after rebuilding and restarting local 7420, the same phone thread page had `desktopStatusCount=0` within the first `1800ms`.
- 2026-07-07 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`; npm also printed a non-fatal update-check permission warning after exit code `0`.
- 2026-07-07 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-07 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-07 deploy: latest build was restarted on local 7420 as PID `35260`, version `2.2.8`, with `/health` returning `ok`.
- 2026-07-07 gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed with `activeFirstPageCount=120`, `archivedFirstPageCount=100`, and required thread project `codexui`.
- 2026-07-07 gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation fixtures, the real phone thread page, and the new first-screen desktop-app/status assertion.

### Feature: Deduplicate first-screen workspace roots state reads

#### Prerequisites
- Local 7420 can be rebuilt and restarted from `E:\javaword\CXCodex\codexui`.
- The real regression thread `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.
- Browser automation can open `http://127.0.0.1:7420/#/thread/019f27ae-0ecd-7c50-9701-8ec003e66447`.

#### Steps
1. Open the real `分析项目` thread on a phone viewport.
2. Inspect `performance.getEntriesByType('resource')` during the first 1.5 seconds after navigation.
3. Confirm duplicate `/codex-api/workspace-roots-state` reads are collapsed to one request during first-screen load.
4. Confirm `getWorkspaceRootsState()` reuses an in-flight request and returns cloned cached state for short repeated reads.
5. Confirm `setWorkspaceRootsState()`, successful `openProjectRoot()`, and successful `createWorktree()` clear the short workspace roots cache.
6. Run `npm.cmd run build`.
7. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
8. Run `npm.cmd run verify:frontend-normalizers`.
9. Run `npm.cmd run verify:server-modules`.
10. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
11. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- The phone thread page starts with at most one `/codex-api/workspace-roots-state` request during first-screen load.
- Workspace root order and labels still refresh correctly after startup and after project-root mutations.
- Cached workspace root state returned to callers is cloned, so local mutations cannot corrupt the cache.
- The real `分析项目` phone thread page and conversation fixture remain nonblank.

#### Rollback/Cleanup Notes
- To roll back, revert `src/api/codexGateway.ts`, `scripts/regression-7420-frontend.ps1`, `docs/changelog.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-07 measurement before fix: opening the real `分析项目` phone thread page produced `2` `/codex-api/workspace-roots-state` requests within `1500ms`.
- 2026-07-07 post-fix measurement: after rebuilding and restarting local 7420, the same phone thread page produced `1` `/codex-api/workspace-roots-state` request within `1500ms`.
- 2026-07-07 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`.
- 2026-07-07 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`; npm also printed a non-fatal update-check permission warning after exit code `0`.
- 2026-07-07 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-07 deploy: latest build was restarted on local 7420 as PID `52152`, version `2.2.8`, with `/health` returning `ok`.
- 2026-07-07 gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed with `activeFirstPageCount=120`, `archivedFirstPageCount=100`, and required thread project `codexui`.
- 2026-07-07 gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation fixtures, the real phone thread page, and the new first-screen workspace-roots-state duplicate assertion.

### Feature: Deduplicate first-screen project root suggestions

#### Prerequisites
- Local 7420 can be rebuilt and restarted from `E:\javaword\CXCodex\codexui`.
- The real regression thread `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.
- Browser automation can open `http://127.0.0.1:7420/#/thread/019f27ae-0ecd-7c50-9701-8ec003e66447`.

#### Steps
1. Open the real `分析项目` thread on a phone viewport.
2. Inspect `performance.getEntriesByType('resource')` during the first 1.2-1.5 seconds after navigation.
3. Confirm duplicate `/codex-api/project-root-suggestion?basePath=<same path>` requests are collapsed to a single request during first-screen load.
4. Confirm `getProjectRootSuggestion()` reuses the same in-flight promise for the same normalized `basePath`.
5. Confirm successful `openProjectRoot()` and `createWorktree()` clear the short suggestion cache.
6. Run `npm.cmd run build`.
7. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
8. Run `npm.cmd run verify:frontend-normalizers`.
9. Run `npm.cmd run verify:server-modules`.
10. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
11. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- The same project-root suggestion URL is requested at most once during first-screen thread load.
- New project default-name suggestions remain available after the initial screen settles.
- Opening or creating a project root clears the short suggestion cache so newly used project names are not held stale.
- The real `分析项目` phone thread page and conversation fixture remain nonblank.

#### Rollback/Cleanup Notes
- To roll back, revert `src/api/codexGateway.ts`, `scripts/regression-7420-frontend.ps1`, `docs/changelog.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-07 measurement before fix: opening the real `分析项目` phone thread page produced `7` identical `/codex-api/project-root-suggestion?basePath=E%3A%5Cjavaword` requests within `1200ms`.
- 2026-07-07 post-fix measurement: after rebuilding and restarting local 7420, the same phone thread page produced `1` `/codex-api/project-root-suggestion?basePath=E%3A%5Cjavaword` request within `1200ms`.
- 2026-07-07 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`; npm also printed a non-fatal update-check permission warning after exit code `0`.
- 2026-07-07 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-07 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-07 deploy: latest build was restarted on local 7420 as PID `60560`, version `2.2.8`, with `/health` returning `ok`.
- 2026-07-07 gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed with `activeFirstPageCount=120`, `archivedFirstPageCount=100`, and required thread project `codexui`.
- 2026-07-07 gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation fixtures, the real phone thread page, and the new first-screen project-root-suggestion duplicate assertion.

### Feature: Defer thread token usage refresh after first screen

#### Prerequisites
- Local 7420 can be rebuilt and restarted from `E:\javaword\CXCodex\codexui`.
- The real regression thread `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.
- Browser automation can open `http://127.0.0.1:7420/#/thread/019f27ae-0ecd-7c50-9701-8ec003e66447`.

#### Steps
1. Open the real `分析项目` thread on a phone viewport.
2. Inspect `performance.getEntriesByType('resource')` during the first 1.5 seconds after navigation.
3. Confirm `/codex-api/state/thread/<threadId>` and required RPC/runtime requests can run for the message surface.
4. Confirm `/codex-api/thread-token-usage?threadId=<threadId>` is not started immediately during the first-screen message load.
5. Wait a few more seconds and confirm token usage can still refresh in the background when no token usage is already present.
6. Run `npm.cmd run build`.
7. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
8. Run `npm.cmd run verify:frontend-normalizers`.
9. Run `npm.cmd run verify:server-modules`.
10. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
11. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- Thread messages and runtime state remain the first-screen priority.
- Token usage refresh is delayed and deduped instead of competing with initial thread detail rendering.
- Existing token usage values, in-flight requests, and retry throttling are still respected.
- The real `分析项目` phone thread page and conversation fixture remain nonblank.

#### Rollback/Cleanup Notes
- To roll back, revert `src/composables/useDesktopState.ts`, `docs/changelog.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-07 measurement before fix: opening the real `分析项目` thread produced 11 relevant `/codex-api/` resource entries in 5 seconds; `/codex-api/thread-token-usage?threadId=019f27ae-0ecd-7c50-9701-8ec003e66447` took about `2760ms`, making it the slowest non-core first-screen request.
- 2026-07-07 post-fix measurement: after rebuilding and restarting local 7420, opening the same phone thread page produced `tokenUsageCount=0` in the first `1200ms`, confirming token usage no longer starts during first-screen thread load.
- 2026-07-07 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`; npm also printed a non-fatal update-check permission warning after exit code `0`.
- 2026-07-07 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-07 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-07 deploy: latest build was restarted on local 7420 as PID `27484`, version `2.2.8`, with `/health` returning `ok`.
- 2026-07-07 gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed with `activeFirstPageCount=120`, `archivedFirstPageCount=100`, and required thread project `codexui`.
- 2026-07-07 gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation fixtures, and the real phone thread page.

### Feature: Explain recent-only long thread payloads

#### Prerequisites
- Local 7420 can be rebuilt and restarted from `E:\javaword\CXCodex\codexui`.
- Server module smoke can exercise `trimThreadTurnsInRpcResult()`.
- Frontend normalizer smoke can exercise `normalizeThreadMessagesV2()`.
- The real regression thread `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.

#### Steps
1. Prepare a `thread/read` style payload with more than the service-side turn limit.
2. Pass it through `trimThreadTurnsInRpcResult('thread/read', payload)`.
3. Confirm the trimmed thread keeps the latest turns and includes `turnsView: 'recent'` plus `originalTurnsCount`.
4. Pass a recent-view thread payload through `normalizeThreadMessagesV2()`.
5. Confirm the first rendered message is a lightweight `history.notice` system message, not an unhandled raw payload card.
6. Run `npm.cmd run build`.
7. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
8. Run `npm.cmd run verify:frontend-normalizers`.
9. Run `npm.cmd run verify:server-modules`.
10. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
11. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- Long `thread/read`, `thread/resume`, `thread/fork`, and `thread/rollback` results still return only the recent turn window for performance.
- Trimmed thread payloads expose enough metadata for the UI to explain that older turns were folded for smoothness.
- The UI notice uses `messageType: history.notice` without `rawPayload` or `isUnhandled`.
- Existing per-turn item trimming, low-value item filtering, visible messages, and unknown item raw payload fallback remain unchanged.
- The real `分析项目` phone thread page and conversation fixture remain nonblank.

#### Rollback/Cleanup Notes
- To roll back, revert `src/server/appServerRpcResult.ts`, `src/api/normalizers/v2.ts`, `scripts/server-module-smoke.ts`, `scripts/verify-frontend-normalizers.mjs`, `docs/changelog.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-07 measurement before fix: server-side turn trimming kept only recent turns but did not expose `turnsView` / `originalTurnsCount`, so the frontend could not distinguish performance folding from missing history.
- 2026-07-07 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`; coverage confirms turn-level trimming now returns `turnsView: recent` and `originalTurnsCount`.
- 2026-07-07 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`; coverage confirms `history.notice` is inserted without `rawPayload` or `isUnhandled`.
- 2026-07-07 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-07 deploy: latest build was restarted on local 7420 as PID `68004`, version `2.2.8`, with `/health` returning `ok`.
- 2026-07-07 gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed with `activeFirstPageCount=120`, `archivedFirstPageCount=100`, and required thread project `codexui`.
- 2026-07-07 gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation fixtures, and the real phone thread page.

### Feature: Lazy prepare long code block lines

#### Prerequisites
- Local 7420 can be rebuilt and restarted from `E:\javaword\CXCodex\codexui`.
- Conversation regression fixture includes code and diff blocks.
- The real regression thread `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.

#### Steps
1. Open a conversation containing a long fenced code block.
2. Confirm collapsed long code blocks show the preview line count and hidden-line count.
3. Click the code block expand control and confirm the full code appears.
4. Copy the code block and confirm the copied text is the full original code, not only preview lines.
5. Run `npm.cmd run build`.
6. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
7. Run `npm.cmd run verify:frontend-normalizers`.
8. Run `npm.cmd run verify:server-modules`.
9. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
10. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- Long code blocks prepare only preview lines before expansion.
- Expanding a long code block prepares and renders full lines on demand.
- Copying a code block still copies the full original code text.
- The real `分析项目` phone thread page and conversation fixture remain nonblank.

#### Rollback/Cleanup Notes
- To roll back, revert `src/components/content/ThreadConversation.vue`, `docs/changelog.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-07 measurement before fix: code blocks were only visually previewed to `120` lines, but `prepareCodeBlock()` still split and converted every line into prepared line objects before first render.
- 2026-07-07 deploy: latest build was restarted on local 7420 as PID `46420`, version `2.2.8`, with `/health` returning `ok`.
- 2026-07-07 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-07 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`.
- 2026-07-07 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-07 gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed with `activeFirstPageCount=120`, `archivedFirstPageCount=100`, and required thread project `codexui`.
- 2026-07-07 gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation fixtures, and the real phone thread page.

### Feature: Render one table layout per viewport

#### Prerequisites
- Local 7420 can be rebuilt and restarted from `E:\javaword\CXCodex\codexui`.
- Conversation regression fixture includes Markdown table content.
- The real regression thread `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.

#### Steps
1. Open a conversation containing a Markdown table on desktop width.
2. Confirm the table renders as a horizontal table and no mobile table-card DOM is mounted for that table.
3. Open the same content on phone width.
4. Confirm the table renders as stacked mobile cards and no desktop table-scroll DOM is mounted for that table.
5. Run `npm.cmd run build`.
6. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
7. Run `npm.cmd run verify:frontend-normalizers`.
8. Run `npm.cmd run verify:server-modules`.
9. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
10. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- Desktop viewport mounts only `.message-table-scroll` for table blocks.
- Phone viewport mounts only `.message-table-cards` for table blocks.
- Switching viewport updates the rendered table representation without breaking the conversation.
- The real `分析项目` phone thread page and conversation fixture remain nonblank.

#### Rollback/Cleanup Notes
- To roll back, revert `src/components/content/ThreadConversation.vue`, `docs/changelog.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-07 deploy: latest build was restarted on local 7420 as PID `66608`, version `2.2.8`, with `/health` returning `ok`.
- 2026-07-07 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-07 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`.
- 2026-07-07 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-07 gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed with `activeFirstPageCount=120`, `archivedFirstPageCount=100`, and required thread project `codexui`.
- 2026-07-07 gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation fixtures, and the real phone thread page; the conversation fixture now asserts desktop/foldable viewports mount only table-scroll DOM and phone viewport mounts only table-card DOM.

### Feature: Bound prepared message block cache

#### Prerequisites
- Local 7420 can be rebuilt and restarted from `E:\javaword\CXCodex\codexui`.
- A long real thread such as `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.
- Conversation regression fixture includes Markdown text, code, diff, file cards, raw payload, and table content.

#### Steps
1. Open a long conversation on phone width.
2. Use `继续查看更多` or scroll upward to reveal older messages, then scroll back to the latest messages.
3. Repeat the reveal/scroll cycle enough to touch more than 80 message cards.
4. Confirm old messages can still render again when revisited, but prepared Markdown/code/table blocks do not remain unbounded in memory.
5. Run `npm.cmd run build`.
6. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
7. Run `npm.cmd run verify:frontend-normalizers`.
8. Run `npm.cmd run verify:server-modules`.
9. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
10. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- Prepared message block cache is capped with LRU eviction instead of growing for every previously viewed message in a long thread.
- Revisited messages are reparsed when needed and still render correctly.
- Expanded long code block state and long prompt expanded/collapsed state remain independent of the parsed block cache.
- The real `分析项目` phone thread page and conversation fixture remain nonblank.

#### Rollback/Cleanup Notes
- To roll back, revert `src/components/content/ThreadConversation.vue`, `docs/changelog.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-07 measurement before fix: `preparedMessageBlocksById` only removed messages that disappeared from the thread; repeatedly revealing or scrolling old history could keep every previously parsed Markdown/code/table message block resident for the lifetime of the component.
- 2026-07-07 deploy: latest build was restarted on local 7420 as PID `69492`, version `2.2.8`, with `/health` returning `ok`.
- 2026-07-07 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-07 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`.
- 2026-07-07 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-07 gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed with `activeFirstPageCount=120`, `archivedFirstPageCount=100`, and required thread project `codexui`.
- 2026-07-07 gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation fixtures, and the real phone thread page.

### Feature: Lazy render raw payload preview

#### Prerequisites
- Local 7420 can be rebuilt and restarted from `E:\javaword\CXCodex\codexui`.
- Conversation regression fixture includes a raw payload card.
- The real regression thread `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.

#### Steps
1. Open a conversation containing a raw payload / unhandled App Server item on phone width.
2. Confirm the structured raw payload card renders only its summary while collapsed.
3. Confirm the raw payload preview `<pre>` content is not mounted until the card is expanded.
4. Expand the card and confirm the pretty/raw preview is rendered and still inspectable.
5. Switch away from the thread and back to confirm expanded raw payload state does not leak across thread changes.
6. Run `npm.cmd run build`.
7. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
8. Run `npm.cmd run verify:frontend-normalizers`.
9. Run `npm.cmd run verify:server-modules`.
10. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
11. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- Collapsed raw payload cards do not call/render heavy JSON pretty preview content.
- Expanding the card renders the preview content on demand.
- The regression fixture explicitly verifies the raw marker is absent before expand and present after expand.
- The real `分析项目` phone thread page and conversation fixture remain nonblank.

#### Rollback/Cleanup Notes
- To roll back, revert `src/components/content/ThreadConversation.vue`, `scripts/regression-7420-frontend.ps1`, `docs/changelog.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-07 measurement before fix: collapsed raw payload `<details>` still mounted `.message-structured-pre`, causing `rawPayloadPreview()` to trim / parse / pretty stringify raw JSON even when the user never expanded the diagnostic card.
- 2026-07-07 deploy: latest build was restarted on local 7420 as PID `67780`, version `2.2.8`, with `/health` returning `ok`.
- 2026-07-07 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-07 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`.
- 2026-07-07 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-07 gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed with `activeFirstPageCount=120`, `archivedFirstPageCount=100`, and required thread project `codexui`.
- 2026-07-07 gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation fixtures, and the real phone thread page; the conversation fixture now asserts raw payload marker/pre content is absent before card expansion and present after expansion.

### Feature: Lazy mount collapsed command output

#### Prerequisites
- Local 7420 can be rebuilt and restarted from `E:\javaword\CXCodex\codexui`.
- Conversation regression fixture includes a completed command execution block.
- The real regression thread `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.

#### Steps
1. Open a conversation containing completed command execution output on phone width.
2. Confirm the completed command row is collapsed by default and shows status, duration, and command label.
3. Confirm the command output `<pre>` text is not mounted while the completed command is collapsed.
4. Expand the command row and confirm the output text mounts and remains readable.
5. Confirm running command output still renders while the command is in progress.
6. Run `npm.cmd run build`.
7. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
8. Run `npm.cmd run verify:frontend-normalizers`.
9. Run `npm.cmd run verify:server-modules`.
10. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
11. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- Collapsed completed command blocks do not mount `.cmd-output` pre content.
- Expanded or running command blocks mount output on demand.
- The regression fixture explicitly verifies the command output marker is absent before expand and present after expand.
- The real `分析项目` phone thread page and conversation fixture remain nonblank.

#### Rollback/Cleanup Notes
- To roll back, revert `src/components/content/ThreadConversation.vue`, `scripts/regression-7420-frontend.ps1`, `docs/changelog.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-07 measurement before fix: completed command blocks were visually collapsed but still mounted `.cmd-output` `<pre>` content, so historical command logs stayed in the DOM even when users only saw the one-line command row.
- 2026-07-07 deploy: latest build was restarted on local 7420 as PID `65156`, version `2.2.8`, with `/health` returning `ok`.
- 2026-07-07 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-07 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`.
- 2026-07-07 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-07 gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed with `activeFirstPageCount=120`, `archivedFirstPageCount=100`, and required thread project `codexui`.
- 2026-07-07 gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation fixtures, and the real phone thread page; the conversation fixture now asserts command output marker/pre content is absent before command expansion and present after expansion.

### Feature: Cache estimated message heights

#### Prerequisites
- Local 7420 can be rebuilt and restarted from `E:\javaword\CXCodex\codexui`.
- A long real thread such as `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.
- Conversation regression fixture includes normal messages, command execution, Markdown images or text blocks, and collapsible content.

#### Steps
1. Open a long conversation on phone width.
2. Reveal older messages in multiple chunks with `继续查看更多`.
3. Scroll through the revealed history and back to the latest messages.
4. Expand and collapse a long prompt or command output, then scroll again.
5. Confirm the virtual list keeps stable spacer heights, no blank rows appear, and scroll anchoring remains stable.
6. Run `npm.cmd run build`.
7. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
8. Run `npm.cmd run verify:frontend-normalizers`.
9. Run `npm.cmd run verify:server-modules`.
10. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
11. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- Unmeasured message height estimates are reused by message id, source content, and relevant expanded/collapsed state.
- The estimate cache is bounded and pruned when messages leave the thread or the active thread changes.
- Expanding commands or long prompts invalidates the relevant estimate signature and updates layout normally.
- The real `分析项目` phone thread page and conversation fixture remain nonblank.

#### Rollback/Cleanup Notes
- To roll back, revert `src/components/content/ThreadConversation.vue`, `docs/changelog.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-07 measurement before fix: `estimateConversationEntryHeight()` called `estimateMessageHeight()` directly for every unmeasured visible entry, which re-trimmed/split long text and re-scanned Markdown image syntax when older history was revealed before real DOM heights were measured.
- 2026-07-07 deploy: latest build was restarted on local 7420 as PID `19872`, version `2.2.8`, with `/health` returning `ok`.
- 2026-07-07 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-07 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`.
- 2026-07-07 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-07 gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed with `activeFirstPageCount=120`, `archivedFirstPageCount=100`, and required thread project `codexui`.
- 2026-07-07 gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation fixtures, and the real phone thread page.

### Feature: Reuse thread message cache snapshot

#### Prerequisites
- Local 7420 can be rebuilt and restarted from `E:\javaword\CXCodex\codexui`.
- Browser local storage is writable.
- The real regression thread `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.

#### Steps
1. Open `分析项目` and let the first message snapshot render.
2. Trigger a normal foreground refresh or silent background sync for the same thread.
3. Confirm the thread message cache still stores the latest trimmed message snapshot and the visible conversation remains intact.
4. Confirm unchanged snapshots still skip redundant `localStorage` writes.
5. Run `npm.cmd run build`.
6. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
7. Run `npm.cmd run verify:frontend-normalizers`.
8. Run `npm.cmd run verify:server-modules`.
9. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
10. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- Cache signature comparison and cache writes reuse the same normalized message snapshot during one sync pass.
- Thread message cache format remains unchanged.
- Reopening a cached thread still renders cached content first and then refreshes normally.
- The real `分析项目` phone thread page and conversation fixture remain nonblank.

#### Rollback/Cleanup Notes
- To roll back, revert `src/composables/useDesktopState.ts`, `docs/changelog.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-07 measurement before fix: `setPersistedMessagesForThread()` called `getCachedThreadMessagesSignature(nextMessages)` and then `saveCachedThreadMessages(threadId, nextMessages)`, causing the same recent-message cache normalization work to run twice whenever a cache write was needed.
- 2026-07-07 deploy: latest build was restarted on local 7420 as PID `67656`, version `2.2.8`, with `/health` returning `ok`.
- 2026-07-07 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-07 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`.
- 2026-07-07 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-07 gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed with `activeFirstPageCount=120`, `archivedFirstPageCount=100`, and required thread project `codexui`.
- 2026-07-07 gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation fixtures, and the real phone thread page.

### Feature: Filter fileChange before message normalization

#### Prerequisites
- Local 7420 can be rebuilt and restarted from `E:\javaword\CXCodex\codexui`.
- The frontend normalizer smoke can run through `npm.cmd run verify:frontend-normalizers`.
- The real regression thread `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.

#### Steps
1. Open or synthesize a thread payload that includes App Server `fileChange` turn items.
2. Normalize the payload with `normalizeThreadMessagesV2()`.
3. Confirm `fileChange` items do not produce `unhandled.fileChange` messages and do not leave large raw payload text in normalized messages.
4. Confirm other unknown App Server items still produce structured `unhandled.<type>` raw payload fallback messages.
5. Run `npm.cmd run build`.
6. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
7. Run `npm.cmd run verify:frontend-normalizers`.
8. Run `npm.cmd run verify:server-modules`.
9. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
10. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- `fileChange` items are filtered in `src/api/normalizers/v2.ts` before raw payload serialization.
- The existing unknown-item fallback remains intact for unsupported useful App Server item types.
- Long mobile thread detail loads have less normalized-message and raw JSON payload pressure when tasks generate many file change events.
- The real `分析项目` phone thread page and conversation fixture remain nonblank.

#### Rollback/Cleanup Notes
- To roll back, revert `src/api/normalizers/v2.ts`, `scripts/verify-frontend-normalizers.mjs`, `docs/changelog.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-07 measurement before fix: `fileChange` items were eventually hidden by `ThreadConversation.vue`, but `normalizeThreadMessagesV2()` still converted them into `unhandled.fileChange` messages and serialized the full item into `rawPayload` first.
- 2026-07-07 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`; the smoke now asserts `fileChange` does not produce `unhandled.fileChange` or retain the synthetic raw patch marker, while another unknown item still keeps raw payload fallback.
- 2026-07-07 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-07 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`.
- 2026-07-07 deploy: latest build was restarted on local 7420 as PID `54540`, version `2.2.8`, with `/health` returning `ok`.
- 2026-07-07 gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed with `activeFirstPageCount=120`, `archivedFirstPageCount=100`, and required thread project `codexui`.
- 2026-07-07 gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation fixtures, and the real phone thread page.

### Feature: Pre-filter session-log fallback parse candidates

#### Prerequisites
- Local 7420 can be rebuilt and restarted from `E:\javaword\CXCodex\codexui`.
- A malformed or non-standard session log can trigger local session-log fallback, or server module smoke can validate the parser directly.
- The real regression thread `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.

#### Steps
1. Prepare a session jsonl tail that contains many non-message events such as `fileChange`, plus valid `session_meta`, `response_item`, and `event_msg` records.
2. Parse it through `parseThreadReadFromSessionLog()`.
3. Confirm non-message event lines are skipped before JSON parsing and do not affect recovered thread messages.
4. Confirm recovered user/assistant messages, preview, title, cwd, repeated user turns, and tail-bounded behavior remain unchanged.
5. Run `npm.cmd run build`.
6. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
7. Run `npm.cmd run verify:frontend-normalizers`.
8. Run `npm.cmd run verify:server-modules`.
9. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
10. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- Session-log fallback only JSON-parses candidate `session_meta`, `response_item`, and `event_msg` lines.
- Non-candidate file-change/noise lines do not enter message recovery and do not change recovered content.
- Malformed or non-standard real threads still recover recent user/assistant history instead of showing internal App Server read errors.
- The real `分析项目` phone thread page and conversation fixture remain nonblank.

#### Rollback/Cleanup Notes
- To roll back, revert `src/server/appServerSessionLogThreadRead.ts`, `scripts/server-module-smoke.ts`, `docs/changelog.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-07 measurement before fix: `parseThreadReadFromSessionLog()` read only the tail-bounded session log range, but still called `JSON.parse()` for every non-empty line before discarding unrelated `fileChange` / notification / diagnostic records.
- 2026-07-07 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`; coverage includes candidate-line checks plus a session-log fixture with 40 ignored `fileChange` records before recovered messages.
- 2026-07-07 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-07 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-07 deploy: latest build was restarted on local 7420 as PID `38540`, version `2.2.8`, with `/health` returning `ok`.
- 2026-07-07 gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed with `activeFirstPageCount=120`, `archivedFirstPageCount=100`, and required thread project `codexui`.
- 2026-07-07 gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation fixtures, and the real phone thread page.

### Feature: Filter fileChange from thread/read RPC payload

#### Prerequisites
- Local 7420 can be rebuilt and restarted from `E:\javaword\CXCodex\codexui`.
- Server module smoke can exercise `trimThreadTurnsInRpcResult()`.
- The real regression thread `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.

#### Steps
1. Prepare a `thread/read` style payload whose turn items include a low-value `fileChange` item, another unknown item, and a normal assistant message.
2. Pass the payload through `trimThreadTurnsInRpcResult('thread/read', payload)`.
3. Confirm the `fileChange` item and its large patch text are absent from the trimmed result.
4. Confirm other unknown item types still remain in the result for diagnostic fallback.
5. Run `npm.cmd run build`.
6. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
7. Run `npm.cmd run verify:frontend-normalizers`.
8. Run `npm.cmd run verify:server-modules`.
9. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
10. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- `thread/read`, `thread/resume`, `thread/fork`, and `thread/rollback` results remove `fileChange` turn items before being returned to the frontend.
- Existing turn count and per-turn item count limits remain in effect.
- Unknown useful items still survive so raw payload fallback can expose new App Server protocol content.
- The real `分析项目` phone thread page and conversation fixture remain nonblank.

#### Rollback/Cleanup Notes
- To roll back, revert `src/server/appServerRpcResult.ts`, `scripts/server-module-smoke.ts`, `docs/changelog.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-07 measurement before fix: frontend normalization already discarded `fileChange`, but `/codex-api/rpc thread/read(includeTurns:true)` still returned those items to the browser and cached payload first.
- 2026-07-07 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`; coverage confirms `fileChange` patch payload is absent after `trimThreadTurnsInRpcResult()` while an unknown `threadShellCommandOutput` item remains.
- 2026-07-07 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-07 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-07 deploy: latest build was restarted on local 7420 as PID `27396`, version `2.2.8`, with `/health` returning `ok`.
- 2026-07-07 gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed with `activeFirstPageCount=120`, `archivedFirstPageCount=100`, and required thread project `codexui`.
- 2026-07-07 gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation fixtures, and the real phone thread page.

### Feature: Filter mcpToolCall from thread/read RPC payload

#### Prerequisites
- Local 7420 can be rebuilt and restarted from `E:\javaword\CXCodex\codexui`.
- Server module smoke can exercise `trimThreadTurnsInRpcResult()`.
- The real regression thread `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.

#### Steps
1. Prepare a `thread/read` style payload whose turn items include a historical `mcpToolCall` item, another unknown item, and a normal assistant message.
2. Pass the payload through `trimThreadTurnsInRpcResult('thread/read', payload)`.
3. Confirm the `mcpToolCall` item and its internal result text are absent from the trimmed result.
4. Confirm other unknown item types still remain in the result for diagnostic fallback.
5. Run `npm.cmd run build`.
6. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
7. Run `npm.cmd run verify:frontend-normalizers`.
8. Run `npm.cmd run verify:server-modules`.
9. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
10. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- `thread/read`, `thread/resume`, `thread/fork`, and `thread/rollback` results remove historical `mcpToolCall` turn items before being returned to the frontend.
- Existing low-value `fileChange` filtering and turn/item limits remain in effect.
- Unknown useful items still survive so raw payload fallback can expose new App Server protocol content.
- Realtime running state and server request handling are unchanged because this only trims completed thread payloads.
- The real `分析项目` phone thread page and conversation fixture remain nonblank.

#### Rollback/Cleanup Notes
- To roll back, revert `src/server/appServerRpcResult.ts`, `scripts/server-module-smoke.ts`, `docs/changelog.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-07 measurement before fix: frontend normalization already discarded historical `mcpToolCall`, but `/codex-api/rpc thread/read(includeTurns:true)` still returned those internal tool-call payloads to the browser and cached payload first.
- 2026-07-07 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`; coverage confirms `mcpToolCall` internal result text is absent after `trimThreadTurnsInRpcResult()` while an unknown `threadShellCommandOutput` item remains.
- 2026-07-07 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-07 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-07 deploy: latest build was restarted on local 7420 as PID `29176`, version `2.2.8`, with `/health` returning `ok`.
- 2026-07-07 gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed with `activeFirstPageCount=120`, `archivedFirstPageCount=100`, and required thread project `codexui`.
- 2026-07-07 gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation fixtures, and the real phone thread page.

### Feature: Filter reasoning from thread/read RPC payload

#### Prerequisites
- Local 7420 can be rebuilt and restarted from `E:\javaword\CXCodex\codexui`.
- Server module smoke can exercise `trimThreadTurnsInRpcResult()`.
- The real regression thread `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.

#### Steps
1. Prepare a `thread/read` style payload whose turn items include a historical `reasoning` item, another unknown item, and a normal assistant message.
2. Pass the payload through `trimThreadTurnsInRpcResult('thread/read', payload)`.
3. Confirm the `reasoning` item and its internal text are absent from the trimmed result.
4. Confirm other unknown item types still remain in the result for diagnostic fallback.
5. Run `npm.cmd run build`.
6. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
7. Run `npm.cmd run verify:frontend-normalizers`.
8. Run `npm.cmd run verify:server-modules`.
9. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
10. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- `thread/read`, `thread/resume`, `thread/fork`, and `thread/rollback` results remove historical `reasoning` turn items before being returned to the frontend.
- Existing low-value `fileChange` / `mcpToolCall` filtering and turn/item limits remain in effect.
- Unknown useful items still survive so raw payload fallback can expose new App Server protocol content.
- Realtime running state and visible assistant/user messages are unchanged because this only trims completed thread payloads.
- The real `分析项目` phone thread page and conversation fixture remain nonblank.

#### Rollback/Cleanup Notes
- To roll back, revert `src/server/appServerRpcResult.ts`, `scripts/server-module-smoke.ts`, `docs/changelog.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-07 measurement before fix: frontend normalization already discarded historical `reasoning`, but 69 sampled July session logs all contained reasoning records with 11238 matching lines, making it a common payload pressure source before server-side trimming.
- 2026-07-07 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`; coverage confirms `reasoning` internal text is absent after `trimThreadTurnsInRpcResult()` while an unknown `threadShellCommandOutput` item remains.
- 2026-07-07 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-07 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-07 deploy: latest build was restarted on local 7420 as PID `36876`, version `2.2.8`, with `/health` returning `ok`.
- 2026-07-07 gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed with `activeFirstPageCount=120`, `archivedFirstPageCount=100`, and required thread project `codexui`.
- 2026-07-07 gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation fixtures, and the real phone thread page.

### Feature: Avoid duplicate foreground recovery message refresh

#### Prerequisites
- Local 7420 can be rebuilt and restarted from `E:\javaword\CXCodex\codexui`.
- A thread has already loaded fresh details in the current browser session.
- The real regression thread `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.

#### Steps
1. Open a settled thread and wait for the first detail load to finish.
2. Trigger foreground recovery through focus/pageshow/Android resume, or let the regression browser open the real phone thread page.
3. Confirm a thread that is recently fresh, not running, not stale, and has no unread event, queue, or pending server request does not get repeated heavy message refreshes from recovery retries.
4. Confirm running/stale/unloaded/queued threads still schedule message refresh during foreground recovery.
5. Run `npm.cmd run build`.
6. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
7. Run `npm.cmd run verify:frontend-normalizers`.
8. Run `npm.cmd run verify:server-modules`.
9. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
10. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- Foreground and Android resume recovery still refresh messages when the selected thread is running, stale, unread, not loaded, queued, or waiting on server requests.
- Recently fresh settled threads skip duplicate recovery retry message refreshes within the active detail sync interval.
- Missed notifications replay can still mark the active thread for refresh before `syncThreadStatus()` runs.
- The real `分析项目` phone thread page remains nonblank and can be opened after the change.

#### Rollback/Cleanup Notes
- To roll back, revert `src/composables/useDesktopState.ts`, `docs/changelog.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-07 measurement before fix: `runForegroundRecoverySync()` always added the selected thread to `pendingThreadMessageRefresh` and forced message refresh whenever a thread was active, while Android resume retries also set `forceMessageRefresh` for any active thread.
- 2026-07-07 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`.
- 2026-07-07 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-07 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-07 deploy: latest build was restarted on local 7420 as PID `59520`, version `2.2.8`, with `/health` returning `ok`.
- 2026-07-07 gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed with `activeFirstPageCount=120`, `archivedFirstPageCount=100`, and required thread project `codexui`.
- 2026-07-07 gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation fixtures, and the real phone thread page.

### Feature: Load full history from recent thread notice

#### Prerequisites
- Local 7420 can be rebuilt and restarted from `E:\javaword\CXCodex\codexui`.
- A long thread can return `turnsView: recent` / `originalTurnsCount` from service-side trimming.
- The real regression thread `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.

#### Steps
1. Open a long thread that shows the lightweight `history.notice` message.
2. Click `加载较早历史`.
3. Confirm the frontend calls `thread/read` with local `responseView: 'full'`.
4. Confirm the bridge strips `responseView` before forwarding to App Server and skips service-side turn trimming for that request.
5. Confirm the full-history request does not write the large response into the service-side thread-read cache.
6. Confirm normal thread switching and background sync still use the default recent turn window.
7. Run `npm.cmd run build`.
8. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
9. Run `npm.cmd run verify:frontend-normalizers`.
10. Run `npm.cmd run verify:server-modules`.
11. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
12. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- Default thread detail loading remains lightweight and recent-first.
- `history.notice` provides a compact, mobile-friendly way to request older history only when needed.
- Full-history requests preserve all turns returned by App Server while still retaining low-level RPC error handling.
- Full-history requests do not pollute the service-side thread-read cache with large payloads.
- The real `分析项目` phone thread page and conversation fixture remain nonblank.

#### Rollback/Cleanup Notes
- To roll back, revert `src/server/appServerRpcResult.ts`, `src/server/rpcProxyRoute.ts`, `src/api/codexGateway.ts`, `src/composables/useDesktopState.ts`, `src/App.vue`, `src/components/content/ThreadConversation.vue`, `scripts/server-module-smoke.ts`, `docs/changelog.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-07 measurement before fix: recent-window history notices explained folded turns but had no action path to retrieve the older turns on demand.
- 2026-07-07 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`; coverage confirms `preserveFullTurns` keeps all turns when full history is explicitly requested.
- 2026-07-07 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-07 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-07 deploy: latest build was restarted on local 7420 as PID `26500`, version `2.2.8`, with `/health` returning `ok`.
- 2026-07-07 gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed with `activeFirstPageCount=120`, `archivedFirstPageCount=100`, and required thread project `codexui`.
- 2026-07-07 gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation fixtures, and the real phone thread page.

### Feature: Load older history in bounded turn windows

#### Prerequisites
- Local 7420 can be rebuilt and restarted from `E:\javaword\CXCodex\codexui`.
- A long thread can return `turnsView: recent` / `turnsStartIndex` from service-side trimming.
- The real regression thread `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.

#### Steps
1. Open a long thread whose current recent window starts after turn 0.
2. Click `加载较早历史`.
3. Confirm the frontend requests `thread/read` with local `responseView: older`, `beforeTurnIndex`, and optional `turnLimit`.
4. Confirm the bridge strips those local fields before forwarding to App Server.
5. Confirm the bridge returns only the older turn window before the current earliest loaded turn, not the full thread.
6. Confirm normalized messages use absolute `turnIndex`, so older messages are merged before the recent window.
7. Confirm default thread switching and background sync still use recent-window loading.
8. Run `npm.cmd run build`.
9. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
10. Run `npm.cmd run verify:frontend-normalizers`.
11. Run `npm.cmd run verify:server-modules`.
12. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
13. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- `加载较早历史` retrieves one bounded older turn window at a time.
- Older-window requests do not pollute the service-side thread-read cache.
- The history notice remains at the top and updates as earlier windows are loaded.
- Existing full-history support remains available internally, but the user-facing action avoids full browser payload by default.
- The real `分析项目` phone thread page and conversation fixture remain nonblank.

#### Rollback/Cleanup Notes
- To roll back, revert `src/server/appServerRpcResult.ts`, `src/server/rpcProxyRoute.ts`, `src/api/normalizers/v2.ts`, `src/api/codexGateway.ts`, `src/composables/useDesktopState.ts`, `src/App.vue`, `src/components/content/ThreadConversation.vue`, `scripts/server-module-smoke.ts`, `scripts/verify-frontend-normalizers.mjs`, `docs/changelog.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-07 measurement before fix: `加载较早历史` used a full-history path, so clicking it could push the entire long thread payload to the browser at once.
- 2026-07-07 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`; coverage confirms recent windows expose `turnsStartIndex` and older-window requests return only the bounded preceding turn slice.
- 2026-07-07 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`; coverage confirms recent and older notices keep stable ids and absolute `turnIndex` values.
- 2026-07-07 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-07 deploy: latest build was restarted on local 7420 as PID `55320`, version `2.2.8`, with `/health` returning `ok`.
- 2026-07-07 gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed with `activeFirstPageCount=120`, `archivedFirstPageCount=100`, and required thread project `codexui`.
- 2026-07-07 gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation fixtures, and the real phone thread page.

### Feature: Defer cached sidebar refresh after first thread screen

#### Prerequisites
- Local 7420 can be rebuilt and restarted from `E:\javaword\CXCodex\codexui`.
- The browser has a cached sidebar thread group snapshot.
- The real regression thread `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.

#### Steps
1. Open the real thread route `http://127.0.0.1:7420/#/thread/019f27ae-0ecd-7c50-9701-8ec003e66447` in a fresh browser context.
2. Capture `/codex-api/rpc` request timing for at least 10 seconds.
3. Confirm cached sidebar content can render immediately without waiting for `thread/list`.
4. Confirm the first `thread/list` request starts after the cached background delay instead of immediately after cache hydration.
5. Confirm manual refresh or an uncached start still performs an immediate network thread list refresh.
6. Run `npm.cmd run build`.
7. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
8. Run `npm.cmd run verify:server-modules`.
9. Run `npm.cmd run verify:frontend-normalizers`.
10. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
11. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- Cached project/thread list remains visible on startup.
- The real `thread/list` refresh no longer competes with the first thread screen immediately after cache hydration.
- Explicit refresh paths still update the sidebar without waiting for the cached-start delay.
- The real `分析项目` phone thread page and conversation fixture remain nonblank.

#### Rollback/Cleanup Notes
- To roll back, revert `src/composables/useDesktopState.ts`, `docs/changelog.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-07 measurement before fix: a fresh phone-width open of the real `分析项目` thread showed no `thread/read`, but no-cache startup still had immediate `thread/list` at about `1264ms`, which is the expected uncached network path.
- 2026-07-07 measurement after fix: after warming sidebar cache and reloading the same phone-width thread route, cached-start `thread/list` moved to about `3750ms` while the page still rendered the real thread content.
- 2026-07-07 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`.
- 2026-07-07 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-07 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-07 deploy: latest build was restarted on local 7420 as PID `57988`, version `2.2.8`, with `/health` returning `ok`.
- 2026-07-07 gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed with `activeFirstPageCount=120`, `archivedFirstPageCount=100`, and required thread project `codexui`.
- 2026-07-07 gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation fixtures, and the real phone thread page.

### Feature: Keep latest turn context in recent message window

#### Prerequisites
- Local 7420 can be rebuilt and restarted from `E:\javaword\CXCodex\codexui`.
- The real regression thread `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.
- The conversation fixture route `/#/__regression/conversation-blocks?regression=frontend` is available.

#### Steps
1. Open a long thread whose latest turn contains more than 10 normalized messages.
2. Confirm the recent message window keeps the latest turn's user prompt together with the latest assistant output.
3. Confirm old turns are still hidden behind the existing `继续查看更多` mechanism.
4. Open the conversation fixture route and confirm the fixture still renders code/diff/file/raw/command/request blocks.
5. Confirm the fixture text includes the original latest-turn user prompt `请审查这些文件`.
6. Run `npm.cmd run build`.
7. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
8. Run `npm.cmd run verify:server-modules`.
9. Run `npm.cmd run verify:frontend-normalizers`.
10. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
11. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- Recent-first rendering remains lightweight.
- The latest turn is not clipped from the middle when it contains many intermediate messages.
- Users can see the latest question context near the final answer instead of only seeing folded stage output.
- The real `分析项目` phone thread page and conversation fixture remain nonblank.

#### Rollback/Cleanup Notes
- To roll back, revert `src/components/content/ThreadConversation.vue`, `src/components/content/ConversationRegressionFixture.vue`, `scripts/regression-7420-frontend.ps1`, `docs/changelog.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-07 measurement before fix: real `thread/read(includeTurns:true)` for `分析项目` returned 3 recent turns and about 80 raw items in about 109 ms, but the phone DOM only showed a final-looking single message card because the 10-message window could start inside the latest turn.
- 2026-07-07 measurement after fix: real phone-width CDP render of `分析项目` showed `messageCards=2`, `guidedToggles=1`, `hasLatestUserQuestion=true`, and `hasOnlyFinalLookingScreen=false`.
- 2026-07-07 gate: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-07 deploy: latest build was restarted on local 7420 as PID `36648`, version `2.2.8`, with `/health` returning `ok`.
- 2026-07-07 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`.
- 2026-07-07 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-07 gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed with `activeFirstPageCount=120`, `archivedFirstPageCount=100`, and required thread project `codexui`.
- 2026-07-07 gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation fixtures, and the real phone thread page.

### Feature: Avoid early skills refresh on thread reload

#### Prerequisites
- Local 7420 can be rebuilt and restarted from `E:\javaword\CXCodex\codexui`.
- The real regression thread `019f27ae-0ecd-7c50-9701-8ec003e66447` / `分析项目` is available.
- A browser context can warm the cached thread/sidebar state, then reload the thread route.

#### Steps
1. Open `http://127.0.0.1:7420/#/thread/019f27ae-0ecd-7c50-9701-8ec003e66447` at phone width.
2. Wait for the initial thread page to settle and cache the sidebar/thread state.
3. Reload the same thread route in the same browser context.
4. Capture `/codex-api/rpc` request timing for at least 10 seconds.
5. Confirm `skills/list` does not start in the first second of the cached thread reload.
6. Confirm non-thread pages can still refresh skills after startup idle time.
7. Run `npm.cmd run build`.
8. Restart local 7420 with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\restart-local-service.ps1 -Port 7420 -ConfigPath C:\Users\SW\.codexui\config.json`.
9. Run `npm.cmd run verify:server-modules`.
10. Run `npm.cmd run verify:frontend-normalizers`.
11. Run `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目`.
12. Run `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90`.

#### Expected Results
- Thread deep-link reload no longer misclassifies as a non-thread route during initialization.
- Cached thread reload does not trigger the home-page fallback `skills/list` refresh at roughly 200 ms.
- Thread selection and explicit skill-center refresh behavior still work.
- The real `分析项目` phone thread page and conversation fixture remain nonblank.

#### Rollback/Cleanup Notes
- To roll back, revert `src/App.vue`, `docs/changelog.zh-CN.md`, and this test section.

#### Regression Evidence
- 2026-07-07 measurement before fix: warm thread reload still triggered `skills/list` at about `252ms`, before the delayed `thread/list`, because the initialization fallback briefly treated the reload as a non-thread route.
- 2026-07-07 measurement after fix: warm thread reload had no `skills/list` in the first 10 seconds; the reload phase only showed delayed model/config at about `2344ms` and delayed `thread/list` at about `3745ms`.
- 2026-07-07 measurement after fix: the same real phone-width thread remained nonblank with `messageCards=2`, `guidedToggles=1`, and `hasLatestUserQuestion=true`.
- 2026-07-07 build: `npm.cmd run build` passed; Vite still reports the existing large chunk warning.
- 2026-07-07 deploy: latest build was restarted on local 7420 as PID `46596`, version `2.2.8`, with `/health` returning `ok`.
- 2026-07-07 gate: `npm.cmd run verify:server-modules` passed with `server module smoke ok`.
- 2026-07-07 gate: `npm.cmd run verify:frontend-normalizers` passed with `frontend normalizer smoke ok`.
- 2026-07-07 gate: `npm.cmd run test:7420:sidebar-data -- --base-url http://127.0.0.1:7420 --require-thread-title 分析项目` passed with `activeFirstPageCount=120`, `archivedFirstPageCount=100`, and required thread project `codexui`.
- 2026-07-07 gate: `npm.cmd run test:7420:frontend -- -BaseUrl http://127.0.0.1:7420 -RequireThreadTitle 分析项目 -ThreadId 019f27ae-0ecd-7c50-9701-8ec003e66447 -AgentBrowserTimeoutSec 90` passed across desktop, phone, foldable, conversation fixtures, and the real phone thread page.
