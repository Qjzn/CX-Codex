<template>
  <section class="workspace-workbench" aria-label="工作台">
    <div class="workbench-hero">
      <div class="workbench-hero-copy">
        <p class="workbench-eyebrow">任务工作台</p>
        <h2 class="workbench-title">{{ projectName || '当前工作区' }}</h2>
        <p class="workbench-subtitle">{{ projectPath || '先选择一个工作目录，再发起标准化任务。' }}</p>
      </div>
      <div class="workbench-hero-actions">
        <button class="workbench-button" type="button" @click="$emit('refresh')">刷新状态</button>
        <button class="workbench-button workbench-button-primary" type="button" @click="$emit('openDiagnostics')">
          运行诊断
        </button>
      </div>
    </div>

    <div class="workbench-status-grid">
      <article
        v-for="item in statusItems"
        :key="item.label"
        class="workbench-status-card"
        :data-tone="item.tone"
      >
        <span class="workbench-status-label">{{ item.label }}</span>
        <strong class="workbench-status-value">{{ item.value }}</strong>
        <span v-if="item.detail" class="workbench-status-detail">{{ item.detail }}</span>
      </article>
    </div>

    <div class="workbench-main-grid">
      <section class="workbench-panel" aria-label="项目默认配置">
        <div class="workbench-panel-heading">
          <div>
            <p class="workbench-panel-kicker">项目配置</p>
            <h3 class="workbench-panel-title">一键复用默认能力</h3>
          </div>
          <span class="workbench-panel-badge">{{ hasPreset ? '已保存' : '未保存' }}</span>
        </div>

        <dl class="workbench-config-list">
          <div>
            <dt>模型</dt>
            <dd>{{ modelLabel }}</dd>
          </div>
          <div>
            <dt>质量</dt>
            <dd>{{ reasoningLabel }}</dd>
          </div>
          <div>
            <dt>速度</dt>
            <dd>{{ speedLabel }}</dd>
          </div>
          <div>
            <dt>模式</dt>
            <dd>{{ collaborationLabel }}</dd>
          </div>
          <div>
            <dt>运行</dt>
            <dd>{{ runtimeLabel }}</dd>
          </div>
        </dl>

        <p v-if="presetSummary" class="workbench-config-note">{{ presetSummary }}</p>
        <p v-else class="workbench-config-note">保存后，新任务前可以快速恢复该项目常用模型、质量、速度和运行方式。</p>

        <div class="workbench-actions">
          <button class="workbench-button workbench-button-primary" type="button" @click="$emit('savePreset')">
            保存当前配置
          </button>
          <button class="workbench-button" type="button" :disabled="!hasPreset" @click="$emit('applyPreset')">
            应用默认配置
          </button>
        </div>
      </section>

      <section class="workbench-panel" aria-label="常用任务模板">
        <div class="workbench-panel-heading">
          <div>
            <p class="workbench-panel-kicker">任务模板</p>
            <h3 class="workbench-panel-title">少输入，少漏项</h3>
          </div>
          <span class="workbench-panel-badge">{{ templates.length }} 项</span>
        </div>

        <div class="workbench-template-list">
          <article v-for="template in templates" :key="template.id" class="workbench-template-card">
            <div class="workbench-template-copy">
              <span class="workbench-template-badge">{{ template.badge }}</span>
              <h4>{{ template.title }}</h4>
              <p>{{ template.description }}</p>
            </div>
            <button
              class="workbench-button workbench-button-primary"
              type="button"
              :disabled="isSending"
              @click="$emit('runTemplate', template.id)"
            >
              发起
            </button>
          </article>
        </div>
      </section>
    </div>

    <section class="workbench-quick-actions" aria-label="快捷入口">
      <button class="workbench-quick-action" type="button" @click="$emit('openSkills')">
        <span>技能中心</span>
        <small>安装和同步技能</small>
      </button>
      <button class="workbench-quick-action" type="button" @click="$emit('openGithubTrending')">
        <span>GitHub 热门</span>
        <small>从项目链接快速提问</small>
      </button>
      <button class="workbench-quick-action" type="button" @click="$emit('openDiagnostics')">
        <span>运行诊断</span>
        <small>查看队列、事件和慢调用</small>
      </button>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CollaborationMode, ReasoningEffort, SpeedMode } from '../../types/codex'

