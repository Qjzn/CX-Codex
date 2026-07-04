import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const outputBase = join(repoRoot, 'output', 'frontend-normalizer-smoke')
mkdirSync(outputBase, { recursive: true })

const outputRoot = mkdtempSync(join(outputBase, 'run-'))
const entryPath = join(outputRoot, 'entry.ts')
const bundledPath = join(outputRoot, 'entry.mjs')
const normalizerImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'api', 'normalizers', 'v2.ts')))

try {
  writeFileSync(entryPath, `
import assert from 'node:assert/strict'
import { normalizeThreadGroupsV2, normalizeThreadMessagesV2 } from '${normalizerImport}'

const messages = normalizeThreadMessagesV2({
  thread: {
    id: 'thread-a',
    cwd: 'E:\\\\repo',
    preview: '',
    updatedAt: 1,
    createdAt: 1,
    turns: [
      {
        id: 'turn-a',
        status: 'completed',
        items: [
          { id: 'item-known', type: 'agentMessage', text: 'Known message' },
          {
            id: 'item-new',
            type: 'threadShellCommandOutput',
            command: 'secret command',
            output: 'secret output',
          },
          null,
        ],
      },
    ],
  },
})

assert.equal(messages.length, 3)
assert.equal(messages[0]?.messageType, 'agentMessage')
assert.equal(messages[1]?.role, 'system')
assert.equal(messages[1]?.messageType, 'unhandled.threadShellCommandOutput')
assert.equal(messages[1]?.text, 'Unhandled App Server item: threadShellCommandOutput')
assert.equal(messages[1]?.isUnhandled, true)
assert.equal(messages[1]?.turnIndex, 0)
assert.equal(messages[1]?.rawPayload?.includes('secret command'), true)
assert.equal(messages[2]?.messageType, 'unhandled.invalidItem')
assert.equal(messages[2]?.isUnhandled, true)

const unloadedTurnMessages = normalizeThreadMessagesV2({
  thread: {
    id: 'thread-items-view',
    cwd: 'E:\\\\repo',
    preview: '',
    updatedAt: 1,
    createdAt: 1,
    turns: [
      {
        id: 'turn-summary',
        status: 'completed',
        itemsView: 'summary',
        items: [],
      },
    ],
  },
})

assert.equal(unloadedTurnMessages.length, 1)
assert.equal(unloadedTurnMessages[0]?.id, 'turn-summary')
assert.equal(unloadedTurnMessages[0]?.role, 'system')
assert.equal(unloadedTurnMessages[0]?.messageType, 'unhandled.turnItemsView.summary')
assert.equal(unloadedTurnMessages[0]?.text, 'App Server turn items not loaded: summary')
assert.equal(unloadedTurnMessages[0]?.isUnhandled, true)
assert.equal(unloadedTurnMessages[0]?.turnIndex, 0)
assert.equal(unloadedTurnMessages[0]?.rawPayload?.includes('"itemsView": "summary"'), true)

const groups = normalizeThreadGroupsV2({
  data: [
    {
      id: 'thread-cli',
      cwd: 'E:\\\\repo',
      preview: 'CLI thread',
      modelProvider: 'openai',
      cliVersion: '0.0.0',
      createdAt: 1,
      updatedAt: 3,
      path: null,
      source: 'cli',
      gitInfo: null,
      turns: [],
    },
    {
      id: 'thread-sub-agent',
      cwd: 'E:\\\\repo',
      preview: 'Sub-agent thread',
      modelProvider: 'openai',
      cliVersion: '0.0.0',
      createdAt: 1,
      updatedAt: 2,
      path: null,
      source: { subAgent: { thread_spawn: { parent_thread_id: 'parent-thread', depth: 1 } } },
      gitInfo: null,
      turns: [],
    },
    {
      id: 'thread-future-source',
      cwd: 'E:\\\\repo',
      preview: 'Future source thread',
      modelProvider: 'openai',
      cliVersion: '0.0.0',
      createdAt: 1,
      updatedAt: 1,
      path: null,
      source: { futureSource: { enabled: true } },
      gitInfo: null,
      turns: [],
    },
  ],
  nextCursor: null,
})

assert.equal(groups.length, 1)
assert.deepEqual(groups[0]?.threads.map((thread) => thread.id), ['thread-cli', 'thread-sub-agent', 'thread-future-source'])
assert.equal(groups[0]?.threads[0]?.sourceKind, 'cli')
assert.equal(groups[0]?.threads[1]?.sourceKind, 'subAgent.thread_spawn')
assert.equal(groups[0]?.threads[2]?.sourceKind, 'futureSource')

console.log('frontend normalizer smoke ok')
`, 'utf8')

  await esbuild.build({
    bundle: true,
    entryPoints: [entryPath],
    format: 'esm',
    logLevel: 'silent',
    outfile: bundledPath,
    platform: 'node',
    target: 'node18',
  })

  const result = spawnSync(process.execPath, [bundledPath], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
  })

  if (result.status !== 0) {
    const reason = result.error ? `: ${result.error.message}` : ''
    throw new Error(`Run frontend normalizer smoke failed with exit code ${String(result.status)}${reason}`)
  }
} finally {
  if (process.env.CX_CODEX_KEEP_FRONTEND_NORMALIZER_SMOKE_OUTPUT !== '1') {
    rmSync(outputRoot, { recursive: true, force: true })
  }
}

function toImportPath(value) {
  const normalized = value.replace(/\\/g, '/')
  if (normalized.startsWith('.')) return normalized
  return `./${normalized}`
}
