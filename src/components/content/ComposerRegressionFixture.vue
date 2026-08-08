<template>
  <main class="composer-regression-fixture" aria-label="Composer shell regression fixture">
    <section class="composer-regression-frame">
      <div class="composer-regression-context">
        <p>Composer Regression</p>
        <h1>输入区视觉基线</h1>
      </div>
      <div class="composer-regression-probes" aria-label="Composer regression probes">
        <button
          class="composer-regression-dictation-insert"
          data-composer-regression-background-focus
          type="button"
          @click="insertMockDictation"
        >
          模拟语音转文字
        </button>
        <button
          v-if="isGoalSwitchFixture"
          class="composer-regression-dictation-insert"
          data-testid="switch-goal-thread"
          type="button"
          @click="switchFixtureGoalThread"
        >切换目标会话</button>
        <span v-if="isGoalSwitchFixture" data-testid="active-goal-thread">{{ fixtureThreadId }}</span>
        <span class="composer-regression-submit-count">{{ submitCount }}</span>
      </div>
      <ThreadGoalBar
        v-if="showGoalFixture"
        :key="fixtureThreadId"
        :goal="fixtureGoal"
        :is-loading="false"
        :is-updating="false"
        :error="fixtureGoalError"
        :plan-mode-active="selectedCollaborationMode === 'plan'"
        execution-hint="等待消息队列"
        @set-goal="updateFixtureGoal"
        @set-status="updateFixtureGoalStatus"
        @clear-goal="fixtureGoal = null"
        @retry="fixtureGoalError = ''"
      />
      <ThreadComposer
        ref="composerRef"
        active-thread-id="fixture-thread-composer"
        cwd="E:/workspace/CXCodex/codexui"
        :models="models"
        :available-models="availableModels"
        selected-model="gpt-5.5"
        selected-reasoning-effort="high"
        selected-speed-mode="fast"
        :selected-collaboration-mode="selectedCollaborationMode"
        :skills="skills"
        :plugins="plugins"
        :is-loading-plugins="false"
        :is-turn-in-progress="false"
        :is-interrupting-turn="false"
        :is-updating-speed-mode="false"
        :send-with-enter="sendWithEnter"
        :dictation-click-to-toggle="false"
        :dictation-auto-send="false"
        :show-dictation-button="true"
        dictation-language="zh"
        @submit="onSubmit"
        @update:selected-model="noop"
        @update:selected-reasoning-effort="noop"
        @update:selected-speed-mode="noop"
        @update:selected-collaboration-mode="selectedCollaborationMode = $event"
        @refresh-plugins="noop"
        @reload-plugins="noop"
        @login-plugin="noop"
        @interrupt="noop"
      />
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import ThreadComposer, { type SubmitPayload, type ThreadComposerExposed } from './ThreadComposer.vue'
import ThreadGoalBar from './ThreadGoalBar.vue'
import type { CollaborationMode, ComposerModelInfo, ComposerPluginInfo, ReasoningEffort, UiThreadGoal } from '../../types/codex'
import { useMobile } from '../../composables/useMobile'
import { resolveSendWithEnterPreference } from '../../composables/composerEnterBehavior'

const models = ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini']
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
    supportedReasoningEfforts: reasoningOptions(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']),
  },
  {
    id: 'gpt-5.4',
    model: 'gpt-5.4',
    displayName: 'GPT-5.4',
    description: '适合日常编码与协作。',
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
const composerRef = ref<ThreadComposerExposed | null>(null)
const submitCount = ref(0)
const fixtureParams = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.hash.split('?')[1] ?? '')
  : new URLSearchParams()
