/**
 * Assistant identity gateway.
 *
 * Identity and main-conversation entry. Conversation content and execution
 * remain owned by the existing thread gateway, projection and Runtime.
 */

import {
  shouldAutoLoginForResponse,
  tryMobileShellAutoLogin,
} from '../mobile/mobileAuth';

const ASSISTANT_ENDPOINT = '/codex-api/assistant';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ERROR_TEXT_LENGTH = 320;
const MAX_NAME_LENGTH = 80;

const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export interface AssistantIdentity {
  assistantId: string;
  name: string;
  cwd: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  mainThreadId: string | null;
}

export interface AssistantCapabilities {
  conversation: boolean;
  dispatch: boolean;
  backgroundExecution: boolean;
  resultReturn?: boolean;
}

/** Read-only summary of one backend task; never client-configurable. */
export interface AssistantTaskSummary {
  taskId: string;
  title: string;
  permissions: 'read-only';
  threadId: string;
  turnId: string;
  stopRequested: boolean;
  executionStatus: string;
  requiresReview: boolean;
  createdAt: string;
  reportStatus?: string;
}

export interface AssistantState {
  data: AssistantIdentity | null;
  allowedWorkspaces: string[];
  capabilities: AssistantCapabilities;
  mainConversation?: { clientMessageId: string; status: string; threadId: string } | null;
  tasks?: AssistantTaskSummary[];
}

export interface AssistantGatewayOptions {
  signal?: AbortSignal;
}

export interface SaveAssistantIdentityInput {
  name: string;
  cwd: string;
  revision: number | null;
}

export class AssistantGatewayError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'AssistantGatewayError';
    this.status = status;
    // Keep `instanceof` working under ES5-style downleveling.
    Object.setPrototypeOf(this, AssistantGatewayError.prototype);
  }
}

interface AssistantRequest {
  method: 'GET' | 'PUT' | 'POST';
  path?: '/conversation';
  body?: string;
}

/* ------------------------------------------------------------------ *
 * Abort / timeout plumbing
 * ------------------------------------------------------------------ */

function createAbortError(): Error {
  const error = new Error('请求已取消');
  error.name = 'AbortError';
  return error;
}

function isAbortError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

interface RequestGuard {
  signal: AbortSignal;
  didTimeOut(): boolean;
  release(): void;
}

/**
 * One controller per request. The timer and the forwarded external listener
 * live until the caller releases the guard — after the body has been parsed —
 * never earlier, so an abort during body parsing still takes effect.
 */
function createRequestGuard(external?: AbortSignal): RequestGuard {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  if (external) {
    external.addEventListener('abort', forwardAbort);
  }
  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    release: () => {
      clearTimeout(timer);
      if (external) {
        external.removeEventListener('abort', forwardAbort);
      }
    },
  };
}

function sendRequest(
  request: AssistantRequest,
  signal: AbortSignal,
): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (request.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  return fetch(ASSISTANT_ENDPOINT + (request.path ?? ''), {
    method: request.method,
    credentials: 'same-origin',
    headers,
    body: request.body,
    signal,
  });
}

/* ------------------------------------------------------------------ *
 * Error construction
 * ------------------------------------------------------------------ */

function truncate(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > MAX_ERROR_TEXT_LENGTH
    ? `${collapsed.slice(0, MAX_ERROR_TEXT_LENGTH)}…`
    : collapsed;
}

function describeStatus(status: number): string {
  switch (status) {
    case 400:
      return '请求内容无效';
    case 401:
      return '身份验证未通过';
    case 403:
      return '没有权限访问助手配置';
    case 404:
      return '助手配置端点不可用';
    case 409:
      return '助手配置已被其他会话更新';
    case 429:
      return '请求过于频繁';
    default:
      return status >= 500 ? '助手服务暂时不可用' : '助手请求失败';
  }
}

function extractServerMessage(payload: unknown): string | null {
  if (typeof payload === 'string') {
    const text = truncate(payload);
    return text && !text.startsWith('<') ? text : null;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  for (const key of ['error', 'message', 'detail', 'reason']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return truncate(value);
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = (value as Record<string, unknown>).message;
      if (typeof nested === 'string' && nested.trim()) {
        return truncate(nested);
      }
    }
  }
  return null;
}

