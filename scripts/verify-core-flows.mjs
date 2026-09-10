// Deterministic core contracts only: no existing service, model calls or user database.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const cwd = fileURLToPath(new URL('../', import.meta.url))
const checks = [
  ['--test', 'scripts/runtime-send-response.test.mjs'],
  ['scripts/verify-delivery-contract.mjs'],
  ['scripts/verify-queue-edit-contract.mjs'],
  ['scripts/verify-queue-quote-safety.mjs'],
  ['scripts/verify-display-identity.mjs'],
  ['--test', 'scripts/runtime-user-identity-contract.test.mjs'],
  ['--test', 'scripts/native-user-identity.test.mjs'],
  ['--test', 'scripts/session-log-user-identity.test.mjs'],
  ['--test', 'scripts/session-log-display-contract.test.mjs'],
  ['--test', 'scripts/session-log-history-source.test.mjs'],
  ['--test', 'scripts/session-log-lifecycle.test.mjs'],
  ['scripts/verify-native-collaboration.mjs'],
  ['--experimental-strip-types', '--test', 'scripts/plan-implementation.test.mjs'],
  ['scripts/verify-goal-plan-contract.mjs'],
  ['scripts/verify-queue-lifecycle.mjs'],
  ['scripts/verify-conversation-timing.mjs'],
  ['scripts/verify-conversation-runtime-timing-contract.mjs'],
  ['scripts/verify-conversation-refresh-contract.mjs'],
  ['scripts/verify-rpc-foreground.mjs'],
]
for (const args of checks) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
console.log('Core-flow contracts passed. Real service, browser and device gates remain separate.')
