import { build } from 'esbuild'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputBase = join(repoRoot, 'output', 'conversation-rich-text-tests')
await mkdir(outputBase, { recursive: true })
const outputRoot = await mkdtemp(join(outputBase, 'run-'))

try {
  const testNames = ['conversation-rich-text', 'conversation-code-highlight-client', 'conversation-math', 'conversation-math-boundaries', 'conversation-math-resources', 'conversation-math-cache']
  await build({
    entryPoints: testNames.map((name) => join(repoRoot, 'scripts', `${name}.test.ts`)),
    outdir: outputRoot,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'warning',
  })
  const result = spawnSync(process.execPath, ['--test', ...testNames.map((name) => join(outputRoot, `${name}.test.mjs`))], { cwd: repoRoot, stdio: 'inherit', shell: false })
  if (result.status !== 0) throw new Error(`Conversation rich text tests failed: ${String(result.status)}`)
} finally {
  await rm(outputRoot, { recursive: true, force: true })
}
