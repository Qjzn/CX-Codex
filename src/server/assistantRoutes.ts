import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { setJson } from './httpJsonResponse.js';
import { getCodexGlobalStatePath } from './codexPaths.js';
import { readWorkspaceRootsState } from './workspaceRootsState.js';
import type { RuntimeStore, AssistantIdentityRecord } from './runtimeStore.js';

export interface AssistantRoutesDependencies {
  runtimeStore: Pick<
    RuntimeStore,
    | 'readAssistantIdentity'
    | 'writeAssistantIdentity'
    | 'readAssistantMainConversation'
    | 'reserveAssistantMainConversation'
    | 'getLatestRequestByClientMessageId'
  >;
  readJsonBody: (req: IncomingMessage) => Promise<unknown>;
  readAllowedWorkspaces?: () => Promise<string[]>;
  readMainThreadId?: () => string;
  readTasks?: () => unknown[];
  supportsDispatch?: () => boolean;
  supportsResultReturn?: () => boolean;
  /**
   * Assistant main-conversation backend entry point.
   *
   * This hook MUST already be a role-restricted backend entry: the implementation is
   * responsible for enforcing the assistant role at the boundary before any turn is
   * started. The ordinary runtime turn starter (`startRuntimeTurn`) is deliberately
   * NOT used for the assistant conversation and must never be injected here - it has
   * no strict role enforcement, so wiring it in would expose ordinary runtime turns
   * as if they were the assistant main conversation.
   *
   * The production bridge supplies the hardened assistant starter together with
   * persisted role enforcement at the native RPC and approval boundaries. Tests
   * may supply a synthetic implementation. A missing hook keeps capability false
   * and answers 503 before any reservation; readiness is never client-configurable.
   */
  startAssistantConversation?: (payload: unknown) => Promise<{ status: string }>;
}

export const ASSISTANT_PATHNAME = '/codex-api/assistant';
export const ASSISTANT_CONVERSATION_PATHNAME = '/codex-api/assistant/conversation';
export const ASSISTANT_MAIN_CLIENT_MESSAGE_PREFIX = 'assistant-main:';

const STALE_REVISION_ERROR = '当前修订版本已过期，请刷新后使用最新的 revision 重新提交';

// The reservation/write conflict reason decides the wording: not every conflict is a
// stale revision. `reserved` means the main conversation already exists (or is being
// verified), `workspace` means the bound workspace cannot be switched, `revision`
// means the stored assistant configuration has moved on.
const CONFLICT_MESSAGE_BY_REASON: Record<string, string> = {
  reserved: '助手主对话已创建或正在核对，请刷新查看',
  workspace: '主对话已绑定工作区，暂不支持切换',
  revision: '助手配置已更新，请刷新后重试',
};
// Used when a conflict reason is absent or unrecognised: the claim still failed, so
// the state changed and the client has to refresh, but the reason itself is unknown.
const RESERVE_CONFLICT_FALLBACK_ERROR = '助手主对话状态已变化，请刷新后重试';
// Generic conversation-read failure. Never carries payload or underlying error text.
const CONVERSATION_READ_ERROR = '读取助手会话失败，请刷新后核对';

