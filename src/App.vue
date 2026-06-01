<template>
  <a class="skip-to-content" href="#main-content">跳到主要内容</a>
  <section v-if="isMobileShellConfigBooting" class="mobile-shell-setup-page" aria-label="读取连接配置">
    <div class="mobile-shell-setup-card">
      <div class="mobile-shell-setup-brand">
        <img src="/branding/cx-codex-app-icon.png" alt="" class="mobile-shell-setup-logo" />
        <div class="mobile-shell-setup-copy">
          <p class="mobile-shell-setup-kicker">CX-Codex</p>
          <h1 class="mobile-shell-setup-title">正在启动</h1>
        </div>
      </div>
      <p class="mobile-shell-setup-status mobile-shell-setup-status--boot">
        正在读取本机连接配置...
      </p>
    </div>
  </section>
  <section v-else-if="requiresMobileShellServerSetup" class="mobile-shell-setup-page" aria-label="配置连接地址">
    <div class="mobile-shell-setup-card">
      <div class="mobile-shell-setup-brand">
        <img src="/branding/cx-codex-app-icon.png" alt="" class="mobile-shell-setup-logo" />
        <div class="mobile-shell-setup-copy">
          <p class="mobile-shell-setup-kicker">CX-Codex</p>
          <h1 class="mobile-shell-setup-title">输入连接地址</h1>
        </div>
      </div>
      <label class="mobile-shell-setup-field">
        <span>服务地址</span>
        <input
          v-model="mobileShellServerInput"
          type="url"
          inputmode="url"
          autocomplete="url"
          placeholder="https://your-codex-host.example.com"
          :disabled="isMobileShellSaving"
        />
      </label>
      <button
        class="mobile-shell-setup-submit"
        type="button"
        :disabled="!canSaveMobileShellServerUrl"
        @click="saveMobileShellServerAddress"
      >
        {{ isMobileShellSaving ? '保存中...' : '保存并进入' }}
      </button>
      <p class="mobile-shell-setup-status">
        {{ mobileShellStatus || '地址会永久保存到本机 App，后续启动会自动进入。' }}
      </p>
    </div>
  </section>
  <DesktopLayout v-else :is-sidebar-collapsed="isSidebarCollapsed" @close-sidebar="setSidebarCollapsed(true)">
    <template #sidebar>
      <section class="sidebar-root" :class="{ 'sidebar-root--dual-pane-touch': isDualPaneMobile }">
        <div class="sidebar-scrollable">
          <div v-if="!isSidebarCollapsed" class="sidebar-top-shell">
            <SidebarThreadControls
              class="sidebar-thread-controls-host"
              :is-sidebar-collapsed="isSidebarCollapsed"
              :show-new-thread-button="true"
              @toggle-sidebar="setSidebarCollapsed(!isSidebarCollapsed)"
              @start-new-thread="onStartNewThreadFromToolbar"
            >
              <button
                class="sidebar-search-toggle"
                type="button"
                :aria-pressed="isSidebarSearchVisible"
                aria-label="搜索会话"
                title="搜索会话"
                @click="toggleSidebarSearch"
              >
                <IconTablerSearch class="sidebar-search-toggle-icon" />
              </button>
              <button
                class="sidebar-toolbar-icon-button"
                type="button"
                :disabled="!hasUnreadThreads"
                :aria-disabled="!hasUnreadThreads"
                aria-label="全部已读"
                title="清除当前列表里的未读标记"
                @click="onMarkAllThreadsRead"
              >
                <IconTablerBroom class="sidebar-toolbar-icon" />
              </button>
            </SidebarThreadControls>

            <div v-if="isSidebarSearchVisible" class="sidebar-search-bar">
              <IconTablerSearch class="sidebar-search-bar-icon" />
              <input
                ref="sidebarSearchInputRef"
                v-model="sidebarSearchQuery"
                class="sidebar-search-input"
                type="text"
                placeholder="筛选会话..."
                @keydown="onSidebarSearchKeydown"
              />
              <button
                v-if="sidebarSearchQuery.length > 0"
                class="sidebar-search-clear"
                type="button"
                aria-label="清空搜索"
                @click="clearSidebarSearch"
              >
                <IconTablerX class="sidebar-search-clear-icon" />
              </button>
            </div>

            <div class="sidebar-explore-nav">
              <button
                class="sidebar-skills-link"
                :class="{ 'is-active': isSkillsRoute }"
                type="button"
                @click="router.push({ name: 'skills' }); isMobile && setSidebarCollapsed(true)"
              >
                技能中心
              </button>
              <button
                v-if="showGithubTrendingProjects"
                class="sidebar-skills-link"
                :class="{ 'is-active': isGithubTrendingRoute }"
                type="button"
                @click="router.push({ name: 'github-trending' }); isMobile && setSidebarCollapsed(true)"
              >
                GitHub 热门
              </button>
            </div>
          </div>

          <SidebarThreadTree :groups="projectGroups" :project-display-name-by-id="projectDisplayNameById"
            v-if="!isSidebarCollapsed"
            :selected-thread-id="selectedThreadId" :is-loading="isLoadingThreads"
            :search-query="sidebarSearchQuery"
            :search-matched-thread-ids="serverMatchedThreadIds"
            :desktop-list-parity="isMobile || isMobileShellAvailable"
            @select="onSelectThread"
            @archive="onArchiveThread" @start-new-thread="onStartNewThread" @rename-project="onRenameProject"
            @browse-thread-files="onBrowseThreadFiles"
            @rename-thread="onRenameThread"
            @fork-thread="onForkThread"
            @remove-project="onRemoveProject" @reorder-project="onReorderProject"
            @export-thread="onExportThread" />
        </div>

        <div v-if="!isSidebarCollapsed" ref="sidebarSettingsAreaRef" class="sidebar-settings-area">
          <Transition name="settings-mobile-backdrop">
            <button
              v-if="isSettingsOpen && isSettingsSheetMode"
              class="sidebar-settings-mobile-backdrop"
              type="button"
              aria-label="关闭设置"
              @click="isSettingsOpen = false"
            />
          </Transition>
          <Transition :name="isSettingsSheetMode ? 'settings-mobile-panel' : 'settings-panel'">
            <div
              v-if="isSettingsOpen"
              class="sidebar-settings-panel"
              :class="{ 'sidebar-settings-panel-mobile': isSettingsSheetMode }"
              :role="isSettingsSheetMode ? 'dialog' : undefined"
              :aria-modal="isSettingsSheetMode ? 'true' : undefined"
              aria-label="设置"
            >
              <div v-if="isSettingsSheetMode" class="sidebar-settings-mobile-handle" aria-hidden="true" />
              <div v-if="isSettingsSheetMode" class="sidebar-settings-mobile-header">
                <div class="sidebar-settings-mobile-copy">
                  <p class="sidebar-settings-mobile-title">设置</p>
                  <p class="sidebar-settings-mobile-subtitle">向上滑动查看全部内容</p>
                </div>
                <button
                  class="sidebar-settings-mobile-close"
                  type="button"
                  aria-label="关闭设置"
                  @click="isSettingsOpen = false"
                >
                  <IconTablerX class="sidebar-settings-mobile-close-icon" />
                </button>
              </div>
              <p class="sidebar-settings-section-title">基础设置</p>
              <button class="sidebar-settings-row" type="button" :title="SETTINGS_HELP.sendWithEnter" @click="toggleSendWithEnter">
                <span class="sidebar-settings-label">发送需按 ⌘ + Enter</span>
                <span class="sidebar-settings-toggle" :class="{ 'is-on': !sendWithEnter }" />
              </button>
              <button class="sidebar-settings-row" type="button" :title="SETTINGS_HELP.appearance" @click="cycleDarkMode">
                <span class="sidebar-settings-label">外观</span>
                <span class="sidebar-settings-value">{{ darkMode === 'system' ? '跟随系统' : darkMode === 'dark' ? '深色' : '浅色' }}</span>
              </button>
              <button class="sidebar-settings-row" type="button" :title="SETTINGS_HELP.dictationButtonVisible" @click="toggleDictationButtonVisible">
                <span class="sidebar-settings-label">显示语音按钮</span>
                <span class="sidebar-settings-toggle" :class="{ 'is-on': dictationButtonVisible }">
                  <IconTablerMicrophone class="sidebar-settings-toggle-icon" />
                </span>
              </button>
              <button class="sidebar-settings-row" type="button" :title="SETTINGS_HELP.dictationAutoSend" @click="toggleDictationAutoSend">
                <span class="sidebar-settings-label">听写后自动发送</span>
                <span class="sidebar-settings-toggle" :class="{ 'is-on': dictationAutoSend }" />
              </button>
              <button class="sidebar-settings-row" type="button" :title="SETTINGS_HELP.rollbackCommits" @click="toggleWorktreeGitAutomation">
                <span class="sidebar-settings-label">回滚时提交变更</span>
                <span class="sidebar-settings-toggle" :class="{ 'is-on': worktreeGitAutomationEnabled }" />
              </button>
              <button class="sidebar-settings-row" type="button" :title="SETTINGS_HELP.githubTrendingProjects" @click="toggleGithubTrendingProjects">
                <span class="sidebar-settings-label">GitHub 热门项目</span>
                <span class="sidebar-settings-toggle" :class="{ 'is-on': showGithubTrendingProjects }" />
              </button>
              <section class="sidebar-settings-section" aria-label="套餐余量">
                <p class="sidebar-settings-section-title">套餐余量</p>
                <div class="sidebar-settings-rate-limits">
                  <RateLimitStatus
                    v-if="accountRateLimitSnapshots.length > 0"
                    :snapshots="accountRateLimitSnapshots"
                  />
                  <p v-else class="sidebar-settings-hint sidebar-settings-hint-compact">
                    正在读取套餐余量...
                  </p>
                </div>
              </section>
              <section class="sidebar-settings-section" aria-label="权限控制">
                <p class="sidebar-settings-section-title">权限控制</p>
                <button class="sidebar-settings-row" type="button" :title="SETTINGS_HELP.allowAllPermissions" @click="toggleAllowAllPermissionRequests">
                  <span class="sidebar-settings-label">完全放行权限请求</span>
                  <span class="sidebar-settings-toggle" :class="{ 'is-on': webBridgeSettings.permissions.allowAllPermissionRequests }" />
                </button>
                <button
                  class="sidebar-settings-row"
                  type="button"
                  :title="SETTINGS_HELP.commandExecutionPermission"
                  :disabled="webBridgeSettings.permissions.allowAllPermissionRequests"
                  @click="cyclePermissionDecision('commandExecution')"
                >
                  <span class="sidebar-settings-label">命令执行权限</span>
                  <span class="sidebar-settings-value">{{ permissionDecisionLabel(webBridgeSettings.permissions.commandExecution) }}</span>
                </button>
                <button
                  class="sidebar-settings-row"
                  type="button"
                  :title="SETTINGS_HELP.fileChangePermission"
                  :disabled="webBridgeSettings.permissions.allowAllPermissionRequests"
                  @click="cyclePermissionDecision('fileChange')"
                >
                  <span class="sidebar-settings-label">文件变更权限</span>
                  <span class="sidebar-settings-value">{{ permissionDecisionLabel(webBridgeSettings.permissions.fileChange) }}</span>
                </button>
                <button
                  class="sidebar-settings-row"
                  type="button"
                  :title="SETTINGS_HELP.mcpToolPermission"
                  :disabled="webBridgeSettings.permissions.allowAllPermissionRequests"
                  @click="cyclePermissionDecision('mcpTools')"
                >
                  <span class="sidebar-settings-label">MCP 工具权限</span>
                  <span class="sidebar-settings-value">{{ permissionDecisionLabel(webBridgeSettings.permissions.mcpTools) }}</span>
                </button>
                <p class="sidebar-settings-hint">
                  {{ webBridgeSettings.permissions.allowAllPermissionRequests ? '当前会自动批准权限类请求。' : '可分别控制命令、文件和 MCP 工具权限。' }}
                </p>
                <p v-if="webBridgeSettingsStatus" class="sidebar-settings-hint sidebar-settings-hint-status">
                  {{ webBridgeSettingsStatus }}
                </p>
              </section>
              <section v-if="isMobileShellAvailable" class="sidebar-settings-section" aria-label="移动端连接">
                <p class="sidebar-settings-section-title">移动端连接</p>
                <div class="sidebar-settings-row sidebar-settings-row--static sidebar-settings-row--stacked">
                  <span class="sidebar-settings-label">当前地址</span>
                  <span class="sidebar-settings-code">{{ mobileShellServerUrlLabel }}</span>
                </div>
                <div class="sidebar-settings-row sidebar-settings-row--input">
                  <label class="sidebar-settings-field">
                    <span class="sidebar-settings-label">服务地址</span>
                    <input
                      v-model="mobileShellServerInput"
                      class="sidebar-settings-input"
                      type="url"
                      inputmode="url"
                      placeholder="https://your-codex-host.example.com:7420"
                      :disabled="isMobileShellSaving"
                    />
                  </label>
                </div>
                <div class="sidebar-settings-actions">
                  <button
                    class="sidebar-settings-github-button"
                    type="button"
                    :disabled="!canSaveMobileShellServerUrl"
                    @click="saveMobileShellServerAddress"
                  >
                    {{ isMobileShellSaving ? '保存中...' : '保存并重连' }}
                  </button>
                  <button
                    class="sidebar-settings-github-button sidebar-settings-github-button--secondary"
                    type="button"
                    :disabled="!canResetMobileShellServerUrl"
                    @click="restoreDefaultMobileShellServerAddress"
                  >
                    恢复默认
                  </button>
                  <button
                    class="sidebar-settings-github-button sidebar-settings-github-button--secondary"
                    type="button"
                    :disabled="!canOpenMobileShellServerUrl"
                    @click="openMobileShellServerUrl"
                  >
                    打开地址
                  </button>
                </div>
                <p class="sidebar-settings-hint">
                  {{ isMobileShellLoading ? '正在读取 App 当前连接地址...' : '保存后安卓 App 会自动重连到新地址。' }}
                </p>
                <p class="sidebar-settings-hint">
                  默认地址：{{ mobileShellDefaultUrlLabel }}
                </p>
                <div class="sidebar-settings-row sidebar-settings-row--static">
                  <span class="sidebar-settings-label">原生网络</span>
                  <span class="sidebar-settings-value">{{ mobileShellRuntimeNetworkLabel }}</span>
                </div>
                <div class="sidebar-settings-row sidebar-settings-row--static">
                  <span class="sidebar-settings-label">设备状态</span>
                  <span class="sidebar-settings-value">{{ mobileShellRuntimeDeviceLabel }}</span>
                </div>
                <div class="sidebar-settings-row sidebar-settings-row--static">
                  <span class="sidebar-settings-label">WebView</span>
                  <span class="sidebar-settings-value">{{ mobileShellRuntimeWebViewLabel }}</span>
                </div>
                <div class="sidebar-settings-row sidebar-settings-row--static">
                  <span class="sidebar-settings-label">通知权限</span>
                  <span class="sidebar-settings-value">{{ mobileShellNotificationPermissionLabel }}</span>
                </div>
                <div class="sidebar-settings-actions">
                  <button
                    class="sidebar-settings-github-button sidebar-settings-github-button--secondary"
                    type="button"
                    :disabled="!canRequestMobileShellNotifications"
                    @click="requestMobileShellNotifications"
                  >
                    {{ isMobileShellNotificationRequesting ? '请求中...' : '开启任务通知' }}
                  </button>
                  <button
                    class="sidebar-settings-github-button sidebar-settings-github-button--secondary"
                    type="button"
                    :disabled="isMobileShellNotificationRequesting"
                    @click="refreshMobileShellNotificationPermission"
                  >
                    重新检测
                  </button>
                </div>
                <p v-if="mobileShellStatus" class="sidebar-settings-hint sidebar-settings-hint-status">
                  {{ mobileShellStatus }}
                </p>
              </section>
              <section v-if="isMobileShellAvailable" class="sidebar-settings-section" aria-label="App 更新">
                <p class="sidebar-settings-section-title">App 更新</p>
                <div class="sidebar-settings-row sidebar-settings-row--static">
                  <span class="sidebar-settings-label">最新发布</span>
                  <span class="sidebar-settings-value">{{ mobileShellLatestVersionLabel }}</span>
                </div>
                <div class="sidebar-settings-row sidebar-settings-row--static sidebar-settings-row--stacked">
                  <span class="sidebar-settings-label">更新包</span>
                  <span class="sidebar-settings-code">{{ mobileShellLatestAssetLabel }}</span>
                </div>
                <div class="sidebar-settings-actions">
                  <button
                    class="sidebar-settings-github-button"
                    type="button"
                    :disabled="!canRunMobileShellUpdatePrimaryAction"
                    @click="runMobileShellUpdatePrimaryAction"
                  >
                    {{ mobileShellUpdatePrimaryButtonLabel }}
                  </button>
                  <button
                    class="sidebar-settings-github-button sidebar-settings-github-button--secondary"
                    type="button"
                    :disabled="isMobileShellUpdateLoading || isMobileShellInstalling"
                    @click="checkMobileShellUpdate({ showSuccessMessage: true, promptOnUpdate: true })"
                  >
                    重新检查
                  </button>
                  <button
                    class="sidebar-settings-github-button sidebar-settings-github-button--secondary"
                    type="button"
                    :disabled="!canOpenLatestMobileShellReleasePage"
                    @click="openLatestMobileShellReleasePage"
                  >
                    打开发布页
                  </button>
                </div>
                <p class="sidebar-settings-hint">
                  {{ mobileShellUpdateHint }}
                </p>
                <p v-if="mobileShellUpdateStatus" class="sidebar-settings-hint sidebar-settings-hint-status">
                  {{ mobileShellUpdateStatus }}
                </p>
              </section>
              <section class="sidebar-settings-section" aria-label="语音输入">
                <p class="sidebar-settings-section-title">语音输入</p>
              <div class="sidebar-settings-row sidebar-settings-row--select" :title="SETTINGS_HELP.dictationLanguage">
                <span class="sidebar-settings-label">听写语言</span>
                <ComposerDropdown
                  class="sidebar-settings-language-dropdown"
                  :model-value="dictationLanguage"
                  :options="dictationLanguageOptions"
                  placeholder="自动识别"
                  open-direction="up"
                  :enable-search="true"
                  search-placeholder="搜索语言..."
                  @update:model-value="onDictationLanguageChange"
                />
              </div>
              </section>
              <button
                v-if="isDesktopRefreshAvailable"
                class="sidebar-settings-row"
                type="button"
                :title="desktopRefreshButtonTitle"
                :disabled="!isDesktopRefreshAvailable || isDesktopRefreshRunning"
                @click="onRefreshDesktopApp"
              >
                <span class="sidebar-settings-label">刷新桌面端</span>
                <span class="sidebar-settings-value">{{ desktopRefreshButtonLabel }}</span>
              </button>
              <section class="sidebar-settings-about" aria-label="项目版本和 GitHub 仓库">
                <div class="sidebar-settings-brand-card">
                  <img class="sidebar-settings-brand-logo" :src="MOBILE_SHELL_BRANDING_LOGO_URL" alt="CX-Codex 标识" />
                  <div class="sidebar-settings-brand-copy">
                    <span class="sidebar-settings-brand-kicker">Android Shell</span>
                    <strong class="sidebar-settings-brand-title">{{ MOBILE_SHELL_BRAND_NAME }}</strong>
                    <span class="sidebar-settings-brand-subtitle">面向手机远程访问 Codex 的原生入口</span>
                  </div>
                </div>
                <div class="sidebar-settings-about-main">
                  <button
                    class="sidebar-settings-about-trigger"
                    type="button"
                    :disabled="isMobileShellUpdateLoading || isMobileShellInstalling"
                    :title="isMobileShellAvailable ? '点击检查 GitHub 新版本' : '打开 GitHub 发布页'"
                    @click="onOpenAppVersionDetails"
                  >
                    <div class="sidebar-settings-about-copy">
                      <span class="sidebar-settings-about-label">当前版本</span>
                      <strong class="sidebar-settings-about-version">{{ aboutAppVersionLabel }}</strong>
                      <span class="sidebar-settings-about-action">{{ mobileShellVersionActionLabel }}</span>
                    </div>
                    <span
                      v-if="isMobileShellAvailable && hasMobileShellUpdate"
                      class="sidebar-settings-about-update-badge"
                    >
                      新版本
                    </span>
                  </button>
                  <button
                    class="sidebar-settings-github-button"
                    type="button"
                    :title="SETTINGS_HELP.projectGithub"
                    @click="openProjectGithub"
                  >
                    打开 GitHub
                  </button>
                </div>
                <div class="sidebar-settings-about-meta">
                  <span>工作区</span>
                  <span>{{ displayWorktreeName }}</span>
                </div>
              </section>
            </div>
          </Transition>
          <button class="sidebar-settings-button" type="button" :aria-expanded="isSettingsOpen" @click="isSettingsOpen = !isSettingsOpen">
            <IconTablerSettings class="sidebar-settings-icon" />
            <span>设置</span>
          </button>
        </div>
      </section>
    </template>

    <template #content>
        <section
          id="main-content"
          class="content-root"
          :class="{ 'content-root--dual-pane-touch': isDualPaneMobile }"
          tabindex="-1"
        >
        <ContentHeader :title="contentTitle">
          <template #title-prefix>
          </template>
          <template #title-suffix>
            <button
              v-if="showMobileThreadRefreshButton"
              class="content-title-refresh-button"
              type="button"
              :data-busy="isManualThreadRefreshRunning ? 'true' : 'false'"
              :disabled="isManualThreadRefreshRunning"
              :title="mobileThreadRefreshButtonTitle"
              :aria-label="mobileThreadRefreshButtonTitle"
              @click="onRefreshSelectedThreadContent"
            >
              <IconTablerRefresh class="content-title-refresh-button-icon" />
            </button>
          </template>
          <template #subtitle>
            <p v-if="headerSubtitle" class="content-header-subtitle">{{ headerSubtitle }}</p>
          </template>
          <template #leading>
            <SidebarThreadControls
              v-if="isSidebarCollapsed || isMobile"
              class="sidebar-thread-controls-header-host"
              :is-sidebar-collapsed="isSidebarCollapsed"
              :show-new-thread-button="true"
              @toggle-sidebar="setSidebarCollapsed(!isSidebarCollapsed)"
              @start-new-thread="onStartNewThreadFromToolbar"
            />
          </template>
          <template #meta>
            <div class="content-meta-row" aria-live="polite">
            <span
              v-if="showContentContextBadge"
              class="content-context-badge"
              :data-tone="contentContextTone"
              :data-empty="!contentContextHasReliablePercent"
              :title="contentContextTooltip"
              :aria-label="contentContextAriaLabel"
            >
              <span class="content-context-badge-icon" aria-hidden="true">
                <svg class="content-context-badge-ring" viewBox="0 0 40 40">
                  <circle class="content-context-badge-track" cx="20" cy="20" r="16" />
                  <circle
                    class="content-context-badge-progress"
                    cx="20"
                    cy="20"
                    r="16"
                    :stroke-dasharray="contentContextRingDashArray"
                    :stroke-dashoffset="contentContextRingDashOffset"
                  />
                </svg>
              </span>
              <span class="content-context-badge-number">{{ contentContextPercentLabel }}</span>
            </span>
              <div class="content-status-strip">
                <span class="content-status-pill" :data-tone="contentStatusTone">
                  <span class="content-status-pill-label">{{ contentStatusCaption }}</span>
                  <span>{{ contentStatusLabel }}</span>
                </span>
                <span v-if="contentStatusDetail" class="content-status-detail">{{ contentStatusDetail }}</span>
              </div>
              <button
                v-if="showDesktopSyncNotice"
                class="content-desktop-sync-button"
                type="button"
                :data-busy="isDesktopRefreshRunning ? 'true' : 'false'"
                :disabled="isDesktopRefreshRunning"
                :title="desktopSyncNoticeTitle"
                :aria-label="desktopSyncNoticeTitle"
                @click="onRefreshDesktopApp"
              >
                <IconTablerRefresh class="content-desktop-sync-button-icon" />
                <span>{{ desktopSyncNoticeLabel }}</span>
              </button>
              <button
                class="content-favorites-button"
                type="button"
                title="查看全局收藏内容"
                aria-label="查看全局收藏内容"
                @click="isFavoritesModalVisible = true"
              >
                <IconTablerBookmark class="content-favorites-button-icon" :filled="favoriteCount > 0" />
                <span v-if="favoriteCount > 0" class="content-favorites-button-badge">{{ favoriteCount }}</span>
              </button>
            </div>
          </template>
        </ContentHeader>

        <RuntimeStatusBar
          v-if="showRuntimeStatusBar"
          class="content-runtime-status"
          :summary="selectedThreadRuntimeStatus"
          :live-overlay="selectedLiveOverlay"
          :pending-request-count="selectedThreadServerRequests.length"
          :is-sending="isSendingMessage"
          :is-loading="isLoadingMessages"
          :is-refreshing="isManualThreadRefreshRunning"
          :sync-lagging="syncLagging"
          :sync-error="syncError"
          :notification-stale="notificationStale"
          :connection-state="realtimeConnectionState"
          @refresh="onRefreshSelectedThreadContent"
          @stop="onInterruptTurn"
        />

        <section class="content-body">
          <template v-if="isSkillsRoute">
            <SkillsHub @skills-changed="onSkillsChanged" />
          </template>
          <template v-else-if="isGithubTrendingRoute">
            <GithubTrendingHub
              :projects="trendingProjects"
              :is-loading="isTrendingProjectsLoading"
              :scope="githubTipsScope"
              :scope-options="githubTipsScopeOptions"
              @update:scope="onGithubTipsScopeChange"
              @refresh="onRefreshTrendingProjects"
              @ask-project="onAskTrendingProject"
            />
          </template>
          <template v-else-if="isHomeRoute">
            <div class="content-grid">
              <div class="new-thread-empty">
                <p class="new-thread-hero">开始任务</p>
                <ComposerDropdown class="new-thread-folder-dropdown" :model-value="newThreadCwd"
                  :options="newThreadFolderOptions" placeholder="选择目录"
                  :enable-search="true"
                  search-placeholder="搜索项目"
                  :show-add-action="true"
                  add-action-label="+ 新建项目"
                  :default-add-value="defaultNewProjectName"
                  add-placeholder="项目名或绝对路径"
                  :disabled="false" @update:model-value="onSelectNewThreadFolder"
                  @add="onAddNewProject" />
                <ComposerRuntimeDropdown
                  class="new-thread-runtime-dropdown"
                  v-model="newThreadRuntime"
                />
                <div
                  v-if="worktreeInitStatus.phase !== 'idle'"
                  class="worktree-init-status"
                  :class="{
                    'is-running': worktreeInitStatus.phase === 'running',
                    'is-error': worktreeInitStatus.phase === 'error',
                  }"
                >
                  <strong class="worktree-init-status-title">{{ worktreeInitStatus.title }}</strong>
                  <span class="worktree-init-status-message">{{ worktreeInitStatus.message }}</span>
                </div>
              </div>

                <ThreadComposer ref="homeThreadComposerRef" :active-thread-id="composerThreadContextId"
                :cwd="composerCwd"
                :models="availableModelIds" :selected-model="selectedModelId"
                :selected-reasoning-effort="selectedReasoningEffort"
                :selected-speed-mode="selectedSpeedMode"
                :selected-collaboration-mode="selectedCollaborationMode"
                :is-updating-speed-mode="isUpdatingSpeedMode"
                :skills="installedSkills"
                :is-turn-in-progress="false"
                :is-interrupting-turn="false" :send-with-enter="sendWithEnter"
                :dictation-click-to-toggle="dictationClickToToggle" :dictation-auto-send="dictationAutoSend"
                :show-dictation-button="dictationButtonVisible"
                :prepend-draft-request="rollbackDraftPrependRequest"
                :dictation-language="dictationLanguage"
                @submit="onSubmitThreadMessage"
                @update:selected-model="onSelectModel"
                @update:selected-reasoning-effort="onSelectReasoningEffort"
                @update:selected-speed-mode="onSelectSpeedMode"
                @update:selected-collaboration-mode="onSelectCollaborationMode" />
            </div>
          </template>
          <template v-else>
            <div class="content-grid">
              <div class="content-thread">
                <ThreadConversation ref="threadConversationRef" :messages="displayedThreadMessages" :is-loading="isLoadingMessages"
                  :active-thread-id="displayedThreadConversationId" :cwd="displayedThreadCwd" :scroll-state="displayedThreadScrollState"
                  :live-overlay="displayedThreadLiveOverlay"
                  :pending-requests="displayedThreadPendingRequests"
                  :favorite-message-ids="favoriteMessageIdsForDisplayedThread"
                  :is-thread-switching="isThreadContentSwitching"
                  :show-empty-thread-actions="isRouteOnlyEmptyThread"
                  :is-turn-in-progress="isSelectedThreadInProgress"
                  :is-rolling-back="isRollingBack"
                  @update-scroll-state="onUpdateThreadScrollState"
                  @respond-server-request="onRespondServerRequest"
                  @toggle-favorite="onToggleFavoriteMessage"
                  @return-to-new-thread="onReturnToNewThreadFromEmptyThread"
                  @dismiss-empty-thread="onDismissEmptyThread"
                  @rollback="onRollback" />
              </div>

              <div class="composer-with-queue">
                <QueuedMessages
                  :messages="selectedThreadQueuedMessages"
                  :is-processing="selectedThreadQueueProcessing"
                  @edit="onEditQueuedMessage"
                  @quote="quoteQueuedMessage"
                  @delete="removeQueuedMessage"
                />
                <ThreadComposer ref="threadComposerRef" :active-thread-id="composerThreadContextId"
                  :cwd="composerCwd"
                  :models="availableModelIds"
                  :selected-model="selectedModelId"
                  :selected-reasoning-effort="selectedReasoningEffort"
                  :selected-speed-mode="selectedSpeedMode"
                  :selected-collaboration-mode="selectedCollaborationMode"
                  :is-updating-speed-mode="isUpdatingSpeedMode"
                  :skills="installedSkills"
                  :is-turn-in-progress="isSelectedThreadInterruptible" :is-interrupting-turn="isInterruptingTurn"
                  :has-queue-above="selectedThreadQueuedMessages.length > 0"
                  :send-with-enter="sendWithEnter"
                  :dictation-click-to-toggle="dictationClickToToggle" :dictation-auto-send="dictationAutoSend"
                  :show-dictation-button="dictationButtonVisible"
                  :prepend-draft-request="rollbackDraftPrependRequest"
                  :dictation-language="dictationLanguage"
                  @submit="onSubmitThreadMessage" @update:selected-model="onSelectModel"
                  @update:selected-reasoning-effort="onSelectReasoningEffort"
                  @update:selected-speed-mode="onSelectSpeedMode"
                  @update:selected-collaboration-mode="onSelectCollaborationMode"
                  @interrupt="onInterruptTurn" />
              </div>
            </div>
          </template>
        </section>
      </section>
    </template>
  </DesktopLayout>

  <Teleport to="body">
    <div
      v-if="isDesktopRefreshConfirmVisible"
      class="desktop-refresh-confirm-overlay"
      @click.self="closeDesktopRefreshConfirm"
    >
      <div class="desktop-refresh-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="desktop-refresh-confirm-title">
        <p class="desktop-refresh-confirm-kicker">确认刷新客户端</p>
        <h2 id="desktop-refresh-confirm-title" class="desktop-refresh-confirm-title">
          {{ desktopRefreshConfirmTitle }}
        </h2>
        <p class="desktop-refresh-confirm-text">
          {{ desktopRefreshConfirmMessage }}
        </p>
        <div class="desktop-refresh-confirm-actions">
          <button class="desktop-refresh-confirm-button" type="button" @click="closeDesktopRefreshConfirm">
            取消
          </button>
          <button
            class="desktop-refresh-confirm-button desktop-refresh-confirm-button-primary"
            :class="{ 'desktop-refresh-confirm-button-warning': isDesktopRefreshRiskHigh }"
            type="button"
            @click="confirmDesktopRefresh"
          >
            {{ isDesktopRefreshRiskHigh ? '仍然刷新' : '刷新桌面端' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <Teleport to="body">
    <Transition name="product-toast">
      <div v-if="productToast" class="product-toast" :data-tone="productToast.tone" role="status" aria-live="polite">
        {{ productToast.message }}
      </div>
    </Transition>
  </Teleport>

  <Teleport to="body">
    <div
      v-if="isMobileShellUpdatePromptVisible"
      class="mobile-update-confirm-overlay"
      @click.self="closeMobileShellUpdatePrompt"
    >
      <div class="mobile-update-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="mobile-update-confirm-title">
        <p class="mobile-update-confirm-kicker">发现新版本</p>
        <h2 id="mobile-update-confirm-title" class="mobile-update-confirm-title">
          {{ mobileShellUpdatePromptTitle }}
        </h2>
        <p class="mobile-update-confirm-text">
          {{ mobileShellUpdatePromptText }}
        </p>
        <div class="mobile-update-confirm-meta">
          <span>当前安装 {{ mobileShellInstalledVersionLabel }}</span>
          <span>{{ mobileShellUpdatePublishedAtLabel }}</span>
        </div>
        <div class="mobile-update-confirm-meta">
          <span>更新包</span>
          <span>{{ mobileShellLatestAssetLabel }}</span>
        </div>
        <div class="mobile-update-confirm-meta">
          <span>大小</span>
          <span>{{ mobileShellUpdateAssetSizeLabel }}</span>
        </div>
        <div class="mobile-update-confirm-actions">
          <button class="mobile-update-confirm-button" type="button" @click="closeMobileShellUpdatePrompt">
            稍后再说
          </button>
          <button
            class="mobile-update-confirm-button mobile-update-confirm-button-primary"
            type="button"
            :disabled="!canInstallLatestMobileShellRelease"
            @click="confirmLatestMobileShellReleaseInstall"
          >
            {{ mobileShellInstallButtonLabel }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <FavoritesModal
    :visible="isFavoritesModalVisible"
    :favorites="displayFavorites"
    :active-thread-id="displayedThreadConversationId"
    :status-text="favoritesStatusText"
    @close="closeFavoritesModal"
    @copy="onCopyFavorite"
    @open="onOpenFavorite"
    @remove="onRemoveFavorite"
  />
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DesktopLayout from './components/layout/DesktopLayout.vue'
import SidebarThreadTree from './components/sidebar/SidebarThreadTree.vue'
import ContentHeader from './components/content/ContentHeader.vue'
import ThreadConversation from './components/content/ThreadConversation.vue'
import ThreadComposer from './components/content/ThreadComposer.vue'
import QueuedMessages from './components/content/QueuedMessages.vue'
import RateLimitStatus from './components/content/RateLimitStatus.vue'
import RuntimeStatusBar from './components/content/RuntimeStatusBar.vue'
import ComposerDropdown from './components/content/ComposerDropdown.vue'
import SidebarThreadControls from './components/sidebar/SidebarThreadControls.vue'
import FavoritesModal from './components/content/FavoritesModal.vue'
import IconTablerBroom from './components/icons/IconTablerBroom.vue'
import IconTablerBookmark from './components/icons/IconTablerBookmark.vue'
import IconTablerMicrophone from './components/icons/IconTablerMicrophone.vue'
import IconTablerRefresh from './components/icons/IconTablerRefresh.vue'
import IconTablerSearch from './components/icons/IconTablerSearch.vue'
import IconTablerSettings from './components/icons/IconTablerSettings.vue'
import IconTablerX from './components/icons/IconTablerX.vue'
import { useDesktopState } from './composables/useDesktopState'
import { useFavorites, type FavoriteRecord } from './composables/useFavorites'
import { useMobile } from './composables/useMobile'
import {
  createWorktree,
  getDesktopAppStatus,
  getGithubProjectsForScope,
  getHomeDirectory,
  getProjectRootSuggestion,
  getWebBridgeSettings,
  getWorkspaceRootsState,
  openProjectRoot,
  refreshDesktopApp,
  searchThreads,
  updateWebBridgeSettings,
} from './api/codexGateway'
import type { CollaborationMode, ReasoningEffort, SpeedMode, ThreadScrollState, UiLiveOverlay, UiMessage, UiServerRequest, UiThread } from './types/codex'
import type { ComposerDraftPayload, SubmitPayload, ThreadComposerExposed } from './components/content/ThreadComposer.vue'
import type { ThreadConversationExposed } from './components/content/ThreadConversation.vue'
import type {
  DesktopAppStatus,
  GithubTipsScope,
  GithubTrendingProject,
  PermissionDecision,
  WebBridgeSettings,
} from './api/codexGateway'
import { getPathLeafName, getPathParent } from './pathUtils.js'
import {
  getMobileShellAppInfo,
  getMobileShellNotificationPermissionStatus,
  getMobileShellRuntimeInfo,
  getMobileShellServerConfig,
  installMobileShellApk,
  isNativeAndroidShell,
  openMobileShellUrl,
  requestMobileShellNotificationPermission,
  resetMobileShellServerUrl,
  setMobileShellServerUrl,
  type MobileShellAppInfo,
  type MobileShellNotificationPermissionStatus,
  type MobileShellRuntimeInfo,
  type MobileShellServerConfig,
} from './mobile/mobileShell'
import {
  compareMobileReleaseVersions,
  fetchLatestMobileRelease,
  getMobileReleasesPageUrl,
  isMobileReleaseUpdateAvailable,
  type MobileLatestRelease,
} from './mobile/mobileRelease'

const SkillsHub = defineAsyncComponent(() => import('./components/content/SkillsHub.vue'))
const GithubTrendingHub = defineAsyncComponent(() => import('./components/content/GithubTrendingHub.vue'))
const ComposerRuntimeDropdown = defineAsyncComponent(() => import('./components/content/ComposerRuntimeDropdown.vue'))

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'codex-web-local.sidebar-collapsed.v1'
const worktreeName = import.meta.env.VITE_WORKTREE_NAME ?? 'unknown'
const appVersion = import.meta.env.VITE_APP_VERSION ?? 'unknown'
const PROJECT_GITHUB_URL = 'https://github.com/Qjzn/CX-Codex'
const MOBILE_SHELL_BRAND_NAME = 'CX-Codex'
const MOBILE_SHELL_BRANDING_LOGO_URL = '/branding/cx-codex-logo.png'
const CONTEXT_RING_RADIUS = 16
const CONTEXT_RING_CIRCUMFERENCE = 2 * Math.PI * CONTEXT_RING_RADIUS
const DEFAULT_WEB_BRIDGE_SETTINGS: WebBridgeSettings = {
  permissions: {
    allowAllPermissionRequests: false,
    commandExecution: 'allowForSession',
    fileChange: 'allowForSession',
    mcpTools: 'ask',
  },
}
const SETTINGS_HELP = {
  sendWithEnter: '开启后直接按 Enter 发送，关闭后使用 Command + Enter 发送。',
  appearance: '在跟随系统、浅色和深色之间切换。',
  dictationButtonVisible: '控制输入框右侧是否显示语音按钮。',
  dictationAutoSend: '录音结束后自动发送转写内容。',
  rollbackCommits: '开启后每条消息都会生成回滚提交，回滚时会重置到该消息之前的提交。',
  githubTrendingProjects: '显示或隐藏侧栏里的 GitHub 热门页面入口。',
  dictationLanguage: '选择转写语言，或保持自动识别。',
  allowAllPermissions: '开启后自动批准命令执行、文件变更和 MCP 工具权限请求。',
  commandExecutionPermission: '控制 Codex 请求运行命令时是否自动允许。',
  fileChangePermission: '控制 Codex 请求写入文件时是否自动允许。',
  mcpToolPermission: '控制 MCP 服务请求运行工具时是否自动允许，例如浏览器自动化工具。',
  projectGithub: '在新标签页打开当前项目的 GitHub 仓库。',
} as const
const WHISPER_LANGUAGES: Record<string, string> = {
  en: 'english',
  zh: 'chinese',
  de: 'german',
  es: 'spanish',
  ru: 'russian',
  ko: 'korean',
  fr: 'french',
  ja: 'japanese',
  pt: 'portuguese',
  tr: 'turkish',
  pl: 'polish',
  ca: 'catalan',
  nl: 'dutch',
  ar: 'arabic',
  sv: 'swedish',
  it: 'italian',
  id: 'indonesian',
  hi: 'hindi',
  fi: 'finnish',
  vi: 'vietnamese',
  he: 'hebrew',
  uk: 'ukrainian',
  el: 'greek',
  ms: 'malay',
  cs: 'czech',
  ro: 'romanian',
  da: 'danish',
  hu: 'hungarian',
  ta: 'tamil',
  no: 'norwegian',
  th: 'thai',
  ur: 'urdu',
  hr: 'croatian',
  bg: 'bulgarian',
  lt: 'lithuanian',
  la: 'latin',
  mi: 'maori',
  ml: 'malayalam',
  cy: 'welsh',
  sk: 'slovak',
  te: 'telugu',
  fa: 'persian',
  lv: 'latvian',
  bn: 'bengali',
  sr: 'serbian',
  az: 'azerbaijani',
  sl: 'slovenian',
  kn: 'kannada',
  et: 'estonian',
  mk: 'macedonian',
  br: 'breton',
  eu: 'basque',
  is: 'icelandic',
  hy: 'armenian',
  ne: 'nepali',
  mn: 'mongolian',
  bs: 'bosnian',
  kk: 'kazakh',
  sq: 'albanian',
  sw: 'swahili',
  gl: 'galician',
  mr: 'marathi',
  pa: 'punjabi',
  si: 'sinhala',
  km: 'khmer',
  sn: 'shona',
  yo: 'yoruba',
  so: 'somali',
  af: 'afrikaans',
  oc: 'occitan',
  ka: 'georgian',
  be: 'belarusian',
  tg: 'tajik',
  sd: 'sindhi',
  gu: 'gujarati',
  am: 'amharic',
  yi: 'yiddish',
  lo: 'lao',
  uz: 'uzbek',
  fo: 'faroese',
  ht: 'haitian creole',
  ps: 'pashto',
  tk: 'turkmen',
  nn: 'nynorsk',
  mt: 'maltese',
  sa: 'sanskrit',
  lb: 'luxembourgish',
  my: 'myanmar',
  bo: 'tibetan',
  tl: 'tagalog',
  mg: 'malagasy',
  as: 'assamese',
  tt: 'tatar',
  haw: 'hawaiian',
  ln: 'lingala',
  ha: 'hausa',
  ba: 'bashkir',
  jw: 'javanese',
  su: 'sundanese',
  yue: 'cantonese',
}

const tokenCountFormatter = new Intl.NumberFormat('zh-CN')

function formatTokenCount(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  return tokenCountFormatter.format(Math.max(0, Math.round(value)))
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(value, 0), 100)
}

function humanizeActivityLabel(raw: string): string {
  const label = raw.trim()
  if (!label) return ''

  if (/等待授权|waiting for approval|approval required/iu.test(label)) return '等待确认'
  if (/等待确认|requires confirmation|needs confirmation/iu.test(label)) return '等待确认'
  if (/等待输入|request user input|needs input/iu.test(label)) return '等待补充'
  if (/等待处理|pending request/iu.test(label)) return '等待处理'
  if (/执行命令|running command|executing command/iu.test(label)) return '执行命令'
  if (/writing response|thinking|reasoning|整理回复|思考/iu.test(label)) return '思考中'

  return label
}

const {
  projectGroups,
  projectDisplayNameById,
  selectedThread,
  selectedThreadScrollState,
  selectedThreadServerRequests,
  selectedLiveOverlay,
  selectedThreadRuntimeStatus,
  selectedThreadTokenUsage,
  selectedThreadId,
  availableModelIds,
  selectedModelId,
  selectedReasoningEffort,
  selectedSpeedMode,
  selectedCollaborationMode,
  installedSkills,
  accountRateLimitSnapshots,
  messages,
  isLoadingThreads,
  isLoadingMessages,
  isSendingMessage,
  isInterruptingTurn,
  isUpdatingSpeedMode,
  notificationStale,
  realtimeConnectionState,
  syncLagging,
  syncError,
  refreshAll,
  refreshSelectedThreadContent,
  refreshSkills,
  refreshRateLimits,
  selectThread,
  setThreadScrollState,
  archiveThreadById,
  dismissThreadLocally,
  forkThreadById,
  renameThreadById,
  sendMessageToSelectedThread,
  sendMessageToNewThread,
  interruptSelectedThreadTurn,
  rollbackSelectedThread,
  isRollingBack,
  selectedThreadExecutionActive,
  selectedThreadCanStop,
  selectedThreadQueuedMessages,
  selectedThreadQueueProcessing,
  removeQueuedMessage,
  quoteQueuedMessage,
  markAllThreadsAsRead,
  setSelectedModelId,
  setWorktreeGitAutomationEnabled,
  setSelectedReasoningEffort,
  setSelectedCollaborationMode,
  updateSelectedSpeedMode,
  respondToPendingServerRequest,
  renameProject,
  removeProject,
  reorderProject,
  pinProjectToTop,
  startPolling,
  stopPolling,
} = useDesktopState()

const route = useRoute()
const router = useRouter()
const { isMobile, isDualPaneMobile } = useMobile()
const isSettingsSheetMode = computed(() => isMobile.value || isDualPaneMobile.value)
const { favorites, toggleFavorite, removeFavorite, refreshFavorites } = useFavorites()
const homeThreadComposerRef = ref<ThreadComposerExposed | null>(null)
const threadComposerRef = ref<ThreadComposerExposed | null>(null)
const threadConversationRef = ref<ThreadConversationExposed | null>(null)
const sidebarSettingsAreaRef = ref<HTMLElement | null>(null)
const trendingProjects = ref<GithubTrendingProject[]>([])
const isTrendingProjectsLoading = ref(false)
const githubTipsScope = ref<GithubTipsScope>('trending-daily')
const lastLoadedGithubTipsScope = ref<GithubTipsScope | ''>('')
const isManualThreadRefreshRunning = ref(false)
const editingQueuedMessageState = ref<{ threadId: string; queueIndex: number } | null>(null)
const isRouteSyncInProgress = ref(false)
const hasInitialized = ref(false)
const routeWarmThreadIds = ref<string[]>([])
const newThreadCwd = ref('')
const newThreadRuntime = ref<'local' | 'worktree'>('local')
const workspaceRootOptionsState = ref<{ order: string[]; labels: Record<string, string> }>({ order: [], labels: {} })
const worktreeInitStatus = ref<{ phase: 'idle' | 'running' | 'error'; title: string; message: string }>({
  phase: 'idle',
  title: '',
  message: '',
})
const isSidebarCollapsed = ref(loadSidebarCollapsed())
const isFavoritesModalVisible = ref(false)
const favoritesStatusText = ref('')
const productToast = ref<{ id: number; message: string; tone: 'success' | 'info' | 'warning' | 'danger' } | null>(null)
const pendingFavoriteJump = ref<{ threadId: string; messageId: string } | null>(null)
const sidebarSearchQuery = ref('')
const isSidebarSearchVisible = ref(false)
const sidebarSearchInputRef = ref<HTMLInputElement | null>(null)
const serverMatchedThreadIds = ref<string[] | null>(null)
let threadSearchTimer: ReturnType<typeof setTimeout> | null = null
const defaultNewProjectName = ref('New Project (1)')
const homeDirectory = ref('')
const isSettingsOpen = ref(false)
const SEND_WITH_ENTER_KEY = 'codex-web-local.send-with-enter.v1'
const DARK_MODE_KEY = 'codex-web-local.dark-mode.v1'
const DICTATION_CLICK_TO_TOGGLE_KEY = 'codex-web-local.dictation-click-to-toggle.v1'
const DICTATION_BUTTON_VISIBLE_KEY = 'codex-web-local.dictation-button-visible.v1'
const DICTATION_AUTO_SEND_KEY = 'codex-web-local.dictation-auto-send.v1'
const DICTATION_LANGUAGE_KEY = 'codex-web-local.dictation-language.v1'
const WORKTREE_GIT_AUTOMATION_KEY = 'codex-web-local.worktree-git-automation.v1'
const GITHUB_TRENDING_PROJECTS_KEY = 'codex-web-local.github-trending-projects.v1'
const sendWithEnter = ref(loadBoolPref(SEND_WITH_ENTER_KEY, true))
const darkMode = ref<'system' | 'light' | 'dark'>(loadDarkModePref())
const dictationClickToToggle = ref(loadBoolPref(DICTATION_CLICK_TO_TOGGLE_KEY, false))
const dictationButtonVisible = ref(loadBoolPref(DICTATION_BUTTON_VISIBLE_KEY, true))
const rollbackDraftPrependRequest = ref<{ id: number; text: string } | null>(null)
let rollbackDraftPrependRequestId = 0
const dictationAutoSend = ref(loadBoolPref(DICTATION_AUTO_SEND_KEY, true))
const dictationLanguage = ref(loadDictationLanguagePref())
const dictationLanguageOptions = computed(() => buildDictationLanguageOptions())
const worktreeGitAutomationEnabled = ref(loadBoolPref(WORKTREE_GIT_AUTOMATION_KEY, true))
const showGithubTrendingProjects = ref(loadBoolPref(GITHUB_TRENDING_PROJECTS_KEY, true))
const webBridgeSettings = ref<WebBridgeSettings>(DEFAULT_WEB_BRIDGE_SETTINGS)
const webBridgeSettingsStatus = ref('')
let webBridgeSettingsStatusTimer: ReturnType<typeof setTimeout> | null = null
let favoritesStatusTimer: ReturnType<typeof setTimeout> | null = null
let productToastTimer: number | null = null
function isBundledMobileShellEntry(): boolean {
  if (!isNativeAndroidShell() || typeof window === 'undefined') return false
  const hostname = window.location.hostname.toLowerCase()
  return window.location.protocol === 'capacitor:' || hostname === 'localhost' || hostname === '127.0.0.1'
}

const startsOnBundledMobileShellEntry = isBundledMobileShellEntry()
const isMobileShellAvailable = ref(isNativeAndroidShell())
const mobileShellSetupChecked = ref(!isNativeAndroidShell() || startsOnBundledMobileShellEntry)
const mobileShellServerConfig = ref<MobileShellServerConfig | null>(null)
const mobileShellAppInfo = ref<MobileShellAppInfo | null>(null)
const mobileShellRuntimeInfo = ref<MobileShellRuntimeInfo | null>(null)
const mobileShellNotificationPermission = ref<MobileShellNotificationPermissionStatus | null>(null)
const mobileShellLatestRelease = ref<MobileLatestRelease | null>(null)
const mobileShellServerInput = ref('')
const mobileShellStatus = ref('')
const mobileShellUpdateStatus = ref('')
const isMobileShellLoading = ref(false)
const isMobileShellSaving = ref(false)
const isMobileShellUpdateLoading = ref(false)
const isMobileShellInstalling = ref(false)
const isMobileShellNotificationRequesting = ref(false)
const isMobileShellUpdatePromptVisible = ref(false)
let mobileShellStatusTimer: ReturnType<typeof setTimeout> | null = null
let mobileShellUpdateStatusTimer: ReturnType<typeof setTimeout> | null = null
const desktopAppStatus = ref<DesktopAppStatus>({
  available: false,
  platform: '',
  appInstalled: false,
  appRunning: false,
  appUserModelId: '',
  reason: '',
})
const isDesktopRefreshRunning = ref(false)
const isDesktopRefreshConfirmVisible = ref(false)
const desktopSyncPendingThreadId = ref('')
const desktopSyncPendingAtMs = ref(0)

const routeThreadId = computed(() => {
  const rawThreadId = route.params.threadId
  return typeof rawThreadId === 'string' ? rawThreadId : ''
})

const knownThreadIdSet = computed(() => {
  const ids = new Set<string>()
  for (const group of projectGroups.value) {
    for (const thread of group.threads) {
      ids.add(thread.id)
    }
  }
  return ids
})
const routableThreadIdSet = computed(() => {
  const ids = new Set<string>(knownThreadIdSet.value)
  for (const threadId of routeWarmThreadIds.value) {
    ids.add(threadId)
  }
  return ids
})

const isHomeRoute = computed(() => route.name === 'home')
const isSkillsRoute = computed(() => route.name === 'skills')
const isGithubTrendingRoute = computed(() => route.name === 'github-trending')
const isNonThreadRoute = computed(() => (
  isHomeRoute.value || isSkillsRoute.value || isGithubTrendingRoute.value
))
const displayAppVersion = computed(() => {
  const version = String(appVersion).trim()
  if (!version || version === 'unknown') return '未知版本'
  return version.replace(/^v/i, '')
})
const displayWorktreeName = computed(() => {
  const name = String(worktreeName).trim()
  return name && name !== 'unknown' ? name : '默认工作区'
})
const mobileShellServerUrlLabel = computed(() => (
  mobileShellServerConfig.value?.serverUrl.trim() || '未配置'
))
const isMobileShellConfigBooting = computed(() => (
  isMobileShellAvailable.value
  && !mobileShellSetupChecked.value
))
const requiresMobileShellServerSetup = computed(() => (
  isMobileShellAvailable.value
  && mobileShellSetupChecked.value
  && !(mobileShellServerConfig.value?.serverUrl.trim())
))
const mobileShellDefaultUrlLabel = computed(() => (
  mobileShellServerConfig.value?.defaultServerUrl.trim() || '未配置'
))
const mobileShellRuntimeNetworkLabel = computed(() => {
  const runtime = mobileShellRuntimeInfo.value
  if (!runtime) return '未读取'
  const state = runtime.connected ? (runtime.validated ? '可用' : '待验证') : '离线'
  const transportLabels: Record<string, string> = {
    wifi: 'Wi-Fi',
    cellular: '蜂窝',
    ethernet: '以太网',
    vpn: 'VPN',
    bluetooth: '蓝牙',
    usb: 'USB',
    none: '无网络',
    unknown: '未知',
  }
  const transport = transportLabels[runtime.transport] ?? runtime.transport
  return `${state} · ${transport}${runtime.metered ? ' · 计费网络' : ''}`
})
const mobileShellRuntimeDeviceLabel = computed(() => {
  const runtime = mobileShellRuntimeInfo.value
  if (!runtime) return '未读取'
  const model = [runtime.manufacturer, runtime.model]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
  return `${model || 'Android'} · ${runtime.powerSaveMode ? '省电模式' : '标准模式'}`
})
const mobileShellRuntimeWebViewLabel = computed(() => {
  const runtime = mobileShellRuntimeInfo.value
  if (!runtime) return '未读取'
  const version = runtime.webViewVersion.trim()
  if (version) return version
  return runtime.webViewPackage.trim() || `Android ${runtime.sdkInt}`
})
const mobileShellNotificationPermissionLabel = computed(() => {
  const permission = mobileShellNotificationPermission.value
  if (!permission) return '未读取'
  if (permission.granted) return '已允许'
  if (!permission.notificationsEnabled) return '系统已关闭'
  return permission.requiresRuntimePermission ? '待授权' : '未允许'
})
const canRequestMobileShellNotifications = computed(() => (
  isMobileShellAvailable.value
  && !isMobileShellNotificationRequesting.value
  && mobileShellNotificationPermission.value?.granted !== true
))
const normalizedMobileShellServerInput = computed(() => normalizeUrlInput(mobileShellServerInput.value))
const canSaveMobileShellServerUrl = computed(() => {
  if (!isMobileShellAvailable.value || isMobileShellSaving.value) return false
  const nextUrl = normalizedMobileShellServerInput.value
  if (!nextUrl) return false
  return nextUrl !== mobileShellServerConfig.value?.serverUrl.trim()
})
const canResetMobileShellServerUrl = computed(() => (
  isMobileShellAvailable.value
  && !isMobileShellSaving.value
  && mobileShellServerConfig.value?.usingDefault === false
))
const canOpenMobileShellServerUrl = computed(() => (
  mobileShellServerConfig.value?.serverUrl.trim().length
    ? true
    : false
))
const mobileShellInstalledVersionLabel = computed(() => {
  const version = mobileShellAppInfo.value?.versionName.trim() || ''
  if (!version) return '未读取'
  return version.startsWith('v') ? version : `v${version}`
})
const aboutAppVersionLabel = computed(() => (
  isMobileShellAvailable.value
    ? mobileShellInstalledVersionLabel.value
    : displayAppVersion.value
))
const mobileShellLatestVersionLabel = computed(() => {
  const tagName = mobileShellLatestRelease.value?.tagName.trim() || ''
  if (!tagName) return isMobileShellUpdateLoading.value ? '检查中' : '未检测到'
  return tagName
})
const mobileShellLatestAssetLabel = computed(() => (
  mobileShellLatestRelease.value?.asset?.name.trim()
  || '当前发布页还没有 Android APK'
))
const hasMobileShellUpdate = computed(() => (
  isMobileReleaseUpdateAvailable(
    mobileShellAppInfo.value?.versionName ?? '',
    mobileShellLatestRelease.value?.tagName ?? '',
  )
))
const mobileShellReleaseComparison = computed(() => {
  const installed = mobileShellAppInfo.value?.versionName ?? ''
  const latest = mobileShellLatestRelease.value?.tagName ?? ''
  if (!installed.trim() || !latest.trim()) return 0
  return compareMobileReleaseVersions(installed, latest)
})
const mobileShellVersionActionLabel = computed(() => {
  if (!isMobileShellAvailable.value) return '打开 GitHub 发布页'
  if (isMobileShellInstalling.value) return '正在下载安装...'
  if (isMobileShellUpdateLoading.value) return '正在检查新版本...'
  if (hasMobileShellUpdate.value) return `发现 ${mobileShellLatestVersionLabel.value}，点击更新`
  if (mobileShellReleaseComparison.value > 0) return '当前安装包比 GitHub 更新'
  return '点击检查 GitHub 更新'
})
const canInstallLatestMobileShellRelease = computed(() => (
  isMobileShellAvailable.value
  && !isMobileShellInstalling.value
  && !isMobileShellUpdateLoading.value
  && !!mobileShellLatestRelease.value?.asset?.downloadUrl
))
const canRunMobileShellUpdatePrimaryAction = computed(() => (
  isMobileShellAvailable.value
  && !isMobileShellInstalling.value
  && !isMobileShellUpdateLoading.value
))
const canOpenLatestMobileShellReleasePage = computed(() => (
  (mobileShellLatestRelease.value?.htmlUrl.trim() || getMobileReleasesPageUrl()).length > 0
))
const mobileShellUpdatePrimaryButtonLabel = computed(() => {
  if (isMobileShellInstalling.value) return '下载安装中...'
  if (isMobileShellUpdateLoading.value) return '检查中...'
  if (!mobileShellLatestRelease.value?.tagName.trim()) return '检查更新'
  if (!mobileShellLatestRelease.value?.asset?.downloadUrl) return '重新检查'
  return hasMobileShellUpdate.value ? '下载并安装' : '重新安装'
})
const mobileShellInstallButtonLabel = computed(() => {
  if (isMobileShellInstalling.value) return '下载安装中...'
  if (!mobileShellLatestRelease.value?.asset?.downloadUrl) return '暂无安装包'
  return hasMobileShellUpdate.value ? '下载并安装' : '重新安装'
})
const mobileShellUpdatePromptTitle = computed(() => {
  if (mobileShellLatestRelease.value?.releaseName.trim()) {
    return mobileShellLatestRelease.value.releaseName.trim()
  }
  if (mobileShellLatestRelease.value?.tagName.trim()) {
    return `CX-Codex ${mobileShellLatestRelease.value.tagName.trim()}`
  }
  return 'CX-Codex 新版本'
})
const mobileShellUpdatePublishedAtLabel = computed(() => {
  const iso = mobileShellLatestRelease.value?.publishedAtIso.trim() || ''
  if (!iso) return '发布时间未知'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '发布时间未知'
  return `发布于 ${date.toLocaleString()}`
})
const mobileShellUpdateAssetSizeLabel = computed(() => {
  const size = mobileShellLatestRelease.value?.asset?.size ?? 0
  return formatFileSize(size)
})
const mobileShellUpdatePromptText = computed(() => {
  if (mobileShellLatestRelease.value?.asset?.name.trim()) {
    return `检测到 ${mobileShellLatestVersionLabel.value}，确认后会直接下载 ${mobileShellLatestRelease.value.asset.name.trim()} 并拉起系统安装界面。`
  }
  return `检测到 ${mobileShellLatestVersionLabel.value}，确认后会直接下载并打开系统安装界面。`
})
const mobileShellUpdateHint = computed(() => {
  if (isMobileShellUpdateLoading.value) return '正在读取 GitHub 最新发布信息...'
  if (!mobileShellLatestRelease.value?.asset) return '发布页还没有可直接安装的 Android APK。'
  if (hasMobileShellUpdate.value) return '检测到新版本后，可直接下载并拉起系统安装界面。'
  if (mobileShellReleaseComparison.value > 0) return '当前安装版比 GitHub 最新发布更高，通常说明你还没有把新 APK 发到 Release。'
  return '当前安装版已与最新发布一致，如需覆盖安装也可以直接重新安装。'
})
const isRouteOnlyEmptyThread = computed(() => (
  route.name === 'thread'
  && !!routeThreadId.value
  && !selectedThread.value
  && filteredMessages.value.length === 0
  && selectedThreadServerRequests.value.length === 0
))
const contentTitle = computed(() => {
  if (isSkillsRoute.value) return '技能'
  if (isGithubTrendingRoute.value) return 'GitHub 热门'
  if (isHomeRoute.value) return '新会话'
  if (isRouteOnlyEmptyThread.value) return '空会话'
  return selectedThread.value?.title ?? '选择会话'
})
const browserHostName =
  typeof window !== 'undefined'
    ? (window.location.hostname || window.location.host || 'cx-codex')
    : 'cx-codex'
const pageTitle = computed(() => {
  const threadTitle = selectedThread.value?.title?.trim() ?? ''
  return threadTitle || browserHostName
})
const headerSubtitle = computed(() => {
  if (isSkillsRoute.value) return '管理已安装技能和当前运行能力。'
  if (isGithubTrendingRoute.value) return '浏览热门仓库、查看介绍，并直接带着项目链接发起提问。'
  if (isHomeRoute.value) return '从已配置工作区快速发起新的 Codex 任务。'
  if (isRouteOnlyEmptyThread.value) return '这个会话还没有消息，你可以直接发送第一条消息，或将它移除。'
  const cwd = selectedThread.value?.cwd?.trim() ?? ''
  return cwd || ''
})
const showMobileThreadRefreshButton = computed(() => (
  route.name === 'thread'
  && selectedThreadId.value.trim().length > 0
))
const showRuntimeStatusBar = computed(() => (
  route.name === 'thread'
  && selectedThreadId.value.trim().length > 0
  && !isRouteOnlyEmptyThread.value
))
const mobileThreadRefreshButtonTitle = computed(() => (
  isManualThreadRefreshRunning.value ? '正在强制恢复当前会话状态...' : '强制恢复当前会话状态'
))
const contentContextUsage = computed(() => {
  if (isNonThreadRoute.value || isRouteOnlyEmptyThread.value) return null
  if (!selectedThread.value) return null
  return selectedThreadTokenUsage.value
})
const showContentContextBadge = computed(() => (
  !isNonThreadRoute.value &&
  !isRouteOnlyEmptyThread.value &&
  Boolean(selectedThread.value)
))
const contentContextHasReliablePercent = computed(() => (
  typeof contentContextUsage.value?.usedPercent === 'number'
))
const contentContextPercent = computed<number | null>(() => (
  contentContextHasReliablePercent.value
    ? clampPercent(contentContextUsage.value?.usedPercent ?? 0)
    : null
))
const contentContextUsedTokens = computed<number | null>(() => {
  if (!contentContextUsage.value) return null
  const currentTokens = Math.max(contentContextUsage.value.last.totalTokens, 0)
  if (
    typeof contentContextUsage.value.modelContextWindow === 'number' &&
    contentContextUsage.value.modelContextWindow > 0
  ) {
    return Math.min(currentTokens, contentContextUsage.value.modelContextWindow)
  }
  return currentTokens > 0 ? currentTokens : null
})
const contentContextPercentLabel = computed(() => (
  typeof contentContextPercent.value === 'number'
    ? String(Math.round(contentContextPercent.value))
    : '--'
))
const contentContextRingDashArray = `${CONTEXT_RING_CIRCUMFERENCE} ${CONTEXT_RING_CIRCUMFERENCE}`
const contentContextRingDashOffset = computed(() => {
  const progress =
    typeof contentContextPercent.value === 'number'
      ? contentContextPercent.value / 100
      : 0
  return CONTEXT_RING_CIRCUMFERENCE * (1 - progress)
})
const contentContextTone = computed<'live' | 'warning' | 'danger'>(() => {
  if (typeof contentContextPercent.value !== 'number') return 'warning'
  if (contentContextPercent.value >= 90) return 'danger'
  if (contentContextPercent.value >= 70) return 'warning'
  return 'live'
})
const contentContextTooltip = computed(() => {
  if (!contentContextUsage.value) return '当前会话上下文统计暂未就绪，稍后会自动补齐。'
  const totalTokens = formatTokenCount(contentContextUsage.value.total.totalTokens)
  const currentContextTokens =
    typeof contentContextUsedTokens.value === 'number'
      ? formatTokenCount(contentContextUsedTokens.value)
      : null
  const cumulativeTokens =
    contentContextUsage.value.total.totalTokens > contentContextUsage.value.last.totalTokens
      ? `，累计 ${totalTokens}`
      : ''
  if (
    typeof contentContextPercent.value === 'number' &&
    typeof contentContextUsage.value.modelContextWindow === 'number' &&
    contentContextUsage.value.modelContextWindow > 0
  ) {
    const contextWindow = formatTokenCount(contentContextUsage.value.modelContextWindow)
    const usedTokens = currentContextTokens ?? formatTokenCount(contentContextUsage.value.last.totalTokens)
    return `上下文已使用 ${Math.round(contentContextPercent.value)}%，已用 ${usedTokens} / ${contextWindow}${cumulativeTokens}`
  }
  if (typeof contentContextUsage.value.modelContextWindow === 'number' && contentContextUsage.value.modelContextWindow > 0) {
    const contextWindow = formatTokenCount(contentContextUsage.value.modelContextWindow)
    return `当前上下文已用 ${currentContextTokens ?? '未知'} / ${contextWindow}${cumulativeTokens}。百分比会按客户端同口径继续补齐。`
  }
  return `当前会话累计已使用 ${totalTokens} tokens，上下文窗口大小暂未提供`
})
const contentContextAriaLabel = computed(() => {
  if (!contentContextUsage.value) return '当前会话上下文统计暂未就绪'
  return contentContextTooltip.value
})
const threadById = computed<Record<string, UiThread>>(() => {
  const next: Record<string, UiThread> = {}
  for (const group of projectGroups.value) {
    for (const thread of group.threads) {
      next[thread.id] = thread
    }
  }
  return next
})
const displayedThreadTitle = computed(() => (
  threadById.value[displayedThreadConversationId.value]?.title
  ?? selectedThread.value?.title
  ?? ''
))
const hasActiveSyncDemand = computed(() => {
  if (isLoadingMessages.value || isSendingMessage.value) return true
  if (selectedThreadExecutionActive.value) return true
  if (selectedThread.value?.unread) return true
  if (selectedThreadServerRequests.value.length > 0) return true
  return false
})
const serviceStatusTone = computed<'live' | 'syncing' | 'warning' | 'danger'>(() => {
  if (syncError.value.trim().length > 0) return 'danger'
  if (realtimeConnectionState.value === 'disconnected' && hasActiveSyncDemand.value) return 'danger'
  if (realtimeConnectionState.value === 'connecting') return 'syncing'
  if (realtimeConnectionState.value === 'reconnecting' && hasActiveSyncDemand.value) return 'warning'
  if (syncLagging.value && hasActiveSyncDemand.value) return 'warning'
  if (notificationStale.value && hasActiveSyncDemand.value) return 'warning'
  if (isLoadingMessages.value || isSendingMessage.value) return 'syncing'
  return 'live'
})
const serviceStatusLabel = computed(() => {
  if (syncError.value.trim().length > 0) return '同步异常'
  if (realtimeConnectionState.value === 'disconnected' && hasActiveSyncDemand.value) return '连接中断'
  if (realtimeConnectionState.value === 'connecting') return '连接中'
  if (realtimeConnectionState.value === 'reconnecting' && hasActiveSyncDemand.value) return '正在恢复'
  if (syncLagging.value && hasActiveSyncDemand.value) return '补同步中'
  if (notificationStale.value && hasActiveSyncDemand.value) return '补同步中'
  if (realtimeConnectionState.value === 'reconnecting' || realtimeConnectionState.value === 'disconnected') return '自动同步中'
  if (notificationStale.value) return '连接正常'
  if (isLoadingMessages.value || isSendingMessage.value) return '同步中'
  return '连接正常'
})
const serviceStatusDetail = computed(() => {
  if (syncError.value.trim().length > 0) return syncError.value.trim()
  if (realtimeConnectionState.value === 'disconnected' && hasActiveSyncDemand.value) return '实时通道暂时断开，页面会自动重连并补齐最新内容。'
  if (realtimeConnectionState.value === 'connecting') return '正在建立实时连接。'
  if (realtimeConnectionState.value === 'reconnecting' && hasActiveSyncDemand.value) return '实时通道正在恢复，页面会继续补拉最新进度。'
  if (syncLagging.value && hasActiveSyncDemand.value) return '检测到内容偏旧，页面正在主动补同步。'
  if (notificationStale.value && hasActiveSyncDemand.value) return '页面正在主动校验任务状态并补齐新输出。'
  if (selectedThreadServerRequests.value.length > 0) return '当前任务需要你的确认或补充，处理后会自动继续。'
  if (realtimeConnectionState.value === 'reconnecting' || realtimeConnectionState.value === 'disconnected') return '网络或通知恢复后会自动加载最新内容。'
  if (notificationStale.value) return '当前没有进行中的任务，页面会在回到前台或网络恢复时自动同步。'
  if (selectedLiveOverlay.value?.activityLabel) return humanizeActivityLabel(selectedLiveOverlay.value.activityLabel)
  return '实时连接正常。'
})
const filteredMessages = computed(() =>
  messages.value.filter((message) => {
    const type = normalizeMessageType(message.messageType, message.role)
    if (type === 'worked') return true
    if (type === 'commandExecution') return message.commandExecution?.status === 'inProgress'
    if (type === 'turnActivity.live' || type === 'turnError.live' || type === 'agentReasoning.live') return false
    return true
  }),
)
const latestUserTurnIndex = computed(() => {
  let latest = -1
  for (const message of messages.value) {
    if (message.role !== 'user') continue
    if (typeof message.turnIndex !== 'number') continue
    if (message.turnIndex > latest) latest = message.turnIndex
  }
  return latest
})
const liveOverlay = computed(() => selectedLiveOverlay.value)
const composerThreadContextId = computed(() => (isHomeRoute.value ? '__new-thread__' : selectedThreadId.value))
const composerCwd = computed(() => {
  if (isHomeRoute.value) return newThreadCwd.value.trim()
  return selectedThread.value?.cwd?.trim() ?? ''
})
const displayedThreadConversationId = ref('')
const displayedThreadCwd = ref('')
const displayedThreadMessages = ref<UiMessage[]>([])
const displayedThreadPendingRequests = ref<UiServerRequest[]>([])
const displayedThreadLiveOverlay = ref<UiLiveOverlay | null>(null)
const displayedThreadScrollState = ref<ThreadScrollState | null>(null)
const isThreadContentSwitching = ref(false)
const favoriteMessageIdsForDisplayedThread = computed(() => {
  const threadId = displayedThreadConversationId.value.trim()
  if (!threadId) return []
  const ids: string[] = []
  for (const entry of favorites.value) {
    if (entry.threadId !== threadId) continue
    ids.push(entry.messageId)
  }
  return ids
})
const favoriteCount = computed(() => favorites.value.length)
const displayFavorites = computed<FavoriteRecord[]>(() => (
  favorites.value.map((record) => {
    const latestThread = threadById.value[record.threadId]
    if (!latestThread) return record
    const nextTitle = latestThread.title.trim() || record.threadTitle
    const nextCwd = latestThread.cwd.trim() || record.threadCwd
    if (nextTitle === record.threadTitle && nextCwd === record.threadCwd) return record
    return {
      ...record,
      threadTitle: nextTitle,
      threadCwd: nextCwd,
    }
  })
))
const isSelectedThreadInProgress = computed(() => !isHomeRoute.value && selectedThreadExecutionActive.value)
const isSelectedThreadInterruptible = computed(() => !isHomeRoute.value && selectedThreadCanStop.value)
const shouldShowSelectedThreadProcessing = computed(() => (
  selectedThreadServerRequests.value.length > 0 ||
  selectedLiveOverlay.value !== null ||
  isSelectedThreadInProgress.value
))
const threadStatusLabel = computed(() => {
  if (isNonThreadRoute.value) return ''
  if (isRouteOnlyEmptyThread.value) return '空会话'
  if (!selectedThread.value) return ''
  if (selectedThreadServerRequests.value.length > 0) {
    return humanizeActivityLabel(selectedLiveOverlay.value?.activityLabel ?? '') || '等待处理'
  }
  if (shouldShowSelectedThreadProcessing.value) {
    return humanizeActivityLabel(selectedLiveOverlay.value?.activityLabel ?? '') || '处理中'
  }
  if (selectedThread.value.unread) return '有新进展'
  return '就绪'
})
const desktopStatusTone = computed<'live' | 'syncing' | 'warning' | 'danger'>(() => {
  if (isDesktopRefreshRunning.value) return 'syncing'
  if (desktopAppStatus.value.available) return 'live'
  return 'warning'
})
const desktopStatusLabel = computed(() => {
  if (isDesktopRefreshRunning.value) return '刷新中'
  if (desktopAppStatus.value.available) return desktopAppStatus.value.appRunning ? '已连接' : '未开启'
  return '不可用'
})
const showDesktopStatusPill = computed(() => (
  !isMobileShellAvailable.value &&
  (
    isDesktopRefreshRunning.value ||
    !desktopAppStatus.value.available ||
    !desktopAppStatus.value.appRunning
  )
))
const showServiceStatusDetail = computed(() => (
  serviceStatusDetail.value.trim().length > 0 &&
  serviceStatusTone.value !== 'live'
))
const contentStatusTone = computed<'live' | 'syncing' | 'warning' | 'danger'>(() => {
  if (selectedThreadServerRequests.value.length > 0) return 'warning'
  if (shouldShowSelectedThreadProcessing.value) return 'syncing'
  if (serviceStatusTone.value !== 'live') return serviceStatusTone.value
  if (isRouteOnlyEmptyThread.value) return 'live'
  if (selectedThread.value?.unread) return 'warning'
  if (showDesktopStatusPill.value) return desktopStatusTone.value
  return 'live'
})
const contentStatusCaption = computed(() => {
  if (selectedThreadServerRequests.value.length > 0 || shouldShowSelectedThreadProcessing.value || isRouteOnlyEmptyThread.value || selectedThread.value?.unread) {
    return '会话'
  }
  if (showDesktopStatusPill.value && serviceStatusTone.value === 'live') {
    return '桌面端'
  }
  return '同步'
})
const contentStatusLabel = computed(() => {
  if (selectedThreadServerRequests.value.length > 0) return threadStatusLabel.value || '等待处理'
  if (shouldShowSelectedThreadProcessing.value) return threadStatusLabel.value || '处理中'
  if (isRouteOnlyEmptyThread.value) return '空会话'
  if (selectedThread.value?.unread) return '有新进展'
  if (showDesktopStatusPill.value && serviceStatusTone.value === 'live') return desktopStatusLabel.value
  return serviceStatusLabel.value
})
const contentStatusDetail = computed(() => {
  if (selectedThreadServerRequests.value.length > 0) {
    return '这条任务现在卡在你的确认或补充输入，处理后会继续推进。'
  }
  if (shouldShowSelectedThreadProcessing.value) {
    return humanizeActivityLabel(selectedLiveOverlay.value?.activityLabel ?? '') || '当前任务仍在继续处理。'
  }
  if (serviceStatusTone.value !== 'live' && showServiceStatusDetail.value) {
    return serviceStatusDetail.value
  }
  if (showDesktopStatusPill.value && serviceStatusTone.value === 'live') {
    if (isDesktopRefreshRunning.value) return '桌面端正在刷新，完成后会自动恢复连接。'
    if (!desktopAppStatus.value.available) return '当前未检测到可用桌面端，Web 端仍可单独使用。'
    if (!desktopAppStatus.value.appRunning) return '桌面端可用但当前未运行，需要时可从设置里手动刷新。'
  }
  return ''
})
const newThreadFolderOptions = computed(() => {
  const options: Array<{ value: string; label: string }> = []
  const seenCwds = new Set<string>()

  for (const cwdRaw of workspaceRootOptionsState.value.order) {
    const cwd = cwdRaw.trim()
    if (!cwd || seenCwds.has(cwd)) continue
    seenCwds.add(cwd)
    options.push({
      value: cwd,
      label: workspaceRootOptionsState.value.labels[cwd] || getPathLeafName(cwd),
    })
  }

  for (const group of projectGroups.value) {
    const cwd = group.threads[0]?.cwd?.trim() ?? ''
    if (!cwd || seenCwds.has(cwd)) continue
    seenCwds.add(cwd)
    options.push({
      value: cwd,
      label: projectDisplayNameById.value[group.projectName] ?? group.projectName,
    })
  }

  const selectedCwd = newThreadCwd.value.trim()
  if (selectedCwd && !seenCwds.has(selectedCwd)) {
    options.unshift({
      value: selectedCwd,
      label: getPathLeafName(selectedCwd),
    })
  }

  return options
})
const darkModeMediaQuery = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null
const githubTipsScopeOptions = computed<Array<{ value: GithubTipsScope; label: string }>>(() => [
  { value: 'search-daily', label: '搜索日报' },
  { value: 'search-weekly', label: '搜索周榜' },
  { value: 'search-monthly', label: '搜索月榜' },
  { value: 'trending-daily', label: '趋势日报' },
  { value: 'trending-weekly', label: '趋势周榜' },
  { value: 'trending-monthly', label: '趋势月榜' },
])

watch(
  () => [
    composerThreadContextId.value,
    composerCwd.value,
    filteredMessages.value,
    selectedThreadServerRequests.value,
    liveOverlay.value,
    selectedThreadScrollState.value,
    isLoadingMessages.value,
    isHomeRoute.value,
  ] as const,
  ([
    nextThreadId,
    nextCwd,
    nextMessages,
    nextPendingRequests,
    nextLiveOverlay,
    nextScrollState,
    loading,
    homeRoute,
  ]) => {
    const hasDisplayedConversation =
      displayedThreadMessages.value.length > 0 ||
      displayedThreadPendingRequests.value.length > 0 ||
      displayedThreadLiveOverlay.value !== null
    const hasNextConversation =
      nextMessages.length > 0 ||
      nextPendingRequests.length > 0 ||
      nextLiveOverlay !== null

    if (!nextThreadId || homeRoute) {
      isThreadContentSwitching.value = false
      displayedThreadConversationId.value = nextThreadId
      displayedThreadCwd.value = nextCwd
      displayedThreadMessages.value = [...nextMessages]
      displayedThreadPendingRequests.value = [...nextPendingRequests]
      displayedThreadLiveOverlay.value = nextLiveOverlay
      displayedThreadScrollState.value = nextScrollState
      return
    }

    const isSwitchingToAnotherThread = displayedThreadConversationId.value !== '' && displayedThreadConversationId.value !== nextThreadId
    if (loading && isSwitchingToAnotherThread && hasDisplayedConversation) {
      if (!hasNextConversation) {
        displayedThreadConversationId.value = nextThreadId
        displayedThreadCwd.value = nextCwd
        displayedThreadMessages.value = []
        displayedThreadPendingRequests.value = []
        displayedThreadLiveOverlay.value = null
        displayedThreadScrollState.value = nextScrollState
        isThreadContentSwitching.value = false
        return
      }
      isThreadContentSwitching.value = true
      return
    }

    displayedThreadConversationId.value = nextThreadId
    displayedThreadCwd.value = nextCwd
    displayedThreadMessages.value = [...nextMessages]
    displayedThreadPendingRequests.value = [...nextPendingRequests]
    displayedThreadLiveOverlay.value = nextLiveOverlay
    displayedThreadScrollState.value = nextScrollState
    isThreadContentSwitching.value = false
  },
  { immediate: true },
)

watch(
  () => [
    pendingFavoriteJump.value?.threadId ?? '',
    pendingFavoriteJump.value?.messageId ?? '',
    displayedThreadConversationId.value,
    displayedThreadMessages.value.length,
    isLoadingMessages.value,
    isThreadContentSwitching.value,
  ] as const,
  ([pendingThreadId, pendingMessageId, currentThreadId, _messageCount, loading, switching]) => {
    if (!pendingThreadId || !pendingMessageId) return
    if (loading || switching) return
    if (pendingThreadId !== currentThreadId) return
    void tryFocusPendingFavoriteJump()
  },
)
const isDesktopRefreshAvailable = computed(() => desktopAppStatus.value.available)
const desktopRefreshButtonTitle = computed(() => {
  if (desktopAppStatus.value.available) {
    return '关闭并重开官方 Codex 桌面端，让它重新载入 Web 侧最新会话。'
  }
  return desktopAppStatus.value.reason || '当前机器无法刷新官方 Codex 桌面端。'
})
const desktopRefreshButtonLabel = computed(() => (
  isDesktopRefreshRunning.value ? '刷新中...' : '刷新桌面端'
))
const showDesktopSyncNotice = computed(() => (
  !isMobileShellAvailable.value &&
  desktopSyncPendingThreadId.value.trim().length > 0 &&
  desktopAppStatus.value.available
))
const desktopSyncNoticeLabel = computed(() => (
  isDesktopRefreshRunning.value
    ? '同步中'
    : desktopAppStatus.value.appRunning ? '桌面待同步' : '打开桌面端'
))
const desktopSyncNoticeTitle = computed(() => {
  if (isDesktopRefreshRunning.value) return '正在刷新官方 Codex 桌面端。'
  const elapsedMs = desktopSyncPendingAtMs.value > 0 ? Date.now() - desktopSyncPendingAtMs.value : 0
  const elapsedText = elapsedMs > 60_000 ? `，已等待 ${Math.max(1, Math.round(elapsedMs / 60_000))} 分钟` : ''
  const actionText = desktopAppStatus.value.appRunning ? '关闭并重开桌面端' : '打开桌面端'
  return `Web 端已发送新任务${elapsedText}。官方桌面端不会实时接收 7420 的任务事件，点击后会${actionText}以载入最新会话。`
})
const hasUnreadThreads = computed(() =>
  projectGroups.value.some((group) => group.threads.some((thread) => thread.unread)),
)
const isDesktopRefreshRiskHigh = computed(() => (
  selectedThread.value?.inProgress === true || selectedLiveOverlay.value !== null
))
const desktopRefreshConfirmTitle = computed(() => (
  isDesktopRefreshRiskHigh.value
    ? '刷新桌面端可能中断当前任务。'
    : '是否刷新官方 Codex 桌面端？'
))
const desktopRefreshConfirmMessage = computed(() => (
  isDesktopRefreshRiskHigh.value
    ? '这会关闭并重开当前机器上的官方 Codex 桌面端。桌面端正在执行的任务可能会停止，7420 网页端不会关闭。'
    : '这会关闭并重开官方 Codex 桌面端，让它重新载入最新的本地会话记录。'
))

type IdleSchedulerWindow = Window & typeof globalThis & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
  cancelIdleCallback?: (handle: number) => void
}

let idleTaskCancels: Array<() => void> = []
let pendingTrendingProjectsCancel: (() => void) | null = null
let trendingProjectsRequestToken = 0

function scheduleIdleTask(task: () => void, timeoutMs = 1200): (() => void) {
  if (typeof window === 'undefined') {
    task()
    return () => {}
  }

  const idleWindow = window as IdleSchedulerWindow
  if (typeof idleWindow.requestIdleCallback === 'function' && typeof idleWindow.cancelIdleCallback === 'function') {
    const handle = idleWindow.requestIdleCallback(task, { timeout: timeoutMs })
    return () => idleWindow.cancelIdleCallback?.(handle)
  }

  const handle = window.setTimeout(task, Math.min(Math.max(Math.round(timeoutMs / 3), 120), 420))
  return () => window.clearTimeout(handle)
}

function queueIdleTask(task: () => void, timeoutMs = 1200): void {
  idleTaskCancels.push(scheduleIdleTask(task, timeoutMs))
}

function clearQueuedIdleTasks(): void {
  for (const cancel of idleTaskCancels) {
    cancel()
  }
  idleTaskCancels = []
}

function cancelPendingTrendingProjectsLoad(): void {
  pendingTrendingProjectsCancel?.()
  pendingTrendingProjectsCancel = null
}

function scheduleTrendingProjectsLoad(priority: 'idle' | 'immediate' = 'idle'): void {
  if (!showGithubTrendingProjects.value || !isGithubTrendingRoute.value) return
  const targetScope = githubTipsScope.value
  if (
    lastLoadedGithubTipsScope.value === targetScope &&
    trendingProjects.value.length > 0 &&
    !isTrendingProjectsLoading.value
  ) {
    return
  }

  cancelPendingTrendingProjectsLoad()
  const run = () => {
    pendingTrendingProjectsCancel = null
    void loadTrendingProjects(targetScope)
  }

  if (priority === 'immediate') {
    run()
    return
  }

  pendingTrendingProjectsCancel = scheduleIdleTask(run, 1800)
}

onMounted(() => {
  window.addEventListener('keydown', onWindowKeyDown)
  window.addEventListener('focus', onWindowFocusRefreshAccountState)
  applyDarkMode()
  darkModeMediaQuery?.addEventListener('change', applyDarkMode)
  void initializeRuntime()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onWindowKeyDown)
  window.removeEventListener('focus', onWindowFocusRefreshAccountState)
  window.removeEventListener('pointerdown', onWindowPointerDownForSettings, { capture: true })
  darkModeMediaQuery?.removeEventListener('change', applyDarkMode)
  clearQueuedIdleTasks()
  cancelPendingTrendingProjectsLoad()
  if (threadSearchTimer) {
    clearTimeout(threadSearchTimer)
    threadSearchTimer = null
  }
  if (webBridgeSettingsStatusTimer) {
    clearTimeout(webBridgeSettingsStatusTimer)
    webBridgeSettingsStatusTimer = null
  }
  if (mobileShellStatusTimer) {
    clearTimeout(mobileShellStatusTimer)
    mobileShellStatusTimer = null
  }
  if (mobileShellUpdateStatusTimer) {
    clearTimeout(mobileShellUpdateStatusTimer)
    mobileShellUpdateStatusTimer = null
  }
  if (favoritesStatusTimer) {
    clearTimeout(favoritesStatusTimer)
    favoritesStatusTimer = null
  }
  if (productToastTimer) {
    clearTimeout(productToastTimer)
    productToastTimer = null
  }
  stopPolling()
})

