#!/usr/bin/env node

import { randomBytes } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'interrupted', 'stopped'])

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

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function unwrap(payload, key, label) {
  const record = asRecord(payload)
  if (!record || !Object.prototype.hasOwnProperty.call(record, key)) {
    throw new Error(`${label} returned a malformed ${key} envelope`)
  }
  return record[key]
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

async function readJson(url, options = {}, timeoutMs = 30_000, acceptedStatuses = []) {
  const response = await fetchWithTimeout(url, options, timeoutMs)
  const payload = await response.json().catch(() => null)
  if (!response.ok && !acceptedStatuses.includes(response.status)) {
    const record = asRecord(payload)
    throw new Error(`${url} returned HTTP ${response.status}: ${String(record?.error ?? record?.message ?? 'request failed')}`)
  }
  return { status: response.status, payload }
}

async function postJson(baseUrl, path, body, acceptedStatuses = []) {
  return await readJson(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 30_000, acceptedStatuses)
}

async function rpc(baseUrl, method, params) {
  const response = await postJson(baseUrl, '/codex-api/rpc', { method, params })
  return unwrap(response.payload, 'result', `RPC ${method}`)
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

async function uploadImage(baseUrl, imagePath) {
  const details = await stat(imagePath)
  if (!details.isFile() || details.size <= 0) throw new Error('image fixture is missing or empty')
  const form = new FormData()
  form.append('file', new Blob([await readFile(imagePath)], { type: 'image/png' }), basename(imagePath))
  const response = await readJson(`${baseUrl}/codex-api/upload-file`, { method: 'POST', body: form })
  const uploadedPath = asRecord(response.payload)?.path
  if (typeof uploadedPath !== 'string' || !uploadedPath.trim()) throw new Error('upload response is missing path')
  return uploadedPath.trim()
}

const baseUrl = readArg(['--base-url', '-BaseUrl'], 'http://127.0.0.1:7420').replace(/\/+$/u, '')
const cwd = resolve(readArg(['--cwd', '-Cwd'], process.cwd()))
const timeoutMs = Number(readArg(['--timeout-ms'], '120000'))
if (!Number.isFinite(timeoutMs) || timeoutMs < 10_000) throw new Error('--timeout-ms must be at least 10000')
const withImage = hasArg('--with-image', '-WithImage')
const keepThread = hasArg('--keep-thread', '-KeepThread')
const token = `CX_7420_ROUNDTRIP_OK_${Date.now().toString(36).toUpperCase()}`
const clientMessageId = `cm-stability-${Date.now().toString(36)}-${randomBytes(5).toString('hex')}`
const input = [{ type: 'text', text: `Reply with exactly ${token} and do not use tools.` }]
if (withImage) {
  input.push({ type: 'localImage', path: await uploadImage(baseUrl, resolve('public/branding/cx-codex-logo.png')) })
}
const sendPayload = {
  threadId: '',
  cwd,
  input,
  attachments: [],
  collaborationMode: 'execute',
  effort: 'low',
  clientMessageId,
}

let threadId = ''
let turnId = ''
let requestId = ''
let terminalStatus = ''
let archived = false
const statusHistory = []
const startedAtMs = Date.now()

try {
  const replayBefore = asRecord(unwrap(
    (await readJson(`${baseUrl}/codex-api/events/replay?after=0&limit=1`)).payload,
    'data',
    'event replay',
  ))
  const replayStartSeq = typeof replayBefore?.latestSeq === 'number' ? replayBefore.latestSeq : 0

  const sends = await Promise.all([
    postJson(baseUrl, '/codex-api/runtime/send', sendPayload, [202]),
    postJson(baseUrl, '/codex-api/runtime/send', sendPayload, [202]),
  ])
  const accepted = sends.map((response) => asRecord(unwrap(response.payload, 'data', 'runtime send')))
  const acceptedRequestIds = accepted.map((row) => {
    const request = asRecord(row?.request)
    return typeof request?.requestId === 'string'
      ? request.requestId
      : typeof row?.requestId === 'string'
        ? row.requestId
        : ''
  })
  if (!acceptedRequestIds[0] || acceptedRequestIds[0] !== acceptedRequestIds[1]) {
    throw new Error('duplicate sends did not converge to one durable request')
  }
  requestId = acceptedRequestIds[0]

  const deadline = Date.now() + timeoutMs
  let lastStatus = ''
  while (Date.now() < deadline) {
    const lookup = await readJson(
      `${baseUrl}/codex-api/runtime/request?clientMessageId=${encodeURIComponent(clientMessageId)}`,
      {},
      15_000,
      [404],
    )
    if (lookup.status !== 404) {
      const request = asRecord(unwrap(lookup.payload, 'data', 'runtime request'))
      const status = typeof request?.status === 'string' ? request.status : ''
      threadId = typeof request?.threadId === 'string' ? request.threadId.trim() : threadId
      turnId = typeof request?.turnId === 'string' ? request.turnId.trim() : turnId
      if (status && status !== lastStatus) {
        statusHistory.push({ status, elapsedMs: Date.now() - startedAtMs })
        lastStatus = status
      }
      if (TERMINAL_STATUSES.has(status)) {
        terminalStatus = status
        break
      }
    }
    await sleep(200)
  }
  if (!terminalStatus) throw new Error(`runtime request did not settle within ${timeoutMs}ms`)
  if (terminalStatus !== 'completed') throw new Error(`runtime request settled as ${terminalStatus}`)
  if (!threadId) throw new Error('runtime request never acquired a thread ID')

  await sleep(750)
  const stableLookup = asRecord(unwrap(
    (await readJson(`${baseUrl}/codex-api/runtime/request?clientMessageId=${encodeURIComponent(clientMessageId)}`)).payload,
    'data',
    'stable runtime request',
  ))
  if (stableLookup?.requestId !== requestId || stableLookup?.threadId !== threadId || stableLookup?.status !== 'completed') {
    throw new Error('terminal request identity or status changed after settling')
  }

  const threadState = asRecord(unwrap(
    (await readJson(`${baseUrl}/codex-api/runtime/thread/${encodeURIComponent(threadId)}`)).payload,
    'data',
    'runtime thread state',
  ))
  const snapshot = asRecord(threadState?.snapshot)
  const latestReply = typeof snapshot?.latestReply === 'string' ? snapshot.latestReply.trim() : ''
  if (latestReply !== token) throw new Error(`final reply mismatch: ${JSON.stringify(latestReply)}`)
  if (snapshot?.inProgress === true) throw new Error('thread remains in progress after completion')

  const replayAfter = asRecord(unwrap(
    (await readJson(`${baseUrl}/codex-api/events/replay?after=${replayStartSeq}&limit=1000`)).payload,
    'data',
    'event replay',
  ))
  const notifications = Array.isArray(replayAfter?.notifications) ? replayAfter.notifications : []
  const threadEvents = notifications.filter((event) => {
    const params = asRecord(asRecord(event)?.params)
    return params?.threadId === threadId || asRecord(params?.thread)?.id === threadId
  })
  const methods = threadEvents.map((event) => asRecord(event)?.method).filter((method) => typeof method === 'string')
  const startedIndex = methods.findIndex((method) => method === 'turn/started' || method === 'turn/start')
  const completedIndex = methods.findIndex((method) => method === 'turn/completed' || method === 'thread/completed')
  if (startedIndex < 0 || completedIndex <= startedIndex) {
    throw new Error(`event lifecycle is incomplete or out of order: ${methods.join(', ')}`)
  }
  const historyStatuses = statusHistory.map((entry) => entry.status)
  if (!historyStatuses.includes('running')) throw new Error(`request never exposed running state: ${historyStatuses.join(' -> ')}`)

  console.log(`[7420-roundtrip] ${JSON.stringify({
    ok: true,
    withImage,
    elapsedMs: Date.now() - startedAtMs,
    statusHistory,
    eventCount: methods.length,
    duplicateSendConverged: true,
    exactReply: true,
  })}`)
} finally {
  if (threadId && !terminalStatus && turnId) {
    await postJson(baseUrl, '/codex-api/runtime/interrupt', {
      threadId,
      turnId,
      source: 'roundtrip-cleanup',
      requestedAtIso: new Date().toISOString(),
    }, [202]).catch(() => {})
  }
  if (threadId && !keepThread) {
    await rpc(baseUrl, 'thread/archive', { threadId }).then(() => { archived = true }).catch(() => {})
  }
  if (threadId) console.log(`[7420-roundtrip] cleanup ${JSON.stringify({ archived, kept: keepThread })}`)
}
