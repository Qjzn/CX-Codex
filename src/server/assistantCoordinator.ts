import type { AppServerProcess } from './appServerProcess.js'
import type { RuntimeStore } from './runtimeStore.js'
import type { CodexBridgeRuntimeOperations } from './codexBridgeRuntimeOperations.js'
import { readAssistantAssets, type AssistantAssets } from './assistantAssets.js'
import { readAssistantRoleBinding } from './assistantRuntime.js'
import { ASSISTANT_COORDINATION_TOOLS } from './assistantCoordinationTools.js'
import { ASSISTANT_ROLE_INSTRUCTIONS, assistantHardeningConfig, protectAssistantRpc } from './assistantRolePolicy.js'
import { AssistantWorkerBoundary } from './assistantWorkerBoundary.js'
import { AssistantTaskExecutor } from './assistantTaskExecutor.js'
import { createAssistantToolHandler } from './assistantToolHandler.js'
import { createAssistantReportDelivery } from './assistantReportDelivery.js'
import { createRuntimePromptHash, parseRuntimeSendPayload } from './runtimePayload.js'
import type { RuntimeMessageQueue } from './runtimeMessageQueue.js'

const REJECTED = 'Assistant request rejected.'
const RESERVED_ID = /^(assistant-main|assistant-task|assistant-report):/
const MAIN_READS = new Set(['thread/read', 'thread/turns/list', 'thread/items/list', 'thread/turns/items/list', 'thread/goal/get', 'thread/loaded', 'thread/unsubscribe'])
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
function targets(params: unknown): string[] {
  const p = record(params)
  return ['threadId', 'thread_id', 'sourceThreadId', 'source_thread_id'].flatMap(key => typeof p?.[key] === 'string' ? [p[key].trim()] : [])
}
function reject(): never { throw new Error(REJECTED) }

