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

      <div v-if="selectedPlugins.length > 0 || goalModeEnabled" class="thread-composer-option-chips">
        <span v-for="plugin in selectedPlugins" :key="getSelectedPluginKey(plugin)" class="thread-composer-option-chip">
          <span class="thread-composer-option-chip-dot" aria-hidden="true" />
          <span class="thread-composer-option-chip-name">{{ plugin.name }}</span>
          <button
            class="thread-composer-option-chip-remove"
            type="button"
            :aria-label="`移除插件 ${plugin.name}`"
            @click="removePlugin(getSelectedPluginKey(plugin))"
          >×</button>
        </span>
        <span v-if="goalModeEnabled" class="thread-composer-option-chip thread-composer-option-chip--goal">
          <span class="thread-composer-option-chip-dot" aria-hidden="true" />
          <span class="thread-composer-option-chip-name">{{ activeGoalLabel }}</span>
          <button
            class="thread-composer-option-chip-remove"
            type="button"
            aria-label="关闭追求目标"
            @click="disableGoalMode"
          >×</button>
        </span>
      </div>

      <div class="thread-composer-input-wrap">
        <button
          v-if="isFileMentionOpen && isCompactViewport"
          class="thread-composer-mobile-backdrop"
          type="button"
          aria-label="关闭文件引用菜单"
          @pointerdown.stop.prevent="closeFileMention"
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
          rows="1"
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
            @pointerdown.stop.prevent="closeAttachMenu"
            @click="closeAttachMenu"
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
              <IconTablerFilePencil class="thread-composer-attach-item-icon" />
              <span class="thread-composer-attach-item-body">
                <span class="thread-composer-attach-item-title">添加照片和文件</span>
                <span class="thread-composer-attach-item-subtitle">上传图片、文档或其他附件</span>
              </span>
            </button>
            <button
              class="thread-composer-attach-item"
              type="button"
              :disabled="isInteractionDisabled"
              @click="triggerFolderPicker"
            >
              <IconTablerFolder class="thread-composer-attach-item-icon" />
              <span class="thread-composer-attach-item-body">
                <span class="thread-composer-attach-item-title">添加文件夹</span>
                <span class="thread-composer-attach-item-subtitle">批量引用整个目录里的文件</span>
              </span>
            </button>
            <button
              class="thread-composer-attach-item"
              type="button"
              :disabled="isInteractionDisabled"
              @click="triggerCameraCapture"
            >
              <span class="thread-composer-attach-item-icon thread-composer-attach-item-icon--text">●</span>
              <span class="thread-composer-attach-item-body">
                <span class="thread-composer-attach-item-title">拍照</span>
                <span class="thread-composer-attach-item-subtitle">调用移动端相机上传图片</span>
              </span>
            </button>
            <div class="thread-composer-attach-separator" />
            <button
              class="thread-composer-attach-item thread-composer-attach-item--toggle"
              type="button"
              :aria-pressed="selectedCollaborationMode === 'plan'"
              :disabled="isInteractionDisabled"
              @click="togglePlanMode"
            >
              <span class="thread-composer-attach-item-icon thread-composer-attach-item-icon--text">✓</span>
              <span class="thread-composer-attach-item-body">
                <span class="thread-composer-attach-item-title">计划模式</span>
                <span class="thread-composer-attach-item-subtitle">
                  {{ selectedCollaborationMode === 'plan' ? '只制定计划，发送后回到执行' : '先规划，不执行文件和命令' }}
                </span>
              </span>
              <span class="thread-composer-switch" :class="{ 'is-on': selectedCollaborationMode === 'plan' }" aria-hidden="true" />
            </button>
            <button
              class="thread-composer-attach-item thread-composer-attach-item--toggle"
              type="button"
              :aria-pressed="goalModeEnabled"
              :disabled="isInteractionDisabled"
              @click="toggleGoalMode"
            >
              <span class="thread-composer-attach-item-icon thread-composer-attach-item-icon--text">◎</span>
              <span class="thread-composer-attach-item-body">
                <span class="thread-composer-attach-item-title">追求目标</span>
                <span class="thread-composer-attach-item-subtitle">{{ activeGoalLabel }}</span>
              </span>
              <span class="thread-composer-switch" :class="{ 'is-on': goalModeEnabled }" aria-hidden="true" />
            </button>
            <div v-if="goalModeEnabled" class="thread-composer-goal-editor">
              <textarea
                v-model="goalText"
                class="thread-composer-goal-input"
                placeholder="输入本轮要持续追求的目标，例如：给出可执行方案并主动补齐风险"
                :disabled="isInteractionDisabled"
                rows="2"
              />
            </div>
            <div class="thread-composer-attach-submenu-wrap">
              <button
                class="thread-composer-attach-item thread-composer-attach-item--submenu"
                type="button"
                :aria-expanded="isPluginSubmenuOpen"
                :disabled="isInteractionDisabled"
                @click="togglePluginSubmenu"
              >
                <span class="thread-composer-attach-item-icon thread-composer-attach-item-icon--grid">⌘</span>
                <span class="thread-composer-attach-item-body">
                  <span class="thread-composer-attach-item-title">插件</span>
                  <span class="thread-composer-attach-item-subtitle">{{ pluginMenuSummary }}</span>
                </span>
                <IconTablerChevronRight
                  class="thread-composer-attach-chevron"
                  :class="{ 'is-open': isPluginSubmenuOpen }"
                />
              </button>
              <div
                v-if="isPluginSubmenuOpen"
                class="thread-composer-plugin-menu"
                :class="{ 'thread-composer-plugin-menu--inline': isCompactViewport }"
              >
                <div class="thread-composer-plugin-menu-header">
                  <span>{{ pluginMenuTitle }}</span>
                  <button
                    type="button"
                    class="thread-composer-plugin-menu-action"
                    :disabled="props.isLoadingPlugins"
                    @click.stop="onRefreshPlugins"
                  >
                    刷新
                  </button>
                </div>
                <div v-if="props.isLoadingPlugins" class="thread-composer-plugin-menu-empty">正在读取插件...</div>
                <div v-else-if="pluginOptions.length === 0" class="thread-composer-plugin-menu-empty">
                  当前 app-server 没有返回可用插件
                </div>
                <template v-else>
                  <button
                    v-for="plugin in pluginOptions"
                    :key="`${plugin.source}:${plugin.id}`"
                    class="thread-composer-plugin-row"
                    :class="{
                      'is-selected': isPluginSelected(plugin),
                      'is-disabled': !isPluginSelectable(plugin),
                    }"
                    type="button"
                    :disabled="!isPluginSelectable(plugin)"
                    @click="onPluginRowClick(plugin)"
                  >
                    <span class="thread-composer-plugin-avatar">{{ getPluginAvatar(plugin.name) }}</span>
                    <span class="thread-composer-plugin-row-body">
                      <span class="thread-composer-plugin-row-title">{{ plugin.name }}</span>
                      <span class="thread-composer-plugin-row-meta">{{ getPluginMeta(plugin) }}</span>
                    </span>
                    <span v-if="isPluginSelected(plugin)" class="thread-composer-plugin-check">✓</span>
                    <span v-else-if="plugin.source === 'mcp' && plugin.authStatus === 'notLoggedIn'" class="thread-composer-plugin-login">登录</span>
                  </button>
                </template>
                <button
                  class="thread-composer-plugin-reload"
                  type="button"
                  :disabled="props.isLoadingPlugins"
                  @click="onReloadPlugins"
                >
                  重新加载插件配置
                </button>
              </div>
            </div>
            <div class="thread-composer-attach-section" aria-label="技能">
              <span class="thread-composer-attach-section-title">技能</span>
              <ComposerSearchDropdown
                class="thread-composer-attach-skill-dropdown"
                :options="skillDropdownOptions"
                :selected-values="selectedSkillPaths"
                placeholder="技能"
                search-placeholder="搜索技能..."
                open-direction="up"
                trigger-display-label="技能"
                :trigger-aria-label="skillTriggerLabel"
                :selected-count="selectedSkills.length"
                :disabled="disabled || !activeThreadId"
                @toggle="onSkillDropdownToggle"
              />
            </div>
          </div>
        </div>

        <div v-if="!isDictationRecording" class="thread-composer-control-strip" aria-label="发送设置">
          <div ref="runtimeSettingsRootRef" class="thread-composer-runtime">
            <button
              class="thread-composer-runtime-trigger"
              type="button"
              :disabled="isInteractionDisabled || models.length === 0"
              :aria-expanded="isRuntimeSettingsOpen"
              aria-label="配置模型、质量和速度"
              @click="toggleRuntimeSettings"
            >
              <IconTablerBolt
                v-if="selectedSpeedMode === 'fast'"
                class="thread-composer-runtime-bolt"
              />
              <span class="thread-composer-runtime-summary">{{ runtimeSettingsSummary }}</span>
              <IconTablerChevronDown
                class="thread-composer-runtime-chevron"
                :class="{ 'is-open': isRuntimeSettingsOpen }"
              />
            </button>
            <button
              v-if="isRuntimeSettingsOpen && isCompactViewport"
              class="thread-composer-mobile-backdrop"
              type="button"
              aria-label="关闭配置菜单"
              @pointerdown.stop.prevent="closeRuntimeSettings"
              @click="closeRuntimeSettings"
            />
            <div
              v-if="isRuntimeSettingsOpen"
              class="thread-composer-runtime-panel"
              :class="{ 'thread-composer-runtime-panel--sheet': isCompactViewport }"
              role="dialog"
              aria-label="模型、质量和速度"
            >
              <div v-if="isCompactViewport" class="thread-composer-runtime-handle" aria-hidden="true" />
              <div class="thread-composer-runtime-section">
                <div class="thread-composer-runtime-section-title">模型</div>
                <div class="thread-composer-runtime-options thread-composer-runtime-options--models">
                  <button
                    v-for="option in modelOptions"
                    :key="option.value"
                    class="thread-composer-runtime-option"
                    :class="{ 'is-selected': option.value === selectedModel }"
                    type="button"
                    :disabled="disabled || !activeThreadId"
                    @click="onRuntimeModelSelect(option.value)"
                  >
                    <span>{{ option.label }}</span>
                  </button>
                </div>
              </div>
              <div class="thread-composer-runtime-section">
                <div class="thread-composer-runtime-section-title">质量</div>
                <div class="thread-composer-runtime-options">
                  <button
                    v-for="option in reasoningOptions"
                    :key="option.value"
                    class="thread-composer-runtime-option"
                    :class="{ 'is-selected': option.value === selectedReasoningEffort }"
                    type="button"
                    :disabled="disabled || !activeThreadId"
                    @click="onRuntimeReasoningEffortSelect(option.value)"
                  >
                    <span>{{ option.label }}</span>
                  </button>
                </div>
              </div>
              <div class="thread-composer-runtime-section">
                <div class="thread-composer-runtime-section-title">速度</div>
                <div class="thread-composer-runtime-options">
                  <button
                    v-for="option in speedModeOptions"
                    :key="option.value"
                    class="thread-composer-runtime-option thread-composer-runtime-option--stacked"
                    :class="{ 'is-selected': option.value === selectedSpeedMode }"
                    type="button"
                    :disabled="isSpeedToggleDisabled"
                    @click="onRuntimeSpeedModeSelect(option.value)"
                  >
                    <span>{{ option.label }}</span>
                    <small>{{ option.description }}</small>
                  </button>
                </div>
              </div>
            </div>
          </div>
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
            v-if="shouldShowStopButton"
            class="thread-composer-stop"
            type="button"
            aria-label="停止"
            :disabled="disabled || !activeThreadId || isInterruptingTurn"
            @click="onInterruptClick"
          >
            <IconTablerPlayerStopFilled class="thread-composer-stop-icon" />
          </button>
          <button
            v-else
            class="thread-composer-submit"
            :class="{ 'thread-composer-submit--queue': isTurnInProgress }"
            type="button"
            :aria-label="submitActionLabel"
            :title="submitActionLabel"
            :disabled="!canSubmit"
            @click="onSubmit(resolveSubmitMode())"
          >
            <IconTablerArrowUp class="thread-composer-submit-icon" />
          </button>
        </div>
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
import type {
  CollaborationMode,
  ComposerPluginInfo,
  ComposerPluginSelection,
  ComposerTurnOptions,
  ReasoningEffort,
  SpeedMode,
  TurnGoalSelection,
} from '../../types/codex'
import { useDictation } from '../../composables/useDictation'
import { searchComposerFiles, uploadFile, type ComposerFileSuggestion } from '../../api/codexGateway'
import IconTablerArrowUp from '../icons/IconTablerArrowUp.vue'
import IconTablerBolt from '../icons/IconTablerBolt.vue'
import IconTablerChevronDown from '../icons/IconTablerChevronDown.vue'
import IconTablerChevronRight from '../icons/IconTablerChevronRight.vue'
import IconTablerFilePencil from '../icons/IconTablerFilePencil.vue'
import IconTablerFolder from '../icons/IconTablerFolder.vue'
import IconTablerMicrophone from '../icons/IconTablerMicrophone.vue'
import IconTablerPlayerStopFilled from '../icons/IconTablerPlayerStopFilled.vue'
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
  plugins?: ComposerPluginInfo[]
  isLoadingPlugins?: boolean
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
  plugins?: ComposerPluginSelection[]
  goal?: TurnGoalSelection
}

