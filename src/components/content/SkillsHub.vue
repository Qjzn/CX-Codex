<template>
  <div class="skills-hub">
    <div class="skills-hub-header">
      <div class="skills-hub-heading">
        <h2 class="skills-hub-title">技能中心</h2>
        <p class="skills-hub-subtitle">安装、管理并发现 GitHub 上的 Codex 技能</p>
      </div>
      <button class="skills-hub-sort" type="button" @click="isSyncOpen = !isSyncOpen">
        {{ isSyncOpen ? '收起同步' : '同步设置' }}
      </button>
    </div>

    <div v-if="isSyncOpen" class="skills-sync-panel">
      <div class="skills-sync-header">
        <strong>技能同步（GitHub）</strong>
        <a
          v-if="syncStatus.configured && githubRepoUrl"
          class="skills-sync-badge skills-sync-badge-link"
          :href="githubRepoUrl"
          target="_blank"
          rel="noopener noreferrer"
        >
          已连接：{{ syncStatus.repoOwner }}/{{ syncStatus.repoName }}
        </a>
        <span v-else-if="syncStatus.loggedIn" class="skills-sync-badge">已登录：{{ syncStatus.githubUsername }}</span>
        <span v-else class="skills-sync-badge">未连接</span>
      </div>
      <div class="skills-sync-meta">
        <span>启动：{{ syncStatus.startup.mode }}</span>
        <span>分支：{{ syncStatus.startup.branch }}</span>
        <span>动作：{{ syncStatus.startup.lastAction }}</span>
      </div>
      <div v-if="syncStatus.startup.lastError" class="skills-sync-error">
        {{ syncStatus.startup.lastError }}
      </div>
      <div v-if="syncActionStatus" class="skills-sync-meta">
        <span>手动同步：{{ syncActionStatus }}</span>
      </div>
      <div v-if="syncActionError" class="skills-sync-error">
        {{ syncActionError }}
      </div>
      <div v-if="deviceLogin" class="skills-sync-device">
        <span>打开 <a :href="deviceLogin.verification_uri" target="_blank" rel="noreferrer">GitHub 设备登录页</a> 并输入代码：</span>
        <code>{{ deviceLogin.user_code }}</code>
      </div>
      <div class="skills-sync-actions">
        <button v-if="!syncStatus.loggedIn" class="skills-hub-sort" type="button" @click="startGithubLogin">设备登录</button>
        <button v-if="syncStatus.loggedIn" class="skills-hub-sort" type="button" @click="logoutGithub" :disabled="isSyncActionInFlight">退出 GitHub</button>
        <button class="skills-hub-sort" type="button" @click="startupSkillsSync" :disabled="isSyncActionInFlight">{{ isStartupSyncInFlight ? '同步中...' : '启动同步' }}</button>
        <button class="skills-hub-sort" type="button" @click="pullSkillsSync" :disabled="isSyncActionInFlight">{{ isPullInFlight ? '拉取中...' : '拉取' }}</button>
        <button v-if="syncStatus.loggedIn" class="skills-hub-sort" type="button" @click="pushSkillsSync" :disabled="!syncStatus.configured || isSyncActionInFlight">{{ isPushInFlight ? '推送中...' : '推送' }}</button>
      </div>
    </div>

    <div v-if="toast" class="skills-hub-toast" :class="toastClass">{{ toast.text }}</div>

    <div class="skills-hub-toolbar">
      <div class="skills-market-tabs" role="tablist" aria-label="技能市场">
        <button
          class="skills-market-tab"
          :class="{ 'is-active': marketMode === 'hub' }"
          type="button"
          role="tab"
          :aria-selected="marketMode === 'hub'"
          @click="selectMarket('hub')"
        >
          默认市场
        </button>
        <button
          class="skills-market-tab"
          :class="{ 'is-active': marketMode === 'github' }"
          type="button"
          role="tab"
          :aria-selected="marketMode === 'github'"
          @click="selectMarket('github')"
        >
          GitHub 热门
        </button>
      </div>
      <div class="skills-hub-search-wrap">
        <IconTablerSearch class="skills-hub-search-icon" />
        <input
          ref="searchRef"
          v-model="query"
          class="skills-hub-search"
          type="text"
          :placeholder="marketMode === 'github' ? '搜索 GitHub 热门技能...' : '搜索技能...'"
          @keyup.enter.prevent="onSearchSubmit"
        />
        <button class="skills-hub-search-btn" type="button" @click="onSearchSubmit">搜索</button>
        <span v-if="totalCount > 0" class="skills-hub-count">{{ totalCount }} 个技能</span>
      </div>
      <button v-if="marketMode === 'hub'" class="skills-hub-sort" type="button" @click="toggleSort">
        {{ sortLabel }}
      </button>
    </div>

    <div v-if="filteredInstalled.length > 0" class="skills-hub-section">
      <button class="skills-hub-section-toggle" type="button" @click="isInstalledOpen = !isInstalledOpen">
        <span class="skills-hub-section-title">已安装（{{ filteredInstalled.length }}）</span>
        <IconTablerChevronRight class="skills-hub-section-chevron" :class="{ 'is-open': isInstalledOpen }" />
      </button>
      <div v-if="isInstalledOpen" class="skills-hub-grid">
        <SkillCard
          v-for="skill in filteredInstalled"
          :key="skill.name"
          :skill="skill"
          @select="(skill) => openDetail(skill as HubSkill)"
        />
      </div>
    </div>

    <div class="skills-hub-section">
      <div
        v-if="isLoading && !hasSkillsContent"
        class="skills-hub-grid skills-hub-skeleton-grid"
        role="status"
        aria-label="正在加载技能"
      >
        <article v-for="index in 6" :key="index" class="skills-hub-skeleton-card" aria-hidden="true">
          <span class="skills-hub-skeleton-line skills-hub-skeleton-line--title" />
          <span class="skills-hub-skeleton-line" />
          <span class="skills-hub-skeleton-line skills-hub-skeleton-line--short" />
          <span class="skills-hub-skeleton-action" />
        </article>
      </div>
      <div v-else-if="error && !hasSkillsContent" class="skills-hub-error">{{ error }}</div>
      <template v-else>
        <div v-if="isLoading" class="skills-hub-refreshing" role="status" aria-live="polite">
          正在更新技能列表，当前结果仍可使用…
        </div>
        <div v-if="error" class="skills-hub-cache-warning" role="status">
          更新失败，已保留上次结果：{{ error }}
        </div>
        <div v-if="browseSkills.length > 0" class="skills-hub-grid">
          <SkillCard
            v-for="skill in browseSkills"
            :key="skill.url"
            :skill="skill"
            @select="(skill) => openDetail(skill as HubSkill)"
          />
        </div>
        <div v-else-if="activeQuery.trim()" class="skills-hub-empty">没有找到与“{{ activeQuery }}”相关的技能</div>
        <div v-else class="skills-hub-empty">暂未发现可安装技能</div>
      </template>
    </div>

    <SkillDetailModal
      :skill="detailSkill"
      :visible="isDetailOpen"
      :is-installing="isDetailInstalling"
      :is-uninstalling="isDetailUninstalling"
      @close="isDetailOpen = false"
      @install="handleInstall"
      @uninstall="handleUninstall"
      @toggle-enabled="handleToggleEnabled"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import IconTablerSearch from '../icons/IconTablerSearch.vue'
