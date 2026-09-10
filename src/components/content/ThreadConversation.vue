<template>
  <section class="transcript-root" :class="{ 'is-switching': props.isThreadSwitching === true }">
    <div v-if="showLoading" class="transcript-loading" role="status" aria-live="polite">
      <LoadingInline :label="props.isThreadSwitching ? '正在切换会话' : '正在读取会话'" tone="muted" compact />
    </div>

    <div v-if="props.loadError" class="transcript-alert transcript-alert--danger" role="alert">
      <div>
        <strong>会话内容未完整加载</strong>
        <p>{{ props.loadError }}</p>
      </div>
      <div class="transcript-alert-actions">
        <button type="button" class="quiet-button quiet-button--primary" @click="emit('retryLoad')">重新连接</button>
        <button
          v-if="props.showConnectionSettingsAction === true"
          type="button"
          class="quiet-button"
          @click="emit('openConnectionSettings')"
        >
          修改地址
        </button>
      </div>
    </div>

    <div v-if="showEmpty" class="transcript-empty">
      <p>当前会话还没有内容。</p>
      <div v-if="props.showEmptyThreadActions === true" class="transcript-empty-actions">
        <button type="button" class="quiet-button quiet-button--primary" @click="emit('returnToNewThread')">返回新会话</button>
        <button type="button" class="quiet-button" @click="emit('dismissEmptyThread')">移除此空会话</button>
      </div>
    </div>

    <ol
      v-else
      ref="conversationListRef"
      class="transcript-list"
      :data-thread-id="props.activeThreadId"
      :data-turn-count="props.projection.turns.length"
      :data-message-count="projectionItemCount"
      :data-history-start-index="props.projection.history.startIndex"
      :data-history-original-turn-count="props.projection.history.originalTurnCount"
      :data-history-source="props.projection.sourceState"
      :data-mounted-turn-count="virtualizedTurns.length"
      :data-virtualized="shouldVirtualizeTurns ? 'true' : 'false'"
      tabindex="0"
      aria-label="会话记录"
      @scroll.passive="onConversationScroll"
    >
      <li v-if="props.projection.history.hasOlder" class="history-row">
        <button type="button" class="history-button" :disabled="props.isLoading" @click="requestOlderHistory">
          {{ props.isLoading ? '正在加载…' : '加载较早会话' }}
        </button>
      </li>

      <li
        v-if="virtualTopSpacerHeight > 0"
        class="virtual-turn-spacer"
        :style="{ height: `${String(virtualTopSpacerHeight)}px` }"
        aria-hidden="true"
      />

      <li
        v-for="turn in virtualizedTurns"
        :key="turn.id"
        :ref="(element) => setTurnMeasureRef(turn.id, element)"
        class="turn-shell"
        :class="[`turn-shell--${turn.state}`, { 'is-active': isActiveTurn(turn) }]"
        :data-turn-id="turn.id"
        :data-turn-index="turn.index"
        :data-activity-count="turn.activities.length"
      >
        <article
          v-if="turn.opener"
          class="user-message"
          :class="{ 'is-failed': turn.opener.deliveryState === 'failed' }"
          :data-message-id="turn.opener.id"
          data-chat-feedback-kind="user"
          :data-chat-feedback-thread-id="props.activeThreadId"
          :data-chat-feedback-turn-id="turn.id"
          :data-chat-feedback-item-id="turn.opener.id"
          :data-chat-feedback-client-message-id="turn.opener.clientMessageId || undefined"
          :data-chat-feedback-optimistic-message-id="turn.opener.deliveryState ? turn.opener.id : undefined"
        >
          <div v-if="turn.opener.text" class="message-markdown message-markdown--user" v-html="renderMarkdown(turn.opener.text)" />
          <div v-if="turn.opener.images.length > 0" class="user-images">
            <UserAttachmentImage
              v-for="imageUrl in turn.opener.images"
              :key="imageUrl"
              :url="imageUrl"
            />
          </div>
          <div v-if="turn.opener.mentions.length > 0" class="attachment-list">
            <span v-for="mention in turn.opener.mentions" :key="`${mention.path}:${mention.name}`" class="attachment-chip">
              {{ mention.name || mention.path }}
            </span>
          </div>
          <div class="message-actions message-actions--user">
            <span v-if="turn.opener.deliveryState" class="delivery-state" :data-state="turn.opener.deliveryState" role="status" aria-live="polite">
              {{ deliveryStateLabel(turn.opener.deliveryState, turn) }}
            </span>
            <button v-if="turn.opener.text" type="button" class="message-action" @click="copyBlock(turn.opener.text)">复制</button>
            <button
              v-if="canFavorite(turn.opener)"
              type="button"
              class="message-action"
              :aria-pressed="isFavorite(turn.opener.id)"
              @click="toggleFavorite(turn.opener, turn)"
            >
              {{ isFavorite(turn.opener.id) ? '取消收藏' : '收藏' }}
            </button>
            <button
              v-if="turn.opener.deliveryState === 'failed' && props.allowFailedMessageEdit === true"
              type="button"
              class="message-action"
              @click="emit('editFailedMessage', turn.opener.id)"
            >
              编辑
            </button>
            <button
              v-if="turn.opener.deliveryState === 'failed'"
              type="button"
              class="message-action"
              @click="emit('retryFailedMessage', turn.opener.id)"
            >
              重试
            </button>
            <button
              v-if="canRollback(turn)"
              type="button"
              class="message-action"
              :class="{ 'is-confirming': confirmingRollbackTurnIndex === turn.index }"
              @click="requestRollback(turn)"
            >
              {{ confirmingRollbackTurnIndex === turn.index ? '确认回退' : '回退到此轮' }}
            </button>
          </div>
        </article>

        <section class="assistant-turn" :aria-label="`Codex 第 ${String(turn.index + 1)} 轮`">
          <div v-if="turn.state !== 'submitting'" class="turn-divider" :data-state="turn.state">
            <button
              v-if="hasProcessContent(turn)"
              type="button"
              class="process-toggle turn-timing"
              :data-status="turn.timingStatus"
              :aria-expanded="isProcessExpanded(turn)"
              :disabled="isActiveTurn(turn)"
              @click="toggleProcess(turn)"
            >
              <span>{{ timingLabel(turn) }}</span>
              <span v-if="turn.waitedMs > 0" class="turn-wait-time">等待你 {{ formatDuration(turn.waitedMs) }}</span>
              <span
                class="process-toggle-icon"
                :class="{ 'is-expanded': isProcessExpanded(turn) }"
                aria-hidden="true"
              >›</span>
            </button>
            <div
              v-else-if="hasVisibleTiming(turn)"
              class="turn-timing turn-timing--static"
              :data-status="turn.timingStatus"
            >
              <span>{{ timingLabel(turn) }}</span>
              <span v-if="turn.waitedMs > 0" class="turn-wait-time">等待你 {{ formatDuration(turn.waitedMs) }}</span>
            </div>
            <span class="turn-divider-line" aria-hidden="true" />
          </div>

          <section v-if="hasProcessContent(turn)" class="turn-process">
            <Transition name="process-reveal">
              <div
                v-if="isProcessExpanded(turn)"
                class="process-content"
                :class="{
                  'has-history': processHistoryCount(turn) > 0,
                  'is-history-expanded': isProcessHistoryExpanded(turn),
                }"
                :data-visible-process-count="visibleProcessBlockCount(turn)"
              >
              <button
                v-if="isProcessHistoryExpanded(turn) && hiddenOlderProcessCount(turn) > 0"
                type="button"
                class="process-history-action process-history-action--older"
                @click="showMoreProcessHistory(turn)"
              >
                再看更早过程（{{ String(Math.min(hiddenOlderProcessCount(turn), PROCESS_HISTORY_BATCH_SIZE)) }}）
              </button>
              <template v-for="entry in visibleProcessEntries(turn)" :key="entry.id">
                <article
                  v-if="entry.kind === 'commentary'"
                  class="commentary-block"
                  :data-message-id="entry.block.id"
                >
                  <span class="process-rail-dot" aria-hidden="true" />
                  <div
                    class="commentary-copy message-markdown"
                    :data-chat-feedback-kind="entry.block.text ? 'assistant' : undefined"
                    :data-chat-feedback-thread-id="props.activeThreadId"
                    :data-chat-feedback-turn-id="turn.id"
                    :data-chat-feedback-item-id="entry.block.id"
                    v-html="renderMarkdown(entry.block.text)"
                  />
                  <button v-if="entry.block.text" type="button" class="inline-copy" @click="copyBlock(entry.block.text)">复制</button>
                </article>

                <section
                  v-else
                  class="activity-group"
                  :data-activity-group-id="entry.group.id"
                  :aria-label="entry.group.label"
                >
                  <article
                    v-for="activity in entry.activities"
                    :key="activity.id"
                    class="activity-block"
                    :class="`activity-block--${activity.status}`"
                    :data-activity-id="activity.id"
                    v-memo="[activityRenderSignature(activity)]"
                  >
                    <span class="process-rail-dot" aria-hidden="true" />
                    <div class="activity-main">
                      <div class="activity-heading">
                        <strong>{{ activity.label }}</strong>
                        <span>{{ activityStatusLabel(activity.status) }}</span>
                        <span v-if="activity.durationMs !== null">{{ formatDuration(activity.durationMs) }}</span>
                      </div>

                      <template v-if="activity.activityType === 'command'">
                        <code v-if="activity.command" class="activity-command">{{ activity.command }}</code>
                        <details v-if="activity.output" class="activity-details">
                          <summary>查看命令输出</summary>
                          <pre>{{ activity.output }}</pre>
                        </details>
                      </template>

                      <template v-else-if="activity.activityType === 'mcp'">
                        <p v-if="activity.server || activity.tool" class="activity-subtitle">{{ [activity.server, activity.tool].filter(Boolean).join(' · ') }}</p>
                        <ul v-if="activity.progress.length > 0" class="activity-progress">
                          <li v-for="progress in activity.progress" :key="progress">{{ progress }}</li>
                        </ul>
                        <p v-if="activity.error" class="activity-error">{{ activity.error }}</p>
                      </template>

                      <template v-else-if="activity.activityType === 'web-search'">
                        <p v-if="activity.query" class="activity-subtitle">{{ activity.query }}</p>
                      </template>

                      <template v-else-if="activity.activityType === 'plan'">
                        <p v-if="activity.explanation" class="activity-subtitle">{{ activity.explanation }}</p>
                        <ol v-if="activity.steps.length > 0" class="plan-steps">
                          <li v-for="(step, stepIndex) in activity.steps" :key="`${activity.id}:${String(stepIndex)}`" :data-status="step.status">
                            <span aria-hidden="true">{{ planStepMark(step.status) }}</span>
                            <span>{{ step.step }}</span>
                          </li>
                        </ol>
                      </template>

                      <p v-else-if="activityTarget(activity)" class="activity-subtitle">{{ activityTarget(activity) }}</p>
                    </div>
                  </article>
                </section>
              </template>

              <div v-if="processHistoryCount(turn) > 0" class="process-history-controls">
                <button
                  type="button"
                  class="process-history-action"
                  :aria-expanded="isProcessHistoryExpanded(turn)"
                  @click="toggleProcessHistory(turn)"
                >
                  {{ isProcessHistoryExpanded(turn) ? '收起历史过程' : `查看历史过程（${String(processHistoryCount(turn))}）` }}
                </button>
              </div>

              <div v-if="turn.interactions.some((interaction) => interaction.status !== 'pending')" class="resolved-interactions">
                <span
                  v-for="interaction in turn.interactions.filter((entry) => entry.status !== 'pending')"
                  :key="interaction.id"
                  class="resolved-interaction"
                >
                  {{ interaction.label }} · {{ interaction.status === 'resolved' ? '已处理' : '已失效' }}
                </span>
              </div>
              </div>
            </Transition>
          </section>

          <details
            v-for="plan in proposedPlans(turn)"
            :key="plan.id"
            class="plan-proposal"
            :data-plan-id="plan.id"
            :open="isActiveTurn(turn) || canImplementPlan(plan, turn) || props.implementingPlanId === plan.id"
          >
            <summary>
              <strong>{{ plan.status === 'in-progress' ? '正在制定计划' : '实施计划' }}</strong>
              <span>{{ isPlanImplemented(plan.id, turn.id) ? '已提交执行' : plan.status === 'completed' ? canImplementPlan(plan, turn) ? '待确认' : '历史方案' : activityStatusLabel(plan.status) }}</span>
            </summary>
            <div class="plan-proposal-body">
              <div class="message-markdown" v-html="renderMarkdown(plan.text)" />
              <button
                v-if="canImplementPlan(plan, turn) || isPlanImplemented(plan.id, turn.id) || props.implementingPlanId === plan.id"
                type="button"
                class="quiet-button quiet-button--primary plan-action"
                :disabled="props.isTurnInProgress === true || Boolean(props.implementingPlanId) || isPlanImplemented(plan.id, turn.id)"
                @click="emit('implementPlan', planImplementationIntent(plan, turn))"
              >
                {{ props.implementingPlanId === plan.id ? '正在提交…' : isPlanImplemented(plan.id, turn.id) ? '已提交执行' : '执行此计划' }}
              </button>
            </div>
          </details>

          <details v-if="turn.fileChanges.length > 0" class="file-summary">
            <summary>
              <span class="file-summary-icon" aria-hidden="true">±</span>
              <span class="file-summary-title">文件变更</span>
              <span class="file-summary-meta">{{ fileSummaryLabel(turn) }}</span>
              <span class="file-summary-chevron" aria-hidden="true">›</span>
            </summary>
            <div class="file-list">
              <details v-for="file in turn.fileChanges" :key="file.path" class="file-row">
                <summary>
                  <span class="file-kind" :data-kind="file.kind">{{ fileKindLabel(file.kind) }}</span>
                  <code :title="file.path">{{ file.path }}</code>
                  <span class="file-stats"><b>+{{ file.additions }}</b> <i>-{{ file.removals }}</i></span>
                </summary>
                <pre v-if="file.diff">{{ file.diff }}</pre>
              </details>
            </div>
          </details>

          <div v-if="pendingInteractionsForTurn(turn).length > 0" class="request-stack" aria-live="polite">
            <article
              v-for="interaction in pendingInteractionsForTurn(turn)"
              :key="interaction.id"
              class="request-card"
              :data-interaction-type="interaction.interactionType"
            >
              <div class="request-card-heading">
                <span class="request-dot" aria-hidden="true" />
                <div>
                  <strong>{{ interaction.title }}</strong>
                  <p>{{ interaction.detail }}</p>
                </div>
              </div>

              <dl v-if="interaction.context.length > 0" class="request-context">
                <div v-for="entry in interaction.context" :key="`${entry.label}:${entry.value}`" class="request-context-row">
                  <dt>{{ entry.label }}</dt>
                  <dd>{{ entry.value }}</dd>
                </div>
              </dl>

              <template v-if="interaction.interactionType === 'user-input'">
                <label v-for="question in interaction.questions" :key="question.id" class="request-field">
                  <span>{{ question.header || question.question || '请选择' }}</span>
                  <select
                    v-if="question.options.length > 0"
                    :value="requestAnswers[answerKey(interaction.id, question.id)] ?? ''"
                    @change="onRequestAnswerChange(interaction.id, question.id, $event)"
                  >
                    <option value="" disabled>请选择</option>
                    <option v-for="option in question.options" :key="option" :value="option">{{ option }}</option>
                  </select>
                  <input v-if="question.isOther || question.options.length === 0" v-model="requestOtherAnswers[answerKey(interaction.id, question.id)]" type="text" placeholder="补充说明" />
                </label>
                <div class="request-actions">
                  <button type="button" class="quiet-button quiet-button--primary" data-request-action="submit-user-input" :disabled="isInteractionResponding(interaction) || !canSubmitToolInput(interaction)" @click="submitToolInput(interaction)">提交并继续</button>
                  <button type="button" class="quiet-button" :disabled="isInteractionResponding(interaction)" @click="rejectInteraction(interaction)">取消</button>
                </div>
              </template>

              <template v-else-if="interaction.interactionType === 'approval'">
                <div class="request-actions">
                  <button type="button" class="quiet-button quiet-button--primary" :disabled="isInteractionResponding(interaction)" @click="respondApproval(interaction, 'accept')">允许一次</button>
                  <button v-if="interaction.allowForSession" type="button" class="quiet-button" :disabled="isInteractionResponding(interaction)" @click="respondApproval(interaction, 'acceptForSession')">本次会话允许</button>
                  <button type="button" class="quiet-button quiet-button--danger" :disabled="isInteractionResponding(interaction)" @click="respondApproval(interaction, 'decline')">拒绝</button>
                </div>
              </template>

              <template v-else-if="interaction.interactionType === 'mcp-approval' || interaction.interactionType === 'mcp-input'">
                <label v-if="interaction.interactionType === 'mcp-input' && !interaction.authorizationUrl" class="request-field">
                  <span>回复内容</span>
                  <textarea v-model="mcpAnswers[interaction.id]" rows="3" placeholder="输入后继续任务" />
                </label>
                <a v-if="interaction.authorizationUrl" class="request-link" :href="interaction.authorizationUrl" target="_blank" rel="noopener noreferrer">打开授权页面</a>
                <div class="request-actions">
                  <button type="button" class="quiet-button quiet-button--primary" :disabled="isInteractionResponding(interaction)" @click="respondMcp(interaction, 'accept')">{{ mcpPrimaryActionLabel(interaction) }}</button>
                  <button
                    v-if="interaction.interactionType === 'mcp-approval' && interaction.mcpPersistenceScopes.includes('session')"
                    type="button"
                    class="quiet-button"
                    data-persistence-scope="session"
                    :disabled="isInteractionResponding(interaction)"
                    @click="respondMcp(interaction, 'accept', 'session')"
                  >本次会话允许</button>
                  <button
                    v-if="interaction.interactionType === 'mcp-approval' && interaction.mcpPersistenceScopes.includes('always')"
                    type="button"
                    class="quiet-button"
                    data-persistence-scope="always"
                    :disabled="isInteractionResponding(interaction)"
                    @click="respondMcp(interaction, 'accept', 'always')"
                  >始终允许</button>
                  <button type="button" class="quiet-button quiet-button--danger" :disabled="isInteractionResponding(interaction)" @click="respondMcp(interaction, 'decline')">拒绝</button>
                </div>
              </template>

              <template v-else-if="interaction.interactionType === 'unsupported-tool'">
                <div class="request-actions">
                  <button type="button" class="quiet-button quiet-button--primary" :disabled="isInteractionResponding(interaction)" @click="reportUnsupportedTool(interaction)">改用文字方式继续</button>
                </div>
              </template>

              <div v-else class="request-actions">
                <button type="button" class="quiet-button" :disabled="isInteractionResponding(interaction)" @click="respondEmpty(interaction)">继续</button>
                <button type="button" class="quiet-button quiet-button--danger" :disabled="isInteractionResponding(interaction)" @click="rejectInteraction(interaction)">拒绝请求</button>
              </div>
            </article>
          </div>

          <div
            v-if="turn.finalStatus === 'pending' && (turn.state === 'running' || turn.state === 'sync-degraded')"
            class="turn-live-state"
            :data-state="turn.state"
            :data-chat-feedback-kind="turn.state === 'running' ? 'running' : undefined"
            :data-chat-feedback-thread-id="props.activeThreadId"
            :data-chat-feedback-turn-id="turn.id"
            role="status"
            aria-live="polite"
          >
            <span class="turn-live-dot" aria-hidden="true" />
            <span>{{ turn.state === 'sync-degraded' ? '正在恢复实时状态' : '正在思考' }}</span>
          </div>

          <article
            v-if="turn.final"
            class="final-answer"
            :class="{ 'is-streaming': turn.final.streaming }"
            :data-message-id="turn.final.id"
            aria-live="polite"
          >
            <div
              class="message-markdown message-markdown--final"
              :data-chat-feedback-kind="turn.final.text ? 'assistant' : undefined"
              :data-chat-feedback-thread-id="props.activeThreadId"
              :data-chat-feedback-turn-id="turn.id"
              :data-chat-feedback-item-id="turn.final.id"
              v-html="renderMarkdown(turn.final.text)"
            />
            <div class="message-actions">
              <button type="button" class="message-action" @click="copyBlock(turn.final.text)">复制</button>
              <button
                type="button"
                class="message-action"
                :aria-pressed="isFavorite(turn.final.id)"
                @click="toggleFavorite(turn.final, turn)"
              >
                {{ isFavorite(turn.final.id) ? '取消收藏' : '收藏' }}
              </button>
            </div>
          </article>

          <div
            v-else-if="turn.finalStatus !== 'pending' && turn.finalStatus !== 'missing'"
            class="final-status"
            :data-status="turn.finalStatus"
            role="status"
          >
            <strong>{{ finalStatusTitle(turn) }}</strong>
            <p>{{ finalStatusDetail(turn) }}</p>
          </div>

          <div
            v-for="notice in turn.blocks.filter((block) => block.kind === 'notice')"
            :key="notice.id"
            class="turn-notice"
            :data-tone="notice.kind === 'notice' ? notice.tone : 'neutral'"
          >
            {{ notice.kind === 'notice' ? notice.text : '' }}
          </div>
        </section>
      </li>

      <li
        v-if="virtualBottomSpacerHeight > 0"
        class="virtual-turn-spacer"
        :style="{ height: `${String(virtualBottomSpacerHeight)}px` }"
        aria-hidden="true"
      />

      <li ref="bottomAnchorRef" class="bottom-anchor" aria-hidden="true" />
    </ol>
    <button
      v-if="isAwayFromBottom"
      type="button"
      class="conversation-jump-to-latest"
      aria-label="返回最新输出"
      @click="returnToLatest"
    >
      <span v-if="latestTurnIsActive" class="run-dots" aria-hidden="true"><i /><i /><i /></span>
      <span v-else aria-hidden="true">↓</span>
      <span class="conversation-jump-to-latest-label">返回最新输出</span>
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type ComponentPublicInstance } from 'vue'
import DOMPurify from 'dompurify'
import MarkdownIt from 'markdown-it'
import LoadingInline from './LoadingInline.vue'
import UserAttachmentImage from './UserAttachmentImage.vue'
import { useChatFeedbackDomMetrics } from '../../composables/useChatFeedbackDomMetrics'
import { copyTextToClipboard } from '../../utils/clipboard'
import { derivePlanImplementationState, planImplementationKey } from '../../conversation-transcript'
import type {
  ConversationActivity,
  ConversationActivityGroup,
  ConversationAssistantBlock,
  ConversationFavoriteIntent,
  ConversationInteractionBlock,
  ConversationPlanActivity,
  ConversationPlanImplementationIntent,
  ConversationProjection,
  ConversationTurn,
  ConversationUserBlock,
} from '../../conversation-transcript'
import type { ThreadScrollState } from '../../types/codex'

