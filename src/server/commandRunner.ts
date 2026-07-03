import { spawn } from 'node:child_process'

export type CommandRunnerOptions = {
  cwd?: string
}

function formatCommandError(command: string, args: string[], stdout: string, stderr: string): Error {
  const details = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n')
  const suffix = details.length > 0 ? `: ${details}` : ''
  return new Error(`Command failed (${command} ${args.join(' ')})${suffix}`)
}

async function runCommandInternal(command: string, args: string[], options: CommandRunnerOptions): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim())
        return
      }
      reject(formatCommandError(command, args, stdout, stderr))
    })
  })
}

export async function runCommand(command: string, args: string[], options: CommandRunnerOptions = {}): Promise<void> {
  await runCommandInternal(command, args, options)
}

export async function runCommandCapture(command: string, args: string[], options: CommandRunnerOptions = {}): Promise<string> {
  return await runCommandInternal(command, args, options)
}

export async function runCommandWithOutput(command: string, args: string[], options: CommandRunnerOptions = {}): Promise<string> {
  return await runCommandInternal(command, args, options)
}
