export type AppServerJsonRpcWriterTarget = {
  stdin: {
    write: (chunk: string) => unknown
  }
}

export type SendAppServerJsonRpcLineDependencies = {
  getProcess: () => AppServerJsonRpcWriterTarget | null
  handleWriteFailure: (error: unknown) => void
}

export function sendAppServerJsonRpcLine(
  payload: Record<string, unknown>,
  dependencies: SendAppServerJsonRpcLineDependencies,
): void {
  const proc = dependencies.getProcess()
  if (!proc) {
    throw new Error('codex app-server is not running')
  }

  try {
    proc.stdin.write(`${JSON.stringify(payload)}\n`)
  } catch (error) {
    dependencies.handleWriteFailure(error)
    throw error
  }
}
