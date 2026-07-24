<template>
  <main v-if="isSetupView" class="docs-setup-page" aria-label="CX-Codex connection setup demo">
    <section class="docs-setup-card">
      <div class="docs-setup-brand">
        <img src="/branding/cx-codex-app-icon.png" alt="" class="docs-setup-logo" />
        <div>
          <p class="docs-setup-kicker">CX-Codex</p>
          <h1>连接你的 Codex</h1>
        </div>
      </div>
      <p class="docs-setup-copy">输入自托管服务地址，保存后即可在手机上继续查看和发送任务。</p>
      <label class="docs-setup-field">
        <span>服务地址</span>
        <input type="url" value="https://codex.example.com" readonly />
      </label>
      <label class="docs-setup-field">
        <span>访问密钥</span>
        <input type="text" value="••••••••••••" readonly />
      </label>
      <button type="button" class="docs-setup-submit">保存并进入</button>
      <p class="docs-setup-note">演示地址与密钥仅用于文档截图，不对应任何真实服务。</p>
    </section>
  </main>

  <DesktopLayout v-else :is-sidebar-collapsed="isMobile">
    <template #sidebar>
      <section class="docs-sidebar">
        <div class="docs-sidebar-toolbar">
          <div class="docs-sidebar-brand">
            <img src="/branding/cx-codex-app-icon.png" alt="" />
            <span>CX-Codex</span>
          </div>
          <button type="button" aria-label="收起侧栏">
            <IconTablerLayoutSidebar />
          </button>
        </div>

        <nav class="docs-sidebar-actions" aria-label="演示快捷操作">
          <button type="button">
            <IconTablerFilePencil />
            <span>新会话</span>
          </button>
          <button type="button">
            <IconTablerSearch />
            <span>搜索</span>
          </button>
          <button type="button">
            <IconTablerFolder />
            <span>工作台</span>
          </button>
          <button type="button">
            <IconTablerDots />
            <span>工具</span>
          </button>
        </nav>

        <SidebarThreadTree
          class="docs-sidebar-tree"
          :groups="projectGroups"
          :project-display-name-by-id="projectDisplayNameById"
          selected-thread-id="docs-thread-stability"
          :is-loading="false"
          search-query=""
          :search-matched-thread-ids="null"
          :pinned-thread-ids-override="['docs-thread-stability']"
          desktop-list-parity
          @select="noop"
          @archive="noop"
          @start-new-thread="noop"
          @browse-thread-files="noop"
          @rename-project="noop"
          @rename-thread="noop"
          @remove-project="noop"
          @reorder-project="noop"
          @export-thread="noop"
          @fork-thread="noop"
        />

        <button type="button" class="docs-sidebar-settings">
          <IconTablerSettings />
          <span>设置</span>
        </button>
      </section>
    </template>

    <template #content>
      <section class="docs-content">
        <ContentHeader :title="isGithubView ? 'GitHub 热门' : '优化聊天交互与消息稳定性'">
          <template v-if="isMobile" #leading>
            <button type="button" class="docs-mobile-menu" aria-label="打开会话列表">
              <IconTablerLayoutSidebar />
            </button>
          </template>
          <template #subtitle>
            <p>{{ isGithubView ? '发现适合 Codex 工作流的开源项目' : 'CX 演示工作区 · 已脱敏' }}</p>
          </template>
          <template #actions>
            <span class="docs-status"><i />同步正常</span>
          </template>
        </ContentHeader>

        <section class="docs-content-body">
          <GithubTrendingHub
            v-if="isGithubView"
            :projects="trendingProjects"
            :is-loading="false"
            scope="trending-daily"
            :scope-options="scopeOptions"
            @update:scope="noop"
            @refresh="noop"
            @ask-project="noop"
          />

          <div v-else class="docs-conversation-grid">
            <div class="docs-conversation">
              <ThreadConversation
                :messages="messages"
                :pending-requests="[]"
                :live-overlay="null"
                :is-loading="false"
                active-thread-id="docs-thread-stability"
                cwd="/workspace/cx-demo"
                :scroll-state="null"
                :favorite-message-ids="[]"
                :is-thread-switching="false"
                :is-turn-in-progress="false"
                :show-empty-thread-actions="false"
                @update-scroll-state="noop"
                @rollback="noop"
                @toggle-favorite="noop"
                @load-older-history="noop"
                @return-to-new-thread="noop"
                @dismiss-empty-thread="noop"
                @retry-failed-message="noop"
              />
            </div>
            <ThreadComposer
              active-thread-id="docs-thread-stability"
              cwd="/workspace/cx-demo"
              :models="modelIds"
              :available-models="availableModels"
              selected-model="gpt-5.5"
              selected-reasoning-effort="high"
              selected-speed-mode="fast"
              selected-collaboration-mode="execute"
              :skills="skills"
              :plugins="plugins"
              :is-loading-plugins="false"
              :has-loaded-plugins="true"
              :has-loaded-skills="true"
              :is-turn-in-progress="false"
              :is-interrupting-turn="false"
              :is-updating-speed-mode="false"
              :send-with-enter="true"
              :dictation-click-to-toggle="false"
              :dictation-auto-send="false"
              :show-dictation-button="true"
              dictation-language="zh"
              @submit="noop"
              @update:selected-model="noop"
              @update:selected-reasoning-effort="noop"
              @update:selected-speed-mode="noop"
              @update:selected-collaboration-mode="noop"
              @refresh-plugins="noop"
              @reload-plugins="noop"
              @login-plugin="noop"
              @interrupt="noop"
            />
          </div>
        </section>
      </section>
    </template>
  </DesktopLayout>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import type { GithubTipsScope, GithubTrendingProject } from '../../api/codexGateway'
