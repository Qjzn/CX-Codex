import type { AssistantTaskLedger, AssistantTaskRecord, AssistantTaskReport } from './assistantTaskLedger.js';
import type { RuntimeRequestRecord } from './runtimeStore.js';

// Coalesced assistant report delivery. It freezes worker receipts into the
// ledger, hands the frozen report to the existing runtime queue and settles it
// from exact native turn receipts. No new database, queue, timer or scheduler.

export type AssistantReportTerminalStatus = 'completed' | 'failed' | 'interrupted';

export interface AssistantReportQueue {
  enqueue(payload: unknown): unknown;
  cancel(requestId: string): Promise<boolean>;
}

export interface AssistantReportDeliveryDeps {
  ledger: AssistantTaskLedger;
  readAssistantId: () => string | null;
  readMainThreadId: () => string;
  readThread: (threadId: string) => Promise<unknown>;
  getExecution: (clientMessageId: string) => RuntimeRequestRecord | null;
  readQueue: () => AssistantReportQueue | null;
  onError: (error: unknown) => void;
}

export interface AssistantReportDelivery {
  kick(): Promise<void>;
  dispose(): void;
}

const MAX_BOUND = 100;
const MAX_FINAL_TEXT = 20000;
const TERMINAL_STATUSES: readonly string[] = ['completed', 'failed', 'interrupted'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

type TerminalEvidence = {
  threadId: string;
  turnId: string;
  status: AssistantReportTerminalStatus;
  text: string;
};

function nativeThread(raw: unknown): Record<string, unknown> | null {
  if (!isRecord(raw)) return null;
  if (isRecord(raw.thread)) return raw.thread;
  return typeof raw.id === 'string' ? raw : null;
}

function finalAnswerText(turn: Record<string, unknown>): string | null {
  if (!Array.isArray(turn.items)) return null;
  const finals = turn.items.filter(
    (item) => isRecord(item) && item.type === 'agentMessage' && item.phase === 'final_answer',
  );
  if (finals.length !== 1) return null;
  const first = finals[0];
  const text = isRecord(first) ? first.text : undefined;
  if (!isNonEmptyString(text)) return null;
  // Oversized results are held: never truncated, never marked delivered.
  return text.length > MAX_FINAL_TEXT ? null : text;
}

// Exact fresh evidence: one thread with the expected id, one matching turn and
// an explicit native terminal status. Comments, last-assistant guesses and the
// local Runtime status are never used as evidence here.
function readTerminalEvidence(raw: unknown, threadId: string, turnId: string): TerminalEvidence | null {
  const thread = nativeThread(raw);
  if (!thread || thread.id !== threadId) return null;
  // Filter the exact turn id across every available turn. The report turn is
  // appended after the worker turns, so a bounded head window would hide it and
  // the report would never settle on a long main thread.
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  const matches = turns.filter((turn) => isRecord(turn) && turn.id === turnId);
  if (matches.length !== 1) return null;
  const turn = matches[0];
  if (!isRecord(turn)) return null;
  const status = turn.status;
  if (typeof status !== 'string' || !TERMINAL_STATUSES.includes(status)) return null;
  const text = finalAnswerText(turn);
  if (status === 'completed' && text === null) return null;
  return { threadId, turnId, status: status as AssistantReportTerminalStatus, text: text ?? '' };
}

function assertExecution(execution: RuntimeRequestRecord, report: AssistantTaskReport): void {
  if (
    execution.requestId !== report.requestId
    || execution.clientMessageId !== report.requestId
    || execution.threadId !== report.mainThreadId
    || execution.promptHash !== report.promptHash
    || execution.mode !== 'execute'
  ) {
    throw new Error('assistant report execution binding mismatch');
  }
}

export function createAssistantReportDelivery(deps: AssistantReportDeliveryDeps): AssistantReportDelivery {
  let current: Promise<void> | null = null;
  let dirty = false;
  let disposed = false;

  const reportError = (error: unknown): void => {
    try {
      deps.onError(error);
    } catch {
      // Reporting must never break the pass.
    }
  };

  const freezeWorkerReports = async (assistantId: string, mainThreadId: string): Promise<void> => {
    const tasks = deps.ledger.listTasks(assistantId).slice(0, MAX_BOUND);
    for (const task of tasks) {
      if (disposed) return;
      if (task.report !== undefined) continue;
      if (!isNonEmptyString(task.threadId) || !isNonEmptyString(task.turnId)) continue;
      try {
        const raw = await deps.readThread(task.threadId);
        const evidence = readTerminalEvidence(raw, task.threadId, task.turnId);
        // No explicit final yet: skip and reread on the next event or startup.
        if (!evidence) continue;
        deps.ledger.freezeReport(task.taskId, evidence, mainThreadId);
      } catch (error) {
        reportError(error);
      }
    }
  };

  const enqueuePayload = (task: AssistantTaskRecord, report: AssistantTaskReport): unknown => ({
    requestId: report.requestId,
    clientMessageId: report.requestId,
    threadId: report.mainThreadId,
    cwd: task.contract.cwd,
    model: task.contract.model,
    mode: 'execute',
    effort: 'low',
    input: [{ type: 'text', text: report.prompt }],
  });

  // Returns true when the active report slot was released and another frozen
  // report may be settled; false when the pass must wait for the runtime.
  const settleActiveReport = async (taskId: string, queue: AssistantReportQueue): Promise<boolean> => {
    const task = deps.ledger.readTask(taskId);
    const report = task?.report;
    if (!task || !report) throw new Error('assistant report slot has no task record');

    const execution = deps.getExecution(report.requestId);
    if (execution) assertExecution(execution, report);

    if (!report.writeStarted && execution && execution.status === 'queue_failed') {
      if (!(await queue.cancel(report.requestId))) throw new Error('assistant report queue cancel was refused');
      deps.ledger.failReportBeforeWrite(task.taskId);
      return true;
    }

    if (!execution) {
      // Only the report write boundary can block the write. The worker
      // interrupt boundary is unrelated to the report itself, so an
      // authoritatively interrupted worker still reports its failure.
      if (report.writeStarted) return false;
      queue.enqueue(enqueuePayload(task, report));
      return false;
    }

    if (!report.writeStarted) return false;

    let turnId = report.turnId;
    if (turnId === '' && isNonEmptyString(execution.turnId)) {
      deps.ledger.bindReportTurn(task.taskId, report.mainThreadId, execution.turnId);
      turnId = execution.turnId;
    }
    if (turnId === '') return false;

    const raw = await deps.readThread(report.mainThreadId);
    const evidence = readTerminalEvidence(raw, report.mainThreadId, turnId);
    // Missing turn, unknown status or no explicit final: safe hold, no resend,
    // no local release.
    if (!evidence) return false;
    if (execution.status === 'queue_failed') {
      if (!(await queue.cancel(report.requestId))) throw new Error('assistant report queue cancel was refused');
    }
    deps.ledger.finishReport(task.taskId, evidence);
    return true;
  };

  const settleReports = async (assistantId: string, queue: AssistantReportQueue): Promise<void> => {
    for (let pass = 0; pass < MAX_BOUND; pass++) {
      if (disposed) return;
      const coordinator = deps.ledger.readCoordinator(assistantId);
      if (!coordinator) return;
      if (coordinator.activeReportTaskId !== null) {
        if (!(await settleActiveReport(coordinator.activeReportTaskId, queue))) return;
        continue;
      }
      const next = deps.ledger
        .listTasks(assistantId)
        .find((task) => task.report !== undefined && task.report.status === 'pending');
      if (!next) return;
      // Separate report slot: never claims a task execution slot.
      if (!deps.ledger.claimReport(next.taskId)) return;
    }
  };

  const reconcile = async (): Promise<void> => {
    const assistantId = deps.readAssistantId();
    if (!isNonEmptyString(assistantId)) return;
    const mainThreadId = deps.readMainThreadId();
    if (!isNonEmptyString(mainThreadId)) return;
    const queue = deps.readQueue();
    if (!queue) return;

    deps.ledger.claimHost(assistantId);
    await freezeWorkerReports(assistantId, mainThreadId);
    if (disposed) return;
    await settleReports(assistantId, queue);
  };

  const kick = (): Promise<void> => {
    dirty = true;
    if (current) return current;
    // The body runs on a later microtask, so `current` is always assigned
    // before the pass starts: a synchronous settle can never latch a settled
    // promise as the in-flight pass.
    current = Promise.resolve()
      .then(async () => {
        while (dirty && !disposed) {
          dirty = false;
          try {
            await reconcile();
          } catch (error) {
            reportError(error);
          }
        }
      })
      .finally(() => {
        current = null;
      });
    return current;
  };

  const dispose = (): void => {
    disposed = true;
    dirty = false;
  };

  return { kick, dispose };
}
