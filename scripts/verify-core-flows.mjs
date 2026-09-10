// Deterministic core contracts only: no existing service, model calls or user database.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const cwd = fileURLToPath(new URL('../', import.meta.url))
const checks = [
  ['scripts/verify-native-collaboration.mjs'],
  ['--experimental-strip-types', '--test', 'scripts/plan-implementation.test.mjs'],
  ['scripts/verify-goal-plan-contract.mjs'],
  ['scripts/verify-queue-lifecycle.mjs'],
  ['scripts/verify-conversation-timing.mjs'],
  ['scripts/verify-rpc-foreground.mjs'],
]
for (const args of checks) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
console.log('Core-flow contracts passed. Real service, browser and device gates remain separate.')
