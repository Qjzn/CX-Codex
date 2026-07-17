<template>
  <main class="task-pet-fixture">
    <section>
      <p>CX-Codex Android</p>
      <h1>任务宠物浮窗</h1>
      <TaskPetPreview :items="items" />
    </section>
  </main>
</template>

<script setup lang="ts">
import TaskPetPreview from './TaskPetPreview.vue'
import type { UiTaskPetItem } from '../../types/codex'

const items: UiTaskPetItem[] = [
  {
    threadId: 'fixture-running',
    title: '优化对话响应体验',
    projectName: 'CX-Codex',
    detail: '构建并验证安卓浮窗',
    latestActivity: '正在编译原生触控与吸边动画',
    state: 'running',
    updatedAtIso: '2026-07-17T10:00:00.000Z',
  },
  {
    threadId: 'fixture-waiting',
    title: '发布移动端新版本',
    projectName: 'Android',
    detail: '等待确认',
    latestActivity: '需要允许系统悬浮窗权限',
    state: 'waiting',
    updatedAtIso: '2026-07-17T09:59:00.000Z',
  },
]
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
</style>