/**
 * HTTP failures keep their real status (409 included) and carry only the safe
 * server-supplied text; nothing from the request or session is echoed back.
 */
function buildHttpError(
  status: number,
  payload: unknown,
  rawText: string,
): AssistantGatewayError {
  const serverMessage =
    extractServerMessage(payload) ?? extractServerMessage(rawText);
  const summary = describeStatus(status);
  const message = serverMessage
    ? `${summary}：${serverMessage}`
    : `${summary}（HTTP ${status}）`;
  return new AssistantGatewayError(message, status);
}

function fail(content: string, status: number): never {
  throw new AssistantGatewayError(
    `助手服务返回的数据无法识别：${content}`,
    status,
  );
}

/* ------------------------------------------------------------------ *
 * Response validation
 * ------------------------------------------------------------------ */

function asRecord(
  value: unknown,
  status: number,
  message: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(message, status);
  }
  return value as Record<string, unknown>;
}

function requireNonEmptyString(
  value: unknown,
  field: string,
  status: number,
): string {
  if (typeof value !== 'string' || !value.trim()) {
    fail(`${field} 必须是非空字符串`, status);
  }
  return value;
}

function requireIsoTimestamp(
  value: unknown,
  field: string,
  status: number,
): string {
  const text = requireNonEmptyString(value, field, status);
  if (!ISO_TIMESTAMP_PATTERN.test(text) || Number.isNaN(Date.parse(text))) {
    fail(`${field} 必须是合法的 ISO 时间戳`, status);
  }
  return text;
}

const MAX_TASK_COUNT = 100;

function requireBoolean(value: unknown, field: string, status: number): boolean {
  if (typeof value !== 'boolean') {
    fail(`${field} 必须是布尔值`, status);
  }
  return value;
}

function requireBoundedText(
  value: unknown,
  field: string,
  status: number,
  maxLength: number,
  allowEmpty = false,
): string {
  if (typeof value !== 'string' || value.length > maxLength) {
    fail(`${field} 必须是长度不超过 ${maxLength} 的字符串`, status);
  }
  if (!allowEmpty && !value.trim()) {
    fail(`${field} 必须是非空字符串`, status);
  }
  return value;
}

function parseTaskSummary(
  value: unknown,
  status: number,
): AssistantTaskSummary {
  const record = asRecord(value, status, 'tasks 条目不是一个对象');
  if (record.permissions !== 'read-only') {
    fail('tasks.permissions 必须是 read-only', status);
  }
  const task: AssistantTaskSummary = {
    taskId: requireBoundedText(record.taskId, 'tasks.taskId', status, 100),
    title: requireBoundedText(record.title, 'tasks.title', status, 160),
    permissions: 'read-only',
    threadId: requireBoundedText(record.threadId, 'tasks.threadId', status, 200, true),
    turnId: requireBoundedText(record.turnId, 'tasks.turnId', status, 200, true),
    stopRequested: requireBoolean(record.stopRequested, 'tasks.stopRequested', status),
    executionStatus: requireBoundedText(record.executionStatus, 'tasks.executionStatus', status, 80),
    requiresReview: requireBoolean(record.requiresReview, 'tasks.requiresReview', status),
    createdAt: requireIsoTimestamp(record.createdAt, 'tasks.createdAt', status),
  };
  if (record.reportStatus !== undefined) {
    task.reportStatus = requireBoundedText(record.reportStatus, 'tasks.reportStatus', status, 80);
  }
  return task;
}

function parseTasks(
  value: unknown,
  status: number,
): AssistantTaskSummary[] {
  if (!Array.isArray(value)) {
    fail('tasks 必须是数组', status);
  }
  if (value.length > MAX_TASK_COUNT) {
    fail(`tasks 不能超过 ${MAX_TASK_COUNT} 条`, status);
  }
  return value.map((entry) => parseTaskSummary(entry, status));
}