type StatusTone = 'good' | 'warning' | 'danger' | 'neutral'

type WorkbenchStatusItem = {
  label: string
  value: string
  detail?: string
  tone: StatusTone
}

type WorkbenchTemplate = {
  id: string
  title: string
  description: string
  badge: string
}

const props = defineProps<{
  projectName: string
  projectPath: string
  runtime: 'local' | 'worktree'
  selectedModel: string
  selectedReasoningEffort: ReasoningEffort | ''
  selectedSpeedMode: SpeedMode
  selectedCollaborationMode: CollaborationMode
  hasPreset: boolean
  presetSummary: string
  statusItems: WorkbenchStatusItem[]
  templates: WorkbenchTemplate[]
  isSending: boolean
}>()

defineEmits<{
  runTemplate: [templateId: string]
  savePreset: []
  applyPreset: []
  openDiagnostics: []
  openSkills: []
  openGithubTrending: []
  refresh: []
}>()

const reasoningLabels: Record<string, string> = {
  none: '无',
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
}

const modelLabel = computed(() => props.selectedModel.trim() || '未选择')
const reasoningLabel = computed(() => reasoningLabels[props.selectedReasoningEffort] ?? '智能')
const speedLabel = computed(() => props.selectedSpeedMode === 'fast' ? '快速' : '标准')
const collaborationLabel = computed(() => props.selectedCollaborationMode === 'plan' ? '计划' : '执行')
const runtimeLabel = computed(() => props.runtime === 'worktree' ? '新工作树' : '当前项目')
</script>

<style scoped>
.workspace-workbench {
  width: 100%;
  display: grid;
  gap: 1rem;
  color: #1f2937;
}

.workbench-hero,
.workbench-panel,
.workbench-quick-actions {
  border: 1px solid #e7ded0;
  background: rgba(255, 253, 248, 0.92);
  box-shadow: 0 18px 42px -34px rgba(31, 41, 55, 0.35);
}

.workbench-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  border-radius: 18px;
  padding: 1.1rem;
}

.workbench-hero-copy {
  min-width: 0;
}

.workbench-eyebrow,
.workbench-panel-kicker,
.workbench-status-label,
.workbench-template-badge {
  margin: 0;
  color: #8a7864;
  font-size: 0.78rem;
  font-weight: 700;
}

.workbench-title {
  margin: 0.2rem 0 0;
  color: #14213d;
  font-size: 1.75rem;
  line-height: 1.15;
}

.workbench-subtitle {
  margin: 0.45rem 0 0;
  max-width: 44rem;
  overflow-wrap: anywhere;
  color: #6f6559;
  font-size: 0.95rem;
  line-height: 1.55;
}

.workbench-hero-actions,
.workbench-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
}

.workbench-status-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.8rem;
}

.workbench-status-card {
  min-height: 6.6rem;
  display: grid;
  gap: 0.35rem;
  align-content: start;
  border: 1px solid #e8dfd3;
  border-radius: 16px;
  background: #fffdf8;
  padding: 0.9rem;
}

.workbench-status-card[data-tone='good'] {
  border-color: #b9e7dc;
  background: #f1fffb;
}

.workbench-status-card[data-tone='warning'] {
  border-color: #ead7a0;
  background: #fff9e6;
}

.workbench-status-card[data-tone='danger'] {
  border-color: #f0b7ae;
  background: #fff4f2;
}

.workbench-status-value {
  color: #172033;
  font-size: 1.05rem;
  line-height: 1.25;
}

.workbench-status-detail {
  color: #756c61;
  font-size: 0.82rem;
  line-height: 1.4;
}

