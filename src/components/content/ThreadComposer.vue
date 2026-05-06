<template>
  <form class="thread-composer" @submit.prevent="onSubmit(resolveSubmitMode())">
    <p v-if="dictationErrorText" class="thread-composer-dictation-error">
      {{ dictationErrorText }}
    </p>
    <p v-else-if="dictationHelperText" class="thread-composer-dictation-helper">
      {{ dictationHelperText }}
    </p>

    <div class="thread-composer-shell" :class="{ 'thread-composer-shell--no-top-radius': hasQueueAbove }">
      <div v-if="selectedImages.length > 0" class="thread-composer-attachments">
        <div v-for="image in selectedImages" :key="image.id" class="thread-composer-attachment">
          <img class="thread-composer-attachment-image" :src="image.previewUrl" :alt="image.name || '已选图片'" />
          <button
            class="thread-composer-attachment-remove"
            type="button"
            :aria-label="`移除${image.name || '图片'}`"
            :disabled="isInteractionDisabled"
            @click="removeImage(image.id)"
          >
            x
          </button>
        </div>
      </div>

      <div v-if="folderUploadGroups.length > 0" class="thread-composer-folder-chips">
        <span v-for="group in folderUploadGroups" :key="group.id" class="thread-composer-folder-chip">
          <IconTablerFolder class="thread-composer-folder-chip-icon" />
          <span class="thread-composer-folder-chip-name" :title="group.name">{{ group.name }}</span>
          <span class="thread-composer-folder-chip-meta">
            <template v-if="group.isUploading">
              {{ getFolderUploadPercent(group) }}% 上传中（{{ group.processed }}/{{ group.total }}）
            </template>
            <template v-else>
              {{ group.filePaths.length }} 个文件
            </template>
          </span>
          <button
            class="thread-composer-folder-chip-remove"
            type="button"
            :aria-label="`移除文件夹 ${group.name}`"
            :disabled="isInteractionDisabled"
            @click="removeFolderAttachment(group.id)"
          >×</button>
        </span>
      </div>

      <div v-if="standaloneFileAttachments.length > 0" class="thread-composer-file-chips">
        <span v-for="att in standaloneFileAttachments" :key="att.fsPath" class="thread-composer-file-chip">
          <IconTablerFilePencil class="thread-composer-file-chip-icon" />
          <span class="thread-composer-file-chip-name" :title="att.fsPath">{{ att.label }}</span>
          <button
            class="thread-composer-file-chip-remove"
            type="button"
            :aria-label="`移除 ${att.label}`"
            :disabled="isInteractionDisabled"
            @click="removeFileAttachment(att.fsPath)"
          >×</button>
        </span>
      </div>

      <div v-if="selectedSkills.length > 0" class="thread-composer-skill-chips">
        <span v-for="skill in selectedSkills" :key="skill.path" class="thread-composer-skill-chip">
          <span class="thread-composer-skill-chip-name">{{ skill.name }}</span>
          <button
            class="thread-composer-skill-chip-remove"
            type="button"
            :aria-label="`移除技能 ${skill.name}`"
            @click="removeSkill(skill.path)"
          >×</button>
        </span>
      </div>

      <div class="thread-composer-input-wrap">
        <button
          v-if="isFileMentionOpen && isCompactViewport"
          class="thread-composer-mobile-backdrop"
          type="button"
          aria-label="关闭文件引用菜单"
          @click="closeFileMention"
        />
        <div
          v-if="isFileMentionOpen"
          class="thread-composer-file-mentions"
          :class="{ 'thread-composer-file-mentions--sheet': isCompactViewport }"
        >
          <template v-if="fileMentionSuggestions.length > 0">
            <button
              v-for="(item, index) in fileMentionSuggestions"
              :key="item.path"
              class="thread-composer-file-mention-row"
              :class="{ 'is-active': index === fileMentionHighlightedIndex }"
              type="button"
              @mousedown.prevent="applyFileMention(item)"
            >
              <span
                v-if="getMentionBadgeText(item.path)"
                class="thread-composer-file-mention-icon-badge"
                :class="`is-${getMentionBadgeClass(item.path)}`"
              >
                {{ getMentionBadgeText(item.path) }}
              </span>
              <span v-else-if="isMarkdownFile(item.path)" class="thread-composer-file-mention-icon-markdown">↓</span>
              <IconTablerFilePencil v-else class="thread-composer-file-mention-icon-file" />
              <span class="thread-composer-file-mention-text">
                <span class="thread-composer-file-mention-name">{{ getMentionFileName(item.path) }}</span>
                <span v-if="getMentionDirName(item.path)" class="thread-composer-file-mention-dir">{{ getMentionDirName(item.path) }}</span>
              </span>
            </button>
          </template>
          <div v-else class="thread-composer-file-mention-empty">没有匹配文件</div>
        </div>
        <textarea
          ref="inputRef"
          v-model="draft"
          class="thread-composer-input"
          :placeholder="placeholderText"
          :disabled="isInteractionDisabled"
          @input="onInputChange"
          @keydown="onInputKeydown"
        />
        <ComposerSkillPicker
          :skills="skillOptions"
          :visible="isSlashMenuOpen"
          :anchor-bottom="44"
          :anchor-left="0"
          @select="onSlashSkillSelect"
          @close="closeSlashMenu"
        />
      </div>

      <div
        class="thread-composer-controls"
        :class="{ 'thread-composer-controls--recording': isDictationRecording }"
      >
        <div ref="attachMenuRootRef" class="thread-composer-attach">
          <button
            class="thread-composer-attach-trigger"
            type="button"
            aria-label="添加图片和文件"
            :disabled="isInteractionDisabled"
            @click="toggleAttachMenu"
          >
            +
          </button>

          <button
            v-if="isAttachMenuOpen && isCompactViewport"
            class="thread-composer-mobile-backdrop"
            type="button"
            aria-label="关闭附件菜单"
            @click="isAttachMenuOpen = false"
          />
          <div
            v-if="isAttachMenuOpen"
            class="thread-composer-attach-menu"
            :class="{ 'thread-composer-attach-menu--sheet': isCompactViewport }"
          >
            <button
              class="thread-composer-attach-item"
              type="button"
              :disabled="isInteractionDisabled"
              @click="triggerPhotoLibrary"
            >
              添加图片和文件
            </button>
            <button
              class="thread-composer-attach-item"
              type="button"
              :disabled="isInteractionDisabled"
              @click="triggerFolderPicker"
            >
              添加文件夹
            </button>
            <button
              class="thread-composer-attach-item"
              type="button"
              :disabled="isInteractionDisabled"
              @click="triggerCameraCapture"
            >
              拍照
            </button>
            <div class="thread-composer-attach-separator" />
            <button
              v-if="isFastModeSupported"
              class="thread-composer-attach-setting"
              type="button"
              role="switch"
              :aria-checked="selectedSpeedMode === 'fast'"
              :aria-label="`快速模式${selectedSpeedMode === 'fast' ? '已开启' : '已关闭'}`"
              :disabled="isSpeedToggleDisabled"
              @click="onToggleSpeedMode"
            >
              <span class="thread-composer-attach-setting-copy">
                <span class="thread-composer-attach-setting-label">快速模式</span>
                <span class="thread-composer-attach-setting-description">{{ speedModeDescription }}</span>
              </span>
              <span
                class="thread-composer-attach-switch"
                :class="{
                  'is-on': selectedSpeedMode === 'fast',
                  'is-busy': isUpdatingSpeedMode,
                  'is-disabled': isSpeedToggleDisabled,
                }"
              />
            </button>
          </div>
        </div>

        <div v-if="!isDictationRecording" class="thread-composer-control-strip" aria-label="发送设置">
          <div class="thread-composer-mode-toggle" role="group" aria-label="协作模式">
            <button
              type="button"
              :class="{ 'is-active': selectedCollaborationMode === 'execute' }"
              :aria-pressed="selectedCollaborationMode === 'execute'"
              :disabled="isInteractionDisabled"
              @click="onCollaborationModeSelect('execute')"
            >
              执行
            </button>
            <button
              type="button"
              :class="{ 'is-active': selectedCollaborationMode === 'plan' }"
              :aria-pressed="selectedCollaborationMode === 'plan'"
              :disabled="isInteractionDisabled"
              @click="onCollaborationModeSelect('plan')"
            >
              计划
            </button>
          </div>
          <template v-if="isCompactViewport">
            <ComposerSearchDropdown
              class="thread-composer-control thread-composer-control--skills"
              :options="skillDropdownOptions"
              :selected-values="selectedSkillPaths"
              placeholder="技能"
              search-placeholder="搜索技能..."
              open-direction="up"
              :disabled="disabled || !activeThreadId"
              @toggle="onSkillDropdownToggle"
            />
            <button
              class="thread-composer-compact-settings-trigger"
              type="button"
              :disabled="isInteractionDisabled"
              :aria-expanded="isCompactSettingsOpen"
              aria-label="更多设置"
              @click="toggleCompactSettings"
            >
              <IconTablerSettings class="thread-composer-compact-settings-icon" />
              <span class="thread-composer-compact-settings-label">更多设置</span>
            </button>
          </template>
          <template v-else>
            <ComposerDropdown
              class="thread-composer-control"
              :model-value="selectedModel"
              :options="modelOptions"
              :selected-prefix-icon="showFastModeModelIcon ? IconTablerBolt : null"
              placeholder="模型"
              open-direction="up"
              :disabled="disabled || !activeThreadId || models.length === 0"
              @update:model-value="onModelSelect"
            />

            <ComposerSearchDropdown
              class="thread-composer-control"
              :options="skillDropdownOptions"
              :selected-values="selectedSkillPaths"
              placeholder="技能"
              search-placeholder="搜索技能..."
              open-direction="up"
              :disabled="disabled || !activeThreadId"
              @toggle="onSkillDropdownToggle"
            />

            <ComposerDropdown
              class="thread-composer-control"
              :model-value="selectedReasoningEffort"
              :options="reasoningOptions"
              placeholder="思考强度"
              open-direction="up"
              :disabled="disabled || !activeThreadId"
              @update:model-value="onReasoningEffortSelect"
            />
          </template>
        </div>

        <div
          class="thread-composer-actions"
          :class="{ 'thread-composer-actions--recording': isDictationRecording }"
        >
          <div v-if="dictationState === 'recording'" class="thread-composer-dictation-waveform-wrap" aria-hidden="true">
            <canvas ref="dictationWaveformCanvasRef" class="thread-composer-dictation-waveform" />
          </div>

          <span v-if="dictationState === 'recording'" class="thread-composer-dictation-timer">
            {{ dictationDurationLabel }}
          </span>

          <button
            v-if="shouldShowDictationButton"
            class="thread-composer-mic"
            :class="{
              'thread-composer-mic--active': dictationState === 'recording',
            }"
            type="button"
            :aria-label="dictationButtonLabel"
            :title="dictationButtonLabel"
            :disabled="isInteractionDisabled || dictationState === 'transcribing'"
            @click="onDictationToggle"
            @pointerdown="onDictationPressStart"
            @pointerup="onDictationPressEnd"
            @pointercancel="onDictationPressEnd"
            @lostpointercapture="onDictationPressEnd"
            @touchstart.prevent="onDictationTouchStart"
            @touchend.prevent="onDictationTouchEnd"
            @touchcancel.prevent="onDictationTouchEnd"
            @contextmenu.prevent
          >
            <IconTablerPlayerStopFilled
              v-if="dictationState === 'recording'"
              class="thread-composer-mic-icon thread-composer-mic-icon--stop"
            />
            <IconTablerMicrophone v-else class="thread-composer-mic-icon" />
          </button>

          <button
            v-if="isTurnInProgress && !hasSubmitContent"
            class="thread-composer-stop"
            type="button"
            aria-label="停止"
            :disabled="disabled || !activeThreadId || isInterruptingTurn"
            @click="onInterrupt"
          >
            <IconTablerPlayerStopFilled class="thread-composer-stop-icon" />
          </button>
          <button
            v-else
            v-show="!isCompactViewport || hasSubmitContent || isTurnInProgress"
            class="thread-composer-submit"
            :class="{ 'thread-composer-submit--queue': isTurnInProgress }"
            type="button"
            :aria-label="isTurnInProgress ? '加入消息队列' : '发送消息'"
            :title="isTurnInProgress ? '加入消息队列，等待当前任务结束后按顺序执行' : '发送'"
            :disabled="!canSubmit"
            @click="onSubmit(resolveSubmitMode())"
          >
            <IconTablerArrowUp class="thread-composer-submit-icon" />
          </button>
        </div>
      </div>

    </div>
    <button
      v-if="isCompactSettingsOpen"
      class="thread-composer-mobile-backdrop"
      type="button"
      aria-label="关闭更多设置"
      @click="closeCompactSettings"
    />
    <div
      v-if="isCompactSettingsOpen"
      class="thread-composer-compact-settings-panel"
      role="dialog"
      aria-modal="true"
      aria-label="更多设置"
    >
      <div class="thread-composer-compact-settings-header">
        <span class="thread-composer-compact-settings-title">更多设置</span>
        <button
          class="thread-composer-compact-settings-close"
          type="button"
          aria-label="关闭更多设置"
          @click="closeCompactSettings"
        >
          完成
        </button>
      </div>
      <div class="thread-composer-compact-settings-grid">
        <ComposerDropdown
          class="thread-composer-control"
          :model-value="selectedModel"
          :options="modelOptions"
          :selected-prefix-icon="showFastModeModelIcon ? IconTablerBolt : null"
          placeholder="模型"
          open-direction="up"
          :disabled="disabled || !activeThreadId || models.length === 0"
          @update:model-value="onCompactModelSelect"
        />
        <ComposerDropdown
          class="thread-composer-control"
          :model-value="selectedReasoningEffort"
          :options="reasoningOptions"
          placeholder="思考强度"
          open-direction="up"
          :disabled="disabled || !activeThreadId"
          @update:model-value="onCompactReasoningEffortSelect"
        />
      </div>
    </div>
    <input
      ref="photoLibraryInputRef"
      class="thread-composer-hidden-input"
      type="file"
      multiple
      :disabled="isInteractionDisabled"
      @change="onPhotoLibraryChange"
    />
    <input
      ref="cameraCaptureInputRef"
      class="thread-composer-hidden-input"
      type="file"
      accept="image/*"
      capture="environment"
      :disabled="isInteractionDisabled"
      @change="onCameraCaptureChange"
    />
    <input
      ref="audioCaptureInputRef"
      class="thread-composer-hidden-input"
      type="file"
      accept="audio/*"
      capture
      :disabled="isInteractionDisabled"
      @change="onAudioCaptureChange"
    />
    <input
      ref="folderPickerInputRef"
      class="thread-composer-hidden-input"
      type="file"
      multiple
      webkitdirectory
      directory
      :disabled="isInteractionDisabled"
      @change="onFolderPickerChange"
    />
  </form>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { CollaborationMode, ReasoningEffort, SpeedMode } from '../../types/codex'
