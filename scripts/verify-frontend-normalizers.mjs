import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const outputRoot = join(repoRoot, 'output', 'frontend-normalizer-smoke')
const entryPath = join(outputRoot, 'entry.ts')
const bundledPath = join(outputRoot, 'entry.mjs')
const normalizerImport = toImportPath(relative(outputRoot, join(repoRoot, 'src', 'api', 'normalizers', 'v2.ts')))

rmSync(outputRoot, { recursive: true, force: true })
mkdirSync(outputRoot, { recursive: true })

writeFileSync(entryPath, `
import assert from 'node:assert/strict'
import { normalizeThreadMessagesV2 } from '${normalizerImport}'

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

function toImportPath(value) {
  const normalized = value.replace(/\\/g, '/')
  if (normalized.startsWith('.')) return normalized
  return `./${normalized}`
}
