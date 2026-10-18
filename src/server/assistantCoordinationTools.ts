import type { RuntimeRequestRecord } from './runtimeStore.js';

/**
 * Pure trusted tool boundary for assistant coordination.
 *
 * This module contains ONLY:
 *  - native dynamic tool specs (definitions)
 *  - authorization/validation of an incoming tool-call request against
 *    backend-supplied RuntimeRequestRecord rows
 *
 * It performs no task execution, no storage, no transports, no coordinator
 * registration and exposes no handlers.
 */

export type AssistantToolName =
  | 'assistant_dispatch_task'
  | 'assistant_read_tasks'
  | 'assistant_stop_task';

export type AssistantToolOrigin = 'user' | 'report';

export interface AssistantToolSpec {
  name: AssistantToolName;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface AuthorizedAssistantToolCall {
  tool: AssistantToolName;
  callId: string;
  threadId: string;
  turnId: string;
  sourceRequestId: string;
  sourceClientMessageId: string;
  origin: AssistantToolOrigin;
  arguments: Record<string, unknown>;
}

const REJECTION_MESSAGE = '助手协调请求已拒绝';
const REPORT_CLIENT_MESSAGE_PREFIX = 'assistant-report:';
const TASK_CLIENT_MESSAGE_PREFIX = 'assistant-task:';
const TOOL_CALL_METHOD = 'item/tool/call';
const MAX_ID_LENGTH = 200;
const MAX_TITLE_LENGTH = 160;
const MAX_INSTRUCTIONS_LENGTH = 12000;
const MAX_SHORT_ID_LENGTH = 100;

const DISPATCH_TOOL = 'assistant_dispatch_task';
const READ_TOOL = 'assistant_read_tasks';
const STOP_TOOL = 'assistant_stop_task';

const DISPATCH_DESCRIPTION =
  'Dispatch a new assistant task with a short title and full instructions. ' +
  'The task runs in the current workspace; do not attempt to set working directory, permissions or task identifiers.';

const READ_DESCRIPTION =
  'Read the assistant task list for the current conversation, including status and identifiers. Takes no arguments.';

const STOP_DESCRIPTION =
  'Stop a running assistant task identified by a taskId previously returned by assistant_read_tasks.';

export const ASSISTANT_COORDINATION_TOOLS: readonly AssistantToolSpec[] = Object.freeze([
  Object.freeze({
    name: DISPATCH_TOOL,
    description: DISPATCH_DESCRIPTION,
    inputSchema: Object.freeze({
      type: 'object',
      additionalProperties: false,
      required: ['title', 'instructions'],
      properties: {
        title: {
          type: 'string',
          minLength: 1,
          maxLength: MAX_TITLE_LENGTH,
          description: 'Short human-readable task title.',
        },
        instructions: {
          type: 'string',
          minLength: 1,
          maxLength: MAX_INSTRUCTIONS_LENGTH,
          description: 'Complete instructions for the dispatched task.',
        },
        relatedTaskId: {
          type: 'string',
          minLength: 1,
          maxLength: MAX_SHORT_ID_LENGTH,
          description: 'Optional identifier of a related existing task.',
        },
      },
    }),
  }),
  Object.freeze({
    name: READ_TOOL,
    description: READ_DESCRIPTION,
    inputSchema: Object.freeze({
      type: 'object',
      additionalProperties: false,
      required: [],
      properties: {},
    }),
  }),
  Object.freeze({
    name: STOP_TOOL,
    description: STOP_DESCRIPTION,
    inputSchema: Object.freeze({
      type: 'object',
      additionalProperties: false,
      required: ['taskId'],
      properties: {
        taskId: {
          type: 'string',
          minLength: 1,
          maxLength: MAX_SHORT_ID_LENGTH,
          description: 'Identifier of the task to stop.',
        },
      },
    }),
  }),
]) as readonly AssistantToolSpec[];

const TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  DISPATCH_TOOL,
  READ_TOOL,
  STOP_TOOL,
]);

function reject(): never {
  throw new Error(REJECTION_MESSAGE);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function ownKeysAreAllowed(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      return false;
    }
  }
  return true;
}

function readRequiredId(container: Record<string, unknown>, key: string): string {
  const raw = container[key];
  if (typeof raw !== 'string') {
    reject();
  }
  if (raw.trim().length === 0 || raw.length > MAX_ID_LENGTH) {
    reject();
  }
  return raw;
}

function readOptionalNonEmptyString(
  container: Record<string, unknown>,
  key: string,
): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(container, key)) {
    return undefined;
  }
  const raw = container[key];
  if (typeof raw !== 'string') {
    reject();
  }
  return raw;
}

function normalizeBoundedText(raw: string, maxLength: number): string {
  if (raw.trim().length === 0) {
    reject();
  }
  if (raw.length > maxLength) {
    reject();
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    reject();
  }
  return trimmed;
}

