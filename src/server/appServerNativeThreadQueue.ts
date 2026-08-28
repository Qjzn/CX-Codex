export const NATIVE_THREAD_QUEUE_MARKER_PREFIX = 'native_thread_queue:'
export const EXTERNAL_ACTIVE_WRITER_MARKER = 'external_active_writer'

export type RuntimeQueueWaitReason = 'native_writer' | 'external_writer'

export type NativeThreadQueueSubmission = {
  id: string
  clientUserMessageId: string
}

type AppServerRpc = (method: string, params: unknown) => Promise<unknown>

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeSubmission(value: unknown): NativeThreadQueueSubmission | null {
  const row = asRecord(value)
  const id = readString(row?.id)
  if (!id) return null
  return {
    id,
    clientUserMessageId: readString(row?.clientUserMessageId),
  }
}

export function createNativeThreadQueueMarker(submissionId: string): string {
  return `${NATIVE_THREAD_QUEUE_MARKER_PREFIX}${submissionId.trim()}`
}

export function readNativeThreadQueueSubmissionId(lastError: string | null | undefined): string {
  const value = lastError?.trim() ?? ''
  return value.startsWith(NATIVE_THREAD_QUEUE_MARKER_PREFIX)
    ? value.slice(NATIVE_THREAD_QUEUE_MARKER_PREFIX.length).trim()
    : ''
}

export function readRuntimeQueueWaitReason(lastError: string | null | undefined): RuntimeQueueWaitReason | undefined {
  if (readNativeThreadQueueSubmissionId(lastError)) return 'native_writer'
  return lastError?.trim() === EXTERNAL_ACTIVE_WRITER_MARKER ? 'external_writer' : undefined
}

export function isNativeThreadQueueUnsupportedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? '').toLowerCase()
  return ['method not found', 'unknown method', 'unsupported method', 'not supported']
    .some((fragment) => message.includes(fragment))
}

export async function listNativeThreadQueueSubmissions(
  rpc: AppServerRpc,
  threadId: string,
): Promise<NativeThreadQueueSubmission[]> {
  const submissions: NativeThreadQueueSubmission[] = []
  const seenCursors = new Set<string>()
  let cursor = ''
  while (submissions.length < 500) {
    const result = asRecord(await rpc('thread/queue/list', {
      threadId,
      limit: 100,
      ...(cursor ? { cursor } : {}),
    }))
    const data = Array.isArray(result?.data) ? result.data : []
    submissions.push(...data
      .map(normalizeSubmission)
      .filter((submission): submission is NativeThreadQueueSubmission => submission !== null))
    const nextCursor = readString(result?.nextCursor)
    if (!nextCursor || seenCursors.has(nextCursor)) break
    seenCursors.add(nextCursor)
    cursor = nextCursor
  }
  return submissions.slice(0, 500)
}

export async function ensureNativeThreadQueueSubmission(args: {
  rpc: AppServerRpc
  threadId: string
  input: unknown[]
  clientUserMessageId: string
}): Promise<NativeThreadQueueSubmission> {
  const findExisting = async (): Promise<NativeThreadQueueSubmission | null> => {
    const rows = await listNativeThreadQueueSubmissions(args.rpc, args.threadId)
    return rows.find((row) => row.clientUserMessageId === args.clientUserMessageId) ?? null
  }

  const existing = await findExisting()
  if (existing) return existing

  try {
    const result = asRecord(await args.rpc('thread/queue/add', {
      threadId: args.threadId,
      input: args.input,
      clientUserMessageId: args.clientUserMessageId,
    }))
    const submission = normalizeSubmission(result?.queuedSubmission)
    if (submission) return submission
  } catch (error) {
    // A local transport failure can happen after Core committed the queue row.
    // Re-read by the stable client id before allowing the legacy retry path.
    try {
      const reconciled = await findExisting()
      if (reconciled) return reconciled
    } catch {
      // Preserve the original add failure below.
    }
    throw error
  }

  const reconciled = await findExisting()
  if (reconciled) return reconciled
  throw new Error('thread/queue/add did not return or persist a queued submission')
}

export async function deleteNativeThreadQueueSubmission(
  rpc: AppServerRpc,
  threadId: string,
  queuedSubmissionId: string,
): Promise<void> {
  await rpc('thread/queue/delete', { threadId, queuedSubmissionId })
}

export async function reorderNativeThreadQueueSubmissions(
  rpc: AppServerRpc,
  threadId: string,
  desiredKnownIds: string[],
): Promise<void> {
  const current = await listNativeThreadQueueSubmissions(rpc, threadId)
  const currentIds = current.map((row) => row.id)
  const desiredSet = new Set(desiredKnownIds)
  const desiredPresent = desiredKnownIds.filter((id) => currentIds.includes(id))
  if (desiredPresent.length < 2) return

  let desiredIndex = 0
  const nextIds = currentIds.map((id) => (
    desiredSet.has(id) ? desiredPresent[desiredIndex++] ?? id : id
  ))
  if (nextIds.every((id, index) => id === currentIds[index])) return
  await rpc('thread/queue/reorder', {
    threadId,
    queuedSubmissionIds: nextIds,
  })
}