export function isAssistantPathname(pathname: string): boolean {
  return pathname === ASSISTANT_PATHNAME || pathname === ASSISTANT_CONVERSATION_PATHNAME;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

async function defaultReadAllowedWorkspaces(): Promise<string[]> {
  const roots = await readWorkspaceRootsState(getCodexGlobalStatePath());
  const seen = new Set<string>();
  const out: string[] = [];
  const candidates: string[] = [
    ...(Array.isArray(roots?.order) ? roots.order : []),
    ...(Array.isArray(roots?.active) ? roots.active : []),
  ];
  for (const candidate of candidates) {
    if (!isNonEmptyString(candidate)) continue;
    const trimmed = candidate.trim();
    const key = toWindowsComparable(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function toWindowsComparable(value: string): string {
  let key = value.replace(/\\/g, '/');
  const isUnc = /^\/\//.test(key);
  const isDrive = /^[A-Za-z]:\//.test(key);
  if (isDrive || isUnc) {
    key = key.replace(/\/+$/, '');
    if (isDrive && /^[A-Za-z]:$/.test(key)) key += '/';
    return key.toLowerCase();
  }
  if (key === '/') return key;
  key = key.replace(/\/+$/, '');
  return key.length === 0 ? '/' : key;
}

interface ParsedPutBody {
  name: string;
  cwd: string;
  revision: number | null;
}

type ParseResult = { ok: true; value: ParsedPutBody } | { ok: false };

const BODY_KEYS = ['name', 'cwd', 'revision'] as const;

function parsePutBody(raw: unknown, allowed: string[]): ParseResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false };
  const record = raw as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== BODY_KEYS.length) return { ok: false };
  for (const key of BODY_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) return { ok: false };
  }
  for (const key of keys) {
    if (!(BODY_KEYS as readonly string[]).includes(key)) return { ok: false };
  }

  const rawName = record.name;
  if (typeof rawName !== 'string') return { ok: false };
  const name = rawName.trim();
  if (name.length < 1 || name.length > 80) return { ok: false };

  const rawCwd = record.cwd;
  if (typeof rawCwd !== 'string') return { ok: false };
  const cwd = rawCwd.trim();
  if (cwd.length === 0) return { ok: false };

  const canonicalCwd = matchConfiguredCwd(cwd, allowed);
  if (canonicalCwd === null) return { ok: false };

  const rawRevision = record.revision;
  let revision: number | null;
  if (rawRevision === null) {
    revision = null;
  } else if (typeof rawRevision === 'number' && Number.isSafeInteger(rawRevision) && rawRevision >= 1) {
    revision = rawRevision;
  } else {
    return { ok: false };
  }

  return { ok: true, value: { name, cwd: canonicalCwd, revision } };
}

function matchConfiguredCwd(cwd: string, allowed: string[]): string | null {
  const target = toWindowsComparable(cwd);
  for (const candidate of allowed) {
    if (!isNonEmptyString(candidate)) continue;
    const trimmed = candidate.trim();
    if (toWindowsComparable(trimmed) === target) return trimmed;
  }
  return null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONVERSATION_BODY_KEYS = ['revision', 'clientMessageId', 'text'] as const;
const MAX_PROMPT_LENGTH = 16000;

interface ParsedConversationBody {
  revision: number;
  clientMessageId: string;
  text: string;
}

type ConversationParseResult = { ok: true; value: ParsedConversationBody } | { ok: false };

function parseConversationBody(raw: unknown): ConversationParseResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false };
  const record = raw as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== CONVERSATION_BODY_KEYS.length) return { ok: false };
  for (const key of CONVERSATION_BODY_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) return { ok: false };
  }
  for (const key of keys) {
    if (!(CONVERSATION_BODY_KEYS as readonly string[]).includes(key)) return { ok: false };
  }

  const rawRevision = record.revision;
  if (typeof rawRevision !== 'number' || !Number.isSafeInteger(rawRevision) || rawRevision < 1) {
    return { ok: false };
  }

  const rawClientMessageId = record.clientMessageId;
  if (typeof rawClientMessageId !== 'string' || !UUID_PATTERN.test(rawClientMessageId)) {
    return { ok: false };
  }

  const rawText = record.text;
  if (typeof rawText !== 'string') return { ok: false };
  const text = rawText.trim();
  if (text.length < 1 || text.length > MAX_PROMPT_LENGTH) return { ok: false };

  return { ok: true, value: { revision: rawRevision, clientMessageId: rawClientMessageId, text } };
}

async function readAllowedWorkspaceList(
  dependencies: AssistantRoutesDependencies,
): Promise<string[]> {
  const reader = dependencies.readAllowedWorkspaces ?? defaultReadAllowedWorkspaces;
  const rawAllowed = await reader();
  if (!Array.isArray(rawAllowed)) return [];
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const entry of rawAllowed) {
    if (!isNonEmptyString(entry)) continue;
    const trimmed = entry.trim();
    const key = toWindowsComparable(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(trimmed);
  }
  return deduped;
}

