import {
  createAppServerRuntimeTurnInterrupter,
  type RuntimeInterruptDependencies,
  type RuntimeInterruptResult,
} from './appServerRuntimeInterrupt.js'
import {
  createAppServerRuntimeTurnStarter,
  type RuntimeStartDependencies,
  type RuntimeStartResult,
} from './appServerRuntimeStart.js'
import type { RuntimeRequestRecord } from './runtimeStore.js'

type RuntimeActionCreateRequestRecord =
  | Parameters<RuntimeStartDependencies['createRequest']>[0]
  | Parameters<RuntimeInterruptDependencies['createRequest']>[0]

type RuntimeActionUpdateRequestPatch =
  | Parameters<RuntimeStartDependencies['updateRequest']>[1]
  | Parameters<RuntimeInterruptDependencies['updateRequest']>[1]

export type AppServerRuntimeActionsDependencies = Omit<
  RuntimeStartDependencies & RuntimeInterruptDependencies,
  'createRequest' | 'updateRequest'
> & {
  createRequest(record: RuntimeActionCreateRequestRecord): RuntimeRequestRecord
  updateRequest(requestId: string, patch: RuntimeActionUpdateRequestPatch): RuntimeRequestRecord | null
}

export type AppServerRuntimeActions = {
  startRuntimeTurn(payload: unknown): Promise<RuntimeStartResult>
  interruptRuntimeTurn(payload: unknown): Promise<RuntimeInterruptResult>
}

export function createAppServerRuntimeActions(
  dependencies: AppServerRuntimeActionsDependencies,
): AppServerRuntimeActions {
  return {
    startRuntimeTurn: createAppServerRuntimeTurnStarter(dependencies),
    interruptRuntimeTurn: createAppServerRuntimeTurnInterrupter(dependencies),
  }
}
