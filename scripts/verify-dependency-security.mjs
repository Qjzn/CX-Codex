import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const officialRegistry = 'https://registry.npmjs.org'

function uniqueExistingPaths(paths) {
  return [...new Set(paths.filter(Boolean).map((value) => resolve(value)))]
    .filter((value) => existsSync(value))
}

function readNpmVersion(npmCliPath) {
  const result = spawnSync(process.execPath, [npmCliPath, '--version'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  if (result.status !== 0) return null
  const version = result.stdout.trim()
  const major = Number.parseInt(version.split('.')[0] ?? '', 10)
  return Number.isFinite(major) ? { major, version } : null
}

function findCompatibleNpm() {
  const executableDir = dirname(process.execPath)
  const candidates = uniqueExistingPaths([
    process.env.npm_execpath,
    join(executableDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    resolve(executableDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ])
  const discovered = []
  for (const npmCliPath of candidates) {
    const npmVersion = readNpmVersion(npmCliPath)
    if (!npmVersion) continue
    discovered.push(`${npmVersion.version} (${npmCliPath})`)
    if (npmVersion.major >= 9) {
      return { npmCliPath, ...npmVersion }
    }
  }
  throw new Error(`Dependency security audit requires npm 9 or newer for lockfile v3. Found: ${discovered.join(', ') || 'none'}`)
}

function readAuditPayload(stdout) {
  try {
    return JSON.parse(stdout)
  } catch {
    return null
  }
}

const npm = findCompatibleNpm()
const audit = spawnSync(process.execPath, [
  npm.npmCliPath,
  'audit',
  '--json',
  '--audit-level=low',
  `--registry=${officialRegistry}`,
], {
  cwd: repoRoot,
  encoding: 'utf8',
  env: {
    ...process.env,
    npm_config_audit: 'true',
    npm_config_fund: 'false',
    npm_config_registry: officialRegistry,
    npm_config_update_notifier: 'false',
  },
})

if (audit.error) throw audit.error

const payload = readAuditPayload(audit.stdout)
const vulnerabilities = payload?.metadata?.vulnerabilities
const total = Number(vulnerabilities?.total)
if (audit.status !== 0 || !Number.isFinite(total) || total !== 0) {
  const summary = vulnerabilities
    ? `info=${vulnerabilities.info ?? 0}, low=${vulnerabilities.low ?? 0}, moderate=${vulnerabilities.moderate ?? 0}, high=${vulnerabilities.high ?? 0}, critical=${vulnerabilities.critical ?? 0}, total=${vulnerabilities.total ?? 'unknown'}`
    : (payload?.error?.summary || audit.stderr.trim() || 'npm audit returned no machine-readable vulnerability summary')
  console.error(`Dependency security audit failed with npm ${npm.version}: ${summary}`)
  process.exit(audit.status || 1)
}

console.log(`Dependency security audit passed with npm ${npm.version} against ${officialRegistry}: 0 vulnerabilities across ${payload.metadata?.dependencies?.total ?? 'unknown'} dependencies.`)
