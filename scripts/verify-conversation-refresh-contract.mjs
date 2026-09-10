import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const outputRoot = new URL('../output/conversation-refresh-contract-smoke/', import.meta.url)
mkdirSync(outputRoot, { recursive: true })
const outfile = fileURLToPath(new URL('entry.mjs', outputRoot))
await build({
  entryPoints: [fileURLToPath(new URL('./conversation-refresh-contract-smoke.ts', import.meta.url))],
  outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external',
})
const cases = [
  'inflight-selection', 'settled-six-seconds', 'same-millisecond', 'coalesced-refreshes',
  'runtime-source-preserved', 'state-unavailable', 'cached-source',
  'automatic-connected-refresh', 'old-request-rejected', 'old-request-aborted',
  'shared-followup-rejected', 'new-invalidation-after-followup-start', 'cached-to-fresh-after-runtime',
  'same-sequence-completion-time', 'cancelled-followup-valid-refresh',
  'notification-during-automatic-read',
]
const selected = process.argv[2] ? [process.argv[2]] : cases
if (selected.some((name) => !cases.includes(name))) throw new Error(`Unknown refresh contract case: ${process.argv[2]}`)
let passed = 0
for (const name of selected) {
  // Each public-state instance and gateway cache starts in its own process.
  const result = spawnSync(process.execPath, [outfile, name], { cwd: repoRoot, stdio: 'inherit' })
  if (result.status === 0) passed += 1
}
console.log(`${passed}/${selected.length} conversation-refresh-contract checks passed.`)
process.exitCode = passed === selected.length ? 0 : 1
