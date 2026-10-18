import { MAX_HIGHLIGHT_CHARACTERS, normalizeCodeLanguage } from './conversationCodeHighlight'

type Job = { id: number; code: string; language: string; finish: (html: string | null) => void }
let worker: Worker | null = null
let active: Job | null = null
let sequence = 0
let unavailable = false
let deadline: ReturnType<typeof setTimeout> | undefined
let idle: ReturnType<typeof setTimeout> | undefined
const pending: Job[] = []

function failWorker(): void {
  unavailable = true
  clearTimeout(deadline)
  clearTimeout(idle)
  worker?.terminate()
  worker = null
  active?.finish(null)
  active = null
  for (const job of pending.splice(0)) job.finish(null)
}

function pump(): void {
  if (active || unavailable) return
  clearTimeout(idle)
  const job = pending.shift()
  if (!job) {
    // No permanently running service and no cross-message code cache.
    idle = setTimeout(() => { worker?.terminate(); worker = null }, 10_000)
    return
  }
  active = job
  try {
    if (!worker) {
      worker = new Worker(new URL('./conversationCodeHighlight.worker.ts', import.meta.url), { type: 'module' })
      worker.onerror = (event) => { event.preventDefault(); failWorker() }
      worker.onmessageerror = failWorker
      worker.onmessage = (event: MessageEvent<{ id: number; html: string | null }>) => {
        if (event.data.id !== active?.id) return
        clearTimeout(deadline)
        const finished = active
        active = null
        finished.finish(typeof event.data.html === 'string' ? event.data.html : null)
        pump()
      }
    }
    // Includes cold Worker load. Pathological syntax cannot block the UI or
    // retry forever; a failure leaves all remaining code as readable plain text.
    deadline = setTimeout(failWorker, 3_000)
    worker.postMessage({ id: job.id, code: job.code, language: job.language })
  } catch { failWorker() }
}

export function requestCodeHighlight(code: string, language: string, signal: AbortSignal): Promise<string | null> {
  const normalized = normalizeCodeLanguage(language)
  if (signal.aborted || unavailable || !normalized || !code || code.length > MAX_HIGHLIGHT_CHARACTERS || pending.length >= 64) return Promise.resolve(null)
  return new Promise((resolve) => {
    let settled = false
    const job: Job = {
      id: ++sequence, code, language: normalized,
      finish(html) {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', cancel)
        resolve(html)
      },
    }
    function cancel() {
      const index = pending.indexOf(job)
      if (index >= 0) pending.splice(index, 1)
      job.finish(null)
    }
    signal.addEventListener('abort', cancel, { once: true })
    pending.push(job)
    pump()
  })
}
