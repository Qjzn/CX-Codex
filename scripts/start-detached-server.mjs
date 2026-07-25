import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, isAbsolute } from 'node:path'

function parsePayload(encodedPayload) {
  if (!encodedPayload) {
    throw new Error('Missing detached server launch payload.')
  }

  let payload
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64').toString('utf8'))
  } catch {
    throw new Error('Detached server launch payload is invalid.')
  }

  const requiredPaths = [
    'nodeExecutable',
    'serverEntryPoint',
    'configPath',
    'workingDirectory',
    'stdoutPath',
    'stderrPath',
  ]
  for (const key of requiredPaths) {
    const value = payload?.[key]
    if (typeof value !== 'string' || !value.trim() || !isAbsolute(value)) {
      throw new Error(`Detached server launch payload has an invalid ${key}.`)
    }
  }
  for (const key of ['nodeExecutable', 'serverEntryPoint', 'configPath', 'workingDirectory']) {
    if (!existsSync(payload[key])) {
      throw new Error(`Detached server launch path does not exist: ${key}.`)
    }
  }
  return payload
}

function waitForSpawn(child) {
  return new Promise((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })
}

async function spawnServer(payload) {
  mkdirSync(dirname(payload.stdoutPath), { recursive: true })
  mkdirSync(dirname(payload.stderrPath), { recursive: true })
  let stdoutHandle
  let stderrHandle
  try {
    stdoutHandle = openSync(payload.stdoutPath, 'a')
    stderrHandle = openSync(payload.stderrPath, 'a')
    const child = spawn(
      payload.nodeExecutable,
      [payload.serverEntryPoint, '--config', payload.configPath],
      {
        cwd: payload.workingDirectory,
        detached: true,
        windowsHide: true,
        stdio: ['ignore', stdoutHandle, stderrHandle],
      },
    )
    await waitForSpawn(child)
    if (!Number.isInteger(child.pid) || child.pid <= 0) {
      throw new Error('Detached server process did not return a valid PID.')
    }
    child.unref()
    return child.pid
  } finally {
    if (typeof stdoutHandle === 'number') {
      closeSync(stdoutHandle)
    }
    if (typeof stderrHandle === 'number') {
      closeSync(stderrHandle)
    }
  }
}

const encodedPayload = process.argv[2]
const resultPath = process.argv[3]
if (!resultPath || !isAbsolute(resultPath)) {
  process.exitCode = 1
} else {
  try {
    const pid = await spawnServer(parsePayload(encodedPayload))
    await writeFile(resultPath, JSON.stringify({ ok: true, pid }), 'utf8')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await writeFile(resultPath, JSON.stringify({ ok: false, error: message }), 'utf8')
    process.exitCode = 1
  }
}