import { useMobile } from '../../composables/useMobile'
import type {
  ComposerModelInfo,
  ComposerPluginInfo,
  ReasoningEffort,
  UiMessage,
  UiProjectGroup,
} from '../../types/codex'
import IconTablerDots from '../icons/IconTablerDots.vue'
import IconTablerFilePencil from '../icons/IconTablerFilePencil.vue'
import IconTablerFolder from '../icons/IconTablerFolder.vue'
import IconTablerLayoutSidebar from '../icons/IconTablerLayoutSidebar.vue'
import IconTablerSearch from '../icons/IconTablerSearch.vue'
import IconTablerSettings from '../icons/IconTablerSettings.vue'
import DesktopLayout from '../layout/DesktopLayout.vue'
import SidebarThreadTree from '../sidebar/SidebarThreadTree.vue'
import ContentHeader from './ContentHeader.vue'
import GithubTrendingHub from './GithubTrendingHub.vue'
import ThreadComposer from './ThreadComposer.vue'
import ThreadConversation from './ThreadConversation.vue'

const route = useRoute()
const { isMobile } = useMobile()
const isGithubView = computed(() => route.query.view === 'github')
const isSetupView = computed(() => route.query.view === 'setup')

const now = Date.now()
const projectGroups: UiProjectGroup[] = [
  {
    projectName: 'cx-demo',
    isPinnedProject: true,
    pinnedProjectRank: 0,
    threads: [
      {
        id: 'docs-thread-stability',
        title: '优化聊天交互与消息稳定性',
        projectName: 'cx-demo',
        cwd: '/workspace/cx-demo',
        sourceKind: 'desktop',
        hasWorktree: false,
        createdAtIso: new Date(now - 3_600_000).toISOString(),
        updatedAtIso: new Date(now - 120_000).toISOString(),
        preview: '桌面、手机和恢复同步检查已完成。',
        unread: false,
        inProgress: false,
      },
      {
        id: 'docs-thread-release',
        title: '准备下一版发布说明',
        projectName: 'cx-demo',
        cwd: '/workspace/cx-demo',
        sourceKind: 'cli',
        hasWorktree: false,
        createdAtIso: new Date(now - 86_400_000).toISOString(),
        updatedAtIso: new Date(now - 7_200_000).toISOString(),
        preview: '整理升级步骤、验证结果和已知边界。',
        unread: true,
        inProgress: false,
      },
      {
        id: 'docs-thread-mobile',
        title: '检查手机端输入体验',
        projectName: 'cx-demo',
        cwd: '/workspace/cx-demo',
        sourceKind: 'app',
        hasWorktree: false,
        createdAtIso: new Date(now - 172_800_000).toISOString(),
        updatedAtIso: new Date(now - 28_800_000).toISOString(),
        preview: '输入框、附件、模型和恢复流程均可用。',
        unread: false,
        inProgress: false,
      },
      {
        id: 'docs-thread-github',
        title: '查看 GitHub 热门项目',
        projectName: 'cx-demo',
        cwd: '/workspace/cx-demo',
        sourceKind: 'desktop',
        hasWorktree: false,
        createdAtIso: new Date(now - 259_200_000).toISOString(),
        updatedAtIso: new Date(now - 86_400_000).toISOString(),
        preview: '从工作台发现适合当前任务的开源项目。',
        unread: false,
        inProgress: false,
      },
    ],
  },
]

const projectDisplayNameById: Record<string, string> = {
  'cx-demo': 'CX 演示工作区',
}

