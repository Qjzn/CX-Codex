import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const outputBase = join(repoRoot, 'output', 'conversation-transcript-smoke')
const tscEntry = join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc')

if (!existsSync(tscEntry)) {
  throw new Error(`TypeScript compiler not found at ${tscEntry}. Run npm install first.`)
}

const moduleSources = [
  join(repoRoot, 'src', 'conversation-transcript', 'index.ts'),
  join(repoRoot, 'src', 'conversation-transcript', 'types.ts'),
  join(repoRoot, 'src', 'conversation-transcript', 'projectConversation.ts'),
  join(repoRoot, 'src', 'conversation-transcript', 'userMessagePresentation.ts'),
].map((path) => readFileSync(path, 'utf8')).join('\n')

for (const forbidden of [
  'UiMessage',
  'Worked for',
  'readWorkedSummaryDurationMs',
  'guidedSummary',
  'document.',
  'window.',
  'localStorage',
  "from 'vue'",
  'from "vue"',
]) {
  if (moduleSources.includes(forbidden)) {
    throw new Error(`Conversation transcript module contains forbidden legacy marker: ${forbidden}`)
  }
}

const conversationComponentSource = readFileSync(
  join(repoRoot, 'src', 'components', 'content', 'ThreadConversation.vue'),
  'utf8',
)
const desktopStateSource = readFileSync(join(repoRoot, 'src', 'composables', 'useDesktopState.ts'), 'utf8')
if (desktopStateSource.includes("if (method === 'turn/started' || method === 'thread/started')")) {
  throw new Error('Thread creation must not imply execution in frontend runtime state')
}
const appSource = readFileSync(join(repoRoot, 'src', 'App.vue'), 'utf8')
const gatewaySource = readFileSync(join(repoRoot, 'src', 'api', 'codexGateway.ts'), 'utf8')
const exportSource = readFileSync(join(repoRoot, 'src', 'utils', 'threadExport.ts'), 'utf8')
const codexTypesSource = readFileSync(join(repoRoot, 'src', 'types', 'codex.ts'), 'utf8')
const interactionContract = moduleSources.match(/export type ConversationInteractionBlock = \{[\s\S]*?\n\}/u)?.[0] ?? ''

assertSourceIncludes(conversationComponentSource, 'projection: ConversationProjection', 'conversation component projection prop')
assertSourceIncludes(conversationComponentSource, 'turn.final', 'explicit projected final rendering')
assertSourceIncludes(conversationComponentSource, 'turn.fileChanges', 'projected file summary rendering')
assertSourceIncludes(conversationComponentSource, 'turn.activityGroups', 'projected activity-group rendering')
assertSourceIncludes(conversationComponentSource, 'visibleProcessEntries(turn)', 'turn-ordered process rendering')
assertSourceIncludes(conversationComponentSource, 'ConversationFavoriteIntent', 'projection-native favorite intent')
assertSourceIncludes(conversationComponentSource, 'ConversationPlanImplementationIntent', 'projection-native plan intent')
assertSourceIncludes(conversationComponentSource, 'pendingInteractionsForTurn(turn)', 'projected pending interaction rendering')
assertSourceIncludes(conversationComponentSource, 'interaction.interactionType', 'projected interaction action routing')
assertSourceIncludes(conversationComponentSource, 'v-for="turn in virtualizedTurns"', 'bounded projected-turn rendering')
assertSourceIncludes(conversationComponentSource, 'MAX_MOUNTED_TURNS = 10', 'long-conversation DOM budget')
assertSourceIncludes(conversationComponentSource, 'overflow-anchor: none', 'single scroll-anchor owner')
assertSourceIncludes(moduleSources, 'interactionType:', 'projected interaction semantics')
assertSourceIncludes(desktopStateSource, 'selectedConversationProjection', 'desktop projection state')
assertSourceIncludes(desktopStateSource, 'watch(selectedConversationProjection', 'structured first-screen readiness watcher')
assertSourceIncludes(desktopStateSource, 'markThreadFirstScreenReady({', 'structured first-screen ready signal')
assertSourceIncludes(desktopStateSource, "snapshot.messageState === 'cached' ? 'local-cache' : 'network'", 'authoritative first-screen source mapping')
assertSourceIncludes(appSource, ':projection="displayedThreadConversationProjection"', 'App projection wiring')
assertSourceIncludes(appSource, 'projection: exportProjection', 'projected conversation export wiring')
assertSourceIncludes(gatewaySource, 'threadRead: unknown | null', 'raw thread/read gateway field')
assertSourceIncludes(exportSource, 'projection: ConversationProjection', 'conversation export projection input')
if (exportSource.includes('UiMessage')) throw new Error('conversation export must not consume the legacy flat message model')
if (/export\s+type\s+ChatMessage|export\s+type\s+ChatThread|messages:\s*ChatMessage\[\]/u.test(codexTypesSource)) {
  throw new Error('generic ChatMessage/ChatThread containers must not recreate a flat conversation contract')
}
if (/\bmethod:\s*string/u.test(interactionContract)) {
  throw new Error('renderer-facing interactions must not expose the raw request method')
}

for (const [label, source, forbidden] of [
  ['conversation component', conversationComponentSource, ['<Teleport', 'v-for="turn in props.projection.turns"', 'props.messages', 'props.pendingRequests', 'UiMessage', 'UiServerRequest', 'request.method', 'liveOverlay:', 'guidedSummary', 'Worked for', 'commandElapsed', 'toUiMessage', 'toPlanMessage']],
  ['desktop state', desktopStateSource, ['insertTurnSummaryMessage', 'Worked for', 'liveOverlay']],
  ['App', appSource, ['pendingNewThreadPreview.liveOverlay', 'selectedLiveOverlay', ':pending-requests=', 'displayedThreadPendingRequests']],
]) {
  for (const marker of forbidden) {
    if (source.includes(marker)) throw new Error(`${label} contains forbidden legacy marker: ${marker}`)
  }
}

if (existsSync(join(repoRoot, 'src', 'components', 'content', 'RuntimeStatusBar.vue'))) {
  throw new Error('legacy runtime-status conversation surface still exists')
}

mkdirSync(outputBase, { recursive: true })
const outputRoot = mkdtempSync(join(outputBase, 'run-'))
const tsconfigPath = join(outputRoot, 'tsconfig.json')
const compiledEntry = join(outputRoot, 'scripts', 'conversation-transcript-smoke.js')

try {
  writeFileSync(tsconfigPath, `${JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      types: ['node'],
      rootDir: repoRoot,
      outDir: outputRoot,
    },
    include: [join(repoRoot, 'scripts', 'conversation-transcript-smoke.ts')],
  }, null, 2)}\n`)

  runChecked('Compile conversation transcript smoke', process.execPath, [tscEntry, '-p', tsconfigPath])
  runChecked('Run conversation transcript smoke', process.execPath, [compiledEntry])
} finally {
  if (process.env.CX_CODEX_KEEP_CONVERSATION_TRANSCRIPT_OUTPUT !== '1') {
    rmSync(outputRoot, { recursive: true, force: true })
  }
}

function runChecked(label, command, args) {
  console.log(`\n==> ${label}`)
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
  })
  if (result.status !== 0) {
    const reason = result.error ? `: ${result.error.message}` : ''
    throw new Error(`${label} failed with exit code ${String(result.status)}${reason}`)
  }
}

function assertSourceIncludes(source, marker, label) {
  if (!source.includes(marker)) throw new Error(`Missing ${label}: ${marker}`)
}
