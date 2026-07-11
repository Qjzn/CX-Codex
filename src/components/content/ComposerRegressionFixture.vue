<template>
  <main class="composer-regression-fixture" aria-label="Composer shell regression fixture">
    <section class="composer-regression-frame">
      <div class="composer-regression-context">
        <p>Composer Regression</p>
        <h1>输入区视觉基线</h1>
      </div>
      <div class="composer-regression-probes" aria-label="Composer regression probes">
        <button class="composer-regression-dictation-insert" type="button" @click="insertMockDictation">
          模拟语音转文字
        </button>
        <span class="composer-regression-submit-count">{{ submitCount }}</span>
      </div>
      <ThreadComposer
        ref="composerRef"
        active-thread-id="fixture-thread-composer"
        cwd="E:/javaword/CXCodex/codexui"
        :models="models"
        :available-models="availableModels"
        selected-model="gpt-5.5"
        selected-reasoning-effort="high"
        selected-speed-mode="fast"
        selected-collaboration-mode="execute"
        :skills="skills"
        :plugins="plugins"
        :is-loading-plugins="false"
        :is-turn-in-progress="false"
        :is-interrupting-turn="false"
        :is-updating-speed-mode="false"
        :send-with-enter="true"
        :dictation-click-to-toggle="false"
        :dictation-auto-send="false"
        :show-dictation-button="true"
        dictation-language="zh"
        @submit="onSubmit"
        @update:selected-model="noop"
        @update:selected-reasoning-effort="noop"
        @update:selected-speed-mode="noop"
        @update:selected-collaboration-mode="noop"
        @refresh-plugins="noop"
        @reload-plugins="noop"
        @login-plugin="noop"
        @interrupt="noop"
      />
    </section>
  </main>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import ThreadComposer, { type SubmitPayload, type ThreadComposerExposed } from './ThreadComposer.vue'
import type { ComposerModelInfo, ComposerPluginInfo, ReasoningEffort } from '../../types/codex'

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
    supportedReasoningEfforts: reasoningOptions(['low', 'medium', 'high', 'xhigh']),
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

const skills = [
  {
    name: 'ui-ux-pro-max',
    description: '前端 UI/UX 优化',
    path: 'C:/Users/SW/.agents/skills/ui-ux-pro-max/SKILL.md',
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

function onSubmit(_payload: SubmitPayload): void {
  submitCount.value += 1
}

function insertMockDictation(): void {
  composerRef.value?.insertDictationTranscriptForRegression('语音转文字回归测试')
}
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