import IconTablerChevronRight from '../icons/IconTablerChevronRight.vue'
import SkillCard from './SkillCard.vue'
import SkillDetailModal, { type HubSkill } from './SkillDetailModal.vue'
import { useGithubSkillsSync } from '../../composables/useGithubSkillsSync'

const EMPTY_SKILL: HubSkill = { name: '', owner: '', description: '', url: '', installed: false }
const SKILLS_HUB_CACHE_KEY = 'codex-web-local.skills-hub.cache.v1'
type SkillsHubPayload = { data: HubSkill[]; installed?: HubSkill[]; total: number }

const searchRef = ref<HTMLInputElement | null>(null)
const query = ref('')
const activeQuery = ref('')
const sortMode = ref<'date' | 'name'>('date')
const marketMode = ref<'hub' | 'github'>('hub')
const browseSkills = ref<HubSkill[]>([])
const installedSkills = ref<HubSkill[]>([])
const totalCount = ref(0)
const isLoading = ref(false)
const error = ref('')
const isInstalledOpen = ref(true)
const isSyncOpen = ref(false)
const isDetailOpen = ref(false)
const detailSkill = ref<HubSkill>(EMPTY_SKILL)
const toast = ref<{ text: string; type: 'success' | 'error' } | null>(null)
const actionSkillKey = ref('')
const isInstallActionInFlight = ref(false)
const isUninstallActionInFlight = ref(false)
const SYNC_STATUS_REFRESH_INTERVAL_MS = 8000
let toastTimer: ReturnType<typeof setTimeout> | null = null
let syncStatusTimer: number | null = null

