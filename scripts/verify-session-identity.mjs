import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const nodeModules = resolve(process.env.CX_CODEX_TEST_NODE_MODULES?.trim() || join(repoRoot, 'node_modules'))
const tscEntry = join(nodeModules, 'typescript', 'bin', 'tsc')
if (!existsSync(tscEntry)) throw new Error('TypeScript compiler is unavailable. Run npm install first.')
const outputBase = join(repoRoot, 'output', 'session-identity-smoke')
mkdirSync(outputBase, { recursive: true })
const outputRoot = mkdtempSync(join(outputBase, 'run-'))
try {
  const tsconfigPath = join(outputRoot, 'tsconfig.json')
  writeFileSync(tsconfigPath, JSON.stringify({
    compilerOptions: {
      target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
      strict: true, esModuleInterop: true, skipLibCheck: true, types: ['node'],
      typeRoots: [join(nodeModules, '@types')],
      rootDir: repoRoot, outDir: outputRoot,
    },
    include: [join(repoRoot, 'scripts', 'session-identity-smoke.ts')],
  }, null, 2))
  run([tscEntry, '-p', tsconfigPath])
  run(['--test', join(outputRoot, 'scripts', 'session-identity-smoke.js')])
} finally {
  rmSync(outputRoot, { recursive: true, force: true })
}

function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: repoRoot, stdio: 'inherit', shell: false })
  if (result.status !== 0) throw new Error(`Session identity verification failed (${String(result.status)})`, { cause: result.error })
}