const messages: UiMessage[] = [
  {
    id: 'docs-user-check',
    role: 'user',
    text: '请检查聊天窗口在桌面端和手机端的交互，并整理发布前清单。',
    turnIndex: 0,
  },
  {
    id: 'docs-assistant-check',
    role: 'assistant',
    text: [
      '检查完成，当前界面已经收敛为更轻、更紧凑的工作台。',
      '',
      '- 会话切换优先显示缓存，再后台补同步最新消息。',
      '- 发送内容立即出现在窗口中，弱网恢复不会重复提交。',
      '- 手机端保留附件、模型、质量、速度和语音入口。',
    ].join('\n'),
    turnIndex: 0,
  },
  {
    id: 'docs-user-next',
    role: 'user',
    text: '下一步先更新公开说明和脱敏截图。',
    turnIndex: 1,
  },
  {
    id: 'docs-assistant-next',
    role: 'assistant',
    text: '已准备好桌面、手机、输入菜单、模型设置和 GitHub 热门的演示截图；所有内容均为虚构数据。',
    turnIndex: 1,
  },
]

const modelIds = ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini']
const reasoningOptions = (values: ReasoningEffort[]) => values.map((value) => ({ value, description: '' }))
const availableModels: ComposerModelInfo[] = [
  {
    id: 'gpt-5.5',
    model: 'gpt-5.5',
    displayName: 'GPT-5.5',
    description: '适合复杂编码与长任务。',
    hidden: false,
    isDefault: true,
    defaultReasoningEffort: 'high',
    supportedReasoningEfforts: reasoningOptions(['low', 'medium', 'high', 'xhigh']),
  },
  {
    id: 'gpt-5.4',
    model: 'gpt-5.4',
    displayName: 'GPT-5.4',
    description: '适合日常开发与协作。',
    hidden: false,
    isDefault: false,
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: reasoningOptions(['low', 'medium', 'high', 'xhigh']),
  },
  {
    id: 'gpt-5.4-mini',
    model: 'gpt-5.4-mini',
    displayName: 'GPT-5.4 Mini',
    description: '轻量快速，适合简单任务。',
    hidden: false,
    isDefault: false,
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: reasoningOptions(['low', 'medium', 'high']),
  },
]

const skills = [
  {
    name: 'frontend-review',
    description: '检查前端交互与可访问性',
    path: '/demo/skills/frontend-review/SKILL.md',
  },
]

const plugins: ComposerPluginInfo[] = [
  {
    id: 'github@example',
    name: 'GitHub',
    description: '查看仓库、Issue 和 Pull Request。',
    source: 'plugin',
    mentionPath: 'plugin://github@example',
    authStatus: 'oAuth',
    isAccessible: true,
    isEnabled: true,
    distributionChannel: null,
    installUrl: null,
    toolCount: 4,
    resourceCount: 0,
    resourceTemplateCount: 0,
    tools: [],
  },
]

const scopeOptions: Array<{ value: GithubTipsScope; label: string }> = [
  { value: 'trending-daily', label: '趋势日报' },
  { value: 'trending-weekly', label: '趋势周榜' },
]

const trendingProjects: GithubTrendingProject[] = [
  {
    id: 1,
    fullName: 'openai/codex',
    owner: 'openai',
    repo: 'codex',
    url: 'https://github.com/openai/codex',
    description: 'A coding agent that runs locally.',
    descriptionZh: '在本地运行的开源编码智能体。',
    language: 'Rust',
    languageLabel: 'Rust',
    stars: 57_000,
  },
  {
    id: 2,
    fullName: 'vuejs/core',
    owner: 'vuejs',
    repo: 'core',
    url: 'https://github.com/vuejs/core',
    description: 'The progressive JavaScript framework.',
    descriptionZh: '渐进式 JavaScript 框架，适合构建现代交互界面。',
    language: 'TypeScript',
    languageLabel: 'TypeScript',
    stars: 49_000,
  },
  {
    id: 3,
    fullName: 'ionic-team/capacitor',
    owner: 'ionic-team',
    repo: 'capacitor',
    url: 'https://github.com/ionic-team/capacitor',
    description: 'Build cross-platform native apps with web technology.',
    descriptionZh: '使用 Web 技术构建跨平台原生应用。',
    language: 'TypeScript',
    languageLabel: 'TypeScript',
    stars: 14_000,
  },
]

function noop(): void {
  // Documentation fixture only renders stable, sanitized UI states.
}

onMounted(async () => {
  if (isSetupView.value || isGithubView.value) return
  await nextTick()
  window.requestAnimationFrame(() => {
    const panel = String(route.query.panel ?? '')
    const selector = panel === 'plus'
      ? '.thread-composer-attach-trigger'
      : panel === 'model'
        ? '.thread-composer-runtime-trigger'
        : ''
    if (selector) {
      document.querySelector<HTMLButtonElement>(selector)?.click()
    }
  })
})
</script>

<style scoped>
@reference "tailwindcss";

