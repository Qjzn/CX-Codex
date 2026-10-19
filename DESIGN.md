---
version: alpha
name: CX Codex
description: Quiet, compact conversation surface for a coding agent; restrained neutrals, one teal accent, three text sizes, four spacing steps.
colors:
  primary: "#1f1f1f"
  secondary: "#5f5f5c"
  tertiary: "#6f6f6c"
  neutral: "#f7f7f6"
  surface: "#ffffff"
  border: "#e3e3df"
  accent: "#0f766e"
  warning: "#9a6700"
  danger: "#c2410c"
typography:
  body:
    fontFamily: PingFang SC
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.55
  status:
    fontFamily: PingFang SC
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
  meta:
    fontFamily: PingFang SC
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
  title:
    fontFamily: PingFang SC
    fontSize: 14px
    fontWeight: 650
    lineHeight: 1.3
  code:
    fontFamily: JetBrains Mono
    fontSize: 12.5px
    fontWeight: 400
    lineHeight: 1.55
  badge:
    fontFamily: PingFang SC
    fontSize: 11px
    fontWeight: 600
    lineHeight: 1.2
rounded:
  sm: 6px
  md: 10px
  lg: 12px
  pill: 999px
spacing:
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
components:
  status-line:
    typography: "{typography.status}"
    textColor: "{colors.tertiary}"
    padding: 3px
  file-summary:
    typography: "{typography.meta}"
    textColor: "{colors.secondary}"
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: 8px
  code-block:
    typography: "{typography.code}"
    textColor: "{colors.primary}"
    backgroundColor: "{colors.neutral}"
    rounded: "{rounded.md}"
    padding: 12px
  user-bubble:
    typography: "{typography.body}"
    textColor: "{colors.primary}"
    backgroundColor: "{colors.neutral}"
    rounded: "{rounded.lg}"
    padding: 12px
  divider:
    backgroundColor: "{colors.border}"
    height: 1px
  status-line-running:
    typography: "{typography.status}"
    textColor: "{colors.accent}"
  status-line-waiting:
    typography: "{typography.status}"
    textColor: "{colors.warning}"
  count-badge:
    typography: "{typography.badge}"
    textColor: "{colors.primary}"
    backgroundColor: "{colors.neutral}"
    rounded: "{rounded.sm}"
    padding: 2px
  error-banner:
    typography: "{typography.meta}"
    textColor: "{colors.danger}"
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: 12px
---

# CX Codex Conversation Design

This document is the durable visual and interaction contract for the conversation surface. It keeps the product quiet, compact, reliable, and efficient. It does not define session semantics; `src/conversation-transcript/` owns those semantics. Product scope belongs to `PRODUCT.md`, mandatory completion gates to `PRODUCT_GOAL.md`, and verified implementation facts to `PROJECT_SPEC.md`; feature PRDs may refine but not weaken those contracts.

## Overview

CX Codex is a developer tool that is read for hours. The surface is a conversation, so the design earns trust by staying quiet: one reading column, one accent, no decorative cards, and chrome that appears only when it carries information. Density is a feature; everything that repeats per turn is one line.

Three rules derive every decision below:

- **One line per turn.** Process, file changes, and timing collapse into a single status line; detail lives behind it, never as nested expanders in the timeline.
- **Borders over shadows.** Surfaces are flat and opaque; separation comes from a 1px rule or spacing, not elevation.
- **Tokens over values.** Sizes, spacing, and motion come from the scales in this file; new hardcoded values are a regression.

## Colors

The palette is a warm neutral ramp with exactly one accent.

