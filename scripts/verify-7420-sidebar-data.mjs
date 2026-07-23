#!/usr/bin/env node

const DEFAULT_BASE_URL = 'http://127.0.0.1:7420'
const THREAD_LIST_LIMIT = 100
const SUPPLEMENTAL_THREAD_READ_LIMIT = 20
const PINNED_THREAD_READ_SAMPLE_LIMIT = 20
const ACTIVE_FIRST_PAGE_MAX_MS = 15_000

function readArgValue(names, fallback) {
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index]
    for (const name of names) {
      if (arg === name && typeof process.argv[index + 1] === 'string') {
        return process.argv[index + 1]
      }
      if (arg.startsWith(`${name}=`)) {
        return arg.slice(name.length + 1)
      }
    }
  }
  return fallback
}

const baseUrl = readArgValue(['--base-url', '-BaseUrl'], DEFAULT_BASE_URL).replace(/\/+$/u, '')
const requiredThreadTitle = readArgValue(['--require-thread-title', '-RequireThreadTitle'], '').trim()
let rpcRetryCount = 0

function fail(message) {
  throw new Error(message)
}

function assert(condition, message) {
  if (!condition) fail(message)
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function dataEnvelope(value, label) {
  const record = asRecord(value)
  assert(record && Object.prototype.hasOwnProperty.call(record, 'data'), `${label} returned malformed data envelope`)
  return record.data
}

function resultEnvelope(value, label) {
  const record = asRecord(value)
  assert(record && Object.prototype.hasOwnProperty.call(record, 'result'), `${label} returned malformed RPC envelope`)
  return record.result
}

async function readJson(url, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000)
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        ...(options.headers ?? {}),
      },
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      const message = asRecord(payload)?.error ?? asRecord(payload)?.message ?? `HTTP ${response.status}`
      fail(`${url} failed: ${String(message)}`)
    }
    return payload
  } finally {
    clearTimeout(timeout)
  }
}

async function getJson(path) {
  return await readJson(`${baseUrl}${path}`)
}

