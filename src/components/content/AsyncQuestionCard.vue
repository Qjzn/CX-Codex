<template>
  <form class="async-question-card" aria-label="异步提问" @submit.prevent="submit">
    <p class="async-question-status" role="status">{{ status }}</p>
    <fieldset v-for="(question, index) in batch.questions" :key="index" :disabled="disabled || busy || !!answerMessage">
      <legend>{{ question.title }}</legend>
      <div v-if="question.options?.length" class="async-question-options">
        <button v-for="option in question.options" :key="option" type="button"
          :aria-pressed="answers[index] === option" @click="answers[index] = option">{{ option }}</button>
      </div>
      <label>
        <span>{{ question.options?.length ? '你的回答（可选择建议，也可自行填写）' : '你的回答' }}</span>
        <textarea v-model="answers[index]" rows="2" maxlength="8000" required />
      </label>
    </fieldset>
    <p v-if="error" class="async-question-error" role="alert">{{ error }}</p>
    <button v-if="!answerMessage" class="async-question-submit" type="submit"
      :disabled="disabled || busy || !canSubmit">{{ busy ? '正在发送…' : '发送回答' }}</button>
  </form>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { readAsyncAnswer, type AsyncQuestionBatch } from '../../asyncQuestions'
import type { UiMessage } from '../../types/codex'

const props = defineProps<{
  batch: AsyncQuestionBatch
  answerMessage?: UiMessage
  disabled?: boolean
  sendAnswer: (callId: string, answers: string[]) => Promise<void>
}>()
const answers = ref<string[]>([])
const busy = ref(false)
const error = ref('')
watch(() => props.batch.callId, () => {
  answers.value = props.batch.questions.map(() => '')
  error.value = ''
}, { immediate: true })
watch(() => props.answerMessage?.text, (text) => {
  const answer = text ? readAsyncAnswer(text) : null
  if (answer) answers.value = answer.answers.map((entry) => entry.answer)
}, { immediate: true })
const canSubmit = computed(() => answers.value.length === props.batch.questions.length && answers.value.every((answer) => answer.trim()))
const status = computed(() => {
  if (props.answerMessage?.deliveryState === 'failed') return '发送失败，请在下方的失败消息中重试或编辑。'
  if (props.answerMessage && props.answerMessage.deliveryState && props.answerMessage.deliveryState !== 'sent') return '回答正在发送，尚未确认送达。'
  if (props.answerMessage) return '已回答'
  if (props.disabled) return '切换到此任务后可回答。'
  return '等待你的回答 · Codex 可以继续其他工作'
})
async function submit(): Promise<void> {
  if (!canSubmit.value || busy.value || props.disabled || props.answerMessage) return
  busy.value = true
  error.value = ''
  try { await props.sendAnswer(props.batch.callId, [...answers.value]) }
  catch (reason) { error.value = reason instanceof Error ? reason.message : '回答发送失败，请重试。' }
  finally { busy.value = false }
}
</script>

<style scoped>
.async-question-card { padding: 16px; border: 1px solid var(--ui-border-strong); border-radius: var(--ui-radius-card); background: var(--ui-bg-surface); color: var(--ui-text-primary); display: grid; gap: 16px; min-width: 0; }
.async-question-status { margin: 0; color: var(--ui-text-secondary); font-size: 13px; }
fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
legend { font-weight: 600; line-height: 1.6; padding: 0; overflow-wrap: anywhere; }
.async-question-options { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
button, textarea { font: inherit; color: inherit; background: var(--ui-bg-surface); border: 1px solid var(--ui-border-strong); border-radius: var(--ui-radius-control); }
button { min-height: 44px; max-width: 100%; min-width: 0; padding: 8px 12px; cursor: pointer; overflow-wrap: anywhere; text-align: start; }
button:hover:not(:disabled) { background: var(--ui-bg-row-hover); }
button[aria-pressed="true"] { border-color: var(--ui-accent); background: var(--ui-bg-row-active); }
button:focus-visible, textarea:focus-visible { outline: 2px solid var(--ui-focus); outline-offset: 2px; }
button:disabled { cursor: default; opacity: .65; }
label { display: grid; gap: 6px; margin-top: 12px; font-size: 13px; color: var(--ui-text-secondary); }
textarea { width: 100%; box-sizing: border-box; padding: 10px; resize: vertical; font-size: 16px; color: var(--ui-text-primary); }
.async-question-submit { justify-self: start; font-weight: 600; }
.async-question-error { margin: 0; color: var(--ui-danger); }
</style>
