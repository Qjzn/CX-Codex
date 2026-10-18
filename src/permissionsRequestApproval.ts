/**
 * Shared, side-effect free contract for the dedicated permission approval request
 * (`item/permissions/requestApproval`) of the Codex app-server.
 *
 * Derived from the verified offline generated wire schemas of codex-cli 0.130.0 and
 * 0.162.1 (`output/b3-schema-0.130.0`, `output/b3-schema-0.162.1`):
 * - request params require `cwd/itemId/permissions/startedAtMs/threadId/turnId`;
 *   `environmentId` (0.162.1 only), `reason`, `network`, `fileSystem` and the file
 *   system members may be absent or null, so they are never treated as unknown.
 * - `none` (0.130.0) and `deny` (0.162.1) are both restrictions and are preserved
 *   verbatim; they are never renamed and never dropped.
 * - paths are plain UTF-8 text (0.162.1 `LegacyAppPathString`); this module never
 *   resolves, normalizes or existence-checks a path and never guesses the local
 *   environment.
 *
 * The module stays pure TypeScript: no Node, filesystem, network, DOM or Vue import.
 */

export const PERMISSIONS_APPROVAL_METHOD = 'item/permissions/requestApproval'

export type PermissionsApprovalScope = 'turn'

export type PermissionsApprovalRow = {
  label: string
  value: string
}

export type PermissionsApprovalAccess = 'read' | 'write' | 'none' | 'deny'

export type PermissionsApprovalSpecialPath =
  | { kind: 'root' }
  | { kind: 'minimal' }
  | { kind: 'project_roots'; subpath: string | null }
  | { kind: 'tmpdir' }
  | { kind: 'slash_tmp' }
  | { kind: 'unknown'; path: string; subpath: string | null }

export type PermissionsApprovalPath =
  | { type: 'path'; path: string }
  | { type: 'glob_pattern'; pattern: string }
  | { type: 'special'; value: PermissionsApprovalSpecialPath }

export type PermissionsApprovalEntry = {
  path: PermissionsApprovalPath
  access: PermissionsApprovalAccess
}

export type PermissionsApprovalNetworkProfile = {
  enabled: boolean | null
}

export type PermissionsApprovalFileSystemProfile = {
  read?: string[] | null
  write?: string[] | null
  globScanMaxDepth?: number | null
  entries?: PermissionsApprovalEntry[] | null
}

export type PermissionsApprovalGrantedProfile = {
  network?: PermissionsApprovalNetworkProfile
  fileSystem?: PermissionsApprovalFileSystemProfile
}

export type PermissionsApprovalView = {
  /** True only when every requested component is fully recognized and grantable. */
  canApprove: boolean
  /** Empty when `canApprove`; otherwise the reason the request can only be denied. */
  unavailableReason: string
  /** Complete, never truncated display rows (grantable or not). */
  rows: PermissionsApprovalRow[]
  /** Canonical profile rebuilt from the original request, or null when not grantable. */
  grant: PermissionsApprovalGrantedProfile | null
}

export type PermissionsApprovalResult = {
  permissions: PermissionsApprovalGrantedProfile
  scope: PermissionsApprovalScope
}

export type PermissionsApprovalAction = 'allow-turn' | 'deny'

const UNAVAILABLE_REASON = '请求包含无法完整识别的权限结构，为避免扩大权限，本次只能拒绝。'

const REQUEST_KEYS = new Set([
  'threadId',
  'turnId',
  'itemId',
  'environmentId',
  'startedAtMs',
  'cwd',
  'reason',
  'permissions',
])

const PERMISSION_KEYS = new Set(['network', 'fileSystem'])
const NETWORK_KEYS = new Set(['enabled'])
const FILE_SYSTEM_KEYS = new Set(['read', 'write', 'globScanMaxDepth', 'entries'])
const ENTRY_KEYS = new Set(['path', 'access'])
const ACCESS_MODES = new Set<string>(['read', 'write', 'none', 'deny'])
// Own-key-safe lookup tables: a Map never resolves inherited members such as
// `toString`, `constructor` or `__proto__` to a prototype value.
const PATH_VARIANT_KEYS = new Map<string, Set<string>>([
  ['path', new Set(['type', 'path'])],
  ['glob_pattern', new Set(['type', 'pattern'])],
  ['special', new Set(['type', 'value'])],
])
const SPECIAL_KEYS = new Map<string, Set<string>>([
  ['root', new Set(['kind'])],
  ['minimal', new Set(['kind'])],
  ['tmpdir', new Set(['kind'])],
  ['slash_tmp', new Set(['kind'])],
  ['project_roots', new Set(['kind', 'subpath'])],
  ['unknown', new Set(['kind', 'path', 'subpath'])],
])

