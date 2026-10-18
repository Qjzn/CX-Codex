import type { AssistantTaskLedger, AssistantTaskRecord } from './assistantTaskLedger.js';
import { assistantHardeningConfig, assistantThreadParams } from './assistantRolePolicy.js';

const GENERIC_ERROR = 'Assistant request rejected.';

const WORKER_INSTRUCTIONS =
  'You are a read-only background worker. Complete only the frozen user task. ' +
  'Do not dispatch, change permissions, or claim tools ran without evidence. ' +
  'Return a final answer with result, evidence, checks and unfinished items.';

const TARGET_KEYS = ['threadId', 'thread_id', 'sourceThreadId', 'source_thread_id'] as const;

const READONLY_METHODS: ReadonlySet<string> = new Set<string>([
  'thread/read',
  'thread/turns/list',
  'thread/items/list',
  'thread/turns/items/list',
]);

type Plain = Record<string, unknown>;

function isPlainObject(value: unknown): value is Plain {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function reject(): never {
  throw new Error(GENERIC_ERROR);
}

function nonBlank(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readTargets(params: unknown): string[] {
  if (!isPlainObject(params)) return [];
  const values: string[] = [];
  for (const key of TARGET_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(params, key)) continue;
    const normalized = nonBlank(params[key]);
    if (normalized !== null) values.push(normalized);
  }
  return values;
}

function requireExactThread(params: unknown, threadId: string): void {
  if (threadId === '' || !isPlainObject(params)) reject();
  let seen = false;
  for (const key of TARGET_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(params, key)) continue;
    const value = params[key];
    if (value === undefined) continue;
    seen = true;
    if (value !== threadId) reject();
  }
  if (!seen) reject();
}

function hasNativeHistory(params: unknown): boolean {
  if (!isPlainObject(params)) return false;
  return params.path != null || params.history != null;
}

function nestedId(result: unknown, key: 'thread' | 'turn'): string {
  if (!isPlainObject(result) || !isPlainObject(result[key])) reject();
  const id = nonBlank((result[key] as Plain).id);
  if (id === null) reject();
  return id;
}

export class AssistantWorkerBoundary {
  private readonly contextTask = new WeakMap<object, string>();

  constructor(
    private readonly deps: {
      ledger: AssistantTaskLedger;
      readAssistantId: () => string | null;
      readMainThreadId: () => string;
      readConfig: () => Promise<unknown>;
    },
  ) {}

  contextFor(taskId: string): object {
    this.resolveTask(taskId);
    const token: object = Object.freeze({});
    this.contextTask.set(token, taskId);
    return token;
  }

  async transform(method: string, params: unknown, context?: object): Promise<unknown> {
    if (typeof method !== 'string' || method.length === 0) reject();
    if (context != null) {
      return this.transformBound(method, params, this.resolveContext(context));
    }
    this.guardUnbound(method, params);
    return params;
  }

  beforeWrite(method: string, params: unknown, context?: object): void {
    if (typeof method !== 'string' || method.length === 0) reject();
    if (context != null) {
      const task = this.resolveContext(context);
      if (method === 'thread/start') this.takeBoundary(task, 'thread');
      else if (method === 'turn/start') this.takeBoundary(task, 'turn');
      else if (method === 'turn/interrupt') this.takeBoundary(task, 'interrupt');
      else if (method !== 'thread/read' && method !== 'thread/resume') reject();
      return;
    }
    this.guardUnbound(method, params);
  }

  observeReply(method: string, result: unknown, context: object): void {
    if (typeof method !== 'string' || method.length === 0) reject();
    const task = this.resolveContext(context);
    if (method === 'thread/start') {
      this.deps.ledger.bindNative(task.taskId, { threadId: nestedId(result, 'thread') });
    } else if (method === 'turn/start') {
      this.deps.ledger.bindNative(task.taskId, { turnId: nestedId(result, 'turn') });
    }
  }