.docs-sidebar {
  @apply flex h-full min-h-0 flex-col;
  background: var(--ui-bg-sidebar);
}

.docs-sidebar-toolbar {
  @apply flex min-h-13 items-center justify-between gap-3 border-b px-3;
  border-color: var(--ui-border-subtle);
}

.docs-sidebar-brand {
  @apply flex min-w-0 items-center gap-2 text-sm font-semibold;
  color: var(--ui-text-primary);
}

.docs-sidebar-brand img {
  @apply h-7 w-7 rounded-lg;
}

.docs-sidebar-toolbar > button,
.docs-mobile-menu {
  @apply inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-0 bg-transparent;
  color: var(--ui-text-secondary);
}

.docs-sidebar-toolbar svg,
.docs-mobile-menu svg {
  @apply h-4.5 w-4.5;
}

.docs-sidebar-actions {
  @apply grid grid-cols-4 gap-1 border-b px-2 py-2;
  border-color: var(--ui-border-subtle);
}

.docs-sidebar-actions button {
  @apply flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg border-0 bg-transparent py-1.5 text-[11px];
  color: var(--ui-text-secondary);
}

.docs-sidebar-actions button:first-child {
  background: var(--ui-bg-row-active);
  color: var(--ui-text-primary);
}

.docs-sidebar-actions svg {
  @apply h-4 w-4;
}

.docs-sidebar-tree {
  @apply min-h-0 flex-1 overflow-y-auto px-2 py-2;
}

.docs-sidebar-settings {
  @apply flex min-h-11 items-center gap-2 border-0 border-t bg-transparent px-4 text-sm;
  border-color: var(--ui-border-subtle);
  color: var(--ui-text-secondary);
}

.docs-sidebar-settings svg {
  @apply h-4 w-4;
}

.docs-content {
  @apply flex h-full min-h-0 min-w-0 flex-col overflow-hidden;
  --content-shell-max-width: min(var(--ui-content-max), calc(100vw - 2.75rem));
  background: var(--ui-bg-surface);
}

.docs-content :deep(.content-header p) {
  @apply m-0 truncate text-[11px] leading-4;
  color: var(--ui-text-tertiary);
}

.docs-status {
  @apply inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium;
  border-color: var(--ui-border-subtle);
  color: var(--ui-text-secondary);
  background: var(--ui-bg-surface);
}

.docs-status i {
  @apply h-1.5 w-1.5 rounded-full bg-emerald-500;
}

.docs-content-body {
  @apply min-h-0 min-w-0 flex-1 overflow-hidden pt-0.5 pb-3;
}

.docs-conversation-grid {
  @apply mx-auto flex h-full min-h-0 min-w-0 w-full flex-col gap-2;
  width: min(100%, var(--content-shell-max-width));
}

.docs-conversation {
  @apply min-h-0 min-w-0 flex-1 overflow-hidden;
}

.docs-setup-page {
  @apply flex min-h-dvh w-full items-center justify-center px-5 py-8;
  background: var(--ui-bg-window);
  color: var(--ui-text-primary);
}

.docs-setup-card {
  @apply w-full max-w-md border p-5;
  border-radius: var(--ui-radius-composer);
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface);
  box-shadow: 0 14px 34px rgb(0 0 0 / 0.08);
}

.docs-setup-brand {
  @apply flex items-center gap-3;
}

.docs-setup-logo {
  @apply h-14 w-14 rounded-[18px] border border-white/80 bg-white object-contain;
}

.docs-setup-kicker {
  @apply m-0 text-xs font-semibold uppercase tracking-[0.12em] text-teal-700;
}

.docs-setup-brand h1 {
  @apply m-0 mt-1 text-2xl font-semibold leading-tight;
}

.docs-setup-copy {
  @apply m-0 mt-5 text-sm leading-6;
  color: var(--ui-text-secondary);
}

.docs-setup-field {
  @apply mt-4 flex flex-col gap-2 text-sm font-medium;
  color: var(--ui-text-secondary);
}

.docs-setup-field input {
  @apply min-h-12 w-full border px-4 text-base outline-none;
  border-radius: var(--ui-radius-control);
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface);
  color: var(--ui-text-primary);
}

.docs-setup-submit {
  @apply mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-2xl border border-teal-700 bg-teal-700 px-4 text-sm font-semibold text-white;
}

.docs-setup-note {
  @apply m-0 mt-3 text-xs leading-5;
  color: var(--ui-text-tertiary);
}

@media (max-width: 767px) {
  .docs-content {
    --content-shell-max-width: 100%;
  }

  .docs-content-body {
    @apply pb-1;
  }

  .docs-conversation-grid {
    @apply gap-1;
  }

  .docs-status {
    @apply px-1.5;
  }
}
</style>