export type ThreadConversationExposed = {
  focusMessage: (messageId: string) => Promise<boolean>
}

const props = defineProps<{
  projection: ConversationProjection
  isLoading: boolean
  activeThreadId: string
  cwd: string
  scrollState: ThreadScrollState | null
  isTurnInProgress?: boolean
  isRollingBack?: boolean
  showEmptyThreadActions?: boolean
  isThreadSwitching?: boolean
  compactRuntimeChrome?: boolean
  loadError?: string
  showConnectionSettingsAction?: boolean
  favoriteMessageIds?: string[]
  allowFailedMessageEdit?: boolean
  implementingPlanId?: string
  implementedPlanIds?: string[]
}>()

const emit = defineEmits<{
  updateScrollState: [payload: { threadId: string; state: ThreadScrollState }]
  respondServerRequest: [payload: { id: number; result?: unknown; error?: { code?: number; message: string } }]
  rollback: [payload: { turnIndex: number; prependText?: string }]
  toggleFavorite: [intent: ConversationFavoriteIntent]
  loadOlderHistory: []
  returnToNewThread: []
  dismissEmptyThread: []
  retryLoad: []
  openConnectionSettings: []
  retryFailedMessage: [messageId: string]
  editFailedMessage: [messageId: string]
  copyStatus: [payload: { message: string; tone: 'success' | 'info' | 'warning' | 'danger' }]
  implementPlan: [intent: ConversationPlanImplementationIntent]
}>()

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true })
const PROCESS_HISTORY_BATCH_SIZE = 17
const VIRTUALIZE_MIN_TURNS = 24
const MAX_MOUNTED_TURNS = 10
const ESTIMATED_TURN_HEIGHT_PX = 280
const TURN_GAP_PX = 34
const VIRTUAL_TURN_OVERSCAN_PX = 560
const defaultLinkOpen = markdown.renderer.rules.link_open ?? ((tokens, index, options, _env, renderer) => renderer.renderToken(tokens, index, options))
markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  tokens[index]?.attrSet('target', '_blank')
  tokens[index]?.attrSet('rel', 'noopener noreferrer')
  return defaultLinkOpen(tokens, index, options, env, renderer)
}

