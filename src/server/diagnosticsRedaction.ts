import { redactSensitiveLogString } from './bridgeLog.js'

const SENSITIVE_DIAGNOSTIC_KEY = /(?:password|authorization|cookie|secret|api[-_]?key|access[-_]?token|refresh[-_]?token|auth[-_]?token|^token$)/iu
const DIAGNOSTIC_MAX_DEPTH = 16

export function redactDiagnosticsValue(
  value: unknown,
  depth = 0,
  ancestors = new WeakSet<object>(),
): unknown {
  if (typeof value === 'string') return redactSensitiveLogString(value)
  if (typeof value !== 'object' || value === null) return value
  if (depth > DIAGNOSTIC_MAX_DEPTH) return '[DEPTH_LIMIT]'
  if (ancestors.has(value)) return '[CIRCULAR]'

  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      return value.map((item) => redactDiagnosticsValue(item, depth + 1, ancestors))
    }

    const redacted: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      redacted[key] = SENSITIVE_DIAGNOSTIC_KEY.test(key)
        ? '[REDACTED]'
        : redactDiagnosticsValue(item, depth + 1, ancestors)
    }
    return redacted
  } finally {
    ancestors.delete(value)
  }
}
