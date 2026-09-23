import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const outputBase = join(repoRoot, 'output', 'server-module-smoke')
const tscEntry = join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc')

if (!existsSync(tscEntry)) {
  throw new Error(`TypeScript compiler not found at ${tscEntry}. Run npm install first.`)
}

mkdirSync(outputBase, { recursive: true })

const outputRoot = mkdtempSync(join(outputBase, 'run-'))
const tsconfigPath = join(outputRoot, 'tsconfig.json')
const compiledEntry = join(outputRoot, 'scripts', 'server-module-smoke.js')
const nodeLoader = process.env.CX_CODEX_NODE_LOADER?.trim() ?? ''
const nodeLibraryPath = process.env.CX_CODEX_NODE_LIBRARY_PATH?.trim() ?? ''

try {
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
    ],
  }, null, 2)}\n`)

  runNodeChecked('Compile server module smoke', [tscEntry, '-p', tsconfigPath])
  runNodeChecked('Run server module smoke', [compiledEntry])
} finally {
  if (process.env.CX_CODEX_KEEP_SERVER_MODULE_SMOKE_OUTPUT !== '1') {
    rmSync(outputRoot, { recursive: true, force: true })
  }
}

function runChecked(label, command, args, environment = process.env) {
  console.log(`\n==> ${label}`)
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: environment,
    stdio: 'inherit',
    shell: false,
  })
  if (result.status !== 0) {
    const reason = result.error ? `: ${result.error.message}` : ''
    throw new Error(`${label} failed with exit code ${String(result.status)}${reason}`)
  }
}

function runNodeChecked(label, args) {
  const nodeExecutable = process.env.CX_CODEX_NODE_EXECUTABLE?.trim() || process.execPath
  const environment = {
    ...process.env,
    // When Node is launched through a custom ELF loader, process.execPath in
    // the child can resolve to that loader. Keep command-runner smoke probes
    // pointed at the real Node executable instead.
    CX_CODEX_NODE_EXECUTABLE: nodeExecutable,
  }
  if (!nodeLoader) {
    runChecked(label, nodeExecutable, args, environment)
    return
  }
  if (!nodeLibraryPath) {
    throw new Error('CX_CODEX_NODE_LIBRARY_PATH is required when CX_CODEX_NODE_LOADER is set')
  }
  runChecked(label, nodeLoader, ['--library-path', nodeLibraryPath, nodeExecutable, ...args], environment)
}
