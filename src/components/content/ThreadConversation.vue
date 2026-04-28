<template>
  <section class="conversation-root" :class="{ 'conversation-root--switching': isThreadSwitchingState }">
    <div
      v-if="showLoadingIndicator"
      class="conversation-status-loading"
      :class="{ 'conversation-status-loading--switching': props.isThreadSwitching === true }"
      aria-live="polite"
    >
      <LoadingInline
        class="conversation-status-loading-inline"
        :label="loadingIndicatorText"
        :tone="props.isThreadSwitching === true ? 'warm' : 'muted'"
        compact
      />
    </div>

    <div
      v-if="!hasRenderableConversation && !props.isLoading"
      class="conversation-empty-state"
    >
      <p class="conversation-empty">当前会话还没有消息。</p>
      <div v-if="showEmptyThreadActions" class="conversation-empty-actions">
        <button type="button" class="conversation-empty-action conversation-empty-action-primary" @click="emit('returnToNewThread')">
          返回新会话
        </button>
        <button type="button" class="conversation-empty-action" @click="emit('dismissEmptyThread')">
          移除此空会话
        </button>
      </div>
    </div>

    <template v-else>
      <ul ref="conversationListRef" class="conversation-list" :class="{ 'conversation-list--switching': isThreadSwitchingState }">
      <li
        v-if="showProcessPanel"
        ref="processPanelRef"
        class="conversation-item conversation-item-process"
      >
      <section class="conversation-process-panel">
        <article
          v-if="liveOverlay"
          class="live-overlay-inline"
          :class="{
            'live-overlay-inline-compact': !shouldRenderDetailedLiveOverlay,
            'live-overlay-inline-thinking': !liveOverlayCommandMessage,
            'live-overlay-inline-command': Boolean(liveOverlayCommandMessage),
          }"
          aria-live="polite"
        >
          <template v-if="shouldRenderDetailedLiveOverlay">
            <div class="live-overlay-head">
              <span class="live-overlay-indicator" aria-hidden="true">
                <span class="live-overlay-indicator-ring" />
                <span class="live-overlay-indicator-core" />
              </span>
              <div class="live-overlay-heading">
                <p class="live-overlay-label">{{ liveOverlayPrimaryLabel(liveOverlay) }}</p>
                <span class="live-overlay-dots" aria-hidden="true">
                  <span class="live-overlay-dot" />
                  <span class="live-overlay-dot" />
                  <span class="live-overlay-dot" />
                </span>
              </div>
            </div>
            <div
              v-if="!liveOverlayCommandMessage && liveOverlayDetails(liveOverlay).length > 0"
              class="live-overlay-detail-list"
            >
              <span
                v-for="detail in liveOverlayDetails(liveOverlay)"
                :key="detail"
                class="live-overlay-detail-chip"
              >
                {{ detail }}
              </span>
            </div>
            <section v-if="liveOverlayCommandMessage" class="live-overlay-command-panel">
              <div v-if="liveOverlayDetails(liveOverlay).length > 0" class="live-overlay-detail-list live-overlay-command-details">
                <span
                  v-for="detail in liveOverlayDetails(liveOverlay)"
                  :key="detail"
                  class="live-overlay-detail-chip"
                >
                  {{ detail }}
                </span>
              </div>
              <div class="cmd-row cmd-status-running live-overlay-command-row">
                <span class="cmd-status">{{ commandStatusLabel(liveOverlayCommandMessage) }}</span>
                <span v-if="commandDurationLabel(liveOverlayCommandMessage)" class="cmd-duration">
                  {{ commandDurationLabel(liveOverlayCommandMessage) }}
                </span>
                <code class="cmd-label">{{ liveOverlayCommandMessage.commandExecution?.command || '（命令）' }}</code>
              </div>
              <div v-if="liveOverlayCommandOutput" class="live-overlay-command-output-wrap">
                <pre class="cmd-output live-overlay-command-output">{{ liveOverlayCommandOutput }}</pre>
              </div>
            </section>
            <p
              v-else-if="liveOverlay.reasoningText"
              class="live-overlay-reasoning"
              ref="liveOverlayReasoningRef"
            >
              {{ liveOverlay.reasoningText }}
            </p>
            <p v-else class="live-overlay-hint">
              {{ liveOverlayHint(liveOverlay) }}
            </p>
            <section v-if="overlayPrimaryPendingRequest" class="live-overlay-actions">
              <template v-if="isApprovalRequestMethod(overlayPrimaryPendingRequest.method)">
                <button
                  type="button"
                  class="live-overlay-action live-overlay-action-primary"
                  @click="onRespondApproval(overlayPrimaryPendingRequest.id, 'accept')"
                >
                  允许
                </button>
                <button
                  type="button"
                  class="live-overlay-action"
                  @click="onRespondApproval(overlayPrimaryPendingRequest.id, 'acceptForSession')"
                >
                  始终允许
                </button>
                <button
                  type="button"
                  class="live-overlay-action"
                  @click="onRespondApproval(overlayPrimaryPendingRequest.id, 'decline')"
                >
                  拒绝
                </button>
                <button
                  type="button"
                  class="live-overlay-action"
                  @click="onRespondApproval(overlayPrimaryPendingRequest.id, 'cancel')"
                >
                  取消
                </button>
              </template>
              <template v-else-if="overlayPrimaryPendingRequest.method === 'item/tool/call'">
                <button
                  type="button"
                  class="live-overlay-action live-overlay-action-primary"
                  @click="onRespondToolCallFailure(overlayPrimaryPendingRequest.id)"
                >
                  返回失败
                </button>
                <button
                  type="button"
                  class="live-overlay-action"
                  @click="onRespondToolCallSuccess(overlayPrimaryPendingRequest.id)"
                >
                  返回成功
                </button>
                <button
                  type="button"
                  class="live-overlay-action"
                  @click="scrollToPendingRequests"
                >
                  查看详情
                </button>
              </template>
              <template v-else>
                <button
                  type="button"
                  class="live-overlay-action live-overlay-action-primary"
                  @click="scrollToPendingRequests"
                >
                  {{ pendingRequestActionLabel(overlayPrimaryPendingRequest) }}
                </button>
              </template>
            </section>
            <p v-if="pendingRequests.length > 1" class="live-overlay-request-count">
              还有 {{ pendingRequests.length - 1 }} 个待处理请求
            </p>
            <p v-if="liveOverlay.errorText" class="live-overlay-error">{{ liveOverlay.errorText }}</p>
          </template>
          <template v-else>
            <div class="live-overlay-compact-main">
              <span class="live-overlay-indicator" aria-hidden="true">
                <span class="live-overlay-indicator-ring" />
                <span class="live-overlay-indicator-core" />
              </span>
              <div class="live-overlay-compact-copy">
                <div class="live-overlay-compact-head">
                  <p class="live-overlay-compact-label">{{ liveOverlayPrimaryLabel(liveOverlay) }}</p>
                  <span class="live-overlay-dots" aria-hidden="true">
                    <span class="live-overlay-dot" />
                    <span class="live-overlay-dot" />
                    <span class="live-overlay-dot" />
                  </span>
                </div>
                <p class="live-overlay-compact-hint">{{ liveOverlayCompactHint(liveOverlay) }}</p>
              </div>
            </div>
          </template>
        </article>

        <section v-if="pendingRequests.length > 0" class="conversation-process-section">
          <button type="button" class="conversation-process-toggle" @click="isRequestPanelExpanded = !isRequestPanelExpanded">
            <span>待处理请求</span>
            <span>{{ pendingRequests.length }} 项</span>
          </button>
          <div v-if="isRequestPanelExpanded" class="conversation-process-stack">
            <article v-for="request in pendingRequests" :key="`panel-request:${request.id}`" class="request-card">
              <p class="request-title">{{ requestTitleLabel(request) }}</p>
              <p class="request-meta">请求 #{{ request.id }} · {{ formatIsoTime(request.receivedAtIso) }}</p>

              <p v-if="readRequestReason(request)" class="request-reason">{{ readRequestReason(request) }}</p>

              <section v-if="request.method === 'item/commandExecution/requestApproval'" class="request-actions">
                <button type="button" class="request-button request-button-primary" @click="onRespondApproval(request.id, 'accept')">允许</button>
                <button type="button" class="request-button" @click="onRespondApproval(request.id, 'acceptForSession')">本次会话始终允许</button>
                <button type="button" class="request-button" @click="onRespondApproval(request.id, 'decline')">拒绝</button>
                <button type="button" class="request-button" @click="onRespondApproval(request.id, 'cancel')">取消</button>
              </section>

              <section v-else-if="request.method === 'item/fileChange/requestApproval'" class="request-actions">
                <button type="button" class="request-button request-button-primary" @click="onRespondApproval(request.id, 'accept')">允许</button>
                <button type="button" class="request-button" @click="onRespondApproval(request.id, 'acceptForSession')">本次会话始终允许</button>
                <button type="button" class="request-button" @click="onRespondApproval(request.id, 'decline')">拒绝</button>
                <button type="button" class="request-button" @click="onRespondApproval(request.id, 'cancel')">取消</button>
              </section>

              <section v-else-if="request.method === 'item/tool/requestUserInput'" class="request-user-input">
                <div
                  v-for="question in readToolQuestions(request)"
                  :key="`${request.id}:${question.id}`"
                  class="request-question"
                >
                  <p class="request-question-title">{{ question.header || question.question }}</p>
                  <p v-if="question.header && question.question" class="request-question-text">{{ question.question }}</p>
                  <select
                    class="request-select"
                    :value="readQuestionAnswer(request.id, question.id, question.options[0] || '')"
                    @change="onQuestionAnswerChange(request.id, question.id, $event)"
                  >
                    <option v-for="option in question.options" :key="`${request.id}:${question.id}:${option}`" :value="option">
                      {{ option }}
                    </option>
                  </select>
                  <input
                    v-if="question.isOther"
                    class="request-input"
                    type="text"
                    :value="readQuestionOtherAnswer(request.id, question.id)"
                    placeholder="其他答案"
                    @input="onQuestionOtherAnswerInput(request.id, question.id, $event)"
                  />
                </div>

                <button type="button" class="request-button request-button-primary" @click="onRespondToolRequestUserInput(request)">
                  提交答案
                </button>
              </section>

              <section v-else-if="isMcpElicitationRequest(request.method)" class="request-user-input">
                <template v-if="isMcpPermissionElicitationRequest(request)">
                  <div class="request-permission-panel">
                    <span class="request-permission-badge">权限确认</span>
                    <p class="request-permission-title">{{ readMcpPermissionTitle(request) }}</p>
                    <p class="request-permission-text">{{ readMcpPermissionSummary(request) }}</p>
                    <dl class="request-permission-grid">
                      <div class="request-permission-item">
                        <dt class="request-permission-term">服务</dt>
                        <dd class="request-permission-value">{{ readMcpPermissionServerName(request) }}</dd>
                      </div>
                      <div class="request-permission-item">
                        <dt class="request-permission-term">工具</dt>
                        <dd class="request-permission-value">{{ readMcpPermissionToolName(request) }}</dd>
                      </div>
                    </dl>
                    <p class="request-permission-note">
                      允许后 Codex 会继续本次自动化操作；拒绝后相关浏览器操作可能中止。
                    </p>
                  </div>

                  <section class="request-actions request-actions-prominent">
                    <button type="button" class="request-button request-button-primary" @click="onRespondMcpElicitation(request, 'accept')">
                      允许并继续
                    </button>
                    <button type="button" class="request-button" @click="onRespondMcpElicitation(request, 'decline')">拒绝</button>
                    <button type="button" class="request-button" @click="onRespondMcpElicitation(request, 'cancel')">稍后处理</button>
                  </section>
                </template>

                <template v-else>
                <p v-if="readMcpElicitationIntro(request)" class="request-question-text">
                  {{ readMcpElicitationIntro(request) }}
                </p>

                <a
                  v-if="readMcpElicitationUrl(request)"
                  class="request-link"
                  :href="readMcpElicitationUrl(request)"
                  target="_blank"
                  rel="noopener noreferrer"
                  @click="onHyperlinkClick($event, readMcpElicitationUrl(request))"
                >
                  打开需要处理的页面
                </a>

                <div
                  v-for="field in readMcpElicitationFields(request)"
                  :key="`${request.id}:mcp:${field.id}`"
                  class="request-question"
                >
                  <p class="request-question-title">
                    {{ field.title }}
                    <span v-if="field.required" class="request-required">必填</span>
                  </p>
                  <p v-if="field.description" class="request-question-text">{{ field.description }}</p>

                  <select
                    v-if="field.enumOptions.length > 0"
                    class="request-select"
                    :value="readMcpElicitationAnswer(request.id, field)"
                    @change="onMcpElicitationAnswerChange(request.id, field.id, $event)"
                  >
                    <option v-if="!field.required" value="">不填写</option>
                    <option
                      v-for="option in field.enumOptions"
                      :key="`${request.id}:mcp:${field.id}:${option.value}`"
                      :value="option.value"
                    >
                      {{ option.label }}
                    </option>
                  </select>

                  <label v-else-if="field.type === 'boolean'" class="request-checkbox-row">
                    <input
                      type="checkbox"
                      :checked="readMcpElicitationBooleanAnswer(request.id, field)"
                      @change="onMcpElicitationBooleanAnswerChange(request.id, field.id, $event)"
                    />
                    <span>是</span>
                  </label>

                  <input
                    v-else
                    class="request-input"
                    :type="field.type === 'number' || field.type === 'integer' ? 'number' : 'text'"
                    :value="readMcpElicitationAnswer(request.id, field)"
                    :placeholder="field.required ? '请输入' : '可选'"
                    @input="onMcpElicitationAnswerChange(request.id, field.id, $event)"
                  />
                </div>

                <div
                  v-if="readMcpElicitationFields(request).length === 0 && !readMcpElicitationUrl(request)"
                  class="request-question"
                >
                  <p class="request-question-title">补充内容</p>
                  <textarea
                    class="request-textarea"
                    :value="readMcpElicitationFallbackAnswer(request.id)"
                    placeholder="输入后提交，Codex 会继续执行"
                    @input="onMcpElicitationFallbackInput(request.id, $event)"
                  />
                </div>

                <section class="request-actions">
                  <button type="button" class="request-button request-button-primary" @click="onRespondMcpElicitation(request, 'accept')">
                    {{ readMcpElicitationUrl(request) ? '已处理，继续' : '提交并继续' }}
                  </button>
                  <button type="button" class="request-button" @click="onRespondMcpElicitation(request, 'decline')">拒绝</button>
                  <button type="button" class="request-button" @click="onRespondMcpElicitation(request, 'cancel')">稍后处理</button>
                </section>
                </template>
              </section>

              <section v-else-if="request.method === 'item/tool/call'" class="request-actions">
                <button type="button" class="request-button request-button-primary" @click="onRespondToolCallFailure(request.id)">返回失败</button>
                <button type="button" class="request-button" @click="onRespondToolCallSuccess(request.id)">返回成功（空结果）</button>
              </section>

              <section v-else class="request-actions">
                <button type="button" class="request-button request-button-primary" @click="onRespondEmptyResult(request.id)">返回空结果</button>
                <button type="button" class="request-button" @click="onRejectUnknownRequest(request.id)">拒绝请求</button>
              </section>
            </article>
          </div>
        </section>
      </section>
      </li>
      <li
        v-if="hasHiddenEarlierMessages"
        class="conversation-item conversation-item-load-more"
      >
        <button
          type="button"
          class="conversation-load-more-button"
          :disabled="isRevealingOlderMessages"
          @click="onRevealOlderMessages"
        >
          <span class="conversation-load-more-title">
            {{ isRevealingOlderMessages ? '正在加载更早消息...' : `继续查看更多（剩余 ${hiddenEarlierMessageCount} 条）` }}
          </span>
          <span class="conversation-load-more-hint">滑到顶部也会继续加载</span>
        </button>
      </li>
      <li
        v-if="virtualTopSpacerHeight > 0"
        class="conversation-spacer"
        aria-hidden="true"
        :style="{ height: `${String(virtualTopSpacerHeight)}px` }"
      />
      <li
        v-for="entry in virtualizedMessages"
        :key="entry.key"
        :ref="(el) => setMessageMeasureRef(entry.measureId, el)"
        class="conversation-item"
        :class="{
          'conversation-item-actionable': entry.kind === 'message' && (canShowMessageActions(entry.message) || canFavoriteMessage(entry.message)),
          'conversation-item-actions-active': entry.kind === 'message' && isMessageActionBarActive(entry.message),
          'conversation-item-highlighted': entry.kind === 'message' && highlightedMessageId === entry.message.id,
        }"
        :data-role="entry.kind === 'message' ? entry.message.role : 'assistant'"
        :data-message-type="entry.kind === 'message' ? (entry.message.messageType || '') : 'guidedSummary'"
      >
        <div v-if="entry.kind === 'guidedSummary'" class="message-row" data-role="assistant" data-message-type="guidedSummary">
          <div class="message-stack" data-role="assistant">
            <button
              type="button"
              class="guided-turn-toggle"
              :aria-expanded="isGuidedTurnExpanded(entry.turnIndex)"
              @click="onToggleGuidedTurn(entry.turnIndex)"
            >
              <span class="guided-turn-toggle-title">
                {{ isGuidedTurnExpanded(entry.turnIndex) ? '收起引导式内容' : '查看引导式内容' }}
              </span>
              <span class="guided-turn-toggle-meta">
                {{ entry.hiddenCount }} 条阶段性回复<span v-if="guidedTurnDurationLabel(entry.turnIndex)"> · {{ guidedTurnDurationLabel(entry.turnIndex) }}</span>
              </span>
            </button>
          </div>
        </div>

        <div v-else-if="isCommandMessage(entry.message)" class="message-row" data-role="system">
          <div class="message-stack" data-role="system">
            <button
              type="button"
              class="cmd-row"
              :class="[commandStatusClass(entry.message), { 'cmd-expanded': isCommandExpanded(entry.message) }]"
              @click="toggleCommandExpand(entry.message)"
            >
              <span class="cmd-chevron" :class="{ 'cmd-chevron-open': isCommandExpanded(entry.message) }">▶</span>
              <span class="cmd-status">{{ commandStatusLabel(entry.message) }}</span>
              <span v-if="commandDurationLabel(entry.message)" class="cmd-duration">{{ commandDurationLabel(entry.message) }}</span>
              <code class="cmd-label">{{ entry.message.commandExecution?.command || '（命令）' }}</code>
            </button>
            <div
              class="cmd-output-wrap"
              :class="{ 'cmd-output-visible': isCommandExpanded(entry.message), 'cmd-output-collapsing': isCommandCollapsing(entry.message) }"
            >
              <div class="cmd-output-inner">
                <pre class="cmd-output">{{ entry.message.commandExecution?.aggregatedOutput || '（无输出）' }}</pre>
              </div>
            </div>
          </div>
        </div>

        <div
          v-else
          class="message-row"
          :data-role="entry.message.role"
          :data-message-type="entry.message.messageType || ''"
        >
          <div class="message-stack" :data-role="entry.message.role">
            <p
              v-if="messageRoleLabel(entry.message, entry.messageIndex)"
              class="message-eyebrow"
              :data-role="entry.message.role"
            >
              {{ messageRoleLabel(entry.message, entry.messageIndex) }}
            </p>
            <article class="message-body" :data-role="entry.message.role">
              <ul
                v-if="entry.message.images && entry.message.images.length > 0"
                class="message-image-list"
                :data-role="entry.message.role"
              >
                <li v-for="imageUrl in entry.message.images" :key="imageUrl" class="message-image-item">
                  <button class="message-image-button" type="button" @click="openImageModal(imageUrl)">
                    <img class="message-image-preview" :src="toRenderableImageUrl(imageUrl)" alt="消息图片预览" loading="lazy" />
                  </button>
                </li>
              </ul>

              <div
                v-if="entry.message.fileAttachments && entry.message.fileAttachments.length > 0"
                class="message-file-attachments"
              >
                <span v-for="att in entry.message.fileAttachments" :key="att.path" class="message-file-chip">
                  <span class="message-file-chip-icon">📄</span>
                  <span class="message-file-link-wrap">
                    <a
                      class="message-file-link message-file-chip-name"
                      :href="toBrowseUrl(att.path)"
                      target="_blank"
                      rel="noopener noreferrer"
                      :title="att.path"
                      @click="onHyperlinkClick($event, toBrowseUrl(att.path))"
                      @contextmenu.prevent="onFileLinkContextMenu($event, att.path)"
                    >
                      {{ att.path }}
                    </a>
                  </span>
                </span>
              </div>

              <article
                v-if="entry.message.text.length > 0"
                class="message-card"
                :class="{ 'is-favorited': isFavoriteMessage(entry.message) }"
                :data-role="entry.message.role"
                :tabindex="canShowMessageActionBar(entry.message) ? 0 : undefined"
                @click="onMessageCardActivate(entry.message)"
                @focusin="onMessageCardActivate(entry.message)"
                @keydown.enter.prevent="onMessageCardActivate(entry.message)"
                @keydown.space.prevent="onMessageCardActivate(entry.message)"
              >
                <div class="message-text-flow">
                  <template
                    v-for="(block, blockIndex) in getPreparedMessageBlocks(entry.message)"
                    :key="`block-${blockIndex}`"
                  >
                    <p v-if="block.kind === 'text'" class="message-text">
                      <template v-for="(segment, segmentIndex) in block.segments" :key="`seg-${blockIndex}-${segmentIndex}`">
                        <span v-if="segment.kind === 'text'">{{ segment.value }}</span>
                        <strong v-else-if="segment.kind === 'bold'" class="message-bold-text">{{ segment.value }}</strong>
                        <span v-else-if="segment.kind === 'file'" class="message-file-link-wrap">
                          <a
                            class="message-file-link"
                            :href="toBrowseUrl(segment.path)"
                            target="_blank"
                            rel="noopener noreferrer"
                            :title="segment.path"
                            @click="onHyperlinkClick($event, toBrowseUrl(segment.path))"
                            @contextmenu.prevent="onFileLinkContextMenu($event, segment.path)"
                          >
                            {{ segment.displayPath }}
                          </a>
                        </span>
                        <a
                          v-else-if="segment.kind === 'url'"
                          class="message-file-link"
                          :href="segment.href"
                          target="_blank"
                          rel="noopener noreferrer"
                          :title="segment.href"
                          @click="onHyperlinkClick($event, segment.href)"
                          @contextmenu.prevent="onUrlLinkContextMenu($event, segment.href)"
                        >
                          {{ segment.value }}
                        </a>
                        <code v-else class="message-inline-code">{{ segment.value }}</code>
                      </template>
                    </p>
                    <p v-else-if="isMarkdownImageFailed(entry.message.id, blockIndex)" class="message-text">{{ block.markdown }}</p>
                    <button
                      v-else
                      class="message-image-button"
                      type="button"
                      @click="openImageModal(block.url)"
                    >
                      <img
                        class="message-image-preview message-markdown-image"
                        :src="block.url"
                        :alt="block.alt || '消息内图片'"
                        loading="lazy"
                        @error="onMarkdownImageError(entry.message.id, blockIndex)"
                      />
                    </button>
                  </template>
                </div>
              </article>
            </article>

            <div v-if="canShowMessageActionBar(entry.message)" class="message-actions">
              <button
                v-if="canFavoriteMessage(entry.message)"
                class="message-action-button message-action-button--favorite"
                :class="{ 'is-favorited': isFavoriteMessage(entry.message) }"
                type="button"
                :title="isFavoriteMessage(entry.message) ? '取消收藏这条消息' : '收藏这条消息'"
                @click.stop="onToggleFavorite(entry.message)"
              >
                <IconTablerBookmark class="message-action-icon" :filled="isFavoriteMessage(entry.message)" />
                <span class="message-action-label">{{ isFavoriteMessage(entry.message) ? '取消收藏' : '收藏' }}</span>
              </button>
              <button
                v-if="canCopyMessage(entry.message)"
                class="message-action-button"
                type="button"
                title="复制消息内容"
                @click.stop="onCopyMessage(entry.message)"
              >
                <IconTablerCopy class="message-action-icon" />
                <span class="message-action-label">复制</span>
              </button>
              <button
                v-if="canRollbackMessage(entry.message)"
                class="message-action-button"
                type="button"
                title="回滚到这条消息，并移除其后的当前轮次内容"
                @click.stop="onRollback(entry.message)"
              >
                <IconTablerArrowBackUp class="message-action-icon" />
                <span class="message-action-label">回滚</span>
              </button>
            </div>
          </div>
        </div>
      </li>
      <li
        v-if="virtualBottomSpacerHeight > 0"
        class="conversation-spacer"
        aria-hidden="true"
        :style="{ height: `${String(virtualBottomSpacerHeight)}px` }"
      />
      <li ref="bottomAnchorRef" class="conversation-bottom-anchor" />
      </ul>

      <button
        v-if="showJumpToLatestButton"
        class="conversation-jump-to-latest"
        :class="{ 'has-pending-updates': hasPendingBelowFoldUpdates }"
        type="button"
        :title="jumpToLatestTitle"
        @click="jumpToLatest"
      >
        <IconTablerArrowUp class="conversation-jump-to-latest-icon" />
        <span class="conversation-jump-to-latest-label">
          {{ hasPendingBelowFoldUpdates ? '最新输出' : '回到底部' }}
        </span>
        <span v-if="hasPendingBelowFoldUpdates" class="conversation-jump-to-latest-badge" />
      </button>
    </template>

    <div v-if="modalImageUrl.length > 0" class="image-modal-backdrop" @click="closeImageModal">
      <div class="image-modal-content" role="dialog" aria-modal="true" aria-label="图片预览" @click.stop>
        <div class="image-modal-toolbar">
          <div class="image-modal-toolbar-group">
            <button class="image-modal-tool" type="button" aria-label="缩小图片" @click="zoomOutImageModal">
              -
            </button>
            <button class="image-modal-tool image-modal-scale" type="button" aria-label="重置图片缩放" @click="resetImageModalView">
              {{ modalImageScaleLabel }}
            </button>
            <button class="image-modal-tool" type="button" aria-label="放大图片" @click="zoomInImageModal">
              +
            </button>
          </div>
          <button class="image-modal-close" type="button" aria-label="关闭图片预览" @click="closeImageModal">
            <IconTablerX class="icon-svg" />
          </button>
        </div>
        <div
          ref="imageModalStageRef"
          class="image-modal-stage"
          :class="{ 'image-modal-stage--zoomed': isImageModalZoomed, 'image-modal-stage--dragging': isImageModalDragging }"
          @wheel.prevent="onImageModalWheel"
          @dblclick="onImageModalDoubleClick"
        >
          <img
            ref="imageModalImageRef"
            class="image-modal-image"
            :src="modalImageUrl"
            alt="放大的消息图片"
            :style="imageModalStyle"
            @dragstart.prevent
            @pointerdown="onImageModalPointerDown"
            @pointermove="onImageModalPointerMove"
            @pointerup="onImageModalPointerUp"
            @pointercancel="onImageModalPointerUp"
          />
        </div>
      </div>
    </div>

    <div
      v-if="isFileLinkContextMenuVisible"
      ref="fileLinkContextMenuRef"
      class="file-link-context-menu"
      :style="fileLinkContextMenuStyle"
      @click.stop
    >
      <button type="button" class="file-link-context-menu-item" @click="openFileLinkContextBrowse">
        打开链接
      </button>
      <button type="button" class="file-link-context-menu-item" @click="copyFileLinkContextLink">
        复制链接
      </button>
      <button
        v-if="fileLinkContextEditUrl"
        type="button"
        class="file-link-context-menu-item"
        @click="openFileLinkContextEdit"
      >
        编辑文件
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import type { ThreadScrollState, UiLiveOverlay, UiMessage, UiServerRequest } from '../../types/codex'
import IconTablerX from '../icons/IconTablerX.vue'
import IconTablerArrowBackUp from '../icons/IconTablerArrowBackUp.vue'
import IconTablerArrowUp from '../icons/IconTablerArrowUp.vue'
import IconTablerBookmark from '../icons/IconTablerBookmark.vue'
import IconTablerCopy from '../icons/IconTablerCopy.vue'
import LoadingInline from './LoadingInline.vue'
import { isNativeAndroidShell, openMobileShellUrl } from '../../mobile/mobileShell'

