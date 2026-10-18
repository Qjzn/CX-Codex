import type { AssistantTaskLedger, AssistantTaskRecord } from './assistantTaskLedger.js';
import type { RuntimeRequestRecord } from './runtimeStore.js';
import type { RuntimeStartResult } from './appServerRuntimeStart.js';
import { createRuntimePromptHash } from './runtimePayload.js';

export interface AssistantTaskExecutionPayload {
  requestId: string;
  clientMessageId: string;
  threadId: string;
  cwd: string;
  model: string;
  mode: 'execute';
  effort: 'low';
  input: Array<{ type: 'text'; text: string }>;
}

export interface AssistantTaskExecutorDeps {
  ledger: AssistantTaskLedger;
  readAssistantId: () => string | null;
  startWorker: (task: AssistantTaskRecord, payload: unknown) => Promise<RuntimeStartResult>;
  interruptWorker: (task: AssistantTaskRecord, payload: unknown) => Promise<unknown>;
  readThread: (task: AssistantTaskRecord) => Promise<unknown>;
  getExecution: (clientMessageId: string) => RuntimeRequestRecord | null;
  updateExecution: (
    requestId: string,
    patch: { status: 'pending_start'; threadId: string; payload: unknown },
  ) => unknown;
  onTerminal?: (task: AssistantTaskRecord, turn: Record<string, unknown>) => void;
  onError: (error: unknown) => void;
}

