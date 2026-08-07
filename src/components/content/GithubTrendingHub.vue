<template>
  <section class="trending-hub">
    <div class="trending-hub-filter" aria-label="热门仓库筛选">
      <span class="trending-hub-filter-label">热门仓库</span>
      <ComposerDropdown
        class="trending-hub-scope-dropdown"
        :model-value="scope"
        :options="scopeOptions"
        trigger-aria-label="选择热门仓库榜单"
        @update:model-value="onScopeChange"
      />
      <button type="button" class="trending-hub-refresh" :disabled="isLoading" @click="emit('refresh')">
        {{ isLoading ? '刷新中' : '刷新' }}
      </button>
    </div>

    <div
      v-if="isLoading && projects.length === 0"
      class="trending-hub-grid trending-hub-skeleton-grid"
      role="status"
      aria-label="正在加载热门项目"
    >
      <article v-for="index in 6" :key="index" class="trending-card trending-card-skeleton" aria-hidden="true">
        <span class="trending-skeleton-line trending-skeleton-line--title" />
        <span class="trending-skeleton-line trending-skeleton-line--short" />
        <span class="trending-skeleton-line" />
        <span class="trending-skeleton-line" />
        <span class="trending-skeleton-action" />
      </article>
    </div>
    <p
      v-else-if="projects.length === 0"
      class="trending-hub-empty"
      :class="{ 'trending-hub-error': error }"
      :role="error ? 'alert' : undefined"
    >
      {{ error ? `加载失败：${error}` : '当前没有可展示的热门项目。' }}
    </p>

    <div v-else class="trending-hub-grid">
      <p v-if="isLoading" class="trending-hub-refreshing" role="status" aria-live="polite">
        正在刷新，当前项目仍可浏览…
      </p>
      <p v-else-if="error" class="trending-hub-refreshing trending-hub-error" role="status">
        刷新失败，已保留当前项目：{{ error }}
      </p>
      <article
        v-for="(project, index) in projects"
        :key="project.id"
        class="trending-card"
        :class="{ 'is-expanded': expandedProjectId === project.id }"
      >
        <div class="trending-card-head">
          <h3 class="trending-card-title" :title="project.fullName">
            <span class="trending-card-owner">{{ project.owner }}</span>
            <span class="trending-card-slash">/</span>
            <span class="trending-card-repo">{{ project.repo || project.fullName }}</span>
          </h3>
          <div class="trending-card-metrics">
            <span v-if="project.languageLabel || project.language" class="trending-card-chip trending-card-language">
              {{ project.languageLabel || project.language }}
            </span>
            <span class="trending-card-chip trending-card-stars">★ {{ formatStars(project.stars) }}</span>
          </div>
        </div>

        <div class="trending-card-body">
          <p
            :id="`trending-project-summary-${index}`"
            class="trending-card-summary"
            :class="{ 'is-expanded': expandedProjectId === project.id }"
          >
            {{ getPrimaryDescription(project) }}
          </p>

          <div
            v-if="expandedProjectId === project.id && showProjectDetails(project)"
            :id="`trending-project-details-${index}`"
            class="trending-card-details"
          >
            <div
              class="trending-card-detail-block trending-card-detail-block-link"
            >
              <p class="trending-card-detail-label">仓库地址</p>
              <p class="trending-card-detail-text trending-card-url">{{ project.url }}</p>
            </div>
          </div>

          <button
            type="button"
            class="trending-card-expand"
            :aria-expanded="expandedProjectId === project.id"
            :aria-controls="expandedProjectId === project.id && showProjectDetails(project)
              ? `trending-project-details-${index}`
              : `trending-project-summary-${index}`"
            @click="toggleProject(project.id)"
          >
            <span>{{ expandedProjectId === project.id ? '收起' : '展开' }}</span>
            <span class="trending-card-expand-icon" aria-hidden="true">⌄</span>
          </button>
        </div>

        <div class="trending-card-footer">
          <div class="trending-card-actions">
            <a
              class="trending-card-action trending-card-action-link"
              :href="project.url"
              target="_blank"
              rel="noopener noreferrer"
            >
              进入主页
            </a>
            <button
              type="button"
              class="trending-card-action trending-card-action-primary"
              @click="emit('ask-project', project)"
            >
              解释
            </button>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { defineAsyncComponent, ref } from 'vue'
import type { GithubTipsScope, GithubTrendingProject } from '../../api/codexGateway'

const ComposerDropdown = defineAsyncComponent(() => import('./ComposerDropdown.vue'))

