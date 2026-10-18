<template>
  <div ref="rootRef" class="conversation-rich-text" :data-streaming="props.streaming ? 'true' : undefined" @click="onCopyCode">
    <div
      v-for="block in blocks"
      :key="block.key"
      v-memo="[block]"
      class="rich-text-block"
      :data-rich-text-key="block.key"
      :data-rich-text-kind="block.kind"
      v-html="block.html"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import DOMPurify from 'dompurify'
import 'katex/dist/katex.min.css'
import { copyTextToClipboard } from '../../utils/clipboard'
import { createConversationRichTextRenderer, retainSelectedRichTextBlocks, type ConversationRichTextBlock } from './conversationRichText'
import { requestCodeHighlight } from './conversationCodeHighlightClient'

const props = defineProps<{ text: string; streaming?: boolean }>()
const emit = defineEmits<{
  copyStatus: [payload: { message: string; tone: 'success' | 'info' | 'warning' | 'danger' }]
}>()

const rootRef = ref<HTMLElement | null>(null)
const render = createConversationRichTextRenderer((html) => DOMPurify.sanitize(html, {
  USE_PROFILES: { html: true },
  ADD_ATTR: ['target', 'rel'],
}), (html) => DOMPurify.sanitize(html, {
  USE_PROFILES: { html: true, mathMl: true, svg: true },
  ADD_TAGS: ['semantics', 'annotation'],
  FORBID_TAGS: ['a', 'image', 'foreignObject', 'annotation-xml'],
  FORBID_ATTR: ['href', 'xlink:href', 'src'],
  ALLOW_DATA_ATTR: false,
}))
const selectionRevision = ref(0)
function selectedBlockKeys(): Set<string> {
  const keys = new Set<string>()
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || !rootRef.value) return keys
  for (const child of rootRef.value.children) {
    if (!(child instanceof HTMLElement) || !child.dataset.richTextKey) continue
    for (let index = 0; index < selection.rangeCount; index += 1) {
      if (selection.getRangeAt(index).intersectsNode(child)) {
        keys.add(child.dataset.richTextKey)
        break
      }
    }
  }
  return keys
}
const blocks = computed<readonly ConversationRichTextBlock[]>((previous) => {
  void selectionRevision.value
  return retainSelectedRichTextBlocks(render(props.text), previous ?? [], selectedBlockKeys())
})
function onSelectionChange(): void {
  selectionRevision.value += 1
}
function updateInlineMathOverflow(): void {
  for (const formula of rootRef.value?.querySelectorAll<HTMLElement>('.rich-text-math:not(.rich-text-math-display)') ?? []) {
    const scrolls = formula.scrollWidth > formula.clientWidth + 1
    if (scrolls) {
      formula.tabIndex = 0
      formula.setAttribute('role', 'region')
      formula.setAttribute('aria-label', '数学公式，可横向滚动')
    } else {
      formula.removeAttribute('tabindex')
      formula.removeAttribute('role')
      formula.removeAttribute('aria-label')
    }
  }
}
let mathResizeObserver: ResizeObserver | null = null
onMounted(() => {
  document.addEventListener('selectionchange', onSelectionChange)
  mathResizeObserver = new ResizeObserver(updateInlineMathOverflow)
  if (rootRef.value) mathResizeObserver.observe(rootRef.value)
  void document.fonts.ready.then(updateInlineMathOverflow)
})
const feedbackTimers = new Map<HTMLButtonElement, ReturnType<typeof setTimeout>>()

watch([blocks, rootRef], (_value, _previous, onCleanup) => {
  updateInlineMathOverflow()
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  for (const code of rootRef.value?.querySelectorAll<HTMLElement>('pre code[data-code-language]:not([data-highlighted])') ?? []) {
    const text = code.textContent ?? ''
    void requestCodeHighlight(text, code.dataset.codeLanguage ?? '', controller.signal).then((html) => {
      if (!html || controller.signal.aborted || !rootRef.value?.contains(code) || code.textContent !== text) return
      const selection = window.getSelection()
      // Coloring must not destroy an active code selection. Leaving this block
      // uncolored until its next render is preferable to stealing the selection.
      if (selection && !selection.isCollapsed && selection.containsNode(code, true)) return
      const safe = DOMPurify.sanitize(html, { ALLOWED_TAGS: ['span'], ALLOWED_ATTR: ['class'], ALLOW_DATA_ATTR: false })
      const template = document.createElement('template')
      template.innerHTML = safe
      if (template.content.textContent !== text) return
      code.replaceChildren(template.content)
      code.dataset.highlighted = 'true'
    })
  }
}, { flush: 'post' })