const emit = defineEmits<{
  'skills-changed': []
}>()

const sortLabel = computed(() => sortMode.value === 'date' ? '最新发布' : '按名称')
const toastClass = computed(() => toast.value?.type === 'error' ? 'skills-hub-toast-error' : 'skills-hub-toast-success')
const currentDetailSkillKey = computed(() => `${detailSkill.value.owner}/${detailSkill.value.name}`)
const isDetailInstalling = computed(() =>
  isInstallActionInFlight.value && actionSkillKey.value === currentDetailSkillKey.value,
)
const isDetailUninstalling = computed(() =>
  isUninstallActionInFlight.value && actionSkillKey.value === currentDetailSkillKey.value,
)
const hasSkillsContent = computed(() => (
  browseSkills.value.length > 0 || installedSkills.value.length > 0
))
const githubRepoUrl = computed(() => {
  if (!syncStatus.value.configured) return ''
  const owner = syncStatus.value.repoOwner.trim()
  const repo = syncStatus.value.repoName.trim()
  if (!owner || !repo) return ''
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
})
const filteredInstalled = computed(() => {
  const q = query.value.toLowerCase().trim()
  if (!q) return installedSkills.value
  return installedSkills.value.filter((s) =>
    s.name.toLowerCase().includes(q) ||
    s.owner.toLowerCase().includes(q) ||
    (s.displayName ?? '').toLowerCase().includes(q),
  )
})

function showToast(text: string, type: 'success' | 'error' = 'success'): void {
  toast.value = { text, type }
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = null }, 3000)
}

function toggleSort(): void {
  sortMode.value = sortMode.value === 'date' ? 'name' : 'date'
  void fetchSkills(activeQuery.value)
}

function cacheKey(q: string): string {
  return `${marketMode.value}::${sortMode.value}::${q.trim().toLowerCase()}`
}

function readCache(key: string): SkillsHubPayload | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(SKILLS_HUB_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { byKey?: Record<string, SkillsHubPayload> }
    return parsed.byKey?.[key] ?? null
  } catch {
    return null
  }
}

function writeCache(key: string, payload: SkillsHubPayload): void {
  if (typeof window === 'undefined') return
  try {
    const raw = window.localStorage.getItem(SKILLS_HUB_CACHE_KEY)
    const parsed = raw ? (JSON.parse(raw) as { byKey?: Record<string, SkillsHubPayload> }) : {}
    const byKey = parsed.byKey ?? {}
    byKey[key] = payload
    window.localStorage.setItem(SKILLS_HUB_CACHE_KEY, JSON.stringify({ byKey }))
  } catch {
    // best-effort cache
  }
}

function clearCache(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(SKILLS_HUB_CACHE_KEY)
  } catch {
    // best-effort cache cleanup
  }
}