import { useDictation } from '../../composables/useDictation'
import { searchComposerFiles, uploadFile, type ComposerFileSuggestion } from '../../api/codexGateway'
import IconTablerArrowUp from '../icons/IconTablerArrowUp.vue'
import IconTablerBolt from '../icons/IconTablerBolt.vue'
import IconTablerFilePencil from '../icons/IconTablerFilePencil.vue'
import IconTablerFolder from '../icons/IconTablerFolder.vue'
import IconTablerMicrophone from '../icons/IconTablerMicrophone.vue'
import IconTablerPlayerStopFilled from '../icons/IconTablerPlayerStopFilled.vue'
import IconTablerSettings from '../icons/IconTablerSettings.vue'
import ComposerDropdown from './ComposerDropdown.vue'
import ComposerSearchDropdown from './ComposerSearchDropdown.vue'
import ComposerSkillPicker from './ComposerSkillPicker.vue'

type SkillItem = { name: string; description: string; path: string }

const props = defineProps<{
  activeThreadId: string
  cwd?: string
  models: string[]
  selectedModel: string
  selectedReasoningEffort: ReasoningEffort | ''
  selectedSpeedMode: SpeedMode
  selectedCollaborationMode: CollaborationMode
  skills?: SkillItem[]
  isTurnInProgress?: boolean
  isInterruptingTurn?: boolean
  isUpdatingSpeedMode?: boolean
  disabled?: boolean
  hasQueueAbove?: boolean
  sendWithEnter?: boolean
  dictationClickToToggle?: boolean
  showDictationButton?: boolean
  prependDraftRequest?: { id: number; text: string } | null
  dictationAutoSend?: boolean
  dictationLanguage?: string
}>()

