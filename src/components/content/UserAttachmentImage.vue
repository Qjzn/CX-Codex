<template>
  <div class="attachment-image" :data-image-state="source ? state : 'unavailable'">
    <a v-if="source && state !== 'failed'" :href="state === 'loaded' ? source : undefined" target="_blank" rel="noopener noreferrer" :aria-label="state === 'loaded' ? '打开用户附件图片' : undefined">
      <img :key="`${source}:${attempt}`" :src="source" alt="用户附件图片" loading="lazy" @load="state = 'loaded'" @error="state = 'failed'" />
    </a>
    <span v-if="source && state === 'loading'" class="image-placeholder" role="status">正在加载图片…</span>
    <div v-else-if="!source || state === 'failed'" class="image-failure" role="status">
      <span>{{ source ? '图片未能加载' : '图片地址不可用' }}</span>
      <button v-if="source" type="button" @click="retry">重试</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { toRenderableImageUrl } from '../../utils/localImageUrl'

const props = defineProps<{ url: string }>()
const source = computed(() => toRenderableImageUrl(props.url))
const state = ref<'loading' | 'loaded' | 'failed'>('loading')
const attempt = ref(0)
watch(source, () => { state.value = 'loading'; attempt.value = 0 })
function retry(): void {
  state.value = 'loading'
  attempt.value += 1
}
</script>

<style scoped>
.attachment-image { position: relative; min-width: 0; overflow: hidden; border-radius: 10px; background: var(--ui-bg-surface-muted); }
.attachment-image a { display: block; min-height: 88px; }
.attachment-image a:focus-visible, .image-failure button:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: -2px; }
.attachment-image img { display: block; width: 100%; max-height: 260px; object-fit: contain; }
.attachment-image[data-image-state='loading'] img { opacity: 0; }
.image-placeholder, .image-failure { display: flex; min-height: 88px; align-items: center; justify-content: center; gap: 8px; color: var(--ui-text-secondary); font-size: 12px; }
.image-placeholder { position: absolute; inset: 0; pointer-events: none; }
.image-failure button { min-width: 44px; min-height: 44px; border: 0; background: transparent; color: var(--ui-accent); font: inherit; cursor: pointer; }
</style>
