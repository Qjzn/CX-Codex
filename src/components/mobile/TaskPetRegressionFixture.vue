<template>
  <main class="task-pet-fixture">
    <section>
      <p>CX-Codex Android</p>
      <h1>任务宠物浮窗</h1>
      <button class="fixture-toggle" type="button" data-testid="toggle-task-state" @click="toggleTaskState">
        {{ items.length > 0 ? '切换为空闲' : '模拟任务到来' }}
      </button>
      <button
        class="fixture-toggle"
        type="button"
        data-testid="simulate-latest-reply"
        :disabled="items.length === 0"
        @click="simulateLatestReply"
      >
        模拟最新回复
      </button>
      <aside
        v-if="showBlockedCompletionChannel"
        class="fixture-notification-recovery"
        role="region"
        aria-label="任务通知恢复：任务完成通道已关闭"
      >
        <div>
          <span>通知权限</span>
          <strong>任务完成通道已关闭</strong>
        </div>
        <button type="button">开启任务通知</button>
      </aside>
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
import { useRoute } from 'vue-router'
import type { UiTaskPetItem, UiTaskPetRecentThread } from '../../types/codex'

const lastAction = ref('等待操作')
const route = useRoute()
const showBlockedCompletionChannel = route.query.channelBlocked === '1'

const fixtureItems: UiTaskPetItem[] = [
  {
    threadId: 'fixture-running',
    title: '优化对话响应体验',
    projectName: 'CX-Codex',
    detail: '构建并验证安卓浮窗',
    latestActivity: '正在编译原生触控与吸边动画',
    latestReply: '原生浮窗的拖拽、吸边和后台状态同步已经完成，现在正在做最终 APK 构建验证。',
    state: 'running',
    updatedAtIso: new Date(Date.now() - 2 * 60_000).toISOString(),
  },
  {
    threadId: 'fixture-waiting',
    title: '发布移动端新版本',
    projectName: 'Android',
    detail: '等待确认',
    latestActivity: '需要允许系统悬浮窗权限',
    latestReply: '发布前还需要你确认系统悬浮窗权限；确认后我会继续完成安装包验证。',
    state: 'waiting',
    updatedAtIso: new Date(Date.now() - 32 * 60_000).toISOString(),
  },
]
const multiTaskLatestReplyItems: UiTaskPetItem[] = [
  {
    threadId: 'fixture-latest-reply',
    title: '刚刚产生最新回复的任务',
    projectName: 'Android',
    detail: '实时同步',
    latestActivity: '权威快照已经应用',
    latestReply: '最新回复已提升到浮窗可见首行。',
    state: 'running',
    updatedAtIso: new Date().toISOString(),
  },
  ...fixtureItems,
  {
    threadId: 'fixture-hidden-oldest',
    title: '较早的后台任务',
    projectName: '7420',
    detail: '继续运行',
    latestActivity: '保持后台监控',
    latestReply: '这条较早回复应留在前三条之外。',
    state: 'running',
    updatedAtIso: new Date(Date.now() - 45 * 60_000).toISOString(),
  },
]
const initialItems = route.query.latestReplyBurst === '1' ? multiTaskLatestReplyItems : fixtureItems
const items = ref<UiTaskPetItem[]>(initialItems)

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
  items.value = items.value.length > 0 ? [] : initialItems
}

function simulateLatestReply() {
  const first = items.value[0]
  if (!first) return
  items.value = [
    {
      ...first,
      latestReply: '浮窗已实时同步最新回复；点击这条气泡会打开当前会话。',
      updatedAtIso: new Date().toISOString(),
    },
    ...items.value.slice(1),
  ]
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

.fixture-toggle + .fixture-toggle {
  margin-left: 8px;
}

.fixture-notification-recovery {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0 0 12px;
  padding: 12px 14px;
  border: 1px solid #e2b976;
  border-radius: 12px;
  background: #fff9ed;
}

.fixture-notification-recovery div {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.fixture-notification-recovery span {
  color: #75644b;
  font-size: 11px;
}

.fixture-notification-recovery strong {
  color: #8b5513;
  font-size: 13px;
}

.fixture-notification-recovery button {
  min-height: 44px;
  flex: 0 0 auto;
  padding: 0 13px;
  border: 0;
  border-radius: 10px;
  background: #285a9e;
  color: #fff;
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
