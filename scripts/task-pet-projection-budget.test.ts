import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { computed, ref, shallowRef, watch } from 'vue'

const desktopSource = readFileSync(new URL('../src/composables/useDesktopState.ts', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const desktopAst = ts.createSourceFile('desktop.ts', desktopSource, ts.ScriptTarget.Latest, true)
const appScript = appSource.slice(appSource.indexOf('<script setup lang="ts">') + '<script setup lang="ts">'.length, appSource.indexOf('</script>'))
const appAst = ts.createSourceFile('app.ts', appScript, ts.ScriptTarget.Latest, true)

function findNode(root: ts.Node, predicate: (node: ts.Node) => boolean): ts.Node | undefined {
  if (predicate(root)) return root
  return ts.forEachChild(root, (node) => findNode(node, predicate))
}

function evaluate(node: ts.Node, source: ts.SourceFile, context: Record<string, unknown>): unknown {
  const compiled = ts.transpileModule(`(${node.getText(source)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  })
  return runInNewContext(compiled.outputText, context)
}

const declaration = findNode(desktopAst, (node) => ts.isVariableDeclaration(node) && node.name.getText(desktopAst) === 'activeTaskPetItems') as ts.VariableDeclaration
assert.ok(declaration?.initializer, 'production task-pet computed must exist')
const nativeWatch = findNode(appAst, (node) => ts.isCallExpression(node)
  && ts.isIdentifier(node.expression) && node.expression.text === 'watch'
  && Boolean(node.arguments[1] && findNode(node.arguments[1], (child) => ts.isIdentifier(child) && child.text === 'syncMobileShellTaskPet'))) as ts.CallExpression
assert.ok(nativeWatch?.arguments[0], 'production native task-pet watch must exist')

type Thread = { id: string; updatedAtIso: string; title: string; preview: string; projectName: string }
const makeThread = (index: number): Thread => ({
  id: `thread-${index}`, updatedAtIso: `2026-10-${String(10 + Math.floor(index / 2)).padStart(2, '0')}T00:00:00.000Z`,
  title: `Title ${index}`, preview: '', projectName: 'Project',
})
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

function createProductionComputed(threads: Thread[], selected: Thread | null = null) {
  const projections: string[] = []
  const sourceThreads = shallowRef(threads)
  const selectedThread = shallowRef(selected)
  const pendingServerRequestsByThreadId = shallowRef<Record<string, unknown[]>>({
    'thread-19': [{ method: 'permission' }],
  })
  const runtimeStatusSummaryByThreadId = shallowRef(Object.fromEntries([...threads, ...(selected ? [selected] : [])].map((thread) => [thread.id, {
    activeTurnId: `turn-${thread.id}`, executionState: 'running', lastEventSeq: 17,
    latestReplyEventSeq: 16, stale: thread.id === 'thread-18',
  }])))
  const projectionFor = (id: string) => ({ turns: [{
    id: `turn-${id}`, startedAtMs: 1234,
    activities: [{ id: `activity-${id}`, label: 'Working', target: 'file.ts', startedAtMs: 1234 }],
    commentary: [], final: { text: `Reply ${id}` },
  }] })
  const values = evaluate(declaration.initializer!, desktopAst, {
    computed, sourceThreads, selectedThread, pendingServerRequestsByThreadId, runtimeStatusSummaryByThreadId,
    isThreadExecutionActive: (id: string) => id !== 'inactive',
    projectTaskPetConversation: (id: string) => { projections.push(id); return projectionFor(id) },
    latestTaskPetClientMessageId: (id: string) => `client-${id}`,
    pendingServerRequestStatusLabel: () => 'Waiting permission', localizeActivityText: (text: string) => text,
    compactLatestReplyTail: (text: string) => text, readRuntimeActivityStartedAtMs: () => 1234,
  }) as { value: unknown[] }
  return { values, projections, sourceThreads, pendingServerRequestsByThreadId, runtimeStatusSummaryByThreadId }
}

// Freeze the previous output contract independently of production's selection order.
function previousOutput(threads: Thread[], selected: Thread | null = null): unknown[] {
  const candidates = [...threads]
  if (selected && !candidates.some(({ id }) => id === selected.id)) candidates.unshift(selected)
  return candidates.filter(({ id }) => id !== 'inactive').map((thread) => ({
    threadId: thread.id, clientMessageId: `client-${thread.id}`, activityId: `activity-${thread.id}`,
    activeTurnId: `turn-${thread.id}`, startedAtMs: 1234, lastEventSeq: 17,
    executionState: thread.id === 'thread-18' ? 'stale' : 'running',
    title: thread.title.trim() || thread.preview.trim() || '未命名会话', projectName: thread.projectName.trim(),
    detail: thread.id === 'thread-19' ? 'Waiting permission' : 'Working', latestActivity: 'file.ts',
    latestReply: `Reply ${thread.id}`, latestReplyEventSeq: 16,
    state: thread.id === 'thread-19' ? 'waiting' : 'running', updatedAtIso: thread.updatedAtIso,
  })).sort((first, second) => second.updatedAtIso.localeCompare(first.updatedAtIso)).slice(0, 8)
}

test('20 active threads preserve output and stable ties with at most 8 projections', () => {
  const threads = Array.from({ length: 20 }, (_, index) => makeThread(index))
  const subject = createProductionComputed(threads)
  assert.deepEqual(plain(subject.values.value), previousOutput(threads))
  assert.equal(subject.projections.length, 8)
  assert.deepEqual(subject.projections, ['thread-18', 'thread-19', 'thread-16', 'thread-17', 'thread-14', 'thread-15', 'thread-12', 'thread-13'])
  void subject.values.value
  assert.equal(subject.projections.length, 8, 'computed retains its existing reactive cache')
  assert.deepEqual(subject.sourceThreads.value, threads, 'sorting must not mutate source order')
})

test('selected insertion, inactivity, and reactive state retain existing output', () => {
  const threads = Array.from({ length: 20 }, (_, index) => makeThread(index))
  threads.unshift({ ...makeThread(99), id: 'inactive' })
  const selected = { ...makeThread(18), id: 'selected' }
  const subject = createProductionComputed(threads, selected)
  assert.deepEqual(plain(subject.values.value), previousOutput(threads, selected))
  assert.equal(subject.projections.length, 8)
  assert.equal((subject.values.value[0] as { threadId: string }).threadId, 'selected', 'selected insertion wins equal timestamp ties')
  subject.runtimeStatusSummaryByThreadId.value = {
    ...subject.runtimeStatusSummaryByThreadId.value,
    selected: { ...subject.runtimeStatusSummaryByThreadId.value.selected!, executionState: 'waiting_permission', lastEventSeq: 18 },
  }
  assert.equal((subject.values.value[0] as { executionState: string }).executionState, 'waiting_permission')
  assert.equal(subject.projections.length, 16)
})

test('Web native watch is lazy; Android subscribes and disabling preserves preview consumers', () => {
  const isMobileShellAvailable = ref(false)
  const tasks = ref(1)
  const recent = ref(1)
  let taskReads = 0
  let recentReads = 0
  let callbacks = 0
  const mobileShellTaskPetItems = computed(() => { taskReads += 1; return [tasks.value] })
  const recentTaskPetThreads = computed(() => { recentReads += 1; return [recent.value] })
  const source = evaluate(nativeWatch.arguments[0]!, appAst, { isMobileShellAvailable, mobileShellTaskPetItems, recentTaskPetThreads })
  const stop = watch(source as never, () => { callbacks += 1 }, { flush: 'sync' })
  try {
    assert.equal(taskReads, 0)
    assert.equal(recentReads, 0)
    tasks.value += 1
    recent.value += 1
    assert.equal(callbacks, 0)
    isMobileShellAvailable.value = true
    assert.equal(taskReads, 1)
    assert.equal(recentReads, 1)
    const before = callbacks
    tasks.value += 1
    recent.value += 1
    assert.equal(callbacks, before + 2, 'Android still reacts to both payload sources')
    isMobileShellAvailable.value = false
    const stopped = callbacks
    const readCount = taskReads
    tasks.value += 1
    assert.equal(callbacks, stopped)
    assert.equal(taskReads, readCount)
    assert.deepEqual(mobileShellTaskPetItems.value, [tasks.value], 'independent consumers can still request a fresh Web preview')
  } finally { stop() }
})
