import { readThreadReadIncludeTurns } from './appServerThreadReadParams.js'

export const APP_SERVER_RPC_TIMEOUT_MS = 60_000
export const APP_SERVER_RPC_INIT_TIMEOUT_MS = 60_000
export const APP_SERVER_RPC_THREAD_LIST_TIMEOUT_MS = 15_000
export const APP_SERVER_RPC_LIGHT_THREAD_TIMEOUT_MS = 30_000
export const APP_SERVER_RPC_HEAVY_THREAD_TIMEOUT_MS = 60_000

export function getRpcTimeoutMs(method: string, params: unknown): number {
  if (method === 'initialize') {
    return APP_SERVER_RPC_INIT_TIMEOUT_MS
  }
  if (method === 'thread/list') {
    return APP_SERVER_RPC_THREAD_LIST_TIMEOUT_MS
  }
  if (method === 'thread/read') {
    return readThreadReadIncludeTurns(params)
      ? APP_SERVER_RPC_HEAVY_THREAD_TIMEOUT_MS
      : APP_SERVER_RPC_LIGHT_THREAD_TIMEOUT_MS
  }
  if (method === 'thread/resume') {
    return APP_SERVER_RPC_HEAVY_THREAD_TIMEOUT_MS
  }
  return APP_SERVER_RPC_TIMEOUT_MS
}