function onWindowFocusRefreshAccountState(): void {
  if (requiresMobileShellServerSetup.value) return
  void refreshFavorites()
  if (isSettingsOpen.value) {
    void refreshRateLimits()
  }
}

watch(sidebarSearchQuery, (value) => {
  const query = value.trim()
  if (threadSearchTimer) {
    clearTimeout(threadSearchTimer)
    threadSearchTimer = null
  }
  if (!query) {
    serverMatchedThreadIds.value = null
    return
  }
  if (query.length < 2) {
    serverMatchedThreadIds.value = null
    return
  }

  threadSearchTimer = setTimeout(() => {
    void searchThreads(query, 1000)
      .then((result) => {
        if (sidebarSearchQuery.value.trim() !== query) return
        serverMatchedThreadIds.value = result.threadIds
      })
      .catch(() => {
        if (sidebarSearchQuery.value.trim() !== query) return
        serverMatchedThreadIds.value = null
      })
  }, 280)
})

watch(isSettingsOpen, (open) => {
  if (open) {
    void refreshWebBridgeSettings()
    void refreshRateLimits({ force: true })
    void refreshMobileShellServerConfig({ preserveInput: true })
    void refreshMobileShellRuntimeInfo()
    void refreshMobileShellNotificationPermission()
    void refreshMobileShellUpdateState()
    window.addEventListener('pointerdown', onWindowPointerDownForSettings, { capture: true })
    return
  }
  window.removeEventListener('pointerdown', onWindowPointerDownForSettings, { capture: true })
})