function buildToolArguments(
  tool: AssistantToolName,
  raw: object,
): Record<string, unknown> {
  const params = raw as Record<string, unknown>;

  if (tool === READ_TOOL) {
    if (!ownKeysAreAllowed(params, [])) {
      reject();
    }
    return {};
  }

  if (tool === DISPATCH_TOOL) {
    if (!ownKeysAreAllowed(params, ['title', 'instructions', 'relatedTaskId'])) {
      reject();
    }
    const titleRaw = params.title;
    const instructionsRaw = params.instructions;
    if (typeof titleRaw !== 'string' || typeof instructionsRaw !== 'string') {
      reject();
    }
    const title = normalizeBoundedText(titleRaw, MAX_TITLE_LENGTH);
    const instructions = normalizeBoundedText(
      instructionsRaw,
      MAX_INSTRUCTIONS_LENGTH,
    );
    const args: Record<string, unknown> = { title, instructions };
    const relatedTaskId = readOptionalNonEmptyString(params, 'relatedTaskId');
    if (relatedTaskId !== undefined) {
      args.relatedTaskId = normalizeBoundedText(relatedTaskId, MAX_SHORT_ID_LENGTH);
    }
    return args;
  }

  if (!ownKeysAreAllowed(params, ['taskId'])) {
    reject();
  }
  const taskIdRaw = params.taskId;
  if (typeof taskIdRaw !== 'string') {
    reject();
  }
  return { taskId: normalizeBoundedText(taskIdRaw, MAX_SHORT_ID_LENGTH) };
}

export function authorizeAssistantToolCall(input: {
  method: string;
  params: unknown;
  mainThreadId: string;
  requests: RuntimeRequestRecord[];
}): AuthorizedAssistantToolCall {
  if (!isPlainObject(input)) {
    reject();
  }

  const { method, params, mainThreadId, requests } = input;

  if (typeof method !== 'string' || method !== TOOL_CALL_METHOD) {
    reject();
  }
  if (!isPlainObject(params)) {
    reject();
  }
  if (typeof mainThreadId !== 'string' || mainThreadId.length === 0) {
    reject();
  }
  if (!Array.isArray(requests)) {
    reject();
  }

  const callId = readRequiredId(params, 'callId');
  const threadId = readRequiredId(params, 'threadId');
  const turnId = readRequiredId(params, 'turnId');
  // The pinned native schema explicitly emits null for non-namespaced tools.
  const namespace = params.namespace == null ? undefined : readOptionalNonEmptyString(params, 'namespace');
  if (namespace !== undefined && namespace.length > 0) {
    reject();
  }

  const toolRaw = params.tool;
  if (typeof toolRaw !== 'string' || !TOOL_NAMES.has(toolRaw)) {
    reject();
  }
  const tool = toolRaw as AssistantToolName;

  const rawArguments = params.arguments;
  if (rawArguments === undefined) {
    reject();
  }
  if (!isPlainObject(rawArguments)) {
    reject();
  }

  if (threadId !== mainThreadId) {
    reject();
  }

  const allowedParamKeys = ownKeysAreAllowed(params, [
    'callId',
    'threadId',
    'turnId',
    'tool',
    'arguments',
    'namespace',
  ]);
  if (!allowedParamKeys) {
    reject();
  }

  // Exactly one backend request must match this thread/turn while running.
  const matches: RuntimeRequestRecord[] = [];
  for (const record of requests) {
    if (typeof record !== 'object' || record === null || Array.isArray(record)) {
      reject();
    }
    if (record.threadId !== threadId) {
      continue;
    }
    if (record.turnId !== turnId) {
      continue;
    }
    if (record.status !== 'running') {
      continue;
    }
    matches.push(record);
  }

  if (matches.length !== 1) {
    reject();
  }

  const source = matches[0];
  if (
    typeof source.requestId !== 'string' ||
    source.requestId.length === 0 ||
    typeof source.clientMessageId !== 'string' ||
    source.clientMessageId.length === 0
  ) {
    reject();
  }
  if (source.clientMessageId.startsWith(TASK_CLIENT_MESSAGE_PREFIX)) {
    reject();
  }

  const origin: AssistantToolOrigin = source.clientMessageId.startsWith(
    REPORT_CLIENT_MESSAGE_PREFIX,
  )
    ? 'report'
    : 'user';

  if (origin === 'report' && tool !== READ_TOOL) {
    reject();
  }

  const toolArguments = buildToolArguments(tool, rawArguments);

  return {
    tool,
    callId,
    threadId,
    turnId,
    sourceRequestId: source.requestId,
    sourceClientMessageId: source.clientMessageId,
    origin,
    arguments: toolArguments,
  };
}
