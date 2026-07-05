<template>
  <main class="composer-regression-fixture" aria-label="Composer shell regression fixture">
    <section class="composer-regression-frame">
      <div class="composer-regression-context">
        <p>Composer Regression</p>
        <h1>输入区视觉基线</h1>
      </div>
      <ThreadComposer
        active-thread-id="fixture-thread-composer"
        cwd="E:/javaword/CXCodex/codexui"
        :models="models"
        selected-model="gpt-5.5-codex"
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
    </section>
  </main>
</template>

<script setup lang="ts">
import ThreadComposer from './ThreadComposer.vue'
import type { ComposerPluginInfo } from '../../types/codex'

const models = ['gpt-5.5-codex', 'gpt-5.5', 'o3']

const skills = [
  {
    name: 'ui-ux-pro-max',
    description: '前端 UI/UX 优化',
    path: 'C:/Users/SW/.agents/skills/ui-ux-pro-max/SKILL.md',
  },
]

const plugins: ComposerPluginInfo[] = [
  {
    id: 'github',
    name: 'GitHub',
    description: 'GitHub repository context',
    source: 'app',
    mentionPath: 'app:github',
    authStatus: 'unknown',
    isAccessible: true,
    isEnabled: true,
    distributionChannel: null,
    installUrl: null,
    toolCount: 3,
    resourceCount: 0,
    resourceTemplateCount: 0,
    tools: [
      {
        name: 'search_issues',
        title: 'Search issues',
        description: 'Search repository issues',
      },
    ],
  },
]

function noop(): void {
  // Fixture route only needs rendered output for browser assertions.
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