const showGoalFixture = fixtureParams.get('goal') === '1'
const isGoalSwitchFixture = fixtureParams.get('goalSwitch') === '1'
const fixtureThreadId = ref(isGoalSwitchFixture ? 'fixture-thread-a' : 'fixture-thread-composer')
const selectedCollaborationMode = ref<CollaborationMode>(fixtureParams.get('planMode') === '1' ? 'plan' : 'execute')
const fixtureGoalError = ref(fixtureParams.get('goalError') === '1' ? '持续目标同步失败，请重试。' : '')
const fixtureGoal = ref<UiThreadGoal | null>(fixtureParams.get('goalEmpty') === '1' ? null : {
  threadId: fixtureThreadId.value,
  objective: '持续完善 7420 的稳定性与细节体验，并以可复现回归作为完成标准。',
  status: 'active',
  tokenBudget: 120_000,
  tokensUsed: 36_800,
  timeUsedSeconds: 4_260,
  createdAt: Date.now() - 4_260_000,
  updatedAt: Date.now(),
})
const { isMobile } = useMobile()
const sendWithEnter = computed(() => resolveSendWithEnterPreference(null, isMobile.value))
const originalFetch = window.fetch
const composerFixtureFetch: typeof window.fetch = async (input, init) => {
  const requestUrl = typeof input === 'string'
    ? input
    : (input instanceof URL ? input.toString() : input.url)
  if (!requestUrl.includes('/codex-api/composer-file-search')) {
    return originalFetch(input, init)
  }
  return new Response(JSON.stringify({
    data: [
      { path: 'src/components/content/ThreadComposer.vue' },
      { path: 'src/components/content/ThreadConversation.vue' },
      { path: 'src/App.vue' },
    ],
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
window.fetch = composerFixtureFetch

const skills = [
  {
    name: 'ui-ux-pro-max',
    description: '前端 UI/UX 优化',
    path: 'C:/ExampleUser/.agents/skills/ui-ux-pro-max/SKILL.md',
  },
]

const plugins: ComposerPluginInfo[] = [
  {
    id: 'browser@openai-bundled',
    name: 'Browser',
    description: '控制 Codex 内置浏览器。',
    source: 'plugin',
    mentionPath: 'plugin://browser@openai-bundled',
    authStatus: 'unknown',
    isAccessible: true,
    isEnabled: true,
    distributionChannel: null,
    installUrl: null,
    toolCount: 0,
    resourceCount: 0,
    resourceTemplateCount: 0,
    tools: [
      {
        name: 'browser_open',
        title: '打开页面',
        description: '在内置浏览器中打开页面',
      },
    ],
  },
]

function noop(): void {
  // Fixture route only needs rendered output for browser assertions.
}

function updateFixtureGoal(objective: string): void {
  fixtureGoal.value = fixtureGoal.value
    ? { ...fixtureGoal.value, objective, updatedAt: Date.now() }
    : {
        threadId: fixtureThreadId.value,
        objective,
        status: 'active',
        tokenBudget: null,
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
}

function updateFixtureGoalStatus(status: 'active' | 'paused'): void {
  if (!fixtureGoal.value) return
  fixtureGoal.value = { ...fixtureGoal.value, status, updatedAt: Date.now() }
}

function switchFixtureGoalThread(): void {
  fixtureThreadId.value = fixtureThreadId.value === 'fixture-thread-a' ? 'fixture-thread-b' : 'fixture-thread-a'
  fixtureGoal.value = {
    threadId: fixtureThreadId.value,
    objective: `持续目标：${fixtureThreadId.value}`,
    status: 'active',
    tokenBudget: 120_000,
    tokensUsed: 36_800,
    timeUsedSeconds: 4_260,
    createdAt: Date.now() - 4_260_000,
    updatedAt: Date.now(),
  }
}

function onSubmit(_payload: SubmitPayload): void {
  submitCount.value += 1
}

function insertMockDictation(): void {
  composerRef.value?.insertDictationTranscriptForRegression('语音转文字回归测试')
}

onBeforeUnmount(() => {
  if (window.fetch === composerFixtureFetch) window.fetch = originalFetch
})
</script>

<style scoped>
@reference "tailwindcss";

.composer-regression-fixture {
  @apply flex min-h-dvh items-end px-3 py-6 sm:px-6;
  background: var(--ui-bg-window);
  color: var(--ui-text-primary);
}

.composer-regression-frame {
  @apply mx-auto flex w-full flex-col gap-4;
  max-width: var(--ui-composer-max);
}

.composer-regression-probes {
  @apply flex items-center gap-2 px-5 text-xs;
}

.composer-regression-dictation-insert {
  @apply rounded-md border px-2 py-1 text-xs;
  border-color: var(--ui-border-subtle);
  color: var(--ui-text-secondary);
}

.composer-regression-submit-count {
  @apply sr-only;
}

.composer-regression-context {
  @apply hidden sm:block px-5;
}

.composer-regression-context p {
  @apply m-0 text-xs font-medium;
  color: var(--ui-text-tertiary);
}

.composer-regression-context h1 {
  @apply m-0 mt-1 text-lg font-semibold;
  color: var(--ui-text-primary);
}
</style>
