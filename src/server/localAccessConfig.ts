import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

type ConfigRecord = Record<string, unknown>
type ConfigUpdate = (config: ConfigRecord) => void | Promise<void>

const configUpdateQueues = new Map<string, Promise<unknown>>()

function isConfigRecord(value: unknown): value is ConfigRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getConfigQueueKey(configPath: string): string {
  const absolutePath = resolve(configPath)
  return process.platform === 'win32' ? absolutePath.toLowerCase() : absolutePath
}

async function serializeConfigUpdate<T>(configPath: string, operation: () => Promise<T>): Promise<T> {
  const queueKey = getConfigQueueKey(configPath)
  const previous = configUpdateQueues.get(queueKey) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(operation)
  configUpdateQueues.set(queueKey, current)
  try {
    return await current
  } finally {
    if (configUpdateQueues.get(queueKey) === current) {
      configUpdateQueues.delete(queueKey)
    }
  }
}

async function writeConfigAtomically(
  configPath: string,
  config: ConfigRecord,
  mode?: number,
): Promise<void> {
  const temporaryPath = `${configPath}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`
  try {
    await mkdir(dirname(configPath), { recursive: true })
    await writeFile(
      temporaryPath,
      `${JSON.stringify(config, null, 2)}\n`,
      mode === undefined ? 'utf8' : { encoding: 'utf8', mode },
    )
    await rename(temporaryPath, configPath)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {})
    throw error
  }
}

export async function updateLocalAccessConfig(
  configPath: string,
  update: ConfigUpdate,
  options: { requireExisting?: boolean } = {},
): Promise<void> {
  await serializeConfigUpdate(configPath, async () => {
    let config: ConfigRecord = {}
    let mode: number | undefined
    try {
      const [raw, configStats] = await Promise.all([
        readFile(configPath, 'utf8'),
        stat(configPath),
      ])
      const parsed = JSON.parse(raw) as unknown
      if (!isConfigRecord(parsed)) {
        throw new Error('CX-Codex 配置文件格式无效。')
      }
      config = parsed
      mode = configStats.mode
    } catch (error) {
      if (options.requireExisting) throw error
    }

    await update(config)
    await writeConfigAtomically(configPath, config, mode)
  })
}

export async function persistAccessPassword(configPath: string, password: string): Promise<void> {
  await updateLocalAccessConfig(
    configPath,
    (config) => {
      config.password = password
    },
    { requireExisting: true },
  )
}