async function postJson(path, body) {
  return await readJson(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

async function rpc(method, params) {
  const maxAttempts = method === 'thread/list' ? 2 : 1
  let lastError = null
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const payload = await readJson(`${baseUrl}/codex-api/rpc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ method, params: params ?? null }),
        timeoutMs: method === 'thread/list' ? 60_000 : 30_000,
      })
      return resultEnvelope(payload, `RPC ${method}`)
    } catch (error) {
      lastError = error
      if (attempt >= maxAttempts) break
      rpcRetryCount += 1
      await new Promise((resolve) => setTimeout(resolve, 750))
    }
  }
  throw lastError
}

function normalizeStringArray(value, label) {
  assert(Array.isArray(value), `${label} must be an array`)
  return value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
}

function assertUnique(items, label) {
  const seen = new Set()
  for (const item of items) {
    assert(!seen.has(item), `${label} contains duplicate value: ${item}`)
    seen.add(item)
  }
}

function normalizePathForUi(value) {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (trimmed.startsWith('\\\\?\\UNC\\')) return `\\\\${trimmed.slice('\\\\?\\UNC\\'.length)}`
  if (trimmed.startsWith('\\\\?\\')) return trimmed.slice('\\\\?\\'.length)
  return trimmed
}

function normalizeComparablePath(value) {
  const normalized = normalizePathForUi(value).replace(/[\\/]+/gu, '/')
  return /^[a-z]:\//iu.test(normalized) || normalized.startsWith('//') ? normalized.toLowerCase() : normalized
}

function toProjectName(value) {
  const normalized = normalizePathForUi(value).replace(/[\\/]+$/u, '')
  if (!normalized) return 'unknown-project'
  const separatorIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  return separatorIndex < 0 ? normalized : (normalized.slice(separatorIndex + 1) || normalized)
}

function readThreadTimestampSeconds(thread, key) {
  const record = asRecord(thread)
  const value = record?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function readThreadId(thread) {
  const record = asRecord(thread)
  return typeof record?.id === 'string' ? record.id.trim() : ''
}

function readThreadTitle(thread) {
  const record = asRecord(thread)
  for (const key of ['title', 'name', 'thread_name']) {
    const value = record?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function readThreadProjectName(thread) {
  const record = asRecord(thread)
  const cwd = typeof record?.cwd === 'string' ? record.cwd : ''
  return toProjectName(cwd)
}

function compareThreadsByRecency(first, second) {
  const firstUpdated = readThreadTimestampSeconds(first, 'updatedAt')
  const secondUpdated = readThreadTimestampSeconds(second, 'updatedAt')
  if (firstUpdated !== secondUpdated) return secondUpdated - firstUpdated
  const firstCreated = readThreadTimestampSeconds(first, 'createdAt')
  const secondCreated = readThreadTimestampSeconds(second, 'createdAt')
  return secondCreated - firstCreated
}

function groupThreadsByProject(threads) {
  const grouped = new Map()
  for (const thread of threads) {
    const projectName = readThreadProjectName(thread)
    if (!grouped.has(projectName)) grouped.set(projectName, [])
    grouped.get(projectName).push(thread)
  }
  return Array.from(grouped.entries())
    .map(([projectName, rows]) => ({
      projectName,
      threads: [...rows].sort(compareThreadsByRecency),
    }))
    .sort((first, second) => compareThreadsByRecency(first.threads[0], second.threads[0]))
}

function uniqueByValue(items) {
  const seen = new Set()
  const result = []
  for (const item of items) {
    if (!item || seen.has(item)) continue
    seen.add(item)
    result.push(item)
  }
  return result
}

function computeWorkspaceProjectOrder(workspaceState) {
  const order = normalizeStringArray(workspaceState.order, 'workspace order')
  const projectOrder = normalizeStringArray(workspaceState.projectOrder, 'workspace projectOrder')
  const pinnedProjectIds = normalizeStringArray(workspaceState.pinnedProjectIds, 'workspace pinnedProjectIds')

  assertUnique(projectOrder, 'workspace projectOrder')
  assertUnique(pinnedProjectIds, 'workspace pinnedProjectIds')

  const combinedRoots = uniqueByValue([...projectOrder, ...order])
  const combinedRootSet = new Set(combinedRoots.map(normalizeComparablePath))
  const pinnedProjectNames = []
  for (const rootPath of pinnedProjectIds) {
    assert(
      combinedRootSet.has(normalizeComparablePath(rootPath)),
      `pinned project root is missing from projectOrder/order: ${rootPath}`,
    )
    pinnedProjectNames.push(toProjectName(rootPath))
  }

  return uniqueByValue([
    ...pinnedProjectNames,
    ...combinedRoots.map(toProjectName),
  ])
}

async function readThreadListFirstPage(archived) {
  const result = await rpc('thread/list', {
    archived,
    limit: THREAD_LIST_LIMIT,
    sortKey: 'updated_at',
    cursor: null,
  })
  const record = asRecord(result)
  assert(record && Array.isArray(record.data), `thread/list archived=${String(archived)} returned malformed result`)
  return record
}

async function readAllActiveThreads(firstPage) {
  const threads = []
  const seenThreadIds = new Set()
  const overlappingSupplementalThreadIds = new Set()
  const supplementalThreadIds = new Set(
    firstPage.data
      .slice(THREAD_LIST_LIMIT)
      .map(readThreadId)
      .filter(Boolean),
  )

  const appendPage = (rows, label) => {
    const pageThreadIds = new Set()
    for (const row of rows) {
      const threadId = readThreadId(row)
      if (threadId) {
        assert(!pageThreadIds.has(threadId), `${label} contains duplicate thread id: ${threadId}`)
        pageThreadIds.add(threadId)
        if (seenThreadIds.has(threadId)) {
          assert(
            supplementalThreadIds.has(threadId),
            `${label} overlaps a non-supplemental earlier thread: ${threadId}`,
          )
          overlappingSupplementalThreadIds.add(threadId)
          continue
        }
        seenThreadIds.add(threadId)
      }
      threads.push(row)
    }
  }

  appendPage(firstPage.data, 'active first page')
  let cursor = typeof firstPage.nextCursor === 'string' && firstPage.nextCursor.length > 0
    ? firstPage.nextCursor
    : null
  while (cursor) {
    const result = await rpc('thread/list', {
      archived: false,
      limit: THREAD_LIST_LIMIT,
      sortKey: 'updated_at',
      cursor,
    })
    const record = asRecord(result)
    assert(record && Array.isArray(record.data), 'thread/list active cursor page returned malformed result')
    assert(record.data.length <= THREAD_LIST_LIMIT, 'active cursor page was unexpectedly supplemented beyond the requested limit')
    appendPage(record.data, 'active cursor page')
    cursor = typeof record.nextCursor === 'string' && record.nextCursor.length > 0 ? record.nextCursor : null
  }
  return {
    threads,
    overlappingSupplementalThreadIds: [...overlappingSupplementalThreadIds],
  }
}

function isArchivedThread(thread) {
  const record = asRecord(thread)
  if (record?.archived === true) return true
  const threadPath = typeof record?.path === 'string' ? record.path.replace(/\\/gu, '/') : ''
  return threadPath.split('/').some((segment) => segment.toLowerCase() === 'archived_sessions')
}

async function readPinnedThreadSample(pinnedThreadIds) {
  const active = []
  const archived = []
  const unreadable = []
  for (const threadId of pinnedThreadIds.slice(0, PINNED_THREAD_READ_SAMPLE_LIMIT)) {
    try {
      const result = await rpc('thread/read', {
        threadId,
        includeTurns: false,
      })
      const thread = asRecord(asRecord(result)?.thread)
      if (thread?.id !== threadId) {
        unreadable.push(threadId)
      } else if (isArchivedThread(thread)) {
        archived.push(threadId)
      } else {
        active.push(threadId)
      }
    } catch {
      unreadable.push(threadId)
    }
  }
  return { active, archived, unreadable }
}

async function readRequiredThreadFromSearch(title) {
  if (!title) return null

  const searchData = dataEnvelope(await postJson('/codex-api/thread-search', {
    query: title,
    limit: 20,
  }), 'required thread search')
  const searchRecord = asRecord(searchData)
  const threadIds = normalizeStringArray(searchRecord?.threadIds ?? [], 'required thread search threadIds')
  assert(threadIds.length > 0, `required thread title was not found in Desktop/session search index: ${title}`)

  for (const threadId of threadIds) {
    try {
      const result = await rpc('thread/read', {
        threadId,
        includeTurns: false,
      })
      const thread = asRecord(asRecord(result)?.thread)
      if (!thread || readThreadId(thread) !== threadId) continue
      const threadTitle = readThreadTitle(thread)
      if (threadTitle === title || threadTitle.includes(title)) {
        return {
          id: threadId,
          title: threadTitle,
          projectName: readThreadProjectName(thread),
        }
      }
    } catch {
      // Search indexes can temporarily include stale rows; try the next match.
    }
  }

  fail(`required thread title was found by search but no readable matching thread was returned: ${title}`)
}

async function measureAsync(fn) {
  const startedAtMs = Date.now()
  const value = await fn()
  return {
    value,
    durationMs: Date.now() - startedAtMs,
  }
}

function assertProjectPreviewSort(groups) {
  for (const group of groups) {
    const preview = group.threads.slice(0, 5)
    for (let index = 1; index < preview.length; index += 1) {
      assert(
        compareThreadsByRecency(preview[index - 1], preview[index]) <= 0,
        `project ${group.projectName} latest-5 preview is not newest-first`,
      )
    }
  }
}

async function main() {
  const health = await getJson('/health')
  assert(asRecord(health)?.status === 'ok', '/health did not return ok')

  const codexHealth = await getJson('/codex-api/health')
  assert(asRecord(codexHealth)?.status === 'ok', '/codex-api/health did not return ok')

  const pinnedThreadIds = normalizeStringArray(dataEnvelope(await getJson('/codex-api/pinned-threads'), 'pinned threads'), 'pinned threads')
  assertUnique(pinnedThreadIds, 'pinned threads')

  const workspaceState = dataEnvelope(await getJson('/codex-api/workspace-roots-state'), 'workspace roots state')
  const workspaceRecord = asRecord(workspaceState)
  assert(workspaceRecord, 'workspace roots state data must be an object')
  const expectedProjectOrder = computeWorkspaceProjectOrder(workspaceRecord)
  assert(expectedProjectOrder.length > 0, 'workspace project order is empty')

  const activeFirstPageRead = await measureAsync(() => readThreadListFirstPage(false))
  const activeFirstPage = activeFirstPageRead.value
  assert(
    activeFirstPageRead.durationMs <= ACTIVE_FIRST_PAGE_MAX_MS,
    `active thread/list first page took ${activeFirstPageRead.durationMs}ms; expected <= ${ACTIVE_FIRST_PAGE_MAX_MS}ms for sidebar first screen`,
  )
  assert(
    activeFirstPage.data.length <= THREAD_LIST_LIMIT + SUPPLEMENTAL_THREAD_READ_LIMIT,
    'active first page exceeded thread/list limit plus supplemental read limit',
  )
  const archivedFirstPageRead = await measureAsync(() => readThreadListFirstPage(true))
  const archivedFirstPage = archivedFirstPageRead.value
  assert(archivedFirstPage.data.length <= THREAD_LIST_LIMIT, 'archived first page was unexpectedly supplemented beyond the requested limit')

  const activeThreadsRead = await measureAsync(() => readAllActiveThreads(activeFirstPage))
  const activeThreads = activeThreadsRead.value.threads
  const overlappingSupplementalThreadIds = activeThreadsRead.value.overlappingSupplementalThreadIds
  const activeThreadIds = activeThreads.map(readThreadId).filter(Boolean)
  assertUnique(activeThreadIds, 'active thread/list result')

  const pinnedThreadSample = await readPinnedThreadSample(pinnedThreadIds)
  const readable = [...pinnedThreadSample.active, ...pinnedThreadSample.archived]
  const unreadable = pinnedThreadSample.unreadable
  const activeThreadIdSet = new Set(activeThreadIds)
  const requiredThread = await readRequiredThreadFromSearch(requiredThreadTitle)
  if (requiredThread) {
    assert(
      activeThreadIdSet.has(requiredThread.id),
      `required Desktop/session thread is missing from active thread/list data source: ${requiredThread.title} (${requiredThread.id})`,
    )
  }

  for (const threadId of pinnedThreadSample.active) {
    assert(activeThreadIdSet.has(threadId), `readable pinned thread is missing from active thread/list data source: ${threadId}`)
  }
  for (const threadId of pinnedThreadSample.archived) {
    assert(!activeThreadIdSet.has(threadId), `archived pinned thread leaked into active thread/list data source: ${threadId}`)
  }

  const pinnedSectionThreadIds = pinnedThreadIds.filter((threadId) => activeThreadIdSet.has(threadId))
  assert(
    pinnedThreadSample.active.every((threadId, index) => pinnedSectionThreadIds[index] === threadId),
    'computed pinned section order does not follow /codex-api/pinned-threads order',
  )

  const groups = groupThreadsByProject(activeThreads)
  assertProjectPreviewSort(groups)
  const expectedProjectNameSet = new Set(expectedProjectOrder)
  const computedSidebarProjectOrder = uniqueByValue([
    ...expectedProjectOrder,
    ...groups.map((group) => group.projectName).filter((projectName) => !expectedProjectNameSet.has(projectName)),
  ])

  const pinnedProjectNames = normalizeStringArray(workspaceRecord.pinnedProjectIds, 'workspace pinnedProjectIds').map(toProjectName)
  for (let index = 0; index < pinnedProjectNames.length; index += 1) {
    assert(
      computedSidebarProjectOrder[index] === pinnedProjectNames[index],
      `pinned project order drifted at index ${index}: expected ${pinnedProjectNames[index]}, got ${computedSidebarProjectOrder[index] ?? '(missing)'}`,
    )
  }

  const summary = {
    baseUrl,
    pinnedThreadCount: pinnedThreadIds.length,
    readablePinnedSampleCount: readable.length,
    archivedPinnedSampleCount: pinnedThreadSample.archived.length,
    unreadablePinnedSampleCount: unreadable.length,
    activeThreadCount: activeThreads.length,
    overlappingSupplementalThreadIds,
    activeFirstPageCount: activeFirstPage.data.length,
    archivedFirstPageCount: archivedFirstPage.data.length,
    activeFirstPageMs: activeFirstPageRead.durationMs,
    activeFullListMs: activeFirstPageRead.durationMs + activeThreadsRead.durationMs,
    archivedFirstPageMs: archivedFirstPageRead.durationMs,
    rpcRetryCount,
    requiredThread,
    projectGroupCount: groups.length,
    expectedProjectOrderSample: computedSidebarProjectOrder.slice(0, 8),
    projectPreviewSample: groups.slice(0, 5).map((group) => ({
      projectName: group.projectName,
      latestThreadIds: group.threads.slice(0, 5).map(readThreadId),
    })),
  }

  console.log('[7420-sidebar-data] all checks passed')
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error('[7420-sidebar-data] check failed')
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
