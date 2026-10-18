import { build } from 'esbuild'
import { mkdir, mkdtemp, unlink, rmdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const outputBase = join(repoRoot, 'output', 'runtime-slimming-tests')
await mkdir(outputBase, { recursive: true })
const outputRoot = await mkdtemp(join(outputBase, 'run-'))
const names = ['app-server-thread-read-cache', 'app-server-rpc-cache-persistence']
const compiled = names.map(name => join(outputRoot, `${name}.test.mjs`))
try {
  await build({
    entryPoints: names.map(name => join(repoRoot, 'scripts', `${name}.test.ts`)),
    outdir: outputRoot, outExtension: { '.js': '.mjs' },
    bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22',
    logLevel: 'warning',
  })
  run(['--test', ...compiled, join(repoRoot, 'scripts', 'session-path-resolver.test.mjs')])
  // These tests locate production source relative to their own import.meta.url.
  run(['--experimental-strip-types', '--test', ...['task-pet-projection-budget', 'local-preview-loading']
    .map(name => join(repoRoot, 'scripts', `${name}.test.ts`))])
} finally {
  // Remove only the two generated files, then the unique empty directory.
  for (const path of compiled) await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error })
  await rmdir(outputRoot)
}

function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: repoRoot, stdio: 'inherit', shell: false })
  if (result.status !== 0) throw new Error(`Runtime slimming verification failed (${String(result.status)})`, { cause: result.error })
}