  private async transformBound(
    method: string,
    params: unknown,
    task: AssistantTaskRecord,
  ): Promise<unknown> {
    if (method === 'thread/read') {
      requireExactThread(params, task.threadId);
      return params;
    }

    if (method === 'thread/start') {
      if (task.threadId !== '') reject();
      const built = await this.readOnlyParams(task);
      return {
        ...built,
        model: task.contract.model,
        baseInstructions: WORKER_INSTRUCTIONS,
        developerInstructions: WORKER_INSTRUCTIONS,
        dynamicTools: [],
        ephemeral: false,
      };
    }

    if (method === 'turn/start') {
      if (task.threadId === '') reject();
      return {
        threadId: task.threadId,
        input: [{ type: 'text', text: task.contract.instructions }],
        clientUserMessageId: task.executionClientMessageId,
        model: task.contract.model,
        effort: 'low',
        approvalPolicy: 'never',
        sandboxPolicy: { type: 'readOnly', networkAccess: false },
        environments: [],
        runtimeWorkspaceRoots: [],
      };
    }

    if (method === 'turn/interrupt') {
      if (task.threadId === '' || task.turnId === '') reject();
      return { threadId: task.threadId, turnId: task.turnId };
    }

    if (method === 'thread/resume') {
      if (task.threadId === '') reject();
      const built = await this.readOnlyParams(task);
      return {
        threadId: task.threadId,
        cwd: built.cwd,
        approvalPolicy: built.approvalPolicy,
        sandbox: built.sandbox,
        config: built.config,
        baseInstructions: WORKER_INSTRUCTIONS,
        developerInstructions: WORKER_INSTRUCTIONS,
      };
    }

    reject();
  }

  private async readOnlyParams(task: AssistantTaskRecord): Promise<Record<string, unknown>> {
    const config = assistantHardeningConfig(await this.deps.readConfig());
    if (this.currentAssistantId() !== task.contract.assistantId) reject();
    return assistantThreadParams(task.contract.cwd, config);
  }

  private currentAssistantId(): string {
    const assistantId = this.deps.readAssistantId();
    if (typeof assistantId !== 'string' || assistantId.length === 0) reject();
    return assistantId;
  }

  private resolveTask(taskId: unknown): AssistantTaskRecord {
    if (typeof taskId !== 'string' || taskId.length === 0) reject();
    const assistantId = this.currentAssistantId();
    const task = this.deps.ledger.readTask(taskId);
    if (!task) reject();
    if (task.contract.assistantId !== assistantId) reject();
    if (task.contract.permissions !== 'read-only') reject();
    return task;
  }

  private resolveContext(context: unknown): AssistantTaskRecord {
    if (typeof context !== 'object' || context === null || Array.isArray(context)) reject();
    const taskId = this.contextTask.get(context);
    if (taskId === undefined) reject();
    return this.resolveTask(taskId);
  }

  private takeBoundary(task: AssistantTaskRecord, kind: 'thread' | 'turn' | 'interrupt'): void {
    if (!this.deps.ledger.takeBoundary(task.taskId, kind)) reject();
  }

  private guardUnbound(method: string, params: unknown): void {
    const assistantId = this.deps.readAssistantId();
    if (typeof assistantId !== 'string' || assistantId.length === 0) return;

    const targets = readTargets(params);
    const tasks = this.deps.ledger.listTasks(assistantId);

    const bound = new Set<string>();
    for (const task of tasks) {
      if (task.contract.assistantId === assistantId && task.threadId !== '') bound.add(task.threadId);
    }

    if (targets.some((target) => bound.has(target))) {
      if (!READONLY_METHODS.has(method)) reject();
      return;
    }

    if (method === 'thread/resume' && hasNativeHistory(params) && tasks.length > 0) reject();

    this.guardUnknownCreation(method, targets, assistantId);
  }

  private guardUnknownCreation(method: string, targets: string[], assistantId: string): void {
    if (READONLY_METHODS.has(method)) return;

    const activeTaskId = this.deps.ledger.readCoordinator(assistantId)?.activeTaskId ?? null;
    if (activeTaskId === null) return;

    const active = this.deps.ledger.readTask(activeTaskId);
    if (!active || active.contract.assistantId !== assistantId) reject();
    if (!active.boundaries.thread || active.threadId !== '') return;

    const mainThreadId = this.deps.readMainThreadId().trim();
    if (targets.every((target) => target === mainThreadId)) return;

    reject();
  }
}
