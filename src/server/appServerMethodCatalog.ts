import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  copyCodexLaunchIdentity,
  readCodexLaunchFileSha256,
  type CodexLaunchIdentity,
} from '../commandResolution.js'
import { getSpawnInvocation } from '../utils/commandInvocation.js'

type MethodCatalogs = {
  methods: string[]
  notificationMethods: string[]
}

/** Reads the launch target's own fingerprint. Injected only to observe call counts in tests. */
type LaunchFileHasher = (launchPath: string) => string | null

/**
 * The identity the catalog must bind to. It is read-only: the catalog never writes it back,
 * never guesses a generation and never re-attributes an identity from a file/PATH change.
 */
type CodexLaunchIdentityProvider = () => CodexLaunchIdentity | null

/**
 * Real generation seam: the default keeps the production `app-server generate-json-schema` child
 * semantics, tests inject a fake child and record the exact command/args.
 */
type SchemaCommandRun = {
  command: string
  args: string[]
  outDir: string
  identity: CodexLaunchIdentity
}
type SchemaCommandRunner = (input: SchemaCommandRun) => Promise<void>

type SchemaGenerator = (outDir: string, identity: CodexLaunchIdentity) => Promise<void>

export type AppServerMethodCatalogUnavailableReason =
  | 'no-active-launch-identity'
  | 'incomplete-launch-identity'
  | 'launch-identity-changed'
  | 'launch-target-changed'

export class AppServerMethodCatalogUnavailableError extends Error {
  readonly reason: AppServerMethodCatalogUnavailableReason

  constructor(reason: AppServerMethodCatalogUnavailableReason, message: string) {
    super(message)
    this.name = 'AppServerMethodCatalogUnavailableError'
    this.reason = reason
  }
}

export function isAppServerMethodCatalogUnavailableError(value: unknown): value is AppServerMethodCatalogUnavailableError {
  return value instanceof AppServerMethodCatalogUnavailableError
}

export type AppServerMethodCatalogOptions = {
  getActiveLaunchIdentity: CodexLaunchIdentityProvider
  generateSchemaCommand?: SchemaGenerator
  runSchemaCommand?: SchemaCommandRunner
  hashLaunchFile?: LaunchFileHasher
}

/**
 * Only a complete **native** identity can bind a generation target: a known absolute launch path
 * plus the frozen version/SHA the owner published for that native target.
 *
 * A `launcher` wrapper (for example a `.cmd` shim) is deliberately not bindable. Unchanged wrapper
 * bytes can execute a different downstream native binary, so a wrapper fingerprint plus its raw
 * version do not prove that the generated schemas describe the active native app-server instance.
 * The catalog therefore returns the existing explicit unavailable for launcher/unknown/incomplete
 * identities and never starts a generation (no generator, no spawn, no hash) for them.
 *
 * Launching a wrapper (owner launch policy) and trusting that wrapper as the schema identity are
 * different boundaries: the owner's launch behavior is unchanged by this catalog-side gate.
 */
function isCompleteLaunchIdentity(identity: CodexLaunchIdentity | null): identity is CodexLaunchIdentity {
  if (identity === null) {
    return false
  }
  return identity.launchPath.length > 0
    && identity.identityKind === 'native'
    && typeof identity.sha256 === 'string'
    && identity.sha256.length > 0
    && typeof identity.versionRaw === 'string'
    && identity.versionRaw.length > 0
}

