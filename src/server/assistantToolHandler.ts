import type { RuntimeRequestRecord } from './runtimeStore.js';
import type { AssistantTaskLedger, AssistantTaskRecord } from './assistantTaskLedger.js';
import {
  authorizeAssistantToolCall,
  type AuthorizedAssistantToolCall,
} from './assistantCoordinationTools.js';

/**
 * Trusted handlers for the assistant coordination tools.
 *
 * Authorization of every call is delegated to `authorizeAssistantToolCall`
 * against backend-owned request rows; native params are never trusted on
 * their own. This module performs no execution, no transports and owns no
 * timers. Task lifecycle bookkeeping stays in the ledger.
 */

const GENERIC_ERROR = '助手协调请求已拒绝';
const MAX_SOURCE_TEXT_LENGTH = 12000;
const MAX_INSTRUCTIONS_LENGTH = 12000;
const ATTACHMENT_ERROR = '当前消息包含图片、文件或其他非文本内容，只读任务暂不支持';
const STALE_ERROR = '任务来源已失效，请重试';
const THREAD_ERROR = '当前主线程状态已变化，无法派发任务';

class SafeError extends Error {}

function reject(message: string = GENERIC_ERROR): never {
  throw new SafeError(message);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonBlankString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

function findSource(
  requests: RuntimeRequestRecord[],
  auth: AuthorizedAssistantToolCall,
): RuntimeRequestRecord {
  const matches = requests.filter(
    (request) => isRecord(request) && request.requestId === auth.sourceRequestId,
  );
  if (matches.length !== 1) reject(STALE_ERROR);
  const source = matches[0];
  if (source.threadId !== auth.threadId || source.turnId !== auth.turnId) reject(STALE_ERROR);
  if (source.status !== 'running') reject(STALE_ERROR);
  return source;
}

function readPayloadModel(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const model = payload.model;
  return isNonBlankString(model) ? model : null;
}

function readSourceText(response: unknown, threadId: string, turnId: string): string {
  if (!isRecord(response) || !isRecord(response.thread)) reject(THREAD_ERROR);
  const thread = response.thread;
  if (thread.id !== threadId || !Array.isArray(thread.turns)) reject(THREAD_ERROR);

  const turns = thread.turns.filter(
    (turn): turn is Record<string, unknown> => isRecord(turn) && turn.id === turnId,
  );
  if (turns.length !== 1) reject(THREAD_ERROR);
  const turn = turns[0];
  if (turn.status !== 'inProgress') reject(THREAD_ERROR);

  if (!Array.isArray(turn.items)) reject(THREAD_ERROR);
  const userMessages = turn.items.filter(
    (item): item is Record<string, unknown> => isRecord(item) && item.type === 'userMessage',
  );
  if (userMessages.length !== 1) reject(THREAD_ERROR);

  const content = userMessages[0].content;
  if (!Array.isArray(content)) reject(THREAD_ERROR);

  const parts: string[] = [];
  for (const part of content) {
    if (!isRecord(part) || part.type !== 'text' || typeof part.text !== 'string') {
      reject(ATTACHMENT_ERROR);
    }
    parts.push(part.text);
  }

  const text = parts.join('\n');
  if (text.trim().length === 0) reject('来源消息内容为空，无法派发任务');
  if (text.length > MAX_SOURCE_TEXT_LENGTH) reject('来源消息过长，无法派发任务');
  return text;
}

const buildInstructions = (workerBrief: string, sourceText: string, delegated: string): string => {
  if (!isNonBlankString(workerBrief)) reject(GENERIC_ERROR);
  const instructions = [
    '[assistant-worker-brief]',
    workerBrief,
    '[/assistant-worker-brief]',
    '[assistant-source-message]',
    sourceText,
    '[/assistant-source-message]',
    '[assistant-delegated-instructions]',
    delegated,
    '[/assistant-delegated-instructions]',
  ].join('\n');
  if (instructions.trim().length === 0 || instructions.length > MAX_INSTRUCTIONS_LENGTH) {
    reject('任务提示超过长度上限，无法派发');
  }
  return instructions;
};

export interface AssistantToolHandlerDeps {
  ledger: AssistantTaskLedger;
  readIdentity: () => { assistantId: string; cwd: string } | null;
  readMainThreadId: () => string;
  listMainRequests: () => RuntimeRequestRecord[];
  readThread: (threadId: string) => Promise<unknown>;
  readDefaultModel: () => Promise<string>;
  assetsHash: string;
  workerBrief: string;
  getExecution: (clientMessageId: string) => RuntimeRequestRecord | null;
  onChanged: () => void;
}

export function createAssistantToolHandler(deps: AssistantToolHandlerDeps): {
  handle(method: string, params: unknown): Promise<unknown>;
  list(): unknown[];
} {
  const executionStatus = (task: AssistantTaskRecord): string => {
    const status = deps.getExecution(task.executionClientMessageId)?.status;
    if (status === 'completed' && deps.ledger.readCoordinator(task.contract.assistantId)?.activeTaskId === task.taskId) return 'verifying';
    return status ?? (task.boundaries.thread || task.boundaries.turn ? 'unknown' : task.stopRequested ? 'stopped' : 'queued');
  };

  const list = (): unknown[] => {
    const identity = deps.readIdentity();
    if (!identity || !isNonBlankString(identity.assistantId)) return [];
    return deps.ledger.listTasks(identity.assistantId).map((task) => ({
      taskId: task.taskId,
      title: task.contract.title,
      permissions: task.contract.permissions,
      threadId: task.threadId,
      turnId: task.turnId,
      stopRequested: task.stopRequested,
      executionStatus: executionStatus(task),
      requiresReview: (task.boundaries.thread && task.threadId === '')
        || (task.boundaries.turn && task.turnId === '')
        || ['unknown', 'start_uncertain', 'interrupt_uncertain'].includes(executionStatus(task))
        || task.report?.status === 'attention'
        || (task.report?.writeStarted === true && !task.report.turnId),
      reportStatus: task.report?.status === 'pending' ? (task.report.writeStarted && !task.report.turnId ? 'unknown' : 'pending') : task.report?.status ?? 'awaiting_result',
      createdAt: task.createdAt,
    }));
  };

  const dispatch = async (
    auth: AuthorizedAssistantToolCall,
    identity: { assistantId: string; cwd: string },
    method: string,
    params: unknown,
    initialRequests: RuntimeRequestRecord[],
  ): Promise<unknown> => {
    if (auth.origin !== 'user') reject(GENERIC_ERROR);

    const source = findSource(initialRequests, auth);

    const threadId = deps.readMainThreadId();
    if (threadId !== auth.threadId) reject(STALE_ERROR);
    const sourceText = readSourceText(await deps.readThread(threadId), auth.threadId, auth.turnId);

    let model = readPayloadModel(source.payload);
    if (model === null) model = await deps.readDefaultModel();
    if (!isNonBlankString(model)) reject(GENERIC_ERROR);

    // Re-read backend state after the async native reads: the source request
    // must still be the same single running request before anything freezes.
    const freshRequests = deps.listMainRequests();
    const again = authorizeAssistantToolCall({
      method,
      params,
      mainThreadId: deps.readMainThreadId(),
      requests: freshRequests,
    });
    if (
      again.tool !== auth.tool ||
      again.sourceRequestId !== auth.sourceRequestId ||
      again.threadId !== auth.threadId ||
      again.turnId !== auth.turnId ||
      again.sourceClientMessageId !== auth.sourceClientMessageId
    ) {
      reject(STALE_ERROR);
    }
    findSource(freshRequests, again);

    const delegated = auth.arguments.instructions;
    const title = auth.arguments.title;
    const relatedTaskId = auth.arguments.relatedTaskId;
    if (typeof delegated !== 'string' || typeof title !== 'string') reject(GENERIC_ERROR);

    const instructions = buildInstructions(deps.workerBrief, sourceText, delegated);
    const record = deps.ledger.accept({
      assistantId: identity.assistantId,
      sourceRequestId: auth.sourceRequestId,
      sourceThreadId: auth.threadId,
      sourceTurnId: auth.turnId,
      sourceText,
      title,
      instructions,
      cwd: identity.cwd,
      model,
      permissions: 'read-only',
      assetsHash: deps.assetsHash,
      relatedTaskId: typeof relatedTaskId === 'string' ? relatedTaskId : null,
    });
    deps.onChanged();
    return { taskId: record.taskId, status: 'accepted', contractHash: record.contractHash };
  };

  const handle = async (method: string, params: unknown): Promise<unknown> => {
    try {
      const identity = deps.readIdentity();
      if (!identity || !isNonBlankString(identity.assistantId) || !isNonBlankString(identity.cwd)) {
        reject(GENERIC_ERROR);
      }
      if (typeof method !== 'string') reject(GENERIC_ERROR);
      const mainThreadId = deps.readMainThreadId();
      if (!isNonBlankString(mainThreadId)) reject(GENERIC_ERROR);

      const requests = deps.listMainRequests();
      const auth = authorizeAssistantToolCall({ method, params, mainThreadId, requests });
      deps.ledger.claimHost(identity.assistantId);

      if (auth.tool === 'assistant_read_tasks') {
        return { tasks: list() };
      }

      if (auth.tool === 'assistant_stop_task') {
        const taskId = auth.arguments.taskId;
        if (typeof taskId !== 'string') reject(GENERIC_ERROR);
        const task = deps.ledger.readTask(taskId);
        if (!task || task.contract.assistantId !== identity.assistantId) {
          reject('任务不存在或不属于当前助手');
        }
        deps.ledger.requestStop(taskId);
        deps.onChanged();
        return { taskId, stopRequested: true };
      }

      return await dispatch(auth, identity, method, params, requests);
    } catch (error) {
      if (error instanceof SafeError) throw error;
      throw new SafeError(GENERIC_ERROR);
    }
  };

  return { handle, list };
}
