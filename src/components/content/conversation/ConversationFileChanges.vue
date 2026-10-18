<template>
  <details v-if="fileChanges.length > 0" class="file-summary">
    <summary>
      <span class="file-summary-icon" aria-hidden="true">±</span>
      <span class="file-summary-title">文件变更</span>
      <span class="file-summary-meta">{{ summaryLabel }}</span>
      <span class="file-summary-chevron" aria-hidden="true">›</span>
    </summary>
    <div class="file-list">
      <div v-for="file in fileChanges" :key="file.path" class="file-row">
        <div class="file-row-head">
          <span class="file-kind" :data-kind="file.kind">{{ fileKindLabel(file.kind) }}</span>
          <code :title="file.path">{{ file.path }}</code>
          <span class="file-stats"><b>+{{ file.additions }}</b> <i>-{{ file.removals }}</i></span>
        </div>
        <pre v-if="file.diff" class="file-diff">{{ file.diff }}</pre>
      </div>
    </div>
  </details>
</template>

<script setup lang="ts">
// 展示组件：只接收数据，不读全局状态；文件汇总与明细都在这里，
// 父组件（ThreadConversation）只负责传入 turn.fileChanges。
import { computed } from 'vue'
import { fileKindLabel, fileSummaryLabel } from './format'

export type ConversationFileChangeView = {
  path: string
  kind: 'add' | 'delete' | 'update'
  additions: number
  removals: number
  diff?: string | null
}

const props = defineProps<{ fileChanges: ConversationFileChangeView[] }>()
const summaryLabel = computed(() => fileSummaryLabel({ fileChanges: props.fileChanges }))
</script>

<style scoped>
.file-summary {
  /* 扁平化：不再是一张卡里套一行行文件；用一条上分隔线表明这是一段附属信息。 */
  margin: 6px 0 14px;
  border: 0;
  border-top: 1px solid var(--ui-border-subtle);
  border-radius: 0;
  background: transparent;
  overflow: visible;
}

.file-summary > summary,
.file-row-head {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  list-style: none;
}

.file-summary > summary {
  min-height: 46px;
  padding: 5px 10px;
  cursor: pointer;
  color: var(--ui-text-secondary);
  font-size: 12.5px;
  transition: background-color var(--motion-duration-fast) var(--motion-ease-standard);
}

.file-summary > summary:hover {
  background: var(--ui-bg-row-hover);
}

.file-summary-icon {
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  place-items: center;
  border-radius: 8px;
  background: var(--ui-bg-surface-muted);
  color: var(--ui-text-secondary);
  font-family: var(--font-mono-ui);
  font-size: 13px;
  font-weight: 700;
}

.file-summary-title {
  color: var(--ui-text-primary);
  font-size: 13.5px;
  font-weight: 650;
}

.file-summary-meta {
  margin-left: auto;
  color: var(--ui-text-tertiary);
  font-family: var(--font-mono-ui);
  font-size: 11.5px;
}

.file-summary-chevron {
  display: inline-grid;
  width: 14px;
  height: 14px;
  place-items: center;
  color: var(--ui-text-tertiary);
  font-size: 16px;
  line-height: 1;
  transform: rotate(0deg);
  transition: transform var(--motion-duration-base) var(--motion-ease-out);
}

.file-summary[open] .file-summary-chevron {
  transform: rotate(90deg);
}

.file-list {
  display: grid;
  /* 手机宽度下 details 的 min-content（长路径 + 行数）会把网格列撑到 419px，
     父级 overflow hidden 后右侧被裁掉；把列锁成可收缩的 minmax(0, 1fr)。 */
  grid-template-columns: minmax(0, 1fr);
  gap: 0;
  padding: 4px;
  border-top: 1px solid var(--ui-border-subtle);
}

.file-row {
  min-width: 0;
  margin: 0;
  border: 0;
}

.file-row-head {
  min-height: 34px;
  padding: 4px 8px;
  border-radius: 6px;
}

.file-row code {
  min-width: 0;
  overflow: hidden;
  color: var(--ui-text-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-row pre {
  box-sizing: border-box;
  max-width: 100%;
  margin: 3px 8px 8px;
  padding: 12px 14px;
  overflow: auto;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 10px;
  background: color-mix(in srgb, var(--ui-bg-surface-muted) 86%, var(--ui-bg-window));
  color: var(--ui-text-primary);
  font: 12.5px/1.55 var(--font-mono-ui);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.file-kind {
  flex: 0 0 auto;
  color: var(--ui-text-tertiary);
  font-size: 11px;
}

.file-kind[data-kind='add'] { color: var(--ui-success); }
.file-kind[data-kind='delete'] { color: var(--ui-danger); }

.file-stats {
  display: flex;
  flex: 0 0 auto;
  gap: 4px;
  margin-left: auto;
  font-size: 11px;
  font-style: normal;
}

.file-stats b { color: var(--ui-success); }
.file-stats i { color: var(--ui-danger); font-style: normal; }

@media (max-width: 767px) {
  .file-summary {
    padding-inline-start: 2px;
  }

  .file-summary > summary {
    min-height: 38px;
    padding-inline: 0;
  }

  /* 去掉逐文件折叠后 diff 直接展开，单块超过 340px 时内部滚动，避免一轮吃掉整屏。 */
  .file-diff {
    max-height: 340px;
    overflow: auto;
  }

  .file-summary-icon {
    width: 20px;
    height: 20px;
    flex-basis: 20px;
    border-radius: 6px;
  }

  .file-row-head {
    align-items: center;
    flex-wrap: nowrap;
    gap: 7px;
  }

  .file-row code {
    width: auto;
    flex: 1 1 auto;
    white-space: nowrap;
  }

  .file-stats {
    margin-left: auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .file-summary-chevron {
    transition-duration: 1ms;
  }
}
</style>
