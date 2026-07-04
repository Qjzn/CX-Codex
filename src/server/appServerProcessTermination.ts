export type AppServerProcessTerminationTarget = {
  stdin: {
    end: () => void
  }
  killed: boolean
  kill: (signal: 'SIGTERM' | 'SIGKILL') => unknown
}

export type AppServerProcessTerminationTimer = {
  unref?: () => void
}

export type AppServerProcessTerminationSetTimeout = (
  callback: () => void,
  delayMs: number,
) => AppServerProcessTerminationTimer

export type AppServerProcessTerminationOptions = {
  forceKillAfterMs?: number
  setTimeout?: AppServerProcessTerminationSetTimeout
}

export function terminateAppServerProcess(
  proc: AppServerProcessTerminationTarget,
  options: AppServerProcessTerminationOptions = {},
): void {
  const forceKillAfterMs = options.forceKillAfterMs ?? 1500
  const setForceKillTimeout = options.setTimeout ?? (setTimeout as AppServerProcessTerminationSetTimeout)

  try {
    proc.stdin.end()
  } catch {}

  try {
    proc.kill('SIGTERM')
  } catch {}

  const forceKillTimer = setForceKillTimeout(() => {
    if (!proc.killed) {
      try {
        proc.kill('SIGKILL')
      } catch {}
    }
  }, forceKillAfterMs)
  forceKillTimer.unref?.()
}