const props = defineProps<{
  projects: GithubTrendingProject[]
  isLoading: boolean
  error: string
  scope: GithubTipsScope
  scopeOptions: Array<{ value: GithubTipsScope; label: string }>
}>()

const emit = defineEmits<{
  'update:scope': [value: string]
  'refresh': []
  'ask-project': [project: GithubTrendingProject]
}>()

const expandedProjectId = ref<number | null>(null)

function onScopeChange(value: string): void {
  emit('update:scope', value)
}

function formatStars(value: number): string {
  return new Intl.NumberFormat().format(value)
}

function getPrimaryDescription(project: GithubTrendingProject): string {
  return project.descriptionZh?.trim() || project.description.trim() || '暂无介绍。'
}

function showProjectDetails(project: GithubTrendingProject): boolean {
  return project.url.trim().length > 0
}

function toggleProject(projectId: number): void {
  expandedProjectId.value = expandedProjectId.value === projectId ? null : projectId
}
</script>

<style scoped>
@reference "tailwindcss";

.trending-hub {
  --trending-surface: var(--ui-bg-surface);
  --trending-surface-muted: var(--ui-bg-surface-muted);
  --trending-border: var(--ui-border-subtle);
  --trending-border-strong: var(--ui-border-strong);
  --trending-text: var(--ui-text-primary);
  --trending-muted: var(--ui-text-secondary);
  --trending-subtle: var(--ui-text-tertiary);
  @apply flex h-full min-h-0 w-full flex-col gap-3 overflow-y-auto px-3 py-1 sm:px-4;
  padding-bottom: max(1.75rem, calc(env(safe-area-inset-bottom) + 1.25rem));
  -webkit-overflow-scrolling: touch;
}

.trending-hub-filter {
  @apply flex min-h-11 items-center gap-2 rounded-xl border px-2 py-1.5;
  border-color: var(--trending-border);
  background: var(--trending-surface);
}

.trending-hub-filter-label {
  @apply shrink-0 pl-1 text-xs font-medium;
  color: var(--trending-muted);
}

.trending-hub-scope-dropdown {
  @apply min-w-0 flex-1;
}

.trending-hub-scope-dropdown :deep(.composer-dropdown-trigger) {
  @apply h-9 w-full justify-between rounded-lg border-0 px-2.5 shadow-none;
  background: var(--trending-surface-muted);
  color: var(--trending-text);
}

.trending-hub-refresh {
  @apply inline-flex h-9 shrink-0 items-center justify-center rounded-lg border px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60;
  border-color: var(--trending-border-strong);
  background: var(--trending-surface);
  color: var(--trending-text);
}

.trending-hub-refresh:hover:not(:disabled) {
  background: var(--trending-surface-muted);
}

.trending-hub-empty {
  @apply m-0 rounded-xl border border-dashed px-4 py-5 text-sm;
  border-color: var(--trending-border);
  background: var(--trending-surface-muted);
  color: var(--trending-muted);
}

.trending-hub-error {
  @apply border-red-200 bg-red-50 text-red-700;
}

.trending-hub-grid {
  @apply grid grid-cols-2 items-start gap-2.5;
}

.trending-hub-refreshing {
  @apply col-span-full m-0 rounded-lg border px-3 py-2 text-xs;
  border-color: var(--trending-border);
  background: var(--trending-surface-muted);
  color: var(--trending-muted);
}

.trending-hub-refreshing.trending-hub-error {
  @apply border-red-200 bg-red-50 text-red-700;
}

.trending-card {
  @apply flex h-[17rem] min-w-0 flex-col rounded-xl border px-3 py-3;
  border-color: var(--trending-border);
  background: var(--trending-surface);
  transition:
    border-color var(--motion-duration-fast) var(--motion-ease-standard),
    background-color var(--motion-duration-fast) var(--motion-ease-standard);
}

.trending-card.is-expanded {
  @apply col-span-full h-auto min-h-[17rem];
  border-color: color-mix(in srgb, var(--ui-accent) 38%, var(--trending-border));
}

.trending-card-skeleton {
  @apply gap-3;
}

.trending-skeleton-line,
.trending-skeleton-action {
  @apply block rounded-lg;
  background-color: var(--trending-surface-muted);
  background-image: linear-gradient(100deg, transparent 20%, rgb(255 255 255 / 0.72) 42%, transparent 64%);
  background-size: 220% 100%;
  animation: trending-skeleton-shimmer 1.25s ease-in-out infinite;
}

