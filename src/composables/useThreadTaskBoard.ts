import { computed, onScopeDispose, ref, shallowRef, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { getThreadTaskBoardSnapshots } from '../api/codexGateway'
import type { UiThread } from '../types/codex'
import type { ThreadTaskBoardSnapshot } from '../task-board/projectThreadTaskBoard'

export function useThreadTaskBoard(threads: MaybeRefOrGetter<UiThread[]>) {
  const snapshotsByThreadId = shallowRef<Record<string, ThreadTaskBoardSnapshot>>({})
  const loading = ref(false)
  const error = ref('')
  let generation = 0
  let disposed = false
  let activeController: AbortController | null = null

  const scopedThreads = computed(() => {
    const seen = new Set<string>()
    const result: UiThread[] = []
    for (const thread of toValue(threads)) {
      const id = thread.id.trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      result.push(thread)
    }
    return result
  })
  const threadIds = computed(() => scopedThreads.value.map(thread => thread.id.trim()))
  const fingerprint = computed(() => JSON.stringify(scopedThreads.value.map(thread => [
    thread.id.trim(), thread.inProgress === true, thread.waitingForInput === true, thread.updatedAtIso,
  ]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))))
  const missingCount = computed(() => threadIds.value.filter(id => (
    !Object.hasOwn(snapshotsByThreadId.value, id) || snapshotsByThreadId.value[id]?.stale === true
  )).length)

  async function refresh(): Promise<void> {
    if (disposed) return
    const currentGeneration = ++generation
    activeController?.abort()
    const controller = new AbortController()
    activeController = controller
    const ids = [...threadIds.value]
    const previous = snapshotsByThreadId.value
    // Remove snapshots that no longer belong to the visible scope without mutating cached rows.
    const staged: Record<string, ThreadTaskBoardSnapshot> = Object.fromEntries(
      ids.filter(id => Object.hasOwn(previous, id)).map(id => [id, previous[id]]),
    )
    snapshotsByThreadId.value = staged
    loading.value = ids.length > 0
    error.value = ''
    let failedBatches = 0
    const isCurrent = () => !disposed && generation === currentGeneration
    const markUnconfirmed = (id: string) => {
      if (Object.hasOwn(previous, id)) staged[id] = { ...previous[id], stale: true }
      else delete staged[id]
    }
    try {
      // Sequential batches keep both HTTP concurrency and per-request size bounded.
      for (let offset = 0; offset < ids.length; offset += 100) {
        const batch = ids.slice(offset, offset + 100)
        try {
          const snapshots = await getThreadTaskBoardSnapshots(batch, { signal: controller.signal })
          if (!isCurrent()) return
          for (const id of batch) {
            if (Object.hasOwn(snapshots, id)) staged[id] = snapshots[id]!
            else markUnconfirmed(id)
          }
        } catch {
          if (!isCurrent() || controller.signal.aborted) return
          failedBatches += 1
          for (const id of batch) markUnconfirmed(id)
        }
        if (!isCurrent()) return
        snapshotsByThreadId.value = { ...staged }
        error.value = failedBatches > 0 ? '部分任务状态读取失败，请刷新重试。' : ''
      }
    } finally {
      if (isCurrent()) {
        loading.value = false
        activeController = null
      }
    }
  }

  watch(fingerprint, () => { void refresh() }, { immediate: true })
  onScopeDispose(() => {
    disposed = true
    generation += 1
    activeController?.abort()
    activeController = null
  })
  return { snapshotsByThreadId, loading, error, missingCount, refresh }
}
