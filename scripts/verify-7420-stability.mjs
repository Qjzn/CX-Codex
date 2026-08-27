#!/usr/bin/env node

import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

const DEFAULT_BASE_URL = 'http://127.0.0.1:7420'
const DEFAULT_IMAGE_PATH = 'public/branding/cx-codex-logo.png'

function readArg(names, fallback = '') {
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index]
    for (const name of names) {
      if (arg === name && typeof process.argv[index + 1] === 'string') return process.argv[index + 1]
      if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1)
    }
  }
  return fallback
}

function hasArg(...names) {
  return process.argv.slice(2).some((arg) => names.includes(arg))
}

function readNonNegativeNumber(names, fallback) {
  const value = Number(readArg(names, String(fallback)))
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${names[0]} must be a non-negative number`)
  }
  return value
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function readNumber(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30_000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

async function readJson(url, options = {}, timeoutMs = 30_000) {
  const response = await fetchWithTimeout(url, options, timeoutMs)
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const record = asRecord(payload)
    throw new Error(`${url} returned HTTP ${response.status}: ${String(record?.error ?? record?.message ?? 'request failed')}`)
  }
  return payload
}

function unwrap(payload, key, label) {
  const record = asRecord(payload)
  if (!record || !Object.prototype.hasOwnProperty.call(record, key)) {
    throw new Error(`${label} returned a malformed ${key} envelope`)
  }
  return record[key]
}

async function measure(label, action) {
  const startedAt = performance.now()
  const value = await action()
  return { label, durationMs: Math.round(performance.now() - startedAt), value }
}

async function findNewestDesktopCodexExecutable() {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return ''
  const binDir = join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin')
  const candidates = []
  for (const entry of await readdir(binDir, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue
    const path = join(binDir, entry.name, 'codex.exe')
    const details = await stat(path).catch(() => null)
    if (details?.isFile()) candidates.push({ path, modifiedAtMs: details.mtimeMs })
  }
  candidates.sort((first, second) => second.modifiedAtMs - first.modifiedAtMs)
  return candidates[0]?.path ?? ''
}

const baseUrl = readArg(['--base-url', '-BaseUrl'], DEFAULT_BASE_URL).replace(/\/+$/u, '')
const imagePath = resolve(readArg(['--image-path', '-ImagePath'], DEFAULT_IMAGE_PATH))
const maxUncertainRequests = readNonNegativeNumber(['--max-uncertain'], 0)
const maxActiveListMs = readNonNegativeNumber(['--max-active-list-ms'], 5_000)
const skipImage = hasArg('--skip-image', '-SkipImage')
const failures = []
const metrics = {}

async function check(label, action) {
  try {
    await action()
    console.log(`[PASS] ${label}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    failures.push(`${label}: ${message}`)
    console.error(`[FAIL] ${label}: ${message}`)
  }
}

await check('health and durable runtime state', async () => {
  const plainHealth = await measure('health', () => readJson(`${baseUrl}/health`, {}, 10_000))
  const apiHealth = await measure('codex-api health', () => readJson(`${baseUrl}/codex-api/health`, {}, 20_000))
  const plain = asRecord(plainHealth.value)
  const data = asRecord(unwrap(apiHealth.value, 'data', 'codex-api health'))
  const appServer = asRecord(data?.appServer)
  const runtimeStore = asRecord(data?.runtimeStore)
  if (plain?.status !== 'ok') throw new Error('plain health status is not ok')
  if (!appServer?.running || !appServer?.initialized || appServer?.stopping) {
    throw new Error('App Server is not running and initialized')
  }
  const uncertain = readNumber(runtimeStore?.uncertainRequestCount)
  if (uncertain > maxUncertainRequests) {
    throw new Error(`uncertain request count ${uncertain} exceeds ${maxUncertainRequests}`)
  }
  const pendingRpc = readNumber(appServer?.pendingRpcCount)
  const queuedRpc = readNumber(appServer?.queuedRpcCount)
  const pendingServerRequests = readNumber(appServer?.pendingServerRequestCount)
  metrics.healthMs = plainHealth.durationMs
  metrics.apiHealthMs = apiHealth.durationMs
  metrics.uncertainRequests = uncertain
  metrics.pendingRpc = pendingRpc
  metrics.queuedRpc = queuedRpc
  metrics.pendingServerRequests = pendingServerRequests
  const activeCommand = typeof appServer.command === 'string' ? appServer.command.trim() : ''
  const newestDesktopCommand = await findNewestDesktopCodexExecutable()
  if (newestDesktopCommand) {
    if (!activeCommand) throw new Error('health is missing the active Codex command')
    const comparableActive = resolve(activeCommand).toLowerCase()
    const comparableNewest = resolve(newestDesktopCommand).toLowerCase()
    if (comparableActive !== comparableNewest && comparableActive.includes('\\openai\\codex\\bin\\')) {
      throw new Error('App Server is using an older Codex desktop executable')
    }
    metrics.codexCommandCurrent = comparableActive === comparableNewest
  }
})

