export function readThreadReadIncludeTurns(params: unknown): boolean {
  const record = params !== null && typeof params === 'object' && !Array.isArray(params)
    ? params as Record<string, unknown>
    : null
  return record?.includeTurns === true
}

export function readThreadReadIncludeTurnsForMethod(method: string, params: unknown): boolean | undefined {
  return method === 'thread/read'
    ? readThreadReadIncludeTurns(params)
    : undefined
}