export type SubmitPayload = {
  text: string
  imageUrls: string[]
  fileAttachments: FileAttachment[]
  skills: Array<{ name: string; path: string }>
  turnOptions?: ComposerTurnOptions
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
  'refresh-plugins': []
  'reload-plugins': []
  'login-plugin': [pluginId: string]
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
const selectedPlugins = ref<ComposerPluginSelection[]>([])
const goalModeEnabled = ref(false)
const goalText = ref('')
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
const runtimeSettingsRootRef = ref<HTMLElement | null>(null)
const photoLibraryInputRef = ref<HTMLInputElement | null>(null)
const cameraCaptureInputRef = ref<HTMLInputElement | null>(null)
const audioCaptureInputRef = ref<HTMLInputElement | null>(null)
const folderPickerInputRef = ref<HTMLInputElement | null>(null)
const inputRef = ref<HTMLTextAreaElement | null>(null)
const isAttachMenuOpen = ref(false)
const isPluginSubmenuOpen = ref(false)
const isRuntimeSettingsOpen = ref(false)
const isSlashMenuOpen = ref(false)
const mentionStartIndex = ref<number | null>(null)
const mentionQuery = ref('')
const fileMentionSuggestions = ref<ComposerFileSuggestion[]>([])
const isFileMentionOpen = ref(false)
const fileMentionHighlightedIndex = ref(0)
const isCompactViewport = ref(false)
const draftGeneration = ref(0)
let fileMentionSearchToken = 0
let fileMentionDebounceTimer: ReturnType<typeof setTimeout> | null = null
let isHoldPressActive = false
let dictationShouldRollbackLatestUserTurn = false
const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
const DRAFT_STORAGE_PREFIX = 'codex-web-local.thread-draft.v1.'
const MOBILE_STOP_GUARD_MS = 2500
let lastActiveThreadId = ''
let stopGuardTimer: ReturnType<typeof setTimeout> | null = null

const reasoningOptions: Array<{ value: ReasoningEffort; label: string }> = [
  { value: 'none', label: '智能' },
  { value: 'minimal', label: '极低' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'xhigh', label: '超高' },
]

const speedModeOptions: Array<{ value: SpeedMode; label: string; description: string }> = [
  { value: 'standard', label: '标准', description: '默认速度，常规用量' },
  { value: 'fast', label: '快速', description: '约 1.5 倍速，用量增加' },
]

function formatModelLabel(modelId: string): string {
  return modelId.trim().replace(/^gpt/i, 'GPT')
}

function formatModelTriggerLabel(modelId: string): string {
  const normalized = modelId.trim().toLowerCase()
  const version = normalized.match(/^gpt-(\d+(?:\.\d+)?)/u)?.[1]
  if (version) {
    if (normalized.includes('spark')) return `${version} Spark`
    if (normalized.includes('mini')) return `${version} mini`
    return version
  }
  return formatModelLabel(modelId).replace(/^GPT-?/i, '').trim()
}

const modelOptions = computed(() =>
  props.models.map((modelId) => ({ value: modelId, label: formatModelLabel(modelId) })),
)
const selectedModelTriggerLabel = computed(() =>
  formatModelTriggerLabel(props.selectedModel) || '模型',
)
const selectedReasoningEffortTriggerLabel = computed(() => {
  const selected = reasoningOptions.find((option) => option.value === props.selectedReasoningEffort)
  return selected?.label ?? '智能'
})
const selectedSpeedModeTriggerLabel = computed(() =>
  props.selectedSpeedMode === 'fast' ? '快速' : '标准',
)
const runtimeSettingsSummary = computed(() => {
  const parts = [
    selectedModelTriggerLabel.value,
    selectedReasoningEffortTriggerLabel.value,
    selectedSpeedModeTriggerLabel.value,
  ].filter((part) => part.trim().length > 0)
  return parts.join(' · ') || '配置'
})

const skillOptions = computed<SkillItem[]>(() => props.skills ?? [])
const pluginOptions = computed<ComposerPluginInfo[]>(() => props.plugins ?? [])
const selectedSkillPaths = computed(() => selectedSkills.value.map((s) => s.path))
const skillTriggerLabel = computed(() => (
  selectedSkills.value.length > 0
    ? `选择技能，已选 ${selectedSkills.value.length} 个`
    : '选择技能'
))
const activeGoalLabel = computed(() => {
  const text = goalText.value.trim()
  if (goalModeEnabled.value && text) return text
  return goalModeEnabled.value ? '持续追求当前任务目标' : '保持默认单轮回复'
})
const pluginMenuTitle = computed(() =>
  pluginOptions.value.length > 0 ? `${pluginOptions.value.length} 个可用插件` : '插件',
)
const pluginMenuSummary = computed(() => {
  if (props.isLoadingPlugins) return '正在读取插件'
  if (selectedPlugins.value.length > 0) return `已选 ${selectedPlugins.value.length} 个插件`
  if (pluginOptions.value.length > 0) return `${pluginOptions.value.length} 个插件`
  return '读取插件'
})
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
  || selectedPlugins.value.length > 0
  || goalModeEnabled.value
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
const isSpeedToggleDisabled = computed(() =>
  isInteractionDisabled.value || props.isUpdatingSpeedMode === true,
)
const collaborationModeHintText = computed(() => {
  if (props.isTurnInProgress) return ''
  return props.selectedCollaborationMode === 'plan'
    ? '只制定计划，发送后自动回到执行'
    : ''
})
const submitActionLabel = computed(() => {
  if (props.isTurnInProgress) {
    return props.selectedCollaborationMode === 'plan'
      ? '加入计划消息队列'
      : '加入消息队列，等待当前任务结束后按顺序执行'
  }
  return props.selectedCollaborationMode === 'plan'
    ? '生成计划，不执行修改'
    : '发送'
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
  return ''
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
const isStopGuardActive = ref(false)
const shouldUseStopGuard = computed(() => isAndroid || isCompactViewport.value)
const shouldShowStopButton = computed(() => (
  props.isTurnInProgress === true
  && !hasSubmitContent.value
  && !isStopGuardActive.value
))

function resolveSubmitMode(): 'steer' | 'queue' {
  return props.isTurnInProgress ? 'queue' : 'steer'
}

function armStopGuard(): void {
  if (!shouldUseStopGuard.value) return
  isStopGuardActive.value = true
  if (stopGuardTimer) {
    clearTimeout(stopGuardTimer)
  }
  stopGuardTimer = setTimeout(() => {
    isStopGuardActive.value = false
    stopGuardTimer = null
  }, MOBILE_STOP_GUARD_MS)
}

function onInterruptClick(): void {
  if (isStopGuardActive.value) return
  emit('interrupt')
}

function onCollaborationModeSelect(mode: CollaborationMode): void {
  if (isInteractionDisabled.value) return
  emit('update:selected-collaboration-mode', mode)
}

function getPluginMentionPath(plugin: ComposerPluginSelection): string {
  const id = plugin.id.trim()
  return plugin.path?.trim() || (plugin.source === 'app' ? `app://${id}` : `plugin://${id}`)
}

function getSelectedPluginKey(plugin: ComposerPluginSelection): string {
  return getPluginMentionPath(plugin)
}

function normalizePluginSelection(plugin: ComposerPluginSelection): ComposerPluginSelection {
  const matched = (props.plugins ?? []).find((item) => (
    item.id === plugin.id
    && (plugin.path ? item.mentionPath === plugin.path : true)
  ))
  const source = plugin.source ?? matched?.source ?? 'mcp'
  const id = (matched?.id || plugin.id).trim()
  const name = (matched?.name || plugin.name || id).trim()
  const path = (matched?.mentionPath || plugin.path || (source === 'app' ? `app://${id}` : `plugin://${id}`)).trim()
  return { id, name, path, source }
}

function buildTurnOptions(): ComposerTurnOptions | undefined {
  const plugins = selectedPlugins.value.map((plugin) => normalizePluginSelection(plugin))
  const goal = goalModeEnabled.value
    ? { enabled: true, text: activeGoalLabel.value.trim() || '持续追求当前任务目标' }
    : undefined
  if (plugins.length === 0 && !goal) return undefined
  return {
    ...(plugins.length > 0 ? { plugins } : {}),
    ...(goal ? { goal } : {}),
  }
}

function onSubmit(mode: 'steer' | 'queue' = 'steer', options?: { rollbackLatestUserTurn?: boolean }): void {
  const text = draft.value.trim()
  if (!canSubmit.value) return
  if (mode === 'steer') {
    armStopGuard()
  }
  emit('submit', {
    text,
    imageUrls: selectedImages.value.map((image) => image.url),
    fileAttachments: [...fileAttachments.value],
    skills: selectedSkills.value.map((s) => ({ name: s.name, path: s.path })),
    turnOptions: buildTurnOptions(),
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
  selectedPlugins.value = (payload.plugins ?? []).map((plugin) => {
    return normalizePluginSelection(plugin)
  })
  goalModeEnabled.value = payload.goal?.enabled === true
  goalText.value = payload.goal?.text ?? ''
  fileAttachments.value = payload.fileAttachments.map((attachment) => ({ ...attachment }))
  folderUploadGroups.value = []
  dictationFeedback.value = ''
  isAttachMenuOpen.value = false
  isPluginSubmenuOpen.value = false
  isRuntimeSettingsOpen.value = false
  isSlashMenuOpen.value = false
  closeFileMention()
}

function clearDraftState(): void {
  replaceDraftState({
    text: '',
    imageUrls: [],
    fileAttachments: [],
    skills: [],
    plugins: [],
    goal: { enabled: false, text: '' },
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
      plugins: Array.isArray(parsed.plugins)
        ? parsed.plugins.filter((plugin): plugin is ComposerPluginSelection => (
          Boolean(plugin)
          && typeof plugin.id === 'string'
          && typeof plugin.name === 'string'
          && (
            typeof (plugin as Partial<ComposerPluginSelection>).path === 'undefined'
            || typeof (plugin as Partial<ComposerPluginSelection>).path === 'string'
          )
          && (
            typeof (plugin as Partial<ComposerPluginSelection>).source === 'undefined'
            || (plugin as Partial<ComposerPluginSelection>).source === 'mcp'
            || (plugin as Partial<ComposerPluginSelection>).source === 'app'
          )
        ))
        : [],
      goal: (
        parsed.goal &&
        typeof parsed.goal === 'object' &&
        !Array.isArray(parsed.goal)
      )
        ? {
            enabled: (parsed.goal as Partial<TurnGoalSelection>).enabled === true,
            text: typeof (parsed.goal as Partial<TurnGoalSelection>).text === 'string'
              ? ((parsed.goal as Partial<TurnGoalSelection>).text ?? '')
              : '',
          }
        : { enabled: false, text: '' },
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
      || (payload.plugins?.length ?? 0) > 0
      || payload.goal?.enabled === true
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
    plugins: [],
    goal: { enabled: false, text: '' },
  })
}

function getCurrentDraftPayload(): ComposerDraftPayload {
  return {
    text: draft.value,
    imageUrls: selectedImages.value.map((image) => image.url),
    fileAttachments: fileAttachments.value.map((attachment) => ({ ...attachment })),
    skills: selectedSkills.value.map((skill) => ({ name: skill.name, path: skill.path })),
    plugins: selectedPlugins.value.map((plugin) => ({ ...plugin })),
    goal: { enabled: goalModeEnabled.value, text: goalText.value.trim() },
  }
}

function onInterrupt(): void {
  onInterruptClick()
}

function onModelSelect(value: string): void {
  emit('update:selected-model', value)
}

function onReasoningEffortSelect(value: string): void {
  emit('update:selected-reasoning-effort', value as ReasoningEffort)
}

function onSpeedModeSelect(value: string): void {
  if (isSpeedToggleDisabled.value) return
  emit('update:selected-speed-mode', value === 'fast' ? 'fast' : 'standard')
}

function onRuntimeModelSelect(value: string): void {
  onModelSelect(value)
}

function onRuntimeReasoningEffortSelect(value: ReasoningEffort): void {
  onReasoningEffortSelect(value)
}

function onRuntimeSpeedModeSelect(value: SpeedMode): void {
  onSpeedModeSelect(value)
}

function toggleRuntimeSettings(): void {
  if (isInteractionDisabled.value || props.models.length === 0) return
  isRuntimeSettingsOpen.value = !isRuntimeSettingsOpen.value
  if (isRuntimeSettingsOpen.value) {
    isAttachMenuOpen.value = false
  }
}

function closeRuntimeSettings(): void {
  isRuntimeSettingsOpen.value = false
}

function togglePlanMode(): void {
  if (isInteractionDisabled.value) return
  onCollaborationModeSelect(props.selectedCollaborationMode === 'plan' ? 'execute' : 'plan')
}

function toggleGoalMode(): void {
  if (isInteractionDisabled.value) return
  goalModeEnabled.value = !goalModeEnabled.value
  if (goalModeEnabled.value && !goalText.value.trim()) {
    goalText.value = '持续追求当前任务目标，主动给出可执行的下一步。'
  }
}

function disableGoalMode(): void {
  goalModeEnabled.value = false
}

function togglePluginSubmenu(): void {
  if (isInteractionDisabled.value) return
  isPluginSubmenuOpen.value = !isPluginSubmenuOpen.value
  if (isPluginSubmenuOpen.value && pluginOptions.value.length === 0 && !props.isLoadingPlugins) {
    emit('refresh-plugins')
  }
}

function isPluginSelected(plugin: ComposerPluginInfo): boolean {
  return selectedPlugins.value.some((item) => getSelectedPluginKey(item) === plugin.mentionPath)
}

function isPluginSelectable(plugin: ComposerPluginInfo): boolean {
  if (plugin.source === 'app') {
    return plugin.isAccessible !== false && plugin.isEnabled !== false
  }
  return plugin.toolCount > 0
    || plugin.resourceCount > 0
    || plugin.resourceTemplateCount > 0
    || plugin.authStatus === 'notLoggedIn'
}

function onPluginRowClick(plugin: ComposerPluginInfo): void {
  if (!isPluginSelectable(plugin)) return
  if (plugin.source === 'mcp' && plugin.authStatus === 'notLoggedIn') {
    emit('login-plugin', plugin.id)
    return
  }
  if (isPluginSelected(plugin)) {
    removePlugin(plugin.mentionPath)
    return
  }
  selectedPlugins.value = [
    ...selectedPlugins.value,
    {
      id: plugin.id,
      name: plugin.name,
      path: plugin.mentionPath,
      source: plugin.source,
    },
  ]
}

function removePlugin(pluginKey: string): void {
  selectedPlugins.value = selectedPlugins.value.filter((plugin) => getSelectedPluginKey(plugin) !== pluginKey)
}

function onRefreshPlugins(): void {
  emit('refresh-plugins')
}

function onReloadPlugins(): void {
  emit('reload-plugins')
}

function getPluginAvatar(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || 'P'
}

function getPluginMeta(plugin: ComposerPluginInfo): string {
  if (plugin.source === 'app') {
    if (plugin.isAccessible === false) return '当前不可访问'
    if (plugin.isEnabled === false) return '未启用'
    return plugin.distributionChannel ? `应用 · ${plugin.distributionChannel}` : '应用插件'
  }
  if (plugin.authStatus === 'notLoggedIn') return '需要登录授权'
  const parts: string[] = []
  if (plugin.toolCount > 0) parts.push(`${plugin.toolCount} 个工具`)
  if (plugin.resourceCount > 0) parts.push(`${plugin.resourceCount} 个资源`)
  if (plugin.resourceTemplateCount > 0) parts.push(`${plugin.resourceTemplateCount} 个模板`)
  if (plugin.authStatus === 'unsupported' && parts.length > 0) {
    parts.push('本地能力')
  }
  return parts.join(' · ') || '暂无可用能力'
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
  if (isAttachMenuOpen.value) {
    isRuntimeSettingsOpen.value = false
  } else {
    isPluginSubmenuOpen.value = false
  }
}

function closeAttachMenu(): void {
  isAttachMenuOpen.value = false
  isPluginSubmenuOpen.value = false
}

function triggerPhotoLibrary(): void {
  closeAttachMenu()
  photoLibraryInputRef.value?.click()
}

function triggerCameraCapture(): void {
  closeAttachMenu()
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
  closeAttachMenu()
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
  closeAttachMenu()
}

function onCameraCaptureChange(event: Event): void {
  const input = event.target as HTMLInputElement | null
  addFiles(input?.files ?? null)
  clearInputValue(input)
  closeAttachMenu()
}

function onFolderPickerChange(event: Event): void {
  const input = event.target as HTMLInputElement | null
  void addFolderFiles(input?.files ?? null)
  clearInputValue(input)
  closeAttachMenu()
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
  const target = event.target as Node | null
  if (!target) return

  if (isAttachMenuOpen.value) {
    const attachRoot = attachMenuRootRef.value
    if (attachRoot && !attachRoot.contains(target)) {
      closeAttachMenu()
    }
  }

  if (isRuntimeSettingsOpen.value) {
    const runtimeRoot = runtimeSettingsRootRef.value
    if (runtimeRoot && !runtimeRoot.contains(target)) {
      isRuntimeSettingsOpen.value = false
    }
  }
}

function syncCompactViewport(): void {
  if (typeof window === 'undefined') return
  isCompactViewport.value = window.matchMedia('(max-width: 767px)').matches
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
  if (stopGuardTimer) {
    clearTimeout(stopGuardTimer)
    stopGuardTimer = null
  }
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

watch([draft, selectedImages, fileAttachments, selectedSkills, selectedPlugins, goalModeEnabled, goalText], () => {
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
  () => props.plugins,
  () => {
    if (selectedPlugins.value.length === 0) return
    selectedPlugins.value = selectedPlugins.value.map((plugin) => {
      const matched = (props.plugins ?? []).find((item) => item.mentionPath === getSelectedPluginKey(plugin))
      return matched
        ? { id: matched.id, name: matched.name, path: matched.mentionPath, source: matched.source }
        : normalizePluginSelection(plugin)
    })
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
  max-width: min(var(--ui-composer-max, var(--content-shell-max-width, 88rem)), 100%);
}

.thread-composer-shell {
  @apply relative border p-2 sm:p-2.5;
  min-height: var(--ui-composer-min-height);
  border-radius: var(--ui-radius-composer);
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface);
  box-shadow: 0 8px 20px rgb(0 0 0 / 0.045);
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
  @apply inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs;
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface-muted);
  color: var(--ui-text-secondary);
}

.thread-composer-folder-chip-icon {
  @apply h-3.5 w-3.5 shrink-0;
  color: var(--ui-text-secondary);
}

.thread-composer-folder-chip-name {
  @apply truncate max-w-40 font-medium;
}

.thread-composer-folder-chip-meta {
  color: var(--ui-text-tertiary);
}

.thread-composer-folder-chip-remove {
  @apply ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border-0 bg-transparent transition text-xs leading-none p-0;
  color: var(--ui-text-tertiary);
}

.thread-composer-folder-chip-remove:hover {
  background: var(--ui-bg-row-hover);
  color: var(--ui-text-primary);
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
  @apply inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs;
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface-muted);
  color: var(--ui-accent);
}

.thread-composer-skill-chip-name {
  @apply font-medium;
}

.thread-composer-skill-chip-remove {
  @apply ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border-0 bg-transparent text-emerald-500 transition hover:bg-emerald-200 hover:text-emerald-700 text-xs leading-none p-0;
}

.thread-composer-option-chips {
  @apply mb-2 flex flex-wrap gap-1.5;
}

.thread-composer-option-chip {
  @apply inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs;
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface-muted);
  color: var(--ui-text-secondary);
}

.thread-composer-option-chip--goal {
  @apply border-amber-200 bg-amber-50 text-amber-800;
}

.thread-composer-option-chip-dot {
  @apply h-1.5 w-1.5 shrink-0 rounded-full bg-[#0d9488];
}

.thread-composer-option-chip--goal .thread-composer-option-chip-dot {
  @apply bg-amber-500;
}

.thread-composer-option-chip-name {
  @apply min-w-0 truncate font-medium;
  max-width: min(22rem, calc(100vw - 8rem));
}

.thread-composer-option-chip-remove {
  @apply ml-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-[#7a705f] transition hover:bg-[#e6ddcf] hover:text-[#2f281f] text-xs leading-none p-0;
}

.thread-composer-input-wrap {
  @apply relative;
}

.thread-composer-file-mentions {
  @apply absolute left-0 right-0 bottom-[calc(100%+8px)] z-40 max-h-52 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1;
}

.thread-composer-file-mentions--sheet {
  @apply fixed left-3 right-3 bottom-[calc(env(safe-area-inset-bottom)+5.75rem)] z-[70] max-h-[min(40dvh,22rem)] border p-2;
  border-radius: var(--ui-radius-composer);
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface);
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
  @apply w-full min-w-0 min-h-8 max-h-32 rounded-xl border-0 bg-transparent px-1 py-1 text-sm outline-none transition resize-none overflow-y-auto;
  color: var(--ui-text-primary);
  font-family: var(--font-sans-reading);
  font-size: var(--font-size-reading, 15px);
  line-height: 1.55;
  letter-spacing: 0;
}

.thread-composer-input:focus {
  @apply ring-0;
}

.thread-composer-input:disabled {
  @apply bg-zinc-100 text-zinc-500 cursor-not-allowed;
}

.thread-composer-controls {
  @apply relative mt-1.5 flex items-center gap-2 sm:gap-2.5 overflow-visible;
}

.thread-composer-controls--recording {
  @apply gap-1 sm:gap-2;
}

.thread-composer-attach {
  @apply relative shrink-0;
}

.thread-composer-attach-trigger {
  @apply inline-flex h-9 w-9 shrink-0 items-center justify-center border border-transparent bg-transparent text-xl leading-none transition disabled:cursor-not-allowed disabled:text-zinc-400;
  border-radius: var(--ui-radius-control);
  color: var(--ui-text-secondary);
}

.thread-composer-attach-trigger:hover,
.thread-composer-attach-trigger:focus-visible {
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-row-hover);
  color: var(--ui-text-primary);
}

.thread-composer-attach-menu {
  @apply absolute bottom-11 left-0 z-20 w-72 max-w-[calc(100vw_-_1rem)] border p-1.5;
  border-radius: var(--ui-radius-card);
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface);
  box-shadow: var(--ui-shadow-float);
}

.thread-composer-attach-menu--sheet {
  @apply fixed left-3 right-3 bottom-[calc(env(safe-area-inset-bottom)+5.75rem)] z-[70] w-auto max-w-none border p-2;
  border-radius: var(--ui-radius-composer);
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface);
  max-height: min(82dvh, 46rem);
  overflow-y: auto;
  overscroll-behavior: contain;
}

.thread-composer-attach-item {
  @apply flex min-h-11 w-full min-w-0 items-center gap-2.5 border-0 bg-transparent px-2.5 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:text-zinc-400;
  border-radius: var(--ui-radius-control);
  color: var(--ui-text-primary);
  font-family: var(--font-sans-ui);
}

.thread-composer-attach-item:hover,
.thread-composer-attach-item:focus-visible {
  background: var(--ui-bg-row-hover);
}

.thread-composer-attach-item-icon {
  @apply h-5 w-5 shrink-0;
  color: var(--ui-text-secondary);
}

.thread-composer-attach-item-icon--text,
.thread-composer-attach-item-icon--grid {
  @apply inline-flex h-5 w-5 items-center justify-center rounded-md text-sm font-semibold;
  color: var(--ui-text-secondary);
}

.thread-composer-attach-item-body {
  @apply flex min-w-0 flex-1 flex-col;
}

.thread-composer-attach-item-title {
  @apply truncate text-sm font-semibold leading-snug;
  color: var(--ui-text-primary);
}

.thread-composer-attach-item-subtitle {
  @apply truncate text-xs font-normal leading-snug;
  color: var(--ui-text-tertiary);
}

.thread-composer-attach-item--toggle,
.thread-composer-attach-item--submenu {
  @apply pr-2;
}

.thread-composer-switch {
  @apply relative h-6 w-10 shrink-0 rounded-full transition;
  background: var(--ui-bg-row-active);
}

.thread-composer-switch::after {
  content: '';
  @apply absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition;
}

.thread-composer-switch.is-on {
  @apply bg-[#0d9488];
}

.thread-composer-switch.is-on::after {
  transform: translateX(1rem);
}

.thread-composer-goal-editor {
  @apply px-2 pb-1;
}

.thread-composer-goal-input {
  @apply w-full resize-none border px-3 py-2 text-sm leading-relaxed outline-none transition focus:border-[#0d9488] disabled:cursor-not-allowed disabled:opacity-60;
  border-radius: var(--ui-radius-control);
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface-muted);
  color: var(--ui-text-primary);
  font-family: var(--font-sans-reading);
}

.thread-composer-attach-submenu-wrap {
  @apply relative;
}

.thread-composer-attach-chevron {
  @apply h-4 w-4 shrink-0 transition-transform;
  color: var(--ui-text-tertiary);
}

.thread-composer-attach-chevron.is-open {
  transform: rotate(90deg);
}

.thread-composer-plugin-menu {
  @apply absolute bottom-0 left-[calc(100%+0.5rem)] z-[75] w-80 max-w-[calc(100vw_-_2rem)] border p-1.5;
  border-radius: var(--ui-radius-composer);
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface);
  box-shadow: 0 10px 28px rgb(0 0 0 / 0.08);
  max-height: min(32rem, calc(100dvh - 10rem));
  overflow-y: auto;
  overscroll-behavior: contain;
}

.thread-composer-plugin-menu--inline {
  @apply static mt-1 w-full max-w-none shadow-none;
  border-radius: var(--ui-radius-control);
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface-muted);
  max-height: min(42dvh, 22rem);
}

.thread-composer-plugin-menu-header {
  @apply flex items-center justify-between gap-2 px-2 py-1.5 text-xs font-semibold;
  color: var(--ui-text-tertiary);
}

.thread-composer-plugin-menu-action {
  @apply rounded-md border-0 bg-transparent px-2 py-1 text-xs font-semibold text-[#0f766e] transition hover:bg-[#edf7f5] disabled:cursor-not-allowed disabled:opacity-50;
}

.thread-composer-plugin-menu-empty {
  @apply px-2 py-3 text-sm;
  color: var(--ui-text-tertiary);
}

.thread-composer-plugin-row {
  @apply flex min-h-11 w-full min-w-0 items-center gap-2 border-0 bg-transparent px-2 py-2 text-left transition;
  border-radius: var(--ui-radius-control);
}

.thread-composer-plugin-row:hover,
.thread-composer-plugin-row:focus-visible {
  background: var(--ui-bg-row-hover);
}

.thread-composer-plugin-row.is-selected {
  @apply bg-[#edf7f5];
}

.thread-composer-plugin-row.is-disabled {
  @apply cursor-not-allowed opacity-55;
}

.thread-composer-plugin-row:disabled {
  @apply cursor-not-allowed opacity-55;
}

.thread-composer-plugin-avatar {
  @apply inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold;
  background: var(--ui-bg-row-active);
  color: var(--ui-text-secondary);
}

.thread-composer-plugin-row-body {
  @apply flex min-w-0 flex-1 flex-col;
}

.thread-composer-plugin-row-title {
  @apply truncate text-sm font-semibold;
  color: var(--ui-text-primary);
}

.thread-composer-plugin-row-meta {
  @apply truncate text-xs;
  color: var(--ui-text-tertiary);
}

.thread-composer-plugin-check,
.thread-composer-plugin-login {
  @apply shrink-0 rounded-full px-2 py-1 text-xs font-semibold;
}

.thread-composer-plugin-check {
  @apply text-[#0f766e];
}

.thread-composer-plugin-login {
  background: var(--ui-bg-row-active);
  color: var(--ui-text-secondary);
}

.thread-composer-plugin-reload {
  @apply mt-1 flex min-h-10 w-full items-center justify-center border px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50;
  border-radius: var(--ui-radius-control);
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface-muted);
  color: var(--ui-text-secondary);
}

.thread-composer-plugin-reload:hover,
.thread-composer-plugin-reload:focus-visible {
  background: var(--ui-bg-row-hover);
}

.thread-composer-attach-separator {
  @apply my-1 h-px bg-zinc-100;
}

.thread-composer-attach-section {
  @apply flex flex-col gap-2 rounded-lg px-2 py-2;
}

.thread-composer-attach-section-title {
  @apply text-xs font-semibold;
  color: var(--ui-text-tertiary);
}

.thread-composer-attach-mode-toggle {
  @apply grid h-10 grid-cols-2 gap-1 rounded-[16px] border border-[#e4dac9] bg-[#f7f3ea] p-1;
}

.thread-composer-attach-mode-toggle button {
  @apply min-w-0 rounded-[12px] px-3 text-sm font-semibold leading-none text-[#6f6555] transition hover:bg-white/70 disabled:cursor-not-allowed disabled:opacity-50;
}

.thread-composer-attach-mode-toggle button.is-active {
  @apply bg-[#0f766e] text-white shadow-sm;
}

.thread-composer-attach-mode-hint {
  @apply min-w-0 text-xs font-medium leading-relaxed text-[#8a8173];
}

.thread-composer-attach-mode-hint.is-plan {
  @apply text-[#0f766e];
}

.thread-composer-attach-skill-dropdown {
  @apply w-full min-w-0;
}

.thread-composer-attach-skill-dropdown :deep(.search-dropdown-trigger) {
  @apply h-10 w-full justify-between border px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50;
  border-radius: var(--ui-radius-control);
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface-muted);
  color: var(--ui-text-secondary);
}

.thread-composer-attach-skill-dropdown :deep(.search-dropdown-trigger:hover),
.thread-composer-attach-skill-dropdown :deep(.search-dropdown-trigger:focus-visible) {
  background: var(--ui-bg-row-hover);
  color: var(--ui-text-primary);
}

.thread-composer-attach-skill-dropdown :deep(.search-dropdown-value) {
  @apply min-w-0 truncate;
}

.thread-composer-control-strip {
  @apply min-w-0 flex flex-1 items-center overflow-visible;
}

.thread-composer-runtime {
  @apply relative min-w-0;
  width: min(12.5rem, 100%);
}

.thread-composer-runtime-trigger {
  @apply inline-flex h-8 w-full min-w-0 items-center justify-center gap-1 border-0 bg-transparent px-2 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50;
  border-radius: var(--ui-radius-control);
  color: var(--ui-text-secondary);
  font-family: var(--font-sans-ui);
  letter-spacing: 0;
}

.thread-composer-runtime-trigger:hover,
.thread-composer-runtime-trigger:focus-visible {
  background: var(--ui-bg-row-hover);
  color: var(--ui-text-primary);
}

.thread-composer-runtime-trigger:active {
  background: var(--ui-bg-row-active);
}

.thread-composer-runtime-bolt {
  @apply h-4 w-4 shrink-0;
  color: currentColor;
}

.thread-composer-runtime-summary {
  @apply min-w-0 truncate;
}

.thread-composer-runtime-chevron {
  @apply h-3 w-3 shrink-0 transition-transform;
  color: var(--ui-text-tertiary);
}

.thread-composer-runtime-chevron.is-open {
  transform: rotate(180deg);
}

.thread-composer-runtime-panel {
  @apply absolute bottom-[calc(100%+0.5rem)] left-0 z-[70] w-[20rem] max-w-[calc(100vw_-_1.5rem)] border p-2;
  border-radius: var(--ui-radius-composer);
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface);
  box-shadow: var(--ui-shadow-float);
}

.thread-composer-runtime-panel--sheet {
  @apply fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5.75rem)] w-auto max-w-none rounded-[24px] p-3;
}

.thread-composer-runtime-handle {
  @apply mx-auto mb-2 h-1 w-10 rounded-full;
  background: var(--ui-border-strong);
}

.thread-composer-runtime-section {
  @apply py-1.5;
}

.thread-composer-runtime-section + .thread-composer-runtime-section {
  border-top: 1px solid var(--ui-border-subtle);
}

.thread-composer-runtime-section-title {
  @apply px-2 pb-1 text-xs font-semibold;
  color: var(--ui-text-tertiary);
}

.thread-composer-runtime-options {
  @apply grid grid-cols-2 gap-1;
}

.thread-composer-runtime-options--models {
  @apply grid-cols-1;
}

.thread-composer-runtime-option {
  @apply relative flex min-h-9 min-w-0 items-center justify-between gap-2 border-0 bg-transparent px-2.5 py-2 text-left text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50;
  border-radius: var(--ui-radius-control);
  color: var(--ui-text-primary);
  font-family: var(--font-sans-ui);
  letter-spacing: 0;
}

.thread-composer-runtime-option:hover,
.thread-composer-runtime-option:focus-visible {
  background: var(--ui-bg-row-hover);
}

.thread-composer-runtime-option span {
  @apply min-w-0 truncate;
}

.thread-composer-runtime-option small {
  @apply mt-0.5 block text-xs font-normal leading-snug;
  color: var(--ui-text-tertiary);
}

.thread-composer-runtime-option--stacked {
  @apply flex-col items-start justify-center gap-0.5;
}

.thread-composer-runtime-option.is-selected {
  @apply pr-7;
  background: var(--ui-bg-row-active);
  color: var(--ui-accent);
}

.thread-composer-runtime-option.is-selected::after {
  content: '✓';
  @apply absolute right-2 top-1/2 -translate-y-1/2 text-base leading-none text-[#0f766e];
}

.thread-composer-runtime-option--stacked.is-selected {
  @apply pr-7;
}

.thread-composer-mobile-backdrop {
  @apply fixed inset-0 z-[60] border-0 bg-[#1f2937]/24 p-0;
}

.thread-composer-actions {
  @apply ml-auto flex min-w-0 items-center gap-2;
}

.thread-composer-actions--recording {
  @apply ml-0 flex-1;
}

.thread-composer-mic {
  @apply inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition disabled:cursor-not-allowed disabled:text-zinc-400;
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-surface-muted);
  color: var(--ui-text-secondary);
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}

.thread-composer-mic:hover,
.thread-composer-mic:focus-visible {
  background: var(--ui-bg-row-hover);
  color: var(--ui-text-primary);
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
  @apply mb-2 px-1 text-xs;
  color: var(--ui-text-secondary);
}

.thread-composer-submit {
  @apply inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-0 bg-[#1f1f1f] text-white transition hover:bg-black disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500;
  box-shadow: 0 12px 24px -22px rgba(0, 0, 0, 0.55);
}

.thread-composer-submit--queue {
  @apply bg-[#ea580c] hover:bg-[#c2410c];
}

@media (min-width: 1024px) {
  .thread-composer {
    @apply px-5;
  }

  .thread-composer-shell {
    @apply px-3 py-1.5;
    border-radius: var(--ui-radius-composer);
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
    @apply px-2.5 py-1.5;
    min-height: 86px;
    border-radius: 18px;
    box-shadow: 0 6px 16px rgb(0 0 0 / 0.045);
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
    @apply w-full min-w-0 overflow-visible pr-0;
    display: flex;
    justify-content: flex-start;
  }

  .thread-composer-runtime {
    width: min(11.25rem, 100%);
  }

  .thread-composer-runtime-trigger {
    @apply h-9 gap-1 border px-2 text-[13px];
    border-radius: var(--ui-radius-control);
    border-color: var(--ui-border-subtle);
    background: var(--ui-bg-surface-muted);
  }

  .thread-composer-actions {
    @apply ml-0 min-w-0 shrink-0 w-auto justify-end gap-1;
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

  .thread-composer-runtime-options--models {
    max-height: 14rem;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: none;
  }

  .thread-composer-runtime-options--models::-webkit-scrollbar {
    display: none;
  }
}
</style>
