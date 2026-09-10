import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = resolve(root, 'output', 'rpc-foreground-smoke', 'test.mjs')
mkdirSync(resolve(output, '..'), { recursive: true })
await build({
  entryPoints: [resolve(root, 'scripts/rpc-foreground-smoke.ts')],
  outfile: output, bundle: true, platform: 'node', format: 'esm', target: 'node22',
})
const result = spawnSync(process.execPath, ['--test', output], { cwd: root, stdio: 'inherit' })
process.exitCode = result.status ?? 1