// The identity record is read defensively so a record without a revision field
// is treated as unversioned instead of breaking the request.
function readIdentityRevision(identity: AssistantIdentityRecord): number | null {
  const value = (identity as unknown as { revision?: unknown }).revision;
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function readConflictReason(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return null;
  return (value as Record<string, unknown>).reason;
}

function resolveConflictMessage(reason: unknown, fallback: string): string {
  if (typeof reason !== 'string') return fallback;
  if (!Object.prototype.hasOwnProperty.call(CONFLICT_MESSAGE_BY_REASON, reason)) return fallback;
  const message = CONFLICT_MESSAGE_BY_REASON[reason];
  return typeof message === 'string' ? message : fallback;
}

/**
 * Guards the thread link: a reservation may only surface a conversation when it
 * belongs to this very assistant identity and to the same (canonical) cwd. A malformed
 * or foreign reservation throws instead of being silently reported as "no main
 * conversation", so a caller never receives a thread link it does not own.
 */
function assertMainConversationBinding(
  reservation: unknown,
  identity: AssistantIdentityRecord,
): void {
  const record = (reservation ?? {}) as Record<string, unknown>;
  const assistantId = record.assistantId;
  const cwd = record.cwd;
  const clientMessageId = record.clientMessageId;
  if (
    typeof assistantId !== 'string' ||
    typeof cwd !== 'string' ||
    typeof clientMessageId !== 'string' ||
    clientMessageId.trim().length === 0
  ) {
    throw new Error('assistant main conversation reservation is malformed');
  }
  if (assistantId !== identity.assistantId) {
    throw new Error('assistant main conversation belongs to a different assistant identity');
  }
  if (toWindowsComparable(cwd) !== toWindowsComparable(identity.cwd)) {
    throw new Error('assistant main conversation belongs to a different workspace');
  }
}

/**
 * Builds the assistant envelope.
 *
 * Reservation and request read failures are deliberately NOT swallowed here: catching
 * them would make an unreadable conversation look like "no main conversation". The
 * error propagates and each route decides how to translate it - GET/PUT through their
 * existing generic 500 handling, conversation POST through the safe helper below.
 */
async function envelope(
  dependencies: AssistantRoutesDependencies,
  identity: AssistantIdentityRecord | null,
  allowedWorkspaces: string[],
): Promise<Record<string, unknown>> {
  let mainConversation: Record<string, unknown> | null = null;
  let mainThreadId: string | null = null;
  if (identity) {
    const reservation = dependencies.runtimeStore.readAssistantMainConversation();
    if (reservation) {
      assertMainConversationBinding(reservation, identity);
      const request = dependencies.runtimeStore.getLatestRequestByClientMessageId(
        reservation.clientMessageId,
      );
      const status = request && isNonEmptyString(request.status) ? request.status : null;
      const requestThreadId = request && isNonEmptyString(request.threadId) ? request.threadId : null;
      const registeredThreadId = dependencies.readMainThreadId?.() || null;
      if (requestThreadId && registeredThreadId && requestThreadId !== registeredThreadId) throw new Error('Assistant binding conflict');
      const threadId = registeredThreadId || requestThreadId;
      mainThreadId = threadId;
      mainConversation = {
        clientMessageId: reservation.clientMessageId,
        status: status ?? (threadId ? 'bound' : 'start_uncertain'),
        threadId: threadId ?? '',
      };
    }
  }
  return {
    data: identity ? { ...identity, mainThreadId } : null,
    allowedWorkspaces,
    capabilities: {
      // Derived from the verified assistant hook alone; a missing hook means the
      // assistant main conversation is not ready. No client-configurable override.
      conversation: typeof dependencies.startAssistantConversation === 'function',
      dispatch: dependencies.supportsDispatch?.() === true,
      backgroundExecution: dependencies.supportsDispatch?.() === true,
      ...(dependencies.supportsResultReturn ? { resultReturn: dependencies.supportsResultReturn() === true } : {}),
    },
    mainConversation,
    ...(dependencies.readTasks ? { tasks: dependencies.readTasks() } : {}),
  };
}

/**
 * Writes an envelope response for the assistant conversation route.
 *
 * Every conversation-path envelope write goes through here, so an envelope failure can
 * never escape as an unhandled exception once a send has been claimed. The failure is
 * reported as a generic 500 without leaking payload or error detail. This helper only
 * writes a response - it never starts or retries a turn - so it stays safe to call
 * after a claimed send.
 */
async function respondConversationEnvelope(
  res: ServerResponse,
  status: number,
  dependencies: AssistantRoutesDependencies,
  identity: AssistantIdentityRecord | null,
  allowedWorkspaces: string[],
  extra?: Record<string, unknown>,
): Promise<void> {
  try {
    const body = await envelope(dependencies, identity, allowedWorkspaces);
    setJson(res, status, extra ? { ...body, ...extra } : body);
  } catch {
    setJson(res, 500, { error: CONVERSATION_READ_ERROR });
  }
}

export async function handleAssistantRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  dependencies: AssistantRoutesDependencies,
): Promise<boolean> {
  const isConversation = url.pathname === ASSISTANT_CONVERSATION_PATHNAME;
  if (!isConversation && url.pathname !== ASSISTANT_PATHNAME) return false;

  const method = (req.method || 'GET').toUpperCase();

  if (isConversation) {
    if (method !== 'POST') {
      res.setHeader('Allow', 'POST');
      setJson(res, 405, { error: 'Only POST is supported' });
      return true;
    }
    return handleAssistantConversation(req, res, dependencies);
  }

  if (method !== 'GET' && method !== 'PUT') {
    res.setHeader('Allow', 'GET, PUT');
    setJson(res, 405, { error: 'Only GET and PUT are supported' });
    return true;
  }

  let allowedWorkspaces: string[];
  try {
    allowedWorkspaces = await readAllowedWorkspaceList(dependencies);
  } catch {
    setJson(res, 503, { error: '工作区配置暂不可用，请稍后重试' });
    return true;
  }

  if (method === 'GET') {
    try {
      const record = dependencies.runtimeStore.readAssistantIdentity();
      setJson(res, 200, await envelope(dependencies, record, allowedWorkspaces));
    } catch {
      // Includes envelope failures (unreadable or foreign conversation): generic 500.
      setJson(res, 500, { error: '读取助手信息失败，请稍后重试' });
    }
    return true;
  }

  let raw: unknown;
  try {
    raw = await dependencies.readJsonBody(req);
  } catch {
    setJson(res, 400, { error: '请求体无效，请提供合法的 JSON 对象' });
    return true;
  }

  const parsed = parsePutBody(raw, allowedWorkspaces);
  if (!parsed.ok) {
    setJson(res, 400, { error: '请求体无效，请提供合法的 JSON 对象' });
    return true;
  }

  try {
    const result = dependencies.runtimeStore.writeAssistantIdentity({
      name: parsed.value.name,
      cwd: parsed.value.cwd,
      revision: parsed.value.revision,
    });
    if (result.status === 'conflict') {
      // A conflicting write is not necessarily a stale revision: a cwd conflict with
      // an existing main conversation carries its own wording.
      setJson(res, 409, {
        ...(await envelope(dependencies, result.identity, allowedWorkspaces)),
        error: resolveConflictMessage(readConflictReason(result), STALE_REVISION_ERROR),
      });
      return true;
    }
    setJson(res, 200, await envelope(dependencies, result.identity, allowedWorkspaces));
  } catch {
    // Includes envelope failures: generic 500, never a leaked payload.
    setJson(res, 500, { error: '保存助手信息失败，请稍后重试' });
  }
  return true;
}