type Parsed<T> = { ok: true; value: T } | { ok: false }

type PermissionsApprovalRequestAnalysis = {
  recognized: boolean
  details: string[]
  rows: PermissionsApprovalRow[]
  grant: PermissionsApprovalGrantedProfile
}

export function isPermissionsApprovalRequestMethod(method: string): boolean {
  return typeof method === 'string'
    && method.trim().toLowerCase() === PERMISSIONS_APPROVAL_METHOD.toLowerCase()
}

/**
 * Display model for the dedicated permission approval. Works for both verified wire
 * versions and for structures this product cannot yet express; in the latter case the
 * request stays displayable and can only be denied.
 */
export function projectPermissionsApproval(params: unknown): PermissionsApprovalView {
  const analysis = analyzePermissionsApprovalRequest(params)
  return {
    canApprove: analysis.recognized,
    unavailableReason: analysis.recognized ? '' : UNAVAILABLE_REASON,
    rows: analysis.rows,
    grant: analysis.recognized ? cloneValue(analysis.grant) : null,
  }
}

/**
 * Builds the outgoing result. `deny` is always the empty turn grant; `allow-turn` only
 * forwards the profile that was derived from the original request.
 */
export function buildPermissionsApprovalResult(
  view: PermissionsApprovalView,
  action: PermissionsApprovalAction,
): PermissionsApprovalResult {
  if (action === 'deny') return { permissions: {}, scope: 'turn' }
  if (action !== 'allow-turn') {
    throw new Error(`Unsupported permissions approval action "${String(action)}"`)
  }
  if (!view || view.canApprove !== true) {
    throw new Error('Cannot allow a permissions request that is not fully recognized')
  }
  return { permissions: cloneValue(view.grant ?? {}), scope: 'turn' }
}

/**
 * Validates a client result against the authoritative pending request and rebuilds the
 * accepted result from that request. Only `permissions`/`scope` are accepted, `scope` is
 * fixed to `turn`, and the granted components must be either empty or exact complete
 * components of the original request (same members, order, restrictions and paths).
 */
export function validatePermissionsApprovalResult(
  params: unknown,
  result: unknown,
): PermissionsApprovalResult {
  const body = asRecord(result)
  if (!body) throw new Error('Permissions approval result must be an object')
  for (const key of Object.keys(body)) {
    if (key !== 'permissions' && key !== 'scope') {
      throw new Error(`Permissions approval result must not include field "${key}"`)
    }
  }
  if ('scope' in body && body.scope !== 'turn') {
    throw new Error('Permissions approval result scope must be "turn"')
  }
  if (!('permissions' in body)) {
    throw new Error('Permissions approval result must include permissions')
  }
  const permissions = asRecord(body.permissions)
  if (!permissions) {
    throw new Error('Permissions approval result permissions must be an object')
  }
  const candidates = buildResultCandidates(params)
  const matched = candidates.find((candidate) => isDeepEqual(candidate, permissions))
  if (!matched) {
    throw new Error('Permissions approval result must grant only exact components of the original request')
  }
  return { permissions: cloneValue(matched), scope: 'turn' }
}

function buildResultCandidates(params: unknown): PermissionsApprovalGrantedProfile[] {
  const analysis = analyzePermissionsApprovalRequest(params)
  const candidates: PermissionsApprovalGrantedProfile[] = [{}]
  if (!analysis.recognized) return candidates

  const network = analysis.grant.network
  const fileSystem = analysis.grant.fileSystem
  if (network) candidates.push({ network })
  if (fileSystem) candidates.push({ fileSystem })
  if (network && fileSystem) candidates.push({ network, fileSystem })
  return candidates
}

