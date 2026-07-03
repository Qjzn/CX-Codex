import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const outputRoot = join(repoRoot, 'output', 'server-module-smoke')
const tsconfigPath = join(outputRoot, 'tsconfig.json')
const compiledEntry = join(outputRoot, 'scripts', 'server-module-smoke.js')
const tscEntry = join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc')

if (!existsSync(tscEntry)) {
  throw new Error(`TypeScript compiler not found at ${tscEntry}. Run npm install first.`)
}

rmSync(outputRoot, { recursive: true, force: true })
mkdirSync(outputRoot, { recursive: true })

writeFileSync(tsconfigPath, `${JSON.stringify({
  compilerOptions: {
    target: 'ES2022',
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    types: ['node'],
    rootDir: repoRoot,
    outDir: outputRoot,
  },
  include: [
    join(repoRoot, 'scripts', 'server-module-smoke.ts'),
    join(repoRoot, 'src', 'server', 'appServerRpcCache.ts'),
    join(repoRoot, 'src', 'server', 'appServerRpcDiagnostics.ts'),
    join(repoRoot, 'src', 'server', 'appServerRpcQueue.ts'),
    join(repoRoot, 'src', 'server', 'bridgeLog.ts'),
    join(repoRoot, 'src', 'server', 'pendingServerRequests.ts'),
    join(repoRoot, 'src', 'server', 'runtimeState.ts'),
  ],
}, null, 2)}\n`)

runChecked('Compile server module smoke', process.execPath, [tscEntry, '-p', tsconfigPath])
runChecked('Run server module smoke', process.execPath, [compiledEntry])

function runChecked(label, command, args) {
  console.log(`\n==> ${label}`)
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
  })
  if (result.status !== 0) {
    const reason = result.error ? `: ${result.error.message}` : ''
    throw new Error(`${label} failed with exit code ${String(result.status)}${reason}`)
  }
}
