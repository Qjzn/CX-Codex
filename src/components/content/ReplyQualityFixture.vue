<template>
  <main ref="fixtureRoot" class="reply-quality-fixture" aria-label="回复质量验收夹具" :data-case="selectedCase">
    <header class="reply-quality-toolbar">
      <label>
        <span>固定样本</span>
        <select :value="selectedCase" aria-label="选择回复样本" @change="setCase(($event.target as HTMLSelectElement).value)">
          <option v-for="sample in samples" :key="sample.id" :value="sample.id">{{ sample.label }}</option>
        </select>
      </label>
      <div class="reply-quality-controls">
        <button type="button" :disabled="!isRunning" @click="stepStream()">继续输出</button>
        <button type="button" :disabled="!isRunning" @click="finishStream()">完成本轮</button>
      </div>
    </header>
    <ThreadConversation
      :key="`${selectedCase}:${resetCount}`"
      class="reply-quality-conversation"
      :projection="projection"
      :is-loading="false"
      :is-turn-in-progress="isRunning"
      :active-thread-id="threadId"
      cwd="E:/workspace/example"
      :scroll-state="scrollState"
      :favorite-message-ids="favoriteIds"
      compact-runtime-chrome
      @update-scroll-state="scrollState = $event.state"
      @copy-status="copyStatus = $event"
      @toggle-favorite="toggleFavorite"
    />
    <output class="reply-quality-status" aria-live="polite" :data-tone="copyStatus?.tone" :data-step="streamStep">
      {{ copyStatus?.message || '仅使用固定示例；不会发送消息、执行命令或读取文件。' }}
    </output>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import ThreadConversation from './ThreadConversation.vue'
import { projectConversation, type ConversationFavoriteIntent } from '../../conversation-transcript'
import type { ThreadScrollState } from '../../types/codex'

const samples = [
  { id: 'short', label: '短回答' },
  { id: 'markdown', label: '中文长文与列表' },
  { id: 'code', label: '流式代码' },
  { id: 'table', label: '宽表格与链接' },
  { id: 'math', label: '数学公式与源码回退' },
  { id: 'process', label: '公开过程与操作详情' },
  { id: 'reading', label: '完成转换与阅读保护' },
] as const
type SampleId = typeof samples[number]['id']
type CopyStatus = { message: string; tone: 'success' | 'info' | 'warning' | 'danger' }
type FixtureItem = Record<string, unknown>

const fixtureRoot = ref<HTMLElement | null>(null)
const selectedCase = ref<SampleId>('short')
const resetCount = ref(0)
const streamStep = ref(0)
const completed = ref(false)
const startedAtMs = ref(Date.now() - 8_000)
const completedAtMs = ref<number | null>(null)
const scrollState = ref<ThreadScrollState | null>(null)
const favoriteIds = ref<string[]>([])
const copyStatus = ref<CopyStatus | null>(null)
const codeOverride = ref<string | null>(null)
const threadId = computed(() => `reply-quality-${selectedCase.value}`)
const turnId = computed(() => `${threadId.value}-turn`)
const canStream = computed(() => ['code', 'process', 'reading'].includes(selectedCase.value))
const isRunning = computed(() => canStream.value && !completed.value)
const originalDark = document.documentElement.classList.contains('dark')
let markedNode: Node | null = null
let markedText = ''
let restoreClipboard: (() => void) | null = null

const markdownText = [
  '## 三、关键验证结果', '',
  '最终 2 小时浸泡报告：', '',
  '- 运行时间：7200 秒', '- 采样：475 次', '- RPC 最大排队数：0', '- 结果：`passed: true`', '',
  '### 阅读与操作体验', '',
  '这是一段用于检查中文排版的完整说明。标题应当有清晰层级，正文在手机上自然换行，段落和列表之间保留恰当间距。', '',
  '连续阅读时，重点来自内容本身，而不是重复的状态标签。用户可以先看结论，再按需要展开公开过程与操作详情。', '',
  '1. 保留原有的消息身份和真实执行状态。',
  '2. 检查列表的第二行是否与正文对齐，而不是与编号对齐。这条内容故意写长，便于在窄屏上观察换行后的缩进。',
  '   - 子项使用更深一层的缩进。',
  '   - 子项内的 **重点** 与 `行内代码` 保持可读。',
  '3. 完成后保留最终回复。', '',
  '> 验收结果仅说明此固定样本的前端呈现，不代表真实服务或设备门槛已完成。', '',
  '### 后续检查', '',
  '- [x] 标题和列表按语义显示。', '- [ ] 实际会话、断网恢复与真机分别验收。', '',
  '报告示例：[verification.json](E:/workspace/example/reports/verification.json)。',
].join('\n')

