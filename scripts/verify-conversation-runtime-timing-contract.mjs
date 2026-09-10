import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const outputRoot = new URL('../output/conversation-runtime-timing-contract-smoke/', import.meta.url)
mkdirSync(outputRoot, { recursive: true })
const outfile = fileURLToPath(new URL('entry.mjs', outputRoot))
await build({
  entryPoints: [fileURLToPath(new URL('./conversation-runtime-timing-contract-smoke.ts', import.meta.url))],
  outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external',
})
const cases = ['new-turn-before-snapshot', 'same-turn-keeps-start', 'accepted-without-start', 'completed-duration-preserved',
  'native-start-before-envelope', 'same-sequence-fills-start', 'late-old-snapshot', 'same-turn-recovers-from-sync-degraded']
const selected = process.argv[2] ? [process.argv[2]] : cases
if (selected.some((name) => !cases.includes(name))) throw new Error(`Unknown runtime timing case: ${process.argv[2]}`)
let passed = 0
for (const name of selected) {
  const result = spawnSync(process.execPath, [outfile, name], { cwd: repoRoot, stdio: 'inherit' })
  if (result.status === 0) passed += 1
}
console.log(`${passed}/${selected.length} conversation-runtime-timing-contract checks passed.`)
process.exitCode = passed === selected.length ? 0 : 1
