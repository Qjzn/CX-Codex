import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const output = new URL('../output/conversation-timing-smoke/', import.meta.url)
mkdirSync(output, { recursive: true })
const outfile = fileURLToPath(new URL('entry.mjs', output))
await build({ entryPoints: [fileURLToPath(new URL('./conversation-timing-smoke.ts', import.meta.url))], outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external' })
const result = spawnSync(process.execPath, [outfile, ...process.argv.slice(2)], { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit' })
process.exitCode = result.status ?? 1