/** Wires existing Runtime primitives; owns no execution database, timer or queue. */
export function createAssistantCoordinator(deps: {
  appServer: AppServerProcess
  store: RuntimeStore
  runtime: Pick<CodexBridgeRuntimeOperations, 'createAssistantWorkerStarter' | 'createAssistantWorkerInterrupter'>
    & Partial<Pick<CodexBridgeRuntimeOperations, 'reconcileRuntimeThread'>>
  readAssets?: () => AssistantAssets
  onError: (error: unknown) => void
  readReportQueue?: () => Pick<RuntimeMessageQueue, 'enqueue' | 'cancel'> | null
}) {
  const { appServer, store } = deps
  const ledger = store.assistantTasks
  let cachedAssets: AssistantAssets | undefined
  const assets = () => cachedAssets ??= (deps.readAssets ?? readAssistantAssets)()
  const binding = () => readAssistantRoleBinding(store)
  const identity = () => store.readAssistantIdentity()
  const assistantId = () => identity()?.assistantId ?? null
  const mainId = () => binding()?.threadId ?? ''
  const instructions = () => `${ASSISTANT_ROLE_INSTRUCTIONS}\n${assets().core}`
  const approvedMainParams = new WeakSet<object>()
  const freshReadContext = Object.freeze({})
  const reportContexts = new WeakMap<object, string>()
  const worker = new AssistantWorkerBoundary({ ledger, readAssistantId: assistantId, readMainThreadId: mainId, readConfig: () => appServer.rpc('config/read', { includeLayers: false }) })
  let disposed = false

  const freshRead = (threadId: string) => appServer.rpc('thread/read', { threadId, includeTurns: true }, freshReadContext)
  const privateWorkerRpc = (taskId: string) => {
    const context = worker.contextFor(taskId)
    return async (method: string, params: unknown) => {
      const result = await appServer.rpc(method, params, context)
      worker.observeReply(method, result, context)
      return result
    }
  }
  const executor = new AssistantTaskExecutor({
    ledger, readAssistantId: assistantId,
    startWorker: async (task, payload) => {
      if (task.contract.assetsHash !== assets().hash) reject()
      const rpc = privateWorkerRpc(task.taskId)
      // A known, proven-unsent turn can resume its original thread; never retry an unknown create.
      if (task.threadId) await rpc('thread/resume', { threadId: task.threadId })
      return await deps.runtime.createAssistantWorkerStarter(rpc)(payload)
    },
    interruptWorker: (task, payload) => deps.runtime.createAssistantWorkerInterrupter(privateWorkerRpc(task.taskId))(payload),
    readThread: task => freshRead(task.threadId),
    getExecution: id => store.getLatestRequestByClientMessageId(id),
    updateExecution: (id, patch) => store.updateRequest(id, patch),
    onTerminal: task => { void deps.runtime.reconcileRuntimeThread?.(task.threadId).catch(deps.onError) },
    onError: deps.onError,
  })
  const reports = createAssistantReportDelivery({
    ledger, readAssistantId: assistantId, readMainThreadId: mainId, readThread: freshRead,
    getExecution: id => store.getLatestRequestByClientMessageId(id),
    readQueue: () => deps.readReportQueue?.() ?? null, onError: deps.onError,
  })
  let restoreWorkerSnapshots = true
  async function kick() {
    await executor.kick()
    if (restoreWorkerSnapshots && deps.runtime.reconcileRuntimeThread) {
      restoreWorkerSnapshots = false
      const id = assistantId()
      for (const task of id ? ledger.listTasks(id) : []) {
        if (task.report?.status === 'delivered' && task.threadId) await deps.runtime.reconcileRuntimeThread(task.threadId).catch(deps.onError)
      }
    }
    await reports.kick()
  }
  function reportTask(context?: object) {
    const id = context && reportContexts.get(context)
    if (!id) return null
    const task = ledger.readTask(id)
    if (!task?.report || task.report.status !== 'pending' || !ledger.isHostOwner(task.contract.assistantId)
      || task.report.mainThreadId !== mainId() || ledger.readCoordinator(task.contract.assistantId)?.activeReportTaskId !== id) reject()
    return task
  }
  function checkReportRpc(method: string, params: unknown, context?: object): boolean {
    const task = reportTask(context)
    if (!task) return false
    const p = record(params), report = task.report!
    if (!p || p.threadId !== report.mainThreadId || targets(p).some(id => id !== report.mainThreadId)) reject()
    if (method === 'thread/read' || method === 'thread/resume') return true
    if (method !== 'turn/start' || p.clientUserMessageId !== report.requestId || p.model !== task.contract.model
      || createRuntimePromptHash(p.input) !== report.promptHash) reject()
    return true
  }
  function startReport(payload: unknown) {
    const p = record(payload), clientId = p?.clientMessageId
    if (typeof clientId !== 'string' || !clientId.startsWith('assistant-report:')) return null
    const parsed = parseRuntimeSendPayload(payload)
    const id = assistantId(), task = id ? ledger.listTasks(id).find(t => t.report?.requestId === clientId) : null
    if (!task?.report || task.report.mainThreadId !== mainId() || p?.requestId !== clientId || p.threadId !== mainId()
      || p.cwd !== task.contract.cwd || p.model !== task.contract.model || parsed.mode !== 'execute'
      || createRuntimePromptHash(p.input) !== task.report.promptHash) return Promise.reject(new Error(REJECTED))
    const report = task.report, request = store.getLatestRequestByClientMessageId(clientId)
    if (report.writeStarted) {
      if (!request) return Promise.reject(new Error(REJECTED))
      return Promise.resolve({ request, threadId: request.threadId, turnId: request.turnId, status: request.status })
    }
    const context = Object.freeze({}); reportContexts.set(context, task.taskId)
    const rpc = async (method: string, params: unknown) => {
      const result = await appServer.rpc(method, params, context)
      if (method === 'turn/start') {
        const turnId = record(record(result)?.turn)?.id
        if (typeof turnId !== 'string' || !turnId) reject()
        ledger.bindReportTurn(task.taskId, report.mainThreadId, turnId)
      }
      return result
    }
    return (async () => {
      if (request?.status === 'starting') store.updateRequest(request.requestId, { status: 'pending_start', threadId: report.mainThreadId, payload })
      await rpc('thread/resume', { threadId: report.mainThreadId })
      try { return await deps.runtime.createAssistantWorkerStarter(rpc)(payload) }
      finally { void reports.kick() }
    })()
  }
  const toolHandler = (generation?: number) => {
    function checkGeneration() {
      if (disposed || (generation !== undefined && appServer.getActiveLaunchIdentity()?.generation !== generation)) reject()
    }
    return createAssistantToolHandler({
      ledger, readIdentity: identity, readMainThreadId: mainId,
      listMainRequests: () => { checkGeneration(); return store.listRequestsByThread(mainId(), ['running'], 100) },
      readThread: async id => { checkGeneration(); const value = await freshRead(id); checkGeneration(); return value },
      readDefaultModel: async () => {
        const config = record(record(await appServer.rpc('config/read', { includeLayers: false }))?.config)
        if (typeof config?.model !== 'string' || !config.model.trim()) reject()
        return config.model.trim()
      },
      get assetsHash() { return assets().hash },
      get workerBrief() { return assets().workerBrief },
      getExecution: id => store.getLatestRequestByClientMessageId(id),
      onChanged: () => { void kick() },
    })
  }

  function isWorkerThread(threadId: string): boolean {
    const id = assistantId()
    return !!id && ledger.listTasks(id).some(task => task.threadId === threadId)
  }
  function canDispatch(): boolean {
    const id = assistantId(), threadId = mainId()
    if (!id || !threadId || !ledger.isHostOwner(id)) return false
    const registered = ledger.readCoordinator(id)
    return registered?.mainToolsThreadId === threadId && registered.assetsHash === assets().hash
  }
  async function policy(method: string, params: unknown, context?: object): Promise<unknown> {
    if (context === freshReadContext && method !== 'thread/read') reject()
    const b = binding()
    const config = b && method === 'thread/resume' ? assistantHardeningConfig(await appServer.rpc('config/read', { includeLayers: false })) : {}
    const safe = protectAssistantRpc(method, params, b, config, b ? instructions() : undefined)
    const result = checkReportRpc(method, safe, context) ? safe : await worker.transform(method, safe, context === freshReadContext ? undefined : context)
    if (b?.threadId && targets(result).includes(b.threadId) && record(result)) approvedMainParams.add(result as object)
    return result
  }
  function beforeWrite(method: string, params: unknown, context?: object): void {
    if (context === freshReadContext) { if (method !== 'thread/read') reject(); return }
    if (checkReportRpc(method, params, context)) {
      if (method === 'turn/start' && !ledger.takeReportBoundary(reportTask(context)!.taskId)) reject()
      worker.beforeWrite(method, params)
    } else {
      if (method === 'turn/start' && typeof record(params)?.clientUserMessageId === 'string' && String(record(params)?.clientUserMessageId).startsWith('assistant-report:')) reject()
      worker.beforeWrite(method, params, context)
    }
    const b = binding()
    if (!b) return
    // Also recheck global mutation prohibitions after an initialization/queue wait.
    protectAssistantRpc(method, null, b, {})
    if (MAIN_READS.has(method)) return
    const ids = targets(params)
    if (!b.threadId && ids.length > 0) reject() // an unbound main ID must not be used during creation
    if (b.threadId && ids.includes(b.threadId) && (!record(params) || !approvedMainParams.has(params as object))) reject()
  }
  function isPublicRpcAllowed(method: string, params: unknown): boolean {
    const p = record(params)
    if (typeof p?.clientUserMessageId === 'string' && RESERVED_ID.test(p.clientUserMessageId.trim())) return false
    try {
      worker.beforeWrite(method, params)
      protectAssistantRpc(method, params, binding(), {})
      return true
    } catch (error) {
      if (error instanceof Error && error.message === REJECTED) return false
      throw error
    }
  }
  function intercept(id: number, method: string, params: unknown): boolean {
    const b = binding(), ids = targets(params)
    if (!b?.threadId || !ids.includes(b.threadId)) {
      if (ids.some(isWorkerThread)) { appServer.rejectServerRequest(id); return true }
      return false
    }
    const generation = appServer.getActiveLaunchIdentity()?.generation
    if (method !== 'item/tool/call' || !canDispatch() || generation === undefined) {
      appServer.rejectServerRequest(id)
      return true
    }
    void toolHandler(generation).handle(method, params).then(
      value => appServer.replyToInterceptedServerRequest(id, { contentItems: [{ type: 'inputText', text: JSON.stringify(value) }], success: true }, generation),
      () => appServer.replyToInterceptedServerRequest(id, { contentItems: [{ type: 'inputText', text: '协调请求未完成，请读取任务状态；不要重新创建未知执行。' }], success: false }, generation),
    )
    return true
  }
  const mainSetup = {
    readInstructions: instructions,
    readTools: () => { const id = assistantId(); if (!id) reject(); ledger.claimHost(id); return [...ASSISTANT_COORDINATION_TOOLS] },
    onThreadCreated: (result: unknown) => {
      const id = assistantId(), nativeId = record(record(result)?.thread)?.id
      if (!id || typeof nativeId !== 'string' || !nativeId) reject()
      ledger.registerMainTools(id, nativeId, assets().hash)
    },
  }
  return {
    policy, beforeWrite, intercept, mainSetup, isWorkerThread, isPublicRpcAllowed, canDispatch,
    mainThreadId: mainId,
    annotateThreadList: (value: unknown): unknown => {
      const result = record(value)
      if (!result || !Array.isArray(result.data)) return value
      return { ...result, data: result.data.map(row => {
        const thread = record(row)
        const id = assistantId()
        const task = thread && id ? ledger.listTasks(id).find(task => task.threadId === thread.id) : null
        return thread ? { ...thread, assistantManaged: !!task, ...(task ? { name: task.contract.title } : {}) } : row
      }) }
    },
    listTasks: () => toolHandler().list(),
    kick, startReport,
    canReturnResults: () => canDispatch() && !!deps.readReportQueue?.(),
    resumePending: (payload: unknown) => {
      const clientId = record(payload)?.clientMessageId
      if (typeof clientId === 'string' && clientId.startsWith('assistant-report:')) return startReport(payload)
      if (typeof clientId !== 'string' || !clientId.startsWith('assistant-task:')) return null
      const id = assistantId(), task = id ? ledger.listTasks(id).find(item => item.executionClientMessageId === clientId) : null
      const request = task ? store.getLatestRequestByClientMessageId(clientId) : null
      if (!task || !request) return Promise.reject(new Error(REJECTED))
      // The executor alone reconciles proven-unsent boundaries. Runtime keeps the original row.
      return Promise.resolve({ request, threadId: request.threadId, turnId: request.turnId, status: request.status })
    },
    dispose: () => { disposed = true; executor.dispose(); reports.dispose() },
  }
}