export type ThreadConversationExposed = {
  focusMessage: (messageId: string) => Promise<boolean>
}

const expandedCommandIds = ref<Set<string>>(new Set())
const collapsingCommandIds = ref<Set<string>>(new Set())
const prevCommandStatuses = ref<Record<string, string>>({})
const commandElapsedNowMs = ref(Date.now())
const observedCommandStartedAtById = ref<Record<string, number>>({})
const liveOverlayObservedAtMs = ref(0)
let commandElapsedTimer: number | null = null

function isCommandMessage(message: UiMessage): boolean {
  return message.messageType === 'commandExecution' && !!message.commandExecution
}

function isRunningCommandMessage(message: UiMessage): boolean {
  return isCommandMessage(message) && message.commandExecution?.status === 'inProgress'
}

function isCommandExpanded(message: UiMessage): boolean {
  if (message.commandExecution?.status === 'inProgress') return true
  if (collapsingCommandIds.value.has(message.id)) return true
  return expandedCommandIds.value.has(message.id)
}

function isCommandCollapsing(message: UiMessage): boolean {
  return collapsingCommandIds.value.has(message.id)
}

function toggleCommandExpand(message: UiMessage): void {
  if (message.commandExecution?.status === 'inProgress') return
  const next = new Set(expandedCommandIds.value)
  if (next.has(message.id)) next.delete(message.id)
  else next.add(message.id)
  expandedCommandIds.value = next
}

function commandStatusLabel(message: UiMessage): string {
  const ce = message.commandExecution
  if (!ce) return ''
  switch (ce.status) {
    case 'inProgress': return '⟳ 执行中'
    case 'completed': return ce.exitCode === 0 ? '✓ 已完成' : `✗ 退出 ${ce.exitCode ?? '?'}`
    case 'failed': return '✗ 执行失败'
    case 'declined': return '⊘ 已拒绝'
    case 'interrupted': return '⊘ 已中断'
    default: return ''
  }
}

function formatCommandDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return ''
  const totalSeconds = Math.max(1, Math.floor(durationMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    if (minutes > 0) return `${String(hours)} 小时 ${String(minutes)} 分`
    return `${String(hours)} 小时`
  }
  if (minutes > 0) {
    if (seconds > 0) return `${String(minutes)} 分 ${String(seconds)} 秒`
    return `${String(minutes)} 分`
  }
  return `${String(seconds)} 秒`
}

function formatHandledDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return ''
  if (durationMs < 1000) return '<1 秒'
  return formatCommandDuration(durationMs)
}

function parseWorkedMessageDurationMs(text: string): number | null {
  const match = text.trim().match(/^Worked for\s+(.+)$/i)
  if (!match) return null
  const rawDuration = match[1]?.trim() ?? ''
  if (!rawDuration) return null
  if (rawDuration === '<1s') return 0

  let durationMs = 0
  let matched = false
  for (const part of rawDuration.matchAll(/(\d+)\s*([hms])/gi)) {
    const value = Number.parseInt(part[1] ?? '', 10)
    const unit = (part[2] ?? '').toLowerCase()
    if (!Number.isFinite(value) || value < 0) continue
    matched = true
    if (unit === 'h') durationMs += value * 60 * 60 * 1000
    else if (unit === 'm') durationMs += value * 60 * 1000
    else if (unit === 's') durationMs += value * 1000
  }

  return matched ? durationMs : null
}

function resolveCommandDurationMs(message: UiMessage): number | null {
  const ce = message.commandExecution
  if (!ce) return null
  if (ce.status === 'inProgress') {
    const startedAtMs =
      (typeof ce.startedAtMs === 'number' && Number.isFinite(ce.startedAtMs) && ce.startedAtMs > 0)
        ? ce.startedAtMs
        : observedCommandStartedAtById.value[message.id]
    if (typeof startedAtMs === 'number' && Number.isFinite(startedAtMs) && startedAtMs > 0) {
      return Math.max(0, commandElapsedNowMs.value - startedAtMs)
    }
  }
  return typeof ce.durationMs === 'number' && Number.isFinite(ce.durationMs)
    ? Math.max(0, ce.durationMs)
    : null
}

function commandDurationLabel(message: UiMessage): string {
  const ce = message.commandExecution
  if (!ce) return ''
  const durationMs = resolveCommandDurationMs(message)
  if (durationMs === null) return ''
  const durationText = formatCommandDuration(durationMs)
  if (!durationText) return ''
  return ce.status === 'inProgress' ? `已运行 ${durationText}` : `用时 ${durationText}`
}

function commandStatusClass(message: UiMessage): string {
  const s = message.commandExecution?.status
  if (s === 'inProgress') return 'cmd-status-running'
  if (s === 'completed' && message.commandExecution?.exitCode === 0) return 'cmd-status-ok'
  return 'cmd-status-error'
}

function stopCommandElapsedTimer(): void {
  if (commandElapsedTimer !== null && typeof window !== 'undefined') {
    window.clearInterval(commandElapsedTimer)
    commandElapsedTimer = null
  }
}

function startCommandElapsedTimer(): void {
  if (typeof window === 'undefined') return
  commandElapsedNowMs.value = Date.now()
  if (commandElapsedTimer !== null) return
  commandElapsedTimer = window.setInterval(() => {
    commandElapsedNowMs.value = Date.now()
  }, 1000)
}

function syncObservedCommandStartTimes(messages: UiMessage[]): void {
  const next: Record<string, number> = {}
  const now = Date.now()
  let hasRunningCommand = false

  for (const message of messages) {
    const ce = message.commandExecution
    if (!ce || message.messageType !== 'commandExecution' || ce.status !== 'inProgress') continue
    hasRunningCommand = true
    if (typeof ce.startedAtMs === 'number' && Number.isFinite(ce.startedAtMs) && ce.startedAtMs > 0) {
      next[message.id] = ce.startedAtMs
      continue
    }
    const knownStartedAt = observedCommandStartedAtById.value[message.id]
    if (typeof knownStartedAt === 'number' && Number.isFinite(knownStartedAt) && knownStartedAt > 0) {
      next[message.id] = knownStartedAt
      continue
    }
    const baseDurationMs = typeof ce.durationMs === 'number' && Number.isFinite(ce.durationMs)
      ? Math.max(0, ce.durationMs)
      : 0
    next[message.id] = Math.max(0, now - baseDurationMs)
  }

  observedCommandStartedAtById.value = next
  if (hasRunningCommand || props.liveOverlay) {
    startCommandElapsedTimer()
  } else {
    stopCommandElapsedTimer()
  }
}

function scheduleCollapse(messageId: string): void {
  const nextCollapsing = new Set(collapsingCommandIds.value)
  nextCollapsing.add(messageId)
  collapsingCommandIds.value = nextCollapsing
  setTimeout(() => {
    const next = new Set(collapsingCommandIds.value)
    next.delete(messageId)
    collapsingCommandIds.value = next
  }, 1000)
}

const props = defineProps<{
  messages: UiMessage[]
  pendingRequests: UiServerRequest[]
  liveOverlay: UiLiveOverlay | null
  isLoading: boolean
  activeThreadId: string
  cwd: string
  scrollState: ThreadScrollState | null
  isTurnInProgress?: boolean
  isRollingBack?: boolean
  showEmptyThreadActions?: boolean
  isThreadSwitching?: boolean
  favoriteMessageIds?: string[]
}>()

const MESSAGE_WINDOW_SIZE = 10
const renderableMessages = computed<UiMessage[]>(() => (
  props.messages.filter((message) => !isCommandMessage(message) && message.messageType !== 'worked')
))
const isRevealingOlderMessages = ref(false)
const canAutoRevealOlderMessages = ref(true)
const visibleMessageStartIndex = ref(0)
const isRequestPanelExpanded = ref(false)
const expandedGuidedTurnIndexes = ref<Set<number>>(new Set())

function latestVisibleStartIndex(messageCount: number): number {
  return Math.max(messageCount - MESSAGE_WINDOW_SIZE, 0)
}

function readTurnIndex(message: UiMessage): number | null {
  return typeof message.turnIndex === 'number' ? message.turnIndex : null
}

function isGuidedAssistantMessage(message: UiMessage): boolean {
  return (
    message.role === 'assistant' &&
    !isCommandMessage(message) &&
    message.messageType !== 'worked' &&
    message.text.trim().length > 0
  )
}

type GuidedTurnDescriptor = {
  turnIndex: number
  hiddenMessages: UiMessage[]
  finalMessageId: string
}

type ConversationMessageEntry = {
  kind: 'message'
  key: string
  measureId: string
  message: UiMessage
  messageIndex: number
}

type GuidedSummaryEntry = {
  kind: 'guidedSummary'
  key: string
  measureId: string
  turnIndex: number
  hiddenCount: number
}

type ConversationRenderEntry = ConversationMessageEntry | GuidedSummaryEntry

const latestRenderableTurnIndex = computed<number | null>(() => {
  for (let index = renderableMessages.value.length - 1; index >= 0; index -= 1) {
    const turnIndex = readTurnIndex(renderableMessages.value[index])
    if (typeof turnIndex === 'number') return turnIndex
  }
  return null
})

function isTurnCompleted(turnIndex: number): boolean {
  if (turnIndex !== latestRenderableTurnIndex.value) return true
  return typeof workedSummaryDurationByTurnIndex.value[turnIndex] === 'number'
}

const collapsibleGuidedTurnDescriptors = computed<Map<number, GuidedTurnDescriptor>>(() => {
  const groupedMessages = new Map<number, UiMessage[]>()

  for (const message of renderableMessages.value) {
    const turnIndex = readTurnIndex(message)
    if (typeof turnIndex !== 'number') continue
    const messages = groupedMessages.get(turnIndex) ?? []
    messages.push(message)
    groupedMessages.set(turnIndex, messages)
  }

  const descriptors = new Map<number, GuidedTurnDescriptor>()
  for (const [turnIndex, messages] of groupedMessages.entries()) {
    if (!isTurnCompleted(turnIndex)) continue
    const guidedMessages = messages.filter(isGuidedAssistantMessage)
    if (guidedMessages.length < 2) continue
    const finalMessage = guidedMessages[guidedMessages.length - 1]
    const hiddenMessages = guidedMessages.slice(0, -1)
    if (!finalMessage || hiddenMessages.length === 0) continue
    descriptors.set(turnIndex, {
      turnIndex,
      hiddenMessages,
      finalMessageId: finalMessage.id,
    })
  }

  return descriptors
})

const workedSummaryDurationByTurnIndex = computed<Record<number, number>>(() => {
  const next: Record<number, number> = {}

  for (let index = 0; index < props.messages.length; index += 1) {
    const message = props.messages[index]
    if (message.messageType !== 'worked') continue
    const durationMs = parseWorkedMessageDurationMs(message.text)
    if (durationMs === null) continue

    for (let nextIndex = index + 1; nextIndex < props.messages.length; nextIndex += 1) {
      const candidate = props.messages[nextIndex]
      if (candidate.role !== 'assistant' || candidate.messageType === 'worked') continue
      const turnIndex = readTurnIndex(candidate)
      if (typeof turnIndex !== 'number') break
      next[turnIndex] = durationMs
      break
    }
  }

  return next
})

