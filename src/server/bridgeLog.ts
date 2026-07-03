export type BridgeLogLevel = 'warn' | 'error'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function getErrorMessage(payload: unknown, fallback: string): string {
  if (payload instanceof Error && payload.message.trim().length > 0) {
    return payload.message
  }

  const record = asRecord(payload)
  if (!record) return fallback

  const error = record.error
  if (typeof error === 'string' && error.length > 0) return error

  const nestedError = asRecord(error)
  if (nestedError && typeof nestedError.message === 'string' && nestedError.message.length > 0) {
    return nestedError.message
  }

  return fallback
}

export function redactSensitiveLogString(value: string): string {
  return value
    .replace(
      /(["'])([^"']*(?:password|authorization|cookie|token|secret|api[-_]?key|auth)[^"']*)\1\s*:\s*(["'])([^"']*)\3/giu,
      '$1$2$1:$3[REDACTED]$3',
    )
    .replace(/(password\s*[:=]\s*)([^\s"'`,;]+)/giu, '$1[REDACTED]')
    .replace(/(authorization\s*[:=]\s*bearer\s+)([^\s"'`,;]+)/giu, '$1[REDACTED]')
    .replace(/((?:access_token|auth_token|token|api_key|apikey|secret)=)([^&\s"'`,;]+)/giu, '$1[REDACTED]')
}

export function sanitizeBridgeLogValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[DEPTH_LIMIT]'
  if (typeof value === 'string') return redactSensitiveLogString(value)
  if (typeof value !== 'object' || value === null) return value
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeBridgeLogValue(item, depth + 1))
  }

  const record = value as Record<string, unknown>
  const sanitized: Record<string, unknown> = {}
  for (const [key, entryValue] of Object.entries(record)) {
    if (/password|authorization|cookie|token|secret|api[-_]?key|auth/i.test(key)) {
      sanitized[key] = '[REDACTED]'
      continue
    }
    sanitized[key] = sanitizeBridgeLogValue(entryValue, depth + 1)
  }
  return sanitized
}

export function writeBridgeLog(level: BridgeLogLevel, message: string, details: Record<string, unknown> = {}): void {
  try {
    const sanitizedDetails = sanitizeBridgeLogValue(details)
    process.stderr.write(`${JSON.stringify({
      atIso: new Date().toISOString(),
      scope: 'codex-bridge',
      level,
      message: redactSensitiveLogString(message),
      ...(asRecord(sanitizedDetails) ?? {}),
    })}\n`)
  } catch {
    // Logging must never interfere with bridge traffic.
  }
}

export function logBridgeError(message: string, error: unknown, details: Record<string, unknown> = {}): void {
  writeBridgeLog('error', message, {
    ...details,
    error: getErrorMessage(error, 'Unknown bridge error'),
  })
}