function analyzePermissionsApprovalRequest(params: unknown): PermissionsApprovalRequestAnalysis {
  const details: string[] = []
  const rows: PermissionsApprovalRow[] = []
  const grant: PermissionsApprovalGrantedProfile = {}

  const request = asRecord(params)
  if (!request) {
    details.push('权限请求参数不是可识别的对象')
    rows.push(fallbackHeaderRow())
    return finish(details, rows, grant)
  }

  for (const key of Object.keys(request)) {
    if (!REQUEST_KEYS.has(key)) details.push(`权限请求包含未知字段 ${key}`)
  }
  for (const key of ['threadId', 'turnId', 'itemId', 'startedAtMs', 'cwd']) {
    if (!(key in request)) details.push(`权限请求缺少必填字段 ${key}`)
  }
  if ('threadId' in request && typeof request.threadId !== 'string') details.push('字段 threadId 类型无法识别')
  if ('turnId' in request && typeof request.turnId !== 'string') details.push('字段 turnId 类型无法识别')
  if ('itemId' in request && typeof request.itemId !== 'string') details.push('字段 itemId 类型无法识别')
  if ('startedAtMs' in request && !isInteger(request.startedAtMs)) details.push('字段 startedAtMs 类型无法识别')
  if ('cwd' in request && typeof request.cwd !== 'string') details.push('字段 cwd 类型无法识别')

  const environmentId = typeof request.environmentId === 'string' ? request.environmentId : null
  if ('environmentId' in request && request.environmentId !== null && typeof request.environmentId !== 'string') {
    details.push('字段 environmentId 类型无法识别')
  }
  const reason = typeof request.reason === 'string' ? request.reason : ''
  if ('reason' in request && request.reason !== null && typeof request.reason !== 'string') {
    details.push('字段 reason 类型无法识别')
  }

  rows.push({ label: '环境', value: environmentId ?? '未提供' })
  rows.push({ label: '工作目录', value: typeof request.cwd === 'string' && request.cwd ? request.cwd : '未提供' })
  rows.push({ label: '原因', value: reason || '未提供' })

  const permissions = asRecord(request.permissions)
  if (!('permissions' in request)) {
    details.push('权限请求缺少必填字段 permissions')
    rows.push({ label: '权限范围', value: '无法识别' })
    return finish(details, rows, grant)
  }
  if (!permissions) {
    details.push('权限范围结构无法识别')
    rows.push({ label: '权限范围', value: '无法识别' })
    return finish(details, rows, grant)
  }

  for (const key of Object.keys(permissions)) {
    if (!PERMISSION_KEYS.has(key)) details.push(`权限范围包含未知字段 ${key}`)
  }

  const network = parseNetworkProfile(permissions, details, rows)
  if (network) grant.network = network

  const fileSystem = parseFileSystemProfile(permissions, details, rows)
  if (fileSystem) grant.fileSystem = fileSystem

  return finish(details, rows, grant)
}

function parseNetworkProfile(
  permissions: Record<string, unknown>,
  details: string[],
  rows: PermissionsApprovalRow[],
): PermissionsApprovalNetworkProfile | null {
  const raw = permissions.network
  if (raw === undefined || raw === null) {
    rows.push({ label: '网络访问', value: '未指定' })
    return null
  }
  const network = asRecord(raw)
  if (!network) {
    details.push('网络权限结构无法识别')
    rows.push({ label: '网络访问', value: '无法识别' })
    return null
  }
  for (const key of Object.keys(network)) {
    if (!NETWORK_KEYS.has(key)) details.push(`网络权限包含未知字段 ${key}`)
  }
  const enabled = network.enabled
  if (enabled !== undefined && enabled !== null && typeof enabled !== 'boolean') {
    details.push('网络权限 enabled 值无法识别')
    rows.push({ label: '网络访问', value: '无法识别' })
    return null
  }
  const value = enabled === true ? '允许' : enabled === false ? '不允许' : '未指定'
  rows.push({ label: '网络访问', value })
  return { enabled: enabled === true ? true : enabled === false ? false : null }
}

