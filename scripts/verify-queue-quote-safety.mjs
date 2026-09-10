import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('./queue-quote-safety-smoke.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22', packages: 'external',
})
const result = spawnSync(process.execPath, ['--input-type=module'], {
  cwd: repoRoot, input: bundle.outputFiles[0].text, stdio: ['pipe', 'inherit', 'inherit'],
})
process.exitCode = result.status ?? 1