export type FileAttachment = { label: string; path: string; fsPath: string }

export type ComposerDraftPayload = {
  text: string
  imageUrls: string[]
  fileAttachments: FileAttachment[]
  skills: Array<{ name: string; path: string }>
}

export type SubmitPayload = {
  text: string
  imageUrls: string[]
  fileAttachments: FileAttachment[]
  skills: Array<{ name: string; path: string }>
  collaborationMode: CollaborationMode
  mode: 'steer' | 'queue'
  rollbackLatestUserTurn?: boolean
}

export type ThreadComposerExposed = {
  hydrateDraft: (payload: ComposerDraftPayload) => void
  hasUnsavedDraft: () => boolean
}

const emit = defineEmits<{
  submit: [payload: SubmitPayload]
  interrupt: []
  'update:selected-model': [modelId: string]
  'update:selected-reasoning-effort': [effort: ReasoningEffort | '']
  'update:selected-speed-mode': [mode: SpeedMode]
  'update:selected-collaboration-mode': [mode: CollaborationMode]
}>()

type SelectedImage = {
  id: string
  name: string
  url: string
  previewUrl: string
}

type FolderUploadGroup = {
  id: string
  name: string
  total: number
  processed: number
  filePaths: string[]
  isUploading: boolean
}

const draft = ref('')
const selectedImages = ref<SelectedImage[]>([])
const selectedSkills = ref<SkillItem[]>([])
const fileAttachments = ref<FileAttachment[]>([])
const folderUploadGroups = ref<FolderUploadGroup[]>([])

const dictationFeedback = ref('')
const {
  state: dictationState,
  isSupported: isDictationSupported,
  supportsLiveRecording,
  recordingDurationMs,
  waveformCanvasRef: dictationWaveformCanvasRef,
  startRecording,
  stopRecording,
  toggleRecording,
  transcribeFile,
  cancel: cancelDictation,
} = useDictation({
  getLanguage: () => props.dictationLanguage ?? 'auto',
  onTranscript: (text) => {
    draft.value = draft.value ? `${draft.value}\n${text}` : text
    dictationFeedback.value = ''
    if (props.dictationAutoSend !== false) {
      const mode = resolveSubmitMode()
      onSubmit(mode, {
        rollbackLatestUserTurn: mode === 'steer' && dictationShouldRollbackLatestUserTurn,
      })
      dictationShouldRollbackLatestUserTurn = false
      return
    }
    nextTick(() => inputRef.value?.focus())
  },
  onEmpty: () => {
    dictationFeedback.value = props.dictationClickToToggle
      ? '未识别到语音，请说完后再点一次。'
      : '未识别到语音，请按住麦克风后再说话。'
  },
  onError: (error) => {
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      dictationFeedback.value = '麦克风权限被拒绝。'
      return
    }
    dictationFeedback.value = error instanceof Error ? error.message : '语音听写失败。'
  },
})
const attachMenuRootRef = ref<HTMLElement | null>(null)
const photoLibraryInputRef = ref<HTMLInputElement | null>(null)
const cameraCaptureInputRef = ref<HTMLInputElement | null>(null)
const audioCaptureInputRef = ref<HTMLInputElement | null>(null)
const folderPickerInputRef = ref<HTMLInputElement | null>(null)
const inputRef = ref<HTMLTextAreaElement | null>(null)
const isAttachMenuOpen = ref(false)
const isSlashMenuOpen = ref(false)
const mentionStartIndex = ref<number | null>(null)
const mentionQuery = ref('')
const fileMentionSuggestions = ref<ComposerFileSuggestion[]>([])
const isFileMentionOpen = ref(false)
const fileMentionHighlightedIndex = ref(0)
const isCompactViewport = ref(false)
const isCompactSettingsOpen = ref(false)
const draftGeneration = ref(0)
let fileMentionSearchToken = 0
let fileMentionDebounceTimer: ReturnType<typeof setTimeout> | null = null
let isHoldPressActive = false
let dictationShouldRollbackLatestUserTurn = false
const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
const DRAFT_STORAGE_PREFIX = 'codex-web-local.thread-draft.v1.'
let lastActiveThreadId = ''

const reasoningOptions: Array<{ value: ReasoningEffort; label: string }> = [
  { value: 'none', label: '无' },
  { value: 'minimal', label: '极低' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'xhigh', label: '极高' },
]
function formatModelLabel(modelId: string): string {
  return modelId.trim().replace(/^gpt/i, 'GPT')
}

const modelOptions = computed(() =>
  props.models.map((modelId) => ({ value: modelId, label: formatModelLabel(modelId) })),
)

const skillOptions = computed<SkillItem[]>(() => props.skills ?? [])
const selectedSkillPaths = computed(() => selectedSkills.value.map((s) => s.path))
const skillDropdownOptions = computed(() =>
  (props.skills ?? []).map((s) => ({
    value: s.path,
    label: s.name,
    description: s.description,
  })),
)