function parseFileSystemProfile(
  permissions: Record<string, unknown>,
  details: string[],
  rows: PermissionsApprovalRow[],
): PermissionsApprovalFileSystemProfile | null {
  const raw = permissions.fileSystem
  if (raw === undefined || raw === null) return null
  const fileSystem = asRecord(raw)
  if (!fileSystem) {
    details.push('文件系统权限结构无法识别')
    rows.push({ label: '文件系统权限', value: '无法识别' })
    return null
  }
  for (const key of Object.keys(fileSystem)) {
    if (!FILE_SYSTEM_KEYS.has(key)) details.push(`文件系统权限包含未知字段 ${key}`)
  }

  const profile: PermissionsApprovalFileSystemProfile = {}
  if ('read' in fileSystem) {
    const read = parsePathList(fileSystem.read, 'read', '读取路径', details, rows)
    if (read.ok) profile.read = read.value
  }
  if ('write' in fileSystem) {
    const write = parsePathList(fileSystem.write, 'write', '写入路径', details, rows)
    if (write.ok) profile.write = write.value
  }
  if ('globScanMaxDepth' in fileSystem) {
    const depth = fileSystem.globScanMaxDepth
    if (depth === undefined || depth === null) {
      profile.globScanMaxDepth = null
    } else if (isInteger(depth) && depth >= 1) {
      profile.globScanMaxDepth = depth
      rows.push({ label: '通配扫描深度', value: String(depth) })
    } else {
      details.push('通配扫描深度无法识别')
      rows.push({ label: '通配扫描深度', value: '无法识别' })
    }
  }
  if ('entries' in fileSystem) {
    const entries = parseEntries(fileSystem.entries, details, rows)
    if (entries.ok) profile.entries = entries.value
  }
  return profile
}

function parsePathList(
  raw: unknown,
  key: string,
  label: string,
  details: string[],
  rows: PermissionsApprovalRow[],
): Parsed<string[] | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null }
  if (!Array.isArray(raw)) {
    details.push(`字段 ${key} 结构无法识别`)
    rows.push({ label, value: '无法识别' })
    return { ok: false }
  }
  const paths: string[] = []
  for (const item of raw) {
    if (typeof item === 'string') {
      paths.push(item)
      rows.push({ label, value: item })
      continue
    }
    details.push(`${label}包含非文本项`)
    rows.push({ label, value: `${boundedText(item)}（无法识别）` })
  }
  return { ok: true, value: paths }
}

function parseEntries(
  raw: unknown,
  details: string[],
  rows: PermissionsApprovalRow[],
): Parsed<PermissionsApprovalEntry[] | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null }
  if (!Array.isArray(raw)) {
    details.push('字段 entries 结构无法识别')
    rows.push({ label: '范围项', value: '无法识别' })
    return { ok: false }
  }
  const entries: PermissionsApprovalEntry[] = []
  for (const item of raw) {
    const entry = asRecord(item)
    if (!entry) {
      details.push('范围项结构无法识别')
      rows.push({ label: '范围项', value: `${boundedText(item)}（无法识别）` })
      continue
    }
    for (const key of Object.keys(entry)) {
      if (!ENTRY_KEYS.has(key)) details.push(`范围项包含未知字段 ${key}`)
    }
    const path = parseEntryPath(entry.path, details)
    const access = entry.access
    const accessRecognized = typeof access === 'string' && ACCESS_MODES.has(access)
    if (!accessRecognized) details.push(`范围项权限无法识别 ${boundedText(access)}`)
    rows.push({
      label: '范围项',
      value: `${path.ok ? path.value.display : 'path:无法识别'} · access:${accessRecognized ? String(access) : '无法识别'}`,
    })
    if (path.ok && accessRecognized) {
      entries.push({ path: path.value.path, access: access as PermissionsApprovalAccess })
    }
  }
  return { ok: true, value: entries }
}

