<template>
  <main class="task-pet-fixture">
    <section>
      <p>CX-Codex Android</p>
      <h1>任务宠物浮窗</h1>
      <button class="fixture-toggle" type="button" data-testid="toggle-task-state" @click="toggleTaskState">
        {{ items.length > 0 ? '切换为空闲' : '模拟任务到来' }}
      </button>
      <TaskPetPreview
        :items="items"
        :recent-threads="recentThreads"
        @open="lastAction = `打开会话：${$event}`"
        @enter="lastAction = '进入平台'"
        @close="lastAction = '关闭浮窗'"
        @reply="recordReply"
      />
      <output data-testid="task-pet-action">{{ lastAction }}</output>
    </section>
  </main>
</template>

<script setup lang="ts">
import TaskPetPreview from './TaskPetPreview.vue'
import { ref } from 'vue'
import type { UiTaskPetItem, UiTaskPetRecentThread } from '../../types/codex'

const lastAction = ref('等待操作')

const fixtureItems: UiTaskPetItem[] = [
  {
    threadId: 'fixture-running',
    title: '优化对话响应体验',
    projectName: 'CX-Codex',
    detail: '构建并验证安卓浮窗',
    latestActivity: '正在编译原生触控与吸边动画',
    latestReply: '原生浮窗的拖拽、吸边和后台状态同步已经完成，现在正在做最终 APK 构建验证。',
    state: 'running',
    updatedAtIso: '2026-07-17T10:00:00.000Z',
  },
  {
    threadId: 'fixture-waiting',
    title: '发布移动端新版本',
    projectName: 'Android',
    detail: '等待确认',
    latestActivity: '需要允许系统悬浮窗权限',
    latestReply: '发布前还需要你确认系统悬浮窗权限；确认后我会继续完成安装包验证。',
    state: 'waiting',
    updatedAtIso: '2026-07-17T09:59:00.000Z',
  },
]
const items = ref<UiTaskPetItem[]>(fixtureItems)

const recentThreads: UiTaskPetRecentThread[] = [
  {
    threadId: 'fixture-recent-one',
    title: '安卓浮窗实时同步优化',
    projectName: 'CX-Codex',
    updatedAtIso: '2026-07-17T10:02:00.000Z',
  },
  {
    threadId: 'fixture-recent-two',
    title: '会话可靠性回归验证',
    projectName: '7420',
    updatedAtIso: '2026-07-17T10:01:00.000Z',
  },
]

function recordReply(threadId: string, message: string) {
  lastAction.value = `回复会话：${threadId} · ${message}`
}

function toggleTaskState() {
  items.value = items.value.length > 0 ? [] : fixtureItems
}
</script>

<style scoped>
.task-pet-fixture {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background: #eef1f5;
  color: #1e2430;
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
}

.task-pet-fixture section {
  width: min(520px, 100%);
}

.task-pet-fixture p {
  margin: 0 0 4px;
  color: #596579;
  font-size: 13px;
}

.task-pet-fixture h1 {
  margin: 0 0 18px;
  font-size: 24px;
}

.fixture-toggle {
  min-height: 44px;
  margin: 0 0 12px;
  padding: 0 14px;
  border: 0;
  border-radius: 10px;
  background: #dfe8f8;
  color: #285a9e;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
}

.task-pet-fixture output {
  display: block;
  margin-top: 12px;
  color: #596579;
  font-size: 12px;
}
</style>
