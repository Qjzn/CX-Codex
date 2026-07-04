import {
  createRuntimeReconcileFailurePatch,
  selectRuntimeRequestsForReconcile,
  type RuntimeRequestReconcileFailurePatch,
} from './appServerRuntimeRequestReconciliation.js'
import type { RuntimeRequestRecord } from './runtimeStore.js'

type RuntimeReconcileUpdateRequest = (
  requestId: string,
  patch: RuntimeRequestReconcileFailurePatch,
) => RuntimeRequestRecord | null

export type RuntimeReconcileSchedulerDependencies = {
  listUncertainRequests(limit: number): RuntimeRequestRecord[]
  reconcileRuntimeThread(threadId: string): Promise<unknown>
  updateRequest: RuntimeReconcileUpdateRequest
  getErrorMessage(error: unknown, fallback: string): string
  writeReconcileFailure(details: {
    threadId: string
    requestId: string
    status: RuntimeRequestRecord['status']
    error: string
  }): void
  nowMs?: () => number
}

export type RuntimeReconcileBatchDependencies = Pick<
  RuntimeReconcileSchedulerDependencies,
  'reconcileRuntimeThread' | 'updateRequest' | 'getErrorMessage' | 'writeReconcileFailure' | 'nowMs'
> & {
  recordReconciled(threadId: string, atMs: number): void
}

export type RuntimeReconcileScheduler = {
  dispose(): void
}

export async function runRuntimeReconcileBatch(
  requests: RuntimeRequestRecord[],
  dependencies: RuntimeReconcileBatchDependencies,
): Promise<number> {
  for (const request of requests) {
    try {
      await dependencies.reconcileRuntimeThread(request.threadId)
      dependencies.recordReconciled(request.threadId, dependencies.nowMs?.() ?? Date.now())
    } catch (error) {
      const lastError = dependencies.getErrorMessage(error, 'runtime reconcile failed')
      dependencies.updateRequest(request.requestId, createRuntimeReconcileFailurePatch(request, lastError))
      dependencies.writeReconcileFailure({
        threadId: request.threadId,
        requestId: request.requestId,
        status: request.status,
        error: lastError,
      })
    }
  }
  return requests.length
}

export function createRuntimeReconcileScheduler(
  dependencies: RuntimeReconcileSchedulerDependencies,
  options: { intervalMs?: number; requestLimit?: number } = {},
): RuntimeReconcileScheduler {
  const intervalMs = options.intervalMs ?? 2000
  const requestLimit = options.requestLimit ?? 10
  const lastReconciledAtMsByThreadId = new Map<string, number>()
  let inFlight = false

  const timer = setInterval(() => {
    if (inFlight) return

    const now = dependencies.nowMs?.() ?? Date.now()
    const candidates = selectRuntimeRequestsForReconcile(
      dependencies.listUncertainRequests(requestLimit),
      lastReconciledAtMsByThreadId,
      now,
    )
    if (candidates.length === 0) return

    inFlight = true
    void runRuntimeReconcileBatch(candidates, {
      ...dependencies,
      recordReconciled: (threadId, atMs) => {
        lastReconciledAtMsByThreadId.set(threadId, atMs)
      },
    }).finally(() => {
      inFlight = false
    })
  }, intervalMs)
  timer.unref?.()

  return {
    dispose() {
      clearInterval(timer)
    },
  }
}