const guidedTurnDurationLabelByTurnIndex = computed<Record<number, string>>(() => {
  const commandDurationByTurnIndex: Record<number, number> = {}

  for (const message of props.messages) {
    if (!isCommandMessage(message)) continue
    const turnIndex = readTurnIndex(message)
    if (typeof turnIndex !== 'number') continue
    const durationMs = resolveCommandDurationMs(message)
    if (durationMs === null) continue
    commandDurationByTurnIndex[turnIndex] = (commandDurationByTurnIndex[turnIndex] ?? 0) + durationMs
  }

  const next: Record<number, string> = {}
  for (const descriptor of collapsibleGuidedTurnDescriptors.value.values()) {
    const durationMs = workedSummaryDurationByTurnIndex.value[descriptor.turnIndex] ?? commandDurationByTurnIndex[descriptor.turnIndex]
    if (typeof durationMs !== 'number' || durationMs < 0) continue
    const durationLabel = formatHandledDuration(durationMs)
    if (!durationLabel) continue
    next[descriptor.turnIndex] = `已处理 ${durationLabel}`
  }

  return next
})

const hiddenGuidedMessageTurnIndexById = computed<Record<string, number>>(() => {
  const next: Record<string, number> = {}
  for (const descriptor of collapsibleGuidedTurnDescriptors.value.values()) {
    for (const message of descriptor.hiddenMessages) {
      next[message.id] = descriptor.turnIndex
    }
  }
  return next
})

function isGuidedTurnExpanded(turnIndex: number): boolean {
  return expandedGuidedTurnIndexes.value.has(turnIndex)
}

function guidedTurnDurationLabel(turnIndex: number): string {
  return guidedTurnDurationLabelByTurnIndex.value[turnIndex] ?? ''
}

function buildGuidedSummaryEntry(turnIndex: number, hiddenCount: number): GuidedSummaryEntry {
  return {
    kind: 'guidedSummary',
    key: `guided-summary:${String(turnIndex)}`,
    measureId: `guided-summary:${String(turnIndex)}`,
    turnIndex,
    hiddenCount,
  }
}

const renderableConversationEntries = computed<ConversationRenderEntry[]>(() => {
  const entries: ConversationRenderEntry[] = []
  let visibleMessageIndex = 0

  for (const message of renderableMessages.value) {
    const turnIndex = readTurnIndex(message)
    const descriptor =
      typeof turnIndex === 'number' ? (collapsibleGuidedTurnDescriptors.value.get(turnIndex) ?? null) : null
    const hiddenTurnIndex = hiddenGuidedMessageTurnIndexById.value[message.id]

    if (
      typeof hiddenTurnIndex === 'number' &&
      descriptor &&
      !isGuidedTurnExpanded(hiddenTurnIndex)
    ) {
      continue
    }

    if (descriptor && descriptor.finalMessageId === message.id) {
      entries.push(buildGuidedSummaryEntry(descriptor.turnIndex, descriptor.hiddenMessages.length))
    }

    entries.push({
      kind: 'message',
      key: message.id,
      measureId: message.id,
      message,
      messageIndex: visibleMessageIndex,
    })
    visibleMessageIndex += 1
  }

  return entries
})

const visibleRenderableEntries = computed<ConversationRenderEntry[]>(() => (
  renderableConversationEntries.value.slice(visibleMessageStartIndex.value)
))
const visibleMessageEntries = computed<ConversationMessageEntry[]>(() => (
  visibleRenderableEntries.value.filter((entry): entry is ConversationMessageEntry => entry.kind === 'message')
))
const hiddenEarlierMessageCount = computed(() => visibleMessageStartIndex.value)
const hasHiddenEarlierMessages = computed(() => hiddenEarlierMessageCount.value > 0)
const showProcessPanel = computed(() => (
  !!props.liveOverlay || props.pendingRequests.length > 0
))

const liveOverlayCommandMessage = computed<UiMessage | null>(() => {
  const overlay = props.liveOverlay
  if (!overlay) return null
  for (let index = props.messages.length - 1; index >= 0; index -= 1) {
    const candidate = props.messages[index]
    if (candidate && isRunningCommandMessage(candidate)) return candidate
  }
  return null
})

const liveOverlayCommandOutput = computed<string>(() => (
  liveOverlayCommandMessage.value?.commandExecution?.aggregatedOutput?.trim() ?? ''
))

const emit = defineEmits<{
  updateScrollState: [payload: { threadId: string; state: ThreadScrollState }]
  respondServerRequest: [payload: { id: number; result?: unknown; error?: { code?: number; message: string } }]
  rollback: [payload: { turnIndex: number; prependText?: string }]
  toggleFavorite: [message: UiMessage]
  returnToNewThread: []
  dismissEmptyThread: []
}>()

const conversationListRef = ref<HTMLElement | null>(null)
const bottomAnchorRef = ref<HTMLElement | null>(null)
const processPanelRef = ref<HTMLElement | null>(null)
const liveOverlayReasoningRef = ref<HTMLElement | null>(null)
const modalImageUrl = ref('')
const imageModalStageRef = ref<HTMLElement | null>(null)
const imageModalImageRef = ref<HTMLImageElement | null>(null)
const modalImageScale = ref(1)
const modalImageOffsetX = ref(0)
const modalImageOffsetY = ref(0)
const isImageModalDragging = ref(false)
const fileLinkContextMenuRef = ref<HTMLElement | null>(null)
const toolQuestionAnswers = ref<Record<string, string>>({})
const toolQuestionOtherAnswers = ref<Record<string, string>>({})
const mcpElicitationAnswers = ref<Record<string, string | boolean>>({})
const hasPendingBelowFoldUpdates = ref(false)
const autoFollowBottom = ref(props.scrollState?.isAtBottom !== false)
const BOTTOM_THRESHOLD_PX = 16
const IMAGE_MODAL_MIN_SCALE = 1
const IMAGE_MODAL_MAX_SCALE = 4
const IMAGE_MODAL_SCALE_STEP = 0.25
let modalImagePointerId: number | null = null
let modalImageDragStartX = 0
let modalImageDragStartY = 0
let modalImageDragOriginX = 0
let modalImageDragOriginY = 0
let highlightedMessageTimer: number | null = null
let previousBodyOverflow = ''
type InlineSegment =
  | { kind: 'text'; value: string }
  | { kind: 'bold'; value: string }
  | { kind: 'code'; value: string }
  | { kind: 'url'; value: string; href: string }
  | { kind: 'file'; value: string; path: string; displayPath: string; downloadName: string }
type MessageBlock =
  | { kind: 'text'; value: string }
  | { kind: 'image'; url: string; alt: string; markdown: string }
type PreparedMessageBlock =
  | { kind: 'text'; value: string; segments: InlineSegment[] }
  | { kind: 'image'; url: string; alt: string; markdown: string }
type MeasureRefTarget = Element | ComponentPublicInstance | null
type ScrollAnchorSnapshot = {
  measureId: string
  viewportOffset: number
}

const VIRTUALIZE_MIN_MESSAGES = 80
const VIRTUAL_OVERSCAN_PX = 640
const ESTIMATED_PENDING_REQUEST_HEIGHT_PX = 156

let scrollRestoreFrame = 0
let scrollAnchorRestoreFrame = 0
let bottomLockFrame = 0
let bottomLockFramesLeft = 0
let scrollStateEmitFrame = 0
let scrollInteractionFrame = 0
let scrollStateIdleTimer: number | null = null
let pendingScrollStateContainer: HTMLElement | null = null
let pendingScrollStateForce = false
let pendingScrollInteractionContainer: HTMLElement | null = null
let lastGapMeasuredContainer: HTMLElement | null = null
let lastGapMeasuredViewportHeight = -1
let observedConversationListElement: HTMLElement | null = null
let lastScrollStateEmitAt = 0
const trackedPendingImages = new WeakSet<HTMLImageElement>()
const failedMarkdownImageKeys = ref<Set<string>>(new Set())
const preparedMessageBlocksById = new Map<string, { text: string; blocks: PreparedMessageBlock[] }>()
const isFileLinkContextMenuVisible = ref(false)
const fileLinkContextMenuX = ref(0)
const fileLinkContextMenuY = ref(0)
const fileLinkContextBrowseUrl = ref('')
const fileLinkContextEditUrl = ref('')
const highlightedMessageId = ref('')
const activeMessageActionId = ref('')
const EMPTY_MESSAGES: UiMessage[] = []
const conversationViewportHeight = ref(0)
const conversationScrollTop = ref(0)
const conversationItemGap = ref(0)
const lastEmittedScrollStateSignature = ref('')
const measuredMessageHeightById = ref<Record<string, number>>({})
const observedMessageElementsById = new Map<string, HTMLElement>()
const itemResizeObserver =
  typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver((entries) => {
      const anchorSnapshot = !shouldLockToBottom() ? captureVisibleConversationAnchor() : null
      let nextMessageHeights = measuredMessageHeightById.value
      let hasMessageHeightChange = false

      for (const entry of entries) {
        const target = entry.target
        if (!(target instanceof HTMLElement)) continue
        const measureKind = target.dataset.measureKind
        const measureId = target.dataset.measureId ?? ''
        if (!measureKind || !measureId) continue

        const nextHeight = Math.max(Math.ceil(target.getBoundingClientRect().height), 1)
        if (measureKind === 'message') {
          if (nextMessageHeights[measureId] === nextHeight) continue
          if (!hasMessageHeightChange) {
            nextMessageHeights = { ...nextMessageHeights }
            hasMessageHeightChange = true
          }
          nextMessageHeights[measureId] = nextHeight
        }
      }

      if (hasMessageHeightChange) {
        measuredMessageHeightById.value = nextMessageHeights
      }
      if (hasMessageHeightChange) {
        if (shouldLockToBottom()) {
          scheduleBottomLock(2)
        } else if (anchorSnapshot) {
          void scheduleScrollAnchorRestore(anchorSnapshot)
        }
      }
    })
    : null
const conversationListResizeObserver =
  typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver((entries) => {
      for (const entry of entries) {
        const target = entry.target
        if (!(target instanceof HTMLElement)) continue
        syncConversationViewport(target)
        if (shouldLockToBottom()) {
          scheduleBottomLock(2)
        }
      }
    })
    : null
const hasRenderableConversation = computed(() => (
  visibleRenderableEntries.value.length > 0 ||
  props.pendingRequests.length > 0 ||
  props.liveOverlay !== null
))
const isThreadSwitchingState = computed(() => props.isThreadSwitching === true && hasRenderableConversation.value)
const showLoadingIndicator = computed(() => props.isLoading)
const loadingIndicatorText = computed(() => {
  if (props.isThreadSwitching === true) return '正在切换到这个会话...'
  return hasRenderableConversation.value ? '正在同步最新内容...' : '正在载入会话...'
})
const showJumpToLatestButton = computed(() => (
  hasRenderableConversation.value &&
  hasPendingBelowFoldUpdates.value &&
  !shouldLockToBottom()
))
const overlayPrimaryPendingRequest = computed<UiServerRequest | null>(() => props.pendingRequests[0] ?? null)
const favoriteMessageIdSet = computed(() => new Set(props.favoriteMessageIds ?? []))
const shouldRenderDetailedLiveOverlay = computed<boolean>(() => {
  const overlay = props.liveOverlay
  if (!overlay) return false
  if (overlayPrimaryPendingRequest.value) return true
  if (overlay.errorText.trim().length > 0) return true
  if (liveOverlayCommandMessage.value) return true
  if (overlay.reasoningText.trim().length > 0) return true
  if (liveOverlayDetails(overlay).length > 0) return true
  return overlay.activityLabel.trim().length > 0
})
const liveOverlayBehaviorSignature = computed<string>(() => {
  const overlay = props.liveOverlay
  if (!overlay) return ''
  return [
    overlay.activityLabel.trim(),
    overlay.errorText.trim(),
    overlayPrimaryPendingRequest.value?.id ?? '',
    overlayPrimaryPendingRequest.value?.method ?? '',
    String(props.pendingRequests.length),
  ].join('|')
})
const liveOverlayElapsedLabel = computed(() => {
  if (!props.liveOverlay || liveOverlayObservedAtMs.value <= 0) return ''
  return formatHandledDuration(Math.max(0, commandElapsedNowMs.value - liveOverlayObservedAtMs.value))
})
const jumpToLatestTitle = computed(() => (
  hasPendingBelowFoldUpdates.value ? '跳到最新输出' : '回到底部'
))
const isImageModalZoomed = computed(() => modalImageScale.value > IMAGE_MODAL_MIN_SCALE + 0.001)
const modalImageScaleLabel = computed(() => `${Math.round(modalImageScale.value * 100)}%`)
const imageModalStyle = computed(() => ({
  transform: `translate3d(${String(modalImageOffsetX.value)}px, ${String(modalImageOffsetY.value)}px, 0) scale(${String(modalImageScale.value)})`,
  cursor: isImageModalZoomed.value ? (isImageModalDragging.value ? 'grabbing' : 'grab') : 'zoom-in',
  transition: isImageModalDragging.value ? 'none' : 'transform 180ms cubic-bezier(0.16, 1, 0.3, 1)',
}))
const shouldVirtualizeMessages = computed(() => visibleRenderableEntries.value.length >= VIRTUALIZE_MIN_MESSAGES)

function estimateConversationEntryHeight(entry: ConversationRenderEntry): number {
  if (entry.kind === 'guidedSummary') {
    return 52
  }
  return estimateMessageHeight(entry.message)
}

const entryHeightMetrics = computed(() => {
  const cumulativeHeights: number[] = [0]
  for (const entry of visibleRenderableEntries.value) {
    const height = measuredMessageHeightById.value[entry.measureId] ?? estimateConversationEntryHeight(entry)
    cumulativeHeights.push(cumulativeHeights[cumulativeHeights.length - 1] + height + conversationItemGap.value)
  }

  const totalHeight = visibleRenderableEntries.value.length > 0
    ? Math.max((cumulativeHeights[cumulativeHeights.length - 1] ?? 0) - conversationItemGap.value, 0)
    : 0

  return {
    cumulativeHeights,
    totalHeight,
  }
})

const virtualizedMessageRange = computed(() => {
  if (!shouldVirtualizeMessages.value || visibleRenderableEntries.value.length === 0) {
    return {
      startIndex: 0,
      endIndex: visibleRenderableEntries.value.length,
    }
  }

  const { cumulativeHeights } = entryHeightMetrics.value

  const relativeScrollTop = Math.max(conversationScrollTop.value, 0)
  const viewportHeight = Math.max(conversationViewportHeight.value, 1)
  const visibleStart = Math.max(relativeScrollTop - VIRTUAL_OVERSCAN_PX, 0)
  const visibleEnd = relativeScrollTop + viewportHeight + VIRTUAL_OVERSCAN_PX

  let startIndex = 0
  while (
    startIndex < visibleRenderableEntries.value.length &&
    cumulativeHeights[startIndex + 1] < visibleStart
  ) {
    startIndex += 1
  }

  let endIndex = startIndex
  while (
    endIndex < visibleRenderableEntries.value.length &&
    cumulativeHeights[endIndex] < visibleEnd
  ) {
    endIndex += 1
  }

  endIndex = Math.min(visibleRenderableEntries.value.length, Math.max(endIndex + 1, startIndex + 1))

  return {
    startIndex,
    endIndex,
  }
})
const virtualizedMessageMetrics = computed(() => ({
  ...entryHeightMetrics.value,
  ...virtualizedMessageRange.value,
}))
const virtualizedMessages = computed<ConversationRenderEntry[]>(() => {
  const { startIndex, endIndex } = virtualizedMessageMetrics.value
  return visibleRenderableEntries.value.slice(startIndex, endIndex)
})
const virtualTopSpacerHeight = computed(() => {
  if (!shouldVirtualizeMessages.value) return 0
  return Math.max(
    (virtualizedMessageMetrics.value.cumulativeHeights[virtualizedMessageMetrics.value.startIndex] ?? 0) -
      conversationItemGap.value,
    0,
  )
})
const virtualBottomSpacerHeight = computed(() => {
  if (!shouldVirtualizeMessages.value) return 0
  const { cumulativeHeights, endIndex, totalHeight } = virtualizedMessageMetrics.value
  return Math.max(totalHeight - (cumulativeHeights[endIndex] ?? totalHeight), 0)
})

function measureObservedElementHeight(element: HTMLElement): number {
  return Math.max(Math.ceil(element.getBoundingClientRect().height), 1)
}

function captureVisibleConversationAnchor(): ScrollAnchorSnapshot | null {
  const container = conversationListRef.value
  if (!container) return null
  const containerRect = container.getBoundingClientRect()
  const measuredElements: Array<{
    element: HTMLElement
    measureId: string
  }> = []

  for (const entry of virtualizedMessages.value) {
    const measureId = entry.measureId
    const element = observedMessageElementsById.get(measureId)
    if (!element) continue
    measuredElements.push({
      element,
      measureId,
    })
  }

  for (const { element, measureId } of measuredElements) {
    const rect = element.getBoundingClientRect()
    if (rect.bottom <= containerRect.top + 1) continue
    if (rect.top >= containerRect.bottom) break

    return {
      measureId,
      viewportOffset: rect.top - containerRect.top,
    }
  }

  return null
}

function syncConversationViewport(container: HTMLElement): void {
  const viewportHeight = container.clientHeight
  conversationViewportHeight.value = viewportHeight
  conversationScrollTop.value = container.scrollTop
  if (lastGapMeasuredContainer === container && lastGapMeasuredViewportHeight === viewportHeight) {
    return
  }
  lastGapMeasuredContainer = container
  lastGapMeasuredViewportHeight = viewportHeight
  const style = window.getComputedStyle(container)
  const gapCandidate = style.rowGap || style.gap
  const parsedGap = Number.parseFloat(gapCandidate)
  conversationItemGap.value = Number.isFinite(parsedGap) ? parsedGap : 0
}

function updateMeasuredHeight(measureId: string, height: number): void {
  if (measuredMessageHeightById.value[measureId] === height) return
  measuredMessageHeightById.value = {
    ...measuredMessageHeightById.value,
    [measureId]: height,
  }
}

function observeMeasuredElement(
  measureId: string,
  element: HTMLElement,
  observedElementsById: Map<string, HTMLElement>,
): void {
  const previousElement = observedElementsById.get(measureId)
  if (previousElement && previousElement !== element) {
    itemResizeObserver?.unobserve(previousElement)
  }

  element.dataset.measureId = measureId
  observedElementsById.set(measureId, element)
  updateMeasuredHeight(measureId, measureObservedElementHeight(element))
  itemResizeObserver?.observe(element)
}

function disconnectMeasuredElement(
  measureId: string,
  observedElementsById: Map<string, HTMLElement>,
): void {
  const previousElement = observedElementsById.get(measureId)
  if (!previousElement) return
  itemResizeObserver?.unobserve(previousElement)
  observedElementsById.delete(measureId)
}

function pruneMeasuredHeightCache(
  keepIds: Set<string>,
  measuredHeightMap: Record<string, number>,
): Record<string, number> {
  let nextMeasuredHeightMap: Record<string, number> | null = null
  for (const [measureId, height] of Object.entries(measuredHeightMap)) {
    if (keepIds.has(measureId)) continue
    if (!nextMeasuredHeightMap) {
      nextMeasuredHeightMap = { ...measuredHeightMap }
    }
    delete nextMeasuredHeightMap[measureId]
  }
  return nextMeasuredHeightMap ?? measuredHeightMap
}

function pruneObservedElements(
  keepIds: Set<string>,
  observedElementsById: Map<string, HTMLElement>,
): void {
  for (const [measureId, element] of observedElementsById.entries()) {
    if (keepIds.has(measureId)) continue
    itemResizeObserver?.unobserve(element)
    observedElementsById.delete(measureId)
  }
}

function disconnectAllObservedElements(observedElementsById: Map<string, HTMLElement>): void {
  for (const element of observedElementsById.values()) {
    itemResizeObserver?.unobserve(element)
  }
  observedElementsById.clear()
}

function pruneMeasuredMessageHeights(entries: ConversationRenderEntry[]): void {
  const keepIds = new Set(entries.map((entry) => entry.measureId))
  measuredMessageHeightById.value = pruneMeasuredHeightCache(keepIds, measuredMessageHeightById.value)
  pruneObservedElements(keepIds, observedMessageElementsById)
}