function parseAssistantIdentity(
  value: unknown,
  status: number,
): AssistantIdentity {
  const record = asRecord(value, status, 'identity 不是一个对象');
  const assistantId = requireNonEmptyString(
    record.assistantId,
    'assistantId',
    status,
  );
  const name = requireNonEmptyString(record.name, 'name', status);
  const cwd = requireNonEmptyString(record.cwd, 'cwd', status);
  const revision = record.revision;
  if (
    typeof revision !== 'number' ||
    !Number.isSafeInteger(revision) ||
    revision < 1
  ) {
    fail('revision 必须是大于等于 1 的整数', status);
  }
  const createdAt = requireIsoTimestamp(record.createdAt, 'createdAt', status);
  const updatedAt = requireIsoTimestamp(record.updatedAt, 'updatedAt', status);
  const mainThreadId = record.mainThreadId == null ? null
    : requireNonEmptyString(record.mainThreadId, 'mainThreadId', status);
  return {
    assistantId,
    name,
    cwd,
    revision,
    createdAt,
    updatedAt,
    mainThreadId,
  };
}

function parseWorkspaceList(value: unknown, status: number): string[] {
  if (value === undefined || value === null) {
    fail('响应缺少可选工作区列表', status);
  }
  if (!Array.isArray(value)) {
    fail('可选工作区必须是字符串数组', status);
  }
  return value.map((entry, index) =>
    requireNonEmptyString(entry, `可选工作区[${index}]`, status),
  );
}

function parseCapabilities(
  value: unknown,
  status: number,
): AssistantCapabilities {
  if (value === undefined || value === null) {
    return { conversation: false, dispatch: false, backgroundExecution: false };
  }
  const record = asRecord(value, status, 'capabilities 不是一个对象');
  const keys = ['conversation', 'dispatch', 'backgroundExecution'] as const;
  for (const key of keys) {
    if (record[key] !== undefined && typeof record[key] !== 'boolean') fail(`capabilities.${key} 必须是布尔值`, status);
  }
  if (record.resultReturn !== undefined && typeof record.resultReturn !== 'boolean') fail('capabilities.resultReturn 必须是布尔值', status);
  // 服务端当前不应宣称 dispatch 已就绪；一旦接受，AssistantPage 会直接进入派发分支。
  if (record.dispatch === true) fail('服务端声明了未开放的 dispatch 能力', status);
  const capabilities: AssistantCapabilities = {
    conversation: record.conversation === true,
    dispatch: false,
    backgroundExecution: record.backgroundExecution === true,
  };
  if (record.resultReturn !== undefined) {
    capabilities.resultReturn = record.resultReturn === true;
  }
  return capabilities;
}

function parseAssistantState(payload: unknown, status: number): AssistantState {
  const record = asRecord(payload, status, '响应不是一个对象');
  const hasData = 'data' in record;
  if (!hasData && !('assistant' in record)) {
    fail('响应缺少 data 字段', status);
  }
  const identityValue = hasData ? record.data : record.assistant;
  const data =
    identityValue === null || identityValue === undefined
      ? null
      : parseAssistantIdentity(identityValue, status);
  const workspaceValue =
    record.allowedWorkspaces !== undefined
      ? record.allowedWorkspaces
      : record.roots;
  const allowedWorkspaces = parseWorkspaceList(workspaceValue, status);
  const capabilities = parseCapabilities(record.capabilities, status);
  const tasks =
    record.tasks === undefined ? undefined : parseTasks(record.tasks, status);
  const main = record.mainConversation;
  let mainConversation: AssistantState['mainConversation'] = null;
  if (main != null) {
    const row = asRecord(main, status, '主对话状态无效');
    mainConversation = {
      clientMessageId: requireNonEmptyString(row.clientMessageId, 'clientMessageId', status),
      status: requireNonEmptyString(row.status, 'status', status),
      threadId: typeof row.threadId === 'string' ? row.threadId : '',
    };
  }
  return {
    data,
    allowedWorkspaces,
    capabilities,
    ...(main === undefined ? {} : { mainConversation }),
    ...(tasks === undefined ? {} : { tasks }),
  };
}

