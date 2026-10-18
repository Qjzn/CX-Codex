import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const outputRoot = new URL('../output/queue-lifecycle-smoke/', import.meta.url)
mkdirSync(outputRoot, { recursive: true })
const outfile = fileURLToPath(new URL('entry.mjs', outputRoot))
await build({
  entryPoints: [fileURLToPath(new URL('./queue-lifecycle-smoke.ts', import.meta.url))],
  outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external',
})
const result = spawnSync(process.execPath, [outfile], {
  cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit',
})
process.exitCode = result.status ?? 1