function setMessageMeasureRef(messageId: string, element: MeasureRefTarget): void {
  const measuredElement = toMeasuredElement(element)
  if (!measuredElement) {
    disconnectMeasuredElement(messageId, observedMessageElementsById)
    return
  }
  observeMeasuredElement(messageId, measuredElement, observedMessageElementsById)
}

function toMeasuredElement(target: MeasureRefTarget): HTMLElement | null {
  if (target instanceof HTMLElement) return target
  if (target && '$el' in target) {
    const element = target.$el
    return element instanceof HTMLElement ? element : null
  }
  return null
}

function restoreScrollAnchor(snapshot: ScrollAnchorSnapshot): boolean {
  if (shouldLockToBottom()) return false
  const container = conversationListRef.value
  if (!container) return false

  const element = observedMessageElementsById.get(snapshot.measureId)
  if (!element) return false

  const containerRect = container.getBoundingClientRect()
  const nextViewportOffset = element.getBoundingClientRect().top - containerRect.top
  const scrollDelta = nextViewportOffset - snapshot.viewportOffset
  if (Math.abs(scrollDelta) < 1) {
    syncConversationViewport(container)
    return true
  }

  const maxScrollTop = Math.max(container.scrollHeight - container.clientHeight, 0)
  container.scrollTop = Math.min(Math.max(container.scrollTop + scrollDelta, 0), maxScrollTop)
  syncConversationViewport(container)
  scheduleEmitScrollState(container)
  return true
}

async function scheduleScrollAnchorRestore(snapshot: ScrollAnchorSnapshot | null): Promise<boolean> {
  if (!snapshot) return false
  await nextTick()
  if (scrollAnchorRestoreFrame) {
    cancelAnimationFrame(scrollAnchorRestoreFrame)
  }

  return await new Promise<boolean>((resolve) => {
    scrollAnchorRestoreFrame = requestAnimationFrame(() => {
      scrollAnchorRestoreFrame = 0
      resolve(restoreScrollAnchor(snapshot))
    })
  })
}

async function revealOlderMessages(): Promise<void> {
  if (!hasHiddenEarlierMessages.value || isRevealingOlderMessages.value) return
  const anchorSnapshot = captureVisibleConversationAnchor()
  isRevealingOlderMessages.value = true
  canAutoRevealOlderMessages.value = false
  visibleMessageStartIndex.value = Math.max(visibleMessageStartIndex.value - MESSAGE_WINDOW_SIZE, 0)
  await nextTick()
  await scheduleScrollAnchorRestore(anchorSnapshot)
  isRevealingOlderMessages.value = false
}

function onRevealOlderMessages(): void {
  void revealOlderMessages()
}

function estimateTextHeight(text: string, pixelsPerLine = 22, charsPerLine = 54): number {
  const normalized = text.trim()
  if (!normalized) return 0
  const lineCount = normalized.split(/\r?\n/u).length
  const wrappedLineCount = Math.ceil(normalized.length / charsPerLine)
  return Math.max(Math.max(lineCount, wrappedLineCount), 1) * pixelsPerLine
}

function estimateMessageHeight(message: UiMessage): number {
  if (isCommandMessage(message)) {
    const output = message.commandExecution?.aggregatedOutput ?? ''
    if (!isCommandExpanded(message)) return 68
    return Math.min(120 + estimateTextHeight(output, 16, 78), 520)
  }

  let height = message.role === 'user' ? 74 : 92
  height += Math.min(estimateTextHeight(message.text), 520)

  const attachmentCount = message.fileAttachments?.length ?? 0
  if (attachmentCount > 0) {
    height += 18 + attachmentCount * 32
  }

  const inlineImageCount = message.images?.length ?? 0
  const markdownImageCount = (message.text.match(/!\[[^\]]*\]\(([^)\n]+)\)/gu) ?? []).length
  const imageCount = inlineImageCount + markdownImageCount
  if (imageCount > 0) {
    height += imageCount * 196
  }

  if (canShowMessageActionBar(message)) {
    height += 30
  }

  return Math.min(Math.max(height, 72), 980)
}

type ParsedToolQuestion = {
  id: string
  header: string
  question: string
  isOther: boolean
  options: string[]
}

type McpElicitationFieldType = 'string' | 'number' | 'integer' | 'boolean'

type McpElicitationEnumOption = {
  value: string
  label: string
}

type ParsedMcpElicitationField = {
  id: string
  title: string
  description: string
  type: McpElicitationFieldType
  required: boolean
  defaultValue: string
  enumOptions: McpElicitationEnumOption[]
}

type ParsedMcpPermissionPrompt = {
  serverName: string
  toolName: string
}

type TextRange = {
  start: number
  end: number
}

const LIKELY_PROJECT_DIRECTORY_ROOTS = new Set([
  '.agents',
  '.codex',
  '.github',
  'app',
  'artifacts',
  'assets',
  'components',
  'configs',
  'dist',
  'docs',
  'pages',
  'packages',
  'public',
  'scripts',
  'skills',
  'src',
  'test',
  'tests',
  'tmp',
  '记忆',
])

function isFilePath(value: string): boolean {
  if (!value) return false
  if (value.endsWith('/') || value.endsWith('\\')) return false
  if (value.startsWith('file://')) return true
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(value)) return false

  const looksLikeUnixAbsolute = value.startsWith('/')
  const looksLikeWindowsAbsolute = /^[A-Za-z]:[\\/]/u.test(value)
  const looksLikeWindowsUnc = /^\\\\[^\\]+\\[^\\]+/u.test(value)
  const looksLikeRelative = value.startsWith('./') || value.startsWith('../') || value.startsWith('~/')
  if (looksLikeUnixAbsolute || looksLikeWindowsAbsolute || looksLikeWindowsUnc || looksLikeRelative) {
    return true
  }

  const normalized = normalizePathSeparators(value)
  if (!normalized.includes('/')) return false

  const segments = normalized.split('/').filter(Boolean)
  if (segments.length < 2) return false

  const basename = segments[segments.length - 1] ?? ''
  const hasLikelyFileExtension = /\.[A-Za-z0-9][A-Za-z0-9._-]{0,15}$/u.test(basename)
  if (hasLikelyFileExtension) return true

  return LIKELY_PROJECT_DIRECTORY_ROOTS.has(segments[0] ?? '')
}

function getBasename(pathValue: string): string {
  const normalized = pathValue.replace(/\\/gu, '/')
  const name = normalized.split('/').filter(Boolean).pop()
  return name || pathValue
}

function normalizePathSeparators(pathValue: string): string {
  return pathValue.replace(/\\/gu, '/')
}

function normalizeFileUrlToPath(pathValue: string): string {
  if (!pathValue.startsWith('file://')) return pathValue
  let stripped = pathValue.replace(/^file:\/\//u, '')
  try {
    stripped = decodeURIComponent(stripped)
  } catch {
    // Keep best-effort path if decoding fails.
  }
  if (/^\/[A-Za-z]:\//u.test(stripped)) {
    stripped = stripped.slice(1)
  }
  return stripped
}

function inferHomeFromCwd(cwd: string): string {
  const normalized = normalizePathSeparators(cwd)
  const userMatch = normalized.match(/^\/Users\/([^/]+)/u)
  if (userMatch) return `/Users/${userMatch[1]}`
  const homeMatch = normalized.match(/^\/home\/([^/]+)/u)
  if (homeMatch) return `/home/${homeMatch[1]}`
  return ''
}

function normalizePathDots(pathValue: string): string {
  const normalized = normalizePathSeparators(pathValue)
  if (!normalized) return normalized

  let root = ''
  let rest = normalized
  const driveMatch = rest.match(/^([A-Za-z]:)(\/.*)?$/u)
  if (driveMatch) {
    root = `${driveMatch[1]}/`
    rest = (driveMatch[2] ?? '').replace(/^\/+/u, '')
  } else if (rest.startsWith('/')) {
    root = '/'
    rest = rest.slice(1)
  }

  const parts = rest.split('/').filter(Boolean)
  const stack: string[] = []
  for (const part of parts) {
    if (part === '.') continue
    if (part === '..') {
      if (stack.length > 0) stack.pop()
      continue
    }
    stack.push(part)
  }

  const joined = stack.join('/')
  if (root) return `${root}${joined}`.replace(/\/+$/u, '') || root
  return joined || normalized
}

function resolveRelativePath(pathValue: string, cwd: string): string {
  const normalizedPath = normalizePathSeparators(normalizeFileUrlToPath(pathValue.trim()))
  if (!normalizedPath) return ''

  const looksLikeAbsolute = normalizedPath.startsWith('/') || /^[A-Za-z]:\//u.test(normalizedPath)
  if (looksLikeAbsolute) return normalizePathDots(normalizedPath)

  if (normalizedPath.startsWith('~/')) {
    const homeBase = inferHomeFromCwd(cwd)
    if (homeBase) {
      return normalizePathDots(`${homeBase}/${normalizedPath.slice(2)}`)
    }
  }

  const base = normalizePathSeparators(cwd.trim())
  if (!base) return normalizePathDots(normalizedPath)
  return normalizePathDots(`${base.replace(/\/+$/u, '')}/${normalizedPath}`)
}

function parseFileReference(value: string): { path: string; line: number | null } | null {
  if (!value) return null

  let pathValue = value.trim()
  const wrapped = trimLinkWrappers(pathValue)
  pathValue = wrapped.core.trim()
  let line: number | null = null

  const hashLineMatch = pathValue.match(/^(.*)#L(\d+)(?:C\d+)?$/u)
  if (hashLineMatch) {
    pathValue = hashLineMatch[1]
    line = Number(hashLineMatch[2])
  } else {
    const colonLineMatch = pathValue.match(/^(.*):(\d+)(?::\d+)?$/u)
    if (colonLineMatch) {
      pathValue = colonLineMatch[1]
      line = Number(colonLineMatch[2])
    }
  }

  pathValue = normalizeFileUrlToPath(pathValue)
  if (!isFilePath(pathValue)) return null
  return { path: pathValue, line }
}

const LEADING_LINK_WRAPPER_PATTERN = /^['"`“‘<(\[{（【《「『]/u
const TRAILING_LINK_WRAPPER_PATTERN = /['"`”’>)\]}）】》」』]$/u
const TRAILING_LINK_PUNCTUATION_PATTERN = /[.,;:!?，。；：！？]$/u
const TRAILING_LINK_DELIMITER_PAIRS = [
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
  ['<', '>'],
  ['（', '）'],
  ['【', '】'],
  ['《', '》'],
  ['「', '」'],
  ['『', '』'],
] as const

function trimLinkWrappers(value: string): { core: string; leading: string; trailing: string } {
  let core = value
  let leading = ''
  let trailing = ''

  while (LEADING_LINK_WRAPPER_PATTERN.test(core)) {
    leading += core[0]
    core = core.slice(1)
  }
  while (TRAILING_LINK_WRAPPER_PATTERN.test(core)) {
    trailing = core.slice(-1) + trailing
    core = core.slice(0, -1)
  }

  return { core, leading, trailing }
}

function countCharacter(value: string, character: string): number {
  let count = 0
  for (const part of value) {
    if (part === character) count += 1
  }
  return count
}

function hasUnbalancedTrailingDelimiter(value: string): boolean {
  if (!value) return false
  const lastCharacter = value.slice(-1)
  for (const [opening, closing] of TRAILING_LINK_DELIMITER_PAIRS) {
    if (lastCharacter !== closing) continue
    return countCharacter(value, closing) > countCharacter(value, opening)
  }
  return false
}

function splitTrailingLinkSuffix(value: string): { core: string; trailing: string } {
  let core = value
  let trailing = ''

  while (core.length > 0) {
    if (TRAILING_LINK_PUNCTUATION_PATTERN.test(core) || hasUnbalancedTrailingDelimiter(core)) {
      trailing = core.slice(-1) + trailing
      core = core.slice(0, -1)
      continue
    }
    break
  }

  return { core, trailing }
}

function toExternalHref(value: string): string | null {
  const normalized = value.trim()
  if (!normalized) return null
  if (/^https?:\/\//iu.test(normalized)) return normalized
  if (/^mailto:/iu.test(normalized)) return normalized
  if (/^www\./iu.test(normalized)) return `https://${normalized}`
  return null
}

function parseMarkdownLinkToken(value: string): { label: string; target: string } | null {
  const trimmed = value.trim()
  const parsed = readMarkdownLinkAt(trimmed, 0)
  if (!parsed || parsed.end !== trimmed.length) return null
  const labelRaw = parsed.label.trim()
  const targetRaw = parsed.target.trim()
  const label = trimLinkWrappers(labelRaw).core.trim() || labelRaw
  const target = trimLinkWrappers(targetRaw).core.trim()
  if (!target) return null
  return { label, target }
}

function readMarkdownLinkAt(
  text: string,
  startIndex: number,
): { label: string; target: string; end: number } | null {
  if (text[startIndex] !== '[') return null
  const closeBracket = text.indexOf('](', startIndex + 1)
  if (closeBracket < 0) return null

  const label = text.slice(startIndex + 1, closeBracket)
  if (!label || label.includes('\n')) return null

  let cursor = closeBracket + 2
  let depth = 1
  while (cursor < text.length) {
    const char = text[cursor]
    if (char === '\n') return null
    if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth === 0) {
        const target = text.slice(closeBracket + 2, cursor)
        if (!target.trim()) return null
        return { label, target, end: cursor + 1 }
      }
    }
    cursor += 1
  }

  return null
}

function splitPlainTextByLinks(text: string): InlineSegment[] {
  const segments: InlineSegment[] = []
  const pattern = /https?:\/\/\S+|mailto:\S+|www\.\S+|file:\/\/\S+|\S*[\\/]\S+/gu
  let cursor = 0

  for (const match of text.matchAll(pattern)) {
    if (typeof match.index !== 'number') continue
    const start = match.index
    const end = start + match[0].length

    if (start > cursor) {
      segments.push({ kind: 'text', value: text.slice(cursor, start) })
    }

    let token = match[0]
    const trailingSplit = splitTrailingLinkSuffix(token)
    token = trailingSplit.core
    const wrapped = trimLinkWrappers(token)
    token = wrapped.core
    const leading = wrapped.leading
    const trailing = wrapped.trailing + trailingSplit.trailing

    if (leading) {
      segments.push({ kind: 'text', value: leading })
    }

    if (token.startsWith('**') && token.endsWith('**') && token.length > 4) {
      segments.push({ kind: 'bold', value: token.slice(2, -2) })
      if (trailing) {
        segments.push({ kind: 'text', value: trailing })
      }
    } else {
      const externalHref = toExternalHref(token)
      if (externalHref) {
        segments.push({ kind: 'url', value: token, href: externalHref })
        if (trailing) {
          segments.push({ kind: 'text', value: trailing })
        }
      } else {
        const ref = parseFileReference(token)
        if (ref) {
          segments.push({
            kind: 'file',
            value: token,
            path: ref.path,
            displayPath: token,
            downloadName: getBasename(ref.path),
          })
          if (trailing) {
            segments.push({ kind: 'text', value: trailing })
          }
        } else {
          segments.push({ kind: 'text', value: match[0] })
        }
      }
    }

    cursor = end
  }

  if (cursor < text.length) {
    segments.push({ kind: 'text', value: text.slice(cursor) })
  }

  return applyBoldMarkersAcrossTextSegments(segments)
}

function pushMarkdownLinkSegment(
  segments: InlineSegment[],
  label: string,
  target: string,
  fallbackText: string,
): boolean {
  const externalHref = toExternalHref(target)
  if (externalHref) {
    segments.push({ kind: 'url', value: label || target, href: externalHref })
    return true
  }

  const ref = parseFileReference(target)
  if (ref) {
    segments.push({
      kind: 'file',
      value: target,
      path: ref.path,
      displayPath: label || target,
      downloadName: getBasename(ref.path),
    })
    return true
  }

  if (fallbackText) {
    segments.push({ kind: 'text', value: fallbackText })
    return true
  }

  return false
}

function applyBoldMarkersAcrossTextSegments(segments: InlineSegment[]): InlineSegment[] {
  const output: InlineSegment[] = []
  let inBold = false
  let boldBuffer = ''

  const pushText = (value: string): void => {
    if (!value) return
    output.push({ kind: 'text', value })
  }

  for (const segment of segments) {
    if (segment.kind !== 'text') {
      if (inBold) {
        pushText(`**${boldBuffer}`)
        inBold = false
        boldBuffer = ''
      }
      output.push(segment)
      continue
    }

    let remaining = segment.value
    while (remaining.length > 0) {
      const markerIndex = remaining.indexOf('**')
      if (markerIndex < 0) {
        if (inBold) boldBuffer += remaining
        else pushText(remaining)
        break
      }

      const before = remaining.slice(0, markerIndex)
      if (inBold) boldBuffer += before
      else pushText(before)

      remaining = remaining.slice(markerIndex + 2)
      if (inBold) {
        if (boldBuffer.length > 0) output.push({ kind: 'bold', value: boldBuffer })
        else pushText('****')
        boldBuffer = ''
        inBold = false
      } else {
        inBold = true
      }
    }
  }

  if (inBold) {
    pushText(`**${boldBuffer}`)
  }

  return output
}
function splitTextByFileUrls(text: string): InlineSegment[] {
  const segments: InlineSegment[] = []
  let cursor = 0

  while (cursor < text.length) {
    const openBracket = text.indexOf('[', cursor)
    if (openBracket < 0) break
    const markdownToken = readMarkdownLinkAt(text, openBracket)
    if (!markdownToken) {
      cursor = openBracket + 1
      continue
    }

    if (openBracket > cursor) {
      segments.push(...splitPlainTextByLinks(text.slice(cursor, openBracket)))
    }

    const label = trimLinkWrappers(markdownToken.label.trim()).core.trim() || markdownToken.label.trim()
    const target = trimLinkWrappers(markdownToken.target.trim()).core.trim()
    pushMarkdownLinkSegment(segments, label, target, text.slice(openBracket, markdownToken.end))

    cursor = markdownToken.end
  }

  if (cursor < text.length) {
    segments.push(...splitPlainTextByLinks(text.slice(cursor)))
  }

  return segments
}

function collectMarkdownLinkRanges(text: string): TextRange[] {
  const ranges: TextRange[] = []
  let cursor = 0

  while (cursor < text.length) {
    const openBracket = text.indexOf('[', cursor)
    if (openBracket < 0) break
    const markdownToken = readMarkdownLinkAt(text, openBracket)
    if (!markdownToken) {
      cursor = openBracket + 1
      continue
    }
    ranges.push({ start: openBracket, end: markdownToken.end })
    cursor = markdownToken.end
  }

  return ranges
}

function isIndexInsideRanges(index: number, ranges: TextRange[]): boolean {
  for (const range of ranges) {
    if (index < range.start) return false
    if (index < range.end) return true
  }
  return false
}

function parseInlineSegments(text: string): InlineSegment[] {
  if (!text.includes('`')) return splitTextByFileUrls(text)
  const markdownLinkRanges = collectMarkdownLinkRanges(text)

  const segments: InlineSegment[] = []
  let cursor = 0
  let textStart = 0

  while (cursor < text.length) {
    if (text[cursor] !== '`' || isIndexInsideRanges(cursor, markdownLinkRanges)) {
      cursor += 1
      continue
    }

    let openLength = 1
    while (cursor + openLength < text.length && text[cursor + openLength] === '`') {
      openLength += 1
    }
    const delimiter = '`'.repeat(openLength)

    let searchFrom = cursor + openLength
    let closingStart = -1
    while (searchFrom < text.length) {
      const candidate = text.indexOf(delimiter, searchFrom)
      if (candidate < 0) break
      if (isIndexInsideRanges(candidate, markdownLinkRanges)) {
        searchFrom = candidate + 1
        continue
      }

      const hasBacktickBefore = candidate > 0 && text[candidate - 1] === '`'
      const hasBacktickAfter =
        candidate + openLength < text.length && text[candidate + openLength] === '`'
      const hasNewLineInside = text.slice(cursor + openLength, candidate).includes('\n')

      if (!hasBacktickBefore && !hasBacktickAfter && !hasNewLineInside) {
        closingStart = candidate
        break
      }
      searchFrom = candidate + 1
    }

    if (closingStart < 0) {
      cursor += openLength
      continue
    }

    if (cursor > textStart) {
      segments.push(...splitTextByFileUrls(text.slice(textStart, cursor)))
    }

    const token = text.slice(cursor + openLength, closingStart)
    if (token.length > 0) {
      const markdownLink = parseMarkdownLinkToken(token)
      if (markdownLink) {
        const pushed = pushMarkdownLinkSegment(segments, markdownLink.label, markdownLink.target, '')
        if (!pushed) {
          segments.push({ kind: 'code', value: token })
        }
      } else {
        const fileReference = parseFileReference(token)
        if (fileReference) {
          const displayPath = fileReference.line
            ? `${fileReference.path}:${String(fileReference.line)}`
            : fileReference.path
          segments.push({
            kind: 'file',
            value: token,
            path: fileReference.path,
            displayPath,
            downloadName: getBasename(fileReference.path),
          })
        } else {
          segments.push({ kind: 'code', value: token })
        }
      }
    } else {
      segments.push({ kind: 'text', value: `${delimiter}${delimiter}` })
    }

    cursor = closingStart + openLength
    textStart = cursor
  }

  if (textStart < text.length) {
    segments.push(...splitTextByFileUrls(text.slice(textStart)))
  }

  return segments
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

  const looksLikeUnixAbsolute = normalized.startsWith('/')
  const looksLikeWindowsAbsolute = /^[A-Za-z]:[\\/]/u.test(normalized)
  if (looksLikeUnixAbsolute || looksLikeWindowsAbsolute) {
    return `/codex-local-image?path=${encodeURIComponent(normalized)}`
  }

  return normalized
}

function toBrowseUrl(pathValue: string): string {
  const normalized = pathValue.trim()
  if (!normalized) return '#'
  const looksLikeAbsolutePath = (candidate: string): boolean => (
    candidate.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(candidate)
  )

  const parsed = parseFileReference(normalized)
  const candidatePath = parsed?.path ?? normalized
  const resolved = resolveRelativePath(candidatePath, props.cwd)

  if (looksLikeAbsolutePath(resolved)) {
    const normalizedResolved = resolved.startsWith('/') ? resolved : `/${resolved}`
    return `/codex-local-browse${encodeURI(normalizedResolved)}`
  }

  return '#'
}

function toEditUrl(pathValue: string): string {
  const normalized = pathValue.trim()
  if (!normalized) return '#'
  const parsed = parseFileReference(normalized)
  const candidatePath = parsed?.path ?? normalized
  const resolved = resolveRelativePath(candidatePath, props.cwd)
  const looksLikeAbsolutePath = (candidate: string): boolean => (
    candidate.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(candidate)
  )
  if (!looksLikeAbsolutePath(resolved)) return '#'
  const normalizedResolved = resolved.startsWith('/') ? resolved : `/${resolved}`
  return `/codex-local-edit${encodeURI(normalizedResolved)}`
}

const fileLinkContextMenuStyle = computed(() => ({
  left: `${String(fileLinkContextMenuX.value)}px`,
  top: `${String(fileLinkContextMenuY.value)}px`,
}))

function onFileLinkContextMenu(event: MouseEvent, pathValue: string): void {
  const browseUrl = toBrowseUrl(pathValue)
  if (browseUrl === '#') return
  fileLinkContextBrowseUrl.value = browseUrl
  const editUrl = toEditUrl(pathValue)
  fileLinkContextEditUrl.value = editUrl === '#' ? '' : editUrl
  fileLinkContextMenuX.value = event.clientX
  fileLinkContextMenuY.value = event.clientY
  isFileLinkContextMenuVisible.value = true
}

function onUrlLinkContextMenu(event: MouseEvent, href: string): void {
  const normalizedHref = href.trim()
  if (!normalizedHref) return
  fileLinkContextBrowseUrl.value = normalizedHref
  fileLinkContextEditUrl.value = ''
  fileLinkContextMenuX.value = event.clientX
  fileLinkContextMenuY.value = event.clientY
  isFileLinkContextMenuVisible.value = true
}

function isMobileShellExternalUrl(href: string): boolean {
  return /^(https?:|mailto:|tel:)/iu.test(href.trim())
}

async function openHyperlink(href: string): Promise<void> {
  const normalizedHref = href.trim()
  if (!normalizedHref || normalizedHref === '#') return

  if (isNativeAndroidShell() && normalizedHref.startsWith('/')) {
    window.location.href = normalizedHref
    return
  }

  if (isNativeAndroidShell() && isMobileShellExternalUrl(normalizedHref)) {
    try {
      await openMobileShellUrl(normalizedHref)
      return
    } catch {
      // Fall through to the browser fallback for non-standard Android WebView setups.
    }
  }

  window.open(normalizedHref, '_blank', 'noopener,noreferrer')
}

function onHyperlinkClick(event: MouseEvent, href: string): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  void openHyperlink(href)
}

function closeFileLinkContextMenu(): void {
  if (!isFileLinkContextMenuVisible.value) return
  isFileLinkContextMenuVisible.value = false
}

function openFileLinkContextBrowse(): void {
  const href = fileLinkContextBrowseUrl.value
  closeFileLinkContextMenu()
  if (!href || href === '#') return
  void openHyperlink(href)
}

function openFileLinkContextEdit(): void {
  const href = fileLinkContextEditUrl.value
  closeFileLinkContextMenu()
  if (!href || href === '#') return
  void openHyperlink(href)
}

async function copyFileLinkContextLink(): Promise<void> {
  const href = fileLinkContextBrowseUrl.value
  closeFileLinkContextMenu()
  if (!href || href === '#') return
  try {
    await navigator.clipboard.writeText(href)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = href
    textarea.setAttribute('readonly', 'true')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
  }
}

function onWindowPointerDownForFileLinkContextMenu(event: PointerEvent): void {
  if (!isFileLinkContextMenuVisible.value) return
  const menu = fileLinkContextMenuRef.value
  if (!menu) {
    closeFileLinkContextMenu()
    return
  }
  const target = event.target
  if (target instanceof Node && menu.contains(target)) return
  closeFileLinkContextMenu()
}

function onWindowBlurForFileLinkContextMenu(): void {
  closeFileLinkContextMenu()
}

function onWindowKeydownForFileLinkContextMenu(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  closeFileLinkContextMenu()
}

function parseMessageBlocks(text: string): MessageBlock[] {
  if (!text.includes('![') || !text.includes('](')) {
    return [{ kind: 'text', value: text }]
  }

  const blocks: MessageBlock[] = []
  const imagePattern = /!\[([^\]]*)\]\(([^)\n]+)\)/gu
  let cursor = 0

  for (const match of text.matchAll(imagePattern)) {
    const [fullMatch, altRaw, urlRaw] = match
    if (typeof match.index !== 'number') continue

    const start = match.index
    const end = start + fullMatch.length
    const imageUrl = toRenderableImageUrl(urlRaw.trim())
    if (!imageUrl) continue

    if (start > cursor) {
      blocks.push({ kind: 'text', value: text.slice(cursor, start) })
    }

    blocks.push({ kind: 'image', url: imageUrl, alt: altRaw.trim(), markdown: fullMatch })
    cursor = end
  }

  if (cursor < text.length) {
    blocks.push({ kind: 'text', value: text.slice(cursor) })
  }

  return blocks.length > 0 ? blocks : [{ kind: 'text', value: text }]
}