const codeChunks = [
  '### 状态归一化示例\n\n这段说明已经完整输出，后续代码增长时应保留此段的 DOM 与文本选区。\n\n```typescript\ntype Status = ',
  "'running' | 'completed'\n\n",
  'export function describeStatus(status: Status): string {\n',
  "  return status === 'running' ? '正在处理' : '已完成'\n",
  '}\n```\n\n',
  '代码块已经闭合。复制操作只复制代码正文，语言标签不进入剪贴板。\n\n',
  '```json\n{\n  "status": "completed",\n',
  '  "verified": true\n}\n```\n\n',
  '完成：`REPLY_QUALITY_STREAM_OK`。',
]

const tableText = [
  '## 验收对照', '',
  '宽表格应只在表格内部横向滚动；页面正文和操作区不应被撑宽。', '',
  '| 场景 | 桌面窗口 | 手机窗口 | 折叠屏窗口 | 预期行为 | 样本标识 |',
  '| --- | --- | --- | --- | --- | --- |',
  '| 简短回复 | 1440 × 900 | 393 × 852 | 884 × 1104 | 优先看到回答内容 | `quality-short-001` |',
  '| 流式代码 | 保留语言与复制入口 | 代码内部水平滚动 | 不撑开阅读列 | 已闭合段落保持身份 | `quality-streaming-code-002` |',
  '| 阅读保护 | 不强制跳到最新位置 | 手指滚动不被争夺 | 完成后仍可继续阅读 | 保留选区和阅读锚点 | `quality-reading-protection-003` |', '',
  '### 链接', '',
  '- [外部文档示例](https://example.com/docs?mode=reply-quality)',
  '- [本地文件示例](E:/workspace/example/src/main.ts:12)',
  '- 长路径：`src/components/conversation/quality/streaming/very-long-example-file-name.ts`', '',
  '下面是普通正文，用于确认表格后的正常换行与阅读列宽没有受到影响。',
].join('\n')

const mathText = [
  '### 数学公式', '',
  String.raw`行内公式：$E=mc^2$，以及 \(a^2+b^2=c^2\)。`, '',
  String.raw`$$\frac{1}{2}+\sqrt{x}=\int_0^1 t^2\,dt$$`, '',
  String.raw`\[\begin{pmatrix}1&2\\3&4\end{pmatrix}\]`, '',
  '价格保持原文：$5 and $10；行内代码 `$x^2$`。', '',
  '价格与公式相邻：$10；**重要**；结果$x+1$。', '',
  '未闭合示例 \\(x；代码 `\\)`；**重点**。', '',
  '```latex', String.raw`\frac{a}{b} + $x^2$`, '```', '',
  String.raw`未闭合公式：\(x^2 +`, '',
  String.raw`未知命令保持可读：$\cxUnknown{x}$`, '',
  String.raw`受限命令：$\href{javascript:alert(1)}{unsafe}$`, '',
  String.raw`$$\underbrace{a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a}_{\text{长公式只在本区域滚动}}$$`,
  '', String.raw`行内长公式：$\underbrace{a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a}_{\text{行内长公式局部滚动}}$。后续正文保持正常换行。`,
].join('\n')

function user(text: string): FixtureItem {
  return { type: 'userMessage', id: `${turnId.value}-user`, content: [{ type: 'text', text }] }
}

function assistant(id: string, phase: 'commentary' | 'final_answer', text: string): FixtureItem {
  return { type: 'agentMessage', id: `${turnId.value}-${id}`, phase, text }
}