const conversationListRef = ref<HTMLElement | null>(null)
useChatFeedbackDomMetrics({ root: conversationListRef, threadId: () => props.activeThreadId })
const bottomAnchorRef = ref<HTMLElement | null>(null)
const manuallyExpandedTurnIds = ref<Set<string>>(new Set())
const visibleProcessHistoryCountByTurnId = ref<Record<string, number>>({})
const confirmingRollbackTurnIndex = ref<number | null>(null)
const highlightedMessageId = ref('')
const requestAnswers = ref<Record<string, string>>({})
const requestOtherAnswers = ref<Record<string, string>>({})
const mcpAnswers = ref<Record<string, string>>({})
const respondingRequestIds = ref<Set<number>>(new Set())
const isAwayFromBottom = ref(false)
const conversationViewportHeight = ref(0)
const conversationScrollTop = ref(0)
const measuredTurnHeightById = ref<Record<string, number>>({})
const pinnedTurnId = ref('')
const observedTurnElementsById = new Map<string, HTMLElement>()
let scrollFrame = 0
let heightRestoreFrame = 0
let rollbackTimer = 0
let highlightTimer = 0
let userIsAwayFromBottom = false
let pendingOlderHistoryAnchor: { turnId: string; top: number } | null = null

const favoriteIds = computed(() => new Set(props.favoriteMessageIds ?? []))
const projectionItemCount = computed(() => props.projection.turns.reduce((total, turn) => total + turn.blocks.length, 0))
const latestTurnIsActive = computed(() => {
  const latestTurn = props.projection.turns.at(-1)
  return latestTurn ? isActiveTurn(latestTurn) : false
})
const showLoading = computed(() => props.isLoading && props.projection.turns.length === 0)
const showEmpty = computed(() => (
  !props.isLoading &&
  props.projection.turns.length === 0 &&
  !props.loadError
))
const shouldVirtualizeTurns = computed(() => props.projection.turns.length >= VIRTUALIZE_MIN_TURNS)

type MeasureRefTarget = Element | ComponentPublicInstance | null
type VisibleTurnAnchor = { turnId: string; top: number }

function lowerBoundNumber(values: number[], target: number): number {
  let low = 0
  let high = values.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if ((values[middle] ?? 0) < target) low = middle + 1
    else high = middle
  }
  return low
}

const turnHeightMetrics = computed(() => {
  const cumulativeHeights: number[] = [0]
  for (const turn of props.projection.turns) {
    const height = measuredTurnHeightById.value[turn.id] ?? ESTIMATED_TURN_HEIGHT_PX
    cumulativeHeights.push((cumulativeHeights.at(-1) ?? 0) + height + TURN_GAP_PX)
  }
  return {
    cumulativeHeights,
    totalHeight: cumulativeHeights.at(-1) ?? 0,
  }
})

function boundedTurnRangeAround(index: number, turnCount: number): { startIndex: number; endIndex: number } {
  const rangeSize = Math.min(MAX_MOUNTED_TURNS, turnCount)
  const startIndex = Math.min(
    Math.max(index - Math.floor(rangeSize / 2), 0),
    Math.max(turnCount - rangeSize, 0),
  )
  return { startIndex, endIndex: startIndex + rangeSize }
}

const virtualizedTurnRange = computed(() => {
  const turnCount = props.projection.turns.length
  if (!shouldVirtualizeTurns.value || turnCount === 0) {
    return { startIndex: 0, endIndex: turnCount }
  }

  if (pinnedTurnId.value) {
    const pinnedIndex = props.projection.turns.findIndex((turn) => turn.id === pinnedTurnId.value)
    if (pinnedIndex >= 0) return boundedTurnRangeAround(pinnedIndex, turnCount)
  }

  const { cumulativeHeights } = turnHeightMetrics.value
  const viewportHeight = Math.max(conversationViewportHeight.value, 1)
  const scrollTop = Math.max(conversationScrollTop.value, 0)
  const visibleStart = Math.max(scrollTop - VIRTUAL_TURN_OVERSCAN_PX, 0)
  const visibleEnd = scrollTop + viewportHeight + VIRTUAL_TURN_OVERSCAN_PX
  let startIndex = Math.max(lowerBoundNumber(cumulativeHeights, visibleStart) - 1, 0)
  let endIndex = Math.min(turnCount, Math.max(lowerBoundNumber(cumulativeHeights, visibleEnd) + 1, startIndex + 1))

  if (endIndex - startIndex > MAX_MOUNTED_TURNS) {
    const midpoint = scrollTop + viewportHeight / 2
    const midpointIndex = Math.min(Math.max(lowerBoundNumber(cumulativeHeights, midpoint) - 1, 0), turnCount - 1)
    return boundedTurnRangeAround(midpointIndex, turnCount)
  }

  const remainingCapacity = MAX_MOUNTED_TURNS - (endIndex - startIndex)
  const before = Math.min(Math.ceil(remainingCapacity / 2), startIndex)
  startIndex -= before
  endIndex = Math.min(turnCount, endIndex + remainingCapacity - before)
  if (endIndex - startIndex < MAX_MOUNTED_TURNS) {
    startIndex = Math.max(0, endIndex - MAX_MOUNTED_TURNS)
  }
  return { startIndex, endIndex }
})
const virtualizedTurns = computed(() => {
  const { startIndex, endIndex } = virtualizedTurnRange.value
  return props.projection.turns.slice(startIndex, endIndex)
})
const virtualTopSpacerHeight = computed(() => {
  if (!shouldVirtualizeTurns.value) return 0
  return turnHeightMetrics.value.cumulativeHeights[virtualizedTurnRange.value.startIndex] ?? 0
})
const virtualBottomSpacerHeight = computed(() => {
  if (!shouldVirtualizeTurns.value) return 0
  const renderedEnd = turnHeightMetrics.value.cumulativeHeights[virtualizedTurnRange.value.endIndex]
    ?? turnHeightMetrics.value.totalHeight
  return Math.max(turnHeightMetrics.value.totalHeight - renderedEnd, 0)
})

