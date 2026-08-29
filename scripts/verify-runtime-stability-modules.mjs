import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const outputBase = join(repoRoot, 'output', 'runtime-stability-smoke')
const tscEntry = join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc')

if (!existsSync(tscEntry)) {
  throw new Error(`TypeScript compiler not found at ${tscEntry}. Run npm install first.`)
}

mkdirSync(outputBase, { recursive: true })
const outputRoot = mkdtempSync(join(outputBase, 'run-'))
const tsconfigPath = join(outputRoot, 'tsconfig.json')
const compiledEntry = join(outputRoot, 'scripts', 'runtime-stability-smoke.js')

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
    include: [join(repoRoot, 'scripts', 'runtime-stability-smoke.ts')],
  }, null, 2)}\n`)

  runChecked('Compile runtime stability smoke', process.execPath, [tscEntry, '-p', tsconfigPath])
  runChecked('Run runtime stability smoke', process.execPath, [compiledEntry])
} finally {
  if (process.env.CX_CODEX_KEEP_RUNTIME_STABILITY_OUTPUT !== '1') {
    rmSync(outputRoot, { recursive: true, force: true })
  }
}

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
