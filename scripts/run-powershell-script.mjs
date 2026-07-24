#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const PROBE_TIMEOUT_MS = 15_000

const [, , scriptPath, ...scriptArgs] = process.argv

if (!scriptPath) {
  console.error('Usage: node scripts/run-powershell-script.mjs <script.ps1> [...args]')
  process.exit(2)
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function getCandidates() {
  const preferred = process.env.CX_CODEX_POWERSHELL_COMMAND?.trim()
  const defaults = process.platform === 'win32'
    ? ['pwsh', 'powershell.exe', 'powershell']
    : ['pwsh', 'powershell']
  return unique([preferred, ...defaults])
}

function getBaseArgs() {
  return process.platform === 'win32'
    ? ['-NoProfile', '-ExecutionPolicy', 'Bypass']
    : ['-NoProfile']
}

function probePowerShell(command) {
  const result = spawnSync(command, [...getBaseArgs(), '-Command', '$PSVersionTable.PSVersion.ToString()'], {
    encoding: 'utf8',
    timeout: PROBE_TIMEOUT_MS,
    windowsHide: true,
  })
  return {
    command,
    ok: !result.error && result.status === 0,
    error: result.error,
    status: result.status,
    stdout: result.stdout?.trim() ?? '',
    stderr: result.stderr?.trim() ?? '',
  }
}

const probes = getCandidates().map(probePowerShell)
const selected = probes.find((probe) => probe.ok)

if (!selected) {
  console.error('No usable PowerShell executable found.')
  for (const probe of probes) {
    const reason = probe.error?.message || probe.stderr || `exit ${String(probe.status)}`
    console.error(`- ${probe.command}: ${reason}`)
  }
  process.exit(1)
}

const resolvedScriptPath = resolve(scriptPath)
console.error(`Using PowerShell: ${selected.command} (${selected.stdout || 'version unknown'})`)

const result = spawnSync(selected.command, [...getBaseArgs(), '-File', resolvedScriptPath, ...scriptArgs], {
  stdio: 'inherit',
  env: {
    ...process.env,
    CX_CODEX_POWERSHELL_COMMAND: selected.command,
  },
  windowsHide: true,
})

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}

if (result.signal) {
  console.error(`PowerShell script terminated by signal ${result.signal}`)
  process.exit(1)
}

process.exit(result.status ?? 0)
