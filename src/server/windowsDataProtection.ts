import { spawn } from 'node:child_process'
import { win32 } from 'node:path'

const DATA_PROTECTION_TIMEOUT_MS = 15_000
const MAX_DATA_PROTECTION_OUTPUT_BYTES = 1024 * 1024

const PROTECT_SCRIPT = [
  'Add-Type -AssemblyName System.Security;',
  '$value=[Console]::In.ReadToEnd();',
  '$bytes=[Text.Encoding]::UTF8.GetBytes($value);',
  '$protected=[System.Security.Cryptography.ProtectedData]::Protect($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);',
  '[Console]::Out.Write([Convert]::ToBase64String($protected));',
].join('')

const UNPROTECT_SCRIPT = [
  'Add-Type -AssemblyName System.Security;',
  '$value=[Console]::In.ReadToEnd();',
  '$bytes=[Convert]::FromBase64String($value);',
  '$plain=[System.Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);',
  '$stdout=[Console]::OpenStandardOutput();',
  '$stdout.Write($plain,0,$plain.Length);',
].join('')

let cachedProtectedValue = ''
let cachedPlainValue = ''

async function runWindowsDataProtection(script: string, input: string): Promise<Buffer> {
  if (process.platform !== 'win32') {
    throw new Error('Windows data protection is unavailable on this platform')
  }
  return await new Promise<Buffer>((resolve, reject) => {
    const systemRoot = (process.env.SystemRoot ?? process.env.WINDIR ?? '').trim()
    if (!systemRoot || !win32.isAbsolute(systemRoot)) {
      reject(new Error('Windows system PowerShell path is unavailable'))
      return
    }
    const powershellPath = win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const proc = spawn(powershellPath, ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    let stdoutBytes = 0
    let settled = false
    const finish = (error?: Error, value?: Buffer): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(value ?? Buffer.alloc(0))
    }
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      finish(new Error('Windows data protection timed out'))
    }, DATA_PROTECTION_TIMEOUT_MS)
    proc.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length
      if (stdoutBytes > MAX_DATA_PROTECTION_OUTPUT_BYTES) {
        proc.kill('SIGKILL')
        finish(new Error('Windows data protection output exceeded the safety limit'))
        return
      }
      stdout.push(chunk)
    })
    proc.stderr.resume()
    proc.stdin.on('error', () => {})
    proc.on('error', () => finish(new Error('Failed to start Windows data protection')))
    proc.on('close', (code) => {
      if (code !== 0) {
        finish(new Error(`Windows data protection failed with exit code ${code ?? 'unknown'}`))
        return
      }
      finish(undefined, Buffer.concat(stdout))
    })
    proc.stdin.end(input, 'utf8')
  })
}

export async function protectWindowsCurrentUserText(value: string): Promise<string> {
  const protectedValue = (await runWindowsDataProtection(PROTECT_SCRIPT, value)).toString('ascii').trim()
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(protectedValue)) {
    throw new Error('Windows data protection returned an invalid payload')
  }
  return protectedValue
}

export async function unprotectWindowsCurrentUserText(value: string): Promise<string> {
  if (value === cachedProtectedValue && cachedPlainValue) return cachedPlainValue
  const plainValue = (await runWindowsDataProtection(UNPROTECT_SCRIPT, value)).toString('utf8')
  cachedProtectedValue = value
  cachedPlainValue = plainValue
  return plainValue
}