function processItems(): FixtureItem[] {
  const operationStatus = isRunning.value ? 'inProgress' : 'completed'
  return [
    user('请检查回复是否清晰，并把操作细节保留为按需查看。'),
    assistant('progress-1', 'commentary', '我先确认消息状态与正文显示是否一致，再检查手机上的阅读顺序。'),
    { type: 'commandExecution', id: `${turnId.value}-command-1`, command: 'npm run verify:conversation-transcript', cwd: 'E:/workspace/example', status: 'completed', aggregatedOutput: '示例结果：12 项检查通过。', exitCode: 0 },
    assistant('progress-2', 'commentary', '状态映射检查已完成。接下来验证标题、列表和代码，不改变原有的消息发送链路。'),
    { type: 'webSearch', id: `${turnId.value}-search`, query: '示例：可访问的流式会话', status: 'completed' },
    { type: 'commandExecution', id: `${turnId.value}-command-2`, command: 'npm run build:frontend', cwd: 'E:/workspace/example', status: operationStatus, aggregatedOutput: isRunning.value ? '示例：正在检查类型与生成前端资源。' : '示例：前端构建通过。', ...(isRunning.value ? {} : { exitCode: 0 }) },
    assistant('progress-3', 'commentary', `正文与详细操作已分层展示；本轮仍在检查响应式呈现。${streamStep.value > 0 ? ` 已补充 ${streamStep.value} 次公开进度。` : ''}`),
    ...(!isRunning.value ? [assistant('final', 'final_answer', '检查完成：主要区域保留清晰结论，公开过程可展开，执行命令和输出按需查看。')] : []),
  ]
}

const items = computed<FixtureItem[]>(() => {
  switch (selectedCase.value) {
    case 'short': return [user('现在可以继续吗？'), assistant('final', 'final_answer', '可以，消息已收到。你可以继续描述要处理的问题。')]
    case 'markdown': return [user('请说明关键验证结果。'), assistant('final', 'final_answer', markdownText)]
    case 'code': return [user('给我一个带说明的 TypeScript 示例。'), assistant('final', 'final_answer', codeOverride.value ?? codeChunks.slice(0, completed.value ? codeChunks.length : streamStep.value + 1).join(''))]
    case 'table': return [user('用表格整理验收场景。'), assistant('final', 'final_answer', tableText)]
    case 'math': return [user('显示数学公式，并保留价格、代码与不完整源码。'), assistant('final', 'final_answer', mathText)]
    case 'process': return processItems()
    case 'reading': return [
      user('请给出较长的公开进度说明，我需要在处理完成前阅读其中一段。'),
      assistant('progress', 'commentary', [
        '### 正在核对阅读体验', '',
        '这段完整文字用于选择和阅读锚点检查；新内容到达或任务结束时不应被替换。', '',
        ...Array.from({ length: 12 }, (_, index) => `第 ${index + 1} 项检查：保持清晰的公开说明，操作详情按需展开。用户向上滚动阅读这段内容时，新输出不能夺走当前阅读位置。\n`),
        ...(streamStep.value > 0 ? [`补充进度：已收到 ${streamStep.value} 次增量更新。`] : []),
      ].join('\n')),
      ...(!isRunning.value ? [assistant('final', 'final_answer', '本轮检查已完成。若你正在阅读过程，当前内容应保持可读；主动返回最新消息后再回到结论。')] : []),
    ]
  }
})

const projection = computed(() => projectConversation({
  threadRead: { thread: { id: threadId.value, turns: [{
    id: turnId.value,
    status: isRunning.value ? 'inProgress' : 'completed',
    startedAt: new Date(startedAtMs.value).toISOString(),
    ...(isRunning.value ? {} : { completedAt: new Date(completedAtMs.value ?? startedAtMs.value + 8_000).toISOString() }),
    items: items.value,
  }] } },
  runtime: {
    executionState: isRunning.value ? 'running' : 'completed',
    activeTurnId: isRunning.value ? turnId.value : '',
    lastStartedAtIso: new Date(startedAtMs.value).toISOString(),
    lastCompletedAtIso: isRunning.value ? null : new Date(completedAtMs.value ?? startedAtMs.value + 8_000).toISOString(),
    messageState: 'fresh',
  },
  pendingRequests: [],
  nowMs: Date.now(),
}))

async function setCase(name: string) {
  if (!samples.some((sample) => sample.id === name)) throw new Error(`Unknown reply quality sample: ${name}`)
  selectedCase.value = name as SampleId
  resetCount.value += 1
  streamStep.value = 0
  completed.value = false
  startedAtMs.value = Date.now() - 8_000
  completedAtMs.value = null
  scrollState.value = null
  favoriteIds.value = []
  copyStatus.value = null
  codeOverride.value = null
  markedNode = null
  markedText = ''
  await nextTick()
  return snapshot()
}

async function stepStream() {
  if (isRunning.value) streamStep.value = Math.min(streamStep.value + 1, selectedCase.value === 'code' ? codeChunks.length - 1 : 40)
  await nextTick()
  return snapshot()
}

async function finishStream() {
  if (isRunning.value) {
    completedAtMs.value = Date.now()
    completed.value = true
  }
  await nextTick()
  return snapshot()
}