function tryParseJson(
  text: string,
): { parsed: true; value: unknown } | { parsed: false } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { parsed: true, value: null };
  }
  try {
    return { parsed: true, value: JSON.parse(trimmed) as unknown };
  } catch {
    return { parsed: false };
  }
}

async function readBodyText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    throw new AssistantGatewayError('读取助手服务响应失败', response.status);
  }
}

async function parseStateResponse(response: Response): Promise<AssistantState> {
  const text = await readBodyText(response);
  const json = tryParseJson(text);
  if (!response.ok) {
    throw buildHttpError(response.status, json.parsed ? json.value : null, text);
  }
  if (!json.parsed) {
    fail('响应不是合法的 JSON', response.status);
  }
  return parseAssistantState(json.value, response.status);
}

/* ------------------------------------------------------------------ *
 * Request orchestration
 * ------------------------------------------------------------------ */

async function withAssistantRequest<T>(
  request: AssistantRequest,
  options: AssistantGatewayOptions,
  parse: (response: Response) => Promise<T>,
): Promise<T> {
  const externalSignal = options.signal;
  // A pre-aborted signal never reaches the network.
  if (externalSignal?.aborted) {
    throw createAbortError();
  }

  const guard = createRequestGuard(externalSignal);
  try {
    let response = await sendRequest(request, guard.signal);

    // Same mobile-shell recovery pattern as the other gateways: only when the
    // response itself asks for it, at most once, and without touching tokens.
    if (!response.ok && shouldAutoLoginForResponse(response)) {
      let canRetry = false;
      try {
        const outcome: unknown = await tryMobileShellAutoLogin();
        canRetry = outcome !== false;
      } catch {
        canRetry = false;
      }
      if (canRetry && !guard.signal.aborted) {
        response = await sendRequest(request, guard.signal);
      }
    }

    return await parse(response);
  } catch (error) {
    if (isAbortError(error)) {
      throw guard.didTimeOut()
        ? new AssistantGatewayError('请求超时，请重试', 0)
        : error;
    }
    if (error instanceof AssistantGatewayError) {
      throw error;
    }
    throw new AssistantGatewayError('无法连接助手服务，请检查网络后重试', 0);
  } finally {
    guard.release();
  }
}

function buildSavePayload(input: SaveAssistantIdentityInput): {
  name: string;
  cwd: string;
  revision: number | null;
} {
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  const cwd = typeof input?.cwd === 'string' ? input.cwd.trim() : '';
  if (!name) {
    throw new AssistantGatewayError('请填写助手名称', 0);
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new AssistantGatewayError(
      `助手名称不能超过 ${MAX_NAME_LENGTH} 个字符`,
      0,
    );
  }
  if (!cwd) {
    throw new AssistantGatewayError('请选择工作区', 0);
  }
  const revision = input?.revision ?? null;
  if (
    revision !== null &&
    (typeof revision !== 'number' ||
      !Number.isSafeInteger(revision) ||
      revision < 1)
  ) {
    throw new AssistantGatewayError(
      'revision 必须是大于等于 1 的整数或 null',
      0,
    );
  }
  // Exactly three keys on the wire — nothing else is ever sent.
  return { name, cwd, revision };
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

export async function getAssistantState(
  options: AssistantGatewayOptions = {},
): Promise<AssistantState> {
  return withAssistantRequest(
    { method: 'GET' },
    options,
    parseStateResponse,
  );
}

export async function saveAssistantIdentity(
  input: SaveAssistantIdentityInput,
  options: AssistantGatewayOptions = {},
): Promise<AssistantState> {
  const payload = buildSavePayload(input);
  return withAssistantRequest(
    { method: 'PUT', body: JSON.stringify(payload) },
    options,
    parseStateResponse,
  );
}

export async function beginAssistantConversation(
  input: { revision: number; clientMessageId: string; text: string },
  options: AssistantGatewayOptions = {},
): Promise<AssistantState> {
  return withAssistantRequest(
    { method: 'POST', path: '/conversation', body: JSON.stringify({ revision: input.revision, clientMessageId: input.clientMessageId, text: input.text }) },
    options,
    parseStateResponse,
  );
}