.workbench-main-grid {
  display: grid;
  grid-template-columns: minmax(18rem, 0.85fr) minmax(0, 1.15fr);
  gap: 1rem;
}

.workbench-panel {
  border-radius: 18px;
  padding: 1rem;
}

.workbench-panel-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.9rem;
}

.workbench-panel-title {
  margin: 0.2rem 0 0;
  color: #182338;
  font-size: 1.25rem;
  line-height: 1.2;
}

.workbench-panel-badge {
  flex: 0 0 auto;
  border: 1px solid #d8cbb9;
  border-radius: 999px;
  padding: 0.25rem 0.55rem;
  color: #6b5e4f;
  font-size: 0.78rem;
  font-weight: 700;
}

.workbench-config-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.65rem;
  margin: 0;
}

.workbench-config-list div {
  border: 1px solid #ebe3d7;
  border-radius: 12px;
  background: #fbfaf6;
  padding: 0.7rem;
}

.workbench-config-list dt {
  color: #8b7c68;
  font-size: 0.76rem;
  font-weight: 700;
}

.workbench-config-list dd {
  margin: 0.25rem 0 0;
  color: #1f2937;
  font-size: 0.95rem;
  font-weight: 800;
}

.workbench-config-note {
  margin: 0.85rem 0 0;
  color: #6f6559;
  font-size: 0.86rem;
  line-height: 1.55;
}

.workbench-actions {
  margin-top: 0.95rem;
}

.workbench-template-list {
  display: grid;
  gap: 0.72rem;
}

.workbench-template-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
  border: 1px solid #ebe3d7;
  border-radius: 14px;
  background: #fffdf8;
  padding: 0.78rem;
}

.workbench-template-copy {
  min-width: 0;
}

.workbench-template-card h4 {
  margin: 0.2rem 0 0;
  color: #172033;
  font-size: 1rem;
  line-height: 1.3;
}

.workbench-template-card p {
  margin: 0.25rem 0 0;
  color: #71685d;
  font-size: 0.86rem;
  line-height: 1.45;
}

.workbench-button {
  min-height: 2.5rem;
  border: 1px solid #d8cbb9;
  border-radius: 999px;
  background: #fffdf8;
  padding: 0.55rem 0.9rem;
  color: #31291f;
  font-size: 0.9rem;
  font-weight: 800;
  transition: border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
}

.workbench-button:hover:not(:disabled) {
  border-color: #0f9488;
  box-shadow: 0 12px 28px -24px rgba(15, 148, 136, 0.7);
  transform: translateY(-1px);
}

.workbench-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.workbench-button-primary {
  border-color: #0f9488;
  background: #0f9488;
  color: #ffffff;
}

.workbench-quick-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
  border-radius: 18px;
  padding: 0.85rem;
}

.workbench-quick-action {
  display: grid;
  gap: 0.2rem;
  border: 1px solid #ebe3d7;
  border-radius: 14px;
  background: #fbfaf6;
  padding: 0.85rem;
  text-align: left;
}

.workbench-quick-action span {
  color: #1f2937;
  font-size: 0.95rem;
  font-weight: 800;
}

.workbench-quick-action small {
  color: #756c61;
  font-size: 0.78rem;
  line-height: 1.35;
}

@media (max-width: 920px) {
  .workbench-hero {
    display: grid;
  }

  .workbench-status-grid,
  .workbench-main-grid,
  .workbench-quick-actions {
    grid-template-columns: 1fr;
  }

  .workbench-status-card {
    min-height: auto;
  }
}

@media (max-width: 560px) {
  .workspace-workbench {
    gap: 0.8rem;
  }

  .workbench-hero,
  .workbench-panel,
  .workbench-quick-actions {
    border-radius: 14px;
    padding: 0.85rem;
  }

  .workbench-title {
    font-size: 1.35rem;
  }

  .workbench-config-list {
    grid-template-columns: 1fr;
  }

  .workbench-template-card {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