/** Cache/inflight key: generation + launch path + raw version + SHA + kind. */
function toIdentityKey(identity: CodexLaunchIdentity): string {
  return [identity.generation, identity.launchPath, identity.versionRaw ?? '', identity.sha256 ?? '', identity.identityKind].join('\u0000')
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
  private catalogCache: { key: string; catalogs: MethodCatalogs } | null = null
  private inflight: { key: string; promise: Promise<MethodCatalogs> } | null = null

  constructor(private readonly options: AppServerMethodCatalogOptions) {}

  private resolveActiveIdentity(): CodexLaunchIdentity {
    const identity = this.options.getActiveLaunchIdentity()
    const identityKind = identity?.identityKind ?? 'unknown'
    if (identity === null || identity.launchPath.length === 0) {
      throw new AppServerMethodCatalogUnavailableError(
        'no-active-launch-identity',
        'No active Codex app-server launch identity is published yet.',
      )
    }
    if (!isCompleteLaunchIdentity(identity)) {
      throw new AppServerMethodCatalogUnavailableError(
        'incomplete-launch-identity',
        `The active Codex launch identity cannot bind the generated schema (kind=${identityKind}); only a complete native identity is bindable.`,
      )
    }
    return identity
  }

  /**
   * Pre/post window check around a real generation: the frozen target must still be the current
   * owner identity and its on-disk fingerprint must still equal the frozen SHA. A changed file or a
   * replaced owner is never re-attributed; the call ends as an explicit unavailable.
   */
  private assertFrozenIdentityIsCurrent(frozen: CodexLaunchIdentity): void {
    const current = this.options.getActiveLaunchIdentity()
    if (!isCompleteLaunchIdentity(current) || toIdentityKey(current) !== toIdentityKey(frozen)) {
      throw new AppServerMethodCatalogUnavailableError(
        'launch-identity-changed',
        'The active Codex launch identity changed while the method catalog was being generated.',
      )
    }
    const hash = this.hashLaunchFile(frozen.launchPath)
    if (hash === null || hash !== frozen.sha256) {
      throw new AppServerMethodCatalogUnavailableError(
        'launch-target-changed',
        `The launch target changed while the method catalog was being generated (${frozen.launchPath}).`,
      )
    }
  }

  private hashLaunchFile(launchPath: string): string | null {
    const hash = this.options.hashLaunchFile ?? readCodexLaunchFileSha256
    return hash(launchPath)
  }

  private async runSchemaCommand(input: SchemaCommandRun): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(input.command, input.args, {
        stdio: ['ignore', 'ignore', 'pipe'],
      })

      let stderr = ''

      proc.stderr.setEncoding('utf8')
      proc.stderr.on('data', (chunk: string) => {
        stderr += chunk
      })

      proc.on('error', reject)
      proc.on('exit', (code) => {
        if (code === 0) {
          resolve()
          return
        }

        reject(new Error(stderr.trim() || `generate-json-schema exited with code ${String(code)}`))
      })
    })
  }

  private async runGenerateSchemaCommand(outDir: string, identity: CodexLaunchIdentity): Promise<void> {
    const invocation = getSpawnInvocation(identity.launchPath, ['app-server', 'generate-json-schema', '--out', outDir])
    const runner = this.options.runSchemaCommand ?? ((input: SchemaCommandRun) => this.runSchemaCommand(input))
    await runner({ ...invocation, outDir, identity })
  }

  private async loadCatalogs(): Promise<MethodCatalogs> {
    const frozen = copyCodexLaunchIdentity(this.resolveActiveIdentity())
    const key = toIdentityKey(frozen)

    if (this.catalogCache && this.catalogCache.key === key) {
      return this.catalogCache.catalogs
    }

    if (this.inflight && this.inflight.key === key) {
      return this.inflight.promise
    }

    const promise = this.readCatalogs(frozen)
    this.inflight = { key, promise }
    const settleOwnInflight = (): void => {
      if (this.inflight !== null && this.inflight.promise === promise) {
        this.inflight = null
      }
    }
    promise.then(settleOwnInflight, settleOwnInflight)

    return promise
  }

  private async readCatalogs(frozen: CodexLaunchIdentity): Promise<MethodCatalogs> {
    const outDir = await mkdtemp(join(tmpdir(), 'codex-web-local-schema-'))
    try {
      this.assertFrozenIdentityIsCurrent(frozen)

      const generate = this.options.generateSchemaCommand ?? this.runGenerateSchemaCommand.bind(this)
      await generate(outDir, frozen)

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

      this.assertFrozenIdentityIsCurrent(frozen)
      this.catalogCache = { key: toIdentityKey(frozen), catalogs }
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
