<template>
  <section class="remote-access" aria-label="手机访问">
    <div class="remote-access-heading">
      <div>
        <p class="remote-access-kicker">手机访问</p>
        <p class="remote-access-title">{{ title }}</p>
      </div>
      <span class="remote-access-state" :data-tone="tone">{{ stateLabel }}</span>
    </div>

    <p class="remote-access-description">{{ description }}</p>

    <div v-if="status?.active && status.publicUrl" class="remote-access-url-row">
      <code class="remote-access-url">{{ status.publicUrl }}</code>
      <button type="button" class="remote-access-icon-button" title="复制地址" @click="copyPublicUrl">
        复制
      </button>
    </div>

    <div v-if="status?.active" class="remote-access-checks" aria-label="安全验证">
      <span :data-ok="status.verification.health">健康</span>
      <span :data-ok="status.verification.auth">密码</span>
      <span :data-ok="status.verification.websocketAuth">消息连接</span>
    </div>

    <div class="remote-access-actions">
      <button
        v-if="!status?.active"
        type="button"
        class="remote-access-primary"
        :disabled="isBusy"
        @click="startAccess"
      >
        {{ isBusy ? busyLabel : '生成手机访问地址' }}
      </button>
      <template v-else>
        <button type="button" class="remote-access-primary" @click="openPublicUrl">手机地址</button>
        <button
          type="button"
          class="remote-access-secondary"
          :disabled="isBusy"
          @click="stopAccess"
        >
          {{ isBusy ? '停止中…' : '停止访问' }}
        </button>
      </template>
      <button
        type="button"
        class="remote-access-secondary"
        :disabled="isBusy"
        @click="onRefreshClick"
      >
        刷新
      </button>
      <button
        v-if="canOpenLocalPairing"
        type="button"
        class="remote-access-secondary"
        @click="openLocalPairing"
      >
        查看登录密码
      </button>
    </div>

    <p v-if="message" class="remote-access-message" :data-tone="tone" role="status">
      {{ message }}
    </p>
    <p class="remote-access-footnote">
      免费临时地址；无需域名和服务器。{{ networkHint }}CX-Codex 或电脑关闭后地址失效。
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import {
  getTunnelStatus,
  startQuickTunnelAccess,
  stopQuickTunnelAccess,
  type TunnelStatus,
} from '../../api/codexGateway'

const status = ref<TunnelStatus | null>(null)
const isStarting = ref(false)
const isStopping = ref(false)
const message = ref('')
let pollingTimer: number | null = null

const isBusy = computed(() => (
  isStarting.value
  || isStopping.value
  || status.value?.phase === 'installing'
  || status.value?.phase === 'starting'
  || status.value?.phase === 'verifying'
  || status.value?.phase === 'stopping'
))
const canOpenLocalPairing = computed(() => (
  window.location.hostname === '127.0.0.1'
  || window.location.hostname === 'localhost'
  || window.location.hostname === '::1'
))

const tone = computed(() => {
  if (status.value?.active) return 'success'
  if (status.value?.phase === 'error') return 'danger'
  if (isBusy.value) return 'progress'
  return 'neutral'
})

const title = computed(() => (
  status.value?.active ? '临时通道已就绪' : '从手机安全访问这台电脑'
))

const stateLabel = computed(() => {
  if (status.value?.active) return '已开启'
  if (status.value?.phase === 'error') return '需要处理'
  if (isBusy.value) return '处理中'
  return '未开启'
})

const busyLabel = computed(() => {
  if (status.value?.phase === 'installing') return '正在校验组件…'
  if (status.value?.phase === 'verifying') return '正在安全验证…'
  return '正在生成地址…'
})

const description = computed(() => {
  if (status.value?.active) return '公网健康、访问密码和消息连接均已验证，可以复制到手机使用。'
  if (status.value?.phase === 'error') return status.value.reason || '开启失败，请检查提示后重试。'
  return '自动安装并校验 Cloudflare 组件，不开放路由器端口，也不修改系统 DNS。'
})
const networkHint = computed(() => (
  status.value?.networkMode === 'scoped-doh'
    ? '当前仅为本次连接使用安全 DNS 回退，未修改系统设置。'
    : ''
))

function stopPolling(): void {
  if (pollingTimer === null) return
  window.clearInterval(pollingTimer)
  pollingTimer = null
}

function startPolling(): void {
  stopPolling()
  pollingTimer = window.setInterval(() => {
    void refreshStatus({ quiet: true })
  }, 1_200)
}

async function refreshStatus(options: { quiet?: boolean } = {}): Promise<void> {
  try {
    status.value = await getTunnelStatus()
    if (!options.quiet) message.value = status.value.reason
  } catch (error) {
    if (!options.quiet) {
      message.value = error instanceof Error ? error.message : '读取手机访问状态失败。'
    }
  }
}