function applySkillsPayload(payload: SkillsHubPayload): void {
  const inst = payload.installed ?? []
  installedSkills.value = inst
  const installedNames = new Set(inst.map((s) => s.name))
  browseSkills.value = payload.data
    .map((s) => {
      if (s.installed || installedNames.has(s.name)) {
        const local = inst.find((i) => i.name === s.name)
        return { ...s, installed: true, path: local?.path ?? s.path, enabled: local?.enabled ?? s.enabled }
      }
      return s
    })
    .filter((s) => !s.installed)
  totalCount.value = payload.total
}

async function fetchSkills(q: string): Promise<void> {
  const normalizedQuery = q.trim()
  activeQuery.value = normalizedQuery
  const key = cacheKey(normalizedQuery)
  const cached = readCache(key)
  if (cached) {
    applySkillsPayload(cached)
  }
  isLoading.value = !cached
  error.value = ''
  try {
    const params = new URLSearchParams()
    if (normalizedQuery) params.set('q', normalizedQuery)
    params.set('limit', marketMode.value === 'github' ? '60' : '100')
    if (marketMode.value === 'hub') params.set('sort', sortMode.value)
    const endpoint = marketMode.value === 'github'
      ? '/codex-api/skills-hub/github-search'
      : '/codex-api/skills-hub'
    const resp = await fetch(`${endpoint}?${params}`)
    if (!resp.ok) {
      const payload = await resp.json().catch(() => null) as { error?: string } | null
      throw new Error(payload?.error || `HTTP ${resp.status}`)
    }
    const data = (await resp.json()) as SkillsHubPayload
    applySkillsPayload(data)
    writeCache(key, data)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载技能失败'
  } finally {
    isLoading.value = false
  }
}

function onSearchSubmit(): void {
  void fetchSkills(query.value)
}

function selectMarket(nextMarket: 'hub' | 'github'): void {
  if (marketMode.value === nextMarket) return
  marketMode.value = nextMarket
  void fetchSkills(query.value)
}

function openDetail(skill: HubSkill): void {
  detailSkill.value = skill
  isDetailOpen.value = true
}

async function handleInstall(skill: HubSkill): Promise<void> {
  actionSkillKey.value = `${skill.owner}/${skill.name}`
  isInstallActionInFlight.value = true
  try {
    const resp = await fetch('/codex-api/skills-hub/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        owner: skill.owner,
        name: skill.name,
        sourcePath: skill.sourcePath,
        repoSlug: skill.repoSlug,
        repoRef: skill.repoRef,
      }),
    })
    const data = (await resp.json()) as { ok?: boolean; error?: string }
    if (!data.ok) throw new Error(data.error || '安装失败')
    const installed = { ...skill, installed: true, path: undefined, enabled: true }
    installedSkills.value = [...installedSkills.value, installed]
    browseSkills.value = browseSkills.value.filter((s) => s.name !== skill.name)
    detailSkill.value = installed
    showToast(`已安装 ${skill.displayName || skill.name}`)
    isDetailOpen.value = false
    clearCache()
    emit('skills-changed')
  } catch (e) {
    showToast(e instanceof Error ? e.message : '安装技能失败', 'error')
  } finally {
    isInstallActionInFlight.value = false
  }
}

async function handleUninstall(skill: HubSkill): Promise<void> {
  actionSkillKey.value = `${skill.owner}/${skill.name}`
  isUninstallActionInFlight.value = true
  try {
    const resp = await fetch('/codex-api/skills-hub/uninstall', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: skill.name, path: skill.path }),
    })
    const data = (await resp.json()) as { ok?: boolean; error?: string }
    if (!data.ok) throw new Error(data.error || '卸载失败')
    installedSkills.value = installedSkills.value.filter((s) => s.name !== skill.name)
    if (skill.owner !== 'local') {
      browseSkills.value = [...browseSkills.value, { ...skill, installed: false, path: undefined, enabled: undefined }]
    }
    showToast(`已卸载 ${skill.displayName || skill.name}`)
    isDetailOpen.value = false
    clearCache()
    emit('skills-changed')
  } catch (e) {
    showToast(e instanceof Error ? e.message : '卸载技能失败', 'error')
  } finally {
    isUninstallActionInFlight.value = false
  }
}

