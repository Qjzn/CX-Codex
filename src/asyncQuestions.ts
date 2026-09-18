import type { UiMessage } from './types/codex.js'

export const ASYNC_QUESTION_TOOL = 'cx_ask_user_async'
const ANSWER_PREFIX = '<cx_async_answer>\n'
const ANSWER_SUFFIX = '\n</cx_async_answer>'

export type AsyncQuestion = { title: string; options?: string[] }
export type AsyncQuestionBatch = { callId: string; questions: AsyncQuestion[] }
export type AsyncQuestionAnswer = { callId: string; answers: Array<{ question: string; answer: string }> }

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function boundedText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max
}

export function readAsyncQuestions(value: unknown): AsyncQuestion[] | null {
  const questions = record(value)?.questions
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 3) return null
  const result: AsyncQuestion[] = []
  for (const value of questions) {
    const question = record(value)
    if (!question || !boundedText(question.title, 2000)) return null
    const options = question.options
    if (options !== undefined && (!Array.isArray(options) || options.length > 8
      || options.some((option) => !boundedText(option, 500))
      || new Set(options.map((option) => typeof option === 'string' ? option.trim() : option)).size !== options.length)) return null
    result.push({ title: question.title.trim(), ...(options ? { options: (options as string[]).map((option) => option.trim()) } : {}) })
  }
  return result
}

export function readAsyncQuestionItem(value: unknown): AsyncQuestionBatch | null {
  const item = record(value)
  if (!item || item.type !== 'dynamicToolCall' || item.tool !== ASYNC_QUESTION_TOOL
    || (item.namespace !== undefined && item.namespace !== null)
    || item.status !== 'completed' || item.success !== true || !boundedText(item.id, 512)) return null
  const questions = readAsyncQuestions(item.arguments)
  return questions ? { callId: item.id, questions } : null
}

export function encodeAsyncAnswer(batch: AsyncQuestionBatch, answers: string[]): string {
  if (answers.length !== batch.questions.length || answers.some((answer) => !boundedText(answer, 8000))) {
    throw new Error('请回答每一个问题。')
  }
  return ANSWER_PREFIX + JSON.stringify({
    callId: batch.callId,
    answers: batch.questions.map((question, index) => ({ question: question.title, answer: answers[index]!.trim() })),
  } satisfies AsyncQuestionAnswer) + ANSWER_SUFFIX
}

export function readAsyncAnswer(text: string): AsyncQuestionAnswer | null {
  if (!text.startsWith(ANSWER_PREFIX) || !text.endsWith(ANSWER_SUFFIX) || text.length > 200000) return null
  try {
    const value = record(JSON.parse(text.slice(ANSWER_PREFIX.length, -ANSWER_SUFFIX.length)))
    if (!value || !boundedText(value.callId, 512) || !Array.isArray(value.answers)
      || value.answers.length < 1 || value.answers.length > 3) return null
    const answers: AsyncQuestionAnswer['answers'] = []
    for (const entry of value.answers) {
      const answer = record(entry)
      if (!answer || !boundedText(answer.question, 2000) || !boundedText(answer.answer, 8000)) return null
      answers.push({ question: answer.question, answer: answer.answer })
    }
    return { callId: value.callId, answers }
  } catch { return null }
}

export function displayAsyncAnswer(text: string): string {
  const answer = readAsyncAnswer(text)
  return answer ? answer.answers.map((entry) => `${entry.question}\n\n${entry.answer}`).join('\n\n') : text
}

export function findAsyncAnswerMessage(batch: AsyncQuestionBatch, messages: UiMessage[]): UiMessage | undefined {
  return messages.find((message) => {
    if (message.role !== 'user') return false
    const answer = readAsyncAnswer(message.text)
    return answer?.callId === batch.callId && answer.answers.length === batch.questions.length
      && answer.answers.every((entry, index) => entry.question === batch.questions[index]?.title)
  })
}