watch(isFavoritesModalVisible, (visible) => {
  if (!visible) return
  void refreshFavorites()
})

function onSkillsChanged(): void {
  void refreshSkills()
}

function onMarkAllThreadsRead(): void {
  markAllThreadsAsRead()
}

function setWebBridgeSettingsStatus(message: string): void {
  webBridgeSettingsStatus.value = message
  if (webBridgeSettingsStatusTimer) {
    clearTimeout(webBridgeSettingsStatusTimer)
    webBridgeSettingsStatusTimer = null
  }
  if (!message) return
  webBridgeSettingsStatusTimer = setTimeout(() => {
    webBridgeSettingsStatus.value = ''
    webBridgeSettingsStatusTimer = null
  }, 2200)
}

function setMobileShellStatus(message: string): void {
  mobileShellStatus.value = message
  if (mobileShellStatusTimer) {
    clearTimeout(mobileShellStatusTimer)
    mobileShellStatusTimer = null
  }
  if (!message) return
  mobileShellStatusTimer = setTimeout(() => {
    mobileShellStatus.value = ''
    mobileShellStatusTimer = null
  }, 2600)
}

function setMobileShellUpdateStatus(message: string): void {
  mobileShellUpdateStatus.value = message
  if (mobileShellUpdateStatusTimer) {
    clearTimeout(mobileShellUpdateStatusTimer)
    mobileShellUpdateStatusTimer = null
  }
  if (!message) return
  mobileShellUpdateStatusTimer = setTimeout(() => {
    mobileShellUpdateStatus.value = ''
    mobileShellUpdateStatusTimer = null
  }, 8000)
}

