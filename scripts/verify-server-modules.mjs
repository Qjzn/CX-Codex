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

// Synthetic child home (test-home isolation).
//
// The smoke suite calls createAuthSession(...).rotatePassword(...), and
// src/server/authMiddleware.ts persists rotated tokens to
// homedir()/.cx-codex/web-auth-tokens.json. CODEX_HOME alone does not isolate
// that path, so the smoke child must also see a synthetic user home. Both
// directories live inside this run's unique outputRoot; neither the launcher's
// process.env nor the real OS profile is touched.
const testUserHome = join(outputRoot, 'test-user-home')
const testCodexHome = join(testUserHome, '.codex')
mkdirSync(testUserHome, { recursive: true })
mkdirSync(testCodexHome, { recursive: true })

const smokeChildEnv = { ...process.env, CODEX_HOME: testCodexHome }
if (process.platform === 'win32') {
  smokeChildEnv.USERPROFILE = testUserHome
} else {
  smokeChildEnv.HOME = testUserHome
}

const homeProbeSource = 'const os = require("node:os"); process.stdout.write(JSON.stringify({ homedir: os.homedir(), codexHome: process.env.CODEX_HOME ?? "" }))'
const homeProbe = spawnSync(process.execPath, ['-e', homeProbeSource], {
  cwd: repoRoot,
  env: smokeChildEnv,
  encoding: 'utf8',
  shell: false,
})
if (homeProbe.status !== 0) {
  throw new Error(`Child home isolation probe failed with exit code ${String(homeProbe.status)}: ${homeProbe.stderr ?? ''}`)
}
let probedHome
try {
  probedHome = JSON.parse(homeProbe.stdout ?? '')
} catch {
  throw new Error(`Child home isolation probe returned unparsable output: ${JSON.stringify(homeProbe.stdout ?? '')}`)
}
if (resolve(String(probedHome?.homedir ?? '')) !== resolve(testUserHome) || String(probedHome?.codexHome ?? '') !== testCodexHome) {
  throw new Error(
    `Child home isolation check failed: child homedir()=${String(probedHome?.homedir)} CODEX_HOME=${String(probedHome?.codexHome)} `
    + `expected ${testUserHome} / ${testCodexHome}`,
  )
}
console.log(`==> Child home isolation verified for smoke run (homedir=${String(probedHome.homedir)}, CODEX_HOME=${String(probedHome.codexHome)})`)

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

  runChecked('Compile server module smoke', process.execPath, [tscEntry, '-p', tsconfigPath])
  runChecked('Run server module smoke', process.execPath, [compiledEntry], smokeChildEnv)
} finally {
  if (process.env.CX_CODEX_KEEP_SERVER_MODULE_SMOKE_OUTPUT !== '1') {
    rmSync(outputRoot, { recursive: true, force: true })
  }
}

function runChecked(label, command, args, env) {
  console.log(`\n==> ${label}`)
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
    shell: false,
  })
  if (result.status !== 0) {
    const reason = result.error ? `: ${result.error.message}` : ''
    throw new Error(`${label} failed with exit code ${String(result.status)}${reason}`)
  }
}
