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
    join(repoRoot, 'src', 'server', 'appServerClientInfo.ts'),
    join(repoRoot, 'src', 'server', 'appServerInitialization.ts'),
    join(repoRoot, 'src', 'server', 'appServerLaunch.ts'),
    join(repoRoot, 'src', 'server', 'appServerLineBuffer.ts'),
    join(repoRoot, 'src', 'server', 'appServerMethodCatalog.ts'),
    join(repoRoot, 'src', 'server', 'appServerNotificationDiagnostics.ts'),
    join(repoRoot, 'src', 'server', 'appServerSchemaAuditSummary.ts'),
    join(repoRoot, 'src', 'server', 'appServerStatusDiagnostics.ts'),
    join(repoRoot, 'src', 'server', 'appServerRpcCache.ts'),
    join(repoRoot, 'src', 'server', 'appServerRpcDiagnostics.ts'),
    join(repoRoot, 'src', 'server', 'appServerRpcErrors.ts'),
    join(repoRoot, 'src', 'server', 'appServerJsonRpcWire.ts'),
    join(repoRoot, 'src', 'server', 'appServerRpcQueue.ts'),
    join(repoRoot, 'src', 'server', 'appServerStderrLogger.ts'),
    join(repoRoot, 'src', 'server', 'bridgeLog.ts'),
    join(repoRoot, 'src', 'server', 'codexAuth.ts'),
    join(repoRoot, 'src', 'server', 'codexPaths.ts'),
    join(repoRoot, 'src', 'server', 'composerFileSearchRoutes.ts'),
    join(repoRoot, 'src', 'server', 'composerFileSearch.ts'),
    join(repoRoot, 'src', 'server', 'commandRunner.ts'),
    join(repoRoot, 'src', 'server', 'diagnosticsRoutes.ts'),
    join(repoRoot, 'src', 'server', 'fileUpload.ts'),
    join(repoRoot, 'src', 'server', 'githubTrending.ts'),
    join(repoRoot, 'src', 'server', 'httpBody.ts'),
    join(repoRoot, 'src', 'server', 'localStateRoutes.ts'),
    join(repoRoot, 'src', 'server', 'notificationReplayRoute.ts'),
    join(repoRoot, 'src', 'server', 'notificationSseRoute.ts'),
    join(repoRoot, 'src', 'server', 'pendingServerRequests.ts'),
    join(repoRoot, 'src', 'server', 'pinnedThreads.ts'),
    join(repoRoot, 'src', 'server', 'planModeTurnStore.ts'),
    join(repoRoot, 'src', 'server', 'projectRootRoutes.ts'),
    join(repoRoot, 'src', 'server', 'projectRoots.ts'),
    join(repoRoot, 'src', 'server', 'runtimeStateRoutes.ts'),
    join(repoRoot, 'src', 'server', 'runtimeState.ts'),
    join(repoRoot, 'src', 'server', 'serverRequestDiagnostics.ts'),
    join(repoRoot, 'src', 'server', 'serverRequestPolicy.ts'),
    join(repoRoot, 'src', 'server', 'threadSearchIndex.ts'),
    join(repoRoot, 'src', 'server', 'threadTitleCache.ts'),
    join(repoRoot, 'src', 'server', 'threadTokenUsage.ts'),
    join(repoRoot, 'src', 'server', 'transcriptionProxy.ts'),
    join(repoRoot, 'src', 'server', 'transcriptionRoute.ts'),
    join(repoRoot, 'src', 'server', 'webBridgeSettings.ts'),
    join(repoRoot, 'src', 'server', 'workspaceMetaRoutes.ts'),
    join(repoRoot, 'src', 'server', 'workspaceRootsState.ts'),
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