function normalizeUrlInput(value: string): string {
  let normalized = value.trim()
  while (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1)
  }
  return normalized
}

function formatFileSize(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '未知大小'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  const precision = unitIndex === 0 ? 0 : unitIndex === 1 ? 1 : 2
  return `${size.toFixed(precision)} ${units[unitIndex]}`
}

function setFavoritesStatusText(message: string): void {
  favoritesStatusText.value = message
  if (favoritesStatusTimer) {
    clearTimeout(favoritesStatusTimer)
    favoritesStatusTimer = null
  }
  if (!message) return
  favoritesStatusTimer = setTimeout(() => {
    favoritesStatusText.value = ''
    favoritesStatusTimer = null
  }, 2200)
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
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

async function refreshWebBridgeSettings(): Promise<void> {
  try {
    webBridgeSettings.value = await getWebBridgeSettings()
  } catch (error) {
    const message = error instanceof Error ? error.message : '加载权限设置失败'
    setWebBridgeSettingsStatus(message)
  }
}

async function saveWebBridgeSettings(nextSettings: WebBridgeSettings): Promise<void> {
  webBridgeSettings.value = nextSettings
  setWebBridgeSettingsStatus('正在保存权限设置...')
  try {
    webBridgeSettings.value = await updateWebBridgeSettings(nextSettings)
    setWebBridgeSettingsStatus('权限设置已保存')
  } catch (error) {
    const message = error instanceof Error ? error.message : '保存权限设置失败'
    setWebBridgeSettingsStatus(message)
    void refreshWebBridgeSettings()
  }
}

async function refreshMobileShellServerConfig(options: { preserveInput?: boolean } = {}): Promise<void> {
  if (!isMobileShellAvailable.value) return

  isMobileShellLoading.value = true
  try {
    const config = await getMobileShellServerConfig()
    mobileShellServerConfig.value = config
    if (!options.preserveInput || !normalizeUrlInput(mobileShellServerInput.value)) {
      mobileShellServerInput.value = config.serverUrl
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '读取移动端连接地址失败'
    setMobileShellStatus(message)
  } finally {
    mobileShellSetupChecked.value = true
    isMobileShellLoading.value = false
  }
}

async function refreshMobileShellRuntimeInfo(): Promise<void> {
  if (!isMobileShellAvailable.value) return

  try {
    mobileShellRuntimeInfo.value = await getMobileShellRuntimeInfo()
  } catch {
    mobileShellRuntimeInfo.value = null
  }
}

async function refreshMobileShellNotificationPermission(): Promise<void> {
  if (!isMobileShellAvailable.value) return

  try {
    mobileShellNotificationPermission.value = await getMobileShellNotificationPermissionStatus()
  } catch {
    mobileShellNotificationPermission.value = null
  }
}

async function requestMobileShellNotifications(): Promise<void> {
  if (!isMobileShellAvailable.value || isMobileShellNotificationRequesting.value) return

  isMobileShellNotificationRequesting.value = true
  try {
    mobileShellNotificationPermission.value = await requestMobileShellNotificationPermission()
    window.setTimeout(() => { void refreshMobileShellNotificationPermission() }, 900)
  } catch (error) {
    const message = error instanceof Error ? error.message : '请求通知权限失败'
    setMobileShellStatus(message)
  } finally {
    isMobileShellNotificationRequesting.value = false
  }
}

async function openLatestMobileShellReleasePage(): Promise<void> {
  const targetUrl = mobileShellLatestRelease.value?.htmlUrl.trim() || getMobileReleasesPageUrl()
  if (!targetUrl) {
    setMobileShellUpdateStatus('当前没有可打开的发布页地址')
    return
  }
  if (isMobileShellAvailable.value) {
    try {
      const result = await openMobileShellUrl(targetUrl)
      setMobileShellUpdateStatus(result.opened ? '已打开 GitHub 发布页' : '系统没有返回打开结果，请检查浏览器')
      return
    } catch (error) {
      const message = error instanceof Error ? error.message : '打开 GitHub 发布页失败'
      setMobileShellUpdateStatus(message)
      return
    }
  }

  const popup = window.open(targetUrl, '_blank', 'noopener,noreferrer')
  if (!popup) {
    setMobileShellUpdateStatus('浏览器阻止了新窗口，请允许弹窗后重试')
  }
}

async function refreshMobileShellUpdateState(showSuccessMessage = false): Promise<void> {
  if (!isMobileShellAvailable.value) return

  isMobileShellUpdateLoading.value = true
  try {
    const [appInfo, latestRelease] = await Promise.all([
      getMobileShellAppInfo(),
      fetchLatestMobileRelease(),
    ])
    mobileShellAppInfo.value = appInfo
    mobileShellLatestRelease.value = latestRelease
    if (showSuccessMessage) {
      if (!latestRelease.asset) {
        setMobileShellUpdateStatus('已读取最新发布，但暂未发现 Android 安装包')
      } else if (isMobileReleaseUpdateAvailable(appInfo.versionName, latestRelease.tagName)) {
        setMobileShellUpdateStatus(`检测到新版本 ${latestRelease.tagName}`)
      } else {
        setMobileShellUpdateStatus('当前已是最新版本')
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '读取 App 更新状态失败'
    setMobileShellUpdateStatus(message)
  } finally {
    isMobileShellUpdateLoading.value = false
  }
}

async function checkMobileShellUpdate(options: { showSuccessMessage?: boolean; promptOnUpdate?: boolean } = {}): Promise<void> {
  const { showSuccessMessage = false, promptOnUpdate = false } = options
  await refreshMobileShellUpdateState(showSuccessMessage)
  if (
    promptOnUpdate
    && hasMobileShellUpdate.value
    && mobileShellLatestRelease.value?.asset?.downloadUrl
  ) {
    isMobileShellUpdatePromptVisible.value = true
  }
}

async function runMobileShellUpdatePrimaryAction(): Promise<void> {
  if (!canRunMobileShellUpdatePrimaryAction.value) return

  const hasReleaseInfo = mobileShellLatestRelease.value?.tagName.trim().length
  if (!hasReleaseInfo || !mobileShellLatestRelease.value?.asset?.downloadUrl) {
    await checkMobileShellUpdate({ showSuccessMessage: true, promptOnUpdate: true })
    return
  }

  if (hasMobileShellUpdate.value) {
    isMobileShellUpdatePromptVisible.value = true
    return
  }

  await installLatestMobileShellRelease()
}

async function refreshDesktopAppAvailability(): Promise<void> {
  try {
    desktopAppStatus.value = await getDesktopAppStatus()
  } catch (error) {
    const message = error instanceof Error ? error.message : '加载桌面端状态失败'
    desktopAppStatus.value = {
      available: false,
      platform: '',
      appInstalled: false,
      appRunning: false,
      appUserModelId: '',
      reason: message,
    }
  }
}

function onRefreshDesktopApp(): void {
  if (isDesktopRefreshRunning.value) return
  if (!desktopAppStatus.value.available) {
    window.alert(desktopAppStatus.value.reason || '当前机器无法刷新官方 Codex 桌面端。')
    return
  }

  isDesktopRefreshConfirmVisible.value = true
}

async function openMobileShellServerUrl(): Promise<void> {
  const url = mobileShellServerConfig.value?.serverUrl.trim() || ''
  if (!url) {
    setMobileShellStatus('当前没有可打开的连接地址')
    return
  }
  if (isMobileShellAvailable.value) {
    try {
      const result = await openMobileShellUrl(url)
      setMobileShellStatus(result.opened ? '已打开当前连接地址' : '系统没有返回打开结果，请检查浏览器')
      return
    } catch (error) {
      const message = error instanceof Error ? error.message : '打开连接地址失败'
      setMobileShellStatus(message)
      return
    }
  }

  const popup = window.open(url, '_blank', 'noopener,noreferrer')
  if (!popup) {
    setMobileShellStatus('浏览器阻止了新窗口，请允许弹窗后重试')
  }
}

function onOpenAppVersionDetails(): void {
  if (!isMobileShellAvailable.value) {
    void openLatestMobileShellReleasePage()
    return
  }
  void runMobileShellUpdatePrimaryAction()
}

async function saveMobileShellServerAddress(): Promise<void> {
  if (!isMobileShellAvailable.value || isMobileShellSaving.value) return

  const nextUrl = normalizedMobileShellServerInput.value
  if (!nextUrl) {
    setMobileShellStatus('请先输入完整的服务地址')
    return
  }

  isMobileShellSaving.value = true
  setMobileShellStatus('正在保存连接地址...')
  try {
    const config = await setMobileShellServerUrl(nextUrl)
    mobileShellServerConfig.value = config
    mobileShellServerInput.value = config.serverUrl
    setMobileShellStatus('地址已保存，App 正在重连...')
  } catch (error) {
    const message = error instanceof Error ? error.message : '保存连接地址失败'
    setMobileShellStatus(message)
  } finally {
    isMobileShellSaving.value = false
  }
}

async function restoreDefaultMobileShellServerAddress(): Promise<void> {
  if (!isMobileShellAvailable.value || isMobileShellSaving.value) return

  isMobileShellSaving.value = true
  setMobileShellStatus('正在恢复默认地址...')
  try {
    const config = await resetMobileShellServerUrl()
    mobileShellServerConfig.value = config
    mobileShellServerInput.value = config.serverUrl
    setMobileShellStatus('默认地址已恢复，App 正在重连...')
  } catch (error) {
    const message = error instanceof Error ? error.message : '恢复默认地址失败'
    setMobileShellStatus(message)
  } finally {
    isMobileShellSaving.value = false
  }
}

async function installLatestMobileShellRelease(): Promise<void> {
  if (!isMobileShellAvailable.value || isMobileShellInstalling.value) return

  const asset = mobileShellLatestRelease.value?.asset
  if (!asset?.downloadUrl) {
    setMobileShellUpdateStatus('当前没有可下载安装的 Android 更新包')
    return
  }

  isMobileShellInstalling.value = true
  setMobileShellUpdateStatus('正在下载更新包并准备安装...')
  try {
    const result = await installMobileShellApk(asset.downloadUrl, asset.name)
    if (result.status === 'permission_required') {
      setMobileShellUpdateStatus('请允许 CX-Codex 安装未知应用，然后再点下载安装')
    } else {
      setMobileShellUpdateStatus('更新包已下载，系统安装界面正在打开')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '下载安装更新失败'
    setMobileShellUpdateStatus(message)
  } finally {
    isMobileShellInstalling.value = false
  }
}

function closeMobileShellUpdatePrompt(): void {
  isMobileShellUpdatePromptVisible.value = false
}

async function confirmLatestMobileShellReleaseInstall(): Promise<void> {
  closeMobileShellUpdatePrompt()
  await installLatestMobileShellRelease()
}

function closeDesktopRefreshConfirm(): void {
  isDesktopRefreshConfirmVisible.value = false
}

function markDesktopSyncPending(threadId: string): void {
  const normalizedThreadId = threadId.trim()
  if (!normalizedThreadId) return
  if (isMobileShellAvailable.value) return
  desktopSyncPendingThreadId.value = normalizedThreadId
  desktopSyncPendingAtMs.value = Date.now()
}

function clearDesktopSyncPending(): void {
  desktopSyncPendingThreadId.value = ''
  desktopSyncPendingAtMs.value = 0
}

function confirmDesktopRefresh(): void {
  if (!desktopAppStatus.value.available || isDesktopRefreshRunning.value) {
    closeDesktopRefreshConfirm()
    return
  }

  closeDesktopRefreshConfirm()
  isDesktopRefreshRunning.value = true
  void refreshDesktopApp()
    .then((result) => {
      clearDesktopSyncPending()
      window.alert(result.message)
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : '刷新官方 Codex 桌面端失败'
      window.alert(message)
    })
    .finally(() => {
      isDesktopRefreshRunning.value = false
      void refreshDesktopAppAvailability()
    })
}

function toggleSidebarSearch(): void {
  isSidebarSearchVisible.value = !isSidebarSearchVisible.value
  if (isSidebarSearchVisible.value) {
    nextTick(() => {
      if (!isDualPaneMobile.value) {
        sidebarSearchInputRef.value?.focus()
      }
    })
  } else {
    sidebarSearchQuery.value = ''
  }
}

function clearSidebarSearch(): void {
  sidebarSearchQuery.value = ''
  if (!isDualPaneMobile.value) {
    sidebarSearchInputRef.value?.focus()
  }
}

function onSidebarSearchKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    isSidebarSearchVisible.value = false
    sidebarSearchQuery.value = ''
  }
}

function onSelectThread(threadId: string): void {
  if (!threadId) return
  if (selectedThreadId.value !== threadId) {
    void selectThread(threadId)
  }
  if (route.name !== 'thread') {
    void router.push({ name: 'thread', params: { threadId } })
  }
  if (isMobile.value) setSidebarCollapsed(true)
}

function closeFavoritesModal(): void {
  isFavoritesModalVisible.value = false
}

function onToggleFavoriteMessage(message: UiMessage): void {
  const threadId = displayedThreadConversationId.value.trim()
  const messageId = message.id.trim()
  const text = message.text.trim()
  if (!threadId || !messageId || !text) return

  const threadSnapshot = threadById.value[threadId]
  const added = toggleFavorite({
    threadId,
    messageId,
    threadTitle: displayedThreadTitle.value.trim() || threadSnapshot?.title?.trim() || '未命名会话',
    threadCwd: displayedThreadCwd.value.trim() || threadSnapshot?.cwd?.trim() || '',
    role: message.role,
    text,
    turnIndex: typeof message.turnIndex === 'number' ? message.turnIndex : null,
  })
  setFavoritesStatusText(added ? '已加入收藏' : '已取消收藏')
}

async function onCopyFavorite(record: FavoriteRecord): Promise<void> {
  try {
    await copyTextToClipboard(record.text)
    setFavoritesStatusText('收藏内容已复制')
  } catch {
    setFavoritesStatusText('复制失败，请手动复制')
  }
}

function onRemoveFavorite(record: FavoriteRecord): void {
  removeFavorite(record.threadId, record.messageId)
  setFavoritesStatusText('已取消收藏')
}

async function tryFocusPendingFavoriteJump(): Promise<void> {
  const pending = pendingFavoriteJump.value
  if (!pending) return
  if (isLoadingMessages.value || isThreadContentSwitching.value) return
  if (displayedThreadConversationId.value !== pending.threadId) return
  const focused = await threadConversationRef.value?.focusMessage(pending.messageId)
  if (focused) {
    pendingFavoriteJump.value = null
    setFavoritesStatusText('已跳转到收藏内容')
  }
}

async function onOpenFavorite(record: FavoriteRecord): Promise<void> {
  const targetThreadId = record.threadId.trim()
  const targetMessageId = record.messageId.trim()
  if (!targetThreadId || !targetMessageId) return

  closeFavoritesModal()
  pendingFavoriteJump.value = { threadId: targetThreadId, messageId: targetMessageId }

  if (selectedThreadId.value !== targetThreadId) {
    await selectThread(targetThreadId)
  }
  if (route.name !== 'thread' || routeThreadId.value !== targetThreadId) {
    await router.push({ name: 'thread', params: { threadId: targetThreadId } })
  }
  if (isMobile.value) setSidebarCollapsed(true)
  await nextTick()
  void tryFocusPendingFavoriteJump()
}

async function onExportThread(threadId: string): Promise<void> {
  if (!threadId) return
  if (selectedThreadId.value !== threadId) {
    await selectThread(threadId)
    await router.push({ name: 'thread', params: { threadId } })
  }
  await nextTick()
  onExportChat()
}

function onArchiveThread(threadId: string): void {
  void archiveThreadById(threadId)
}

async function onForkThread(threadId: string): Promise<void> {
  const nextThreadId = await forkThreadById(threadId)
  if (!nextThreadId) return
  if (!isHomeRoute.value) {
    await router.push({ name: 'thread', params: { threadId: nextThreadId } })
  } else {
    await router.replace({ name: 'thread', params: { threadId: nextThreadId } })
  }
  if (isMobile.value) setSidebarCollapsed(true)
}

function isWorktreePath(cwdRaw: string): boolean {
  const cwd = cwdRaw.trim().replace(/\\/gu, '/')
  if (!cwd) return false
  return cwd.includes('/.codex/worktrees/') || cwd.includes('/.git/worktrees/')
}

function resolvePreferredLocalCwd(projectName: string, fallbackCwd = ''): string {
  const group = projectGroups.value.find((row) => row.projectName === projectName)
  if (!group) return fallbackCwd.trim()
  const nonWorktreeThread = group.threads.find((thread) => !isWorktreePath(thread.cwd))
  const candidate = nonWorktreeThread?.cwd?.trim() ?? group.threads[0]?.cwd?.trim() ?? ''
  return candidate || fallbackCwd.trim()
}

function onStartNewThread(projectName: string): void {
  const projectGroup = projectGroups.value.find((group) => group.projectName === projectName)
  const projectCwd = resolvePreferredLocalCwd(projectName, projectGroup?.threads[0]?.cwd?.trim() ?? '')
  if (projectCwd) {
    newThreadCwd.value = projectCwd
  }
  if (isMobile.value) setSidebarCollapsed(true)
  if (isHomeRoute.value) return
  void router.push({ name: 'home' })
}

function onBrowseThreadFiles(threadId: string): void {
  let targetCwd = ''
  for (const group of projectGroups.value) {
    const thread = group.threads.find((row) => row.id === threadId)
    if (thread?.cwd?.trim()) {
      targetCwd = thread.cwd.trim()
      break
    }
  }
  if (!targetCwd || typeof window === 'undefined') return
  window.open(`/codex-local-browse${encodeURI(targetCwd)}`, '_blank', 'noopener,noreferrer')
}

function openProjectGithub(): void {
  if (typeof window === 'undefined') return
  window.open(PROJECT_GITHUB_URL, '_blank', 'noopener,noreferrer')
}

function onStartNewThreadFromToolbar(): void {
  const selected = selectedThread.value
  const cwd = selected
    ? resolvePreferredLocalCwd(selected.projectName, selected.cwd?.trim() ?? '')
    : ''
  if (cwd) {
    newThreadCwd.value = cwd
  }
  if (isMobile.value) setSidebarCollapsed(true)
  if (isHomeRoute.value) return
  void router.push({ name: 'home' })
}

async function onDismissEmptyThread(): Promise<void> {
  const threadId = routeThreadId.value.trim()
  if (!threadId) return

  dismissThreadLocally(threadId)
  await archiveThreadById(threadId)
  await selectThread('')
  if (!isHomeRoute.value) {
    await router.replace({ name: 'home' })
  }
}

function onReturnToNewThreadFromEmptyThread(): void {
  if (isHomeRoute.value) return
  void router.replace({ name: 'home' })
}

function onRenameProject(payload: { projectName: string; displayName: string }): void {
  renameProject(payload.projectName, payload.displayName)
}

function onRenameThread(payload: { threadId: string; title: string }): void {
  void renameThreadById(payload.threadId, payload.title)
}

function onRemoveProject(projectName: string): void {
  void removeProject(projectName)
}

function onReorderProject(payload: { projectName: string; toIndex: number }): void {
  reorderProject(payload.projectName, payload.toIndex)
}

function onUpdateThreadScrollState(payload: { threadId: string; state: ThreadScrollState }): void {
  setThreadScrollState(payload.threadId, payload.state)
}

function onRespondServerRequest(payload: { id: number; result?: unknown; error?: { code?: number; message: string } }): void {
  void respondToPendingServerRequest(payload)
}

function setSidebarCollapsed(nextValue: boolean): void {
  if (isSidebarCollapsed.value === nextValue) return
  isSidebarCollapsed.value = nextValue
  if (nextValue) {
    isSettingsOpen.value = false
  }
  saveSidebarCollapsed(nextValue)
}

function onWindowKeyDown(event: KeyboardEvent): void {
  if (event.defaultPrevented) return
  if (event.key === 'Escape' && isMobileShellUpdatePromptVisible.value) {
    event.preventDefault()
    closeMobileShellUpdatePrompt()
    return
  }
  if (event.key === 'Escape' && isDesktopRefreshConfirmVisible.value) {
    event.preventDefault()
    closeDesktopRefreshConfirm()
    return
  }
  if (event.key === 'Escape' && isSettingsOpen.value) {
    event.preventDefault()
    isSettingsOpen.value = false
    return
  }
  if (!event.ctrlKey && !event.metaKey) return
  if (event.shiftKey || event.altKey) return
  if (event.key.toLowerCase() !== 'b') return
  event.preventDefault()
  setSidebarCollapsed(!isSidebarCollapsed.value)
}

function onWindowPointerDownForSettings(event: PointerEvent): void {
  if (!isSettingsOpen.value) return
  const settingsArea = sidebarSettingsAreaRef.value
  if (!settingsArea) return

  const target = event.target
  if (!(target instanceof Node)) return
  if (settingsArea.contains(target)) return

  isSettingsOpen.value = false
}

function onSubmitThreadMessage(payload: SubmitPayload): void {
  const text = payload.text
  const editingState = editingQueuedMessageState.value
  const queueInsertIndex =
    payload.mode === 'queue'
    && editingState
    && editingState.threadId === selectedThreadId.value
      ? editingState.queueIndex
      : undefined
  editingQueuedMessageState.value = null
  if (isHomeRoute.value) {
    void submitFirstMessageForNewThread(
      text,
      payload.imageUrls,
      payload.skills,
      payload.fileAttachments,
      payload.collaborationMode,
    )
    return
  }
  if (payload.rollbackLatestUserTurn === true) {
    void rollbackAndResendDictation(payload)
    return
  }
  void sendMessageToSelectedThread(
    text,
    payload.imageUrls,
    payload.skills,
    payload.mode,
    payload.fileAttachments,
    queueInsertIndex,
    payload.collaborationMode,
  ).then(() => {
    if (payload.mode !== 'queue') {
      markDesktopSyncPending(selectedThreadId.value)
    }
  }).catch(() => {
    // The send path already reflects failures in the main state.
  })
}

function onGithubTipsScopeChange(nextValue: string): void {
  const allowed = new Set<GithubTipsScope>([
    'search-daily',
    'search-weekly',
    'search-monthly',
    'trending-daily',
    'trending-weekly',
    'trending-monthly',
  ])
  const scope = allowed.has(nextValue as GithubTipsScope) ? (nextValue as GithubTipsScope) : 'trending-daily'
  if (githubTipsScope.value === scope) return
  githubTipsScope.value = scope
}

function onRefreshTrendingProjects(): void {
  trendingProjectsRequestToken += 1
  lastLoadedGithubTipsScope.value = ''
  cancelPendingTrendingProjectsLoad()
  scheduleTrendingProjectsLoad('immediate')
}

async function onRefreshSelectedThreadContent(): Promise<void> {
  if (!showMobileThreadRefreshButton.value || isManualThreadRefreshRunning.value) return

  isManualThreadRefreshRunning.value = true
  try {
    await refreshSelectedThreadContent()
    showProductToast('当前会话状态已强制恢复。', 'success')
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '刷新当前会话内容失败'
    showProductToast(message, 'danger', 4200)
  } finally {
    isManualThreadRefreshRunning.value = false
  }
}

function permissionDecisionLabel(value: PermissionDecision): string {
  return value === 'allowForSession' ? '自动允许' : '每次询问'
}

function togglePermissionDecision(value: PermissionDecision): PermissionDecision {
  return value === 'allowForSession' ? 'ask' : 'allowForSession'
}

function toggleAllowAllPermissionRequests(): void {
  void saveWebBridgeSettings({
    permissions: {
      ...webBridgeSettings.value.permissions,
      allowAllPermissionRequests: !webBridgeSettings.value.permissions.allowAllPermissionRequests,
    },
  })
}

function cyclePermissionDecision(key: 'commandExecution' | 'fileChange' | 'mcpTools'): void {
  void saveWebBridgeSettings({
    permissions: {
      ...webBridgeSettings.value.permissions,
      [key]: togglePermissionDecision(webBridgeSettings.value.permissions[key]),
    },
  })
}

function buildTrendingProjectAskPrompt(project: GithubTrendingProject): string {
  return `请先了解这个 GitHub 项目：${project.url}\n然后用非常简单、五年级学生也能听懂的话解释这个项目是做什么的。`
}

async function onAskTrendingProject(project: GithubTrendingProject): Promise<void> {
  if (!isHomeRoute.value) {
    await router.push({ name: 'home' })
    await nextTick()
  }
  const composer = homeThreadComposerRef.value
  if (!composer) return
  composer.hydrateDraft({
    text: buildTrendingProjectAskPrompt(project),
    imageUrls: [],
    fileAttachments: [],
    skills: [],
  })
}

function onEditQueuedMessage(messageId: string): void {
  const queueIndex = selectedThreadQueuedMessages.value.findIndex((item) => item.id === messageId)
  const message = queueIndex >= 0 ? selectedThreadQueuedMessages.value[queueIndex] : undefined
  const composer = threadComposerRef.value
  if (!message || !composer) return

  if (composer.hasUnsavedDraft()) {
    const shouldReplace = window.confirm('当前输入框里还有未发送内容，是否替换为这条排队消息继续编辑？')
    if (!shouldReplace) return
  }

  editingQueuedMessageState.value = selectedThreadId.value
    ? { threadId: selectedThreadId.value, queueIndex }
    : null
  const payload: ComposerDraftPayload = {
    text: message.text,
    imageUrls: [...message.imageUrls],
    fileAttachments: message.fileAttachments.map((attachment) => ({ ...attachment })),
    skills: message.skills.map((skill) => ({ ...skill })),
  }
  composer.hydrateDraft(payload)
  removeQueuedMessage(messageId)
}

async function rollbackAndResendDictation(payload: {
  text: string
  imageUrls: string[]
  fileAttachments: Array<{ label: string; path: string; fsPath: string }>
  skills: Array<{ name: string; path: string }>
  collaborationMode: CollaborationMode
}): Promise<void> {
  if (isSelectedThreadInProgress.value) {
    await interruptSelectedThreadTurn()
  }
  const rollbackTargetTurnIndex = latestUserTurnIndex.value
  if (rollbackTargetTurnIndex >= 0) {
    await rollbackSelectedThread(rollbackTargetTurnIndex)
  }
  await sendMessageToSelectedThread(
    payload.text,
    payload.imageUrls,
    payload.skills,
    'steer',
    payload.fileAttachments,
    undefined,
    payload.collaborationMode,
  )
  markDesktopSyncPending(selectedThreadId.value)
}

function onSelectNewThreadFolder(cwd: string): void {
  newThreadCwd.value = cwd.trim()
}

function restoreHomeThreadComposerDraft(payload: ComposerDraftPayload): void {
  homeThreadComposerRef.value?.hydrateDraft(payload)
}

async function onAddNewProject(rawInput: string): Promise<void> {
  const normalizedInput = rawInput.trim()
  if (!normalizedInput) return

  const isPath = looksLikePath(normalizedInput)
  const baseDir = await resolveProjectBaseDirectory()
  const targetPath = isPath
    ? normalizedInput
    : joinPath(baseDir, normalizedInput)
  if (!targetPath) return

  try {
    const normalizedPath = await openProjectRoot(targetPath, {
      createIfMissing: !isPath,
      label: isPath ? '' : normalizedInput,
    })
    if (normalizedPath) {
      newThreadCwd.value = normalizedPath
      pinProjectToTop(getPathLeafName(normalizedPath))
      void loadWorkspaceRootOptionsState()
      void refreshDefaultProjectName()
    }
  } catch {
    // Error is surfaced on next request if path is invalid.
  }
}

async function applyLaunchProjectPathFromUrl(): Promise<void> {
  if (typeof window === 'undefined') return
  const launchProjectPath = new URLSearchParams(window.location.search).get('openProjectPath')?.trim() ?? ''
  if (!launchProjectPath) return
  try {
    const normalizedPath = await openProjectRoot(launchProjectPath, {
      createIfMissing: false,
      label: '',
    })
    if (!normalizedPath) return
    newThreadCwd.value = normalizedPath
    pinProjectToTop(getPathLeafName(normalizedPath))
    await router.replace({ name: 'home' })
    await loadWorkspaceRootOptionsState()
    const nextUrl = new URL(window.location.href)
    nextUrl.searchParams.delete('openProjectPath')
    window.history.replaceState({}, '', nextUrl.toString())
  } catch {
    // If launch path is invalid, keep normal startup behavior.
  }
}

async function resolveProjectBaseDirectory(): Promise<string> {
  const baseDir = getProjectBaseDirectory()
  if (baseDir) return baseDir
  try {
    const loadedHomeDirectory = await getHomeDirectory()
    if (loadedHomeDirectory) {
      homeDirectory.value = loadedHomeDirectory
      return loadedHomeDirectory
    }
  } catch {
    // Fallback handled by empty return.
  }
  return ''
}

function looksLikePath(value: string): boolean {
  if (!value) return false
  if (value.startsWith('~/')) return true
  if (value.startsWith('/')) return true
  return /^[a-zA-Z]:[\\/]/.test(value)
}

async function refreshDefaultProjectName(): Promise<void> {
  const baseDir = getProjectBaseDirectory()
  if (!baseDir) {
    defaultNewProjectName.value = 'New Project (1)'
    return
  }

  try {
    const suggestion = await getProjectRootSuggestion(baseDir)
    defaultNewProjectName.value = suggestion.name || 'New Project (1)'
  } catch {
    defaultNewProjectName.value = 'New Project (1)'
  }
}

function getProjectBaseDirectory(): string {
  const selected = newThreadCwd.value.trim()
  if (selected) return getPathParent(selected)
  const first = newThreadFolderOptions.value[0]?.value?.trim() ?? ''
  if (first) return getPathParent(first)
  return homeDirectory.value.trim()
}

async function loadHomeDirectory(): Promise<void> {
  try {
    homeDirectory.value = await getHomeDirectory()
  } catch {
    homeDirectory.value = ''
  }
}

async function loadWorkspaceRootOptionsState(): Promise<void> {
  try {
    const state = await getWorkspaceRootsState()
    workspaceRootOptionsState.value = {
      order: [...state.order],
      labels: { ...state.labels },
    }
  } catch {
    workspaceRootOptionsState.value = { order: [], labels: {} }
  }
}

async function loadTrendingProjects(scope: GithubTipsScope = githubTipsScope.value): Promise<void> {
  const requestToken = ++trendingProjectsRequestToken
  isTrendingProjectsLoading.value = true
  try {
    const rows = await getGithubProjectsForScope(scope, 10)
    if (requestToken !== trendingProjectsRequestToken) return
    if (!showGithubTrendingProjects.value || !isGithubTrendingRoute.value) return
    if (scope !== githubTipsScope.value) return
    trendingProjects.value = rows
    lastLoadedGithubTipsScope.value = scope
  } catch {
    if (requestToken !== trendingProjectsRequestToken) return
    trendingProjects.value = []
    lastLoadedGithubTipsScope.value = ''
  } finally {
    if (requestToken === trendingProjectsRequestToken) {
      isTrendingProjectsLoading.value = false
    }
  }
}
function joinPath(parent: string, child: string): string {
  const normalizedParent = parent.trim().replace(/\/+$/, '')
  const normalizedChild = child.trim().replace(/^\/+/, '')
  if (!normalizedParent || !normalizedChild) return ''
  return `${normalizedParent}/${normalizedChild}`
}

function onSelectModel(modelId: string): void {
  setSelectedModelId(modelId)
}

function onSelectReasoningEffort(effort: ReasoningEffort | ''): void {
  setSelectedReasoningEffort(effort)
}

function onSelectSpeedMode(mode: SpeedMode): void {
  void updateSelectedSpeedMode(mode)
}

function onSelectCollaborationMode(mode: CollaborationMode): void {
  setSelectedCollaborationMode(mode)
}

function onInterruptTurn(): void {
  showProductToast('已请求停止，正在确认任务状态。', 'warning')
  void interruptSelectedThreadTurn()
}

function onRollback(payload: { turnIndex: number; prependText?: string }): void {
  const prependText = payload.prependText?.trim() ?? ''
  if (prependText.length > 0) {
    rollbackDraftPrependRequestId += 1
    rollbackDraftPrependRequest.value = { id: rollbackDraftPrependRequestId, text: prependText }
  }
  void rollbackSelectedThread(payload.turnIndex)
}

function onExportChat(): void {
  if (isNonThreadRoute.value || typeof document === 'undefined') return
  if (!selectedThread.value || filteredMessages.value.length === 0) return
  const markdown = buildThreadMarkdown()
  const fileName = buildExportFileName()
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
}

function buildThreadMarkdown(): string {
  const lines: string[] = []
  const threadTitle = selectedThread.value?.title?.trim() || '未命名会话'
  lines.push(`# ${escapeMarkdownText(threadTitle)}`)
  lines.push('')
  lines.push(`- 导出时间：${new Date().toISOString()}`)
  lines.push(`- 会话 ID：${selectedThread.value?.id ?? ''}`)
  lines.push('')
  lines.push('---')
  lines.push('')

  for (const message of filteredMessages.value) {
    const roleLabel = message.role === 'user'
      ? '用户'
      : message.role === 'assistant'
        ? 'Codex'
        : message.role === 'system'
          ? '系统'
          : '消息'
    lines.push(`## ${roleLabel}`)
    lines.push('')

    const normalizedText = message.text.trim()
    if (normalizedText) {
      lines.push(normalizedText)
      lines.push('')
    }

    if (message.commandExecution) {
      lines.push('```text')
      lines.push(`命令：${message.commandExecution.command}`)
      lines.push(`状态：${message.commandExecution.status}`)
      if (message.commandExecution.cwd) {
        lines.push(`目录：${message.commandExecution.cwd}`)
      }
      if (message.commandExecution.exitCode !== null) {
        lines.push(`退出码：${message.commandExecution.exitCode}`)
      }
      lines.push(message.commandExecution.aggregatedOutput || '（无输出）')
      lines.push('```')
      lines.push('')
    }

    if (message.fileAttachments && message.fileAttachments.length > 0) {
      lines.push('附件：')
      for (const attachment of message.fileAttachments) {
        lines.push(`- ${attachment.path}`)
      }
      lines.push('')
    }

    if (message.images && message.images.length > 0) {
      lines.push('图片：')
      for (const imageUrl of message.images) {
        lines.push(`- ${imageUrl}`)
      }
      lines.push('')
    }
  }

  return `${lines.join('\n').trimEnd()}\n`
}

function buildExportFileName(): string {
  const threadTitle = selectedThread.value?.title?.trim() || 'chat'
  const sanitized = threadTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const base = sanitized || 'chat'
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `${base}-${stamp}.md`
}

function escapeMarkdownText(value: string): string {
  return value.replace(/([\\`*_{}\[\]()#+\-.!])/g, '\\$1')
}

function loadBoolPref(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback
  const v = window.localStorage.getItem(key)
  if (v === null) return fallback
  return v === '1'
}

function showProductToast(
  message: string,
  tone: 'success' | 'info' | 'warning' | 'danger' = 'info',
  durationMs = 2600,
): void {
  if (!message.trim()) return
  if (typeof window === 'undefined') return
  if (productToastTimer) {
    window.clearTimeout(productToastTimer)
    productToastTimer = null
  }
  productToast.value = {
    id: Date.now(),
    message: message.trim(),
    tone,
  }
  productToastTimer = window.setTimeout(() => {
    productToastTimer = null
    productToast.value = null
  }, durationMs)
}

function loadDarkModePref(): 'system' | 'light' | 'dark' {
  if (typeof window === 'undefined') return 'system'
  const v = window.localStorage.getItem(DARK_MODE_KEY)
  if (v === 'light' || v === 'dark') return v
  return 'system'
}

function toggleSendWithEnter(): void {
  sendWithEnter.value = !sendWithEnter.value
  window.localStorage.setItem(SEND_WITH_ENTER_KEY, sendWithEnter.value ? '1' : '0')
}

function cycleDarkMode(): void {
  const order: Array<'system' | 'light' | 'dark'> = ['system', 'light', 'dark']
  const idx = order.indexOf(darkMode.value)
  darkMode.value = order[(idx + 1) % order.length]
  window.localStorage.setItem(DARK_MODE_KEY, darkMode.value)
  applyDarkMode()
}

function toggleDictationButtonVisible(): void {
  dictationButtonVisible.value = !dictationButtonVisible.value
  window.localStorage.setItem(DICTATION_BUTTON_VISIBLE_KEY, dictationButtonVisible.value ? '1' : '0')
}

function toggleDictationAutoSend(): void {
  dictationAutoSend.value = !dictationAutoSend.value
  window.localStorage.setItem(DICTATION_AUTO_SEND_KEY, dictationAutoSend.value ? '1' : '0')
}

function toggleWorktreeGitAutomation(): void {
  worktreeGitAutomationEnabled.value = !worktreeGitAutomationEnabled.value
  window.localStorage.setItem(WORKTREE_GIT_AUTOMATION_KEY, worktreeGitAutomationEnabled.value ? '1' : '0')
}

function toggleGithubTrendingProjects(): void {
  showGithubTrendingProjects.value = !showGithubTrendingProjects.value
  window.localStorage.setItem(GITHUB_TRENDING_PROJECTS_KEY, showGithubTrendingProjects.value ? '1' : '0')
}

function onDictationLanguageChange(nextValue: string): void {
  const normalized = normalizeToWhisperLanguage(nextValue.trim())
  const value = normalized || 'auto'
  dictationLanguage.value = value
  window.localStorage.setItem(DICTATION_LANGUAGE_KEY, value)
}

function loadDictationLanguagePref(): string {
  if (typeof window === 'undefined') return 'auto'
  const value = window.localStorage.getItem(DICTATION_LANGUAGE_KEY)?.trim() || 'auto'
  const normalized = normalizeToWhisperLanguage(value)
  return normalized || 'auto'
}

function buildDictationLanguageOptions(): Array<{ value: string; label: string }> {
  const options: Array<{ value: string; label: string }> = [{ value: 'auto', label: '自动识别' }]
  const seen = new Set<string>(['auto'])
  function formatLanguageLabel(value: string): string {
    const languageName = WHISPER_LANGUAGES[value] || value
    const title = languageName.charAt(0).toUpperCase() + languageName.slice(1)
    return `${title} (${value})`
  }

  for (const raw of typeof navigator !== 'undefined' ? (navigator.languages ?? []) : []) {
    const value = normalizeToWhisperLanguage(raw)
    if (!value || seen.has(value)) continue
    seen.add(value)
    options.push({
      value,
      label: `优先：${formatLanguageLabel(value)}`,
    })
  }

  for (const value of Object.keys(WHISPER_LANGUAGES)) {
    if (seen.has(value)) continue
    seen.add(value)
    options.push({
      value,
      label: formatLanguageLabel(value),
    })
  }

  const current = dictationLanguage.value.trim()
  if (current && !seen.has(current)) {
    options.push({
      value: current,
      label: formatLanguageLabel(current),
    })
  }

  return options
}

function normalizeToWhisperLanguage(raw: string): string {
  const value = raw.trim().toLowerCase()
  if (!value || value === 'auto') return ''
  if (value in WHISPER_LANGUAGES) return value
  const base = value.split('-')[0] ?? value
  if (base in WHISPER_LANGUAGES) return base
  return ''
}

function applyDarkMode(): void {
  const root = document.documentElement
  if (darkMode.value === 'dark') {
    root.classList.add('dark')
  } else if (darkMode.value === 'light') {
    root.classList.remove('dark')
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    root.classList.toggle('dark', prefersDark)
  }
}

function loadSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1'
}

function saveSidebarCollapsed(value: boolean): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, value ? '1' : '0')
}

function normalizeMessageType(rawType: string | undefined, role: string): string {
  const normalized = (rawType ?? '').trim()
  if (normalized.length > 0) {
    return normalized
  }
  return role.trim() || 'message'
}

function rememberRoutableThreadId(threadId: string): void {
  const normalized = threadId.trim()
  if (!normalized || routeWarmThreadIds.value.includes(normalized)) return
  routeWarmThreadIds.value = [...routeWarmThreadIds.value, normalized]
}

async function initializeRuntime(): Promise<void> {
  if (isMobileShellAvailable.value) {
    await refreshMobileShellServerConfig()
    if (requiresMobileShellServerSetup.value) return
  }

  await initialize()
  void applyLaunchProjectPathFromUrl()
  scheduleInitialBackgroundTasks()
}

function scheduleInitialBackgroundTasks(): void {
  queueIdleTask(() => { void loadHomeDirectory() }, 800)
  queueIdleTask(() => { void loadWorkspaceRootOptionsState() }, 950)
  queueIdleTask(() => { void refreshDefaultProjectName() }, 1200)
  queueIdleTask(() => { void refreshWebBridgeSettings() }, 1400)
  queueIdleTask(() => { void refreshFavorites() }, 1500)
  queueIdleTask(() => { void refreshMobileShellServerConfig() }, 1600)
  queueIdleTask(() => { void refreshMobileShellRuntimeInfo() }, 1625)
  queueIdleTask(() => { void refreshMobileShellNotificationPermission() }, 1640)
  if (!isMobileShellAvailable.value) {
    queueIdleTask(() => { void refreshDesktopAppAvailability() }, 1700)
  }
  scheduleTrendingProjectsLoad()
}

async function initialize(): Promise<void> {
  await refreshAll({ loadMessages: false, loadSkills: false })
  hasInitialized.value = true
  const selectedThreadIdBeforeRouteSync = selectedThreadId.value
  await syncThreadSelectionWithRoute()
  if (route.name === 'thread' && selectedThreadId.value && selectedThreadId.value === selectedThreadIdBeforeRouteSync) {
    await selectThread(selectedThreadId.value)
  }
  startPolling()
  if (route.name !== 'thread') {
    queueIdleTask(() => { void refreshSkills() }, 220)
  }
}

async function syncThreadSelectionWithRoute(): Promise<void> {
  if (isRouteSyncInProgress.value) return
  isRouteSyncInProgress.value = true

  try {
    if (route.name === 'home' || route.name === 'skills' || route.name === 'github-trending') {
      if (selectedThreadId.value !== '') {
        await selectThread('')
      }
      return
    }

    if (route.name === 'thread') {
      const threadId = routeThreadId.value
      if (!threadId) return

      if (selectedThreadId.value !== threadId) {
        void selectThread(threadId)
        rememberRoutableThreadId(threadId)
      }
      return
    }

  } finally {
    isRouteSyncInProgress.value = false
  }
}

watch(
  () =>
    [
      route.name,
      routeThreadId.value,
      isLoadingThreads.value,
      routableThreadIdSet.value.has(routeThreadId.value),
    ] as const,
  async () => {
    if (!hasInitialized.value) return
    await syncThreadSelectionWithRoute()
  },
)

watch(
  () => selectedThreadId.value,
  async (threadId) => {
    if (!hasInitialized.value) return
    if (isRouteSyncInProgress.value) return
    if (isNonThreadRoute.value) return

    if (!threadId) {
      if (route.name !== 'home') {
        await router.replace({ name: 'home' })
      }
      return
    }

    if (route.name === 'thread' && routeThreadId.value === threadId) return
    await router.replace({ name: 'thread', params: { threadId } })
  },
)

watch(
  () => githubTipsScope.value,
  () => {
    if (!showGithubTrendingProjects.value || !isGithubTrendingRoute.value) return
    scheduleTrendingProjectsLoad()
  },
)

watch(
  () => showGithubTrendingProjects.value,
  (enabled) => {
    cancelPendingTrendingProjectsLoad()
    if (!enabled) {
      trendingProjectsRequestToken += 1
      isTrendingProjectsLoading.value = false
      trendingProjects.value = []
      lastLoadedGithubTipsScope.value = ''
      return
    }
    scheduleTrendingProjectsLoad()
  },
)

watch(
  () => route.name,
  (name) => {
    if (name === 'github-trending') {
      scheduleTrendingProjectsLoad()
      return
    }
    trendingProjectsRequestToken += 1
    isTrendingProjectsLoading.value = false
    cancelPendingTrendingProjectsLoad()
  },
)

watch(
  () => newThreadFolderOptions.value,
  (options) => {
    if (options.length === 0) {
      newThreadCwd.value = ''
      return
    }
    const hasSelected = options.some((option) => option.value === newThreadCwd.value)
    if (!hasSelected) {
      newThreadCwd.value = options[0].value
    }
    void refreshDefaultProjectName()
  },
  { immediate: true },
)

watch(
  () => newThreadCwd.value,
  () => {
    worktreeInitStatus.value = { phase: 'idle', title: '', message: '' }
    void refreshDefaultProjectName()
  },
)

watch(
  () => newThreadRuntime.value,
  (runtime) => {
    if (runtime === 'local') {
      worktreeInitStatus.value = { phase: 'idle', title: '', message: '' }
      const current = newThreadCwd.value.trim()
      if (current && isWorktreePath(current)) {
        const fallbackProjectName = selectedThread.value?.projectName ?? getPathLeafName(current)
        const localCwd = resolvePreferredLocalCwd(fallbackProjectName, '')
        if (localCwd) {
          newThreadCwd.value = localCwd
        }
      }
    }
  },
)

watch(
  () => route.name,
  (name) => {
    if (name !== 'home') {
      worktreeInitStatus.value = { phase: 'idle', title: '', message: '' }
    }
  },
)

watch(
  () => selectedThreadId.value,
  () => {
    worktreeInitStatus.value = { phase: 'idle', title: '', message: '' }
  },
)

watch(
  pageTitle,
  (value) => {
    if (typeof document === 'undefined') return
    document.title = value
  },
  { immediate: true },
)

watch(
  () => worktreeGitAutomationEnabled.value,
  (enabled) => {
    setWorktreeGitAutomationEnabled(enabled)
  },
  { immediate: true },
)

watch(isMobile, (mobile) => {
  if (mobile && !isSidebarCollapsed.value) {
    setSidebarCollapsed(true)
  }
}, { immediate: true })

async function submitFirstMessageForNewThread(
  text: string,
  imageUrls: string[] = [],
  skills: Array<{ name: string; path: string }> = [],
  fileAttachments: Array<{ label: string; path: string; fsPath: string }> = [],
  collaborationMode: CollaborationMode = selectedCollaborationMode.value,
): Promise<string> {
  try {
    worktreeInitStatus.value = { phase: 'idle', title: '', message: '' }
    let targetCwd = newThreadCwd.value
    if (newThreadRuntime.value === 'worktree') {
      worktreeInitStatus.value = {
        phase: 'running',
        title: '正在创建工作树',
        message: '正在创建工作树并执行初始化。',
      }
      try {
        const created = await createWorktree(newThreadCwd.value)
        targetCwd = created.cwd
        newThreadCwd.value = created.cwd
        worktreeInitStatus.value = { phase: 'idle', title: '', message: '' }
      } catch {
        worktreeInitStatus.value = {
          phase: 'error',
          title: '工作树初始化失败',
          message: '无法创建工作树，请重试或切换到当前项目。',
        }
        restoreHomeThreadComposerDraft({ text, imageUrls, fileAttachments, skills })
        return ''
      }
    }
    const threadId = await sendMessageToNewThread(text, targetCwd, imageUrls, skills, fileAttachments, collaborationMode)
    if (!threadId) {
      restoreHomeThreadComposerDraft({ text, imageUrls, fileAttachments, skills })
      return ''
    }
    await router.replace({ name: 'thread', params: { threadId } })
    markDesktopSyncPending(threadId)
    return threadId
  } catch {
    // Error is already reflected in state.
    restoreHomeThreadComposerDraft({ text, imageUrls, fileAttachments, skills })
    return ''
  }
}
</script>

<style scoped>
@reference "tailwindcss";

.sidebar-root {
  @apply h-full flex flex-col select-none;
}

.sidebar-root--dual-pane-touch .sidebar-scrollable {
  @apply px-2.5 py-2.5 gap-2.5;
}

.sidebar-root--dual-pane-touch .sidebar-top-shell {
  @apply rounded-[16px] px-2 py-2;
}

.skip-to-content {
  position: fixed;
  left: 1rem;
  top: 0.75rem;
  z-index: 80;
  transform: translateY(-160%);
  border-radius: 9999px;
  border: 1px solid #99f6e4;
  background: #f0fdfa;
  padding: 0.55rem 0.9rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: #134e4a;
  text-decoration: none;
  transition: transform 140ms ease;
}

.skip-to-content:focus-visible {
  transform: translateY(0);
}

.mobile-shell-setup-page {
  @apply min-h-dvh w-full bg-[#f8f6f0] px-5 py-8 text-[#2d261f];
  display: flex;
  align-items: center;
  justify-content: center;
  padding-top: max(2rem, env(safe-area-inset-top));
  padding-bottom: max(2rem, env(safe-area-inset-bottom));
}

.mobile-shell-setup-card {
  @apply w-full max-w-md rounded-[28px] border border-[#e5dbca] bg-[#fffdf8] p-5;
  box-shadow: 0 24px 54px -38px rgba(31, 41, 55, 0.34);
}

.mobile-shell-setup-brand {
  @apply flex items-center gap-3;
}

.mobile-shell-setup-logo {
  @apply h-14 w-14 shrink-0 rounded-[18px] border border-white/80 bg-white object-contain;
}

.mobile-shell-setup-copy {
  @apply min-w-0;
}

.mobile-shell-setup-kicker {
  @apply m-0 text-xs font-semibold uppercase tracking-[0.12em] text-[#0f766e];
}

.mobile-shell-setup-title {
  @apply m-0 mt-1 text-2xl font-semibold leading-tight;
}

.mobile-shell-setup-field {
  @apply mt-6 flex flex-col gap-2 text-sm font-medium text-[#5b5146];
}

.mobile-shell-setup-field input {
  @apply min-h-12 w-full rounded-2xl border border-[#ddd5c7] bg-white px-4 text-base text-[#2d261f] outline-none;
}

.mobile-shell-setup-field input:focus {
  border-color: #99f6e4;
  box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.13);
}

.mobile-shell-setup-submit {
  @apply mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-2xl border border-[#0f766e] bg-[#0f766e] px-4 text-sm font-semibold text-white;
}

.mobile-shell-setup-submit:disabled {
  @apply cursor-not-allowed border-[#cbe7e1] bg-[#dff4ee] text-[#699b92];
}

.mobile-shell-setup-status {
  @apply m-0 mt-3 text-xs leading-5 text-[#7b7062];
}

.mobile-shell-setup-status--boot {
  @apply mt-6 text-sm;
}

.sidebar-root input,
.sidebar-root textarea {
  @apply select-text;
}

.sidebar-scrollable {
  @apply flex-1 min-h-0 overflow-y-auto py-3 px-2.5 flex flex-col gap-3;
  overscroll-behavior-y: contain;
  -webkit-overflow-scrolling: touch;
}

.sidebar-top-shell {
  @apply flex flex-col gap-2 rounded-[26px] border border-[#e7dece] bg-[#fffdf8] px-2.5 py-2.5;
  box-shadow: 0 16px 30px -32px rgba(31, 41, 55, 0.18);
}

.content-root {
  @apply h-full min-h-0 min-w-0 w-full flex flex-col overflow-y-hidden overflow-x-visible;
  --content-shell-max-width: min(88rem, calc(100vw - 2.75rem));
  background:
    radial-gradient(circle at top right, rgba(13, 148, 136, 0.02), transparent 22%),
    linear-gradient(180deg, rgba(255,255,255,0.975) 0%, rgba(250,247,240,0.99) 100%);
}

.content-root--dual-pane-touch {
  --content-shell-max-width: 100%;
}

.sidebar-thread-controls-host {
  @apply mt-0 px-0 pb-0;
}

.sidebar-search-toggle {
  @apply inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-[#e4dac9] bg-[#fffdf8] text-[#6b6255] transition-colors duration-100 hover:border-[#cdbfa8] hover:bg-[#f7f1e5] hover:text-[#2d261f];
}

.sidebar-search-toggle[aria-pressed='true'] {
  @apply border-[#cec2ad] bg-[#ece4d6] text-[#433b31];
}

.sidebar-search-toggle-icon {
  @apply w-4 h-4;
}

.sidebar-toolbar-icon-button {
  @apply inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-[#e4dac9] bg-[#fffdf8] text-[#6b6255] transition-colors duration-100 hover:border-[#cdbfa8] hover:bg-[#f7f1e5] hover:text-[#2d261f];
}

.sidebar-toolbar-icon-button:disabled {
  @apply cursor-not-allowed border-[#ece4d6] bg-[#faf6ef] text-[#b1a89b] hover:border-[#ece4d6] hover:bg-[#faf6ef] hover:text-[#b1a89b];
}

.sidebar-toolbar-icon {
  @apply h-4 w-4;
}

.sidebar-search-bar {
  @apply z-10 flex items-center gap-1.5 px-3 py-2 rounded-2xl border border-[#e6dccb] bg-[#fcfaf4] transition-colors;
}

.sidebar-search-bar-icon {
  @apply w-3.5 h-3.5 text-[#9a907f] shrink-0;
}

.sidebar-search-input {
  @apply flex-1 min-w-0 bg-transparent text-sm text-[#2d261f] placeholder-[#9f9484] outline-none border-none p-0;
}

.sidebar-search-clear {
  @apply w-5 h-5 rounded-lg text-[#9a907f] flex items-center justify-center transition-colors duration-100 hover:bg-[#f1ebde] hover:text-[#544a3d];
}

.sidebar-search-clear-icon {
  @apply w-3.5 h-3.5;
}

.sidebar-explore-nav {
  @apply grid grid-cols-2 gap-1.5;
}

.sidebar-skills-link {
  @apply mx-0 flex items-center justify-center rounded-2xl border border-[#e8decd] bg-[#fcfaf4] px-3 py-2 text-[13px] font-medium text-[#5b5146] transition-[background-color,border-color,color,transform] duration-150 cursor-pointer;
}

.sidebar-explore-nav .sidebar-skills-link {
  @apply mx-0 justify-center;
}

.sidebar-skills-link.is-active {
  @apply border-[#bde7df] bg-[#eef8f5] text-[#134e4a] font-semibold;
}

.sidebar-skills-link:hover,
.sidebar-skills-link:focus-visible {
  @apply border-[#ddd3c2] bg-[#f7f4ed] text-[#2d261f];
}

.sidebar-thread-controls-header-host {
  @apply ml-1;
}

.desktop-refresh-button {
  @apply inline-flex items-center gap-1.5 rounded-full border border-[#ddd3c2] bg-[#fffdf8] px-3 py-1.5 text-[11px] font-semibold text-[#544a3d] transition-[background-color,border-color,color] duration-150 hover:border-[#c8b9a2] hover:bg-[#f6f2ea] hover:text-[#1f2937] disabled:cursor-not-allowed disabled:opacity-60;
  font-family: var(--font-sans-ui);
  letter-spacing: -0.01em;
}

.desktop-refresh-button[data-busy='true'] {
  @apply border-[#e7d9b0] bg-[#fcf7e8] text-[#8a6a11];
}

.desktop-refresh-button-icon {
  @apply h-3.25 w-3.25;
}

.content-body {
  @apply flex-1 min-h-0 min-w-0 w-full flex flex-col gap-2.5 pt-0.5 pb-2 sm:pb-4 overflow-y-hidden overflow-x-visible;
  padding-bottom: max(0.5rem, env(safe-area-inset-bottom));
}

.content-header-subtitle {
  @apply m-0 text-[11px] leading-4 text-[#8f8577] truncate;
  font-family: var(--font-sans-ui);
  letter-spacing: -0.006em;
}

.content-title-refresh-button {
  @apply inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#ddd3c2] bg-[#fffdf8] text-[#5a5144] transition-[background-color,border-color,color,transform] duration-150 hover:border-[#c8b9a2] hover:bg-[#f6f2ea] hover:text-[#1f2937] disabled:cursor-not-allowed disabled:opacity-60;
  box-shadow: 0 10px 20px -20px rgba(31, 41, 55, 0.24);
}

.content-title-refresh-button[data-busy='true'] {
  @apply border-[#e7d9b0] bg-[#fcf7e8] text-[#8a6a11];
}

.content-title-refresh-button-icon {
  @apply h-3.5 w-3.5;
}

.content-title-refresh-button[data-busy='true'] .content-title-refresh-button-icon {
  animation: content-title-refresh-spin 0.9s linear infinite;
}

.content-runtime-status {
  @apply shrink-0;
}

.content-favorites-button {
  @apply inline-flex h-7 min-w-7 shrink-0 items-center justify-center gap-1 rounded-full border border-[#ddd3c2] bg-[#fffdf8] px-2 text-[11px] font-semibold text-[#544a3d] transition-[background-color,border-color,color] duration-150 hover:border-[#ccb89c] hover:bg-[#f7f1e5] hover:text-[#1f2937];
  font-family: var(--font-sans-ui);
  letter-spacing: -0.01em;
}

.content-favorites-button-icon {
  @apply h-3.5 w-3.5;
}

.content-favorites-button-badge {
  @apply inline-flex min-w-5 items-center justify-center rounded-full bg-[#0f766e] px-1.5 py-0.5 text-[10px] text-white;
}

@keyframes content-title-refresh-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

.content-meta-row {
  @apply flex w-full min-w-0 flex-nowrap items-center gap-2;
}

.content-context-badge {
  @apply inline-flex items-center gap-1.5 rounded-full border border-transparent px-1.5 py-0.5 text-[11px] font-semibold leading-none;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96) 0%, rgba(248, 244, 236, 0.9) 100%);
  box-shadow: 0 8px 20px -20px rgba(31, 41, 55, 0.34);
}

.content-context-badge[data-tone='live'] {
  @apply text-[#0f766e];
}

.content-context-badge[data-tone='warning'] {
  @apply text-[#8a6a11];
}

.content-context-badge[data-tone='danger'] {
  @apply text-[#c2410c];
}

.content-context-badge[data-empty='true'] {
  @apply text-[#7b7062];
}

.content-context-badge-icon {
  @apply relative h-[1.15rem] w-[1.15rem] shrink-0;
}

.content-context-badge-ring {
  @apply h-full w-full;
  transform: rotate(-90deg);
}

.content-context-badge-track {
  fill: none;
  stroke: rgba(148, 163, 184, 0.22);
  stroke-width: 3.6;
}

.content-context-badge-progress {
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-width: 3.6;
  transition: stroke-dashoffset 180ms ease, stroke 180ms ease;
}

.content-context-badge-number {
  @apply min-w-[1.35rem] text-center text-[11px] font-semibold tabular-nums;
  letter-spacing: -0.02em;
}

.content-status-strip {
  @apply flex min-h-0 min-w-0 flex-1 flex-wrap items-center gap-1.5;
}

.content-status-pill {
  @apply inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium;
  box-shadow: 0 8px 18px -20px rgba(31, 41, 55, 0.2);
}

.content-status-pill-label {
  @apply text-[9px] font-semibold opacity-60;
  letter-spacing: 0.01em;
}

.content-status-pill[data-tone='live'] {
  @apply border-[#cbe7e1] bg-[#edf9f6] text-[#0f766e];
}

.content-status-pill[data-tone='syncing'] {
  @apply border-[#d8ccba] bg-[#f7f1e5] text-[#6d6354];
}

.content-status-pill[data-tone='warning'] {
  @apply border-[#e7d9b0] bg-[#fcf7e8] text-[#8a6a11];
}

.content-status-pill[data-tone='danger'] {
  @apply border-[#f1cbc3] bg-[#fff0ec] text-[#c2410c];
}

.content-status-detail {
  @apply hidden sm:inline text-[11px] leading-4 text-[#8f8577] truncate;
  max-width: min(40rem, 52vw);
}

.content-desktop-sync-button {
  @apply inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-full border border-[#e7d9b0] bg-[#fcf7e8] px-2.5 text-[10px] font-semibold text-[#7a5b0c] transition-[background-color,border-color,color,transform] duration-150 hover:border-[#d7c17b] hover:bg-[#f8edc5] hover:text-[#4a3808] disabled:cursor-not-allowed disabled:opacity-70;
  font-family: var(--font-sans-ui);
  letter-spacing: -0.006em;
  touch-action: manipulation;
}

.content-desktop-sync-button:active:not(:disabled) {
  transform: translateY(1px);
}

.content-desktop-sync-button[data-busy='true'] {
  @apply border-[#d8ccba] bg-[#f7f1e5] text-[#6d6354];
}

.content-desktop-sync-button-icon {
  @apply h-3.5 w-3.5;
}

.content-desktop-sync-button[data-busy='true'] .content-desktop-sync-button-icon {
  animation: content-title-refresh-spin 0.9s linear infinite;
}


.content-error {
  @apply m-0 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700;
}

.product-toast {
  @apply fixed left-1/2 z-[70] max-w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 rounded-full border bg-[#fffdf8] px-4 py-2 text-sm font-medium text-[#544a3d] shadow-lg shadow-[#2d261f]/10;
  bottom: max(1rem, env(safe-area-inset-bottom));
  font-family: var(--font-sans-ui);
}

.product-toast[data-tone='success'] {
  @apply border-[#bde7df] bg-[#eef8f5] text-[#0f766e];
}

.product-toast[data-tone='warning'] {
  @apply border-[#e7d9b0] bg-[#fcf7e8] text-[#8a6a11];
}

.product-toast[data-tone='danger'] {
  @apply border-[#f1cbc3] bg-[#fff0ec] text-[#c2410c];
}

.product-toast-enter-active,
.product-toast-leave-active {
  transition: opacity 160ms ease, transform 160ms ease;
}

.product-toast-enter-from,
.product-toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}

.content-grid {
  @apply flex-1 min-h-0 min-w-0 flex flex-col gap-2.5 w-full;
  width: min(100%, var(--content-shell-max-width));
  margin-inline: auto;
}

.content-thread {
  @apply flex-1 min-h-0 min-w-0 overflow-hidden;
}

.content-root--dual-pane-touch .content-body,
.content-root--dual-pane-touch .content-grid,
.content-root--dual-pane-touch .content-thread {
  min-width: 0;
}

.content-root--dual-pane-touch .content-grid {
  width: 100%;
}

.composer-with-queue {
  @apply w-full sticky bottom-0 z-10 pt-2;
  background:
    linear-gradient(180deg, rgba(250,247,240,0) 0%, rgba(250,247,240,0.84) 18%, rgba(250,247,240,0.965) 100%);
  padding-bottom: max(0.35rem, env(safe-area-inset-bottom));
}

.new-thread-empty {
  @apply flex-1 min-h-0 flex flex-col items-center justify-center gap-1 px-3 sm:px-6;
  padding-bottom: clamp(4.75rem, 16dvh, 9rem);
}

.new-thread-hero {
  @apply m-0 text-[1.55rem] sm:text-[2.2rem] font-semibold leading-[1.06] text-[#1f2937];
}

.new-thread-folder-dropdown {
  @apply text-xl sm:text-[2.2rem] text-[#73695d];
}

.new-thread-folder-dropdown :deep(.composer-dropdown-trigger) {
  @apply h-auto text-xl sm:text-[2.2rem] leading-[1.05];
}

.new-thread-folder-dropdown :deep(.composer-dropdown-value) {
  @apply leading-[1.05];
}

.new-thread-folder-dropdown :deep(.composer-dropdown-chevron) {
  @apply h-4 w-4 sm:h-5 sm:w-5 mt-0;
}

.new-thread-runtime-dropdown {
  @apply mt-3;
}

.new-thread-trending {
  @apply mt-4 w-full max-w-3xl;
}

.new-thread-trending-header {
  @apply mb-2 flex items-center justify-between gap-2;
}

.new-thread-trending-title {
  @apply m-0 text-xs font-medium uppercase tracking-wide text-zinc-500;
}

.new-thread-trending-scope-dropdown {
  @apply min-w-40;
}

.new-thread-trending-scope-dropdown :deep(.composer-dropdown-trigger) {
  @apply h-8 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700;
}

.new-thread-trending-empty {
  @apply m-0 text-sm text-zinc-500;
}

.new-thread-trending-list {
  @apply grid grid-cols-2 sm:grid-cols-3 gap-2;
  grid-template-rows: repeat(2, minmax(0, 1fr));
}

.new-thread-trending-tip {
  @apply flex cursor-pointer flex-col items-start gap-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-left transition hover:border-zinc-300 hover:bg-zinc-50;
  container-type: inline-size;
}

.new-thread-trending-tip-name {
  @apply w-full truncate text-sm font-medium text-zinc-900;
}

.new-thread-trending-tip-name-owner {
  @apply inline;
}

.new-thread-trending-tip-name-slash {
  @apply inline;
}

.new-thread-trending-tip-name-repo {
  @apply inline;
}

@container (max-width: 220px) {
  .new-thread-trending-tip-name-owner,
  .new-thread-trending-tip-name-slash {
    display: none;
  }
}

.new-thread-trending-tip-meta {
  @apply text-xs text-zinc-500;
}

.new-thread-trending-tip-description {
  @apply line-clamp-2 text-xs text-zinc-600;
}

.worktree-init-status {
  @apply mt-3 flex w-full max-w-xl flex-col gap-1 rounded-xl border px-3 py-2 text-sm;
}

.worktree-init-status.is-running {
  @apply border-[#ddd5c7] bg-[#f7f1e5] text-[#6d6354];
}

.worktree-init-status.is-error {
  @apply border-rose-300 bg-rose-50 text-rose-800;
}

.worktree-init-status-title {
  @apply font-medium;
}

.worktree-init-status-message {
  @apply break-all;
}

.sidebar-settings-area {
  @apply relative shrink-0 pt-2 px-2 pb-2 border-t border-[#e6dccb] bg-[#f7f4ed];
}

.sidebar-settings-button {
  @apply flex items-center gap-2 w-full rounded-2xl border border-transparent bg-transparent px-3 py-2 text-sm text-[#5b5146] transition-colors duration-100 hover:bg-[#ece4d6] hover:text-[#2d261f] cursor-pointer;
}

.sidebar-settings-icon {
  @apply w-4.5 h-4.5;
}

.sidebar-settings-panel {
  @apply mb-1 rounded-[24px] border border-[#e5dbca] bg-[#fffdf8] overflow-hidden;
}

.sidebar-settings-mobile-backdrop {
  @apply fixed inset-0 z-[68] border-0 bg-[#1f2937]/32 p-0;
  backdrop-filter: blur(2px);
}

.sidebar-settings-panel-mobile {
  @apply fixed inset-x-0 bottom-0 z-[69] m-0 rounded-t-[28px] rounded-b-none border-[#ddd5c7] shadow-2xl shadow-[#1f2937]/18;
  max-height: min(78dvh, calc(100dvh - max(4rem, env(safe-area-inset-top) + 1rem)));
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-y;
  padding-bottom: max(0.9rem, env(safe-area-inset-bottom));
}

.sidebar-settings-mobile-handle {
  @apply mx-auto mt-2 h-1.5 w-12 rounded-full bg-[#ddd5c7];
}

.sidebar-settings-mobile-header {
  @apply sticky top-0 z-[1] flex items-center justify-between gap-3 px-4 pb-2 pt-3;
  background: linear-gradient(180deg, rgba(255, 253, 248, 0.985) 0%, rgba(255, 253, 248, 0.95) 100%);
  border-bottom: 1px solid #f1eadf;
}

.sidebar-settings-mobile-copy {
  @apply min-w-0 flex flex-col gap-0.5;
}

.sidebar-settings-mobile-title {
  @apply m-0 text-sm font-semibold text-[#2d261f];
}

.sidebar-settings-mobile-subtitle {
  @apply m-0 text-[11px] leading-4 text-[#8f8577];
}

.sidebar-settings-mobile-close {
  @apply inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[#e4dac9] bg-[#fffdf8] text-[#5b5146] transition-colors duration-100 hover:bg-[#f7f1e5] hover:text-[#2d261f];
}

.sidebar-settings-mobile-close-icon {
  @apply h-4.5 w-4.5;
}

.sidebar-settings-row {
  @apply flex items-center justify-between w-full px-3 py-2.5 text-sm text-[#544a3d] border-0 bg-transparent transition-colors duration-150 hover:bg-[#f7f4ed] cursor-pointer;
}

.sidebar-settings-row:disabled {
  @apply cursor-not-allowed text-[#b1a89b] hover:bg-transparent;
}

.sidebar-settings-row--select {
  @apply cursor-default items-center gap-2;
}

.sidebar-settings-row--input {
  @apply cursor-default items-start;
}

.sidebar-settings-row--static {
  @apply cursor-default hover:bg-transparent;
}

.sidebar-settings-row--stacked {
  @apply items-start flex-col gap-1.5;
}

.sidebar-settings-section {
  @apply border-t border-[#f1eadf] py-1;
}

.sidebar-settings-section-title {
  @apply m-0 px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#9a907f];
}

.sidebar-settings-hint {
  @apply m-0 px-3 py-1.5 text-[11px] leading-4 text-[#8f8577];
}

.sidebar-settings-hint-status {
  @apply text-[#0f766e];
}

.sidebar-settings-hint-compact {
  @apply px-1 py-1;
}

.sidebar-settings-language-dropdown {
  @apply min-w-0 max-w-52;
}

.sidebar-settings-language-dropdown :deep(.composer-dropdown-trigger) {
  @apply h-auto rounded-xl border border-[#ddd5c7] bg-white px-2 py-1 text-xs text-[#544a3d];
}

.sidebar-settings-language-dropdown :deep(.composer-dropdown-value) {
  @apply max-w-32;
}

.sidebar-settings-row + .sidebar-settings-row {
  @apply border-t border-[#f1eadf];
}

.sidebar-settings-label {
  @apply text-left;
}

.sidebar-settings-field {
  @apply flex w-full min-w-0 flex-col gap-2;
}

.sidebar-settings-input {
  @apply w-full rounded-2xl border border-[#ddd5c7] bg-white px-3 py-2 text-sm text-[#2d261f] outline-none transition-[border-color,box-shadow] duration-100;
  box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.04);
}

.sidebar-settings-input::placeholder {
  color: #9f9484;
}

.sidebar-settings-input:focus {
  border-color: #bde7df;
  box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.12);
}

.sidebar-settings-input:disabled {
  @apply cursor-not-allowed bg-[#f7f4ed] text-[#9f9484];
}

.sidebar-settings-value {
  @apply text-xs text-[#7b7062] bg-[#f1ebde] rounded-full px-2 py-0.5;
}

.sidebar-settings-code {
  @apply block w-full rounded-2xl border border-[#e6dccb] bg-[#f7f4ed] px-3 py-2 text-[11px] leading-4 text-[#5f5446] break-all;
}

.sidebar-settings-code-row {
  @apply flex w-full min-w-0 items-stretch gap-2;
}

.sidebar-settings-code-row .sidebar-settings-code {
  @apply min-w-0 flex-1;
}

.sidebar-settings-copy-button {
  @apply inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[#ddd5c7] bg-[#fffdf8] text-[#5b5146] transition-colors duration-100 hover:border-[#cdbfa8] hover:bg-[#f7f1e5] disabled:cursor-not-allowed disabled:opacity-45;
}

.sidebar-settings-copy-icon {
  @apply h-4 w-4;
}

.sidebar-settings-toggle-icon {
  @apply h-3 w-3;
}

.sidebar-settings-actions {
  @apply flex flex-wrap gap-2 px-3 py-2;
}

.sidebar-settings-toggle {
  @apply relative w-9 h-5 rounded-full bg-[#d8cfbf] transition-colors shrink-0;
}

.sidebar-settings-toggle::after {
  content: '';
  @apply absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow-sm;
}

.sidebar-settings-toggle.is-on {
  @apply bg-[#1f2937];
}

.sidebar-settings-toggle.is-on::after {
  transform: translateX(16px);
}

.settings-panel-enter-active,
.settings-panel-leave-active {
  transition: opacity 90ms ease;
}

.settings-panel-enter-from,
.settings-panel-leave-to {
  opacity: 0;
}

.settings-mobile-backdrop-enter-active,
.settings-mobile-backdrop-leave-active {
  transition: opacity 160ms ease;
}

.settings-mobile-backdrop-enter-from,
.settings-mobile-backdrop-leave-to {
  opacity: 0;
}

.settings-mobile-panel-enter-active,
.settings-mobile-panel-leave-active {
  transition:
    opacity 180ms ease,
    transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.settings-mobile-panel-enter-from,
.settings-mobile-panel-leave-to {
  opacity: 0;
  transform: translateY(1.5rem);
}

.sidebar-settings-rate-limits {
  @apply px-3 pb-2;
}

.sidebar-settings-about {
  @apply border-t border-[#f1eadf] px-3 py-2.5 flex flex-col gap-2;
}

.sidebar-settings-brand-card {
  @apply flex items-center gap-3 rounded-[24px] border border-[#d6e3ff] bg-[linear-gradient(135deg,rgba(236,244,255,0.96),rgba(255,255,255,0.98))] px-3 py-3;
  box-shadow: 0 12px 24px -24px rgba(30, 99, 255, 0.42);
}

.sidebar-settings-brand-logo {
  @apply h-14 w-14 shrink-0 rounded-[18px] border border-white/60 bg-white/75 object-cover;
  box-shadow: 0 12px 22px -20px rgba(30, 99, 255, 0.5);
}

.sidebar-settings-brand-copy {
  @apply min-w-0 flex flex-col gap-0.5;
}

.sidebar-settings-brand-kicker {
  @apply text-[10px] font-semibold uppercase tracking-[0.14em] text-[#5978c2];
}

.sidebar-settings-brand-title {
  @apply text-[15px] leading-5 font-semibold text-[#16367e];
}

.sidebar-settings-brand-subtitle {
  @apply text-[11px] leading-4 text-[#6a7cae];
}

.sidebar-settings-about-main {
  @apply flex items-center justify-between gap-2;
}

.sidebar-settings-about-trigger {
  @apply min-w-0 flex flex-1 items-center justify-between gap-3 rounded-[22px] border border-[#d8e5ff] bg-white/78 px-3 py-2 text-left transition-colors duration-100 hover:bg-[#f4f8ff] hover:border-[#bcd3ff] cursor-pointer;
}

.sidebar-settings-about-trigger:disabled {
  @apply cursor-not-allowed opacity-65 hover:bg-white/78 hover:border-[#d8e5ff];
}

.sidebar-settings-about-copy {
  @apply min-w-0 flex flex-col gap-0.5;
}

.sidebar-settings-about-label {
  @apply text-[11px] leading-4 text-[#8f8577];
}

.sidebar-settings-about-version {
  @apply text-sm leading-5 font-semibold text-[#2d261f];
}

.sidebar-settings-about-action {
  @apply text-[11px] leading-4 text-[#6a7cae];
}

.sidebar-settings-about-update-badge {
  @apply inline-flex shrink-0 items-center rounded-full border border-[#bfdbfe] bg-[#e8f1ff] px-2 py-0.5 text-[10px] font-semibold text-[#1d4ed8];
}

.sidebar-settings-github-button {
  @apply inline-flex min-h-9 shrink-0 items-center justify-center rounded-full border border-[#cbe7e1] bg-[#f0fdfa] px-3 text-xs font-semibold text-[#0f766e] transition-colors duration-100 hover:border-[#99f6e4] hover:bg-[#ccfbf1] hover:text-[#115e59] cursor-pointer;
}

.sidebar-settings-github-button:disabled {
  @apply cursor-not-allowed opacity-55 hover:border-[#cbe7e1] hover:bg-[#f0fdfa] hover:text-[#0f766e];
}

.sidebar-settings-github-button--secondary {
  @apply border-[#ddd5c7] bg-white text-[#6a6052] hover:border-[#d1c7b7] hover:bg-[#f7f4ed] hover:text-[#3f372d];
}

.sidebar-settings-about-meta {
  @apply flex items-center justify-between gap-2 text-[11px] leading-4 text-[#8f8577];
}

.sidebar-settings-about-meta span:last-child {
  @apply min-w-0 truncate text-right;
}

@media (max-width: 767px) {
  .sidebar-scrollable {
    @apply gap-1.5 px-1.5 pt-2 pb-1.5;
    padding-top: max(0.5rem, env(safe-area-inset-top));
  }

  .sidebar-top-shell {
    @apply gap-1.5 px-1.5 py-1.5 rounded-[16px];
  }

  .sidebar-settings-area {
    @apply px-1.5 pt-1.5;
    padding-bottom: max(0.5rem, env(safe-area-inset-bottom));
  }

  .sidebar-settings-panel-mobile .sidebar-settings-section-title {
    @apply px-4;
  }

  .sidebar-settings-panel-mobile .sidebar-settings-row,
  .sidebar-settings-panel-mobile .sidebar-settings-hint,
  .sidebar-settings-panel-mobile .sidebar-settings-actions,
  .sidebar-settings-panel-mobile .sidebar-settings-about,
  .sidebar-settings-panel-mobile .sidebar-settings-rate-limits {
    @apply px-4;
  }

  .sidebar-settings-panel-mobile .sidebar-settings-row {
    @apply py-3;
  }

  .sidebar-settings-panel-mobile .sidebar-settings-about {
    @apply py-3;
  }

  .sidebar-thread-controls-host {
    @apply px-1.5;
  }

  .sidebar-search-bar,
  .sidebar-skills-link {
    @apply mx-0;
  }

  .content-body {
    @apply gap-1;
  }

  .content-grid {
    @apply gap-1;
  }

  .content-meta-row {
    @apply gap-1.5;
  }

  .content-context-badge {
    @apply gap-1 px-1 py-0.5 text-[10px];
  }

  .content-title-refresh-button {
    @apply h-6.5 w-6.5;
  }

  .content-title-refresh-button-icon {
    @apply h-3.25 w-3.25;
  }

  .content-context-badge-icon {
    @apply h-4 w-4;
  }

  .content-context-badge-number {
    @apply min-w-[1.1rem] text-[10px];
  }

  .content-status-strip {
    @apply basis-full;
  }

  .composer-with-queue {
    @apply pt-1.5;
    background:
      linear-gradient(180deg, rgba(250,247,240,0) 0%, rgba(250,247,240,0.88) 24%, rgba(250,247,240,0.98) 100%);
  }

  .new-thread-empty {
    @apply px-4;
    padding-bottom: clamp(5.5rem, 18dvh, 8rem);
  }

  .skip-to-content {
    left: 0.75rem;
    right: 0.75rem;
    top: max(0.5rem, env(safe-area-inset-top));
    text-align: center;
  }
}

@media (min-width: 1024px) {
  .sidebar-scrollable {
    @apply px-3 py-3.5;
  }

  .sidebar-top-shell {
    @apply px-3 py-3;
  }

  .content-body {
    @apply px-4;
  }

  .content-grid {
    @apply gap-3.5;
  }

  .content-status-detail {
    max-width: min(44rem, 48vw);
  }
}

.desktop-refresh-confirm-overlay {
  @apply fixed inset-0 z-50 flex items-center justify-center bg-[#1f2937]/42 p-4 backdrop-blur-[2px];
}

.desktop-refresh-confirm-dialog {
  @apply w-full max-w-md rounded-[28px] border border-[#ddd5c7] bg-[#fffdf8] p-5 shadow-2xl shadow-[#1f2937]/15;
}

.desktop-refresh-confirm-kicker {
  @apply m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8f8577];
}

.desktop-refresh-confirm-title {
  @apply mt-2 mb-0 text-lg font-semibold leading-7 text-[#1f2937];
}

.desktop-refresh-confirm-text {
  @apply mt-2 mb-0 text-sm leading-6 text-[#5c5247];
}

.desktop-refresh-confirm-actions {
  @apply mt-5 flex items-center justify-end gap-2;
}

.desktop-refresh-confirm-button {
  @apply inline-flex items-center justify-center rounded-full border border-[#d8cfbf] bg-[#fffdf8] px-4 py-2 text-sm font-semibold text-[#544a3d] transition-colors duration-100 hover:border-[#bca98d] hover:bg-[#f7f1e5];
}

.desktop-refresh-confirm-button-primary {
  @apply border-[#1f2937] bg-[#1f2937] text-white hover:border-[#111827] hover:bg-[#111827];
}

.desktop-refresh-confirm-button-warning {
  @apply border-[#c2410c] bg-[#c2410c] hover:border-[#9a3412] hover:bg-[#9a3412];
}

.mobile-update-confirm-overlay {
  @apply fixed inset-0 z-[55] flex items-center justify-center bg-[#1f2937]/42 p-4 backdrop-blur-[3px];
}

.mobile-update-confirm-dialog {
  @apply w-full max-w-md rounded-[28px] border border-[#ddd5c7] bg-[#fffdf8] p-5 shadow-2xl shadow-[#1f2937]/15;
}

.mobile-update-confirm-kicker {
  @apply m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5978c2];
}

.mobile-update-confirm-title {
  @apply mt-2 mb-0 text-lg font-semibold leading-7 text-[#1f2937];
}

.mobile-update-confirm-text {
  @apply mt-2 mb-0 text-sm leading-6 text-[#5c5247];
}

.mobile-update-confirm-meta {
  @apply mt-3 flex items-center justify-between gap-3 rounded-2xl border border-[#ebe3d5] bg-[#fbf8f2] px-3 py-2 text-[12px] leading-5 text-[#6a6052];
}

.mobile-update-confirm-meta span:last-child {
  @apply min-w-0 text-right break-all text-[#2d261f];
}

.mobile-update-confirm-actions {
  @apply mt-5 flex items-center justify-end gap-2;
}

.mobile-update-confirm-button {
  @apply inline-flex items-center justify-center rounded-full border border-[#d8cfbf] bg-[#fffdf8] px-4 py-2 text-sm font-semibold text-[#544a3d] transition-colors duration-100 hover:border-[#bca98d] hover:bg-[#f7f1e5];
}

.mobile-update-confirm-button-primary {
  @apply border-[#1f2937] bg-[#1f2937] text-white hover:border-[#111827] hover:bg-[#111827];
}

@media (prefers-reduced-motion: reduce) {
  .settings-panel-enter-active,
  .settings-panel-leave-active,
  .settings-mobile-backdrop-enter-active,
  .settings-mobile-backdrop-leave-active,
  .settings-mobile-panel-enter-active,
  .settings-mobile-panel-leave-active,
  .sidebar-search-toggle,
  .sidebar-search-clear,
  .sidebar-skills-link,
  .desktop-refresh-button,
  .content-title-refresh-button,
  .sidebar-settings-button,
  .sidebar-settings-row,
  .sidebar-settings-about-trigger,
  .sidebar-settings-github-button,
  .mobile-update-confirm-button,
  .desktop-refresh-confirm-button {
    transition: none !important;
  }

  .content-title-refresh-button[data-busy='true'] .content-title-refresh-button-icon {
    animation: none !important;
  }
}

</style>