const TERMINAL_TURN_STATUSES: ReadonlySet<string> = new Set(['completed', 'failed', 'interrupted']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTerminalTurnStatus(status: unknown): status is 'completed' | 'failed' | 'interrupted' {
  return typeof status === 'string' && TERMINAL_TURN_STATUSES.has(status);
}

function timestampOf(value: unknown): number {
  return typeof value === 'string' ? Date.parse(value) : Number.NaN;
}

function requireBoundTurn(snapshot: unknown, task: AssistantTaskRecord): Record<string, unknown> {
  if (!isRecord(snapshot) || !isRecord(snapshot.thread)) {
    throw new Error(`assistant task ${task.taskId}: thread snapshot has no thread`);
  }
  const thread = snapshot.thread;
  if (thread.id !== task.threadId) {
    throw new Error(`assistant task ${task.taskId}: thread ${String(thread.id)} is not ${task.threadId}`);
  }
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  const matches = turns.filter((turn) => isRecord(turn) && turn.id === task.turnId);
  if (matches.length !== 1) {
    throw new Error(`assistant task ${task.taskId}: expected exactly one turn ${task.turnId}`);
  }
  return matches[0] as Record<string, unknown>;
}

export class AssistantTaskExecutor {
  private readonly deps: AssistantTaskExecutorDeps;
  private busy = false;
  private dirty = false;
  private disposed = false;
  private promise: Promise<void> | null = null;
  /** Last unknown thrown value, retained for review; never cleared here. */
  protected lastError: unknown = undefined;

  constructor(deps: AssistantTaskExecutorDeps) {
    this.deps = deps;
  }

  kick(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.dirty = true;
    if (this.busy && this.promise !== null) return this.promise;
    if (this.promise === null) this.promise = this.run();
    return this.promise;
  }

  dispose(): void {
    this.disposed = true;
    // No release: host claim is governed by process exit, slots stay untouched.
  }

  private async run(): Promise<void> {
    this.busy = true;
    try {
      while (this.dirty && !this.disposed) {
        this.dirty = false;
        await this.step();
      }
    } catch (error) {
      this.lastError = error;
      try {
        this.deps.onError(error);
      } catch {
        // reporting failures must not corrupt the coalescing state
      }
    } finally {
      this.busy = false;
      this.promise = null;
      if (this.dirty && !this.disposed) void this.kick();
    }
  }

  private async step(): Promise<void> {
    const assistantId = this.deps.readAssistantId();
    if (assistantId === null || assistantId === '') return;
    const { ledger } = this.deps;
    ledger.claimHost(assistantId);
    const activeTaskId = ledger.readCoordinator(assistantId)?.activeTaskId ?? null;
    if (activeTaskId !== null && activeTaskId !== '') {
      const task = ledger.readTask(activeTaskId);
      if (!task) throw new Error(`assistant task ${activeTaskId} is active but missing from the ledger`);
      if (task.contract.assistantId !== assistantId) {
        throw new Error(`assistant task ${activeTaskId} is not owned by host ${assistantId}`);
      }
      await this.advance(task);
      return;
    }
    this.claimNext(assistantId);
  }

  private claimNext(assistantId: string): void {
    const { ledger } = this.deps;
    const candidate = ledger
      .listTasks(assistantId)
      .find((task) => !task.boundaries.thread && !task.boundaries.turn && !task.stopRequested);
    if (!candidate) return;
    if (!ledger.claimExecution(candidate.taskId)) return;
    this.dirty = true;
  }

  private async advance(task: AssistantTaskRecord): Promise<void> {
    const boundaries = task.boundaries;
    const turnBound = boundaries.turn && task.threadId !== '' && task.turnId !== '';

    if (turnBound) {
      const turn = requireBoundTurn(await this.deps.readThread(task), task);
      if (isTerminalTurnStatus(turn.status)) {
        if (this.deps.onTerminal) this.deps.onTerminal(task, turn);
        const released = this.deps.ledger.releaseExecution(task.taskId, {
          kind: 'terminal',
          threadId: task.threadId,
          turnId: task.turnId,
          status: turn.status,
        });
        if (released) this.dirty = true;
        return;
      }
    }

    if (task.stopRequested) {
      await this.fulfillStop(task, turnBound);
      return;
    }

    // Thread creation is unknown: a native write may exist, never replay it.
    if (boundaries.thread && task.threadId === '') return;
    // Turn unknown or in progress: stays occupied until a native event proves otherwise.
    if (boundaries.turn) return;

    await this.start(task);
  }

  private async fulfillStop(task: AssistantTaskRecord, turnBound: boolean): Promise<void> {
    if (turnBound) {
      if (!task.boundaries.interrupt) {
        await this.deps.interruptWorker(task, {
          requestId: `${task.executionRequestId}:stop`,
          threadId: task.threadId,
          turnId: task.turnId,
        });
      }
      // First interrupt is recorded once by the transport guard; never resend.
      return;
    }
    if (!task.boundaries.turn && task.turnId === '') {
      const released = this.deps.ledger.releaseExecution(task.taskId, { kind: 'not-sent' });
      if (released) this.dirty = true;
    }
    // No new turn after a stop request.
  }

  private async start(task: AssistantTaskRecord): Promise<void> {
    const payload: AssistantTaskExecutionPayload = {
      requestId: task.executionRequestId,
      clientMessageId: task.executionClientMessageId,
      threadId: task.threadId,
      cwd: task.contract.cwd,
      model: task.contract.model,
      mode: 'execute',
      effort: 'low',
      input: [{ type: 'text', text: task.contract.instructions }],
    };

    const existing = this.deps.getExecution(task.executionClientMessageId);
    if (existing) {
      if (existing.promptHash !== createRuntimePromptHash(payload.input)) {
        throw new Error(`assistant task ${task.taskId}: execution prompt hash mismatch`);
      }
      if (existing.mode !== 'execute') {
        throw new Error(`assistant task ${task.taskId}: execution mode ${existing.mode} is not execute`);
      }
      if (existing.threadId && existing.threadId !== task.threadId) {
        throw new Error(`assistant task ${task.taskId}: execution is bound to thread ${existing.threadId}`);
      }
      if (timestampOf(existing.createdAtIso) < timestampOf(task.createdAt)) {
        throw new Error(`assistant task ${task.taskId}: execution record predates the task`);
      }
      // Ledger proves no native write yet, so the frozen record may be re-armed in place.
      if (existing.status !== 'pending_start') {
        this.deps.updateExecution(existing.requestId, {
          status: 'pending_start',
          threadId: task.threadId,
          payload,
        });
      }
    }

    await this.deps.startWorker(task, payload);

    const refreshed = this.deps.ledger.readTask(task.taskId);
    if (!refreshed) throw new Error(`assistant task ${task.taskId} vanished after start receipt`);
    if (refreshed.stopRequested) this.dirty = true;
  }
}