async function onCopyCode(event: MouseEvent): Promise<void> {
  if (!(event.target instanceof Element)) return
  const button = event.target.closest<HTMLButtonElement>('button[data-rich-text-copy]')
  if (!button || button.disabled || !rootRef.value?.contains(button)) return
  const container = button.closest<HTMLElement>('[data-rich-text-key]')
  const block = blocks.value.find((entry) => entry.key === container?.dataset.richTextKey)
  const indexValue = button.dataset.richTextCopy ?? ''
  if (!/^\d+$/u.test(indexValue)) return
  const code = block?.code[Number(indexValue)]
  if (code === undefined) return

  const previousTimer = feedbackTimers.get(button)
  if (previousTimer) clearTimeout(previousTimer)
  feedbackTimers.delete(button)
  button.textContent = '复制'
  button.setAttribute('aria-label', '复制代码')
  button.disabled = true
  button.setAttribute('aria-busy', 'true')
  try {
    await copyTextToClipboard(code)
    if (!rootRef.value?.contains(button)) return
    button.textContent = '已复制'
    button.setAttribute('aria-label', '代码已复制')
    const timer = setTimeout(() => {
      feedbackTimers.delete(button)
      if (!rootRef.value?.contains(button)) return
      button.textContent = '复制'
      button.setAttribute('aria-label', '复制代码')
    }, 1600)
    feedbackTimers.set(button, timer)
  } catch {
    if (rootRef.value) emit('copyStatus', { message: '复制失败，请手动选择代码', tone: 'danger' })
  } finally {
    button.disabled = false
    button.removeAttribute('aria-busy')
  }
}

onBeforeUnmount(() => {
  document.removeEventListener('selectionchange', onSelectionChange)
  mathResizeObserver?.disconnect()
  for (const timer of feedbackTimers.values()) clearTimeout(timer)
  feedbackTimers.clear()
})
</script>

<style scoped>
.conversation-rich-text {
  --code-keyword: #b42336;
  --code-string: #075985;
  --code-title: #6e40aa;
  --code-number: #0550ae;
  --code-comment: #59636e;
  --code-addition: #116329;
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
}

.dark .conversation-rich-text {
  --code-keyword: #ff7b72;
  --code-string: #a5d6ff;
  --code-title: #d2a8ff;
  --code-number: #79c0ff;
  --code-comment: #9da7b3;
  --code-addition: #7ee787;
}

.rich-text-block { min-width: 0; }
.rich-text-block + .rich-text-block { margin-block-start: 0.85em; }
.rich-text-block + .rich-text-block:is([data-rich-text-kind='h1'], [data-rich-text-kind='h2'], [data-rich-text-kind='h3'], [data-rich-text-kind='h4'], [data-rich-text-kind='h5'], [data-rich-text-kind='h6']) { margin-block-start: 1.4em; }
.rich-text-block:is([data-rich-text-kind='h1'], [data-rich-text-kind='h2'], [data-rich-text-kind='h3'], [data-rich-text-kind='h4'], [data-rich-text-kind='h5'], [data-rich-text-kind='h6']) + .rich-text-block { margin-block-start: 0.55em; }
.rich-text-block[data-rich-text-kind='p'] + .rich-text-block:is([data-rich-text-kind='ul'], [data-rich-text-kind='ol']) { margin-block-start: 0.5em; }

.rich-text-block :deep(p) { margin: 0 0 0.75em; }
.rich-text-block :deep(p:last-child) { margin-block-end: 0; }
.rich-text-block :deep(:is(h1, h2, h3, h4, h5, h6)) { margin: 0; font-weight: 600; line-height: 1.35; text-wrap: balance; }
.rich-text-block :deep(h1) { font-size: 1.5em; }
.rich-text-block :deep(h2) { font-size: 1.3em; }
.rich-text-block :deep(h3) { font-size: 1.125em; }
.rich-text-block :deep(:is(h4, h5, h6)) { font-size: 1em; }
.rich-text-block :deep(:is(ul, ol)) { margin: 0; padding-inline-start: 1.5em; }
.rich-text-block :deep(ul) { list-style-type: disc; }
.rich-text-block :deep(ol) { list-style-type: decimal; }
.rich-text-block :deep(ul ul) { list-style-type: circle; }
.rich-text-block :deep(ul ul ul) { list-style-type: square; }
.rich-text-block :deep(li + li) { margin-block-start: 0.3em; }
.rich-text-block :deep(li > :is(ul, ol)) { margin-block: 0.35em; }
.rich-text-block :deep(li > p) { margin-block-end: 0.45em; }
.rich-text-block :deep(li > p:last-child) { margin-block-end: 0; }
.rich-text-block :deep(li.rich-text-task-item) { position: relative; list-style: none; }
.rich-text-block :deep(.rich-text-task-checkbox) { position: absolute; width: 1em; height: 1em; margin-block-start: 0.32em; margin-inline-start: -1.5em; accent-color: var(--ui-accent); opacity: 1; pointer-events: none; }
.rich-text-block :deep(blockquote) { margin: 0; padding-inline: 1em 0; border-inline-start: 1px solid var(--ui-border-strong); color: var(--ui-text-secondary); }
.rich-text-block :deep(hr) { margin: 1.1em 0; border: 0; border-block-start: 1px solid var(--ui-border-subtle); }
.rich-text-block :deep(a) { color: var(--ui-accent); text-underline-offset: 3px; }
.rich-text-block :deep(a:hover) { text-decoration: underline; }
.rich-text-block :deep(img) { max-width: 100%; height: auto; border-radius: 8px; }
.rich-text-block :deep(code) { padding: 0.12em 0.38em; border-radius: 5px; background: var(--ui-bg-surface-muted); font: 0.9em/1.5 var(--font-mono-ui); }
/* Leave room for KaTeX glyph overhang without a spurious horizontal scrollbar. */
.rich-text-block :deep(.rich-text-math) { display: inline-block; max-width: 100%; overflow-x: auto; overflow-y: hidden; vertical-align: middle; overflow-wrap: normal; padding: 0.15em; }
.rich-text-block :deep(.rich-text-math-display) { display: block; max-width: 100%; overflow-x: auto; overflow-y: hidden; padding-block: 0.25em; }
.rich-text-block :deep(.rich-text-math-display .katex-display) { width: max-content; min-width: 100%; margin-block: 0.5em; }
.rich-text-block :deep(.rich-text-math:focus-visible) { outline: 2px solid var(--ui-focus); outline-offset: -2px; }

