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

### Feature: Release 验证脚本

#### Prerequisites
- 本机可运行 `npm.cmd run build`。
- 如需执行 schema audit，Codex CLI 可用并支持 `app-server generate-ts` 和 `app-server generate-json-schema`。
- 如需发版前 clean-git 门禁，当前工作树和 index 均无未提交改动。

#### Steps
1. 快速验证脚本路径：执行 `powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/verify-release.ps1 -AllowDirty -SkipBuild -SkipCliSmoke -SchemaAudit skip`。
2. 完整构建验证：执行 `npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip`。
3. 协议审计验证：执行 `powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/verify-release.ps1 -AllowDirty -SkipBuild -SkipCliSmoke -SchemaAudit warn`。
4. 发版候选验证：在 clean worktree 上执行 `npm.cmd run verify:release -- -RequireCleanGit -SchemaAudit warn`。
5. 已完成 schema 基线升级并要求严格阻断时，执行 `npm.cmd run verify:release -- -RequireCleanGit -SchemaAudit strict`。

#### Expected Results
- 快速验证执行 `git diff --check` 和 `package.json` 解析检查。
- 完整构建验证执行 `npm.cmd run build` 并运行 `node dist-cli/index.js --help` CLI smoke。
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

#### Rollback / Cleanup
- 可删除 `output/app-server-schema-audit/<timestamp>` 临时输出。
- 如验证步骤发生变化，同步更新 `RELEASE.md` 和本节证据。

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
2. 配置 OpenAI API key 后，在前端录音或上传音频文件，确认 `/codex-api/transcribe` 返回包含 `text` 的 JSON。
3. 未配置 OpenAI API key 时重复转写，确认后端仍回退到原 ChatGPT 登录态代理链路。
4. 上传超过默认请求体限制的音频 multipart 请求，确认接口返回 `413` 和可读错误。
5. 在移动端或窄屏开始一次任务后，立即观察底部停止按钮，确认短暂防误触窗口内不会展示停止按钮。
6. 任务进行中点击 composer 停止按钮和运行状态条停止按钮，确认 `/codex-api/runtime/interrupt` payload 分别包含 `source=composer-stop` 或 `source=runtime-status-stop`，并带有 `requestedAtIso`、`clientElapsedMs`、截断后的 `userAgent`。

#### Expected Results
- 官方转写链路默认补齐 `model=gpt-4o-transcribe` 和 `response_format=json`，前端能继续从返回 JSON 中提取文本。
- 未配置官方 API key 时，不破坏既有 Codex / ChatGPT 登录态转写。
- 过大转写请求在本地服务端被拒绝，不继续代理到上游。
- 停止请求带来源和耗时审计字段，便于定位误触、移动端重复点击和状态条停止行为。
- 移动端刚发送任务后的短暂窗口不会立即展示停止按钮，降低误触概率。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 配置验证：`node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json ok')"` 输出 `package.json ok`。
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
- 转写上传继续使用独立的 26MiB 上限，不受普通 JSON API 上限影响。
- 超限请求返回 `413`，不会落入通用 `502` bridge error。

#### Regression Evidence
- 2026-07-03 静态验证：`git diff --check` 通过。
- 2026-07-03 构建验证：`npm.cmd run build` 通过，包含 `vue-tsc --noEmit`、`vite build` 和 `tsup` CLI 构建。
- 2026-07-03 CLI smoke：`node dist-cli/index.js --help` 通过并输出 `CX-Codex Web bridge for Codex app-server`。
- 2026-07-03 CJS 启动烟测：`node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['dist-cli/index.js', '--help'], { encoding: 'utf8' }); if (r.status !== 0) { throw new Error(r.stderr || r.stdout || 'cli smoke failed') }; console.log('cli cjs launcher smoke ok')"` 输出 `cli cjs launcher smoke ok`。

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

#### Expected Results
- `verify:governance` 能检查 README、SECURITY、RELEASE、SUPPORT、CONTRIBUTING、Issue 模板、CI/Release workflow、安全硬化文档和 App Server 协议矩阵的关键入口。
- `verify:release` 默认包含治理文档检查，避免只构建成功但开源治理入口缺失。
- 缺少关键文档、模板或官方协议/安全口径时，命令应失败并给出具体文件和缺失文本。

#### Regression Evidence
- 2026-07-03 故障注入验证：README 缺少 `docs/app-server-protocol-matrix.zh-CN.md` 时，`npm.cmd run verify:governance` 失败并指出缺失文本。
- 2026-07-03 故障注入验证：协议矩阵缺少完整 `Codex App Server` 术语时，`npm.cmd run verify:governance` 失败并指出缺失文本；补齐后通过。
- 2026-07-03 治理门禁验证：`npm.cmd run verify:governance` 通过，输出 `Governance docs check passed.`。
- 2026-07-03 Release gate 验证：`npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip` 通过，包含 `Governance docs check`、构建和 CLI smoke。

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
6. 代码审查确认 `src/server/codexAppServerBridge.ts` 只保留 `getWebBridgeSettingsPath()` 路径生成，默认值、`normalizeWebBridgeSettings()`、`readWebBridgeSettings()` 和 `writeWebBridgeSettings()` 均来自 `src/server/webBridgeSettings.ts`。

#### Expected Results
- `src/server/webBridgeSettings.ts` 集中维护默认权限、permission decision 归一化、settings payload 归一化、配置 JSON 读取和写入。
- 配置文件路径仍由 bridge 的 `getWebBridgeSettingsPath()` 生成，保持原来的 `web-bridge-settings.json` 位置。
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