.trending-skeleton-line {
  @apply h-4 w-full;
}

.trending-skeleton-line--title {
  @apply h-6 w-2/3;
}

.trending-skeleton-line--short {
  @apply w-2/5;
}

.trending-skeleton-action {
  @apply mt-auto h-10 w-24;
}

.trending-card-head {
  @apply flex min-w-0 flex-col gap-2;
}

.trending-card-title {
  @apply m-0 min-w-0 overflow-hidden text-[0.95rem] font-semibold leading-5 break-words;
  color: var(--trending-text);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.trending-card.is-expanded .trending-card-title {
  display: block;
  overflow: visible;
}

.trending-card-owner,
.trending-card-slash {
  color: var(--trending-muted);
}

.trending-card-repo {
  color: var(--trending-text);
}

.trending-card-metrics {
  @apply flex min-w-0 items-center gap-1.5 overflow-hidden;
}

.trending-card-chip {
  @apply inline-flex min-w-0 items-center rounded-full border px-2 py-0.5 text-[11px];
  border-color: var(--trending-border);
  background: var(--trending-surface-muted);
  color: var(--trending-muted);
}

.trending-card-language {
  @apply overflow-hidden text-ellipsis whitespace-nowrap;
}

.trending-card-stars {
  @apply shrink-0 whitespace-nowrap;
}

.trending-card-body {
  @apply mt-2.5 flex min-h-0 flex-1 flex-col gap-2;
}

.trending-card-summary {
  @apply m-0 overflow-hidden text-[13px] leading-5;
  color: var(--trending-muted);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.trending-card-summary.is-expanded {
  display: block;
  overflow: visible;
}

.trending-card-details {
  @apply flex flex-col gap-2 border-t pt-2.5;
  border-color: var(--trending-border);
}

.trending-card-detail-block {
  @apply flex flex-col gap-1;
}

.trending-card-detail-block-link {
  @apply pt-0;
}

.trending-card-detail-label {
  @apply m-0 text-[11px] font-medium;
  color: var(--trending-subtle);
}

.trending-card-detail-text {
  @apply m-0 text-xs leading-5 break-words;
  color: var(--trending-muted);
}

.trending-card-url {
  color: var(--ui-accent);
}

.trending-card-expand {
  @apply mt-auto inline-flex min-h-8 items-center gap-1 self-start rounded-md px-1 text-xs font-medium;
  color: var(--trending-muted);
}

.trending-card-expand:hover {
  color: var(--trending-text);
}

.trending-card-expand:focus-visible {
  outline: 2px solid var(--ui-focus);
  outline-offset: 2px;
}

.trending-card-expand-icon {
  @apply inline-block text-sm leading-none;
  transition: transform var(--motion-duration-base) var(--motion-ease-out);
}

.trending-card-expand[aria-expanded='true'] .trending-card-expand-icon {
  transform: rotate(180deg);
}

.trending-card-footer {
  @apply mt-2.5 border-t pt-2.5;
  border-color: var(--trending-border);
}

.trending-card-actions {
  @apply flex gap-1.5;
}

.trending-card-action {
  @apply inline-flex h-11 min-w-0 flex-1 items-center justify-center rounded-lg border px-2 text-xs font-medium transition-colors;
}

.trending-card-action-link {
  border-color: var(--trending-border-strong);
  background: var(--trending-surface);
  color: var(--trending-text);
}

.trending-card-action-link:hover {
  background: var(--trending-surface-muted);
}

.trending-card-action-primary {
  border-color: var(--ui-accent);
  background: var(--ui-accent);
  color: white;
}

.trending-card-action-primary:hover {
  filter: brightness(0.92);
}

:global(:root.dark) .trending-hub {
  --trending-surface: #18181b;
  --trending-surface-muted: #27272a;
  --trending-border: #3f3f46;
  --trending-border-strong: #52525b;
  --trending-text: #f4f4f5;
  --trending-muted: #d4d4d8;
  --trending-subtle: #a1a1aa;
}

@media (max-width: 359px) {
  .trending-hub-grid {
    @apply grid-cols-1;
  }

  .trending-card.is-expanded {
    @apply col-span-1;
  }
}

@keyframes trending-skeleton-shimmer {
  to {
    background-position: -120% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .trending-skeleton-line,
  .trending-skeleton-action {
    animation: none;
  }

  .trending-card,
  .trending-card-expand-icon {
    transition: none;
  }
}
</style>