- **Primary (#1f1f1f):** body text and headings. 15.4:1 on the window surface.
- **Secondary (#5f5f5c):** labels and file paths. 6.0:1 on the window surface.
- **Tertiary (#6f6f6c):** metadata, counts, placeholders. 4.7:1 on the window surface and 5.0:1 on white — this is the floor for any small text.
- **Neutral (#f7f7f6):** window and user-bubble surface. **Surface (#ffffff):** raised rows only.
- **Border (#e3e3df):** every divider. Never combine a border with a wide shadow.
- **Accent (#0f766e):** running state, links, selection tint at 22% opacity. Not used for decoration.
- **Warning (#9a6700) / Danger (#c2410c):** waits and failures only; never as brand color.

Dark mode swaps the same roles to `#09090b` window with light text; the accent stays teal. A light bubble on a dark surface is a regression.

## Typography

Three sizes, no more:

- **Body 14px / 1.55:** answers, commentary, user messages.
- **Status 13px / 1.5:** the per-turn status line, file paths.
- **Meta 12px / 1.5:** counts, kinds, timestamps, placeholders.
- **Badge 11px / 1.2:** the only sub-12 size, reserved for count badges inside 20px chips; never for prose.
- **Title 14px / 650:** the one label a disclosure row carries.
- **Code 12.5px / 1.55:** monospace, always inside a bordered block.

Tabular numerals wherever numbers update in place. The reading measure stays 48rem; long Chinese paragraphs wrap rather than truncate.

## Layout

Four spacing steps only: 8, 12, 16, 24.

- Conversation list padding: 16 horizontal, 24 bottom.
- Between turns: 16. Inside a turn: 12 between blocks, 8 inside a disclosure.
- The status line and the file-changes row are single 28–38px rows; nothing in the timeline exceeds 44px unless it is a control.
- 48rem reading column, 288px sidebar, 44px header; below 768px the sidebar becomes a drawer and the column takes the viewport.

## Shapes

Radii carry hierarchy, not decoration: 6px for rows, 10px for code blocks and controls, 12px for bubbles and panels, 999px for pills only. A rounded box inside a rounded box is a defect.

## Components

- `status-line` — one row per turn: label, step count, elapsed time, disclosure chevron. It is the only entry to process detail.
- `file-summary` — one flat row: icon, "文件变更", counts. Expanding reveals flat file rows; it is never a card inside a card.
- `code-block` — one bordered container with a 34px toolbar (language, copy). Long lines wrap on coarse pointers instead of scrolling horizontally.
- `user-bubble` — neutral, right aligned, 12px radius; actions sit 4px below and stay 44px tall on touch.

## Reference baseline

The mandatory reference is [`midea-ai/sema-code-core@f564e8d930053becdd5c31fe53f65fd863b6f283`](https://github.com/midea-ai/sema-code-core/tree/f564e8d930053becdd5c31fe53f65fd863b6f283).

| Sema source | Design fact used by CX Codex | CX implementation |
| --- | --- | --- |
| `webui/client/src/features/chat/ChatView.tsx` | A turn uses a user opener, an elapsed/process divider, expanded live work, collapsed completed work, and one concluding answer | `ThreadConversation.vue`: `.turn-shell`, `.turn-divider`, `.process-toggle`, `.final-answer` |
| `webui/client/src/features/chat/Blocks.tsx` | Tool work is a compact verb/target/status row; file changes remain a first-class card with file-level diff stats | `.activity-block`, `.activity-heading`, `.file-summary`, `.file-row` |
| `webui/client/src/features/chat/Composer.tsx` | The composer is a compact two-level control: text above, controls below, with a clear send/stop action | Existing `ThreadComposer.vue` input and control rows; CX keeps its queue, attachment, dictation, plan, and mobile infrastructure |
| `webui/client/src/common/ui.tsx` | State feedback is small: spinner, chevron, restrained hover/focus transitions | Active dots, disclosure chevrons, focus rings, and the return-to-latest control |
| `webui/client/src/index.css` | Neutral surfaces, 14px UI text, readable Markdown, subtle borders, running dots, and minimal continuous animation | Existing CX semantic tokens and Chinese reading typography; Sema motion patterns are reimplemented without copying React/Tailwind code |

The Vue implementation may preserve CX Codex infrastructure and accessibility improvements, but it must not recreate the removed 7420 flat-message, inferred-final, accumulated-command-time, staged-reply, or tail-overlay presentation rules.

## Quiet shell and header

- Sema's fixed reference uses a 256px default resizable sidebar, a 44px chat header, and a `max-w-3xl` reading column. CX keeps the same hierarchy but uses a 288px default sidebar for Chinese project/task labels, with saved desktop widths preserved and clamped to 240-360px.
- A missing saved sidebar preference means 288px exactly; it must not be coerced from `null` to zero and then clamped to the minimum.
- The desktop header is one 44px row. Its main axis and the Composer's visible border are both 48rem; title position remains fixed when the right-side status text changes.
- Below 768px there is no fixed sidebar. Header and Composer use the available single-column width, keep their left/right axes aligned, and expose connection or recovery state through text or an accessible name.
- Shell surfaces stay flat and opaque. Dark mode must switch the content surface and user-message surface together; a light message bubble with dark-theme text is a regression.

## Sidebar hierarchy

- Keep sidebar toggle, mark-all-read, and one dominant new-task action independent in the top utility row. Search, Skills, and GitHub share the quieter three-column row; they retain their existing events, labels and state owners. Workbench and diagnostics are no longer frontend destinations; native background execution and backend diagnostics keep their existing owners.
- The project tree remains the primary navigation surface. A pinned section is an intentional shortcut, so a pinned task may appear once there and once inside its project; no separate running collection is added.
- Project ordering, collapse state, pin state, search pending/partial/failed behavior, and current-thread reveal stay inside the existing Sidebar data path. Visual simplification must not create a parallel index or snapshot.
- Background reordering preserves the first visible project even when it sits exactly at the top boundary. Current-thread reveal expands the bounded preview and scrolls only once; later user scrolling remains authoritative.
- Desktop quick actions remain compact. Coarse-pointer controls and thread rows keep the verified touch sizing, full labels, explicit waiting text, and viewport-clamped menus.
- Light and dark primary actions use neutral contrast, not an accent card or elevated treatment. Count metadata is tertiary text rather than a decorative pill.

## Conversation hierarchy

Each projected turn renders in this order:

1. User opener, right aligned in a neutral bubble.
2. One compact divider showing `已处理` while active or `耗时` when terminal. Waiting time is shown separately and never counted as active execution time.
3. Commentary and structured activities. Active turns stay expanded; terminal turns start collapsed and remain keyboard operable.
4. A compact file-change summary with file count and aggregate additions/removals. File rows and diff content open only on demand so output remains the visual subject on phone-sized screens.
5. Pending interaction cards, when authority or user input is required.
6. One explicit final answer. A terminal turn without exactly one `final_answer` never guesses or promotes commentary; a plain missing final stays visually silent, while failed/interrupted/stopped states remain visible and actionable.

Do not add a repeated Codex avatar/status heading to every turn. The divider and live state already express the turn lifecycle with less noise.

## Density and typography

- Conversation reading width: at most `48rem` on desktop; the visible Composer shell uses the same `48rem` axis, with only its component gutters outside that line. Both become single-column on narrow screens.
- Composer remains a compact two-level control: text above, controls below, with one clear send/stop action. Its default surface is a `12px` light border with no floating-card shadow; focus may add only a one-pixel accent ring.
- UI text: 12–14px. Conversation prose uses a shared 16px baseline and 1.65 line height on desktop and phone; public progress differs by secondary color, not reduced legibility. Heading, list, quote, code and table spacing belongs to `ConversationRichText`.
- User bubbles: neutral surface, 16px radius, no decorative shadow or speech-tail geometry.
- Activity rows: flat rows, not nested cards. Cards are reserved for files, permissions, errors, and other bounded interaction objects.
- File and command content use the existing monospace token. Paths must truncate safely without hiding their file-level stats.

## Interaction contract

- Pending interaction ownership belongs to `ConversationProjection`: approval, user-input, MCP approval/input, unsupported-tool, and generic requests arrive with their display type, title, detail, questions, safe authorization URL, response identity, and session-persistence capability already projected. Renderers emit user intent only; they never classify raw request methods or parse request params.
- Official host metadata is not automatically transcript content. Safety buffering, moderation metadata, project/environment/settings changes, and queue notifications remain outside activities, commentary, and final selection unless the fixed Sema event model provides an explicit observable-work mapping.
- Active public progress is always expanded and non-collapsible: follow mode shows the latest two explicit commentary entries without a line clamp. Operation events never evict that prose window.
- Commands and other technical operations mount only after the explicit per-turn operation-details button is activated. Details belong to the turn; do not invent a causal link to an individual commentary paragraph. History is revealed in bounded batches.
- Completed process disclosure starts collapsed and toggles with a native button exposing `aria-expanded`, except when the reader has selected text, focused process controls, scrolled away, or explicitly opened history. Preserve that mounted presentation until explicit navigation or return-to-latest; do not retract text beneath the reader.
- A small turn-local display clock extends projected elapsed time once per second only while running with a known anchor. Hidden pages stop the interval; waiting, degraded, unknown-clock and terminal states never fabricate running seconds. This clock does not poll or own task state.
- File summaries start collapsed; opening one reveals compact single-line file rows and per-file additions/removals, while each large diff remains collapsed until requested.
- Message actions use quiet copy and more icons outside the user bubble. Favorite and turn rollback live in a viewport-clamped keyboard-operable menu; failed-message edit/retry stay direct. Copy success is local to the action, while failure remains explicit. Public progress has one turn-level copy action rather than a reserved button column per paragraph.
- User, public progress, plan and final text share one sanitized semantic renderer. Unchanged top-level Markdown blocks retain their DOM through streaming; trailing reference definitions may still update earlier links. Code copying excludes chrome and wide tables/code scroll locally without widening the transcript.
- Code is readable immediately; syntax coloring is an optional asynchronous enhancement. Only explicitly named supported languages use a lazy, bounded Worker. Unknown languages, blocks over 20,000 characters and Worker failure retain exact plain text without a toast; colors never change font metrics. Late results cannot replace newer text or an active code selection.
- Every independent coarse-pointer action is at least 44px high or wide as appropriate.
- The return-to-latest action is a centered circular control. It shows an arrow while idle and three running dots while the latest turn is active.
- Expanding history or process detail must preserve the user's reading anchor. New streaming content follows only while the reader remains at the bottom and is not selecting or focusing process content. Frozen presentation is bounded to mounted turns, is not persisted, and explicit message navigation can refresh its target window.
- Older-history anchors and rollback targets/counts belong to `ConversationProjection`; flat `UiMessage[]` indexes or text may not decide either action. An accepted rollback response replaces retained structured history before the normal authoritative refresh, so removed turns cannot survive through stale pages or notifications.
- Execution, stop availability, stale-state recovery, and task-pet activity must read the latest projected turn/activity plus authoritative Runtime freshness. Gateway/thread normalizers and the browser flat cache may emit or retain acknowledged user-message identity for delivery reconciliation only through `AcknowledgedUserMessage`; local send/failure state uses the separate user-only `OptimisticUserMessage`. The old assistant-capable `UiMessage`, `UiPlan`, and `CommandExecutionData` types must not exist under `src`; structured assistant, phase, command, plan, final, timing, history-notice, and activity facts remain owned by `ConversationProjection` and must never be rebuilt as a flat message list.
- Realtime agent, plan, reasoning, and command events live only in the retained structured notification stream until an authoritative `thread/read` replaces them. `useDesktopState` must not accumulate parallel `live*Messages`, raw reasoning text, command output, or `turnActivity` copies; those legacy buffers are neither a rendering source nor an execution/recovery fallback.
- Long conversations virtualize projected turns, not legacy messages: keep at most 10 turn shells and 20 rendered message nodes, measure mounted turn heights, use top/bottom spacers, and disable browser scroll anchoring on the single transcript scroll owner. Virtualization may change DOM residency only; it must not infer, merge, reorder, or reclassify `ConversationProjection` content.
- Artifact details remain inline or modal. A persistent/right-side Inspector is intentionally not part of the current design because no two high-frequency disrupted-reading tasks or context-switch advantage were demonstrated; Sema's optional panel is a reference, not an implementation requirement.

## 交互与可访问性

- 所有图标按钮都有中文可访问名称；状态文本不依赖颜色。
- 键盘焦点可见，dialog、drawer、sheet 和嵌套弹层只有一个焦点/滚动所有者。
- 鼠标 hover 只增强，不成为发现操作的唯一方式。
- `prefers-reduced-motion` 下取消非必要动画；状态仍须可理解。
- 普通文字目标对比度不低于 4.5:1；禁用控件不承担关键说明。
- 加载、缓存、陈旧、部分结果、失败、恢复和空状态都必须使用简洁中文并给出下一步。

## Additional shell and input safeguards

- Phone drawer state must not overwrite the saved desktop Sidebar preference. Nested dialogs and sheets retain one focus and scroll owner.
- Model and effective permissions remain visible in the Composer. Phone Enter inserts a newline; Ctrl/Command + Enter submits. Desktop follows the user preference, and IME composition never submits.
- The draft retains its editable capacity and bounded internal growth. Queued text stays selectable and read-only until a cancellation contract can prove that an accepted or uncertain item cannot start; detached failed-message recovery remains separate.
- New presentation components receive normalized props and emit user intent; they do not request Runtime or persist a second state source. A turn-local display clock remains presentation-only.

## Motion contract

Motion communicates state; it does not decorate the page.

- Disclosure chevrons: 180ms, ease-out, transform only.
- Process reveal: 180ms, opacity plus at most 4px vertical translation. Do not animate measured height.
- Hover/focus/press feedback: 80–180ms using color, opacity, or transform.
- Continuous animation is limited to the running divider dot, running return-to-latest dots, and disclosed active activity dots. Streaming text has no separate trailing caret below the message actions; the truthful running clock owns progress feedback and terminal replies remain still.
- No page-load choreography, spring physics, parallax, glass blur, animated gradients, or layout animation.
- Under `prefers-reduced-motion: reduce`, continuous animation stops and disclosure transitions complete in 1ms while all controls remain usable.

## Responsive contract

- `<768px`: one conversation column, 14px side padding, 44px touch controls, visible message actions, and no fixed Sema side panels.
- Coarse-pointer foldables use the same 44px control floor even when their CSS width is desktop-like.
- CX-Codex keeps its verified mobile drawer, keyboard avoidance, queue feedback, recovery, and Android lifecycle behavior. These are infrastructure capabilities, not legacy conversation semantics.
- Desktop, 393 x 852 phone, and 884 x 1104 coarse-pointer foldable screenshots are mandatory for material conversation UI changes.

## Acceptance gates

- Exactly one `.turn-divider` per projected turn and no `.turn-heading`, `.assistant-mark`, or `.turn-state` legacy visual heading.
- Active public prose expanded, technical details explicitly disclosed; completed process collapsed by default unless protected reading or explicit expansion retains it.
- File summaries visible, final answer count at most one per turn, and no internal context or old tail overlay in the rendered transcript.
- Normal and reduced-motion behavior verified in a real browser.
- No horizontal overflow at desktop, phone, or foldable widths.
- Streaming stress keeps the complete projection, mounts a bounded activity window, and stays below the documented long-task threshold.
- The 801-turn/1602-message fixture must remain navigable at the top, middle, and live tail while mounting no more than 10 turns / 20 message nodes. Incremental tail output must remain below the documented long-task threshold and user scrolling must override any stale follow-to-bottom frame.
- Conversation regression and documentation fixtures must provide structured thread/turn/item facts and `localUserMessages` directly. A fixture-side `UiMessage[]` adapter, `agentMessage.live`, or role/phase reinterpretation would recreate the deleted 7420 semantics and must fail the source gate.

## Broader shell regression matrix

Shell, Sidebar and Composer changes additionally retain the existing 768×1024 compact-boundary and 852×393 phone-landscape checks alongside desktop, phone and foldable-width coverage. Home, running, completed and waiting-input surfaces need light/dark, keyboard-focus, reduced-motion and forced-colors checks when affected. Browser viewport evidence is not physical-device or system-assistive-technology evidence.

Complete the relevant frontend build/regression, inspect browser DOM and console, and manually review at least one desktop and one phone screenshot. Keep candidate, production 7420, Android device, remote CI and official Release evidence separate. Historical baseline evidence remains in `docs/quiet-workbench-ux00-baseline.md` and `tests.md`.