function getPreparedMessageBlocks(message: UiMessage): PreparedMessageBlock[] {
  const cached = preparedMessageBlocksById.get(message.id)
  if (cached && cached.text === message.text) {
    return cached.blocks
  }

  const blocks = parseMessageBlocks(message.text).map<PreparedMessageBlock>((block) => {
    if (block.kind === 'text') {
      return {
        kind: 'text',
        value: block.value,
        segments: parseInlineSegments(block.value),
      }
    }
    return block
  })

  preparedMessageBlocksById.set(message.id, { text: message.text, blocks })
  return blocks
}

function prunePreparedMessageBlockCache(messages: UiMessage[]): void {
  const keepIds = new Set(messages.map((message) => message.id))
  for (const messageId of preparedMessageBlocksById.keys()) {
    if (!keepIds.has(messageId)) {
      preparedMessageBlocksById.delete(messageId)
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function formatIsoTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString()
}

function readRequestReason(request: UiServerRequest): string {
  const params = asRecord(request.params)
  const reason = params?.reason
  return typeof reason === 'string' ? reason.trim() : ''
}

function isMcpElicitationRequest(method: string): boolean {
  const normalized = method.trim().toLowerCase()
  return (
    normalized === 'mcpserver/elicitation/request' ||
    normalized === 'mcpserver/elication/request' ||
    normalized === 'elicitation/create'
  )
}

function isInputLikeServerRequest(method: string): boolean {
  return method === 'item/tool/requestUserInput' || isMcpElicitationRequest(method)
}

function looksLikeMcpElicitationPayload(payload: Record<string, unknown> | null): boolean {
  if (!payload) return false
  return (
    typeof payload.message === 'string' ||
    typeof payload.mode === 'string' ||
    typeof payload.url === 'string' ||
    asRecord(payload.requestedSchema) !== null ||
    asRecord(payload.schema) !== null ||
    asRecord(payload.inputSchema) !== null ||
    asRecord(payload.jsonSchema) !== null
  )
}

function readMcpElicitationPayload(request: UiServerRequest): Record<string, unknown> | null {
  const params = asRecord(request.params)
  if (!params) return null
  const requestParams = asRecord(asRecord(params.request)?.params)
  if (looksLikeMcpElicitationPayload(requestParams)) return requestParams
  const elicitationParams = asRecord(asRecord(params.elicitation)?.params)
  if (looksLikeMcpElicitationPayload(elicitationParams)) return elicitationParams
  const nestedParams = asRecord(params.params)
  if (looksLikeMcpElicitationPayload(nestedParams)) return nestedParams
  return params
}

function readMcpElicitationIntro(request: UiServerRequest): string {
  const payload = readMcpElicitationPayload(request)
  const message = payload?.message
  if (typeof message === 'string' && message.trim().length > 0) return message.trim()
  const reason = readRequestReason(request)
  if (reason) return reason
  return 'MCP 服务需要你补充信息，提交后 Codex 会继续执行。'
}

function readMcpPermissionPrompt(request: UiServerRequest): ParsedMcpPermissionPrompt | null {
  const payload = readMcpElicitationPayload(request)
  const message = readMcpElicitationIntro(request)
  const serverNameFromPayload = typeof payload?.serverName === 'string'
    ? payload.serverName.trim()
    : typeof payload?.server === 'string'
      ? payload.server.trim()
      : ''
  const toolNameFromPayload = typeof payload?.toolName === 'string'
    ? payload.toolName.trim()
    : typeof payload?.tool === 'string'
      ? payload.tool.trim()
      : ''

  const promptMatch = message.match(/^Allow\s+the\s+(.+?)\s+MCP\s+server\s+to\s+run\s+tool\s+["“]([^"”]+)["”]\??$/iu)
  const serverName = (promptMatch?.[1] ?? serverNameFromPayload).trim()
  const toolName = (promptMatch?.[2] ?? toolNameFromPayload).trim()

  if (!serverName || !toolName) return null
  return {
    serverName,
    toolName,
  }
}

function isMcpPermissionElicitationRequest(request: UiServerRequest): boolean {
  return isMcpElicitationRequest(request.method) && readMcpPermissionPrompt(request) !== null
}

function readMcpPermissionServerName(request: UiServerRequest): string {
  return readMcpPermissionPrompt(request)?.serverName || '未知 MCP 服务'
}

function readMcpPermissionToolName(request: UiServerRequest): string {
  return readMcpPermissionPrompt(request)?.toolName || '未知工具'
}

function readMcpPermissionTitle(request: UiServerRequest): string {
  const toolName = readMcpPermissionToolName(request)
  if (toolName.startsWith('browser_')) return '浏览器自动化请求权限'
  return 'MCP 工具请求权限'
}

function readMcpPermissionSummary(request: UiServerRequest): string {
  const prompt = readMcpPermissionPrompt(request)
  if (!prompt) return '外部 MCP 服务正在请求运行工具。'
  return `${prompt.serverName} 想运行 ${prompt.toolName}，用于继续当前任务。`
}

function readMcpElicitationUrl(request: UiServerRequest): string {
  const payload = readMcpElicitationPayload(request)
  const url = payload?.url
  return typeof url === 'string' && /^https?:\/\//iu.test(url.trim()) ? url.trim() : ''
}

function readMcpElicitationSchema(request: UiServerRequest): Record<string, unknown> | null {
  const payload = readMcpElicitationPayload(request)
  if (!payload) return null
  return (
    asRecord(payload.requestedSchema) ||
    asRecord(payload.schema) ||
    asRecord(payload.inputSchema) ||
    asRecord(payload.jsonSchema)
  )
}

function readMcpFieldType(value: unknown): McpElicitationFieldType {
  const rawType = Array.isArray(value) ? value.find((item) => item !== 'null') : value
  if (rawType === 'number') return 'number'
  if (rawType === 'integer') return 'integer'
  if (rawType === 'boolean') return 'boolean'
  return 'string'
}

function readMcpElicitationFields(request: UiServerRequest): ParsedMcpElicitationField[] {
  const schema = readMcpElicitationSchema(request)
  const properties = asRecord(schema?.properties)
  if (!properties) return []

  const requiredIds = new Set(
    Array.isArray(schema?.required)
      ? schema.required.filter((value): value is string => typeof value === 'string')
      : [],
  )

  return Object.entries(properties).flatMap(([id, rawField]) => {
    const field = asRecord(rawField)
    if (!field) return []

    const enumValues = Array.isArray(field.enum)
      ? field.enum.filter((value) => ['string', 'number', 'boolean'].includes(typeof value))
      : []
    const enumNames = Array.isArray(field.enumNames)
      ? field.enumNames.filter((value): value is string => typeof value === 'string')
      : []

    const enumOptions = enumValues.map<McpElicitationEnumOption>((value, index) => ({
      value: String(value),
      label: enumNames[index] || String(value),
    }))

    const title = typeof field.title === 'string' && field.title.trim().length > 0
      ? field.title.trim()
      : id
    const description = typeof field.description === 'string' ? field.description.trim() : ''
    const defaultValue = ['string', 'number', 'boolean'].includes(typeof field.default)
      ? String(field.default)
      : ''

    return [{
      id,
      title,
      description,
      type: readMcpFieldType(field.type),
      required: requiredIds.has(id),
      defaultValue,
      enumOptions,
    }]
  })
}

function toolQuestionKey(requestId: number, questionId: string): string {
  return `${String(requestId)}:${questionId}`
}

function readToolQuestions(request: UiServerRequest): ParsedToolQuestion[] {
  const params = asRecord(request.params)
  const questions = Array.isArray(params?.questions) ? params.questions : []
  const parsed: ParsedToolQuestion[] = []

  for (const row of questions) {
    const question = asRecord(row)
    if (!question) continue
    const id = typeof question.id === 'string' ? question.id : ''
    if (!id) continue

    const options = Array.isArray(question.options)
      ? question.options
        .map((option) => asRecord(option))
        .map((option) => option?.label)
        .filter((option): option is string => typeof option === 'string' && option.length > 0)
      : []

    parsed.push({
      id,
      header: typeof question.header === 'string' ? question.header : '',
      question: typeof question.question === 'string' ? question.question : '',
      isOther: question.isOther === true,
      options,
    })
  }

  return parsed
}

function readQuestionAnswer(requestId: number, questionId: string, fallback: string): string {
  const key = toolQuestionKey(requestId, questionId)
  const saved = toolQuestionAnswers.value[key]
  if (typeof saved === 'string' && saved.length > 0) return saved
  return fallback
}

function readQuestionOtherAnswer(requestId: number, questionId: string): string {
  const key = toolQuestionKey(requestId, questionId)
  return toolQuestionOtherAnswers.value[key] ?? ''
}

function onQuestionAnswerChange(requestId: number, questionId: string, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  const key = toolQuestionKey(requestId, questionId)
  toolQuestionAnswers.value = {
    ...toolQuestionAnswers.value,
    [key]: target.value,
  }
}

function onQuestionOtherAnswerInput(requestId: number, questionId: string, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const key = toolQuestionKey(requestId, questionId)
  toolQuestionOtherAnswers.value = {
    ...toolQuestionOtherAnswers.value,
    [key]: target.value,
  }
}

function mcpElicitationKey(requestId: number, fieldId: string): string {
  return `${String(requestId)}:mcp:${fieldId}`
}

function readMcpElicitationAnswer(requestId: number, field: ParsedMcpElicitationField): string {
  const saved = mcpElicitationAnswers.value[mcpElicitationKey(requestId, field.id)]
  if (typeof saved === 'string') return saved
  if (typeof saved === 'boolean') return saved ? 'true' : 'false'
  if (field.defaultValue) return field.defaultValue
  const firstOption = field.enumOptions[0]
  return field.required && firstOption ? firstOption.value : ''
}

function readMcpElicitationBooleanAnswer(requestId: number, field: ParsedMcpElicitationField): boolean {
  const saved = mcpElicitationAnswers.value[mcpElicitationKey(requestId, field.id)]
  if (typeof saved === 'boolean') return saved
  if (typeof saved === 'string') return saved === 'true'
  return field.defaultValue === 'true'
}

function onMcpElicitationAnswerChange(requestId: number, fieldId: string, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement) && !(target instanceof HTMLTextAreaElement)) return
  mcpElicitationAnswers.value = {
    ...mcpElicitationAnswers.value,
    [mcpElicitationKey(requestId, fieldId)]: target.value,
  }
}

function onMcpElicitationBooleanAnswerChange(requestId: number, fieldId: string, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  mcpElicitationAnswers.value = {
    ...mcpElicitationAnswers.value,
    [mcpElicitationKey(requestId, fieldId)]: target.checked,
  }
}

function readMcpElicitationFallbackAnswer(requestId: number): string {
  const saved = mcpElicitationAnswers.value[mcpElicitationKey(requestId, '__freeform')]
  return typeof saved === 'string' ? saved : ''
}

function onMcpElicitationFallbackInput(requestId: number, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLTextAreaElement)) return
  mcpElicitationAnswers.value = {
    ...mcpElicitationAnswers.value,
    [mcpElicitationKey(requestId, '__freeform')]: target.value,
  }
}

function coerceMcpElicitationValue(field: ParsedMcpElicitationField, rawValue: string | boolean): string | number | boolean {
  if (field.type === 'boolean') {
    if (typeof rawValue === 'boolean') return rawValue
    return rawValue === 'true'
  }

  const text = String(rawValue).trim()
  if (field.type === 'number' || field.type === 'integer') {
    const numericValue = Number(text)
    if (Number.isFinite(numericValue)) {
      return field.type === 'integer' ? Math.trunc(numericValue) : numericValue
    }
  }

  return text
}

function buildMcpElicitationContent(request: UiServerRequest): Record<string, string | number | boolean> {
  const content: Record<string, string | number | boolean> = {}
  const fields = readMcpElicitationFields(request)

  for (const field of fields) {
    if (field.type === 'boolean') {
      content[field.id] = readMcpElicitationBooleanAnswer(request.id, field)
      continue
    }

    const rawValue = readMcpElicitationAnswer(request.id, field)
    if (!field.required && rawValue.trim().length === 0) continue
    content[field.id] = coerceMcpElicitationValue(field, rawValue)
  }

  if (fields.length === 0) {
    const freeform = readMcpElicitationFallbackAnswer(request.id).trim()
    if (freeform) {
      content.response = freeform
    }
  }

  return content
}