async function handleToggleEnabled(skill: HubSkill, enabled: boolean): Promise<void> {
  try {
    const resp = await fetch('/codex-api/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'skills/config/write', params: { path: skill.path, enabled } }),
    })
    if (!resp.ok) throw new Error('更新技能状态失败')
    await fetch('/codex-api/skills-sync/push', { method: 'POST' })
    showToast(`${skill.displayName || skill.name} 已${enabled ? '启用' : '禁用'}`)
    await fetchSkills(activeQuery.value)
  } catch (e) {
    showToast(e instanceof Error ? e.message : '更新技能状态失败', 'error')
  }
}

const {
  deviceLogin,
  isPullInFlight,
  isPushInFlight,
  isStartupSyncInFlight,
  isSyncActionInFlight,
  loadSyncStatus,
  logoutGithub,
  pullSkillsSync,
  pushSkillsSync,
  startupSkillsSync,
  startGithubLogin,
  syncActionError,
  syncActionStatus,
  syncStatus,
} = useGithubSkillsSync({
  showToast,
  onPulled: async () => {
    await fetchSkills(activeQuery.value)
    emit('skills-changed')
  },
})

onMounted(() => {
  void fetchSkills('')
  void loadSyncStatus()
  if (typeof window !== 'undefined') {
    syncStatusTimer = window.setInterval(() => {
      void loadSyncStatus()
    }, SYNC_STATUS_REFRESH_INTERVAL_MS)
    window.addEventListener('focus', onWindowFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)
  }
})

onBeforeUnmount(() => {
  if (toastTimer) {
    clearTimeout(toastTimer)
    toastTimer = null
  }
  if (syncStatusTimer) {
    clearInterval(syncStatusTimer)
    syncStatusTimer = null
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('focus', onWindowFocus)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
})

function onWindowFocus(): void {
  void loadSyncStatus()
}

function onVisibilityChange(): void {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
    void loadSyncStatus()
  }
}
</script>

<style scoped>
@reference "tailwindcss";

.skills-hub {
  @apply flex flex-col gap-3 p-3 sm:p-4 max-w-6xl mx-auto w-full overflow-y-auto h-full;
}

.skills-hub-header {
  @apply flex items-start justify-between gap-3;
}

.skills-hub-heading {
  @apply flex min-w-0 flex-col gap-1;
}

.skills-hub-title {
  @apply text-lg sm:text-xl font-semibold text-zinc-900 m-0;
}

.skills-hub-subtitle {
  @apply text-xs sm:text-sm text-zinc-500 m-0;
}

.skills-hub-toolbar {
  @apply sticky top-0 z-10 -mx-3 sm:-mx-4 px-3 sm:px-4 py-2 bg-white/95 backdrop-blur flex flex-col lg:flex-row items-stretch lg:items-center gap-2 border-b border-zinc-100;
}

.skills-market-tabs {
  @apply grid grid-cols-2 rounded-lg border border-zinc-200 bg-zinc-50 p-0.5 lg:w-auto lg:min-w-[220px];
}

.skills-market-tab {
  @apply min-h-9 rounded-md border-0 bg-transparent px-3 text-xs font-medium text-zinc-500 transition hover:text-zinc-800;
}

.skills-market-tab.is-active {
  @apply bg-white text-zinc-900 shadow-sm;
}

.skills-hub-search-wrap {
  @apply flex-1 flex min-w-0 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 transition focus-within:border-zinc-400 focus-within:shadow-sm;
}

.skills-hub-search-icon {
  @apply w-4 h-4 text-zinc-400 shrink-0;
}

