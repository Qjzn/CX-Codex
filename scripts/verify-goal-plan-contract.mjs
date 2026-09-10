import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const outputRoot = new URL('../output/goal-plan-contract-smoke/', import.meta.url)
mkdirSync(outputRoot, { recursive: true })
const outfile = fileURLToPath(new URL('entry.mjs', outputRoot))
await build({
  entryPoints: [fileURLToPath(new URL('./goal-plan-contract-smoke.ts', import.meta.url))],
  outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external',
})
const result = spawnSync(process.execPath, [outfile], { cwd: repoRoot, stdio: 'inherit' })
process.exitCode = result.status ?? 1