function onRespondApproval(requestId: number, decision: 'accept' | 'acceptForSession' | 'decline' | 'cancel'): void {
  emit('respondServerRequest', {
    id: requestId,
    result: { decision },
  })
}

function onRespondToolRequestUserInput(request: UiServerRequest): void {
  const questions = readToolQuestions(request)
  const answers: Record<string, { answers: string[] }> = {}

  for (const question of questions) {
    const selected = readQuestionAnswer(request.id, question.id, question.options[0] || '')
    const other = readQuestionOtherAnswer(request.id, question.id).trim()
    const values = [selected, other].map((value) => value.trim()).filter((value) => value.length > 0)
    answers[question.id] = { answers: values }
  }

  emit('respondServerRequest', {
    id: request.id,
    result: { answers },
  })
}

function onRespondMcpElicitation(request: UiServerRequest, action: 'accept' | 'decline' | 'cancel'): void {
  const result: Record<string, unknown> = { action }
  if (action === 'accept' && !readMcpElicitationUrl(request)) {
    result.content = buildMcpElicitationContent(request)
  }

  emit('respondServerRequest', {
    id: request.id,
    result,
  })
}

function onRespondToolCallFailure(requestId: number): void {
  emit('respondServerRequest', {
    id: requestId,
    result: {
      success: false,
      contentItems: [
        {
          type: 'inputText',
          text: '工具调用已被 codex-web-local 界面拒绝。',
        },
      ],
    },
  })
}

function onRespondToolCallSuccess(requestId: number): void {
  emit('respondServerRequest', {
    id: requestId,
    result: {
      success: true,
      contentItems: [],
    },
  })
}

function onRespondEmptyResult(requestId: number): void {
  emit('respondServerRequest', {
    id: requestId,
    result: {},
  })
}

function onRejectUnknownRequest(requestId: number): void {
  emit('respondServerRequest', {
    id: requestId,
    error: {
      code: -32000,
      message: '请求已被 codex-web-local 界面拒绝。',
    },
  })
}

function canRollbackMessage(message: UiMessage): boolean {
  if (message.role !== 'user' && message.role !== 'assistant') return false
  if (typeof message.turnIndex !== 'number') return false
  if (props.isTurnInProgress || props.isRollingBack) return false
  return true
}

function canFavoriteMessage(message: UiMessage): boolean {
  if (message.role !== 'user' && message.role !== 'assistant') return false
  return message.text.trim().length > 0
}

function isFavoriteMessage(message: UiMessage): boolean {
  return favoriteMessageIdSet.value.has(message.id)
}

function canCopyMessage(message: UiMessage): boolean {
  if (message.role !== 'user' && message.role !== 'assistant') return false
  return message.text.trim().length > 0
}

function canShowMessageActions(message: UiMessage): boolean {
  return canCopyMessage(message) || canRollbackMessage(message)
}

function canShowMessageActionBar(message: UiMessage): boolean {
  return canFavoriteMessage(message) || canShowMessageActions(message)
}

function isMessageActionBarActive(message: UiMessage): boolean {
  return activeMessageActionId.value === message.id
}

function onMessageCardActivate(message: UiMessage): void {
  if (!canShowMessageActionBar(message)) return
  activeMessageActionId.value = message.id
}

function onToggleFavorite(message: UiMessage): void {
  if (!canFavoriteMessage(message)) return
  emit('toggleFavorite', message)
}

function findPreviousVisibleMessage(index: number): UiMessage | null {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = visibleMessageEntries.value[cursor]
    if (!candidate) continue
    return candidate.message
  }
  return null
}

async function onToggleGuidedTurn(turnIndex: number): Promise<void> {
  const anchorSnapshot = !shouldLockToBottom() ? captureVisibleConversationAnchor() : null
  const next = new Set(expandedGuidedTurnIndexes.value)
  if (next.has(turnIndex)) next.delete(turnIndex)
  else next.add(turnIndex)
  expandedGuidedTurnIndexes.value = next

  await nextTick()
  if (shouldLockToBottom()) {
    scheduleBottomLock(2)
    return
  }
  if (anchorSnapshot) {
    await scheduleScrollAnchorRestore(anchorSnapshot)
  }
}

function messageRoleLabel(message: UiMessage, index: number): string {
  const previousMessage = findPreviousVisibleMessage(index)
  if (
    previousMessage &&
    previousMessage.role === message.role &&
    previousMessage.messageType !== 'worked' &&
    message.messageType !== 'worked'
  ) {
    return ''
  }

  if (message.role === 'user') return '你'
  if (message.role === 'assistant') return 'Codex'
  if (message.role === 'system') return '系统'
  return ''
}

function requestMethodLabel(method: string): string {
  switch (method) {
    case 'item/commandExecution/requestApproval':
      return '命令执行需要批准'
    case 'item/fileChange/requestApproval':
      return '文件变更需要批准'
    case 'item/tool/requestUserInput':
      return '需要补充输入'
    case 'item/tool/call':
      return '工具调用等待处理'
    default:
      if (isMcpElicitationRequest(method)) return 'MCP 服务需要补充信息'
      return method
  }
}

function requestTitleLabel(request: UiServerRequest): string {
  if (isMcpPermissionElicitationRequest(request)) return 'MCP 工具权限确认'
  return requestMethodLabel(request.method)
}

function isApprovalRequestMethod(method: string): boolean {
  return (
    method === 'item/commandExecution/requestApproval' ||
    method === 'item/fileChange/requestApproval'
  )
}

function pendingRequestActionLabel(request: UiServerRequest): string {
  if (isMcpPermissionElicitationRequest(request)) return '去确认'
  return isInputLikeServerRequest(request.method) ? '去填写' : '查看请求'
}

function liveOverlayPrimaryLabel(overlay: UiLiveOverlay): string {
  const label = overlay.activityLabel.trim()
  if (!label) return '思考中'
  if (/等待授权|waiting for approval|approval required/iu.test(label)) return '等待确认'
  if (/等待确认|requires confirmation|needs confirmation/iu.test(label)) return '等待确认'
  if (/等待输入|request user input|needs input/iu.test(label)) return '等待补充'
  if (/等待处理|pending request/iu.test(label)) return '等待处理'
  if (/执行命令|running command|executing command/iu.test(label)) return '执行命令'
  if (/writing response|thinking|reasoning|整理回复|思考/iu.test(label)) return '思考中'
  return label
}

function liveOverlayDetails(overlay: UiLiveOverlay): string[] {
  const details = overlay.activityDetails
    .map((detail) => detail.trim())
    .filter((detail) => detail.length > 0)
  const command = liveOverlayCommandMessage.value?.commandExecution?.command?.trim() ?? ''
  if (command && !details.includes(command)) {
    details.push(command)
  }
  if (!command) {
    if (!details.some((detail) => /命令|command/iu.test(detail))) {
      details.push('暂无命令执行')
    }
    if (liveOverlayElapsedLabel.value && !details.some((detail) => /已等待|waiting/iu.test(detail))) {
      details.push(`已等待 ${liveOverlayElapsedLabel.value}`)
    }
  }
  return details.slice(-3)
}

function liveOverlayHint(overlay: UiLiveOverlay): string {
  if (/等待授权|waiting for approval|approval required/iu.test(overlay.activityLabel)) {
    return '下方有权限确认，允许或拒绝后会继续执行。'
  }
  if (/等待确认|requires confirmation|needs confirmation/iu.test(overlay.activityLabel)) {
    return '下方有待确认请求，允许或拒绝后会继续执行。'
  }
  if (/等待输入|request user input|needs input/iu.test(overlay.activityLabel)) {
    return '下方有待补充内容，提交后会继续执行。'
  }
  if (/等待处理|pending request/iu.test(overlay.activityLabel)) {
    return '下方有待处理请求，完成后会继续执行。'
  }
  if (/执行命令|running command|executing command/iu.test(overlay.activityLabel)) {
    return '命令仍在运行，输出会持续追加。'
  }
  return '正在处理，新的结果会继续补到下方。'
}

function liveOverlayCompactHint(overlay: UiLiveOverlay): string {
  if (/执行命令|running command|executing command/iu.test(overlay.activityLabel)) {
    return '命令仍在执行，可先查看上方历史，新输出会继续追加。'
  }
  if (/writing response|thinking|reasoning|整理回复|思考/iu.test(overlay.activityLabel)) {
    return '正在整理回复，你可以先查看上方历史。'
  }
  return '正在继续处理，界面会自动更新。'
}

function scrollToPendingRequests(): void {
  isRequestPanelExpanded.value = true
  clearBelowFoldUpdates()
  autoFollowBottom.value = false
  const processPanel = processPanelRef.value
  if (processPanel) {
    processPanel.scrollIntoView({ behavior: 'smooth', block: 'end' })
    return
  }
  jumpToLatest()
}

async function onCopyMessage(message: UiMessage): Promise<void> {
  if (!canCopyMessage(message)) return
  const text = message.text.trim()
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', 'true')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
  }
}

function onRollback(message: UiMessage): void {
  if (!canRollbackMessage(message)) return
  const prependText = message.role === 'user' ? message.text.trim() : ''
  emit('rollback', {
    turnIndex: message.turnIndex!,
    prependText: prependText.length > 0 ? prependText : undefined,
  })
}

function clearHighlightedMessage(): void {
  highlightedMessageId.value = ''
  if (highlightedMessageTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(highlightedMessageTimer)
    highlightedMessageTimer = null
  }
}

function highlightMessage(messageId: string): void {
  highlightedMessageId.value = messageId
  if (typeof window === 'undefined') return
  if (highlightedMessageTimer !== null) {
    window.clearTimeout(highlightedMessageTimer)
  }
  highlightedMessageTimer = window.setTimeout(() => {
    highlightedMessageTimer = null
    if (highlightedMessageId.value === messageId) {
      highlightedMessageId.value = ''
    }
  }, 2600)
}

async function focusMessage(messageId: string): Promise<boolean> {
  const normalizedMessageId = messageId.trim()
  if (!normalizedMessageId) return false
  const hiddenTurnIndex = hiddenGuidedMessageTurnIndexById.value[normalizedMessageId]
  if (typeof hiddenTurnIndex === 'number' && !isGuidedTurnExpanded(hiddenTurnIndex)) {
    expandedGuidedTurnIndexes.value = new Set([...expandedGuidedTurnIndexes.value, hiddenTurnIndex])
    await nextTick()
  }

  const targetIndex = renderableConversationEntries.value.findIndex((entry) => (
    entry.kind === 'message' && entry.message.id === normalizedMessageId
  ))
  if (targetIndex < 0) return false

  if (visibleMessageStartIndex.value > targetIndex) {
    visibleMessageStartIndex.value = Math.max(targetIndex - 2, 0)
  }

  const container = conversationListRef.value
  await nextTick()
  if (!container) {
    highlightMessage(normalizedMessageId)
    return true
  }

  syncConversationViewport(container)
  const targetVisibleIndex = Math.max(targetIndex - visibleMessageStartIndex.value, 0)
  const topOffset = entryHeightMetrics.value.cumulativeHeights[targetVisibleIndex] ?? 0
  const maxScrollTop = Math.max(container.scrollHeight - container.clientHeight, 0)
  autoFollowBottom.value = false
  clearBelowFoldUpdates()
  container.scrollTop = Math.min(Math.max(topOffset - 24, 0), maxScrollTop)
  syncConversationViewport(container)
  scheduleEmitScrollState(container, true)

  await nextTick()
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

  const targetElement = observedMessageElementsById.get(normalizedMessageId)
  if (targetElement) {
    targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  highlightMessage(normalizedMessageId)
  return true
}

function scrollToBottom(): void {
  const container = conversationListRef.value
  if (!container) return
  container.scrollTop = container.scrollHeight
}

function isAtBottom(container: HTMLElement): boolean {
  const distance = container.scrollHeight - (container.scrollTop + container.clientHeight)
  return distance <= BOTTOM_THRESHOLD_PX
}

function flushScrollState(): void {
  scrollStateEmitFrame = 0
  const container = pendingScrollStateContainer
  const force = pendingScrollStateForce
  pendingScrollStateContainer = null
  pendingScrollStateForce = false
  if (!container) return
  emitScrollState(container, force)
}

function emitScrollState(container: HTMLElement, force = false, viewportSynced = false): void {
  if (!props.activeThreadId) return
  if (!viewportSynced) {
    syncConversationViewport(container)
  }
  const maxScrollTop = Math.max(container.scrollHeight - container.clientHeight, 0)
  const scrollRatio = maxScrollTop > 0 ? Math.min(Math.max(container.scrollTop / maxScrollTop, 0), 1) : 1
  const atBottom = isAtBottom(container)
  const nextSignature = [
    props.activeThreadId,
    String(Math.round(container.scrollTop / 24)),
    atBottom ? '1' : '0',
    String(Math.round(scrollRatio * 100)),
  ].join(':')
  const now =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now()
  if (!force && !atBottom && now - lastScrollStateEmitAt < 120) {
    return
  }
  if (!force && nextSignature === lastEmittedScrollStateSignature.value) {
    return
  }
  lastScrollStateEmitAt = now
  lastEmittedScrollStateSignature.value = nextSignature
  emit('updateScrollState', {
    threadId: props.activeThreadId,
    state: {
      scrollTop: container.scrollTop,
      isAtBottom: atBottom,
      scrollRatio,
    },
  })
}

function scheduleEmitScrollState(container: HTMLElement, force = false): void {
  if (typeof window === 'undefined') {
    emitScrollState(container, force)
    return
  }
  pendingScrollStateContainer = container
  pendingScrollStateForce = pendingScrollStateForce || force
  if (scrollStateEmitFrame) return
  scrollStateEmitFrame = requestAnimationFrame(flushScrollState)
}

function scheduleIdleScrollStateEmit(container: HTMLElement, force = false): void {
  pendingScrollStateContainer = container
  pendingScrollStateForce = pendingScrollStateForce || force
  if (typeof window === 'undefined') {
    flushScrollState()
    return
  }
  if (scrollStateIdleTimer) {
    window.clearTimeout(scrollStateIdleTimer)
  }
  scrollStateIdleTimer = window.setTimeout(() => {
    scrollStateIdleTimer = null
    flushScrollState()
  }, force ? 0 : 140)
}

function flushConversationScrollInteraction(): void {
  scrollInteractionFrame = 0
  const container = pendingScrollInteractionContainer
  pendingScrollInteractionContainer = null
  if (!container || props.isLoading) return
  syncConversationViewport(container)
  if (container.scrollTop > 160) {
    canAutoRevealOlderMessages.value = true
  }
  if (
    container.scrollTop <= 96 &&
    hasHiddenEarlierMessages.value &&
    canAutoRevealOlderMessages.value &&
    !isRevealingOlderMessages.value
  ) {
    void revealOlderMessages()
  }
  const atBottom = isAtBottom(container)
  autoFollowBottom.value = atBottom
  if (atBottom) {
    clearBelowFoldUpdates()
  }
}

function markBelowFoldUpdate(): void {
  if (shouldLockToBottom()) return
  hasPendingBelowFoldUpdates.value = true
}

function clearBelowFoldUpdates(): void {
  hasPendingBelowFoldUpdates.value = false
}

function renderableMessageSignature(messages: UiMessage[]): string {
  return messages
    .filter((message) => !isCommandMessage(message) && message.messageType !== 'worked')
    .map((message) => [
      message.id,
      message.messageType ?? '',
      message.text.length,
      message.turnIndex ?? '',
    ].join(':'))
    .join('|')
}

watch(
  () => renderableConversationEntries.value.length,
  (nextLength, previousLength) => {
    const nextLatestStartIndex = latestVisibleStartIndex(nextLength)
    if (previousLength == null) {
      visibleMessageStartIndex.value = nextLatestStartIndex
      return
    }

    if (nextLength === 0) {
      visibleMessageStartIndex.value = 0
      return
    }

    if (previousLength === 0) {
      visibleMessageStartIndex.value = nextLatestStartIndex
      return
    }

    visibleMessageStartIndex.value = Math.min(visibleMessageStartIndex.value, nextLatestStartIndex)
  },
  { immediate: true },
)

function applySavedScrollState(): void {
  const container = conversationListRef.value
  if (!container) return
  syncConversationViewport(container)

  const savedState = props.scrollState
  if (!savedState || savedState.isAtBottom) {
    autoFollowBottom.value = true
    enforceBottomState()
    return
  }

  autoFollowBottom.value = false
  const maxScrollTop = Math.max(container.scrollHeight - container.clientHeight, 0)
  const targetScrollTop =
    typeof savedState.scrollRatio === 'number'
      ? savedState.scrollRatio * maxScrollTop
      : savedState.scrollTop
  container.scrollTop = Math.min(Math.max(targetScrollTop, 0), maxScrollTop)
  syncConversationViewport(container)
  scheduleEmitScrollState(container, true)
}

function enforceBottomState(): void {
  const container = conversationListRef.value
  if (!container) return
  autoFollowBottom.value = true
  scrollToBottom()
  syncConversationViewport(container)
  scheduleEmitScrollState(container)
  clearBelowFoldUpdates()
}

function shouldLockToBottom(): boolean {
  return autoFollowBottom.value
}

function runBottomLockFrame(): void {
  if (!shouldLockToBottom()) {
    bottomLockFramesLeft = 0
    bottomLockFrame = 0
    return
  }

  enforceBottomState()
  bottomLockFramesLeft -= 1
  if (bottomLockFramesLeft <= 0) {
    bottomLockFrame = 0
    return
  }
  bottomLockFrame = requestAnimationFrame(runBottomLockFrame)
}

function scheduleBottomLock(frames = 6): void {
  if (!shouldLockToBottom()) return
  if (bottomLockFrame) {
    cancelAnimationFrame(bottomLockFrame)
    bottomLockFrame = 0
  }
  bottomLockFramesLeft = Math.max(frames, 1)
  bottomLockFrame = requestAnimationFrame(runBottomLockFrame)
}

function onPendingImageSettled(): void {
  scheduleBottomLock(3)
}

function bindPendingImageHandlers(): void {
  if (!shouldLockToBottom()) return
  const container = conversationListRef.value
  if (!container) return

  const images = container.querySelectorAll<HTMLImageElement>('img.message-image-preview')
  for (const image of images) {
    if (image.complete || trackedPendingImages.has(image)) continue
    trackedPendingImages.add(image)
    image.addEventListener('load', onPendingImageSettled, { once: true })
    image.addEventListener('error', onPendingImageSettled, { once: true })
  }
}

async function scheduleScrollRestore(forceBottom = shouldLockToBottom()): Promise<void> {
  const anchorSnapshot = forceBottom ? null : captureVisibleConversationAnchor()
  await nextTick()
  if (scrollRestoreFrame) {
    cancelAnimationFrame(scrollRestoreFrame)
  }
  scrollRestoreFrame = requestAnimationFrame(() => {
    scrollRestoreFrame = 0
    if (forceBottom) {
      enforceBottomState()
    } else {
      const didRestoreAnchor = anchorSnapshot ? restoreScrollAnchor(anchorSnapshot) : false
      if (!didRestoreAnchor) {
        applySavedScrollState()
      }
    }
    bindPendingImageHandlers()
    if (forceBottom) {
      scheduleBottomLock()
    }
  })
}

watch(
  () => props.messages,
  async (next, previous) => {
    syncObservedCommandStartTimes(next)
    if (props.isLoading) return
    const previousMessages = previous ?? EMPTY_MESSAGES
    const shouldFollowBottom = shouldLockToBottom()

    for (const m of next) {
      if (m.messageType !== 'commandExecution' || !m.commandExecution) continue
      const prev = prevCommandStatuses.value[m.id]
      const cur = m.commandExecution.status
      if (prev === 'inProgress' && cur !== 'inProgress') {
        scheduleCollapse(m.id)
      }
      prevCommandStatuses.value[m.id] = cur
    }

    prunePreparedMessageBlockCache(next)
    pruneMeasuredMessageHeights(renderableConversationEntries.value)

    const hasNewRenderableOutput = previousMessages.length > 0 &&
      renderableMessageSignature(next) !== renderableMessageSignature(previousMessages)

    if (hasNewRenderableOutput && !shouldFollowBottom) {
      markBelowFoldUpdate()
    }

    await scheduleScrollRestore(shouldFollowBottom)
  },
  { immediate: true },
)

watch(
  liveOverlayBehaviorSignature,
  async (signature) => {
    if (!signature) return
    const shouldFollowBottom = shouldLockToBottom()
    await nextTick()
    if (!shouldFollowBottom) return
    enforceBottomState()
    scheduleBottomLock(8)
  },
)

watch(
  () => props.liveOverlay,
  (overlay, previousOverlay) => {
    if (overlay) {
      if (!previousOverlay || liveOverlayObservedAtMs.value <= 0) {
        liveOverlayObservedAtMs.value = Date.now()
      }
      startCommandElapsedTimer()
      return
    }
    liveOverlayObservedAtMs.value = 0
    if (Object.keys(observedCommandStartedAtById.value).length === 0) {
      stopCommandElapsedTimer()
    }
  },
  { immediate: true },
)

watch(
  () => props.isLoading,
  async (loading) => {
    if (loading) return
    await scheduleScrollRestore()
  },
)

watch(
  collapsibleGuidedTurnDescriptors,
  (nextDescriptors) => {
    const keepTurnIndexes = new Set(nextDescriptors.keys())
    const nextExpanded = new Set<number>()
    for (const turnIndex of expandedGuidedTurnIndexes.value) {
      if (keepTurnIndexes.has(turnIndex)) {
        nextExpanded.add(turnIndex)
      }
    }
    if (nextExpanded.size !== expandedGuidedTurnIndexes.value.size) {
      expandedGuidedTurnIndexes.value = nextExpanded
    }
  },
  { deep: false },
)

watch(
  () => props.activeThreadId,
  () => {
    liveOverlayObservedAtMs.value = props.liveOverlay ? Date.now() : 0
    modalImageUrl.value = ''
    closeFileLinkContextMenu()
    failedMarkdownImageKeys.value = new Set()
    preparedMessageBlocksById.clear()
    disconnectAllObservedElements(observedMessageElementsById)
    measuredMessageHeightById.value = {}
    expandedGuidedTurnIndexes.value = new Set()
    conversationScrollTop.value = 0
    lastGapMeasuredContainer = null
    lastGapMeasuredViewportHeight = -1
    lastScrollStateEmitAt = 0
    lastEmittedScrollStateSignature.value = ''
    isRevealingOlderMessages.value = false
    canAutoRevealOlderMessages.value = true
    visibleMessageStartIndex.value = latestVisibleStartIndex(renderableConversationEntries.value.length)
    clearBelowFoldUpdates()
    autoFollowBottom.value = props.scrollState?.isAtBottom !== false
  },
  { flush: 'post' },
)

watch(
  modalImageUrl,
  async (nextUrl) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    if (nextUrl) {
      previousBodyOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      window.addEventListener('keydown', onWindowKeydownForImageModal)
      window.addEventListener('resize', onWindowResizeForImageModal)
      await nextTick()
      resetImageModalView()
      return
    }

    window.removeEventListener('keydown', onWindowKeydownForImageModal)
    window.removeEventListener('resize', onWindowResizeForImageModal)
    document.body.style.overflow = previousBodyOverflow
    previousBodyOverflow = ''
    resetImageModalView()
  },
)

