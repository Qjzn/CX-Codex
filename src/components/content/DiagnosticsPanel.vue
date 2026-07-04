<template>
  <div class="diagnostics-panel" :data-tone="overallTone">
    <div class="diagnostics-toolbar">
      <div class="diagnostics-status">
        <span class="diagnostics-status-dot" aria-hidden="true" />
        <span>{{ overallLabel }}</span>
      </div>
      <div class="diagnostics-actions">
        <span v-if="lastLoadedLabel" class="diagnostics-updated">{{ lastLoadedLabel }}</span>
        <button class="diagnostics-refresh" type="button" :disabled="isLoading" @click="onRefreshClick">
          {{ isLoading ? '刷新中...' : '刷新' }}
        </button>
      </div>
    </div>

    <p v-if="error" class="diagnostics-error">{{ error }}</p>

    <div class="diagnostics-grid">
      <section class="diagnostics-section">
        <div class="diagnostics-section-header">
          <h2>后端服务</h2>
          <span class="diagnostics-badge" :data-tone="appServerTone">{{ appServerLabel }}</span>
        </div>
        <dl class="diagnostics-kv">
          <div>
            <dt>PID</dt>
            <dd>{{ appServer.pid ?? '未启动' }}</dd>
          </div>
          <div>
            <dt>RPC</dt>
            <dd>{{ appServer.pendingRpcCount }} 处理中 / {{ appServer.queuedRpcCount }} 排队</dd>
          </div>
          <div>
            <dt>权限请求</dt>
            <dd>{{ appServer.pendingServerRequestCount }}</dd>
          </div>
          <div>
            <dt>计划模式</dt>
            <dd>{{ appServer.activePlanModeTurnCount }}</dd>
          </div>
          <div>
            <dt>策略</dt>
            <dd class="diagnostics-mono">{{ launchPolicyLabel }}</dd>
          </div>
        </dl>
      </section>

      <section class="diagnostics-section">
        <div class="diagnostics-section-header">
          <h2>Runtime Store</h2>
          <span class="diagnostics-badge" :data-tone="runtimeTone">{{ runtimeLabel }}</span>
        </div>
        <dl class="diagnostics-kv">
          <div>
            <dt>数据库</dt>
            <dd class="diagnostics-mono">{{ runtimeStore.path || '-' }}</dd>
          </div>
          <div>
            <dt>请求</dt>
            <dd>{{ runtimeStore.requestCount }}</dd>
          </div>
          <div>
            <dt>快照</dt>
            <dd>{{ runtimeStore.snapshotCount }}</dd>
          </div>
          <div>
            <dt>事件游标</dt>
            <dd>{{ runtimeStore.oldestSeq }} - {{ runtimeStore.latestSeq }}</dd>
          </div>
        </dl>
      </section>

      <section class="diagnostics-section">
        <div class="diagnostics-section-header">
          <h2>语音转写</h2>
          <span class="diagnostics-badge" :data-tone="transcriptionTone">{{ transcriptionLabel }}</span>
        </div>
        <dl class="diagnostics-kv">
          <div>
            <dt>模型</dt>
            <dd class="diagnostics-mono">{{ transcription.model || '-' }}</dd>
          </div>
          <div>
            <dt>响应</dt>
            <dd>{{ transcription.responseFormat }}</dd>
          </div>
          <div>
            <dt>上限</dt>
            <dd>{{ transcription.requestBodyLimitMiB }} MiB</dd>
          </div>
          <div>
            <dt>Endpoint</dt>
            <dd class="diagnostics-mono">{{ transcriptionEndpointLabel }}</dd>
          </div>
        </dl>
      </section>

      <section class="diagnostics-section">
        <div class="diagnostics-section-header">
          <h2>协议审计</h2>
          <span class="diagnostics-badge" :data-tone="schemaAuditTone">{{ schemaAuditLabel }}</span>
        </div>
        <dl class="diagnostics-kv">
          <div>
            <dt>生成时间</dt>
            <dd>{{ schemaAudit.generatedAtIso ? formatTime(schemaAudit.generatedAtIso) : '-' }}</dd>
          </div>
          <div>
            <dt>新增 / 移除</dt>
            <dd>{{ schemaAudit.totals.addedCount }} / {{ schemaAudit.totals.removedCount }}</dd>
          </div>
          <div>
            <dt>命令</dt>
            <dd class="diagnostics-mono">{{ schemaAudit.auditCommand || '-' }}</dd>
          </div>
          <div>
            <dt>文档</dt>
            <dd class="diagnostics-mono">{{ schemaAudit.officialDocsUrl || '-' }}</dd>
          </div>
        </dl>
        <ul class="diagnostics-mini-list">
          <li v-for="row in schemaAuditRows" :key="row.key">
            <span>{{ row.label }}</span>
            <strong>{{ row.generatedCount }}</strong>
            <small>+{{ row.addedCount }} / -{{ row.removedCount }}</small>
          </li>
        </ul>
      </section>
    </div>

    <section class="diagnostics-section diagnostics-section-wide">
      <div class="diagnostics-section-header">
        <h2>权限请求队列</h2>
        <span class="diagnostics-badge" :data-tone="pendingServerRequests.length > 0 ? 'warning' : 'ok'">
          {{ pendingServerRequests.length }} 个待处理
        </span>
      </div>
      <div v-if="pendingServerRequests.length === 0" class="diagnostics-empty">
        当前没有 App Server permission、approval 或 elicitation 请求。
      </div>
      <div v-else class="diagnostics-table-wrap">
        <table class="diagnostics-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>方法</th>
              <th>类型</th>
              <th>等待</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="request in pendingServerRequests" :key="request.id">
              <td class="diagnostics-mono">#{{ request.id }}</td>
              <td class="diagnostics-mono">{{ request.method }}</td>
              <td>{{ formatServerRequestKind(request.kind) }}</td>
              <td>{{ formatAge(request.receivedAtIso) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="diagnostics-section diagnostics-section-wide">
      <div class="diagnostics-section-header">
        <h2>恢复队列</h2>
        <span class="diagnostics-badge" :data-tone="uncertainRequests.length > 0 ? 'warning' : 'ok'">
          {{ uncertainRequests.length }} 个不确定请求
        </span>
      </div>
      <div v-if="uncertainRequests.length === 0" class="diagnostics-empty">
        当前没有 pending、running、stopping 或 uncertain 请求。
      </div>
      <div v-else class="diagnostics-table-wrap">
        <table class="diagnostics-table">
          <thead>
            <tr>
              <th>状态</th>
              <th>线程</th>
              <th>Turn</th>
              <th>更新</th>
              <th>错误</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="request in uncertainRequests" :key="request.requestId">
              <td>{{ request.status }}</td>
              <td class="diagnostics-mono">{{ shortId(request.threadId) || '-' }}</td>
              <td class="diagnostics-mono">{{ shortId(request.turnId) || '-' }}</td>
              <td>{{ formatAge(request.updatedAtIso) }}</td>
              <td>{{ request.lastError || '-' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <div class="diagnostics-grid">
      <section class="diagnostics-section">
        <div class="diagnostics-section-header">
          <h2>慢 RPC</h2>
          <span class="diagnostics-badge" :data-tone="slowRpcCalls.length > 0 ? 'warning' : 'ok'">
            {{ slowRpcCalls.length }}
          </span>
        </div>
        <div v-if="slowRpcCalls.length === 0" class="diagnostics-empty">最近没有慢 RPC 记录。</div>
        <ul v-else class="diagnostics-list">
          <li v-for="rpc in slowRpcCalls" :key="`${rpc.method}-${rpc.atIso}`">
            <span>{{ rpc.method }}</span>
            <strong>{{ rpc.durationMs }}ms</strong>
            <small>{{ formatAge(rpc.atIso) }}</small>
          </li>
        </ul>
      </section>

      <section class="diagnostics-section">
        <div class="diagnostics-section-header">
          <h2>最近事件</h2>
          <span class="diagnostics-badge" data-tone="neutral">{{ recentEvents.length }}</span>
        </div>
        <div v-if="recentEvents.length === 0" class="diagnostics-empty">暂无 runtime 事件。</div>
        <ul v-else class="diagnostics-list">
          <li v-for="event in recentEvents" :key="event.seq">
            <span>{{ event.method }}</span>
            <strong>#{{ event.seq }}</strong>
            <small>{{ formatAge(event.atIso) }}</small>
          </li>
        </ul>
      </section>

      <section class="diagnostics-section">
        <div class="diagnostics-section-header">
          <h2>模型通知</h2>
          <span class="diagnostics-badge" data-tone="neutral">{{ recentModelNotifications.length }}</span>
        </div>
        <div v-if="recentModelNotifications.length === 0" class="diagnostics-empty">暂无模型 reroute 或 verification 通知。</div>
        <ul v-else class="diagnostics-list">
          <li v-for="notification in recentModelNotifications" :key="`${notification.method}-${notification.atIso}-${notification.threadId}-${notification.turnId}`">
            <span>{{ formatModelNotification(notification) }}</span>
            <strong>{{ shortId(notification.turnId) || '-' }}</strong>
            <small>{{ formatAge(notification.atIso) }}</small>
          </li>
        </ul>
      </section>

      <section class="diagnostics-section">
        <div class="diagnostics-section-header">
          <h2>未知通知</h2>
          <span class="diagnostics-badge" :data-tone="unknownNotificationCount > 0 ? 'warning' : 'ok'">
            {{ unknownNotificationCount }}
          </span>
        </div>
        <div v-if="unknownNotifications.length === 0" class="diagnostics-empty">暂无未知 App Server notification。</div>
        <ul v-else class="diagnostics-list">
          <li v-for="notification in unknownNotifications" :key="notification.method">
            <span>{{ notification.method }}</span>
            <strong>{{ notification.count }}</strong>
            <small>{{ formatAge(notification.lastSeenAtIso) }}</small>
          </li>
        </ul>
      </section>

      <section class="diagnostics-section">
        <div class="diagnostics-section-header">
          <h2>未知状态</h2>
          <span class="diagnostics-badge" :data-tone="unknownStatusCount > 0 ? 'warning' : 'ok'">
            {{ unknownStatusCount }}
          </span>
        </div>
        <div v-if="unknownStatuses.length === 0" class="diagnostics-empty">暂无未知 App Server status。</div>
        <ul v-else class="diagnostics-list">
          <li v-for="status in unknownStatuses" :key="`${status.source}-${status.normalizedValue}`">
            <span>{{ status.source }}: {{ status.value }}</span>
            <strong>{{ status.count }}</strong>
            <small>{{ formatAge(status.lastSeenAtIso) }}</small>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

type Tone = 'ok' | 'warning' | 'danger' | 'neutral'

type SlowRpcRecord = {
  method: string
  atIso: string
  durationMs: number
  outcome: string
}

type AppServerDiagnostics = {
  running: boolean
  initialized: boolean
  stopping: boolean
  pid: number | null
  pendingRpcCount: number
  queuedRpcCount: number
  pendingServerRequestCount: number
  activePlanModeTurnCount: number
  launchPolicy?: {
    approvalPolicy: string
    sandboxMode: string
    legacyHighTrust: boolean
  }
  rpcDiagnostics?: {
    recentSlowRpc?: SlowRpcRecord[]
    recentTimeouts?: Array<{ method?: string; atIso?: string }>
  }
}

type RuntimeStoreDiagnostics = {
  path: string
  requestCount: number
  uncertainRequestCount: number
  latestSeq: number
  oldestSeq: number
  snapshotCount: number
}

type RuntimeRequestDiagnostics = {
  requestId: string
  clientMessageId: string
  threadId: string
  turnId: string
  status: string
  retryCount: number
  updatedAtIso: string
  lastError: string | null
}

type RuntimeEventDiagnostics = {
  seq: number
  method: string
  atIso: string
  threadId: string
  turnId: string
}

type PendingServerRequestDiagnostics = {
  id: number
  method: string
  kind: 'permission' | 'approval' | 'elicitation' | 'tool' | 'request'
  receivedAtIso: string
}

type ServerRequestDiagnostics = {
  pendingRequestCount: number
  pendingByKind: Record<PendingServerRequestDiagnostics['kind'], number>
  pendingRequests: PendingServerRequestDiagnostics[]
}

type UnknownNotificationDiagnostics = {
  method: string
  count: number
  firstSeenAtIso: string
  lastSeenAtIso: string
  threadId: string
  turnId: string
}

type ModelNotificationDiagnostics = {
  method: 'model/rerouted' | 'model/verification'
  atIso: string
  threadId: string
  turnId: string
  fromModel: string
  toModel: string
  reason: string
  verificationCount: number
  verifications: string[]
}

type UnknownStatusDiagnostics = {
  source: string
  value: string
  normalizedValue: string
  count: number
  firstSeenAtIso: string
  lastSeenAtIso: string
  threadId: string
}

type TranscriptionDiagnostics = {
  provider: 'openai' | 'chatgpt'
  officialApiConfigured: boolean
  model: string
  responseFormat: 'json' | 'diarized_json'
  requestBodyLimitBytes: number
  requestBodyLimitMiB: number
  endpoint: {
    isDefault: boolean
    host: string
    path: string
  }
}

type SchemaAuditComparisonRecord = {
  baselineCount: number
  generatedCount: number
  addedCount: number
  removedCount: number
  representativeAdded: string[]
  representativeRemoved: string[]
}

type SchemaAuditDiagnostics = {
  available: boolean
  generatedAtIso: string
  officialDocsUrl: string
  auditCommand: string
  auditOutput: string
  reviewStatus: string
  comparison: {
    typescriptRoot: SchemaAuditComparisonRecord
    typescriptV2: SchemaAuditComparisonRecord
    jsonRoot: SchemaAuditComparisonRecord
    jsonV2: SchemaAuditComparisonRecord
  }
  totals: {
    addedCount: number
    removedCount: number
  }
  error: string
}

type DiagnosticsData = {
  appServer: AppServerDiagnostics
  notificationDiagnostics?: {
    unknownNotificationCount: number
    recentUnknownNotifications: UnknownNotificationDiagnostics[]
    recentModelNotifications?: ModelNotificationDiagnostics[]
  }
  statusDiagnostics?: {
    unknownStatusCount: number
    recentUnknownStatuses: UnknownStatusDiagnostics[]
  }
  serverRequestDiagnostics?: ServerRequestDiagnostics
  schemaAudit?: SchemaAuditDiagnostics
  transcription?: TranscriptionDiagnostics
  runtimeStore: RuntimeStoreDiagnostics
  runtime: {
    uncertainRequests: RuntimeRequestDiagnostics[]
    recentEvents: RuntimeEventDiagnostics[]
  }
  pendingServerRequests?: PendingServerRequestDiagnostics[]
  timestamp: string
}

const emptyAppServer: AppServerDiagnostics = {
  running: false,
  initialized: false,
  stopping: false,
  pid: null,
  pendingRpcCount: 0,
  queuedRpcCount: 0,
  pendingServerRequestCount: 0,
  activePlanModeTurnCount: 0,
  launchPolicy: {
    approvalPolicy: 'never',
    sandboxMode: 'danger-full-access',
    legacyHighTrust: true,
  },
}

const emptyRuntimeStore: RuntimeStoreDiagnostics = {
  path: '',
  requestCount: 0,
  uncertainRequestCount: 0,
  latestSeq: 0,
  oldestSeq: 0,
  snapshotCount: 0,
}

const emptyTranscription: TranscriptionDiagnostics = {
  provider: 'chatgpt',
  officialApiConfigured: false,
  model: 'gpt-4o-transcribe',
  responseFormat: 'json',
  requestBodyLimitBytes: 26 * 1024 * 1024,
  requestBodyLimitMiB: 26,
  endpoint: {
    isDefault: true,
    host: 'api.openai.com',
    path: '/v1/audio/transcriptions',
  },
}

const emptySchemaAuditRecord: SchemaAuditComparisonRecord = {
  baselineCount: 0,
  generatedCount: 0,
  addedCount: 0,
  removedCount: 0,
  representativeAdded: [],
  representativeRemoved: [],
}

const emptySchemaAudit: SchemaAuditDiagnostics = {
  available: false,
  generatedAtIso: '',
  officialDocsUrl: '',
  auditCommand: '',
  auditOutput: '',
  reviewStatus: 'unavailable',
  comparison: {
    typescriptRoot: emptySchemaAuditRecord,
    typescriptV2: emptySchemaAuditRecord,
    jsonRoot: emptySchemaAuditRecord,
    jsonV2: emptySchemaAuditRecord,
  },
  totals: {
    addedCount: 0,
    removedCount: 0,
  },
  error: '',
}

const diagnostics = ref<DiagnosticsData | null>(null)
const error = ref('')
const isLoading = ref(false)
let refreshTimer: number | null = null

const appServer = computed(() => diagnostics.value?.appServer ?? emptyAppServer)
const runtimeStore = computed(() => diagnostics.value?.runtimeStore ?? emptyRuntimeStore)
const transcription = computed(() => diagnostics.value?.transcription ?? emptyTranscription)
const schemaAudit = computed(() => diagnostics.value?.schemaAudit ?? emptySchemaAudit)
const uncertainRequests = computed(() => diagnostics.value?.runtime.uncertainRequests ?? [])
const recentEvents = computed(() => diagnostics.value?.runtime.recentEvents ?? [])
const pendingServerRequests = computed(() => (
  diagnostics.value?.serverRequestDiagnostics?.pendingRequests
  ?? diagnostics.value?.pendingServerRequests
  ?? []
))
const slowRpcCalls = computed(() => appServer.value.rpcDiagnostics?.recentSlowRpc ?? [])
const timeoutCount = computed(() => appServer.value.rpcDiagnostics?.recentTimeouts?.length ?? 0)
const unknownNotifications = computed(() => diagnostics.value?.notificationDiagnostics?.recentUnknownNotifications ?? [])
const unknownNotificationCount = computed(() => diagnostics.value?.notificationDiagnostics?.unknownNotificationCount ?? 0)
const recentModelNotifications = computed(() => diagnostics.value?.notificationDiagnostics?.recentModelNotifications ?? [])
const unknownStatuses = computed(() => diagnostics.value?.statusDiagnostics?.recentUnknownStatuses ?? [])
const unknownStatusCount = computed(() => diagnostics.value?.statusDiagnostics?.unknownStatusCount ?? 0)

const launchPolicyLabel = computed(() => {
  const policy = appServer.value.launchPolicy
  if (!policy) return '-'
  const suffix = policy.legacyHighTrust ? ' / high-trust' : ''
  return `${policy.approvalPolicy} / ${policy.sandboxMode}${suffix}`
})

const appServerTone = computed<Tone>(() => {
  if (!appServer.value.running || !appServer.value.initialized || appServer.value.stopping) return 'danger'
  if (appServer.value.pendingRpcCount > 0 || appServer.value.queuedRpcCount > 0 || timeoutCount.value > 0) return 'warning'
  return 'ok'
})

const runtimeTone = computed<Tone>(() => (
  runtimeStore.value.uncertainRequestCount > 0 ? 'warning' : 'ok'
))

const transcriptionTone = computed<Tone>(() => (
  transcription.value.officialApiConfigured ? 'ok' : 'neutral'
))

const schemaAuditTone = computed<Tone>(() => {
  if (!schemaAudit.value.available) return 'danger'
  if (schemaAudit.value.reviewStatus === 'drift-recorded') return 'warning'
  return 'ok'
})

const overallTone = computed<Tone>(() => {
  if (appServerTone.value === 'danger') return 'danger'
  if (
    appServerTone.value === 'warning'
    || runtimeTone.value === 'warning'
    || schemaAuditTone.value === 'warning'
    || schemaAuditTone.value === 'danger'
    || pendingServerRequests.value.length > 0
    || unknownNotificationCount.value > 0
    || unknownStatusCount.value > 0
  ) return 'warning'
  return 'ok'
})

const overallLabel = computed(() => {
  if (overallTone.value === 'danger') return '服务异常'
  if (overallTone.value === 'warning') return '需要关注'
  return '运行正常'
})

const appServerLabel = computed(() => {
  if (!appServer.value.running) return '未运行'
  if (appServer.value.stopping) return '停止中'
  if (!appServer.value.initialized) return '初始化中'
  return '已连接'
})

const runtimeLabel = computed(() => (
  runtimeStore.value.uncertainRequestCount > 0
    ? `${runtimeStore.value.uncertainRequestCount} 个待收敛`
    : '已收敛'
))

const transcriptionLabel = computed(() => (
  transcription.value.provider === 'openai' ? '官方 API' : '登录态回退'
))

const transcriptionEndpointLabel = computed(() => {
  const endpoint = transcription.value.endpoint
  const marker = endpoint.isDefault ? '默认' : '自定义'
  return `${marker} ${endpoint.host}${endpoint.path}`
})

const schemaAuditLabel = computed(() => {
  if (!schemaAudit.value.available) return '不可用'
  if (schemaAudit.value.reviewStatus === 'drift-recorded') return '差异已记录'
  return schemaAudit.value.reviewStatus || '已记录'
})

const schemaAuditRows = computed(() => [
  { key: 'typescriptRoot', label: 'TS root', ...schemaAudit.value.comparison.typescriptRoot },
  { key: 'typescriptV2', label: 'TS v2', ...schemaAudit.value.comparison.typescriptV2 },
  { key: 'jsonRoot', label: 'JSON root', ...schemaAudit.value.comparison.jsonRoot },
  { key: 'jsonV2', label: 'JSON v2', ...schemaAudit.value.comparison.jsonV2 },
])

const lastLoadedLabel = computed(() => (
  diagnostics.value?.timestamp ? `更新于 ${formatTime(diagnostics.value.timestamp)}` : ''
))

onMounted(() => {
  void loadDiagnostics()
  refreshTimer = window.setInterval(() => {
    void loadDiagnostics({ silent: true })
  }, 15_000)
})

onUnmounted(() => {
  if (refreshTimer) {
    window.clearInterval(refreshTimer)
    refreshTimer = null
  }
})

async function loadDiagnostics(options: { silent?: boolean } = {}): Promise<void> {
  if (!options.silent) {
    isLoading.value = true
  }
  error.value = ''
  try {
    const response = await fetch('/codex-api/diagnostics')
    const payload = await response.json() as { data?: DiagnosticsData; error?: string }
    if (!response.ok || !payload.data) {
      throw new Error(payload.error || `HTTP ${response.status}`)
    }
    diagnostics.value = payload.data
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    if (!options.silent) {
      isLoading.value = false
    }
  }
}

function onRefreshClick(): void {
  void loadDiagnostics()
}

function shortId(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return trimmed.length <= 12 ? trimmed : trimmed.slice(0, 8)
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatServerRequestKind(kind: PendingServerRequestDiagnostics['kind']): string {
  if (kind === 'permission') return '权限'
  if (kind === 'approval') return '审批'
  if (kind === 'elicitation') return '补充信息'
  if (kind === 'tool') return '工具'
  return '请求'
}

function formatModelNotification(notification: ModelNotificationDiagnostics): string {
  if (notification.method === 'model/rerouted') {
    const fromModel = notification.fromModel || '-'
    const toModel = notification.toModel || '-'
    const reason = notification.reason ? ` (${notification.reason})` : ''
    return `${fromModel} -> ${toModel}${reason}`
  }
  const verificationLabel = notification.verifications.length > 0
    ? notification.verifications.join(', ')
    : `${notification.verificationCount} checks`
  return verificationLabel || 'verification'
}

function formatAge(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value || '-'
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  return `${hours}h`
}
</script>

<style scoped>
@reference "tailwindcss";

.diagnostics-panel {
  @apply mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4 text-slate-900;
}

.diagnostics-toolbar {
  @apply flex items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white px-4 py-3 shadow-sm;
}

.diagnostics-status,
.diagnostics-actions {
  @apply flex items-center gap-2;
}

.diagnostics-status {
  @apply text-sm font-semibold;
}

.diagnostics-status-dot {
  @apply h-2.5 w-2.5 rounded-full bg-emerald-600;
}

.diagnostics-panel[data-tone="warning"] .diagnostics-status-dot {
  @apply bg-amber-500;
}

.diagnostics-panel[data-tone="danger"] .diagnostics-status-dot {
  @apply bg-red-600;
}

.diagnostics-updated {
  @apply text-xs text-slate-500;
}

.diagnostics-refresh {
  @apply rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm font-semibold text-slate-800 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60;
}

.diagnostics-error {
  @apply rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700;
}

.diagnostics-grid {
  @apply grid gap-4 md:grid-cols-2;
}

.diagnostics-section {
  @apply rounded-lg border border-stone-200 bg-white p-4 shadow-sm;
}

.diagnostics-section-wide {
  @apply w-full;
}

.diagnostics-section-header {
  @apply mb-3 flex items-center justify-between gap-3;
}

.diagnostics-section-header h2 {
  @apply text-base font-semibold text-slate-950;
}

.diagnostics-badge {
  @apply rounded-full border px-2.5 py-1 text-xs font-semibold;
}

.diagnostics-badge[data-tone="ok"] {
  @apply border-emerald-200 bg-emerald-50 text-emerald-700;
}

.diagnostics-badge[data-tone="warning"] {
  @apply border-amber-200 bg-amber-50 text-amber-700;
}

.diagnostics-badge[data-tone="danger"] {
  @apply border-red-200 bg-red-50 text-red-700;
}

.diagnostics-badge[data-tone="neutral"] {
  @apply border-stone-200 bg-stone-50 text-slate-600;
}

.diagnostics-kv {
  @apply grid gap-2;
}

.diagnostics-kv div {
  @apply flex min-w-0 items-center justify-between gap-3 border-t border-stone-100 pt-2 first:border-t-0 first:pt-0;
}

.diagnostics-kv dt {
  @apply shrink-0 text-sm text-slate-500;
}

.diagnostics-kv dd {
  @apply min-w-0 truncate text-right text-sm font-semibold text-slate-900;
}

.diagnostics-mono {
  @apply font-mono text-xs;
}

.diagnostics-empty {
  @apply rounded-md bg-stone-50 px-3 py-3 text-sm text-slate-500;
}

.diagnostics-table-wrap {
  @apply overflow-x-auto;
}

.diagnostics-table {
  @apply min-w-full text-left text-sm;
}

.diagnostics-table th {
  @apply border-b border-stone-200 px-3 py-2 text-xs font-semibold uppercase tracking-normal text-slate-500;
}

.diagnostics-table td {
  @apply border-b border-stone-100 px-3 py-2 align-top text-slate-800;
}

.diagnostics-list {
  @apply flex flex-col gap-2;
}

.diagnostics-list li {
  @apply grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-md bg-stone-50 px-3 py-2 text-sm;
}

.diagnostics-list span {
  @apply min-w-0 truncate text-slate-800;
}

.diagnostics-list strong {
  @apply font-mono text-xs text-slate-900;
}

.diagnostics-list small {
  @apply text-xs text-slate-500;
}

.diagnostics-mini-list {
  @apply mt-3 grid gap-2;
}

.diagnostics-mini-list li {
  @apply grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-md bg-stone-50 px-3 py-2 text-xs;
}

.diagnostics-mini-list span {
  @apply min-w-0 truncate text-slate-700;
}

.diagnostics-mini-list strong {
  @apply font-mono text-slate-950;
}

.diagnostics-mini-list small {
  @apply font-mono text-slate-500;
}

@media (max-width: 640px) {
  .diagnostics-panel {
    @apply gap-3 px-3 py-3;
  }

  .diagnostics-toolbar {
    @apply items-start px-3 py-3;
  }

  .diagnostics-actions {
    @apply flex-col items-end gap-1;
  }

  .diagnostics-section {
    @apply p-3;
  }
}
</style>
