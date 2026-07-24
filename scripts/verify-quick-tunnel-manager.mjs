import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { build } from 'esbuild'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const tempDir = await mkdtemp(join(repoRoot, '.tmp-quick-tunnel-'))
const outputFile = join(tempDir, 'quick-tunnel-smoke.mjs')

try {
  await build({
    entryPoints: [fileURLToPath(new URL('./quick-tunnel-smoke.ts', import.meta.url))],
    outfile: outputFile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    external: ['ws'],
    logLevel: 'silent',
  })
  await import(pathToFileURL(outputFile).href)
} finally {
  await rm(tempDir, { recursive: true, force: true })
}
