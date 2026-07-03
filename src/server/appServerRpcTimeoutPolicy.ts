export const APP_SERVER_RPC_TIMEOUT_MS = 60_000
export const APP_SERVER_RPC_INIT_TIMEOUT_MS = 60_000
export const APP_SERVER_RPC_LIGHT_THREAD_TIMEOUT_MS = 30_000
export const APP_SERVER_RPC_HEAVY_THREAD_TIMEOUT_MS = 60_000

export function getRpcTimeoutMs(method: string, params: unknown): number {
  if (method === 'initialize') {
    return APP_SERVER_RPC_INIT_TIMEOUT_MS
  }
  if (method === 'thread/read') {
    const record = asRecord(params)
    return record?.includeTurns === true
      ? APP_SERVER_RPC_HEAVY_THREAD_TIMEOUT_MS
      : APP_SERVER_RPC_LIGHT_THREAD_TIMEOUT_MS
  }
  if (method === 'thread/resume') {
    return APP_SERVER_RPC_HEAVY_THREAD_TIMEOUT_MS
  }
  return APP_SERVER_RPC_TIMEOUT_MS
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