function onRefreshClick(): void {
  void refreshStatus()
}

async function startAccess(): Promise<void> {
  if (isBusy.value) return
  isStarting.value = true
  message.value = '正在下载或检查官方 cloudflared，并完成公网安全验证…'
  startPolling()
  try {
    status.value = await startQuickTunnelAccess(status.value?.configuredCommand ?? '')
    message.value = '手机访问地址已生成。首次打开需要输入 CX-Codex 访问密码。'
  } catch (error) {
    message.value = error instanceof Error ? error.message : '生成手机访问地址失败。'
    await refreshStatus({ quiet: true })
  } finally {
    isStarting.value = false
    stopPolling()
  }
}

async function stopAccess(): Promise<void> {
  if (isBusy.value) return
  isStopping.value = true
  message.value = '正在关闭临时通道…'
  try {
    status.value = await stopQuickTunnelAccess()
    message.value = '手机访问已停止，原临时地址不再可用。'
  } catch (error) {
    message.value = error instanceof Error ? error.message : '停止手机访问失败。'
  } finally {
    isStopping.value = false
  }
}

async function copyPublicUrl(): Promise<void> {
  const url = status.value?.publicUrl.trim() ?? ''
  if (!url) return
  try {
    await navigator.clipboard.writeText(url)
    message.value = '手机访问地址已复制。'
  } catch {
    message.value = '浏览器未允许复制，请长按地址手动复制。'
  }
}

function openPublicUrl(): void {
  const url = status.value?.publicUrl.trim() ?? ''
  if (!url) return
  window.open(url, '_blank', 'noopener,noreferrer')
}

function openLocalPairing(): void {
  const port = window.location.port || '7420'
  window.open(`http://127.0.0.1:${port}/local-setup`, '_blank', 'noopener,noreferrer')
}

onMounted(() => {
  void refreshStatus()
})

onUnmounted(() => {
  stopPolling()
})
</script>

<style scoped>
.remote-access {
  border-top: 1px solid var(--ui-border-subtle);
  padding: 10px 12px 12px;
}

.remote-access-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.remote-access-kicker,
.remote-access-title,
.remote-access-description,
.remote-access-message,
.remote-access-footnote {
  margin: 0;
}

.remote-access-kicker {
  color: var(--ui-text-tertiary);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.remote-access-title {
  margin-top: 3px;
  color: var(--ui-text-primary);
  font-size: 13px;
  font-weight: 650;
}

.remote-access-state {
  flex: none;
  border-radius: 999px;
  padding: 3px 8px;
  background: var(--ui-bg-surface-muted);
  color: var(--ui-text-tertiary);
  font-size: 11px;
}

.remote-access-state[data-tone='success'] {
  background: rgba(13, 148, 136, 0.12);
  color: #0f766e;
}

.remote-access-state[data-tone='progress'] {
  background: rgba(37, 99, 235, 0.1);
  color: #2563eb;
}

.remote-access-state[data-tone='danger'] {
  background: rgba(220, 38, 38, 0.1);
  color: #dc2626;
}

.remote-access-description,
.remote-access-message,
.remote-access-footnote {
  margin-top: 7px;
  color: var(--ui-text-tertiary);
  font-size: 11px;
  line-height: 1.45;
}

.remote-access-message[data-tone='success'] {
  color: #0f766e;
}

.remote-access-message[data-tone='danger'] {
  color: #dc2626;
}

.remote-access-url-row {
  display: flex;
  align-items: stretch;
  gap: 6px;
  margin-top: 9px;
}

.remote-access-url {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  border: 1px solid var(--ui-border-subtle);
  border-radius: var(--ui-radius-control);
  padding: 8px 9px;
  background: var(--ui-bg-surface-muted);
  color: var(--ui-text-secondary);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.remote-access-icon-button,
.remote-access-primary,
.remote-access-secondary {
  border: 1px solid var(--ui-border-subtle);
  border-radius: var(--ui-radius-control);
  padding: 7px 10px;
  font-size: 11px;
  font-weight: 600;
  transition: opacity 120ms ease, background-color 120ms ease;
}

.remote-access-icon-button,
.remote-access-secondary {
  background: var(--ui-bg-surface);
  color: var(--ui-text-secondary);
}

.remote-access-primary {
  border-color: #0f766e;
  background: #0f766e;
  color: white;
}

.remote-access-icon-button:disabled,
.remote-access-primary:disabled,
.remote-access-secondary:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.remote-access-actions,
.remote-access-checks {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 9px;
}

.remote-access-checks span {
  border-radius: 999px;
  padding: 3px 7px;
  background: var(--ui-bg-surface-muted);
  color: var(--ui-text-tertiary);
  font-size: 10px;
}

.remote-access-checks span[data-ok='true'] {
  background: rgba(13, 148, 136, 0.1);
  color: #0f766e;
}
</style>
