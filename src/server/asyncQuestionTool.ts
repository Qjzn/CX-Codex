import { ASYNC_QUESTION_TOOL, readAsyncQuestions } from '../asyncQuestions.js'
import type { ServerRequestReply } from './serverRequestReply.js'

// Experimental public App Server dynamic tools, opt-in for CLI 0.153.4+.
export function asyncQuestionsEnabled(): boolean {
  return process.env.CX_CODEX_ASYNC_QUESTIONS === '1'
}

export const asyncQuestionTool = {
  type: 'function',
  name: ASYNC_QUESTION_TOOL,
  description: 'Ask 1–3 non-blocking questions. The tool immediately acknowledges receipt, NOT a user answer. Continue independent work; never assume a choice or permission. Optional suggestions do not select or submit an answer. The user replies later in a normal message wrapped in <cx_async_answer>, correlated by this tool call id. Use ordinary approval tools for permissions. Do not repeat an unanswered question.',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['questions'],
    properties: {
      questions: {
        type: 'array', minItems: 1, maxItems: 3,
        items: {
          type: 'object', additionalProperties: false, required: ['title'],
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 2000 },
            options: { type: 'array', maxItems: 8, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 500 } },
          },
        },
      },
    },
  },
}

export function asyncQuestionReply(method: string, params: unknown, enabled = asyncQuestionsEnabled()): ServerRequestReply | null {
  if (!enabled || method !== 'item/tool/call' || !params || typeof params !== 'object') return null
  const call = params as Record<string, unknown>
  if (call.tool !== ASYNC_QUESTION_TOOL || (call.namespace !== undefined && call.namespace !== null)) return null
  const valid = typeof call.callId === 'string' && call.callId.length > 0 && call.callId.length <= 512
    && typeof call.threadId === 'string' && call.threadId.length > 0
    && readAsyncQuestions(call.arguments) !== null
  return {
    result: {
      success: valid,
      contentItems: [{ type: 'inputText', text: valid
        ? JSON.stringify({ status: 'awaiting_user', callId: call.callId, message: 'Question recorded. No answer or permission yet. Continue independent work; the user can reply later.' })
        : 'Invalid asynchronous question. Supply 1–3 nonempty titles and optional suggestions within the documented limits.' }],
    },
  }
}