function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(markdown.render(text), {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel'],
  })
}

function isActiveTurn(turn: ConversationTurn): boolean {
  return turn.state === 'submitting'
    || turn.state === 'queued'
    || turn.state === 'running'
    || turn.state === 'waiting'
    || turn.state === 'sync-degraded'
}

function hasProcessContent(turn: ConversationTurn): boolean {
  return turn.commentary.length > 0
    || turn.activities.some((activity) => activity.activityType !== 'plan' || !activity.text.trim())
    || turn.interactions.some((entry) => entry.status !== 'pending')
}

function hasVisibleTiming(turn: ConversationTurn): boolean {
  return isActiveTurn(turn) || turn.activeElapsedMs !== null || turn.waitedMs > 0
}

function isProcessExpanded(turn: ConversationTurn): boolean {
  return isActiveTurn(turn) || manuallyExpandedTurnIds.value.has(turn.id)
}

function toggleProcess(turn: ConversationTurn): void {
  if (isActiveTurn(turn)) return
  const next = new Set(manuallyExpandedTurnIds.value)
  if (next.has(turn.id)) {
    next.delete(turn.id)
    hideProcessHistory(turn)
  } else {
    next.add(turn.id)
  }
  manuallyExpandedTurnIds.value = next
}

type ProcessBlock = ConversationAssistantBlock | ConversationActivity

function processBlocks(turn: ConversationTurn): ProcessBlock[] {
  return turn.blocks.filter((block): block is ProcessBlock => (
    (block.kind === 'activity' && (block.activityType !== 'plan' || !block.text.trim()))
    || (block.kind === 'assistant' && block.phase === 'commentary')
  ))
}

function processHistoryCount(turn: ConversationTurn): number {
  return Math.max(0, processBlocks(turn).length - 1)
}

function visibleProcessHistoryCount(turn: ConversationTurn): number {
  return Math.min(
    processHistoryCount(turn),
    Math.max(0, visibleProcessHistoryCountByTurnId.value[turn.id] ?? 0),
  )
}

function isProcessHistoryExpanded(turn: ConversationTurn): boolean {
  return visibleProcessHistoryCount(turn) > 0
}

function visibleProcessBlockCount(turn: ConversationTurn): number {
  return Math.min(processBlocks(turn).length, visibleProcessHistoryCount(turn) + 1)
}

function hiddenOlderProcessCount(turn: ConversationTurn): number {
  return Math.max(0, processHistoryCount(turn) - visibleProcessHistoryCount(turn))
}

function showMoreProcessHistory(turn: ConversationTurn): void {
  const next = { ...visibleProcessHistoryCountByTurnId.value }
  next[turn.id] = Math.min(
    processHistoryCount(turn),
    visibleProcessHistoryCount(turn) + PROCESS_HISTORY_BATCH_SIZE,
  )
  visibleProcessHistoryCountByTurnId.value = next
}

function hideProcessHistory(turn: ConversationTurn): void {
  const next = { ...visibleProcessHistoryCountByTurnId.value }
  delete next[turn.id]
  visibleProcessHistoryCountByTurnId.value = next
}

function toggleProcessHistory(turn: ConversationTurn): void {
  if (isProcessHistoryExpanded(turn)) hideProcessHistory(turn)
  else showMoreProcessHistory(turn)
}

type VisibleProcessEntry =
  | { kind: 'commentary'; id: string; block: ConversationAssistantBlock }
  | { kind: 'activity-group'; id: string; group: ConversationActivityGroup; activities: ConversationActivity[] }

function visibleProcessEntries(turn: ConversationTurn): VisibleProcessEntry[] {
  const visibleBlocks = processBlocks(turn).slice(-visibleProcessBlockCount(turn))
  const visibleActivityIds = new Set(
    visibleBlocks
      .filter((block): block is ConversationActivity => block.kind === 'activity')
      .map((activity) => activity.id),
  )
  const activitiesById = new Map(turn.activities.map((activity) => [activity.id, activity]))
  const groupsByActivityId = new Map<string, ConversationActivityGroup>()
  for (const group of turn.activityGroups) {
    for (const activityId of group.activityIds) groupsByActivityId.set(activityId, group)
  }

  const entries: VisibleProcessEntry[] = []
  const renderedGroupIds = new Set<string>()
  for (const block of visibleBlocks) {
    if (block.kind === 'assistant' && block.phase === 'commentary') {
      entries.push({ kind: 'commentary', id: block.id, block })
      continue
    }
    if (block.kind !== 'activity' || !visibleActivityIds.has(block.id)) continue
    const group = groupsByActivityId.get(block.id)
    if (!group || renderedGroupIds.has(group.id)) continue
    const activities = group.activityIds
      .filter((activityId) => visibleActivityIds.has(activityId))
      .map((activityId) => activitiesById.get(activityId))
      .filter((activity): activity is ConversationActivity => Boolean(activity))
    if (activities.length === 0) continue
    renderedGroupIds.add(group.id)
    entries.push({ kind: 'activity-group', id: group.id, group, activities })
  }
  return entries
}

function activityRenderSignature(activity: ConversationActivity): string {
  const parts: Array<string | number | null> = [
    activity.id,
    activity.activityType,
    activity.label,
    activity.status,
    activity.durationMs,
    activity.completedAtMs,
  ]
  if ('command' in activity) parts.push(activity.command, activity.output, activity.exitCode)
  if ('progress' in activity) parts.push(...activity.progress)
  if ('query' in activity) parts.push(activity.query)
  if ('explanation' in activity) {
    parts.push(activity.explanation, activity.text, ...activity.steps.flatMap((step) => [step.status, step.step]))
  }
  if ('target' in activity) parts.push(activity.target)
  return parts.join('\u001f')
}

function activityStatusLabel(status: ConversationActivity['status']): string {
  switch (status) {
    case 'pending': return '等待中'
    case 'in-progress': return '进行中'
    case 'failed': return '失败'
    case 'declined': return '已拒绝'
    default: return '完成'
  }
}

function activityTarget(activity: ConversationActivity): string {
  return 'target' in activity ? activity.target : ''
}

function planStepMark(status: ConversationPlanActivity['steps'][number]['status']): string {
  if (status === 'completed') return '✓'
  if (status === 'in-progress') return '→'
  return '○'
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null || !Number.isFinite(durationMs)) return '耗时未知'
  const seconds = Math.max(0, Math.round(durationMs / 1000))
  if (seconds < 60) return `${String(seconds)} 秒`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) return remainingSeconds > 0 ? `${String(minutes)} 分 ${String(remainingSeconds)} 秒` : `${String(minutes)} 分钟`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0 ? `${String(hours)} 小时 ${String(remainingMinutes)} 分` : `${String(hours)} 小时`
}

function timingLabel(turn: ConversationTurn): string {
  if (turn.timingStatus === 'unavailable' || turn.activeElapsedMs === null) {
    if (turn.state === 'queued') return '等待执行'
    if (turn.state === 'waiting') return '等待你的处理'
    if (turn.state === 'running' || turn.state === 'sync-degraded') return '正在处理'
    return '过程记录'
  }
  return turn.timingStatus === 'running'
    ? `已处理 ${formatDuration(turn.activeElapsedMs)}`
    : `耗时 ${formatDuration(turn.activeElapsedMs)}`
}

function fileSummaryLabel(turn: ConversationTurn): string {
  const additions = turn.fileChanges.reduce((total, file) => total + file.additions, 0)
  const removals = turn.fileChanges.reduce((total, file) => total + file.removals, 0)
  return `${String(turn.fileChanges.length)} 个文件 · +${String(additions)} −${String(removals)}`
}

function fileKindLabel(kind: 'add' | 'delete' | 'update'): string {
  if (kind === 'add') return '新增'
  if (kind === 'delete') return '删除'
  return '修改'
}

function finalStatusTitle(turn: ConversationTurn): string {
  if (turn.opener?.deliveryState === 'failed' && turn.startedAtMs === null) return '消息发送失败'
  if (turn.finalStatus === 'failed') return '本轮执行失败'
  if (turn.finalStatus === 'interrupted') return '本轮已中断'
  if (turn.finalStatus === 'stopped') return '本轮已停止'
  return ''
}

function finalStatusDetail(turn: ConversationTurn): string {
  if (turn.error) return turn.error
  return '过程记录仍然保留，可根据上方状态决定是否重试。'
}

function deliveryStateLabel(state: ConversationUserBlock['deliveryState'], turn: ConversationTurn): string {
  switch (state) {
    case 'waitingNetwork': return '等待网络'
    case 'confirmationPending': return '正在确认送达'
    case 'sent': return turn.state === 'submitting' ? '已送达，等待启动' : '已发送'
    case 'failed': return '发送失败'
    default: return '发送中'
  }
}

function canRollback(turn: ConversationTurn): boolean {
  return !isActiveTurn(turn) && props.isTurnInProgress !== true && props.isRollingBack !== true && turn.index >= 0
}

function requestRollback(turn: ConversationTurn): void {
  if (!canRollback(turn)) return
  if (confirmingRollbackTurnIndex.value !== turn.index) {
    confirmingRollbackTurnIndex.value = turn.index
    if (rollbackTimer) window.clearTimeout(rollbackTimer)
    rollbackTimer = window.setTimeout(() => { confirmingRollbackTurnIndex.value = null }, 4_000)
    return
  }
  confirmingRollbackTurnIndex.value = null
  emit('rollback', { turnIndex: turn.index, prependText: turn.opener?.text || undefined })
}

function canFavorite(block: ConversationUserBlock): boolean {
  return !block.deliveryState && block.text.trim().length > 0
}

function isFavorite(messageId: string): boolean {
  return favoriteIds.value.has(messageId)
}