function toggleFavorite(intent: ConversationFavoriteIntent): void {
  favoriteIds.value = favoriteIds.value.includes(intent.messageId)
    ? favoriteIds.value.filter((id) => id !== intent.messageId)
    : [...favoriteIds.value, intent.messageId]
}

function setTheme(theme: 'light' | 'dark'): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

function setCopyFailure(enabled: boolean): void {
  restoreClipboard?.()
  restoreClipboard = null
  if (!enabled) return
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand')
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new DOMException('Fixture clipboard denied', 'NotAllowedError') } } })
  Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false })
  restoreClipboard = () => {
    if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
    else Reflect.deleteProperty(navigator, 'clipboard')
    if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand)
    else Reflect.deleteProperty(document, 'execCommand')
  }
}

function markStableNode(selector = '.assistant-turn .message-markdown p'): boolean {
  markedNode = fixtureRoot.value?.querySelector(selector) ?? null
  markedText = markedNode?.textContent ?? ''
  return markedNode !== null
}

function snapshot() {
  const root = fixtureRoot.value
  const scroller = root?.querySelector<HTMLElement>('.transcript-list')
  return {
    sample: selectedCase.value,
    streaming: isRunning.value,
    step: streamStep.value,
    projectedTurns: projection.value.turns.length,
    turnState: projection.value.turns[0]?.state,
    headings: [...(root?.querySelectorAll('.message-markdown h2, .message-markdown h3') ?? [])].map((element) => element.textContent),
    lists: root?.querySelectorAll('.message-markdown ul, .message-markdown ol').length ?? 0,
    codeBlocks: root?.querySelectorAll('.message-markdown pre').length ?? 0,
    tables: root?.querySelectorAll('.message-markdown table').length ?? 0,
    processExpanded: root?.querySelector('.process-toggle')?.getAttribute('aria-expanded'),
    pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
    scrollTop: scroller?.scrollTop ?? null,
    scrollHeight: scroller?.scrollHeight ?? null,
    selection: window.getSelection()?.toString() ?? '',
    markedNodeConnected: markedNode?.isConnected ?? null,
    markedNodeTextUnchanged: markedNode ? markedNode.textContent === markedText : null,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    copyStatus: copyStatus.value ? { ...copyStatus.value } : null,
  }
}

async function setCodeText(text: string) {
  if (selectedCase.value !== 'code') await setCase('code')
  codeOverride.value = text
  await nextTick()
  return snapshot()
}

const fixtureApi = { cases: samples.map((sample) => sample.id), setCase, stepStream, finishStream, setTheme, setCopyFailure, markStableNode, setCodeText, snapshot }
const fixtureWindow = window as Window & { __CX_REPLY_QUALITY__?: typeof fixtureApi }

onMounted(async () => {
  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? window.location.search)
  await setCase(samples.some((sample) => sample.id === params.get('case')) ? params.get('case')! : 'short')
  if (params.get('theme') === 'dark') setTheme('dark')
  fixtureWindow.__CX_REPLY_QUALITY__ = fixtureApi
})

onBeforeUnmount(() => {
  restoreClipboard?.()
  document.documentElement.classList.toggle('dark', originalDark)
  if (fixtureWindow.__CX_REPLY_QUALITY__ === fixtureApi) delete fixtureWindow.__CX_REPLY_QUALITY__
})
</script>

<style scoped>
.reply-quality-fixture {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  min-width: 0;
  background: var(--ui-bg-surface);
  color: var(--ui-text-primary);
}

.reply-quality-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 16px;
  flex: none;
  padding: 8px 16px;
  border-bottom: 1px solid var(--ui-border-subtle);
}

.reply-quality-toolbar label,
.reply-quality-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.reply-quality-toolbar select,
.reply-quality-toolbar button {
  min-height: 44px;
  min-width: 44px;
  padding: 6px 10px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 8px;
  background: var(--ui-bg-surface);
  color: inherit;
  font: inherit;
}

.reply-quality-toolbar button:disabled { opacity: 0.45; }
.reply-quality-toolbar :is(select, button):focus-visible { outline: 2px solid var(--ui-text-primary); outline-offset: 2px; }
.reply-quality-conversation { flex: 1; height: auto; min-height: 0; }
.reply-quality-status { flex: none; padding: 8px 16px; border-top: 1px solid var(--ui-border-subtle); color: var(--ui-text-secondary); font-size: 12px; }
.reply-quality-status[data-tone='danger'] { color: var(--ui-danger); }
</style>