watch(
  () => props.scrollState?.isAtBottom,
  (isAtBottomState) => {
    autoFollowBottom.value = isAtBottomState !== false
  },
)

watch(isFileLinkContextMenuVisible, (isVisible) => {
  if (isVisible) {
    window.addEventListener('pointerdown', onWindowPointerDownForFileLinkContextMenu, { capture: true })
    window.addEventListener('blur', onWindowBlurForFileLinkContextMenu)
    window.addEventListener('keydown', onWindowKeydownForFileLinkContextMenu)
    return
  }

  window.removeEventListener('pointerdown', onWindowPointerDownForFileLinkContextMenu, { capture: true })
  window.removeEventListener('blur', onWindowBlurForFileLinkContextMenu)
  window.removeEventListener('keydown', onWindowKeydownForFileLinkContextMenu)
})

watch(
  conversationListRef,
  (nextElement, previousElement) => {
    if (previousElement) {
      previousElement.removeEventListener('scroll', onConversationScroll, { passive: true } as AddEventListenerOptions)
      observedConversationListElement = null
    }
    if (previousElement) {
      conversationListResizeObserver?.unobserve(previousElement)
    }
    if (!nextElement) return
    nextElement.addEventListener('scroll', onConversationScroll, { passive: true })
    observedConversationListElement = nextElement
    syncConversationViewport(nextElement)
    conversationListResizeObserver?.observe(nextElement)
  },
  { flush: 'post' },
)

function onConversationScroll(event: Event): void {
  const container = event.currentTarget instanceof HTMLElement
    ? event.currentTarget
    : conversationListRef.value
  if (!container || props.isLoading) return
  pendingScrollInteractionContainer = container
  scheduleIdleScrollStateEmit(container)
  if (scrollInteractionFrame) return
  scrollInteractionFrame = requestAnimationFrame(flushConversationScrollInteraction)
}

function jumpToLatest(): void {
  autoFollowBottom.value = true
  enforceBottomState()
  scheduleBottomLock(4)
}

function clampImageModalScale(scale: number): number {
  if (!Number.isFinite(scale)) return IMAGE_MODAL_MIN_SCALE
  return Math.min(IMAGE_MODAL_MAX_SCALE, Math.max(IMAGE_MODAL_MIN_SCALE, scale))
}

function readImageModalOffsetBounds(scale = modalImageScale.value): { maxX: number; maxY: number } {
  const stage = imageModalStageRef.value
  const image = imageModalImageRef.value
  if (!stage || !image) {
    return { maxX: 0, maxY: 0 }
  }

  const stageRect = stage.getBoundingClientRect()
  const width = image.offsetWidth * scale
  const height = image.offsetHeight * scale

  return {
    maxX: Math.max((width - stageRect.width) / 2, 0),
    maxY: Math.max((height - stageRect.height) / 2, 0),
  }
}

function clampImageModalOffsets(
  offsetX: number,
  offsetY: number,
  scale = modalImageScale.value,
): { x: number; y: number } {
  const { maxX, maxY } = readImageModalOffsetBounds(scale)
  return {
    x: Math.min(maxX, Math.max(-maxX, offsetX)),
    y: Math.min(maxY, Math.max(-maxY, offsetY)),
  }
}

function syncImageModalOffsets(scale = modalImageScale.value): void {
  const { x, y } = clampImageModalOffsets(modalImageOffsetX.value, modalImageOffsetY.value, scale)
  modalImageOffsetX.value = x
  modalImageOffsetY.value = y
}

function applyImageModalScale(nextScale: number): void {
  const clampedScale = clampImageModalScale(nextScale)
  modalImageScale.value = clampedScale
  if (clampedScale <= IMAGE_MODAL_MIN_SCALE) {
    modalImageOffsetX.value = 0
    modalImageOffsetY.value = 0
    return
  }
  syncImageModalOffsets(clampedScale)
}

function resetImageModalView(): void {
  modalImageScale.value = IMAGE_MODAL_MIN_SCALE
  modalImageOffsetX.value = 0
  modalImageOffsetY.value = 0
  isImageModalDragging.value = false
  modalImagePointerId = null
}

function zoomInImageModal(): void {
  applyImageModalScale(modalImageScale.value + IMAGE_MODAL_SCALE_STEP)
}

function zoomOutImageModal(): void {
  applyImageModalScale(modalImageScale.value - IMAGE_MODAL_SCALE_STEP)
}

function onImageModalWheel(event: WheelEvent): void {
  if (!modalImageUrl.value) return
  if (event.deltaY < 0) {
    zoomInImageModal()
    return
  }
  zoomOutImageModal()
}

function onImageModalDoubleClick(): void {
  if (isImageModalZoomed.value) {
    resetImageModalView()
    return
  }
  applyImageModalScale(2)
}

function onImageModalPointerDown(event: PointerEvent): void {
  if (!isImageModalZoomed.value) return
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return

  modalImagePointerId = event.pointerId
  modalImageDragStartX = event.clientX
  modalImageDragStartY = event.clientY
  modalImageDragOriginX = modalImageOffsetX.value
  modalImageDragOriginY = modalImageOffsetY.value
  isImageModalDragging.value = true
  target.setPointerCapture(event.pointerId)
  event.preventDefault()
}

function onImageModalPointerMove(event: PointerEvent): void {
  if (!isImageModalDragging.value || modalImagePointerId !== event.pointerId) return
  const deltaX = event.clientX - modalImageDragStartX
  const deltaY = event.clientY - modalImageDragStartY
  const { x, y } = clampImageModalOffsets(
    modalImageDragOriginX + deltaX,
    modalImageDragOriginY + deltaY,
  )
  modalImageOffsetX.value = x
  modalImageOffsetY.value = y
}

function onImageModalPointerUp(event: PointerEvent): void {
  if (modalImagePointerId !== event.pointerId) return
  const target = event.currentTarget
  if (target instanceof HTMLElement && target.hasPointerCapture(event.pointerId)) {
    target.releasePointerCapture(event.pointerId)
  }
  isImageModalDragging.value = false
  modalImagePointerId = null
}

function openImageModal(imageUrl: string): void {
  modalImageUrl.value = toRenderableImageUrl(imageUrl)
}

function markdownImageKey(messageId: string, blockIndex: number): string {
  return `${messageId}:${String(blockIndex)}`
}

function onMarkdownImageError(messageId: string, blockIndex: number): void {
  const next = new Set(failedMarkdownImageKeys.value)
  next.add(markdownImageKey(messageId, blockIndex))
  failedMarkdownImageKeys.value = next
}

function isMarkdownImageFailed(messageId: string, blockIndex: number): boolean {
  return failedMarkdownImageKeys.value.has(markdownImageKey(messageId, blockIndex))
}

function closeImageModal(): void {
  modalImageUrl.value = ''
}

function onWindowKeydownForImageModal(event: KeyboardEvent): void {
  if (!modalImageUrl.value) return
  if (event.key === 'Escape') {
    closeImageModal()
    return
  }
  if (event.key === '+' || event.key === '=') {
    event.preventDefault()
    zoomInImageModal()
    return
  }
  if (event.key === '-' || event.key === '_') {
    event.preventDefault()
    zoomOutImageModal()
    return
  }
  if (event.key === '0') {
    event.preventDefault()
    resetImageModalView()
  }
}

function onWindowResizeForImageModal(): void {
  if (!modalImageUrl.value) return
  syncImageModalOffsets()
}

function alignLiveOverlayReasoningToBottom(): void {
  const reasoning = liveOverlayReasoningRef.value
  if (!reasoning) return
  reasoning.scrollTop = reasoning.scrollHeight
}

watch(
  () => props.liveOverlay?.reasoningText,
  async (reasoningText) => {
    if (!reasoningText || !shouldRenderDetailedLiveOverlay.value) return
    await nextTick()
    alignLiveOverlayReasoningToBottom()
  },
)

watch(() => props.activeThreadId, () => {
  clearHighlightedMessage()
  activeMessageActionId.value = ''
})

defineExpose<{
  focusMessage: (messageId: string) => Promise<boolean>
}>({
  focusMessage,
})

onBeforeUnmount(() => {
  stopCommandElapsedTimer()
  clearHighlightedMessage()
  if (scrollRestoreFrame) {
    cancelAnimationFrame(scrollRestoreFrame)
  }
  if (scrollAnchorRestoreFrame) {
    cancelAnimationFrame(scrollAnchorRestoreFrame)
  }
  if (bottomLockFrame) {
    cancelAnimationFrame(bottomLockFrame)
  }
  if (scrollStateEmitFrame) {
    cancelAnimationFrame(scrollStateEmitFrame)
  }
  if (scrollInteractionFrame) {
    cancelAnimationFrame(scrollInteractionFrame)
  }
  if (scrollStateIdleTimer && typeof window !== 'undefined') {
    window.clearTimeout(scrollStateIdleTimer)
    scrollStateIdleTimer = null
  }
  if (observedConversationListElement) {
    observedConversationListElement.removeEventListener('scroll', onConversationScroll, { passive: true } as AddEventListenerOptions)
    observedConversationListElement = null
  }
  conversationListResizeObserver?.disconnect()
  itemResizeObserver?.disconnect()
  disconnectAllObservedElements(observedMessageElementsById)
  window.removeEventListener('pointerdown', onWindowPointerDownForFileLinkContextMenu, { capture: true })
  window.removeEventListener('blur', onWindowBlurForFileLinkContextMenu)
  window.removeEventListener('keydown', onWindowKeydownForFileLinkContextMenu)
  window.removeEventListener('keydown', onWindowKeydownForImageModal)
  window.removeEventListener('resize', onWindowResizeForImageModal)
  if (typeof document !== 'undefined') {
    document.body.style.overflow = previousBodyOverflow
  }
})
</script>

<style scoped>
@reference "tailwindcss";

.conversation-root {
  @apply relative h-full min-h-0 p-0 flex flex-col overflow-y-hidden overflow-x-visible bg-transparent border-none rounded-none;
}

.conversation-root--switching {
  @apply overflow-hidden;
}