function favoriteIntent(
  block: ConversationUserBlock | ConversationAssistantBlock,
  turn: ConversationTurn,
): ConversationFavoriteIntent {
  return {
    messageId: block.id,
    role: block.kind === 'user' ? 'user' : 'assistant',
    text: block.text,
    turnId: turn.id,
    turnIndex: turn.index,
  }
}

function toggleFavorite(block: ConversationUserBlock | ConversationAssistantBlock, turn: ConversationTurn): void {
  if (!block.text.trim()) return
  emit('toggleFavorite', favoriteIntent(block, turn))
}

async function copyBlock(text: string): Promise<void> {
  try {
    await copyTextToClipboard(text)
    emit('copyStatus', { message: '已复制', tone: 'success' })
  } catch {
    emit('copyStatus', { message: '复制失败，请手动选择内容', tone: 'danger' })
  }
}

function planImplementationIntent(
  activity: ConversationPlanActivity,
  turn: ConversationTurn,
): ConversationPlanImplementationIntent {
  return {
    activityId: activity.id,
    turnId: turn.id,
    turnIndex: turn.index,
  }
}

const planImplementationState = computed(() => derivePlanImplementationState(props.projection))

function proposedPlans(turn: ConversationTurn): ConversationPlanActivity[] {
  return turn.activities.filter((activity): activity is ConversationPlanActivity => (
    activity.activityType === 'plan' && Boolean(activity.text.trim())
  ))
}

function canImplementPlan(activity: ConversationPlanActivity, turn: ConversationTurn): boolean {
  return planImplementationState.value.actionablePlanKey === planImplementationKey(turn.id, activity.id)
}

function isPlanImplemented(activityId: string, turnId: string): boolean {
  return planImplementationState.value.implementedPlanKeys.includes(planImplementationKey(turnId, activityId))
    || (props.implementedPlanIds ?? []).includes(activityId)
}

function pendingInteractionsForTurn(turn: ConversationTurn): ConversationInteractionBlock[] {
  return turn.interactions.filter((interaction) => interaction.status === 'pending')
}

function answerKey(interactionId: string, questionId: string): string {
  return `${interactionId}:${questionId}`
}

function onRequestAnswerChange(interactionId: string, questionId: string, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  requestAnswers.value = {
    ...requestAnswers.value,
    [answerKey(interactionId, questionId)]: target.value,
  }
}

function beginRequestResponse(requestId: number): boolean {
  if (respondingRequestIds.value.has(requestId)) return false
  respondingRequestIds.value = new Set(respondingRequestIds.value).add(requestId)
  return true
}

function beginInteractionResponse(interaction: ConversationInteractionBlock): number | null {
  const responseId = interaction.responseId
  if (responseId === null || !beginRequestResponse(responseId)) return null
  return responseId
}

function respondApproval(interaction: ConversationInteractionBlock, decision: 'accept' | 'acceptForSession' | 'decline'): void {
  const responseId = beginInteractionResponse(interaction)
  if (responseId === null) return
  emit('respondServerRequest', { id: responseId, result: { decision } })
}

function submitToolInput(interaction: ConversationInteractionBlock): void {
  const responseId = beginInteractionResponse(interaction)
  if (responseId === null) return
  const answers: Record<string, { answers: string[] }> = {}
  for (const question of interaction.questions) {
    const selected = requestAnswers.value[answerKey(interaction.id, question.id)] || ''
    const other = requestOtherAnswers.value[answerKey(interaction.id, question.id)] || ''
    answers[question.id] = { answers: [selected, other].map((value) => value.trim()).filter(Boolean) }
  }
  emit('respondServerRequest', { id: responseId, result: { answers } })
}

function canSubmitToolInput(interaction: ConversationInteractionBlock): boolean {
  return interaction.questions.length > 0 && interaction.questions.every((question) => {
    const selected = requestAnswers.value[answerKey(interaction.id, question.id)]?.trim() ?? ''
    const other = requestOtherAnswers.value[answerKey(interaction.id, question.id)]?.trim() ?? ''
    return Boolean(selected || other)
  })
}

function mcpPrimaryActionLabel(interaction: ConversationInteractionBlock): string {
  if (interaction.interactionType === 'mcp-approval') return '允许一次'
  return interaction.authorizationUrl ? '完成授权后继续' : '提交并继续'
}

function respondMcp(
  interaction: ConversationInteractionBlock,
  action: 'accept' | 'decline',
  persistence?: 'session' | 'always',
): void {
  const responseId = beginInteractionResponse(interaction)
  if (responseId === null) return
  const result: Record<string, unknown> = { action }
  const answer = mcpAnswers.value[interaction.id]?.trim() ?? ''
  if (action === 'accept') {
    result.content = answer && !interaction.authorizationUrl ? { response: answer } : {}
    if (persistence && interaction.mcpPersistenceScopes.includes(persistence)) {
      result._meta = { persist: persistence }
    }
  }
  emit('respondServerRequest', { id: responseId, result })
}

function reportUnsupportedTool(interaction: ConversationInteractionBlock): void {
  const responseId = beginInteractionResponse(interaction)
  if (responseId === null) return
  emit('respondServerRequest', {
    id: responseId,
    result: {
      success: false,
      contentItems: [{ type: 'inputText', text: '当前 Web 端不能代执行这个工具。请改用文字方案继续，或提示用户在桌面端处理。' }],
    },
  })
}

function respondEmpty(interaction: ConversationInteractionBlock): void {
  const responseId = beginInteractionResponse(interaction)
  if (responseId === null) return
  emit('respondServerRequest', { id: responseId, result: {} })
}

function rejectInteraction(interaction: ConversationInteractionBlock): void {
  const responseId = beginInteractionResponse(interaction)
  if (responseId === null) return
  emit('respondServerRequest', { id: responseId, error: { code: -32000, message: '请求已被用户拒绝。' } })
}

function isInteractionResponding(interaction: ConversationInteractionBlock): boolean {
  return interaction.responseId === null || respondingRequestIds.value.has(interaction.responseId)
}

function syncConversationViewport(element: HTMLElement): void {
  conversationViewportHeight.value = element.clientHeight
  conversationScrollTop.value = element.scrollTop
}

function toMeasuredElement(target: MeasureRefTarget): HTMLElement | null {
  if (target instanceof HTMLElement) return target
  if (target && '$el' in target && target.$el instanceof HTMLElement) return target.$el
  return null
}

function setTurnMeasureRef(turnId: string, target: MeasureRefTarget): void {
  const previous = observedTurnElementsById.get(turnId)
  const element = toMeasuredElement(target)
  if (!element) {
    if (previous) turnResizeObserver?.unobserve(previous)
    observedTurnElementsById.delete(turnId)
    return
  }
  if (previous && previous !== element) turnResizeObserver?.unobserve(previous)
  element.dataset.measureTurnId = turnId
  observedTurnElementsById.set(turnId, element)
  const height = Math.max(Math.ceil(element.getBoundingClientRect().height), 1)
  if (measuredTurnHeightById.value[turnId] !== height) {
    measuredTurnHeightById.value = { ...measuredTurnHeightById.value, [turnId]: height }
  }
  turnResizeObserver?.observe(element)
}

function captureVisibleTurnAnchor(): VisibleTurnAnchor | null {
  const container = conversationListRef.value
  if (!container) return null
  const containerTop = container.getBoundingClientRect().top
  for (const turn of virtualizedTurns.value) {
    const element = observedTurnElementsById.get(turn.id)
    if (!element) continue
    const rect = element.getBoundingClientRect()
    if (rect.bottom <= containerTop + 1) continue
    return { turnId: turn.id, top: rect.top }
  }
  return null
}

function restoreVisibleTurnAnchor(anchor: VisibleTurnAnchor): boolean {
  const container = conversationListRef.value
  const element = observedTurnElementsById.get(anchor.turnId)
  if (!container || !element) return false
  const delta = element.getBoundingClientRect().top - anchor.top
  if (Math.abs(delta) >= 1) {
    const maxScrollTop = Math.max(container.scrollHeight - container.clientHeight, 0)
    container.scrollTop = Math.min(Math.max(container.scrollTop + delta, 0), maxScrollTop)
  }
  syncConversationViewport(container)
  return true
}

function scheduleTurnHeightCompensation(anchor: VisibleTurnAnchor | null, shouldFollow: boolean, ownerThreadId: string): void {
  const ownsPin = Boolean(anchor && !pinnedTurnId.value)
  if (anchor && ownsPin) pinnedTurnId.value = anchor.turnId
  void nextTick().then(() => {
    if (heightRestoreFrame) window.cancelAnimationFrame(heightRestoreFrame)
    heightRestoreFrame = window.requestAnimationFrame(() => {
      heightRestoreFrame = 0
      if (ownerThreadId !== props.activeThreadId) return
      if (shouldFollow && !userIsAwayFromBottom) {
        scrollToBottom()
      } else if (!shouldFollow && userIsAwayFromBottom && anchor) {
        restoreVisibleTurnAnchor(anchor)
      }
      if (ownsPin && pinnedTurnId.value === anchor?.turnId) pinnedTurnId.value = ''
    })
  })
}

const turnResizeObserver = typeof ResizeObserver === 'undefined'
  ? null
  : new ResizeObserver((entries) => {
      const shouldFollow = !userIsAwayFromBottom
      const anchor = shouldFollow ? null : captureVisibleTurnAnchor()
      let nextHeights = measuredTurnHeightById.value
      let changed = false
      for (const entry of entries) {
        const element = entry.target
        if (!(element instanceof HTMLElement)) continue
        const ownerThreadId = element.closest<HTMLElement>('.transcript-list')?.dataset.threadId ?? ''
        if (ownerThreadId && ownerThreadId !== props.activeThreadId) continue
        const turnId = element.dataset.measureTurnId ?? ''
        if (!turnId) continue
        const height = Math.max(Math.ceil(element.getBoundingClientRect().height), 1)
        if (nextHeights[turnId] === height) continue
        if (!changed) nextHeights = { ...nextHeights }
        nextHeights[turnId] = height
        changed = true
      }
      if (!changed) return
      measuredTurnHeightById.value = nextHeights
      scheduleTurnHeightCompensation(anchor, shouldFollow, props.activeThreadId)
    })

const conversationListResizeObserver = typeof ResizeObserver === 'undefined'
  ? null
  : new ResizeObserver((entries) => {
      for (const entry of entries) {
        const element = entry.target
        if (!(element instanceof HTMLElement)) continue
        if ((element.dataset.threadId ?? '') !== props.activeThreadId) continue
        syncConversationViewport(element)
      }
    })

function isViewportAtBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= 88
}

function publishScrollState(): void {
  const element = conversationListRef.value
  if (!element || !props.activeThreadId) return
  const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight)
  emit('updateScrollState', {
    threadId: props.activeThreadId,
    state: {
      scrollTop: element.scrollTop,
      isAtBottom: isViewportAtBottom(element),
      scrollRatio: maxScrollTop > 0 ? element.scrollTop / maxScrollTop : 1,
    },
  })
}

function onConversationScroll(): void {
  const element = conversationListRef.value
  if (!element) return
  userIsAwayFromBottom = !isViewportAtBottom(element)
  isAwayFromBottom.value = userIsAwayFromBottom
  if (scrollFrame) return
  scrollFrame = window.requestAnimationFrame(() => {
    scrollFrame = 0
    syncConversationViewport(element)
    publishScrollState()
  })
}

function scrollToBottom(behavior: ScrollBehavior = 'auto'): void {
  const container = conversationListRef.value
  if (container && behavior === 'auto') {
    container.scrollTop = container.scrollHeight
    syncConversationViewport(container)
    return
  }
  bottomAnchorRef.value?.scrollIntoView({ block: 'end', behavior })
}

async function returnToLatest(): Promise<void> {
  userIsAwayFromBottom = false
  isAwayFromBottom.value = false
  scrollToBottom('smooth')
  await nextTick()
  conversationListRef.value?.focus({ preventScroll: true })
}

function requestOlderHistory(): void {
  const container = conversationListRef.value
  if (container) {
    const containerTop = container.getBoundingClientRect().top
    const visibleTurn = Array.from(container.querySelectorAll<HTMLElement>('.turn-shell'))
      .find((element) => element.getBoundingClientRect().bottom > containerTop + 4)
    const turnId = visibleTurn?.dataset.turnId ?? ''
    if (visibleTurn && turnId) {
      pendingOlderHistoryAnchor = { turnId, top: visibleTurn.getBoundingClientRect().top }
      pinnedTurnId.value = turnId
    }
  }
  emit('loadOlderHistory')
}

async function restoreOlderHistoryAnchor(): Promise<boolean> {
  const anchor = pendingOlderHistoryAnchor
  const container = conversationListRef.value
  if (!anchor || !container) return false
  await nextTick()
  const turn = Array.from(container.querySelectorAll<HTMLElement>('.turn-shell'))
    .find((element) => element.dataset.turnId === anchor.turnId)
  if (!turn) {
    pendingOlderHistoryAnchor = null
    if (pinnedTurnId.value === anchor.turnId) pinnedTurnId.value = ''
    return false
  }
  container.scrollTop += turn.getBoundingClientRect().top - anchor.top
  syncConversationViewport(container)
  pendingOlderHistoryAnchor = null
  if (pinnedTurnId.value === anchor.turnId) pinnedTurnId.value = ''
  userIsAwayFromBottom = true
  isAwayFromBottom.value = true
  publishScrollState()
  return true
}

async function restoreScrollState(): Promise<void> {
  await nextTick()
  const element = conversationListRef.value
  if (!element) return
  const state = props.scrollState
  if (!state || state.isAtBottom) {
    scrollToBottom()
    userIsAwayFromBottom = false
    isAwayFromBottom.value = false
    return
  }
  const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight)
  element.scrollTop = typeof state.scrollRatio === 'number'
    ? Math.min(maxScrollTop, Math.max(0, state.scrollRatio * maxScrollTop))
    : Math.min(maxScrollTop, Math.max(0, state.scrollTop))
  syncConversationViewport(element)
  userIsAwayFromBottom = !isViewportAtBottom(element)
  isAwayFromBottom.value = userIsAwayFromBottom
}

function projectionContentSignature(projection: ConversationProjection): string {
  const lastTurn = projection.turns.at(-1)
  if (!lastTurn) return `${projection.threadId}:0`
  const lastCommentary = lastTurn.commentary.at(-1)
  const lastActivity = lastTurn.activities.at(-1)
  const activityOutputLength = lastActivity && 'output' in lastActivity ? lastActivity.output.length : 0
  return [
    projection.threadId,
    projection.turns.length,
    lastTurn.id,
    lastTurn.state,
    lastTurn.blocks.length,
    lastCommentary?.text.length ?? 0,
    lastTurn.final?.text.length ?? 0,
    activityOutputLength,
    ...lastTurn.interactions.flatMap((interaction) => [interaction.id, interaction.status]),
  ].join(':')
}

async function focusMessage(messageId: string): Promise<boolean> {
  const normalizedId = messageId.trim()
  if (!normalizedId) return false
  const owningTurn = props.projection.turns.find((turn) => turn.blocks.some((block) => block.id === normalizedId))
  if (owningTurn) {
    pinnedTurnId.value = owningTurn.id
    await nextTick()
  }
  if (owningTurn && !isProcessExpanded(owningTurn)) {
    manuallyExpandedTurnIds.value = new Set(manuallyExpandedTurnIds.value).add(owningTurn.id)
    await nextTick()
  }
  if (owningTurn) {
    const blocks = processBlocks(owningTurn)
    const targetIndex = blocks.findIndex((block) => block.id === normalizedId)
    if (targetIndex >= 0) {
      const requiredHistoryCount = Math.max(0, blocks.length - targetIndex - 1)
      if (requiredHistoryCount > visibleProcessHistoryCount(owningTurn)) {
        visibleProcessHistoryCountByTurnId.value = {
          ...visibleProcessHistoryCountByTurnId.value,
          [owningTurn.id]: requiredHistoryCount,
        }
        await nextTick()
      }
    }
  }
  const root = conversationListRef.value
  if (!root) return false
  const candidates = root.querySelectorAll<HTMLElement>('[data-message-id]')
  const element = Array.from(candidates).find((candidate) => candidate.dataset.messageId === normalizedId)
  if (!element) {
    if (owningTurn && pinnedTurnId.value === owningTurn.id) pinnedTurnId.value = ''
    return false
  }
  element.scrollIntoView({ block: 'center', behavior: 'auto' })
  syncConversationViewport(root)
  if (owningTurn && pinnedTurnId.value === owningTurn.id) {
    pinnedTurnId.value = ''
    await nextTick()
  }
  highlightedMessageId.value = normalizedId
  element.classList.add('is-highlighted')
  if (highlightTimer) window.clearTimeout(highlightTimer)
  highlightTimer = window.setTimeout(() => {
    element.classList.remove('is-highlighted')
    highlightedMessageId.value = ''
  }, 2_000)
  return true
}

watch(
  () => props.activeThreadId,
  async () => {
    for (const element of observedTurnElementsById.values()) turnResizeObserver?.unobserve(element)
    observedTurnElementsById.clear()
    measuredTurnHeightById.value = {}
    pinnedTurnId.value = ''
    conversationScrollTop.value = 0
    manuallyExpandedTurnIds.value = new Set()
    visibleProcessHistoryCountByTurnId.value = {}
    confirmingRollbackTurnIndex.value = null
    respondingRequestIds.value = new Set()
    await restoreScrollState()
  },
)

watch(
  () => projectionContentSignature(props.projection),
  async () => {
    if (await restoreOlderHistoryAnchor()) return
    const shouldFollow = !userIsAwayFromBottom
    await nextTick()
    if (shouldFollow && !userIsAwayFromBottom) {
      isAwayFromBottom.value = false
      scrollToBottom()
    }
  },
)

watch(
  () => props.projection.turns.flatMap((turn) => turn.interactions)
    .filter((interaction) => interaction.status === 'pending' && interaction.responseId !== null)
    .map((interaction) => interaction.responseId)
    .join(','),
  () => {
    const pendingIds = new Set(props.projection.turns.flatMap((turn) => turn.interactions)
      .filter((interaction) => interaction.status === 'pending' && interaction.responseId !== null)
      .map((interaction) => interaction.responseId as number))
    respondingRequestIds.value = new Set([...respondingRequestIds.value].filter((id) => pendingIds.has(id)))
  },
)

defineExpose<ThreadConversationExposed>({ focusMessage })

onMounted(async () => {
  await nextTick()
  const container = conversationListRef.value
  if (container) {
    syncConversationViewport(container)
    conversationListResizeObserver?.observe(container)
  }
  await restoreScrollState()
})

onBeforeUnmount(() => {
  publishScrollState()
  if (scrollFrame) window.cancelAnimationFrame(scrollFrame)
  if (heightRestoreFrame) window.cancelAnimationFrame(heightRestoreFrame)
  if (rollbackTimer) window.clearTimeout(rollbackTimer)
  if (highlightTimer) window.clearTimeout(highlightTimer)
  conversationListResizeObserver?.disconnect()
  turnResizeObserver?.disconnect()
  observedTurnElementsById.clear()
})
</script>

<style scoped>
.transcript-root {
  --transcript-content-max: min(var(--ui-content-max), 48rem);
  position: relative;
  height: 100%;
  min-height: 0;
  color: var(--ui-text-primary);
}

.transcript-root.is-switching {
  opacity: 0.78;
}

.transcript-loading {
  position: absolute;
  z-index: 3;
  top: 10px;
  left: 50%;
  translate: -50% 0;
  pointer-events: none;
}

.transcript-list {
  box-sizing: border-box;
  height: 100%;
  margin: 0;
  padding: 28px max(20px, calc((100% - var(--transcript-content-max)) / 2)) 64px;
  overflow: auto;
  overflow-anchor: none;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  list-style: none;
  scroll-padding-block: 72px;
}

.virtual-turn-spacer {
  width: 100%;
  min-height: 0;
  pointer-events: none;
}

.conversation-jump-to-latest {
  position: absolute;
  z-index: 4;
  left: 50%;
  bottom: 18px;
  display: inline-flex;
  width: 34px;
  height: 34px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 999px;
  background: var(--ui-bg-surface);
  box-shadow: 0 8px 20px rgb(0 0 0 / 0.1);
  color: var(--ui-text-secondary);
  font: inherit;
  font-weight: 650;
  cursor: pointer;
  transform: translateX(-50%);
  transition:
    background-color var(--motion-duration-fast) var(--motion-ease-standard),
    border-color var(--motion-duration-fast) var(--motion-ease-standard),
    color var(--motion-duration-fast) var(--motion-ease-standard),
    transform var(--motion-duration-fast) var(--motion-ease-out);
}

