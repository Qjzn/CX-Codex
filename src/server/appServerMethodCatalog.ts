import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveCodexCommand } from '../commandResolution.js'
import { getSpawnInvocation } from '../utils/commandInvocation.js'

type SchemaGenerator = (outDir: string) => Promise<void>
type MethodCatalogs = {
  methods: string[]
  notificationMethods: string[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function extractMethodCatalogFromSchema(payload: unknown): string[] {
  const root = asRecord(payload)
  const oneOf = Array.isArray(root?.oneOf) ? root.oneOf : []
  const methods = new Set<string>()

  for (const entry of oneOf) {
    const row = asRecord(entry)
    const properties = asRecord(row?.properties)
    const methodDef = asRecord(properties?.method)
    const methodEnum = Array.isArray(methodDef?.enum) ? methodDef.enum : []

    for (const item of methodEnum) {
      if (typeof item === 'string' && item.length > 0) {
        methods.add(item)
      }
    }
  }

  return Array.from(methods).sort((a, b) => a.localeCompare(b))
}

export class AppServerMethodCatalog {
  private catalogCache: MethodCatalogs | null = null
  private catalogPromise: Promise<MethodCatalogs> | null = null

  constructor(private readonly generateSchemaCommand?: SchemaGenerator) {}

  private async runGenerateSchemaCommand(outDir: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const codexCommand = resolveCodexCommand()
      if (!codexCommand) {
        reject(new Error('Codex CLI is not available. Install @openai/codex or set CX_CODEX_CODEX_COMMAND.'))
        return
      }

      const invocation = getSpawnInvocation(codexCommand, ['app-server', 'generate-json-schema', '--out', outDir])
      const process = spawn(invocation.command, invocation.args, {
        stdio: ['ignore', 'ignore', 'pipe'],
      })

      let stderr = ''

      process.stderr.setEncoding('utf8')
      process.stderr.on('data', (chunk: string) => {
        stderr += chunk
      })

      process.on('error', reject)
      process.on('exit', (code) => {
        if (code === 0) {
          resolve()
          return
        }

        reject(new Error(stderr.trim() || `generate-json-schema exited with code ${String(code)}`))
      })
    })
  }

  private async loadCatalogs(): Promise<MethodCatalogs> {
    if (this.catalogCache) {
      return this.catalogCache
    }

    if (this.catalogPromise) {
      return this.catalogPromise
    }

    this.catalogPromise = this.readCatalogs().finally(() => {
      this.catalogPromise = null
    })

    return this.catalogPromise
  }

  private async readCatalogs(): Promise<MethodCatalogs> {
    const outDir = await mkdtemp(join(tmpdir(), 'codex-web-local-schema-'))
    try {
      const generate = this.generateSchemaCommand ?? this.runGenerateSchemaCommand.bind(this)
      await generate(outDir)

      const clientRequestPath = join(outDir, 'ClientRequest.json')
      const serverNotificationPath = join(outDir, 'ServerNotification.json')
      const [clientRequestRaw, serverNotificationRaw] = await Promise.all([
        readFile(clientRequestPath, 'utf8'),
        readFile(serverNotificationPath, 'utf8'),
      ])
      const catalogs = {
        methods: extractMethodCatalogFromSchema(JSON.parse(clientRequestRaw) as unknown),
        notificationMethods: extractMethodCatalogFromSchema(JSON.parse(serverNotificationRaw) as unknown),
      }

      this.catalogCache = catalogs
      return catalogs
    } finally {
      await rm(outDir, { recursive: true, force: true })
    }
  }

  async listMethods(): Promise<string[]> {
    return (await this.loadCatalogs()).methods
  }

  async listNotificationMethods(): Promise<string[]> {
    return (await this.loadCatalogs()).notificationMethods
  }
}
