/**
 * Shared, structural-only classification for the ordinary thread list (sourceKinds omitted or []).
 *
 * Structural-only rule: a thread is hidden only when its own structure says so, i.e. an exact
 * source enum value, an exact nested tag, or a strictly boolean marker. There is no title/preview
 * matching, no id blacklist and no heuristic (e.g. "guardian" inside a name), and this module never
 * throws: anything unrecognized - unknown sources, future sources, missing fields, other nested
 * tags, `false` or non-boolean markers - stays visible.
 *
 * Exactness: raw source enum strings are compared verbatim, never trimmed or otherwise normalized,
 * so `{subAgent: ' guardian '}` and `{subAgent: {other: 'guardian '}}` are unrecognized values and
 * stay visible; only the exact `'guardian'` enum is internal. The same verbatim comparison applies
 * to the already-normalized `sourceKind` values.
 *
 * Precedence, because display normalization is lossy: a raw `source` decides first; without one a
 * literal boolean `internalSource` (true or false) is authoritative, so the decision made on the
 * raw value survives a trimmed display `sourceKind`; only an absent or non-boolean classification
 * falls back to the exact normalized `sourceKind` forms.
 *
 * Hiding is a list-visibility decision only: it never archives, deletes, stops or rewrites a
 * thread, its pins, its messages, its approvals or its runtime state.
 *
 * Accepted input (unknown-safe, for raw rows and finite UiThread objects alike):
 *  - raw app-server row: `{source, ephemeral?, sideConversation?}` (a raw `source` wins);
 *  - normalized UiThread: `{sourceKind?, internalSource?, ephemeral?, sideConversation?}`.
 */

/**
 * Finite UiThread fields persisted by the frontend so later passes (sidebar list cache read/write,
 * local in-progress merge, field equality, project-identity merge) can re-decide visibility
 * without keeping the whole raw Thread. Obtain them with `readThreadVisibilityFields()`.
 */
export type ThreadVisibilityFields = {
  internalSource?: boolean
  ephemeral?: boolean
  sideConversation?: boolean
}

type ThreadVisibility = {
  internalSource: boolean
  ephemeral: boolean
  sideConversation: boolean
}

const SUB_AGENT_SOURCE_KEYS = ['subAgent', 'subagent'] as const
const INTERNAL_SUB_AGENT_KINDS = ['review', 'compact', 'memory_consolidation', 'guardian'] as const
const INTERNAL_ROOT_SOURCE_KINDS = ['guardian', 'memory_consolidation'] as const
const INTERNAL_SOURCE_KINDS = new Set<string>(
  SUB_AGENT_SOURCE_KEYS.flatMap((key) => INTERNAL_SUB_AGENT_KINDS.map((kind) => `${key}.${kind}`)),
)

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** Verbatim string, no trim: an unrecognized spelling must never become a recognized enum. */
function readExactString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function isInternalSubAgentValue(value: unknown): boolean {
  const direct = readExactString(value)
  if (direct !== '') return (INTERNAL_SUB_AGENT_KINDS as readonly string[]).includes(direct)
  const record = asRecord(value)
  return record ? readExactString(record.other) === 'guardian' : false
}

function isInternalThreadSource(source: unknown): boolean {
  const record = asRecord(source)
  if (!record) return false

  for (const key of SUB_AGENT_SOURCE_KEYS) {
    const value = record[key]
    if (value !== undefined && isInternalSubAgentValue(value)) return true
  }

  if (record.internal !== undefined) {
    return (INTERNAL_ROOT_SOURCE_KINDS as readonly string[]).includes(readExactString(record.internal))
  }

  return false
}

/** Exact normalized `sourceKind` forms only: `subAgent.other` (and bare `subAgent`) stay visible. */
function isInternalSourceKind(sourceKind: unknown): boolean {
  const kind = readExactString(sourceKind)
  return kind !== '' && INTERNAL_SOURCE_KINDS.has(kind)
}

/**
 * Decision precedence: a raw `source` wins; without one, a literal boolean `internalSource` is
 * authoritative, including `false`. That matters because display normalization is lossy - a raw
 * `{subAgent:' guardian '}` classifies as not-internal while `readSubAgentSourceKind` still trims
 * the display `sourceKind` to `subAgent.guardian`; the raw decision must not be overridden by that
 * trimmed label. Only an absent or non-boolean classification falls back to the exact normalized
 * `sourceKind` forms.
 */
function readInternalSourceVisibility(record: Record<string, unknown>): boolean {
  if (record.source !== undefined) return isInternalThreadSource(record.source)
  if (typeof record.internalSource === 'boolean') return record.internalSource
  return isInternalSourceKind(record.sourceKind)
}

function readThreadVisibility(value: unknown): ThreadVisibility {
  const record = asRecord(value)
  if (!record) return { internalSource: false, ephemeral: false, sideConversation: false }

  return {
    internalSource: readInternalSourceVisibility(record),
    ephemeral: record.ephemeral === true,
    sideConversation: record.sideConversation === true,
  }
}

/** The single ordinary-list predicate, for raw rows, cached rows and UiThreads alike. */
export function isThreadVisibleInOrdinaryList(value: unknown): boolean {
  const visibility = readThreadVisibility(value)
  return !visibility.internalSource && !visibility.ephemeral && !visibility.sideConversation
}

/** Finite fields to persist for a later re-decision; missing/unknown input reports all-false. */
export function readThreadVisibilityFields(value: unknown): ThreadVisibilityFields {
  const visibility = readThreadVisibility(value)
  return {
    internalSource: visibility.internalSource,
    ephemeral: visibility.ephemeral,
    sideConversation: visibility.sideConversation,
  }
}