.conversation-jump-to-latest:hover {
  border-color: var(--ui-border-strong);
  background: var(--ui-bg-row-hover);
  color: var(--ui-text-primary);
  transform: translateX(-50%) translateY(-1px);
}

.conversation-jump-to-latest:focus-visible {
  outline: 2px solid var(--ui-focus);
  outline-offset: 2px;
}

.conversation-jump-to-latest-label {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}

.run-dots {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.run-dots i {
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: currentColor;
  animation: transcript-dot-bounce 1.2s ease-in-out infinite;
}

.run-dots i:nth-child(2) { animation-delay: 150ms; }
.run-dots i:nth-child(3) { animation-delay: 300ms; }

.turn-shell {
  display: grid;
  gap: 10px;
  margin: 0 0 34px;
}

.user-message {
  justify-self: end;
  max-width: min(80%, 640px);
  padding: 9px 14px;
  border: 1px solid transparent;
  border-radius: 16px;
  background: var(--ui-bg-surface-muted);
}

.user-message.is-failed {
  border-color: color-mix(in srgb, var(--ui-danger) 42%, var(--ui-border-subtle));
}

.assistant-turn {
  min-width: 0;
}

.turn-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  margin: 2px 0 10px;
}

.turn-divider-line {
  height: 1px;
  min-width: 28px;
  flex: 1;
  background: var(--ui-border-subtle);
}

.turn-wait-time {
  color: var(--ui-warning);
}

.turn-live-state {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin: 5px 0 12px;
  color: var(--ui-text-tertiary);
  font-size: 13px;
}

.turn-live-state[data-state='sync-degraded'] {
  color: var(--ui-warning);
}

.turn-live-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--ui-accent);
  animation: transcript-live-pulse 1.2s var(--motion-ease-standard) infinite;
}

.turn-live-state[data-state='sync-degraded'] .turn-live-dot {
  background: var(--ui-warning);
}

.message-markdown {
  min-width: 0;
  font-family: var(--font-sans-reading);
  font-size: var(--font-size-reading);
  line-height: var(--line-height-reading);
  overflow-wrap: anywhere;
}

.message-markdown--final {
  font-size: calc(var(--font-size-reading) + 0.25px);
}

.message-markdown :deep(p) {
  margin: 0 0 0.82em;
}

.message-markdown :deep(p:last-child),
.message-markdown :deep(ul:last-child),
.message-markdown :deep(ol:last-child),
.message-markdown :deep(pre:last-child) {
  margin-bottom: 0;
}

.message-markdown :deep(h1),
.message-markdown :deep(h2),
.message-markdown :deep(h3),
.message-markdown :deep(h4),
.message-markdown :deep(h5),
.message-markdown :deep(h6) {
  margin: 1.2em 0 0.55em;
  line-height: 1.28;
  font-weight: 600;
}

.message-markdown :deep(h1) { font-size: 1.35em; }
.message-markdown :deep(h2) { font-size: 1.2em; }
.message-markdown :deep(h3) { font-size: 1.08em; }
.message-markdown :deep(h4),
.message-markdown :deep(h5),
.message-markdown :deep(h6) { font-size: 1em; }
.message-markdown :deep(:is(h1, h2, h3, h4, h5, h6):first-child) { margin-top: 0; }

.message-markdown :deep(ul),
.message-markdown :deep(ol) {
  margin: 0.6em 0 0.85em;
  padding-left: 1.5em;
}

.message-markdown :deep(ul) { list-style-type: disc; }
.message-markdown :deep(ol) { list-style-type: decimal; }
.message-markdown :deep(ul ul) { list-style-type: circle; }
.message-markdown :deep(ul ul ul) { list-style-type: square; }
.message-markdown :deep(li + li) { margin-top: 0.3em; }
.message-markdown :deep(li > :is(ul, ol)) { margin-block: 0.35em; }

.message-markdown :deep(a),
.request-link {
  color: var(--ui-accent);
  text-underline-offset: 3px;
}

.message-markdown :deep(code) {
  padding: 0.12em 0.38em;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 6px;
  background: var(--ui-bg-surface-muted);
  font-size: 0.9em;
}

.message-markdown :deep(pre),
.activity-details pre,
.file-row pre {
  box-sizing: border-box;
  max-width: 100%;
  margin: 10px 0 0;
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

.message-markdown :deep(pre code) {
  padding: 0;
  border: 0;
  background: transparent;
}

.message-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--motion-duration-fast) var(--motion-ease-standard);
}

.user-message:hover .message-actions,
.user-message:focus-within .message-actions,
.final-answer:hover .message-actions,
.final-answer:focus-within .message-actions,
.message-actions:has(.delivery-state) {
  opacity: 1;
  pointer-events: auto;
}

.message-actions--user {
  justify-content: flex-end;
}

.message-action,
.inline-copy {
  min-height: 28px;
  padding: 3px 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--ui-text-tertiary);
  cursor: pointer;
  font-size: 12px;
}

.message-action:hover,
.inline-copy:hover {
  background: var(--ui-bg-row-hover);
  color: var(--ui-text-primary);
}

.message-action.is-confirming {
  background: color-mix(in srgb, var(--ui-danger) 10%, transparent);
  color: var(--ui-danger);
}

.delivery-state {
  margin-right: auto;
  color: var(--ui-text-tertiary);
  font-size: 12px;
}

.delivery-state[data-state='failed'] {
  color: var(--ui-danger);
}

.user-images {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
  margin-top: 10px;
}

.attachment-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 9px;
}

.attachment-chip {
  max-width: 100%;
  padding: 3px 8px;
  overflow: hidden;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 999px;
  color: var(--ui-text-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.turn-process {
  margin: 0 0 12px;
}

.process-toggle {
  display: inline-flex;
  min-width: 0;
  min-height: 32px;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
  border: 0;
  background: transparent;
  color: var(--ui-text-tertiary);
  cursor: pointer;
  text-align: left;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  transition: color var(--motion-duration-fast) var(--motion-ease-standard);
}

.process-toggle:hover:not(:disabled),
.process-toggle:focus-visible {
  color: var(--ui-text-primary);
}

.process-toggle:focus-visible {
  outline: 2px solid var(--ui-focus);
  outline-offset: 3px;
  border-radius: 4px;
}

.process-toggle:disabled {
  cursor: default;
  opacity: 1;
}

.process-toggle-icon {
  display: inline-grid;
  width: 14px;
  height: 14px;
  place-items: center;
  color: var(--ui-text-tertiary);
  font-size: 16px;
  line-height: 1;
  transform-origin: center;
  transition: transform var(--motion-duration-base) var(--motion-ease-out);
}

.process-toggle-icon.is-expanded {
  transform: rotate(90deg);
}

.process-content {
  min-width: 0;
}

.process-content.has-history:not(.is-history-expanded) .commentary-copy,
.process-content.has-history:not(.is-history-expanded) .activity-command,
.process-content.has-history:not(.is-history-expanded) .activity-subtitle,
.process-content.has-history:not(.is-history-expanded) .activity-progress {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.process-history-controls {
  display: flex;
  align-items: center;
  margin-top: 2px;
}

.process-history-action {
  min-height: 32px;
  padding: 3px 0;
  border: 0;
  background: transparent;
  color: var(--ui-text-tertiary);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  text-align: left;
  transition: color var(--motion-duration-fast) var(--motion-ease-standard);
}

.process-history-action--older {
  margin-bottom: 2px;
}

.process-history-action:hover,
.process-history-action:focus-visible {
  color: var(--ui-text-primary);
}

.process-history-action:focus-visible {
  border-radius: 4px;
  outline: 2px solid var(--ui-focus);
  outline-offset: 2px;
}

.activity-group {
  min-width: 0;
}

.process-reveal-enter-active,
.process-reveal-leave-active {
  transition:
    opacity var(--motion-duration-base) var(--motion-ease-standard),
    transform var(--motion-duration-base) var(--motion-ease-out);
}

.process-reveal-enter-from,
.process-reveal-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.commentary-block,
.activity-block {
  position: relative;
  padding: 7px 0;
}

.activity-block {
  display: grid;
  grid-template-columns: 14px minmax(0, 1fr);
  gap: 7px;
}

.process-rail-dot {
  width: 6px;
  height: 6px;
  margin-top: 7px;
  border-radius: 999px;
  background: var(--ui-border-strong);
}

.commentary-block > .process-rail-dot {
  display: none;
}

.activity-block--in-progress .process-rail-dot,
.activity-block--pending .process-rail-dot {
  background: var(--ui-accent);
}

.activity-block--in-progress .process-rail-dot {
  animation: transcript-live-pulse 1.2s var(--motion-ease-standard) infinite;
}

.activity-block--failed .process-rail-dot,
.activity-block--declined .process-rail-dot {
  background: var(--ui-danger);
}

.commentary-block {
  color: var(--ui-text-secondary);
}

.commentary-copy {
  padding-right: 44px;
  font-size: 13.5px;
}

.inline-copy {
  position: absolute;
  top: 5px;
  right: 0;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--motion-duration-fast) var(--motion-ease-standard);
}

.commentary-block:hover .inline-copy,
.commentary-block:focus-within .inline-copy {
  opacity: 1;
  pointer-events: auto;
}

.activity-main {
  min-width: 0;
}

.activity-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 10px;
  color: var(--ui-text-tertiary);
  font-size: 12px;
}

.activity-heading strong {
  color: var(--ui-text-secondary);
  font-size: 13px;
  font-weight: 620;
}

.activity-command {
  display: block;
  margin-top: 7px;
  overflow-wrap: anywhere;
  color: var(--ui-text-secondary);
  font-size: 12.5px;
}

.activity-subtitle,
.activity-error {
  margin: 6px 0 0;
  color: var(--ui-text-secondary);
  font-size: 13px;
  line-height: 1.55;
}

.activity-error {
  color: var(--ui-danger);
}

.activity-details,
.file-summary,
.file-row {
  margin-top: 8px;
}

.activity-details summary,
.file-summary > summary,
.file-row > summary {
  cursor: pointer;
  color: var(--ui-text-secondary);
  font-size: 12.5px;
}

.activity-progress,
.plan-steps {
  display: grid;
  gap: 5px;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
  color: var(--ui-text-secondary);
  font-size: 13px;
}

.plan-steps li {
  display: grid;
  grid-template-columns: 18px 1fr;
  gap: 4px;
}

.plan-steps li[data-status='completed'] {
  color: var(--ui-text-tertiary);
}

.plan-action {
  margin-top: 10px;
}

.plan-proposal {
  margin-top: 12px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 12px;
  background: var(--ui-bg-surface);
}

.plan-proposal > summary {
  min-height: 44px;
  padding: 12px 16px;
  cursor: pointer;
  color: var(--ui-text-primary);
}

.plan-proposal > summary span {
  margin-left: 12px;
  font-size: 12px;
  color: var(--ui-text-secondary);
}

.plan-proposal-body {
  padding: 4px 16px 16px;
}

.resolved-interactions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-top: 8px;
}