await check('event replay stream matches runtime store', async () => {
  const [healthPayload, replayPayload] = await Promise.all([
    readJson(`${baseUrl}/codex-api/health`, {}, 20_000),
    readJson(`${baseUrl}/codex-api/events/replay?after=0&limit=1`, {}, 10_000),
  ])
  const healthData = asRecord(unwrap(healthPayload, 'data', 'codex-api health'))
  const runtimeStore = asRecord(healthData?.runtimeStore)
  const replay = asRecord(unwrap(replayPayload, 'data', 'event replay'))
  const runtimeStreamId = typeof runtimeStore?.streamId === 'string' ? runtimeStore.streamId : ''
  const replayStreamId = typeof replay?.streamId === 'string' ? replay.streamId : ''
  if (!runtimeStreamId || runtimeStreamId !== replayStreamId) throw new Error('runtime and replay stream IDs differ')
  const oldestSeq = readNumber(replay?.oldestSeq, -1)
  const latestSeq = readNumber(replay?.latestSeq, -1)
  if (oldestSeq < 0 || latestSeq < oldestSeq) throw new Error(`invalid replay bounds ${oldestSeq}..${latestSeq}`)
  metrics.eventWindow = latestSeq - oldestSeq + 1
})

await check('active thread list is timely and unique', async () => {
  const response = await measure('thread/list', () => readJson(`${baseUrl}/codex-api/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: 'thread/list',
      params: { archived: false, limit: 100, sortKey: 'updated_at', cursor: null },
    }),
  }, 60_000))
  const result = asRecord(unwrap(response.value, 'result', 'thread/list'))
  const rows = Array.isArray(result?.data) ? result.data : null
  if (!rows) throw new Error('thread/list result is missing data')
  const ids = rows
    .map((row) => asRecord(row)?.id)
    .filter((id) => typeof id === 'string' && id.trim())
  const duplicateCount = ids.length - new Set(ids).size
  if (duplicateCount > 0) throw new Error(`first page contains ${duplicateCount} duplicate thread IDs`)
  if (response.durationMs > maxActiveListMs) {
    throw new Error(`first page took ${response.durationMs}ms; expected <= ${maxActiveListMs}ms`)
  }
  metrics.activeListMs = response.durationMs
  metrics.activeThreadCount = ids.length
})

if (!skipImage) {
  await check('uploaded image is immediately readable', async () => {
    const sourceStat = await stat(imagePath)
    if (!sourceStat.isFile() || sourceStat.size <= 0) throw new Error('image fixture is missing or empty')
    const form = new FormData()
    form.append('file', new Blob([await readFile(imagePath)], { type: 'image/png' }), basename(imagePath))
    const upload = await measure('image upload', () => readJson(`${baseUrl}/codex-api/upload-file`, {
      method: 'POST',
      body: form,
    }, 30_000))
    const uploadedPath = asRecord(upload.value)?.path
    if (typeof uploadedPath !== 'string' || !uploadedPath.trim()) throw new Error('upload response is missing path')
    const download = await measure('image read', () => fetchWithTimeout(
      `${baseUrl}/codex-local-image?path=${encodeURIComponent(uploadedPath)}`,
      {},
      30_000,
    ))
    if (!download.value.ok) {
      const payload = await download.value.json().catch(() => null)
      throw new Error(`uploaded image read returned HTTP ${download.value.status}: ${String(asRecord(payload)?.error ?? 'request failed')}`)
    }
    const bytes = (await download.value.arrayBuffer()).byteLength
    if (bytes !== sourceStat.size) throw new Error(`uploaded image size changed from ${sourceStat.size} to ${bytes} bytes`)
    metrics.imageUploadMs = upload.durationMs
    metrics.imageReadMs = download.durationMs
    metrics.imageBytes = bytes
  })
}

console.log(`[7420-stability] metrics ${JSON.stringify(metrics)}`)
if (failures.length > 0) {
  throw new Error(`${failures.length} stability check(s) failed:\n- ${failures.join('\n- ')}`)
}
console.log('[7420-stability] all checks passed')
