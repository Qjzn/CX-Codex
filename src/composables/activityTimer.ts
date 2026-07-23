export type RuntimeActivityTimestamps = {
  lastStartedAtIso?: string | null
  lastCompletedAtIso?: string | null
}

function parseIsoTimestamp(value: string | null | undefined): number | null {
  if (!value) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

export function readRuntimeActivityStartedAtMs(
  runtime: RuntimeActivityTimestamps | null | undefined,
): number | null {
  const startedAtMs = parseIsoTimestamp(runtime?.lastStartedAtIso)
  if (startedAtMs === null) return null

  const completedAtMs = parseIsoTimestamp(runtime?.lastCompletedAtIso)
  if (completedAtMs !== null && startedAtMs <= completedAtMs) return null
  return startedAtMs
}