.resolved-interaction {
  padding: 3px 7px;
  border-radius: 999px;
  background: var(--ui-bg-surface-muted);
  color: var(--ui-text-tertiary);
  font-size: 11.5px;
}

.file-summary {
  margin: 6px 0 14px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 12px;
  background: var(--ui-bg-surface);
  overflow: hidden;
}

.file-summary > summary,
.file-row > summary {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  list-style: none;
}

.file-summary > summary {
  min-height: 46px;
  padding: 5px 10px;
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
  gap: 0;
  padding: 4px;
  border-top: 1px solid var(--ui-border-subtle);
}

.file-row {
  margin: 0;
  border: 0;
}

.file-row > summary {
  min-height: 34px;
  padding: 4px 8px;
  border-radius: 6px;
  transition: background-color var(--motion-duration-fast) var(--motion-ease-standard);
}

.file-row > summary:hover {
  background: var(--ui-bg-row-hover);
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
  margin: 3px 8px 8px;
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

.request-stack {
  display: grid;
  gap: 10px;
  margin: 10px 0 16px;
}

.request-card {
  padding: 14px;
  border: 1px solid color-mix(in srgb, var(--ui-warning) 34%, var(--ui-border-subtle));
  border-radius: 12px;
  background: color-mix(in srgb, var(--ui-warning) 6%, var(--ui-bg-surface));
}

.request-card-heading {
  display: grid;
  grid-template-columns: 10px 1fr;
  gap: 9px;
}

.request-card strong {
  font-size: 13.5px;
}

.request-card p {
  margin: 4px 0 0;
  color: var(--ui-text-secondary);
  font-size: 12.5px;
  line-height: 1.5;
}

.request-dot {
  width: 8px;
  height: 8px;
  margin-top: 6px;
  border-radius: 999px;
  background: var(--ui-warning);
}

.request-context {
  display: grid;
  gap: 6px;
  margin: 11px 0 0 19px;
}

.request-context-row {
  display: grid;
  grid-template-columns: minmax(72px, auto) minmax(0, 1fr);
  gap: 10px;
  font-size: 12px;
  line-height: 1.5;
}

.request-context-row dt {
  color: var(--ui-text-tertiary);
}

.request-context-row dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--ui-text-secondary);
  font-family: var(--font-mono-ui);
}

.request-field {
  display: grid;
  gap: 5px;
  margin-top: 12px;
  color: var(--ui-text-secondary);
  font-size: 12px;
}

.request-field input,
.request-field select,
.request-field textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 38px;
  padding: 8px 10px;
  border: 1px solid var(--ui-border-strong);
  border-radius: 9px;
  background: var(--ui-bg-surface);
  color: var(--ui-text-primary);
  outline: none;
}

.request-field input:focus,
.request-field select:focus,
.request-field textarea:focus {
  border-color: var(--ui-focus);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ui-focus) 15%, transparent);
}

.request-link {
  display: inline-block;
  margin-top: 10px;
  font-size: 12.5px;
}

.request-actions,
.transcript-alert-actions,
.transcript-empty-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 12px;
}

.quiet-button,
.history-button {
  min-height: 34px;
  padding: 6px 11px;
  border: 1px solid var(--ui-border-strong);
  border-radius: 9px;
  background: var(--ui-bg-surface);
  color: var(--ui-text-secondary);
  cursor: pointer;
  font-size: 12.5px;
}

.quiet-button:hover:not(:disabled),
.history-button:hover:not(:disabled) {
  background: var(--ui-bg-row-hover);
  color: var(--ui-text-primary);
}

.quiet-button--primary {
  border-color: var(--ui-text-primary);
  background: var(--ui-text-primary);
  color: var(--ui-bg-surface);
}

.quiet-button--danger {
  color: var(--ui-danger);
}

.quiet-button:disabled,
.history-button:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

.turn-timing {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  margin: 0;
  color: var(--ui-text-tertiary);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.turn-timing--static {
  min-height: 32px;
  align-items: center;
}

.turn-timing[data-status='running'] {
  color: var(--ui-accent);
}

.final-answer {
  min-width: 0;
  margin-top: 4px;
  padding-bottom: 2px;
  color: var(--ui-text-primary);
}

.final-answer.is-streaming::after {
  display: inline-block;
  width: 6px;
  height: 1em;
  margin-left: 3px;
  border-radius: 2px;
  background: var(--ui-accent);
  vertical-align: -2px;
  animation: transcript-caret 1s steps(1) infinite;
  content: '';
}

.final-status,
.turn-notice,
.transcript-alert {
  padding: 12px 14px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 10px;
  background: var(--ui-bg-surface-muted);
  color: var(--ui-text-secondary);
}

.final-status[data-status='failed'],
.final-status[data-status='interrupted'],
.final-status[data-status='stopped'],
.transcript-alert--danger {
  border-color: color-mix(in srgb, var(--ui-danger) 35%, var(--ui-border-subtle));
  background: color-mix(in srgb, var(--ui-danger) 5%, var(--ui-bg-surface));
}

.final-status strong,
.transcript-alert strong {
  color: var(--ui-text-primary);
  font-size: 13.5px;
}

.final-status p,
.transcript-alert p {
  margin: 4px 0 0;
  font-size: 12.5px;
}

.turn-notice {
  margin-top: 10px;
  font-size: 12px;
}

.transcript-alert {
  position: absolute;
  z-index: 2;
  top: 14px;
  right: 18px;
  left: 18px;
  display: flex;
  max-width: 760px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin: 0 auto;
  box-shadow: var(--ui-shadow-float);
}

.transcript-alert-actions {
  flex: 0 0 auto;
  margin-top: 0;
}

.transcript-empty {
  display: grid;
  height: 100%;
  place-content: center;
  justify-items: center;
  color: var(--ui-text-tertiary);
  text-align: center;
}

.history-row {
  display: flex;
  justify-content: center;
  margin: 0 0 28px;
}

.history-button {
  border-color: transparent;
  background: transparent;
}

.bottom-anchor {
  height: 1px;
}

[data-message-id].is-highlighted {
  animation: transcript-highlight 1.8s var(--motion-ease-out);
}

@keyframes transcript-highlight {
  0%, 24% { outline: 3px solid color-mix(in srgb, var(--ui-focus) 35%, transparent); outline-offset: 5px; }
  100% { outline: 3px solid transparent; outline-offset: 10px; }
}

@keyframes transcript-caret {
  0%, 48% { opacity: 1; }
  49%, 100% { opacity: 0; }
}

@keyframes transcript-live-pulse {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
}

@keyframes transcript-dot-bounce {
  0%, 60%, 100% { opacity: 0.4; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-3px); }
}

@media (max-width: 767px) {
  .transcript-list {
    padding: 22px 14px 48px;
    scrollbar-gutter: auto;
  }

  .turn-shell {
    gap: 8px;
    margin-bottom: 28px;
  }

  .conversation-jump-to-latest {
    left: 50%;
    bottom: 12px;
    width: 44px;
    height: 44px;
    min-height: 44px;
  }

  .user-message {
    max-width: 88%;
    padding: 10px 12px;
  }

  .message-actions {
    opacity: 1;
    pointer-events: auto;
  }

  .message-action,
  .inline-copy,
  .quiet-button,
  .history-button,
  .process-toggle,
  .process-history-action,
  .activity-details > summary,
  .file-summary > summary,
  .file-row > summary {
    min-height: 44px;
  }

  .process-content {
    margin: 0;
    padding: 0;
  }

  .turn-process {
    margin-bottom: 8px;
  }

  .commentary-block,
  .activity-block {
    padding-block: 5px;
  }

  .file-row > summary {
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

  .file-row[open] code {
    white-space: normal;
  }

  .request-context {
    margin-left: 0;
  }

  .request-context-row {
    grid-template-columns: 1fr;
    gap: 1px;
  }

  .transcript-alert {
    top: 8px;
    right: 8px;
    left: 8px;
    display: block;
  }

  .transcript-alert-actions {
    margin-top: 10px;
  }
}

@media (pointer: coarse) {
  .message-action,
  .inline-copy,
  .quiet-button,
  .history-button,
  .process-toggle,
  .process-history-action,
  .activity-details > summary,
  .file-summary > summary,
  .file-row > summary {
    min-height: 44px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .run-dots i,
  .turn-live-dot,
  .activity-block--in-progress .process-rail-dot {
    animation: none;
  }

  .process-reveal-enter-active,
  .process-reveal-leave-active,
  .process-toggle-icon,
  .file-summary-chevron {
    transition-duration: 1ms;
  }

  .final-answer.is-streaming::after {
    animation: none;
  }

  [data-message-id].is-highlighted {
    animation: none;
    outline: 2px solid var(--ui-focus);
    outline-offset: 4px;
  }
}

.dark .transcript-root {
  --ui-bg-window: #09090b;
  --ui-bg-surface: #18181b;
  --ui-bg-surface-muted: #27272a;
  --ui-bg-row-hover: #3f3f46;
  --ui-border-subtle: #3f3f46;
  --ui-border-strong: #52525b;
  --ui-accent: #5eead4;
}

.dark .user-message,
.dark .quiet-button,
.dark .request-field input,
.dark .request-field select,
.dark .request-field textarea {
  background: #27272a;
}

.dark .quiet-button--primary {
  background: #f4f4f5;
  color: #18181b;
}

</style>
