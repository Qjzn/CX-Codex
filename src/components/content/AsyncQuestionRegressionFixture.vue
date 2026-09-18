<template>
  <main class="async-fixture">
    <header>
      <strong>异步提问 · 合成回归示例</strong>
      <div class="fixture-controls">
        <button type="button" @click="reset">重置示例</button>
        <button type="button" @click="failNext = !failNext">{{ failNext ? '下次模拟失败' : '下次模拟成功' }}</button>
        <button type="button" @click="dark = !dark">切换明暗主题</button>
      </div>
    </header>
    <ThreadConversation class="fixture-conversation" :messages="messages" :pending-requests="[]" :live-overlay="null"
      :is-loading="false" :is-turn-in-progress="false" active-thread-id="async-fixture" cwd="/workspace/example"
      :scroll-state="null" :answer-async-question="answer" @retry-failed-message="retry" />
  </main>
</template>

<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import ThreadConversation from './ThreadConversation.vue'
import { ASYNC_QUESTION_TOOL, encodeAsyncAnswer } from '../../asyncQuestions'
import { normalizeThreadMessagesV2 } from '../../api/normalizers/v2'
import type { ThreadReadResponse } from '../../api/appServerDtos'
import type { UiMessage } from '../../types/codex'

const initial = normalizeThreadMessagesV2({ thread: { id: 'async-fixture', turns: [{ id: 'turn-example', status: 'completed', items: [
  { type: 'userMessage', id: 'user-example', content: [{ type: 'text', text: '请整理项目说明；有需要确认的地方可以先问我，其他部分继续处理。' }] },
  { type: 'dynamicToolCall', id: 'call-example', namespace: null, tool: ASYNC_QUESTION_TOOL, status: 'completed', success: true,
    arguments: { questions: [
      { title: '项目说明面向哪些读者？', options: ['首次使用的新用户', '已有经验的维护者'] },
      { title: '还有哪些需要特别说明的内容？' },
    ] } },
  { type: 'agentMessage', id: 'assistant-example', text: '问题已发出。我先整理安装步骤和项目结构，收到回答后再调整说明的深度。', phase: 'final' },
] }] } } as unknown as ThreadReadResponse)
const messages = ref<UiMessage[]>(structuredClone(initial))
const failNext = ref(false)
const dark = ref(false)
const previousDark = document.documentElement.classList.contains('dark')
watch(dark, (value) => document.documentElement.classList.toggle('dark', value))
onBeforeUnmount(() => {
  document.documentElement.classList.toggle('dark', previousDark)
})
function reset(): void { messages.value = structuredClone(initial) }
function retry(id: string): void {
  messages.value = messages.value.map((message) => message.id === id ? { ...message, deliveryState: 'sent' } : message)
}
async function answer(callId: string, answers: string[]): Promise<void> {
  const batch = messages.value.find((message) => message.asyncQuestion?.callId === callId)?.asyncQuestion
  if (!batch) throw new Error('Question missing')
  const id = 'answer-example'
  messages.value.push({ id, role: 'user', text: encodeAsyncAnswer(batch, answers), deliveryState: 'confirming', turnIndex: 1 })
  await new Promise((resolve) => window.setTimeout(resolve, 1200))
  messages.value = messages.value.map((message) => message.id === id ? {
    ...message, deliveryState: failNext.value ? 'failed' : 'sent',
    deliveryError: failNext.value ? '合成网络故障，请重试。' : undefined,
  } : message)
}
</script>

<style scoped>
.async-fixture { height: 100dvh; display: flex; flex-direction: column; background: var(--ui-bg-window); color: var(--ui-text-primary); }
header { padding: 12px 16px; border-bottom: 1px solid var(--ui-border-subtle); }
.fixture-controls { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
button { border: 1px solid var(--ui-border-strong); background: var(--ui-bg-surface); color: inherit; border-radius: var(--ui-radius-control); padding: 8px 12px; min-height: 44px; }
.fixture-conversation { flex: 1; min-height: 0; }
</style>
