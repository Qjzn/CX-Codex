export type AppServerProcessHandlerTarget = {
  stdout: {
    setEncoding: (encoding: BufferEncoding) => void
    on: (event: 'data', listener: (chunk: string) => void) => unknown
  }
  stderr: {
    setEncoding: (encoding: BufferEncoding) => void
    on: (event: 'data', listener: (chunk: string) => void) => unknown
  }
  stdin: {
    on: (event: 'error', listener: (error: Error) => void) => unknown
  }
  on: {
    (event: 'error', listener: (error: Error) => void): unknown
    (event: 'exit', listener: () => void): unknown
  }
}

export type AttachAppServerProcessHandlersDependencies = {
  isCurrentProcess: (proc: AppServerProcessHandlerTarget) => boolean
  handleStdoutChunk: (chunk: string) => void
  handleStderrMessage: (message: string) => void
  handleStdinError: (error: Error) => void
  handleProcessError: (error: Error) => void
  handleProcessExit: () => void
}

export function attachAppServerProcessHandlers(
  proc: AppServerProcessHandlerTarget,
  dependencies: AttachAppServerProcessHandlersDependencies,
): void {
  proc.stdout.setEncoding('utf8')
  proc.stdout.on('data', (chunk) => {
    dependencies.handleStdoutChunk(chunk)
  })

  proc.stderr.setEncoding('utf8')
  proc.stderr.on('data', (chunk) => {
    const message = chunk.trim()
    if (!message) return
    dependencies.handleStderrMessage(message)
  })

  proc.stdin.on('error', (error) => {
    if (!dependencies.isCurrentProcess(proc)) return
    dependencies.handleStdinError(error)
  })

  proc.on('error', (error) => {
    if (!dependencies.isCurrentProcess(proc)) return
    dependencies.handleProcessError(error)
  })

  proc.on('exit', () => {
    dependencies.handleProcessExit()
  })
}
