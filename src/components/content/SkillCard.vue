<template>
  <button
    class="skill-card"
    type="button"
    :class="{ 'is-disabled': skill.installed && skill.enabled === false }"
    @click="$emit('select', skill)"
  >
    <div class="skill-card-top">
      <img
        v-if="skill.avatarUrl"
        class="skill-card-avatar"
        :src="skill.avatarUrl"
        :alt="skill.owner"
        loading="lazy"
        @error="onAvatarError"
      />
      <div class="skill-card-avatar-fallback" v-else>{{ skill.owner.charAt(0) }}</div>
      <div class="skill-card-info">
        <div class="skill-card-header">
          <span class="skill-card-name">{{ skill.displayName || skill.name }}</span>
          <span v-if="skill.installed && skill.enabled === false" class="skill-card-badge-disabled">已禁用</span>
          <span v-else-if="skill.installed" class="skill-card-badge">已安装</span>
        </div>
        <span class="skill-card-owner">{{ skill.owner }}</span>
      </div>
      <button
        v-if="skill.installed && skillDirPath"
        class="skill-card-browse"
        type="button"
        title="浏览文件"
        @click.stop="onBrowse"
      >
        <IconTablerFolder class="skill-card-browse-icon" />
      </button>
    </div>
    <p v-if="skill.description" class="skill-card-desc">{{ skill.description }}</p>
    <div class="skill-card-meta">
      <span v-if="skill.sourceLabel" class="skill-card-source">{{ skill.sourceLabel }}</span>
      <span v-if="starLabel" class="skill-card-date">{{ starLabel }}</span>
      <span v-if="publishedLabel" class="skill-card-date">{{ publishedLabel }}</span>
    </div>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import IconTablerFolder from '../icons/IconTablerFolder.vue'

const props = defineProps<{
  skill: {
    name: string
    owner: string
    description: string
    displayName?: string
    publishedAt?: number
    avatarUrl?: string
    url: string
    installed: boolean
    sourcePath?: string
    repoSlug?: string
    repoRef?: string
    sourceLabel?: string
    stars?: number
    path?: string
    enabled?: boolean
  }
}>()

defineEmits<{ select: [skill: unknown] }>()

const skillDirPath = computed(() => {
  const p = props.skill.path
  if (!p) return ''
  return p.endsWith('/SKILL.md') ? p.slice(0, -'/SKILL.md'.length) : p
})

function onBrowse(): void {
  const dir = skillDirPath.value
  if (!dir) return
  const browsePath = dir.startsWith('/') ? dir : `/${dir}`
  window.open(`/codex-local-browse${encodeURI(browsePath)}`, '_blank', 'noopener,noreferrer')
}

const publishedLabel = computed(() => {
  const ts = props.skill.publishedAt
  if (!ts) return ''
  const d = new Date(ts)
  const now = Date.now()
  const diff = now - ts
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`
  if (diff < 2592000_000) return `${Math.floor(diff / 86400_000)} 天前`
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
})

const starLabel = computed(() => {
  const stars = props.skill.stars
  if (!stars || stars <= 0) return ''
  if (stars >= 1000) return `${(stars / 1000).toFixed(stars >= 10000 ? 0 : 1)}k stars`
  return `${stars} stars`
})

function onAvatarError(e: Event): void {
  const img = e.target as HTMLImageElement
  img.style.display = 'none'
}
</script>

<style scoped>
@reference "tailwindcss";

.skill-card {
  @apply flex min-h-[92px] flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 text-left transition hover:border-zinc-300 hover:shadow-sm cursor-pointer;
}

.skill-card.is-disabled {
  @apply opacity-50;
}

.skill-card-top {
  @apply flex items-start gap-2.5;
}

.skill-card-avatar {
  @apply w-8 h-8 rounded-full shrink-0 bg-zinc-100;
}

.skill-card-avatar-fallback {
  @apply w-8 h-8 rounded-full shrink-0 bg-zinc-200 text-zinc-500 flex items-center justify-center text-xs font-medium uppercase;
}

.skill-card-info {
  @apply flex flex-col gap-0.5 min-w-0 flex-1;
}

.skill-card-header {
  @apply flex items-start gap-2 min-w-0;
}

.skill-card-name {
  @apply min-w-0 flex-1 text-sm font-semibold leading-snug text-zinc-900 truncate;
}

.skill-card-badge {
  @apply shrink-0 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 leading-none;
}

.skill-card-badge-disabled {
  @apply shrink-0 rounded-md border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 leading-none;
}

.skill-card-owner {
  @apply text-xs text-zinc-500 truncate;
}

.skill-card-browse {
  @apply shrink-0 ml-auto h-7 w-7 rounded-lg border-0 bg-transparent text-zinc-300 flex items-center justify-center transition hover:bg-zinc-100 hover:text-zinc-600;
}

.skill-card-browse-icon {
  @apply w-4 h-4;
}

.skill-card-desc {
  @apply m-0 text-xs leading-relaxed text-zinc-600 line-clamp-1;
}

.skill-card-meta {
  @apply flex min-w-0 items-center gap-2 text-[10px] text-zinc-400;
}

.skill-card-source {
  @apply min-w-0 truncate rounded-md bg-zinc-50 px-1.5 py-0.5 text-zinc-500;
}

.skill-card-date {
  @apply shrink-0 text-[10px] text-zinc-400;
}
</style>