function parseEntryPath(
  raw: unknown,
  details: string[],
): Parsed<{ path: PermissionsApprovalPath; display: string }> {
  if (raw === undefined) {
    details.push('范围项缺少必填字段 path')
    return { ok: false }
  }
  const path = asRecord(raw)
  if (!path) {
    details.push('范围项 path 结构无法识别')
    return { ok: false }
  }
  const type = typeof path.type === 'string' ? path.type : null
  const variantKeys = type === null ? undefined : PATH_VARIANT_KEYS.get(type)
  if (!variantKeys) {
    details.push(`范围项 path 类型无法识别 ${boundedText(path.type)}`)
    return { ok: false }
  }
  // Each union variant validates its own members: an unknown member must make the
  // request deny-only instead of being stripped and approved.
  for (const key of Object.keys(path)) {
    if (!variantKeys.has(key)) details.push(`范围项 path 包含未知字段 ${key}`)
  }
  if (type === 'path') {
    if (typeof path.path !== 'string') {
      details.push('范围项 path 值无法识别')
      return { ok: false }
    }
    return { ok: true, value: { path: { type: 'path', path: path.path }, display: `path:${path.path}` } }
  }
  if (type === 'glob_pattern') {
    if (typeof path.pattern !== 'string') {
      details.push('范围项 glob_pattern 值无法识别')
      return { ok: false }
    }
    return {
      ok: true,
      value: { path: { type: 'glob_pattern', pattern: path.pattern }, display: `glob_pattern:${path.pattern}` },
    }
  }
  const special = asRecord(path.value)
  if (!special) {
    details.push('范围项 special 结构无法识别')
    return { ok: false }
  }
  const kind = typeof special.kind === 'string' ? special.kind : null
  const allowedKeys = kind === null ? undefined : SPECIAL_KEYS.get(kind)
  if (!allowedKeys) {
    details.push(`范围项 special 类型无法识别 ${boundedText(special.kind)}`)
    return { ok: false }
  }
  for (const key of Object.keys(special)) {
    if (!allowedKeys.has(key)) details.push(`范围项 special 包含未知字段 ${key}`)
  }
  if (kind === 'root' || kind === 'minimal' || kind === 'tmpdir' || kind === 'slash_tmp') {
    return { ok: true, value: { path: { type: 'special', value: { kind } }, display: `special:${kind}` } }
  }
  const subpath = readSubpath(special, details)
  if (kind === 'project_roots') {
    return {
      ok: true,
      value: {
        path: { type: 'special', value: { kind: 'project_roots', subpath } },
        display: `special:project_roots(subpath=${subpath === null ? 'null' : subpath})`,
      },
    }
  }
  if (typeof special.path !== 'string') {
    details.push('范围项 special unknown 缺少 path')
    return { ok: false }
  }
  // Structurally known, but an unknown special root must never become grantable.
  details.push(`范围项 special unknown 无法授权 ${special.path}`)
  return {
    ok: true,
    value: {
      path: { type: 'special', value: { kind: 'unknown', path: special.path, subpath } },
      display: `special:unknown(path=${special.path} subpath=${subpath === null ? 'null' : subpath})`,
    },
  }
}

function readSubpath(special: Record<string, unknown>, details: string[]): string | null {
  const subpath = special.subpath
  if (subpath === undefined || subpath === null) return null
  if (typeof subpath === 'string') return subpath
  details.push('范围项 special subpath 无法识别')
  return null
}

function finish(
  details: string[],
  rows: PermissionsApprovalRow[],
  grant: PermissionsApprovalGrantedProfile,
): PermissionsApprovalRequestAnalysis {
  if (details.length > 0) rows.push({ label: '未识别项', value: details.join('；') })
  return { recognized: details.length === 0, details, rows, grant }
}

function fallbackHeaderRow(): PermissionsApprovalRow {
  return { label: '权限范围', value: '无法识别' }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

function boundedText(value: unknown): string {
  const text = typeof value === 'string'
    ? value
    : (() => {
      try {
        return JSON.stringify(value) ?? String(value)
      } catch {
        return String(value)
      }
    })()
  return text.length > 120 ? `${text.slice(0, 120)}…` : text
}

function definedKeys(record: Record<string, unknown>): string[] {
  return Object.keys(record).filter((key) => record[key] !== undefined)
}

function isDeepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false
    if (left.length !== right.length) return false
    return left.every((item, index) => isDeepEqual(item, right[index]))
  }
  const leftRecord = asRecord(left)
  const rightRecord = asRecord(right)
  if (!leftRecord || !rightRecord) return false
  const leftKeys = definedKeys(leftRecord)
  const rightKeys = definedKeys(rightRecord)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => (
    Object.prototype.hasOwnProperty.call(rightRecord, key)
    && isDeepEqual(leftRecord[key], rightRecord[key])
  ))
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as unknown as T
  const record = asRecord(value)
  if (!record) return value
  const copy: Record<string, unknown> = {}
  for (const key of Object.keys(record)) {
    if (record[key] !== undefined) copy[key] = cloneValue(record[key])
  }
  return copy as unknown as T
}