.rich-text-block :deep(.rich-text-code) { min-width: 0; max-width: 100%; margin-block: 0.65em; overflow: hidden; border: 1px solid var(--ui-border-subtle); border-radius: 8px; background: var(--ui-bg-surface-muted); }
.rich-text-block :deep(.rich-text-code:first-child) { margin-block-start: 0; }
.rich-text-block :deep(.rich-text-code:last-child) { margin-block-end: 0; }
.rich-text-block :deep(.rich-text-code-toolbar) { display: flex; min-height: 36px; align-items: center; justify-content: space-between; gap: 12px; padding-inline: 14px 4px; border-block-end: 1px solid var(--ui-border-subtle); color: var(--ui-text-secondary); font: 12px/1.4 var(--font-sans-ui); }
.rich-text-block :deep(.rich-text-code-toolbar > span) { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rich-text-block :deep(.rich-text-code-copy) { flex-shrink: 0; min-width: 48px; min-height: 32px; padding: 4px 8px; border: 0; border-radius: 5px; background: transparent; color: var(--ui-text-secondary); font: inherit; cursor: pointer; }
.rich-text-block :deep(.rich-text-code-copy:hover) { background: var(--ui-bg-row-hover); color: var(--ui-text-primary); }
.rich-text-block :deep(.rich-text-code-copy:disabled) { cursor: wait; }
.rich-text-block :deep(pre) { max-width: 100%; margin: 0; padding: 14px; overflow: auto; color: var(--ui-text-primary); font: 13px/1.6 var(--font-mono-ui); white-space: pre; overflow-wrap: normal; word-break: normal; }
.rich-text-block :deep(pre code) { padding: 0; border: 0; border-radius: 0; background: transparent; font: inherit; white-space: inherit; }
.rich-text-block :deep(:is(.hljs-keyword, .hljs-selector-tag, .hljs-deletion)) { color: var(--code-keyword); }
.rich-text-block :deep(:is(.hljs-string, .hljs-regexp, .hljs-attr)) { color: var(--code-string); }
.rich-text-block :deep(:is(.hljs-title, .hljs-type, .hljs-section)) { color: var(--code-title); }
.rich-text-block :deep(:is(.hljs-number, .hljs-literal, .hljs-built_in, .hljs-variable, .hljs-symbol, .hljs-bullet)) { color: var(--code-number); }
.rich-text-block :deep(:is(.hljs-comment, .hljs-quote, .hljs-meta)) { color: var(--code-comment); }
.rich-text-block :deep(.hljs-addition) { color: var(--code-addition); }
.rich-text-block :deep(.rich-text-table) { max-width: 100%; overflow: auto; border: 1px solid var(--ui-border-subtle); border-radius: 8px; }
.rich-text-block :deep(table) { width: 100%; border-collapse: collapse; font-size: 0.93em; line-height: 1.5; }
.rich-text-block :deep(:is(th, td)) { min-width: 7em; padding: 9px 12px; border-block-end: 1px solid var(--ui-border-subtle); text-align: start; vertical-align: top; }
.rich-text-block :deep(th) { background: var(--ui-bg-surface-muted); color: var(--ui-text-primary); font-weight: 600; }
.rich-text-block :deep(tbody tr:last-child td) { border-block-end: 0; }
.rich-text-block :deep(:is(a, button, pre, .rich-text-table):focus-visible) { outline: 2px solid var(--ui-focus); outline-offset: -2px; }

@media (pointer: coarse), (max-width: 767px) {
  .rich-text-block :deep(.rich-text-code-toolbar) { min-height: 44px; }
  .rich-text-block :deep(.rich-text-code-copy) { min-width: 56px; min-height: 44px; }
  /* 手机上 pre 固定宽度会横向滚动，长行只露一半，看着像渲染坏了；改成软换行并保留缩进。 */
  .rich-text-block :deep(.rich-text-code pre) { white-space: pre-wrap; overflow-wrap: anywhere; }
}
</style>