.conversation-status-loading {
  @apply sticky top-0 z-10 mb-1.5 mt-1.5 flex items-center gap-2 rounded-full border border-[#e5dbca] bg-[#fffdf8]/96 px-3 py-1.5 text-xs text-[#7b7062];
  width: fit-content;
  max-width: min(32rem, calc(100% - 1rem));
  margin-inline: auto;
  backdrop-filter: blur(6px);
  animation: conversationFadeIn 160ms ease-out;
  box-shadow: 0 10px 24px -22px rgba(31, 41, 55, 0.16);
}

.conversation-status-loading--switching {
  @apply border-[#ead9b5] bg-[#fff9ee]/96 text-[#8a6a11];
}

.conversation-status-loading-inline {
  @apply min-w-0;
}

.conversation-item-process {
  @apply justify-center;
  order: 20;
}

.conversation-process-panel {
  @apply w-full mx-auto mb-1 flex flex-col gap-1.5;
  max-width: min(var(--content-shell-max-width, 88rem), 100%);
}

.conversation-process-toggle {
  @apply inline-flex w-full items-center justify-between rounded-xl border border-[#e6dccb] bg-[#fffdf8] px-3 py-1.5 text-left text-[11px] font-semibold text-[#6d6354] transition-colors hover:border-[#d6c8b2] hover:bg-[#fffaf0];
}

.conversation-process-section {
  @apply flex flex-col gap-1.5;
}

.conversation-process-stack {
  @apply flex flex-col gap-1.5;
}

.conversation-empty-state {
  @apply flex flex-col items-start gap-3 px-2 sm:px-5 py-2.5;
}

.conversation-empty {
  @apply m-0 text-sm text-[#8f8577];
}

.conversation-empty-actions {
  @apply flex flex-wrap items-center gap-2;
}

.conversation-empty-action {
  @apply inline-flex items-center justify-center rounded-full border border-[#d9d1c5] bg-[#fffaf2] px-3.5 py-1.5 text-xs font-medium text-[#6d5f4f] transition-colors;
}

.conversation-empty-action:hover {
  @apply border-[#c8bca9] bg-[#f7efe2];
}

.conversation-empty-action-primary {
  @apply border-[#d7c27a] bg-[#f8efd2] text-[#725b12];
}

.conversation-empty-action-primary:hover {
  @apply border-[#c7af5d] bg-[#f2e4b6];
}

.conversation-list {
  @apply h-full min-h-0 list-none m-0 px-2.5 sm:px-5 py-0 overflow-y-auto overflow-x-visible flex flex-col gap-1.5;
  padding-bottom: max(0.875rem, env(safe-area-inset-bottom));
  overscroll-behavior-y: contain;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-y;
  scrollbar-width: thin;
  scrollbar-color: rgba(143, 133, 119, 0.42) transparent;
  transition: opacity 140ms ease, transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

.conversation-list::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.conversation-list::-webkit-scrollbar-track {
  background: transparent;
}

.conversation-list::-webkit-scrollbar-thumb {
  min-height: 3rem;
  border: 0;
  border-radius: 999px;
  background: rgba(143, 133, 119, 0.32);
}

.conversation-list::-webkit-scrollbar-thumb:hover {
  background: rgba(91, 81, 70, 0.42);
}

.conversation-list--switching {
  opacity: 0.9;
  transform: translateY(1px);
}

.conversation-jump-to-latest {
  @apply absolute bottom-4 right-4 z-20 inline-flex items-center gap-2 rounded-full border border-[#ddd3c2] bg-[#fffdf8] px-3 py-2 text-xs font-semibold text-[#544a3d] hover:border-[#bca98d] hover:text-[#1f2937];
  bottom: max(1rem, calc(env(safe-area-inset-bottom) + 0.5rem));
}

.conversation-jump-to-latest.has-pending-updates {
  @apply border-[#b8ddd6] bg-[#eef8f5]/95 text-[#0f766e];
}

.conversation-jump-to-latest-icon {
  @apply h-4 w-4;
  transform: rotate(180deg);
}

.conversation-jump-to-latest-label {
  @apply hidden sm:inline;
}

.conversation-jump-to-latest-badge {
  @apply h-2.5 w-2.5 rounded-full bg-blue-500;
}

.conversation-item {
  @apply m-0 w-full flex;
}

.conversation-item-actionable {
  position: relative;
  z-index: 0;
  overflow: visible;
}

.conversation-spacer {
  @apply m-0 w-full flex-none p-0 pointer-events-none;
}

.conversation-item-load-more {
  @apply justify-center;
}

.conversation-load-more-button {
  @apply mx-auto flex w-full flex-col items-center gap-0.5 rounded-2xl border border-dashed border-[#ddd3c2] bg-[#fffdf8] px-3 py-2 text-center transition-colors hover:border-[#cbb89b] hover:bg-[#fffaf0] disabled:cursor-default disabled:opacity-70;
  max-width: min(var(--content-shell-max-width, 88rem), 100%);
}

.conversation-load-more-title {
  @apply text-xs font-semibold text-[#544a3d];
}

.conversation-load-more-hint {
  @apply text-[11px] text-[#8f8577];
}

.message-row {
  @apply relative w-full mx-auto flex;
  max-width: min(var(--content-shell-max-width, 88rem), 100%);
}

.message-row[data-role='user'] {
  @apply justify-end;
}

.message-row[data-role='assistant'],
.message-row[data-role='system'] {
  @apply justify-start;
}

.conversation-bottom-anchor {
  @apply h-px;
  order: 30;
}

.message-stack {
  @apply relative flex flex-col w-full gap-0.5;
  overflow: visible;
}

.request-card {
  @apply w-full rounded-[20px] border border-[#ead9b5] bg-[#fff9ee] px-3 sm:px-3.5 py-2.5 sm:py-3 flex flex-col gap-1.5;
  max-width: min(60rem, 100%);
}

.request-title {
  @apply m-0 text-sm leading-5 font-semibold text-[#8a4a0d];
}

.request-meta {
  @apply m-0 text-xs leading-4 text-[#ad6b28];
}

.request-reason {
  @apply m-0 text-sm leading-5 text-[#6a3a0b] whitespace-pre-wrap;
}

.request-actions {
  @apply flex flex-wrap gap-1.5 sm:gap-2;
}

.request-actions-prominent {
  @apply pt-0.5;
}

.request-button {
  @apply rounded-xl border border-[#e2c486] bg-white px-3 py-1.5 text-xs text-[#7d4911] hover:bg-[#fff0c9];
}

.request-button-primary {
  @apply border-[#c56a12] bg-[#c56a12] text-white hover:bg-[#ab5b0f];
}

.request-user-input {
  @apply flex flex-col gap-2.5;
}

.request-permission-panel {
  @apply rounded-2xl border border-[#ead9b5] bg-white/70 px-3 py-3 flex flex-col gap-2;
}

.request-permission-badge {
  @apply w-fit rounded-full border border-[#cbe7e1] bg-[#f0fdfa] px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-[#0f766e];
}

.request-permission-title {
  @apply m-0 text-base leading-6 font-semibold text-[#3a2a14];
}

.request-permission-text {
  @apply m-0 text-sm leading-5 text-[#6a3a0b];
}

.request-permission-grid {
  @apply m-0 grid grid-cols-1 sm:grid-cols-2 gap-2;
}

.request-permission-item {
  @apply rounded-xl border border-[#f1dfba] bg-[#fffaf0] px-2.5 py-2;
}

.request-permission-term {
  @apply text-[11px] leading-4 text-[#ad6b28];
}

.request-permission-value {
  @apply m-0 break-all font-mono text-xs leading-5 text-[#3a2a14];
}

.request-permission-note {
  @apply m-0 rounded-xl bg-[#f8edda] px-2.5 py-2 text-xs leading-5 text-[#7d4911];
}

.request-question {
  @apply flex flex-col gap-1;
}

.request-question-title {
  @apply m-0 text-sm leading-5 font-medium text-amber-900;
}

.request-required {
  @apply ml-1 rounded-full bg-[#f3d7a4] px-1.5 py-0.5 text-[10px] font-semibold text-[#8a4a0d];
}

.request-question-text {
  @apply m-0 text-xs leading-4 text-amber-800;
}

.request-link {
  @apply inline-flex w-fit rounded-xl border border-[#e2c486] bg-white px-3 py-1.5 text-xs font-medium text-[#8a4a0d] underline-offset-2 hover:bg-[#fff0c9] hover:underline;
}

.request-select {
  @apply h-8 rounded-xl border border-[#e2c486] bg-white px-2 text-sm text-[#7d4911];
}

.request-input {
  @apply h-8 rounded-xl border border-[#e2c486] bg-white px-2 text-sm text-[#7d4911] placeholder:text-[#c28a4a];
}

.request-textarea {
  @apply min-h-20 resize-y rounded-xl border border-[#e2c486] bg-white px-2.5 py-2 text-sm leading-5 text-[#7d4911] placeholder:text-[#c28a4a];
}

.request-checkbox-row {
  @apply inline-flex min-h-8 w-fit items-center gap-2 rounded-xl border border-[#e2c486] bg-white px-3 py-1 text-sm text-[#7d4911];
}

.request-checkbox-row input {
  @apply h-4 w-4 accent-[#0f766e];
}

.live-overlay-inline {
  @apply w-full rounded-2xl border border-[#d7ebe7] bg-[#f7fbfa] px-3 py-2 flex flex-col gap-1.5;
  max-width: min(60rem, 100%);
  position: relative;
  overflow: hidden;
}

.live-overlay-inline-compact {
  @apply rounded-2xl px-3 py-1.5;
  max-width: min(36rem, 100%);
}

.live-overlay-inline::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(110deg, transparent 0%, rgba(255, 255, 255, 0.34) 46%, transparent 100%);
  transform: translateX(-130%);
  opacity: 0;
}

.live-overlay-inline-thinking::after {
  opacity: 1;
  animation: liveOverlaySweep 2.8s ease-in-out infinite;
}

.live-overlay-inline-command::after {
  opacity: 1;
  animation: liveOverlaySweep 1.9s ease-in-out infinite;
}

.live-overlay-head {
  @apply flex items-center gap-2;
}

.live-overlay-indicator {
  @apply relative flex h-6 w-6 items-center justify-center rounded-full border border-[#d7ebe7] bg-white shrink-0;
  overflow: visible;
}

.live-overlay-indicator-ring {
  @apply absolute inset-[3px] rounded-full border;
  display: block;
  border-color: rgba(15, 118, 110, 0.18);
  border-top-color: rgba(15, 118, 110, 0.88);
  animation: liveOverlaySpin 1.2s linear infinite;
}

.live-overlay-indicator-core {
  @apply block h-2 w-2 rounded-full bg-[#0f766e];
  animation: liveOverlayCorePulse 1.35s ease-in-out infinite;
}

.live-overlay-heading {
  @apply min-w-0 flex flex-col gap-0.5;
}

.live-overlay-compact-main {
  @apply flex items-center gap-2;
}

.live-overlay-compact-copy {
  @apply min-w-0 flex-1 flex flex-col gap-0.5;
}

.live-overlay-compact-head {
  @apply flex items-center gap-2;
}

.live-overlay-inline-compact .live-overlay-indicator {
  @apply h-6 w-6;
}

.live-overlay-label {
  @apply m-0 text-[11px] uppercase tracking-[0.08em] font-semibold text-[#0f766e];
}

.live-overlay-compact-label {
  @apply m-0 text-[13px] font-semibold text-[#1b4d47];
}

.live-overlay-dots {
  @apply inline-flex items-center gap-1;
}

.live-overlay-dot {
  @apply h-1.5 w-1.5 rounded-full bg-[#0f766e];
  opacity: 0.28;
  animation: liveOverlayDotPulse 1.05s ease-in-out infinite;
}

.live-overlay-dot:nth-child(2) {
  opacity: 0.52;
  animation-delay: 0.14s;
}

.live-overlay-dot:nth-child(3) {
  opacity: 0.78;
  animation-delay: 0.28s;
}

.live-overlay-detail-list {
  @apply flex flex-wrap gap-1.5;
}

.live-overlay-command-details {
  @apply mb-1;
}

.live-overlay-detail-chip {
  @apply inline-flex max-w-full items-center rounded-full border border-[#d6ebe6] bg-white/80 px-2 py-0.5 text-[11px] text-[#476760];
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.live-overlay-command-panel {
  @apply flex flex-col gap-0;
}

.live-overlay-command-row {
  @apply cursor-default hover:bg-[#f8f4ec];
}

.live-overlay-command-output-wrap {
  @apply rounded-b-lg bg-zinc-900 border border-[#d8cfbf] border-t-0;
}

.live-overlay-command-output {
  @apply max-h-40;
}

.live-overlay-hint {
  @apply m-0 text-sm leading-5 text-[#5b756f];
}

.live-overlay-compact-hint {
  @apply m-0 text-[11px] leading-4 text-[#6b8a84];
}

.live-overlay-request-link {
  @apply inline-flex w-fit items-center rounded-full border border-[#c8ddd8] bg-white px-3 py-1.5 text-xs font-semibold text-[#0f766e] shadow-sm transition-colors hover:border-[#97c2b8] hover:text-[#0b5e58];
}

.live-overlay-actions {
  @apply flex flex-wrap gap-1.5 sm:gap-2;
}

.live-overlay-action {
  @apply rounded-xl border border-[#c8ddd8] bg-white px-3 py-1.5 text-xs font-semibold text-[#0f766e] shadow-sm transition-colors hover:border-[#97c2b8] hover:text-[#0b5e58];
}

.live-overlay-action-primary {
  @apply border-[#0f766e] bg-[#0f766e] text-white hover:border-[#0b5e58] hover:bg-[#0b5e58] hover:text-white;
}

.live-overlay-request-count {
  @apply m-0 text-xs leading-4 text-[#6b8a84];
}

.live-overlay-reasoning {
  @apply m-0 text-sm leading-5 text-[#33564f] whitespace-pre-wrap;
  display: block;
  max-height: calc(1.25rem * 5);
  overflow: auto;
  scrollbar-width: none;
  mask-image: linear-gradient(to top, black 75%, transparent 100%);
  -webkit-mask-image: linear-gradient(to top, black 75%, transparent 100%);
}

.live-overlay-reasoning::-webkit-scrollbar {
  display: none;
}

.live-overlay-error {
  @apply m-0 text-sm leading-5 text-[#c2410c] whitespace-pre-wrap;
}

.message-body {
  @apply flex flex-col max-w-full;
  width: fit-content;
}

.message-body[data-role='user'] {
  @apply ml-auto items-end;
  align-self: flex-end;
}

.message-image-list {
  @apply list-none m-0 mb-1.5 p-0 flex flex-wrap gap-1.5;
}

.message-image-list[data-role='user'] {
  @apply ml-auto justify-end;
}

.message-image-item {
  @apply m-0;
}

.message-image-button {
  @apply block rounded-2xl overflow-hidden border border-[#ddd5c7] bg-white p-0 hover:border-[#bca98d];
}

.message-image-preview {
  @apply block w-16 h-16 object-cover;
}

.message-file-attachments {
  @apply mb-1.5 flex flex-wrap gap-1.5;
}

.message-file-chip {
  @apply inline-flex items-center gap-1 rounded-full border border-[#ddd5c7] bg-[#f7f1e5] px-2.5 py-1 text-xs text-[#6d6354];
}

.message-file-chip-icon {
  @apply text-[10px] leading-none;
}

.message-file-chip-name {
  @apply truncate max-w-40 font-mono;
}

.message-card {
  @apply max-w-full px-0 py-0 bg-transparent border-none rounded-none;
  position: relative;
}

.message-text-flow {
  @apply flex flex-col gap-1;
}

.message-text {
  @apply m-0 text-sm whitespace-pre-wrap text-[#28231d];
  font-family: var(--font-sans-reading);
  font-size: var(--font-size-reading, 15px);
  line-height: var(--line-height-reading);
  letter-spacing: var(--tracking-body-soft);
}

.message-bold-text {
  @apply font-semibold text-[#1f2937];
}

.message-markdown-image {
  @apply w-auto h-auto max-w-[min(560px,85vw)] max-h-[min(460px,62vh)] object-contain bg-white;
}

.message-inline-code {
  @apply rounded-xl border border-[#dfd7ca] bg-[#f5f1e8] px-1.5 py-0.5 text-[0.875em] leading-[1.4] text-[#2d261f] font-mono;
  font-family: var(--font-mono-ui);
}

.message-file-link {
  @apply text-sm leading-relaxed text-[#0969da] no-underline hover:text-[#1f6feb] hover:underline underline-offset-2;
}

.message-file-link-wrap {
  @apply inline-block align-baseline;
}

.file-link-context-menu {
  @apply fixed z-50 min-w-28 rounded-2xl border border-[#ddd5c7] bg-[#fffcf7] p-1.5 shadow-lg;
}

.file-link-context-menu-item {
  @apply block w-full rounded-xl px-2.5 py-1.5 text-left text-xs text-[#544a3d] hover:bg-[#f1ebde];
}

.message-stack[data-role='user'] {
  @apply items-end;
}

.message-stack[data-role='assistant'],
.message-stack[data-role='system'] {
  @apply items-start;
}

.message-eyebrow {
  @apply mb-0.5 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8f8577];
  font-family: var(--font-sans-ui);
}

.message-eyebrow[data-role='user'] {
  @apply text-[#73695d];
}

.message-eyebrow[data-role='assistant'] {
  @apply text-[#0f766e];
}

.message-eyebrow[data-role='system'] {
  @apply text-[#8a6a11];
}

.message-card[data-role='user'] {
  @apply rounded-[18px] border border-[#e0d6c6] bg-[#f0e8dc] px-3 py-2;
  max-width: min(36rem, 86vw);
  width: fit-content;
  margin-left: auto;
  align-self: flex-end;
}

.message-card[data-role='assistant'] {
  @apply rounded-[18px] border border-[#ece4d8] bg-white px-3.5 py-2.5;
  max-width: min(62rem, calc(100% - 0.5rem));
  box-shadow: 0 10px 20px -28px rgba(31, 41, 55, 0.14);
}

.message-card[data-role='system'] {
  @apply rounded-[16px] border border-[#e8dfcf] bg-[#f8f4ec] px-3.5 py-2.5;
  max-width: min(62rem, 100%);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.image-modal-backdrop {
  @apply fixed inset-0 z-50 bg-black/55 p-2 sm:p-6 flex items-center justify-center;
  backdrop-filter: blur(2px);
}

.image-modal-content {
  @apply relative flex w-full max-w-[min(96vw,1200px)] max-h-[94vh] flex-col gap-3 rounded-[28px] border border-white/10 bg-[#17120c]/92 p-3 shadow-2xl;
}

.image-modal-toolbar {
  @apply flex items-center justify-between gap-3;
}

.image-modal-toolbar-group {
  @apply flex items-center gap-2;
}

.image-modal-tool,
.image-modal-close {
  @apply inline-flex h-10 items-center justify-center rounded-full border border-[#3d3327] bg-[#f8f2e6] px-3 text-sm font-medium text-[#2b241d] shadow-sm transition-colors;
}

.image-modal-tool:hover,
.image-modal-close:hover {
  @apply bg-white;
}

.image-modal-scale {
  @apply min-w-18 px-4 tabular-nums;
}

.image-modal-close {
  @apply w-10 px-0;
}

.image-modal-stage {
  @apply relative flex min-h-[min(58vh,420px)] flex-1 items-center justify-center overflow-hidden rounded-[24px] bg-[#0d0b08]/55;
}

.image-modal-stage--zoomed {
  touch-action: none;
}

.image-modal-stage--dragging {
  cursor: grabbing;
}

.image-modal-image {
  @apply block max-w-full max-h-[calc(94vh-7rem)] rounded-2xl bg-white shadow-2xl select-none;
  transform-origin: center center;
  will-change: transform;
}

.icon-svg {
  @apply w-5 h-5;
}

.conversation-item-actionable:hover,
.conversation-item-actionable:focus-within {
  z-index: 8;
}

.conversation-item-highlighted .message-card {
  box-shadow: 0 0 0 2px rgba(15, 118, 110, 0.16), 0 14px 32px rgba(15, 118, 110, 0.12);
}

.message-card:focus-visible {
  outline: 2px solid rgba(15, 118, 110, 0.28);
  outline-offset: 3px;
}

.conversation-item-actions-active .message-action-button,
.conversation-item-actionable:focus-within .message-action-button {
  @apply opacity-90;
}

.message-actions {
  @apply inline-flex items-center gap-0.5;
  position: absolute;
  left: 0.5rem;
  bottom: -0.5rem;
  z-index: 10;
  pointer-events: none;
}

.message-action-button {
  @apply opacity-0 inline-flex min-h-8 items-center gap-1 self-start rounded-full border border-transparent bg-[#fffdf8]/88 px-2 py-0.5 text-[11px] text-[#82786b] shadow-sm shadow-[#2d261f]/5 transition-[background-color,border-color,color,opacity] duration-150 hover:border-[#d8cfbf] hover:bg-[#f7f1e5] hover:text-[#544a3d];
  pointer-events: auto;
}

.message-action-button--favorite.is-favorited {
  @apply border-[#d8c5a6] bg-[#f5ecdd] text-[#8a5b17] opacity-100;
}

.message-stack[data-role='user'] .message-actions {
  left: auto;
  right: 0.5rem;
}

.message-action-icon {
  @apply w-3.5 h-3.5;
}

.message-action-label {
  @apply leading-none;
}

.guided-turn-toggle {
  @apply inline-flex max-w-full items-center gap-2 self-start rounded-full border border-[#e4dac9] bg-[#fffdf8] px-3 py-1.5 text-left text-[#74695a] shadow-[0_8px_18px_rgba(114,92,63,0.06)] transition-[background-color,border-color,color,box-shadow] duration-150 hover:border-[#d3c4ad] hover:bg-[#fbf5ea] hover:text-[#564c40];
}

@media (min-width: 1024px) {
  .conversation-list {
    @apply px-5;
  }

  .message-card[data-role='assistant'],
  .message-card[data-role='system'] {
    @apply px-4 py-3;
  }

  .message-card[data-role='user'] {
    @apply px-3.5 py-2.5;
  }
}

@media (max-width: 767px) {
  .message-text {
    font-size: 14.5px;
    line-height: 1.58;
  }

  .message-card[data-role='assistant'],
  .message-card[data-role='system'] {
    @apply px-3 py-2.5;
  }

  .message-card[data-role='user'] {
    @apply px-3 py-2;
    max-width: min(34rem, 84vw);
  }

  .message-action-button {
    @apply h-8 w-8 justify-center px-0;
  }

  .message-action-label {
    @apply sr-only;
  }
}

.guided-turn-toggle[aria-expanded='true'] {
  @apply border-[#cfc4af] bg-[#f7f1e5] text-[#544a3d];
}

.guided-turn-toggle-title {
  @apply text-[12px] font-medium leading-none;
}

.guided-turn-toggle-meta {
  @apply rounded-full bg-[#f4eee2] px-1.5 py-0.5 text-[10px] font-medium leading-none text-[#8b7f70];
}

.cmd-row {
  @apply w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-[14px] border border-[#ddd5c7] bg-[#f8f4ec] cursor-pointer transition-colors duration-150 text-left hover:bg-[#f1ebde];
  overflow-x: auto;
  overflow-y: hidden;
  white-space: nowrap;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-x;
}

.cmd-row.cmd-expanded {
  @apply rounded-b-none border-b-0;
}

.cmd-chevron {
  @apply text-[10px] text-[#8f8577] transition-transform duration-100 flex-shrink-0;
}

.cmd-chevron-open {
  transform: rotate(90deg);
}

.cmd-label {
  @apply text-xs font-mono text-[#544a3d];
  flex: 0 0 auto;
  min-width: max-content;
}

.cmd-status {
  @apply text-[11px] font-medium flex-shrink-0;
}

.cmd-row.cmd-status-running .cmd-status::before {
  content: '';
  display: inline-block;
  width: 0.45rem;
  height: 0.45rem;
  margin-right: 0.35rem;
  border-radius: 9999px;
  background: currentColor;
  animation: liveOverlayCorePulse 1.15s ease-in-out infinite;
  vertical-align: middle;
}

.cmd-duration {
  @apply text-[11px] text-[#7b7062] flex-shrink-0;
}

.cmd-status-running .cmd-status {
  @apply text-[#0f766e];
}

.cmd-status-ok .cmd-status {
  @apply text-[#0f766e];
}

.cmd-status-error .cmd-status {
  @apply text-[#c2410c];
}

.cmd-output-wrap {
  @apply rounded-b-lg bg-zinc-900;
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 150ms ease-out;
  border: 1px solid transparent;
  border-top: none;
}

.cmd-output-wrap.cmd-output-visible {
  grid-template-rows: 1fr;
  border-color: #d8cfbf;
}

.cmd-output-wrap.cmd-output-collapsing {
  grid-template-rows: 1fr;
  border-color: #d8cfbf;
}

.cmd-output-inner {
  overflow: hidden;
  min-height: 0;
}

.cmd-output {
  @apply m-0 px-2.5 py-2 text-xs font-mono text-zinc-200 max-h-56 overflow-x-auto overflow-y-auto;
  white-space: pre;
  word-break: normal;
  overflow-wrap: normal;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-x;
}

@media (prefers-reduced-motion: reduce) {
  .conversation-list--switching,
  .live-overlay-inline::after,
  .live-overlay-indicator-ring,
  .live-overlay-indicator-core,
  .live-overlay-dot,
  .conversation-loading-card::after,
  .message-action-button,
  .cmd-row,
  .cmd-chevron,
  .worked-chevron,
  .cmd-output-wrap {
    animation: none !important;
    transition: none !important;
  }
}

@keyframes conversationFadeIn {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes conversationSwitchFloat {
  from {
    opacity: 0.78;
    transform: translateY(3px);
  }
  to {
    opacity: 0.92;
    transform: translateY(0);
  }
}

@keyframes liveOverlaySweep {
  0% {
    transform: translateX(-130%);
  }
  100% {
    transform: translateX(130%);
  }
}

@keyframes liveOverlaySpin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes liveOverlayCorePulse {
  0%,
  100% {
    transform: scale(0.82);
    opacity: 0.72;
  }
  50% {
    transform: scale(1);
    opacity: 1;
  }
}

@keyframes liveOverlayDotPulse {
  0%,
  100% {
    transform: translateY(0);
    opacity: 0.24;
  }
  45% {
    transform: translateY(-2px);
    opacity: 0.96;
  }
}
</style>
