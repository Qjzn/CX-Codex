# CX-Codex Conversation Design

This document is the durable visual and interaction contract for the 7420 conversation surface. It keeps the product quiet, compact, reliable, and efficient. It does not define session semantics; `src/conversation-transcript/` owns those semantics.

## Reference baseline

The mandatory reference is [`midea-ai/sema-code-core@f564e8d930053becdd5c31fe53f65fd863b6f283`](https://github.com/midea-ai/sema-code-core/tree/f564e8d930053becdd5c31fe53f65fd863b6f283).

| Sema source | Design fact used by CX-Codex | CX implementation |
| --- | --- | --- |
| `webui/client/src/features/chat/ChatView.tsx` | A turn uses a user opener, an elapsed/process divider, expanded live work, collapsed completed work, and one concluding answer | `ThreadConversation.vue`: `.turn-shell`, `.turn-divider`, `.process-toggle`, `.final-answer` |
| `webui/client/src/features/chat/Blocks.tsx` | Tool work is a compact verb/target/status row; file changes remain a first-class card with file-level diff stats | `.activity-block`, `.activity-heading`, `.file-summary`, `.file-row` |
| `webui/client/src/features/chat/Composer.tsx` | The composer is a compact two-level control: text above, controls below, with a clear send/stop action | Existing `ThreadComposer.vue` input and control rows; CX keeps its queue, attachment, dictation, plan, and mobile infrastructure |
| `webui/client/src/common/ui.tsx` | State feedback is small: spinner, chevron, restrained hover/focus transitions | Active dots, disclosure chevrons, focus rings, and the return-to-latest control |
| `webui/client/src/index.css` | Neutral surfaces, 14px UI text, readable Markdown, subtle borders, running dots, and minimal continuous animation | Existing CX semantic tokens and Chinese reading typography; Sema motion patterns are reimplemented without copying React/Tailwind code |

The Vue implementation may preserve CX-Codex infrastructure and accessibility improvements, but it must not recreate the removed 7420 flat-message, inferred-final, accumulated-command-time, staged-reply, or tail-overlay presentation rules.

## Quiet shell and header

- Sema's fixed reference uses a 256px default resizable sidebar, a 44px chat header, and a `max-w-3xl` reading column. CX keeps the same hierarchy but uses a 288px default sidebar for Chinese project/task labels, with saved desktop widths preserved and clamped to 240-360px.
- A missing saved sidebar preference means 288px exactly; it must not be coerced from `null` to zero and then clamped to the minimum.
- The desktop header is one 44px row. Its main axis and the Composer's visible border are both 48rem; title position remains fixed when the right-side status text changes.
- Below 768px there is no fixed sidebar. Header and Composer use the available single-column width, keep their left/right axes aligned, and expose connection or recovery state through text or an accessible name.
- Shell surfaces stay flat and opaque. Dark mode must switch the content surface and user-message surface together; a light message bubble with dark-theme text is a regression.

## Sidebar hierarchy

- Keep one dominant `新会话` action on its own first row. Search, workspace, and tools share one quieter second row; they retain their existing events, labels, menus, and state owners.
- The project tree remains the primary navigation surface. A pinned section is an intentional shortcut, so a pinned task may appear once there and once inside its project; no separate running collection is added.
- Project ordering, collapse state, pin state, search pending/partial/failed behavior, and current-thread reveal stay inside the existing Sidebar data path. Visual simplification must not create a parallel index or snapshot.
- Background reordering preserves the first visible project even when it sits exactly at the top boundary. Current-thread reveal expands the bounded preview and scrolls only once; later user scrolling remains authoritative.
- Desktop quick actions use a 36px primary row and 32px secondary row. Coarse-pointer controls and thread rows keep the verified touch sizing, full labels, explicit waiting text, and viewport-clamped menus.
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
- UI text: 12–14px. Chinese answer text: 15px desktop, 14px phone, approximately 1.6 line height.
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
- Hover-only actions become persistently visible on phone or coarse-pointer devices.
- Every independent coarse-pointer action is at least 44px high or wide as appropriate.
- The return-to-latest action is a centered circular control. It shows an arrow while idle and three running dots while the latest turn is active.
- Expanding history or process detail must preserve the user's reading anchor. New streaming content follows only while the reader remains at the bottom and is not selecting or focusing process content. Frozen presentation is bounded to mounted turns, is not persisted, and explicit message navigation can refresh its target window.
- Older-history anchors and rollback targets/counts belong to `ConversationProjection`; flat `UiMessage[]` indexes or text may not decide either action. An accepted rollback response replaces retained structured history before the normal authoritative refresh, so removed turns cannot survive through stale pages or notifications.
- Execution, stop availability, stale-state recovery, and task-pet activity must read the latest projected turn/activity plus authoritative Runtime freshness. Gateway/thread normalizers and the browser flat cache may emit or retain acknowledged user-message identity for delivery reconciliation only through `AcknowledgedUserMessage`; local send/failure state uses the separate user-only `OptimisticUserMessage`. The old assistant-capable `UiMessage`, `UiPlan`, and `CommandExecutionData` types must not exist under `src`; structured assistant, phase, command, plan, final, timing, history-notice, and activity facts remain owned by `ConversationProjection` and must never be rebuilt as a flat message list.
- Realtime agent, plan, reasoning, and command events live only in the retained structured notification stream until an authoritative `thread/read` replaces them. `useDesktopState` must not accumulate parallel `live*Messages`, raw reasoning text, command output, or `turnActivity` copies; those legacy buffers are neither a rendering source nor an execution/recovery fallback.
- Long conversations virtualize projected turns, not legacy messages: keep at most 10 turn shells and 20 rendered message nodes, measure mounted turn heights, use top/bottom spacers, and disable browser scroll anchoring on the single transcript scroll owner. Virtualization may change DOM residency only; it must not infer, merge, reorder, or reclassify `ConversationProjection` content.
- Artifact details remain inline or modal. A persistent/right-side Inspector is intentionally not part of the current design because no two high-frequency disrupted-reading tasks or context-switch advantage were demonstrated; Sema's optional panel is a reference, not an implementation requirement.

## Motion contract

Motion communicates state; it does not decorate the page.

- Disclosure chevrons: 180ms, ease-out, transform only.
- Process reveal: 180ms, opacity plus at most 4px vertical translation. Do not animate measured height.
- Hover/focus/press feedback: 80–180ms using color, opacity, or transform.
- Continuous animation is limited to the running divider dot, running return-to-latest dots, disclosed active activity dots, and the active turn's streaming caret. A terminal final never keeps a blinking caret merely because its item timestamp is absent.
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