async function handleAssistantConversation(
  req: IncomingMessage,
  res: ServerResponse,
  dependencies: AssistantRoutesDependencies,
): Promise<boolean> {
  let allowedWorkspaces: string[];
  try {
    allowedWorkspaces = await readAllowedWorkspaceList(dependencies);
  } catch {
    setJson(res, 503, { error: '工作区配置暂不可用，请稍后重试' });
    return true;
  }

  let raw: unknown;
  try {
    raw = await dependencies.readJsonBody(req);
  } catch {
    setJson(res, 400, { error: '请求体无效，请提供合法的 JSON 对象' });
    return true;
  }

  const parsed = parseConversationBody(raw);
  if (!parsed.ok) {
    setJson(res, 400, { error: '请求体无效，请提供合法的 JSON 对象' });
    return true;
  }

  let identity: AssistantIdentityRecord | null;
  try {
    identity = dependencies.runtimeStore.readAssistantIdentity();
  } catch {
    setJson(res, 500, { error: '读取助手信息失败，请稍后重试' });
    return true;
  }

  if (!identity) {
    await respondConversationEnvelope(res, 409, dependencies, null, allowedWorkspaces, {
      error: '尚未配置助手身份，请先完成助手配置后再继续',
    });
    return true;
  }

  const currentRevision = readIdentityRevision(identity);
  // Any mismatch - lower or higher - means the client is not on the current revision,
  // so it is answered with the stale-revision 409. This runs before the missing-starter
  // check: revision correctness is validated before the capability is consulted.
  if (currentRevision !== null && parsed.value.revision !== currentRevision) {
    await respondConversationEnvelope(res, 409, dependencies, identity, allowedWorkspaces, {
      error: STALE_REVISION_ERROR,
    });
    return true;
  }

  const startAssistantConversation = dependencies.startAssistantConversation;
  if (typeof startAssistantConversation !== 'function') {
    // No verified role-restricted assistant entry point is wired (the production
    // default): refuse before any reservation is attempted.
    setJson(res, 503, { error: '助手主对话尚未就绪，请稍后重试' });
    return true;
  }

  const clientMessageId = `${ASSISTANT_MAIN_CLIENT_MESSAGE_PREFIX}${parsed.value.clientMessageId}`;
  const promptHash = createHash('sha256').update(parsed.value.text).digest('hex');

  let reservation: { status: string; reason?: unknown };
  try {
    reservation = dependencies.runtimeStore.reserveAssistantMainConversation({
      assistantId: identity.assistantId,
      revision: parsed.value.revision,
      cwd: identity.cwd,
      clientMessageId,
      promptHash,
    });
  } catch {
    setJson(res, 500, { error: '创建助手会话失败，请稍后重试' });
    return true;
  }

  if (reservation.status === 'conflict') {
    // The atomic claim stays authoritative: no retry and no second reservation.
    await respondConversationEnvelope(res, 409, dependencies, identity, allowedWorkspaces, {
      error: resolveConflictMessage(readConflictReason(reservation), RESERVE_CONFLICT_FALLBACK_ERROR),
    });
    return true;
  }

  // Only the 'claimed' winner may send; 'existing' replays the current state and never resends.
  if (reservation.status === 'existing') {
    await respondConversationEnvelope(res, 202, dependencies, identity, allowedWorkspaces);
    return true;
  }

  try {
    await startAssistantConversation({
      cwd: identity.cwd,
      clientMessageId,
      input: [{ type: 'text', text: parsed.value.text }],
    });
  } catch {
    // The turn may still be running or may never have started; the outcome is unknown,
    // so report the current state and do not retry or reserve a new client message id.
    await respondConversationEnvelope(res, 202, dependencies, identity, allowedWorkspaces, {
      notice: '助手运行状态暂不确定，请稍后刷新确认',
    });
    return true;
  }

  await respondConversationEnvelope(res, 202, dependencies, identity, allowedWorkspaces);
  return true;
}