.skills-hub-search {
  @apply flex-1 min-w-0 bg-transparent text-sm text-zinc-800 placeholder-zinc-400 outline-none border-none p-0;
}

.skills-hub-search-btn {
  @apply shrink-0 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 hover:border-zinc-300 cursor-pointer;
}

.skills-hub-count {
  @apply text-xs text-zinc-400 whitespace-nowrap;
}

.skills-hub-sort {
  @apply min-h-9 shrink-0 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 hover:border-zinc-300 cursor-pointer;
}

.skills-sync-panel {
  @apply rounded-lg border border-zinc-200 bg-zinc-50 p-3 flex flex-col gap-2;
}

.skills-sync-header {
  @apply flex flex-wrap items-center gap-2 text-sm font-medium text-zinc-700;
}

.skills-sync-badge {
  @apply text-xs rounded-md border border-zinc-300 bg-white px-2 py-0.5;
}

.skills-sync-badge-link {
  @apply text-zinc-700 hover:text-zinc-900 hover:border-zinc-400;
}

.skills-sync-device {
  @apply text-xs text-zinc-600 flex items-center gap-2 flex-wrap;
}

.skills-sync-meta {
  @apply text-xs text-zinc-600 flex items-center gap-3 flex-wrap;
}

.skills-sync-error {
  @apply text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-2 py-1;
}

.skills-sync-actions {
  @apply flex flex-wrap gap-2;
}

.skills-hub-toast {
  @apply rounded-lg px-3 py-2 text-sm font-medium;
}

.skills-hub-toast-success {
  @apply border border-emerald-200 bg-emerald-50 text-emerald-700;
}

.skills-hub-toast-error {
  @apply border border-rose-200 bg-rose-50 text-rose-700;
}

.skills-hub-section {
  @apply flex flex-col gap-2;
}

.skills-hub-section-toggle {
  @apply flex items-center gap-1.5 border-0 bg-transparent p-0 text-sm font-medium text-zinc-600 transition hover:text-zinc-900 cursor-pointer;
}

.skills-hub-section-title {
  @apply text-sm font-medium;
}

.skills-hub-section-chevron {
  @apply w-3.5 h-3.5 transition-transform;
}

.skills-hub-section-chevron.is-open {
  @apply rotate-90;
}

.skills-hub-grid {
  @apply grid gap-2.5;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
}

.skills-hub-skeleton-card {
  @apply flex min-h-40 flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4;
}

.skills-hub-skeleton-line,
.skills-hub-skeleton-action {
  @apply block rounded-md bg-zinc-100;
  background-image: linear-gradient(100deg, transparent 20%, rgb(255 255 255 / 0.72) 42%, transparent 64%);
  background-size: 220% 100%;
  animation: skills-skeleton-shimmer 1.25s ease-in-out infinite;
}

.skills-hub-skeleton-line {
  @apply h-3 w-full;
}

.skills-hub-skeleton-line--title {
  @apply h-5 w-2/3;
}

.skills-hub-skeleton-line--short {
  @apply w-4/5;
}

.skills-hub-skeleton-action {
  @apply mt-auto h-8 w-20;
}

.skills-hub-refreshing,
.skills-hub-cache-warning {
  @apply rounded-lg border px-3 py-2 text-xs;
}

.skills-hub-refreshing {
  @apply border-zinc-200 bg-zinc-50 text-zinc-600;
}

.skills-hub-cache-warning {
  @apply border-amber-200 bg-amber-50 text-amber-800;
}

.skills-hub-error {
  @apply text-sm text-rose-600 py-4 text-center rounded-lg border border-rose-200 bg-rose-50;
}

.skills-hub-empty {
  @apply text-sm text-zinc-400 py-8 text-center;
}

@keyframes skills-skeleton-shimmer {
  to {
    background-position: -120% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .skills-hub-skeleton-line,
  .skills-hub-skeleton-action {
    animation: none;
  }
}
</style>
