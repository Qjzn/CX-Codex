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
        v-if="!status?.active && canStartStable"
        type="button"
        class="remote-access-primary"
        :disabled="isBusy"
        @click="startStable"
      >
        {{ isStartingStable ? busyLabel : stableActionLabel }}
      </button>
      <button
        v-else-if="!status?.active"
        type="button"
        class="remote-access-primary"
        :disabled="isBusy"
        @click="handleStableSetup"
      >
        {{ stableSetupLabel }}
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
        v-if="status?.activeMode === 'quick' && canStartStable"
        type="button"
        class="remote-access-secondary"
        :disabled="isBusy"
        @click="startStable"
      >
        切换固定地址
      </button>
      <button
        v-if="status?.activeMode === 'quick' && !canStartStable"
        type="button"
        class="remote-access-secondary"
        :disabled="isBusy"
        @click="handleStableSetup"
      >
        {{ stableSetupLabel }}
      </button>
      <button
        v-if="!status?.active"
        type="button"
        class="remote-access-secondary"
        :disabled="isBusy"
        @click="startTemporary"
      >
        {{ isStartingQuick ? busyLabel : '先用临时地址' }}
      </button>
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
        打开管理中心
      </button>
    </div>

    <p v-if="message" class="remote-access-message" :data-tone="tone" role="status">
      {{ message }}
    </p>
    <p class="remote-access-footnote">
      固定地址首次需安装并登录免费的 Tailscale；以后会随电脑重启恢复。临时备用地址可能变化。访问密码仅在你手动修改时改变。{{ networkHint }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import {
  getTunnelStatus,
  startRemoteAccess,
  stopRemoteAccess,
  type TunnelStatus,
} from '../../api/codexGateway'
import { copyTextToClipboard } from '../../utils/clipboard'

const status = ref<TunnelStatus | null>(null)
const startingMode = ref<'stable' | 'quick' | ''>('')
const isStopping = ref(false)
const message = ref('')
let pollingTimer: number | null = null

const isBusy = computed(() => (
  startingMode.value !== ''
  || isStopping.value
  || status.value?.phase === 'installing'
  || status.value?.phase === 'starting'
  || status.value?.phase === 'verifying'
  || status.value?.phase === 'stopping'
))
const isStartingStable = computed(() => startingMode.value === 'stable')
const isStartingQuick = computed(() => startingMode.value === 'quick')
const canStartStable = computed(() => (
  status.value?.stable.installed === true
  && status.value.stable.authenticated === true
))
const canOpenLocalPairing = computed(() => (
  window.location.hostname === '127.0.0.1'
  || window.location.hostname === 'localhost'
  || window.location.hostname === '::1'
))

const tone = computed(() => {
  if (status.value?.activeMode === 'stable') return 'success'
  if (status.value?.activeMode === 'quick') return 'warning'
  if (status.value?.phase === 'error' || status.value?.stable.phase === 'error') return 'danger'
  if (isBusy.value) return 'progress'
  return 'neutral'
})

const title = computed(() => {
  if (status.value?.activeMode === 'stable') return '固定地址已就绪'
  if (status.value?.activeMode === 'quick') return '临时备用地址正在使用'
  if (!status.value?.stable.installed) return '设置可长期使用的固定地址'
  if (!status.value.stable.authenticated) return '登录一次即可固定地址'
  return '从手机安全访问这台电脑'
})

const stateLabel = computed(() => {
  if (status.value?.activeMode === 'stable') return '固定'
  if (status.value?.activeMode === 'quick') return '临时'
  if (status.value?.phase === 'error' || status.value?.stable.phase === 'error') return '需要处理'
  if (isBusy.value) return '处理中'
  return '未开启'
})

const busyLabel = computed(() => {
  if (status.value?.phase === 'installing') return '正在校验组件…'
  if (status.value?.phase === 'verifying') return '正在安全验证…'
  return startingMode.value === 'stable' ? '正在启用固定地址…' : '正在生成临时地址…'
})

const stableActionLabel = computed(() => (
  status.value?.stable.phase === 'needs-login' ? '登录后重试' : '启用固定地址'
))
const stableSetupLabel = computed(() => (
  status.value?.stable.installed ? '我已登录，刷新' : '安装 Tailscale'
))

const description = computed(() => {
  if (status.value?.activeMode === 'stable') {
    return '地址、访问密码和消息连接均已验证；升级或重启后会自动恢复。'
  }
  if (status.value?.activeMode === 'quick') {
    return '当前可从手机访问，但这个备用地址在升级、重启或通道重连后可能变化。'
  }
  if (status.value?.phase === 'error') return status.value.reason || '开启失败，请检查提示后重试。'
  if (status.value?.stable.phase === 'error') return status.value.stable.message || '固定地址状态异常，请重试。'
  if (!status.value?.stable.installed) {
    return '推荐用 Tailscale Funnel 获得固定 HTTPS 地址；无需服务器或路由器端口。'
  }
  if (!status.value.stable.authenticated) {
    return '请先在电脑右下角打开 Tailscale 并登录，然后返回这里重试。'
  }
  return '固定地址无需服务器或路由器端口，启用后会自动完成公网和鉴权验证。'
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

async function startStable(): Promise<void> {
  if (isBusy.value) return
  startingMode.value = 'stable'
  message.value = '正在启用固定地址并验证访问密码和消息连接…'
  startPolling()
  try {
    status.value = await startRemoteAccess('stable', {
      tailscaleCommand: status.value?.stable.command ?? '',
    })
    message.value = '固定手机地址已启用，升级或重启后会自动恢复。'
  } catch (error) {
    message.value = error instanceof Error ? error.message : '启用固定手机地址失败。'
    await refreshStatus({ quiet: true })
  } finally {
    startingMode.value = ''
    stopPolling()
  }
}

async function startTemporary(): Promise<void> {
  if (isBusy.value) return
  startingMode.value = 'quick'
  message.value = '正在生成临时备用地址并完成公网安全验证…'
  startPolling()
  try {
    status.value = await startRemoteAccess('quick', {
      cloudflaredCommand: status.value?.configuredCommand ?? '',
      keepStablePreference: true,
    })
    message.value = '临时手机地址已生成；升级、重启或重连后地址可能变化。'
  } catch (error) {
    message.value = error instanceof Error ? error.message : '生成临时手机地址失败。'
    await refreshStatus({ quiet: true })
  } finally {
    startingMode.value = ''
    stopPolling()
  }
}

async function stopAccess(): Promise<void> {
  if (isBusy.value) return
  isStopping.value = true
  message.value = '正在关闭手机访问…'
  try {
    status.value = await stopRemoteAccess()
    message.value = '手机访问已停止；再次启用固定访问时仍使用同一设备地址。'
  } catch (error) {
    message.value = error instanceof Error ? error.message : '停止手机访问失败。'
  } finally {
    isStopping.value = false
  }
}

function handleStableSetup(): void {
  if (status.value?.stable.installed) {
    message.value = '正在检查 Tailscale 登录状态…'
    void refreshStatus()
    return
  }
  window.open('https://tailscale.com/download/windows', '_blank', 'noopener,noreferrer')
  message.value = '安装并登录 Tailscale 后，返回这里点击“我已登录，刷新”。'
}

async function copyPublicUrl(): Promise<void> {
  const url = status.value?.publicUrl.trim() ?? ''
  if (!url) return
  try {
    await copyTextToClipboard(url)
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

.remote-access-state[data-tone='warning'] {
  background: rgba(217, 119, 6, 0.12);
  color: #b45309;
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

.remote-access-message[data-tone='warning'] {
  color: #b45309;
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

@media (max-width: 700px) {
  .remote-access-icon-button,
  .remote-access-primary,
  .remote-access-secondary {
    min-height: 44px;
  }
}
</style>