const canSubmit = computed(() => {
  if (props.disabled) return false
  if (props.isUpdatingSpeedMode) return false
  if (!props.activeThreadId) return false
  return draft.value.trim().length > 0 || selectedImages.value.length > 0 || fileAttachments.value.length > 0
})
const hasUnsavedDraft = computed(() =>
  draft.value.trim().length > 0
  || selectedImages.value.length > 0
  || selectedSkills.value.length > 0
  || fileAttachments.value.length > 0
  || folderUploadGroups.value.length > 0,
)
const standaloneFileAttachments = computed(() => {
  const grouped = new Set<string>()
  for (const group of folderUploadGroups.value) {
    for (const path of group.filePaths) grouped.add(path)
  }
  return fileAttachments.value.filter((att) => !grouped.has(att.fsPath))
})
const isInteractionDisabled = computed(() => props.disabled || !props.activeThreadId)
const isFastModeSupported = computed(() => props.selectedModel.trim() === 'gpt-5.4')
const showFastModeModelIcon = computed(() =>
  props.selectedSpeedMode === 'fast' && isFastModeSupported.value,
)
const isSpeedToggleDisabled = computed(() =>
  isInteractionDisabled.value || props.isUpdatingSpeedMode === true,
)
const speedModeDescription = computed(() => {
  if (props.isUpdatingSpeedMode) {
    return '正在保存速度设置...'
  }
  return props.selectedSpeedMode === 'fast'
    ? '约 1.5 倍速度，额度消耗按 2 倍计算'
    : '默认速度，按正常额度消耗'
})
const isDictationRecording = computed(() => dictationState.value === 'recording')
const shouldShowDictationButton = computed(() => props.showDictationButton !== false && isDictationSupported.value)
const usesDictationUploadFallback = computed(() =>
  shouldShowDictationButton.value && !supportsLiveRecording.value,
)
const DICTATION_UPLOAD_FALLBACK_MESSAGE = '当前地址不支持直接长按录音，点按麦克风会打开系统录音或音频上传。切到 HTTPS 或 localhost 后可直接长按说话。'
const dictationButtonLabel = computed(() => {
  if (dictationState.value === 'recording') return '停止听写'
  if (dictationState.value === 'transcribing') return '正在转写'
  if (usesDictationUploadFallback.value) return '上传语音或录音'
  return props.dictationClickToToggle ? '点击开始听写' : '按住开始听写'
})
const dictationErrorText = computed(() =>
  dictationState.value === 'idle' ? dictationFeedback.value.trim() : '',
)
const dictationHelperText = computed(() => {
  if (!shouldShowDictationButton.value) return ''
  if (dictationState.value !== 'idle') return ''
  if (usesDictationUploadFallback.value) {
    return ''
  }
  if (props.dictationClickToToggle) {
    return '点击一次开始录音，再点击一次结束并转写。'
  }
  return '按住麦克风开始录音，松手后自动转写。'
})
const dictationDurationLabel = computed(() => {
  const totalSeconds = Math.max(0, Math.floor(recordingDurationMs.value / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
})

const placeholderText = computed(() =>
  props.activeThreadId ? '输入消息...（@ 引用文件，/ 选择技能）' : '请先选择一个会话再发送消息',
)
const hasSubmitContent = computed(() =>
  draft.value.trim().length > 0 || selectedImages.value.length > 0 || fileAttachments.value.length > 0,
)

function resolveSubmitMode(): 'steer' | 'queue' {
  return props.isTurnInProgress ? 'queue' : 'steer'
}

function onCollaborationModeSelect(mode: CollaborationMode): void {
  if (isInteractionDisabled.value) return
  emit('update:selected-collaboration-mode', mode)
}

function onSubmit(mode: 'steer' | 'queue' = 'steer', options?: { rollbackLatestUserTurn?: boolean }): void {
  const text = draft.value.trim()
  if (!canSubmit.value) return
  emit('submit', {
    text,
    imageUrls: selectedImages.value.map((image) => image.url),
    fileAttachments: [...fileAttachments.value],
    skills: selectedSkills.value.map((s) => ({ name: s.name, path: s.path })),
    collaborationMode: props.selectedCollaborationMode,
    mode,
    rollbackLatestUserTurn: options?.rollbackLatestUserTurn === true,
  })
  clearPersistedDraftForThread(props.activeThreadId)
  clearDraftState()
  if (isAndroid) {
    inputRef.value?.blur()
    return
  }
  nextTick(() => inputRef.value?.focus())
}

function toRenderableImageUrl(value: string): string {
  const normalized = value.trim()
  if (!normalized) return ''
  if (
    normalized.startsWith('data:') ||
    normalized.startsWith('blob:') ||
    normalized.startsWith('http://') ||
    normalized.startsWith('https://') ||
    normalized.startsWith('/codex-local-image?')
  ) {
    return normalized
  }
  if (normalized.startsWith('file://')) {
    return `/codex-local-image?path=${encodeURIComponent(normalized)}`
  }
  if (normalized.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(normalized)) {
    return `/codex-local-image?path=${encodeURIComponent(normalized)}`
  }
  return normalized
}

function replaceDraftState(payload: ComposerDraftPayload): void {
  draftGeneration.value += 1
  draft.value = payload.text
  selectedImages.value = payload.imageUrls.map((url, index) => ({
    id: `queued-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    name: `图片 ${index + 1}`,
    url,
    previewUrl: toRenderableImageUrl(url),
  }))
  selectedSkills.value = payload.skills.map((skill) => (
    (props.skills ?? []).find((item) => item.path === skill.path)
    ?? { name: skill.name, description: '', path: skill.path }
  ))
  fileAttachments.value = payload.fileAttachments.map((attachment) => ({ ...attachment }))
  folderUploadGroups.value = []
  dictationFeedback.value = ''
  isAttachMenuOpen.value = false
  isSlashMenuOpen.value = false
  isCompactSettingsOpen.value = false
  closeFileMention()
}

function clearDraftState(): void {
  replaceDraftState({
    text: '',
    imageUrls: [],
    fileAttachments: [],
    skills: [],
  })
}

function getDraftStorageKey(threadId: string): string {
  return `${DRAFT_STORAGE_PREFIX}${threadId}`
}

function loadPersistedDraftForThread(threadId: string): ComposerDraftPayload | null {
  if (typeof window === 'undefined') return null
  const normalizedThreadId = threadId.trim()
  if (!normalizedThreadId) return null
  try {
    const raw = window.localStorage.getItem(getDraftStorageKey(normalizedThreadId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ComposerDraftPayload> | string
    if (typeof parsed === 'string') {
      return {
        text: parsed,
        imageUrls: [],
        fileAttachments: [],
        skills: [],
      }
    }
    return {
      text: typeof parsed.text === 'string' ? parsed.text : '',
      imageUrls: Array.isArray(parsed.imageUrls)
        ? parsed.imageUrls.filter((url): url is string => typeof url === 'string')
        : [],
      fileAttachments: Array.isArray(parsed.fileAttachments)
        ? parsed.fileAttachments.filter((attachment): attachment is FileAttachment => (
          Boolean(attachment)
          && typeof attachment.label === 'string'
          && typeof attachment.path === 'string'
          && typeof attachment.fsPath === 'string'
        ))
        : [],
      skills: Array.isArray(parsed.skills)
        ? parsed.skills.filter((skill): skill is { name: string; path: string } => (
          Boolean(skill)
          && typeof skill.name === 'string'
          && typeof skill.path === 'string'
        ))
        : [],
    }
  } catch {
    return null
  }
}

function persistDraftForThread(threadId: string, payload: ComposerDraftPayload): void {
  if (typeof window === 'undefined') return
  const normalizedThreadId = threadId.trim()
  if (!normalizedThreadId) return
  try {
    const hasContent = payload.text.trim().length > 0
      || payload.imageUrls.length > 0
      || payload.fileAttachments.length > 0
      || payload.skills.length > 0
    if (hasContent) {
      window.localStorage.setItem(getDraftStorageKey(normalizedThreadId), JSON.stringify(payload))
      return
    }
    window.localStorage.removeItem(getDraftStorageKey(normalizedThreadId))
  } catch {
    // Ignore localStorage failures (quota/private mode).
  }
}

function clearPersistedDraftForThread(threadId: string): void {
  persistDraftForThread(threadId, {
    text: '',
    imageUrls: [],
    fileAttachments: [],
    skills: [],
  })
}

function getCurrentDraftPayload(): ComposerDraftPayload {
  return {
    text: draft.value,
    imageUrls: selectedImages.value.map((image) => image.url),
    fileAttachments: fileAttachments.value.map((attachment) => ({ ...attachment })),
    skills: selectedSkills.value.map((skill) => ({ name: skill.name, path: skill.path })),
  }
}

function onInterrupt(): void {
  emit('interrupt')
}

function onModelSelect(value: string): void {
  emit('update:selected-model', value)
}

function onReasoningEffortSelect(value: string): void {
  emit('update:selected-reasoning-effort', value as ReasoningEffort)
}

function onCompactModelSelect(value: string): void {
  onModelSelect(value)
  closeCompactSettings()
}

function onCompactReasoningEffortSelect(value: string): void {
  onReasoningEffortSelect(value)
  closeCompactSettings()
}

function onToggleSpeedMode(): void {
  if (isSpeedToggleDisabled.value) return
  emit('update:selected-speed-mode', props.selectedSpeedMode === 'fast' ? 'standard' : 'fast')
}

function toggleCompactSettings(): void {
  if (isInteractionDisabled.value) return
  isCompactSettingsOpen.value = !isCompactSettingsOpen.value
}

function closeCompactSettings(): void {
  isCompactSettingsOpen.value = false
}

function onDictationToggle(): void {
  if (usesDictationUploadFallback.value) {
    triggerAudioCapture()
    return
  }
  if (!props.dictationClickToToggle) return
  if (dictationFeedback.value) {
    dictationFeedback.value = ''
  }
  if (dictationState.value === 'idle') {
    dictationShouldRollbackLatestUserTurn = false
  }
  toggleRecording()
}

function onDictationPressStart(event: PointerEvent): void {
  if (!supportsLiveRecording.value) return
  if (props.dictationClickToToggle) return
  event.preventDefault()
  if (isHoldPressActive) return
  isHoldPressActive = true
  const target = event.currentTarget as HTMLElement | null
  if (target) {
    try {
      target.setPointerCapture(event.pointerId)
    } catch {
      // Ignore if pointer cannot be captured in the current environment.
    }
  }
  if (dictationFeedback.value) {
    dictationFeedback.value = ''
  }
  dictationShouldRollbackLatestUserTurn = false
  window.addEventListener('pointerup', onDictationPressEnd)
  window.addEventListener('pointercancel', onDictationPressEnd)
  window.addEventListener('blur', onDictationPressEnd)
  document.addEventListener('visibilitychange', onDocumentVisibilityChange)
  void startRecording()
}

function onDictationPressEnd(): void {
  if (props.dictationClickToToggle) return
  if (!isHoldPressActive) return
  isHoldPressActive = false
  window.removeEventListener('pointerup', onDictationPressEnd)
  window.removeEventListener('pointercancel', onDictationPressEnd)
  window.removeEventListener('blur', onDictationPressEnd)
  document.removeEventListener('visibilitychange', onDocumentVisibilityChange)
  stopRecording()
}

function onDictationTouchStart(event: TouchEvent): void {
  if (!supportsLiveRecording.value) return
  if (props.dictationClickToToggle) return
  onDictationPressStart(event as unknown as PointerEvent)
}

function onDictationTouchEnd(): void {
  if (!supportsLiveRecording.value) return
  if (props.dictationClickToToggle) return
  onDictationPressEnd()
}

function onDocumentVisibilityChange(): void {
  if (document.hidden) {
    onDictationPressEnd()
  }
}

function toggleAttachMenu(): void {
  if (isInteractionDisabled.value) return
  isAttachMenuOpen.value = !isAttachMenuOpen.value
}

function triggerPhotoLibrary(): void {
  photoLibraryInputRef.value?.click()
}

function triggerCameraCapture(): void {
  cameraCaptureInputRef.value?.click()
}

function triggerAudioCapture(): void {
  if (isInteractionDisabled.value) return
  dictationFeedback.value = DICTATION_UPLOAD_FALLBACK_MESSAGE
  const input = audioCaptureInputRef.value
  if (!input) return
  input.value = ''
  input.click()
}

function triggerFolderPicker(): void {
  folderPickerInputRef.value?.click()
}

async function onAudioCaptureChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement | null
  const file = input?.files?.[0]
  if (input) {
    input.value = ''
  }
  if (!file) return
  dictationShouldRollbackLatestUserTurn = false
  dictationFeedback.value = ''
  try {
    await transcribeFile(file)
  } catch (error) {
    dictationFeedback.value = error instanceof Error ? error.message : '语音听写失败。'
  }
}

function removeImage(id: string): void {
  selectedImages.value = selectedImages.value.filter((image) => image.id !== id)
}

function removeSkill(path: string): void {
  selectedSkills.value = selectedSkills.value.filter((s) => s.path !== path)
}

function removeFileAttachment(fsPath: string): void {
  fileAttachments.value = fileAttachments.value.filter((a) => a.fsPath !== fsPath)
}

function removeFolderAttachment(groupId: string): void {
  const group = folderUploadGroups.value.find((item) => item.id === groupId)
  if (!group) return
  const toRemove = new Set(group.filePaths)
  fileAttachments.value = fileAttachments.value.filter((a) => !toRemove.has(a.fsPath))
  folderUploadGroups.value = folderUploadGroups.value.filter((item) => item.id !== groupId)
}

function getFolderUploadPercent(group: FolderUploadGroup): number {
  if (group.total <= 0) return 0
  return Math.round((group.processed / group.total) * 100)
}

function addFileAttachment(filePath: string, customLabel?: string): void {
  const normalized = filePath.replace(/\\/g, '/')
  if (fileAttachments.value.some((a) => a.fsPath === normalized)) return
  const parts = normalized.split('/').filter(Boolean)
  const label = customLabel?.trim() || parts[parts.length - 1] || normalized
  fileAttachments.value = [...fileAttachments.value, { label, path: normalized, fsPath: normalized }]
}

function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  return /\.(png|jpe?g|gif|webp)$/i.test(file.name)
}

function appendSelectedImage(name: string, url: string): void {
  selectedImages.value.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name,
    url,
    previewUrl: toRenderableImageUrl(url),
  })
}

function appendImageFromReader(file: File, generation: number): void {
  const reader = new FileReader()
  reader.onload = () => {
    if (generation !== draftGeneration.value) return
    if (typeof reader.result !== 'string') return
    appendSelectedImage(file.name, reader.result)
  }
  reader.readAsDataURL(file)
}

function addFiles(files: FileList | null): void {
  if (!files || files.length === 0) return
  const generation = draftGeneration.value
  for (const file of Array.from(files)) {
    if (isImageFile(file)) {
      void uploadFile(file).then((serverPath) => {
        if (generation !== draftGeneration.value) return
        if (serverPath) {
          appendSelectedImage(file.name, serverPath)
          return
        }
        appendImageFromReader(file, generation)
      }).catch(() => {
        appendImageFromReader(file, generation)
      })
    } else {
      void uploadFile(file).then((serverPath) => {
        if (generation !== draftGeneration.value) return
        if (serverPath) addFileAttachment(serverPath)
      }).catch(() => {})
    }
  }
}

async function addFolderFiles(files: FileList | null): Promise<void> {
  if (!files || files.length === 0) return
  const generation = draftGeneration.value
  const rows = Array.from(files)
  const firstRelativePath = (rows[0] as File & { webkitRelativePath?: string }).webkitRelativePath || rows[0].name
  const folderName = firstRelativePath.split('/').filter(Boolean)[0] || '文件夹'
  const groupId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  folderUploadGroups.value = [
    ...folderUploadGroups.value,
    {
      id: groupId,
      name: folderName,
      total: rows.length,
      processed: 0,
      filePaths: [],
      isUploading: true,
    },
  ]

  const updateGroup = (updater: (group: FolderUploadGroup) => FolderUploadGroup): void => {
    if (generation !== draftGeneration.value) return
    folderUploadGroups.value = folderUploadGroups.value.map((group) => (
      group.id === groupId ? updater(group) : group
    ))
  }

  for (const file of rows) {
    try {
      const serverPath = await uploadFile(file)
      if (generation !== draftGeneration.value) return
      if (serverPath) {
        const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
        addFileAttachment(serverPath, relativePath)
        updateGroup((group) => ({
          ...group,
          processed: group.processed + 1,
          filePaths: [...group.filePaths, serverPath],
        }))
        continue
      }
      updateGroup((group) => ({ ...group, processed: group.processed + 1 }))
    } catch {
      updateGroup((group) => ({ ...group, processed: group.processed + 1 }))
    }
  }

  updateGroup((group) => ({ ...group, isUploading: false }))
}

function clearInputValue(inputRefEl: HTMLInputElement | null): void {
  if (inputRefEl) inputRefEl.value = ''
}

function onPhotoLibraryChange(event: Event): void {
  const input = event.target as HTMLInputElement | null
  addFiles(input?.files ?? null)
  clearInputValue(input)
  isAttachMenuOpen.value = false
}

function onCameraCaptureChange(event: Event): void {
  const input = event.target as HTMLInputElement | null
  addFiles(input?.files ?? null)
  clearInputValue(input)
  isAttachMenuOpen.value = false
}

function onFolderPickerChange(event: Event): void {
  const input = event.target as HTMLInputElement | null
  void addFolderFiles(input?.files ?? null)
  clearInputValue(input)
  isAttachMenuOpen.value = false
}

function onInputChange(): void {
  if (dictationFeedback.value) {
    dictationFeedback.value = ''
  }
  const text = draft.value
  const shouldShowSlashMenu = text.startsWith('/')
  if (shouldShowSlashMenu !== isSlashMenuOpen.value) {
    isSlashMenuOpen.value = shouldShowSlashMenu
  }
  updateFileMentionState()
}

function onInputKeydown(event: KeyboardEvent): void {
  if (isFileMentionOpen.value) {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeFileMention()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (fileMentionSuggestions.value.length > 0) {
        fileMentionHighlightedIndex.value =
          (fileMentionHighlightedIndex.value + 1) % fileMentionSuggestions.value.length
      }
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (fileMentionSuggestions.value.length > 0) {
        const size = fileMentionSuggestions.value.length
        fileMentionHighlightedIndex.value = (fileMentionHighlightedIndex.value + size - 1) % size
      }
      return
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      const selected = fileMentionSuggestions.value[fileMentionHighlightedIndex.value]
      if (selected) {
        applyFileMention(selected)
      } else {
        closeFileMention()
      }
      return
    }
  }

  const shouldSend = props.sendWithEnter !== false
    ? event.key === 'Enter' && !event.shiftKey
    : event.key === 'Enter' && (event.metaKey || event.ctrlKey)
  if (shouldSend) {
    event.preventDefault()
    onSubmit(resolveSubmitMode())
    return
  }

  if (isSlashMenuOpen.value) {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeSlashMenu()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      return
    }
  }
}

function closeSlashMenu(): void {
  isSlashMenuOpen.value = false
  inputRef.value?.focus()
}

function closeFileMention(): void {
  isFileMentionOpen.value = false
  mentionStartIndex.value = null
  mentionQuery.value = ''
  fileMentionSuggestions.value = []
  fileMentionHighlightedIndex.value = 0
}

function updateFileMentionState(): void {
  const input = inputRef.value
  if (!input) {
    closeFileMention()
    return
  }
  const cursor = input.selectionStart ?? draft.value.length
  const beforeCursor = draft.value.slice(0, cursor)
  const match = beforeCursor.match(/(^|\s)(@[^\s@]*)$/)
  if (!match) {
    closeFileMention()
    return
  }

  const mentionToken = match[2] ?? ''
  const mentionOffset = mentionToken.length
  const startIndex = cursor - mentionOffset
  mentionStartIndex.value = startIndex
  mentionQuery.value = mentionToken.slice(1)
  isFileMentionOpen.value = true
  void queueFileMentionSearch()
}

async function queueFileMentionSearch(): Promise<void> {
  if (!isFileMentionOpen.value) return
  const cwd = (props.cwd ?? '').trim()
  if (!cwd) {
    fileMentionSuggestions.value = []
    return
  }
  if (fileMentionDebounceTimer) {
    clearTimeout(fileMentionDebounceTimer)
  }
  const token = ++fileMentionSearchToken
  fileMentionDebounceTimer = setTimeout(async () => {
    try {
      const rows = await searchComposerFiles(cwd, mentionQuery.value, 20)
      if (!isFileMentionOpen.value || token !== fileMentionSearchToken) return
      fileMentionSuggestions.value = rows
      fileMentionHighlightedIndex.value = 0
    } catch {
      if (!isFileMentionOpen.value || token !== fileMentionSearchToken) return
      fileMentionSuggestions.value = []
    }
  }, 120)
}

function applyFileMention(suggestion: ComposerFileSuggestion): void {
  const input = inputRef.value
  const start = mentionStartIndex.value
  if (start !== null && input) {
    const cursor = input.selectionStart ?? draft.value.length
    draft.value = `${draft.value.slice(0, start)}${draft.value.slice(cursor)}`.trimEnd()
  }
  addFileAttachment(suggestion.path)
  closeFileMention()
  nextTick(() => input?.focus())
}

function hydrateDraft(payload: ComposerDraftPayload): void {
  cancelDictation()
  replaceDraftState(payload)
  nextTick(() => inputRef.value?.focus())
}

function getMentionFileName(path: string): string {
  const idx = path.lastIndexOf('/')
  if (idx < 0) return path
  return path.slice(idx + 1)
}

function getMentionDirName(path: string): string {
  const idx = path.lastIndexOf('/')
  if (idx <= 0) return ''
  return path.slice(0, idx)
}

function getFileExtension(path: string): string {
  const base = getMentionFileName(path)
  const idx = base.lastIndexOf('.')
  if (idx <= 0) return ''
  return base.slice(idx + 1).toLowerCase()
}

function getMentionBadgeText(path: string): string {
  const ext = getFileExtension(path)
  if (ext === 'ts') return 'TS'
  if (ext === 'tsx') return 'TSX'
  if (ext === 'js') return 'JS'
  if (ext === 'jsx') return 'JSX'
  if (ext === 'json') return '{}'
  return ''
}

function getMentionBadgeClass(path: string): string {
  const ext = getFileExtension(path)
  if (ext.startsWith('ts')) return 'ts'
  if (ext.startsWith('js')) return 'js'
  if (ext === 'json') return 'json'
  return 'default'
}

function isMarkdownFile(path: string): boolean {
  const ext = getFileExtension(path)
  return ext === 'md' || ext === 'mdx'
}

function onSlashSkillSelect(skill: SkillItem): void {
  if (!selectedSkills.value.some((s) => s.path === skill.path)) {
    selectedSkills.value = [...selectedSkills.value, skill]
  }
  draft.value = draft.value.startsWith('/') ? '' : draft.value
  isSlashMenuOpen.value = false
  inputRef.value?.focus()
}

function onSkillDropdownToggle(path: string, checked: boolean): void {
  if (checked) {
    const skill = (props.skills ?? []).find((s) => s.path === path)
    if (skill && !selectedSkills.value.some((s) => s.path === path)) {
      selectedSkills.value = [...selectedSkills.value, skill]
    }
  } else {
    selectedSkills.value = selectedSkills.value.filter((s) => s.path !== path)
  }
}

function onDocumentClick(event: MouseEvent): void {
  if (!isAttachMenuOpen.value) return
  const root = attachMenuRootRef.value
  if (!root) return
  const target = event.target as Node | null
  if (!target || root.contains(target)) return
  isAttachMenuOpen.value = false
}

function syncCompactViewport(): void {
  if (typeof window === 'undefined') return
  isCompactViewport.value = window.matchMedia('(max-width: 767px)').matches
  if (!isCompactViewport.value) {
    isCompactSettingsOpen.value = false
  }
}

onMounted(() => {
  syncCompactViewport()
  document.addEventListener('click', onDocumentClick)
  window.addEventListener('resize', syncCompactViewport)
  window.visualViewport?.addEventListener('resize', syncCompactViewport)
})

defineExpose<ThreadComposerExposed>({
  hydrateDraft,
  hasUnsavedDraft: () => hasUnsavedDraft.value,
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('visibilitychange', onDocumentVisibilityChange)
  window.removeEventListener('resize', syncCompactViewport)
  window.visualViewport?.removeEventListener('resize', syncCompactViewport)
  window.removeEventListener('pointerup', onDictationPressEnd)
  window.removeEventListener('pointercancel', onDictationPressEnd)
  window.removeEventListener('blur', onDictationPressEnd)
  if (fileMentionDebounceTimer) {
    clearTimeout(fileMentionDebounceTimer)
  }
})

watch(
  () => props.activeThreadId,
  (nextThreadId) => {
    cancelDictation()
    if (lastActiveThreadId) {
      persistDraftForThread(lastActiveThreadId, getCurrentDraftPayload())
    }
    clearDraftState()
    const restored = loadPersistedDraftForThread(nextThreadId)
    if (restored) {
      replaceDraftState(restored)
      onInputChange()
    }
    lastActiveThreadId = nextThreadId.trim()
  },
  { immediate: true },
)

watch([draft, selectedImages, fileAttachments, selectedSkills], () => {
  if (!lastActiveThreadId) return
  persistDraftForThread(lastActiveThreadId, getCurrentDraftPayload())
}, { deep: true })

watch(
  () => props.cwd,
  () => {
    if (isFileMentionOpen.value) {
      void queueFileMentionSearch()
    }
  },
)

watch(
  () => props.prependDraftRequest?.id,
  () => {
    const text = props.prependDraftRequest?.text?.trim() ?? ''
    if (!text) return
    draft.value = draft.value ? `${text}\n${draft.value}` : text
    onInputChange()
    nextTick(() => inputRef.value?.focus())
  },
)
</script>

<style scoped>
@reference "tailwindcss";

.thread-composer {
  @apply w-full mx-auto px-2 sm:px-6;
  max-width: min(var(--content-shell-max-width, 88rem), 100%);
}

.thread-composer-shell {
  @apply relative rounded-[20px] border border-[#e3d9c8] bg-[#fffdf8] p-2 sm:p-2.5;
  box-shadow: 0 12px 26px -34px rgba(31, 41, 55, 0.16);
}

.thread-composer-shell--no-top-radius {
  @apply rounded-t-none border-t-0;
}

.thread-composer-attachments {
  @apply mb-2 flex flex-wrap gap-2;
}

.thread-composer-attachment {
  @apply relative h-14 w-14 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50;
}

.thread-composer-attachment-image {
  @apply h-full w-full object-cover;
}

.thread-composer-attachment-remove {
  @apply absolute right-0.5 top-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full border-0 bg-black/70 text-xs leading-none text-white;
}

.thread-composer-file-chips {
  @apply mb-2 flex flex-wrap gap-1.5;
}

.thread-composer-folder-chips {
  @apply mb-2 flex flex-wrap gap-1.5;
}

.thread-composer-folder-chip {
  @apply inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-800;
}

.thread-composer-folder-chip-icon {
  @apply h-3.5 w-3.5 text-amber-600 shrink-0;
}

.thread-composer-folder-chip-name {
  @apply truncate max-w-40 font-medium;
}

.thread-composer-folder-chip-meta {
  @apply text-amber-700/90;
}

.thread-composer-folder-chip-remove {
  @apply ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border-0 bg-transparent text-amber-600 transition hover:bg-amber-200 hover:text-amber-800 text-xs leading-none p-0;
}

.thread-composer-file-chip {
  @apply inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-700;
}

.thread-composer-file-chip-icon {
  @apply h-3.5 w-3.5 text-zinc-400 shrink-0;
}

.thread-composer-file-chip-name {
  @apply truncate max-w-40 font-mono;
}

.thread-composer-file-chip-remove {
  @apply ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border-0 bg-transparent text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700 text-xs leading-none p-0;
}

.thread-composer-skill-chips {
  @apply mb-2 flex flex-wrap gap-1.5;
}

.thread-composer-skill-chip {
  @apply inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700;
}

.thread-composer-skill-chip-name {
  @apply font-medium;
}

.thread-composer-skill-chip-remove {
  @apply ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border-0 bg-transparent text-emerald-500 transition hover:bg-emerald-200 hover:text-emerald-700 text-xs leading-none p-0;
}

.thread-composer-input-wrap {
  @apply relative;
}

.thread-composer-file-mentions {
  @apply absolute left-0 right-0 bottom-[calc(100%+8px)] z-40 max-h-52 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1;
}

.thread-composer-file-mentions--sheet {
  @apply fixed left-3 right-3 bottom-[calc(env(safe-area-inset-bottom)+5.75rem)] z-[70] max-h-[min(40dvh,22rem)] rounded-[22px] border border-[#ddd5c7] bg-[#fffdf8] p-2;
}

.thread-composer-file-mention-row {
  @apply flex w-full items-center gap-2 rounded-md border-0 bg-transparent px-2 py-1.5 text-left text-xs text-zinc-700 transition hover:bg-zinc-100;
  font-family: var(--font-sans-ui);
}

.thread-composer-file-mention-row.is-active {
  @apply bg-zinc-100;
}

.thread-composer-file-mention-icon-badge {
  @apply inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-[9px] font-semibold leading-none;
}

.thread-composer-file-mention-icon-badge.is-ts {
  @apply bg-zinc-700 text-white;
}

.thread-composer-file-mention-icon-badge.is-js {
  @apply bg-zinc-600 text-white;
}

.thread-composer-file-mention-icon-badge.is-json {
  @apply bg-zinc-600 text-white;
}

.thread-composer-file-mention-icon-markdown {
  @apply inline-flex h-5 min-w-5 items-center justify-center text-sm leading-none text-zinc-700;
}

.thread-composer-file-mention-icon-file {
  @apply h-4 w-4 text-zinc-600;
}

.thread-composer-file-mention-text {
  @apply min-w-0 flex items-baseline gap-2;
}

.thread-composer-file-mention-name {
  @apply truncate text-zinc-900;
  font-family: var(--font-sans-reading);
}

.thread-composer-file-mention-dir {
  @apply truncate text-zinc-400;
  font-family: var(--font-sans-ui);
}

.thread-composer-file-mention-empty {
  @apply px-2 py-1.5 text-xs text-zinc-500;
}

.thread-composer-input {
  @apply w-full min-w-0 min-h-9 sm:min-h-10 max-h-36 rounded-xl border-0 bg-transparent px-1 py-1.5 text-sm text-zinc-900 outline-none transition resize-none overflow-y-auto;
  font-family: var(--font-sans-reading);
  font-size: var(--font-size-reading, 15px);
  line-height: 1.55;
  letter-spacing: var(--tracking-body-soft);
}

.thread-composer-input:focus {
  @apply ring-0;
}

.thread-composer-input:disabled {
  @apply bg-zinc-100 text-zinc-500 cursor-not-allowed;
}

.thread-composer-controls {
  @apply relative mt-1.5 sm:mt-2 flex items-center gap-2 sm:gap-2.5 overflow-visible;
}

.thread-composer-controls--recording {
  @apply gap-1 sm:gap-2;
}

.thread-composer-attach {
  @apply relative shrink-0;
}

.thread-composer-attach-trigger {
  @apply inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-transparent bg-transparent text-xl leading-none text-zinc-700 transition hover:border-[#e3dacb] hover:bg-[#f5f0e6] hover:text-zinc-900 disabled:cursor-not-allowed disabled:text-zinc-400;
}

.thread-composer-attach-menu {
  @apply absolute bottom-11 left-0 z-20 w-72 max-w-[calc(100vw-1rem)] rounded-xl border border-zinc-200 bg-white p-1;
}

.thread-composer-attach-menu--sheet {
  @apply fixed left-3 right-3 bottom-[calc(env(safe-area-inset-bottom)+5.75rem)] z-[70] w-auto max-w-none rounded-[24px] border border-[#ddd5c7] bg-[#fffdf8] p-2;
}

.thread-composer-attach-item {
  @apply block w-full rounded-lg border-0 bg-transparent px-3 py-2 text-left text-sm text-zinc-800 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-400;
}

.thread-composer-attach-separator {
  @apply my-1 h-px bg-zinc-100;
}

.thread-composer-attach-setting {
  @apply flex w-full items-center justify-between gap-3 rounded-lg border-0 bg-transparent px-3 py-2 text-left transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-400;
}

.thread-composer-attach-setting-copy {
  @apply min-w-0 flex flex-col;
}

.thread-composer-attach-setting-label {
  @apply text-sm text-zinc-800;
}

.thread-composer-attach-setting-description {
  @apply mt-0.5 text-xs text-zinc-500;
}

.thread-composer-attach-switch {
  @apply relative h-5 w-9 shrink-0 rounded-full bg-zinc-300 transition-colors;
}

.thread-composer-attach-switch::after {
  content: '';
  @apply absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform shadow-sm;
}

.thread-composer-attach-switch.is-on {
  @apply bg-emerald-600;
}

.thread-composer-attach-switch.is-on::after {
  transform: translateX(16px);
}

.thread-composer-attach-switch.is-busy {
  @apply opacity-70;
}

.thread-composer-attach-switch.is-disabled {
  @apply opacity-50;
}

.thread-composer-control {
  @apply shrink min-w-0;
}

.thread-composer-control--skills {
  @apply flex-1 min-w-0 w-full;
  overflow: hidden;
}

.thread-composer-control--skills :deep(.search-dropdown-trigger) {
  width: 100%;
  min-width: 0;
  overflow: hidden;
}

.thread-composer-control--skills :deep(.search-dropdown-value) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.thread-composer-control-strip {
  @apply min-w-0 flex flex-1 items-center gap-2 sm:gap-2;
}

.thread-composer-mode-toggle {
  @apply inline-grid h-9 shrink-0 grid-cols-2 overflow-hidden rounded-[14px] border border-[#e4dac9] bg-[#f7f3ea] p-0.5;
}

.thread-composer-mode-toggle button {
  @apply min-w-0 rounded-[11px] px-2.5 text-[13px] font-semibold leading-none text-[#7a705f] transition disabled:cursor-not-allowed disabled:opacity-50;
}

.thread-composer-mode-toggle button.is-active {
  @apply bg-[#0f766e] text-white shadow-sm;
}

.thread-composer-control :deep(.composer-dropdown-value) {
  @apply truncate;
}

.thread-composer-control :deep(.search-dropdown-value) {
  @apply truncate;
}

.thread-composer-actions {
  @apply ml-auto flex min-w-0 items-center gap-2;
}

.thread-composer-compact-settings-trigger {
  @apply inline-flex h-9 shrink-0 items-center gap-1.5 rounded-2xl border border-[#e4dac9] bg-[#f7f3ea] px-3 text-sm font-medium text-[#544a3d] transition hover:border-[#d7ccb8] hover:bg-[#efe8dc] disabled:cursor-not-allowed disabled:opacity-50;
}

.thread-composer-compact-settings-icon {
  @apply h-4 w-4 shrink-0 text-[#7a705f];
}

.thread-composer-compact-settings-label {
  @apply whitespace-nowrap;
}

.thread-composer-mobile-backdrop {
  @apply fixed inset-0 z-[60] border-0 bg-[#1f2937]/24 p-0;
}

.thread-composer-compact-settings-panel {
  @apply fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5.75rem)] z-[70] rounded-[24px] border border-[#ddd5c7] bg-[#fffdf8] p-3 shadow-xl shadow-[#1f2937]/10;
}

.thread-composer-compact-settings-header {
  @apply mb-3 flex items-center justify-between gap-3;
}

.thread-composer-compact-settings-title {
  @apply text-sm font-semibold text-[#2d261f];
}

.thread-composer-compact-settings-close {
  @apply rounded-full border border-[#e4dac9] bg-[#f7f3ea] px-3 py-1 text-xs font-medium text-[#544a3d] transition hover:bg-[#efe8dc];
}

.thread-composer-compact-settings-grid {
  @apply flex flex-col gap-2;
}

.thread-composer-actions--recording {
  @apply ml-0 flex-1;
}

.thread-composer-mic {
  @apply inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#e2d8c8] bg-[#f7f3ea] text-zinc-600 transition hover:bg-[#efe8dc] hover:text-zinc-900 disabled:cursor-not-allowed disabled:text-zinc-400;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}

.thread-composer-mic--active {
  @apply bg-red-100 text-red-600 hover:bg-red-200 hover:text-red-700;
}

.thread-composer-mic-icon {
  @apply h-5 w-5;
}

.thread-composer-dictation-waveform-wrap {
  @apply min-w-0 flex-1;
}

.thread-composer-dictation-waveform {
  @apply block h-9 w-full text-zinc-500;
}

.thread-composer-dictation-timer {
  @apply shrink-0 text-sm text-zinc-500 tabular-nums;
}

.thread-composer-dictation-error {
  @apply mb-2 px-1 text-xs text-amber-700;
}

.thread-composer-dictation-helper {
  @apply mb-2 px-1 text-xs text-[#7a705f];
}

.thread-composer-submit {
  @apply inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-0 bg-[#0d9488] text-white transition hover:bg-[#0f766e] disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500;
  box-shadow: 0 12px 24px -20px rgba(13, 148, 136, 0.56);
}

.thread-composer-submit--queue {
  @apply bg-[#ea580c] hover:bg-[#c2410c];
}

@media (min-width: 1024px) {
  .thread-composer {
    @apply px-5;
  }

  .thread-composer-shell {
    @apply px-4 py-3 rounded-[22px];
  }
}

.thread-composer-submit-icon {
  @apply h-5 w-5;
}

.thread-composer-stop {
  @apply inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-0 bg-[#1f2937] text-white transition hover:bg-[#111827] disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500;
}

.thread-composer-stop-icon {
  @apply h-5 w-5;
}

.thread-composer-hidden-input {
  @apply hidden;
}

@media (max-width: 767px) {
  .thread-composer {
    @apply px-2;
  }

  .thread-composer-shell {
    @apply rounded-[16px] px-2.5 py-1.5;
  }

  .thread-composer-input {
    @apply min-h-8 py-1 text-[14px];
    line-height: 1.42;
  }

  .thread-composer-controls {
    @apply mt-1 items-center gap-1.5;
    display: grid;
    grid-template-columns: 2.25rem minmax(0, 1fr) auto;
  }

  .thread-composer-attach {
    @apply min-w-0 shrink-0;
  }

  .thread-composer-control-strip {
    @apply w-full min-w-0 gap-1 pr-0 overflow-visible;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) 2.25rem;
  }

  .thread-composer-mode-toggle {
    @apply h-9;
  }

  .thread-composer-mode-toggle button {
    @apply px-2 text-[12px];
  }

  .thread-composer-control {
    min-width: 0;
    max-width: none;
  }

  .thread-composer-actions {
    @apply ml-0 min-w-0 shrink-0 w-auto justify-end;
    justify-self: end;
  }

  .thread-composer-attach-trigger,
  .thread-composer-mic,
  .thread-composer-submit,
  .thread-composer-stop {
    @apply h-9 w-9;
  }

  .thread-composer-attach-menu {
    left: 0;
    right: auto;
    bottom: 3rem;
    width: min(20rem, calc(100vw - 1.5rem));
    max-width: min(20rem, calc(100vw - 1.5rem));
  }

  .thread-composer-control :deep(.composer-dropdown-trigger),
  .thread-composer-control :deep(.search-dropdown-trigger) {
    @apply h-9 rounded-[14px] border border-[#e4dac9] bg-[#f7f3ea] px-2.5 text-[13px];
  }

  .thread-composer-control :deep(.composer-dropdown-trigger) {
    min-width: 100%;
  }

  .thread-composer-control :deep(.search-dropdown-trigger) {
    min-width: 100%;
    justify-content: space-between;
  }

  .thread-composer-compact-settings-trigger {
    @apply h-9 w-9 justify-center rounded-[14px] px-0;
  }

  .thread-composer-compact-settings-label {
    @apply sr-only;
  }
}
</style>
