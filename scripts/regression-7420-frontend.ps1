[CmdletBinding()]
param(
  [string]$BaseUrl = "http://127.0.0.1:7420",
  [string]$ThreadId = "",
  [int]$DesktopWidth = 1440,
  [int]$DesktopHeight = 900,
  [int]$PhoneWidth = 393,
  [int]$PhoneHeight = 852,
  [int]$PhoneLandscapeWidth = 852,
  [int]$PhoneLandscapeHeight = 393,
  [int]$FoldableWidth = 884,
  [int]$FoldableHeight = 1104,
  [switch]$CaptureScreenshots,
  [string]$ScreenshotTaskName = "frontend-ui-regression",
  [string]$ScreenshotOutputDir = "",
  [string]$RequireThreadTitle = "",
  [int]$AgentBrowserTimeoutSec = 25,
  [switch]$MeasureSendFeedback,
  [switch]$MeasureNewThreadFeedback,
  [switch]$MeasureResponseFeedback
)

$ErrorActionPreference = "Stop"
$ThreadInitialMessageWindowSize = 10
$HomeWorkspaceProjectsPollingTimeoutMs = 15000
$HomeWorkspaceProjectsFirstUsableBudgetMs = 5000

function Write-Step {
  param([string]$Message)
  Write-Host "[7420-frontend] $Message"
}

function Assert-True {
  param(
    [bool]$Condition,
    [string]$Message
  )
  if (-not $Condition) {
    throw $Message
  }
}

function Convert-ToSafeFileName {
  param([string]$Name)

  $safe = $Name -replace '[^A-Za-z0-9_.-]+', '-'
  $safe = $safe.Trim('-')
  if ([string]::IsNullOrWhiteSpace($safe)) {
    return "screenshot"
  }
  return $safe
}

function Assert-ImmediateAsyncRouteFallbackSource {
  $sourcePath = Join-Path (Get-Location) "src\App.vue"
  $source = Get-Content -Raw -Encoding UTF8 -LiteralPath $sourcePath
  $expectedFallbacks = @{
    SkillsHub = "PageLoadingSkeleton"
    ThreadConversation = "ConversationLoadingSkeleton"
    WorkspaceWorkbench = "PageLoadingSkeleton"
    GithubTrendingHub = "PageLoadingSkeleton"
    DiagnosticsPanel = "PageLoadingSkeleton"
  }

  foreach ($componentName in $expectedFallbacks.Keys) {
    $componentMatch = [regex]::Match(
      $source,
      "const\s+$componentName\s*=\s*defineAsyncComponent\(\{[\s\S]*?\n\s*\}\)"
    )
    Assert-True ($componentMatch.Success) "could not find async component definition for $componentName"
    Assert-True (
      $componentMatch.Value -match "loadingComponent:\s*$($expectedFallbacks[$componentName])"
    ) "$componentName must retain its layout-preserving loading fallback"
    Assert-True (
      $componentMatch.Value -match "delay:\s*0"
    ) "$componentName must show its loading fallback immediately instead of rendering an empty route frame"
  }
}

function Assert-CompleteThreadExportSource {
  $appSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (
    Join-Path (Get-Location) "src\App.vue"
  )
  $exportHelperPath = Join-Path (Get-Location) "src\utils\threadExport.ts"

  Assert-True (Test-Path -LiteralPath $exportHelperPath) "thread export must keep markdown generation in a lazy helper outside the main entry"
  $exportHelperSource = Get-Content -Raw -Encoding UTF8 -LiteralPath $exportHelperPath
  $completeActionMatch = [regex]::Match(
    $appSource,
    "async\s+function\s+runCompleteThreadExport[\s\S]*?(?=\r?\nasync\s+function\s+onArchiveThread)"
  )

  Assert-True ($completeActionMatch.Success) "complete export must retain one explicit action owner"
  $completeActionSource = $completeActionMatch.Value
  Assert-True ($appSource -match "let\s+threadExportPromise:\s*Promise<void>\s*\|\s*null\s*=\s*null" -and $appSource -match "async\s+function\s+runThreadMarkdownAction[\s\S]*?if\s*\(threadExportPromise\)[\s\S]*?await\s+threadExportPromise") "complete export must suppress duplicate full-history requests and downloads"
  Assert-True ($completeActionSource -match "showProductToast[\s\S]*?await\s+getThreadDetail\(threadId,\s*\{\s*responseView:\s*'full'\s*\}\)[\s\S]*?await\s+import\('\./utils/threadExport'\)[\s\S]*?downloadThreadMarkdown[\s\S]*?showProductToast") "complete export must expose progress, read the target thread directly, and download only after full history settles"
  Assert-True ($completeActionSource -notmatch "\bselectThread\s*\(|router\.push\s*\(|loadFullHistoryForSelectedThread\s*\(|selectedThreadId\.value") "copying or exporting another thread must not change or depend on the current navigation owner"
  Assert-True ($appSource -match "catch\s*\([^)]+\)[\s\S]*?showProductToast\([^\r\n]+?'danger'") "complete export must expose a recoverable failure state"
  Assert-True ($exportHelperSource -match "export\s+function\s+buildThreadMarkdown" -and $exportHelperSource -match "export\s+function\s+downloadThreadMarkdown") "the lazy export helper must own both markdown serialization and download"
}

function Assert-CompleteThreadCopySource {
  $appSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (
    Join-Path (Get-Location) "src\App.vue"
  )
  $sidebarSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (
    Join-Path (Get-Location) "src\components\sidebar\SidebarThreadTree.vue"
  )
  $exportHelperSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (
    Join-Path (Get-Location) "src\utils\threadExport.ts"
  )

  Assert-True (([regex]::Matches($sidebarSource, "onCopyThread\(openThreadMenuThread\.id\)")).Count -eq 1 -and $sidebarSource -match "'copy-thread':\s*\[threadId:\s*string\]") "the shared thread menu must expose one complete-conversation copy action"
  Assert-True ($appSource -match '@copy-thread="onCopyThread"' -and $appSource -match "function\s+onCopyThread[\s\S]*?runThreadMarkdownAction\(threadId,\s*true\)") "App must route complete-conversation copying through the full-history action owner"
  Assert-True ($appSource -match "async\s+function\s+runCompleteThreadExport[\s\S]*?await\s+getThreadDetail\(threadId,\s*\{\s*responseView:\s*'full'\s*\}\)[\s\S]*?buildThreadMarkdown[\s\S]*?copyTextToClipboard[\s\S]*?完整会话已复制") "complete-conversation copying must read the target thread without navigation, reuse Markdown serialization, and report success only after the clipboard write"
  Assert-True ($appSource -match "复制完整会话失败，请重试或使用导出") "complete-conversation copy failure must offer export as an actionable recovery"
  Assert-True ($exportHelperSource -match "export\s+function\s+buildThreadMarkdown") "complete-conversation copying must reuse the lazy Markdown serializer"
}

function Assert-NestedMobileBackOwnershipSource {
  $sidebarSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (
    Join-Path (Get-Location) "src\components\sidebar\SidebarThreadTree.vue"
  )
  $skillDetailSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (
    Join-Path (Get-Location) "src\components\content\SkillDetailModal.vue"
  )
  $conversationSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (
    Join-Path (Get-Location) "src\components\content\ThreadConversation.vue"
  )
  $favoritesSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (
    Join-Path (Get-Location) "src\components\content\FavoritesModal.vue"
  )
  $appSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (
    Join-Path (Get-Location) "src\App.vue"
  )

  Assert-True (
    $sidebarSource -match "function\s+onWindowKeyDownForSidebarSurface[\s\S]*?deleteThreadDialogVisible[\s\S]*?renameThreadDialogVisible[\s\S]*?openThreadMenuId[\s\S]*?openProjectMenuId[\s\S]*?isOrganizeMenuOpen"
  ) "sidebar Back handling must dismiss its topmost dialog or menu before the mobile drawer"
  $sidebarListenersAreSymmetric = ($sidebarSource -match "addEventListener\('keydown',\s*onWindowKeyDownForSidebarSurface,\s*true\)") -and ($sidebarSource -match "removeEventListener\('keydown',\s*onWindowKeyDownForSidebarSurface,\s*true\)")
  Assert-True $sidebarListenersAreSymmetric "sidebar transient surfaces must capture Escape before the App-level drawer handler"
  $skillDetailOwnsEscape = ($skillDetailSource -match 'role="dialog"[\s\S]*?aria-modal="true"') -and ($skillDetailSource -match "function\s+onWindowKeyDown[\s\S]*?props\.visible[\s\S]*?event\.preventDefault\(\)[\s\S]*?emit\('close'\)") -and ($skillDetailSource -match "addEventListener\('keydown',\s*onWindowKeyDown,\s*true\)")
  Assert-True $skillDetailOwnsEscape "skill details must own Escape/Android Back instead of navigating the underlying route"
  $conversationOwnsEscape = ($conversationSource -match "function\s+onWindowKeyDownForConversationSurface[\s\S]*?isLiveOverlayDetailOpen[\s\S]*?modalImageUrl[\s\S]*?isFileLinkContextMenuVisible[\s\S]*?pendingRollbackMessageId[\s\S]*?activeMessageActionId") -and ($conversationSource -match "addEventListener\('keydown',\s*onWindowKeyDownForConversationSurface,\s*\{\s*capture:\s*true\s*\}\)")
  Assert-True $conversationOwnsEscape "conversation transient surfaces must consume Escape/Android Back before route navigation"
  $favoritesOwnEscapeAndFocus = ($favoritesSource -match 'ref="panelRef"[\s\S]*?role="dialog"[\s\S]*?aria-modal="true"[\s\S]*?tabindex="-1"') -and ($favoritesSource -match "document\.body\.style\.overflow\s*=\s*'hidden'") -and ($favoritesSource -match "addEventListener\('keydown',\s*onWindowKeyDown,\s*\{\s*capture:\s*true\s*\}\)")
  Assert-True $favoritesOwnEscapeAndFocus "favorites must own focus, background scrolling, and Escape while visible"
  $blockingDialogsOwnEnvironment = ($appSource -match "function\s+dismissTopmostBlockingDialog[\s\S]*?isMobileShellUpdatePromptVisible[\s\S]*?pendingQueuedMessageEditId[\s\S]*?isDesktopRefreshConfirmVisible") -and ($appSource -match "addEventListener\('keydown',\s*onWindowKeyDownForBlockingDialog,\s*\{\s*capture:\s*true\s*\}\)") -and ($appSource -match "watch\(activeBlockingDialogKind[\s\S]*?document\.body\.style\.overflow\s*=\s*'hidden'[\s\S]*?resolveBlockingDialogElement\(kind\)\?\.focus")
  Assert-True $blockingDialogsOwnEnvironment "blocking App dialogs must own focus, background scrolling, and Escape before lower-layer controls"
}

function Assert-MobileDrawerEnvironmentOwnershipSource {
  $layoutSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (
    Join-Path (Get-Location) "src\components\layout\DesktopLayout.vue"
  )
  $sidebarSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (
    Join-Path (Get-Location) "src\components\sidebar\SidebarThreadTree.vue"
  )
  $environmentSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (
    Join-Path (Get-Location) "src\utils\modalEnvironment.ts"
  )
  $lazyEnvironmentSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (
    Join-Path (Get-Location) "src\composables\useLazyModalEnvironment.ts"
  )
  $appSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (
    Join-Path (Get-Location) "src\App.vue"
  )

  $hasModalSemantics = ($layoutSource -match 'ref="mobileDrawerRef"[\s\S]*?role="dialog"[\s\S]*?aria-modal="true"[\s\S]*?aria-label="会话导航"[\s\S]*?tabindex="-1"')
  Assert-True $hasModalSemantics "mobile drawer must expose one named modal navigation boundary"
  Assert-True ($environmentSource -match "portalRoot\?\.parentElement\s*===\s*document\.body[\s\S]*?!element\.inert[\s\S]*?element\.inert\s*=\s*true[\s\S]*?element\.inert\s*=\s*false") "mobile drawer must reversibly remove its body-level background from sequential and assistive navigation"
  Assert-True ($layoutSource -match "useLazyModalEnvironment\([\s\S]*?isMobileDrawerOpen" -and $lazyEnvironmentSource -match "import\('\.\./utils/modalEnvironment'\)") "mobile drawer environment code must stay outside the cold main entry"
  $hasFocusOwnership = ($environmentSource -match "const\s+onKeydown[\s\S]*?event\.key\s*!==\s*'Tab'") -and ($environmentSource -match "const\s+onFocusIn[\s\S]*?focusInitial\(\)") -and ($environmentSource -match '\[role="menu"\]')
  Assert-True $hasFocusOwnership "mobile drawer must contain Tab navigation and reclaim background focus"
  $hasSymmetricFocusListeners = ($environmentSource -match "addEventListener\('focusin',\s*onFocusIn,\s*true\)") -and ($environmentSource -match "removeEventListener\('focusin',\s*onFocusIn,\s*true\)")
  Assert-True $hasSymmetricFocusListeners "mobile drawer focus ownership listeners must be removed on unmount"
  $hasReversibleEnvironment = ($environmentSource -match "scrollOwner\.style\.overflow\s*=\s*'hidden'") -and ($environmentSource -match "scrollOwner\.style\.overflow\s*=\s*previousOverflow") -and ($environmentSource -match "previousFocus\.focus\(\{\s*preventScroll:\s*true\s*\}\)")
  Assert-True $hasReversibleEnvironment "mobile drawer must restore root scrolling and the exact connected opener"
  $settingsOwnsModalEnvironment = ($appSource -match 'ref="sidebarSettingsPanelRef"[\s\S]*?:role="isSettingsSheetMode[\s\S]*?:aria-modal="isSettingsSheetMode') -and ($appSource -match "useLazyModalEnvironment\([\s\S]*?isSettingsModalOpen[\s\S]*?sidebarSettingsPanelRef[\s\S]*?sidebarScrollableRef[\s\S]*?sidebarFooterActionsRef") -and ($lazyEnvironmentSource -match "resolveInertTargets[\s\S]*?ownModalEnvironment\([\s\S]*?resolveInertTargets\?\.\(\)") -and ($environmentSource -match "additionalInertTargets[\s\S]*?inertedElements[\s\S]*?element\.inert\s*=\s*true[\s\S]*?element\.inert\s*=\s*false")
  Assert-True $settingsOwnsModalEnvironment "mobile settings sheet must lazily own focus and reversibly isolate the underlying drawer"
  Assert-True ($appSource -match 'class="sidebar-settings-mobile-backdrop"[^>]*tabindex="-1"[^>]*aria-hidden="true"[^>]*@pointerdown\.prevent') "mobile settings backdrop must stay presentational and preserve its opener for focus restoration"
  Assert-True ($sidebarSource -match "function\s+onSelect\(threadId:\s*string\)[\s\S]*?querySelector\('\.mobile-drawer'\)[\s\S]*?emit\('select',\s*threadId\)[\s\S]*?nextTick[\s\S]*?getElementById\('main-content'\)\?\.focus\(\{\s*preventScroll:\s*true\s*\}\)") "mobile drawer thread navigation must transfer focus to the stable main-content boundary"
}

function Assert-MobileThreadActionDiscoverySource {
  $sidebarSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (
    Join-Path (Get-Location) "src\components\sidebar\SidebarThreadTree.vue"
  )
  $rowSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (
    Join-Path (Get-Location) "src\components\sidebar\SidebarMenuRow.vue"
  )

  Assert-True (([regex]::Matches($sidebarSource, ':aria-label="getThreadPinActionLabel\(thread\)"')).Count -eq 2) "both pinned and directory thread collections must use the contextual pin label"
  Assert-True ($sidebarSource -notmatch 'class="thread-pin-button"[^>]*title="置顶"') "direct thread pin actions must not expose a false static label"
  Assert-True ($sidebarSource -match "function\s+getThreadPinActionLabel\(thread:\s*UiThread\)[\s\S]*?isPinned\(thread\.id\)\s*\?\s*'取消置顶'\s*:\s*'置顶会话'") "thread pin labels must describe the action that will occur"
  $mobileThreadActionMedia = "@media\s*\(max-width:\s*767px\),\s*\(hover:\s*none\),\s*\(pointer:\s*coarse\),\s*\(max-height:\s*480px\)\s*and\s*\(max-width:\s*932px\)"
  Assert-True ($rowSource -match "$mobileThreadActionMedia[\s\S]*?sidebar-menu-row-right-default\s*\{[\s\S]*?display:\s*none;[\s\S]*?sidebar-menu-row-right-hover\s*\{[\s\S]*?display:\s*inline-flex;") "phone and touch thread rows must expose their existing action menu without hover"
  Assert-True ($sidebarSource -match "$mobileThreadActionMedia[\s\S]*?\.thread-pin-button\s*\{[\s\S]*?display:\s*none;[\s\S]*?\.thread-menu-trigger\s*\{[\s\S]*?width:\s*2\.25rem;[\s\S]*?height:\s*2\.25rem;[\s\S]*?\.thread-menu-wrap\s*\{[\s\S]*?height:\s*1\.75rem;") "phone and touch rows must remove hidden pin focus stops and retain a 36px menu target without increasing row density"
}

function Assert-ConciseThreadOpenLabelsSource {
  $sidebarSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (
    Join-Path (Get-Location) "src\components\sidebar\SidebarThreadTree.vue"
  )
  $labelHelper = [regex]::Match($sidebarSource, "function\s+getThreadOpenAriaLabel\(thread:\s*UiThread\):\s*string\s*\{[\s\S]*?\n\}")

  Assert-True (([regex]::Matches($sidebarSource, ':aria-label="getThreadOpenAriaLabel\(thread\)"')).Count -eq 2) "both pinned and directory thread collections must use the concise open-thread accessible label"
  Assert-True ($labelHelper.Success -and $labelHelper.Value -match "打开会话：" -and $labelHelper.Value -match "等待处理" -and $labelHelper.Value -match "执行中" -and $labelHelper.Value -match "未读" -and $labelHelper.Value -match "工作树会话") "thread open labels must retain actionable status without exposing their full preview"
  Assert-True ($labelHelper.Value -notmatch "preview") "thread open labels must not append the potentially unbounded preview"
}

function Assert-IndependentProjectControlsSource {
  $sidebarSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (
    Join-Path (Get-Location) "src\components\sidebar\SidebarThreadTree.vue"
  )

  Assert-True ($sidebarSource -notmatch 'class="project-header-row"[\s\S]{0,120}?role="button"' -and $sidebarSource -notmatch 'class="project-header-row"[\s\S]{0,120}?tabindex="0"') "project headers must not present a composite row containing nested buttons as one button"
  Assert-True ($sidebarSource -match '<button\s+class="project-main-button"[\s\S]*?:aria-label="getProjectToggleAriaLabel\(group\)"[\s\S]*?:aria-expanded="!isCollapsed\(group\.projectName\)"') "project collapse ownership must move to one named native button"
  Assert-True ($sidebarSource -match 'class="project-header-row"[\s\S]*?@click="toggleProjectCollapse\(group\.projectName\)"' -and $sidebarSource -match '@click\.stop="toggleProjectMenu\(\$event,\s*group\.projectName\)"') "project row pointer convenience and independent menu ownership must remain intact"
  Assert-True ($sidebarSource -match "function\s+getProjectToggleAriaLabel\(group:\s*UiProjectGroup\)[\s\S]*?'展开项目'\s*:\s*'收起项目'[\s\S]*?getProjectSummary\(group\)") "project toggle labels must expose their next action, title, and summary"
  Assert-True ($sidebarSource -match "\.project-main-button:focus-visible\s*\{[\s\S]*?outline:\s*2px\s+solid\s+var\(--ui-focus\)") "the new native project toggle must retain a visible keyboard focus indicator"
}

function Assert-BulkProjectCollapseSource {
  $sidebarSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (
    Join-Path (Get-Location) "src\components\sidebar\SidebarThreadTree.vue"
  )

  Assert-True ($sidebarSource -match 'aria-haspopup="menu"[\s\S]*?aria-controls="sidebar-organize-menu"' -and $sidebarSource -match 'id="sidebar-organize-menu"[\s\S]*?role="menu"') "the organize trigger and panel must expose one connected menu surface"
  Assert-True ($sidebarSource -match 'data-organize-action="collapse-all-projects"[\s\S]*?收起全部目录' -and $sidebarSource -match 'data-organize-action="expand-all-projects"[\s\S]*?展开全部目录') "directory organization must expose explicit bulk collapse and expand actions"
  Assert-True ($sidebarSource -match 'function\s+setAllProjectsCollapsed\(collapsed:\s*boolean\)[\s\S]*?props\.groups[\s\S]*?collapsedProjects\.value\s*=') "bulk project actions must update the existing persisted collapse state in one batch"
}

function Assert-SimpleRecentSidebarSource {
  $sidebarSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (
    Join-Path (Get-Location) "src\components\sidebar\SidebarThreadTree.vue"
  )
  $orderingSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (
    Join-Path (Get-Location) "src\utils\projectGroupOrdering.ts"
  )
  $recentOrderingSource = $orderingSource.Substring($orderingSource.IndexOf('export function orderProjectGroupsByRecentActivity'))

  Assert-True ($sidebarSource -match '<span class="thread-tree-header">目录</span>' -and $sidebarSource -match '<span class="thread-tree-header-subtitle">最近会话优先</span>') "the sidebar must expose one fixed directory hierarchy with a clear recency contract"
  Assert-True ($sidebarSource -notmatch '<span class="thread-section-label">正在运行</span>' -and $sidebarSource -notmatch 'threadViewMode|chronological|thread-list-global') "running state and chronological mode must not create parallel sidebar collections"
  Assert-True ($sidebarSource -match 'const\s+pinnedThreads\s*=\s*pinnedIds[\s\S]*?matchesThreadSearch\(thread,\s*query,\s*matchedIds\)\)[\r\n\s]*\.sort\(compareThreadByUpdatedAt\)') "pinned conversations must follow latest activity instead of pin insertion order"
  Assert-True ($sidebarSource -match 'function\s+projectThreads\(group:\s*UiProjectGroup\):\s*UiThread\[\][\s\S]*?sort\(compareThreadByUpdatedAt\)') "threads inside every directory must follow latest activity"
  Assert-True ($recentOrderingSource -match 'latestTimestamp[\s\S]*?activityDifference' -and $recentOrderingSource -notmatch 'isPinnedProject|pinnedProjectRank') "directories must follow their latest child conversation without pinned-project priority"
  Assert-True ($sidebarSource -notmatch '@mousedown\.left="onProjectHandleMouseDown' -and $sidebarSource -notmatch '@keydown="onProjectHeaderKeyDown' -and $sidebarSource -notmatch '<IconTablerPin\s+v-if="group\.isPinnedProject') "fixed recent ordering must not expose misleading manual-order or pinned-directory affordances"
}

function Assert-ExplicitSidebarSearchStatesSource {
  $appSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (
    Join-Path (Get-Location) "src\App.vue"
  )
  $sidebarSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (
    Join-Path (Get-Location) "src\components\sidebar\SidebarThreadTree.vue"
  )

  Assert-True ($appSource -notmatch '\bsearchThreads\b' -and $sidebarSource -match "getPinnedThreadIds,\s*searchThreads,\s*updatePinnedThreadIds") "full sidebar search must stay inside the existing lazy thread-tree boundary"
  Assert-True ($sidebarSource -match "watch\([\s\S]*?props\.searchQuery[\s\S]*?internalSearchState\.value\s*=\s*'pending'[\s\S]*?fullSearchTimer\s*=\s*setTimeout" -and $sidebarSource -match "function\s+runFullSearch[\s\S]*?result\.partial\s*===\s*true\s*\?\s*'partial'\s*:\s*'idle'[\s\S]*?internalSearchState\.value\s*=\s*'failed'") "debounced full search must distinguish pending, provisional, settled, and failed results"
  Assert-True ($sidebarSource -match "function\s+retryFullSearch[\s\S]*?runFullSearch\(query\)") "failed full search must retain an explicit retry path"
  Assert-True ($sidebarSource -match "isFullSearchPending[\s\S]*?正在搜索全部会话…[\s\S]*?hasFullSearchFailed[\s\S]*?完整搜索暂时不可用[\s\S]*?hasPartialSearchResults[\s\S]*?更多会话仍在整理[\s\S]*?再次检查[\s\S]*?没有匹配的会话") "thread search must distinguish pending, provisional local results, recoverable failure, and settled no-result states"
  Assert-True ($sidebarSource -match ':aria-busy="isSearchActive && \(isFullSearchPending \|\| hasPartialSearchResults\)' -and $sidebarSource -match 'role="status"[\s\S]*?aria-live="polite"') "sidebar search progress must expose both request and background-index work without an interruptive alert"
  $mobileSearchCloseMatch = [regex]::Match(
    $appSource,
    "function\s+closeMobileSidebarAfterNavigation\(\):\s*void\s*\{[\s\S]*?(?=\r?\nfunction\s+setSidebarCollapsed)"
  )
  $sharedCollapseMatch = [regex]::Match(
    $appSource,
    "function\s+setSidebarCollapsed\([\s\S]*?(?=\r?\nfunction\s+dismissTopmostBlockingDialog)"
  )
  Assert-True ($mobileSearchCloseMatch.Success) "could not find the mobile navigation drawer-close boundary"
  Assert-True ($mobileSearchCloseMatch.Value -match "if\s*\(\s*!shouldUseMobileSidebarDrawer\(\)\s*\)\s*return[\s\S]*?isSidebarSearchVisible\.value\s*=\s*false[\s\S]*?sidebarSearchQuery\.value\s*=\s*''[\s\S]*?setSidebarCollapsed\(true,\s*\{\s*persist:\s*false\s*\}\)") "successful mobile navigation must clear the transient drawer search before closing it"
  Assert-True ($sharedCollapseMatch.Success -and $sharedCollapseMatch.Value -notmatch 'isSidebarSearchVisible|sidebarSearchQuery') "manual drawer collapse must preserve an interrupted sidebar search"
}

function Assert-ActiveThreadSidebarRevealSource {
  $appSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (
    Join-Path (Get-Location) "src\App.vue"
  )
  $sidebarSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (
    Join-Path (Get-Location) "src\components\sidebar\SidebarThreadTree.vue"
  )
  $fixtureSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (
    Join-Path (Get-Location) "src\components\sidebar\SidebarRegressionFixture.vue"
  )

  Assert-True ($appSource -match 'ref="sidebarThreadTreeRef"' -and $appSource -match 'class="[^"]*sidebar-current-thread-button[^"]*"[\s\S]*?aria-label="定位当前会话"') "the fixed sidebar footer must expose one explicit current-conversation recovery action"
  Assert-True ($appSource -match "async\s+function\s+revealCurrentThreadInSidebar[\s\S]*?clearSidebarSearch\(\)[\s\S]*?await\s+nextTick\(\)[\s\S]*?revealSelectedThread\(\)") "current-conversation recovery must clear transient search before asking the lazy tree to reveal its row"
  Assert-True ($sidebarSource -match 'async\s+function\s+revealSelectedThread[\s\S]*?collapsedProjects\.value[\s\S]*?expandedProjects\.value[\s\S]*?await\s+nextTick\(\)[\s\S]*?thread-row\[data-active="true"\]') "the thread tree must reveal a selected row hidden by project collapse or preview limits"
  Assert-True ($sidebarSource -match "getBoundingClientRect\(\)[\s\S]*?container\.scrollTo\([\s\S]*?prefers-reduced-motion:\s*reduce") "current-conversation recovery must scroll only when needed and honor reduced-motion preference"
  Assert-True ($sidebarSource -match "defineExpose\(\{\s*revealSelectedThread\s*\}\)") "the lazy thread tree must expose only its bounded reveal action"
  Assert-True ($fixtureSource -match 'data-regression-action="reveal-current-thread"' -and $fixtureSource -match "fixture-thread-eight") "the sidebar fixture must keep a selected conversation outside its default five-row preview"
}

function Assert-MessageActionHitTestingSource {
  $source = Get-Content -Raw -Encoding UTF8 -LiteralPath (
    Join-Path (Get-Location) "src\components\content\ThreadConversation.vue"
  )

  Assert-True ($source -match "\.message-action-button\s*\{[\s\S]*?pointer-events:\s*none;") "visually hidden message actions must not intercept pointer input"
  Assert-True ($source -match "\.conversation-item-actions-active\s+\.message-action-button,[\s\S]*?\.conversation-item-actionable:focus-within\s+\.message-action-button\s*\{[\s\S]*?pointer-events:\s*auto;") "activated or keyboard-focused message actions must restore pointer ownership"
  Assert-True ($source -match "@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)[\s\S]*?\.conversation-item-actionable:hover\s+\.message-action-button[\s\S]*?pointer-events:\s*auto;") "fine-pointer hover must reveal and activate message actions"
  Assert-True ($source -match "\.message-action-button--favorite\.is-favorited\s*\{[\s\S]*?pointer-events:\s*auto;") "the always-visible favorited action must remain pointer-operable"
}

function Assert-StableHandsetViewportSource {
  $source = Get-Content -Raw -Encoding UTF8 -LiteralPath (
    Join-Path (Get-Location) "src\composables\useMobile.ts"
  )
  $hasStableHandsetFallback = ($source -match "const\s+COMPACT_HANDSET_MAX_SHORT_EDGE\s*=\s*480") -and ($source -match "isCoarsePointer\.value\s*\|\|\s*shortEdge\s*<=\s*COMPACT_HANDSET_MAX_SHORT_EDGE")
  Assert-True $hasStableHandsetFallback "handset-shaped landscape viewports must stay mobile when pointer media queries are temporarily unavailable"
}

function Assert-ReversibleThreadArchiveSource {
  $gatewaySource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\api\codexGateway.ts")
  $desktopStateSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\composables\useDesktopState.ts")
  $appSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\App.vue")
  $sidebarSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\components\sidebar\SidebarThreadTree.vue")
  $rpcCacheSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\server\appServerRpcCache.ts")

  Assert-True ($gatewaySource -match "function\s+archiveThread[\s\S]*?callRpc<unknown>\('thread/archive'[\s\S]*?payload\s*!==\s*null\s*&&\s*payload\s*!==\s*undefined" -and $gatewaySource -match "function\s+unarchiveThread[\s\S]*?callRpc\('thread/unarchive',\s*\{\s*threadId\s*\}\)") "archive must distinguish the proxy's local-only fallback before offering native thread/unarchive"
  Assert-True ($desktopStateSource -match "async\s+function\s+archiveThreadById\(threadId:\s*string\):\s*Promise<boolean>[\s\S]*?if\s*\(!archived\)[\s\S]*?hideThreadLocally[\s\S]*?return\s+false[\s\S]*?return\s+true" -and $desktopStateSource -match "async\s+function\s+unarchiveThreadById[\s\S]*?hiddenThreadIds\.value\.filter[\s\S]*?await\s+loadThreads\(\)[\s\S]*?return\s+true") "archive and undo must report their outcome and reconcile the visible thread list"
  Assert-True ($appSource -match "async\s+function\s+onArchiveThread[\s\S]*?await\s+archiveThreadById[\s\S]*?label:\s*'撤销'[\s\S]*?await\s+unarchiveThreadById") "successful archive must expose a short-lived undo action"
  Assert-True ($appSource -match "function\s+runProductToastAction[\s\S]*?productToastActionBusyId[\s\S]*?await\s+toast\.action\.run\(\)") "toast actions must suppress duplicate execution while asynchronous recovery is running"
  Assert-True ($sidebarSource -match ">\s*归档会话\s*<" -and $sidebarSource -match 'aria-label="归档会话"' -and $sidebarSource -notmatch ">\s*删除会话\s*<") "the sidebar must describe archival truthfully instead of presenting it as deletion"
  Assert-True ($rpcCacheSource -match "method\s*===\s*'thread/unarchive'") "thread restoration must invalidate the existing server-side thread cache"
}

function Assert-ForegroundResumeScrollIntentSource {
  $source = Get-Content -Raw -Encoding UTF8 -LiteralPath (
    Join-Path (Get-Location) "src\components\content\ThreadConversation.vue"
  )

  Assert-True ($source -match "function\s+onConversationScrollVisibilityChange[\s\S]*?document\.hidden[\s\S]*?isAtBottom\(container\)[\s\S]*?captureVisibleConversationAnchor\(\)") "conversation resume must capture bottom-follow and reading-anchor intent before the page is hidden"
  Assert-True ($source -match "pendingForegroundScrollIntent\?\.threadId\s*===\s*props\.activeThreadId[\s\S]*?foregroundScrollIntent\?\.followBottom[\s\S]*?foregroundScrollIntent\?\.anchorSnapshot") "the first recovered message update must consume the foreground scroll intent before restoring the viewport"
  Assert-True ($source -match "addEventListener\('wheel',\s*clearPendingForegroundScrollIntent[\s\S]*?addEventListener\('touchstart',\s*clearPendingForegroundScrollIntent[\s\S]*?addEventListener\('pointerdown',\s*clearPendingForegroundScrollIntent") "fresh pointer, touch, or wheel input must supersede a latched foreground scroll intent"
  Assert-True ($source -match "removeEventListener\('visibilitychange',\s*onConversationScrollVisibilityChange\)" -and $source -match "pendingForegroundScrollIntent\s*=\s*null[\s\S]*?scrollContextGeneration") "foreground scroll intent must be removed on unmount and cleared across thread ownership changes"
}

function Assert-ThreadAttentionChromeSource {
  $appSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (
    Join-Path (Get-Location) "src\App.vue"
  )
  $contentHeaderSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (
    Join-Path (Get-Location) "src\components\content\ContentHeader.vue"
  )
  $controlsSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (
    Join-Path (Get-Location) "src\components\sidebar\SidebarThreadControls.vue"
  )
  $fixtureSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (
    Join-Path (Get-Location) "src\components\sidebar\SidebarRegressionFixture.vue"
  )

  Assert-True ($appSource -match "const\s+attentionThreadCount\s*=\s*computed[\s\S]*?thread\.waitingForInput\s*\|\|\s*thread\.unread[\s\S]*?threadIds\.add\(thread\.id\)") "thread attention count must deduplicate waiting and unread conversations"
  Assert-True ($appSource -match ':attention-count="attentionThreadCount"' -and $appSource -match "attentionThreadCount\.value\s*>\s*0[\s\S]*?baseTitle") "collapsed sidebar controls and browser title must share the actionable thread count"
  Assert-True ($appSource -match "const\s+browserProductTitle[\s\S]*?'CX-Codex'[\s\S]*?CX-Codex · \$\{browserHostName\}" -and $appSource -match "const\s+routeTitle\s*=\s*contentTitle\.value\.trim\(\)[\s\S]*?\$\{routeTitle\} · \$\{browserProductTitle\}") "browser titles must identify the current product route and preserve non-local host identity"
  Assert-True ($contentHeaderSource -match "\.content-title\s*\{[\s\S]*?@apply[^;]*\bflex-1\b[^;]*\btruncate\b") "content header titles must own remaining row width and truncate from the end"
  Assert-True ($appSource -match "@media\s*\(max-width:\s*430px\)[\s\S]*?\.content-title-connection-label\s*\{\s*display:\s*none;") "narrow thread headers must keep connection recovery compact without removing its accessible label"
  Assert-True ($appSource -match "const\s+contentContextPercentLabel\s*=\s*computed[\s\S]*?Math\.round\(contentContextPercent\.value\)[\s\S]*?%") "visible context usage must include an explicit percent unit"
  Assert-True ($appSource -match "@media\s*\(max-width:\s*1023px\)[\s\S]*?\.content-title-refresh-button,\s*\.content-favorites-button\s*\{[\s\S]*?@apply[^;]*\bh-9\b[^;]*\bmin-w-9\b") "compact touch thread header actions must retain 36px targets across portrait and landscape widths"
  Assert-True ($controlsSource -match "isSidebarCollapsed\s*&&\s*normalizedAttentionCount\s*>\s*0" -and $controlsSource -match "9\+" -and $controlsSource -match "任务需要关注") "collapsed sidebar toggle must expose a bounded visible badge and an exact accessible label"
  Assert-True ($fixtureSource -match ':is-sidebar-collapsed="true"[\s\S]*?:attention-count="2"') "sidebar fixture must render the collapsed attention badge"
}

function Assert-AndroidResumeThreadListRecoverySource {
  $sourcePath = Join-Path (Get-Location) "src\composables\useDesktopState.ts"
  $source = Get-Content -Raw -Encoding UTF8 -LiteralPath $sourcePath
  $functionMatch = [regex]::Match($source, "function\s+shouldRefreshThreadListForResume[\s\S]*?\n\s*}")
  Assert-True ($functionMatch.Success) "could not find shouldRefreshThreadListForResume source"
  $functionSource = $functionMatch.Value
  Assert-True ($functionSource -notmatch "if\s*\(\s*androidShellAvailable\s*\)\s*return\s+false") "Android resume thread-list recovery is disabled"
  Assert-True ($source -match "const\s+ACTIVE_SYNC_THREAD_LIST_INTERVAL_MS\s*=\s*120000") "Android resume thread-list recovery interval must remain 120 seconds"
  Assert-True ($functionSource -match "return\s+isFirstAttempt\s*&&\s*now\s*-\s*lastThreadListSyncAtMs\s*>=\s*ACTIVE_SYNC_THREAD_LIST_INTERVAL_MS") "Android resume must refresh a stale thread list on the first resume attempt"
}

function Assert-CrossClientThreadStartedRefreshSource {
  $sourcePath = Join-Path (Get-Location) "src\composables\useDesktopState.ts"
  $source = Get-Content -Raw -Encoding UTF8 -LiteralPath $sourcePath
  $functionMatch = [regex]::Match($source, "function\s+shouldRefreshThreadListFromNotification[\s\S]*?\n\s*}")
  Assert-True ($functionMatch.Success) "could not find shouldRefreshThreadListFromNotification source"
  $functionSource = $functionMatch.Value
  Assert-True ($functionSource -match "method\s*===\s*'thread/started'") "thread/started must invalidate the thread list for other 7420 clients"
  Assert-True ($functionSource -match "method\s*===\s*THREAD_TOKEN_USAGE_UPDATED_METHOD\)\s*return\s+false") "token usage updates must not trigger thread-list refreshes"
}

function Assert-PendingStartOutboxRecoverySource {
  $sourcePath = Join-Path (Get-Location) "src\composables\useDesktopState.ts"
  $source = Get-Content -Raw -Encoding UTF8 -LiteralPath $sourcePath
  $outboxPersistenceSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\composables\messageOutboxPersistence.ts")
  $messageIdentitySource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\composables\messageIdentity.ts")
  $functionMatch = [regex]::Match($source, "async\s+function\s+recoverPersistentMessageOutbox[\s\S]*?\n\s*async\s+function\s+startRuntimeTurnWithBoundedRecovery")
  Assert-True ($functionMatch.Success) "could not find recoverPersistentMessageOutbox source"
  $functionSource = $functionMatch.Value
  Assert-True ($functionSource -match "recovered\?\.status\s*===\s*'pending_start'\s*&&\s*!recoveredThreadId") "threadless pending_start requests must be recovered before removing the outbox entry"
  Assert-True ($functionSource -match "!recovered\s*&&\s*\(entry\.state\s*===\s*'sending'\s*\|\|\s*entry\.state\s*===\s*'waiting'\)") "unacknowledged transport sends must retry from the durable outbox after reconnect"
  Assert-True ($functionSource -match "if\s*\(recoveredThreadId\)[\s\S]*?restoreWaitingMessageOutboxEntry\(entry,\s*recoveredThreadId\)[\s\S]*?restoreWaitingNewThreadOutboxEntry\(entry\)[\s\S]*?await\s+startRuntimeThreadTurn") "outbox recovery must restore visible waiting feedback before the network resume finishes"
  Assert-True ($functionSource -match "startRuntimeThreadTurn\(\{[\s\S]*?clientMessageId:\s*entry\.clientMessageId") "threadless pending_start recovery must reuse the durable client message id"
  Assert-True ($functionSource -match "restoreWaitingMessageOutboxEntry[\s\S]*?restoreWaitingNewThreadOutboxEntry") "transport recovery must preserve a waiting bubble for both existing and new threads"
  Assert-True ($functionSource -match "isRuntimeRequestAwaitingDeliveryConfirmation\(recovered\.status\)[\s\S]*?restoreConfirmingMessageOutboxEntry") "unconfirmed runtime requests must keep a confirming outbox bubble"
  Assert-True ($source -match "function\s+markOptimisticUserMessageConfirming[\s\S]*?updateMessageOutboxEntry\(clientMessageId,\s*\{\s*state:\s*'confirming'\s*\}\)") "confirming delivery must remain durable in the message outbox"
  Assert-True ($source -match "runtimeResult\s*&&\s*isRuntimeRequestAwaitingDeliveryConfirmation\(runtimeResult\.status\)[\s\S]*?markOptimisticUserMessageConfirming") "direct sends must not present an unconfirmed request as sent"
  Assert-True ($source -match "hasUnconfirmedMessageOutboxEntryForThread\(threadId\)[\s\S]*?shouldSettleOptimisticDeliveryFromRuntimeSnapshot[\s\S]*?void\s+recoverPersistentMessageOutbox\(\)") "a failed runtime snapshot must reconcile an unconfirmed outbox entry instead of presenting it as sent"
  Assert-True ($source -match "messageOutboxRemovalByClientId[\s\S]*?mergeMessageOutboxState") "cross-page outbox recovery must retain deletion markers"
  Assert-True ($source -match "removeMessageOutboxEntry[\s\S]*?messageOutboxRemovalByClientId\.set\(clientMessageId,\s*removedAtMs\)") "confirmed outbox deletion must prevent stale-page resurrection"
  Assert-True ($source -match "function\s+convergeMessageOutboxFromStorage[\s\S]*?mergeMessageOutboxFromStorage\(\)[\s\S]*?persistMessageOutbox\(\)") "concurrent storage writes must merge and converge instead of replacing local state"
  Assert-True ($source -match "function\s+reconcilePendingNewThreadPreviewWithOutbox[\s\S]*?pendingNewThreadPreview\.value\s*=\s*null") "cross-page outbox removal must clear a stale new-thread preview"
  Assert-True ($functionSource -match "await\s+getRuntimeRequestByClientMessageId\(entry\.clientMessageId\)[\s\S]*?messageOutboxByClientId\.get\(entry\.clientMessageId\)[\s\S]*?if\s*\(!currentEntry\)\s*continue") "outbox recovery must discard stale lookup results after another page removes the entry"
  Assert-True ($source -match "isFirstAttempt\)[\s\S]*?mergeMessageOutboxFromStorage\(\)[\s\S]*?recoverPersistentMessageOutbox\(\)") "foreground resume must reconcile the durable message outbox on its first attempt"
  Assert-True ($source -match "addEventListener\('storage',\s*onStorage\)") "parallel 7420 pages must observe message outbox storage changes"
  Assert-True ($outboxPersistenceSource -match "baselineMatchCount\?:\s*number" -and $outboxPersistenceSource -match "baselineMatchCount:\s*typeof\s+row\.baselineMatchCount[\s\S]*?Math\.floor\(row\.baselineMatchCount\)") "the durable outbox must retain the pre-send signature count"
  Assert-True ($messageIdentitySource -match "function\s+recoverOptimisticBaselineMatchCount[\s\S]*?baselineTailMessageId[\s\S]*?baselineMessageCount") "legacy outbox rows must reconstruct their pre-send signature boundary"
  Assert-True ($source -match "function\s+restoreOptimisticMetaFromOutbox[\s\S]*?recoverOptimisticBaselineMatchCount\([\s\S]*?entry\.baselineMatchCount") "outbox restoration must not count the already-persisted prompt as its own baseline"
}

function Assert-RuntimeSnapshotOrderingSource {
  $sourcePath = Join-Path (Get-Location) "src\composables\useDesktopState.ts"
  $source = Get-Content -Raw -Encoding UTF8 -LiteralPath $sourcePath
  $gatewaySource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\api\codexGateway.ts")
  $runtimeQueueClientSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\api\runtimeMessageQueue.ts")
  $runtimeQueueServerSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\server\runtimeMessageQueue.ts")
  $serverSnapshotSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\server\appServerThreadRuntimeSnapshot.ts")
  $conversationSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\components\content\ThreadConversation.vue")
  $foregroundRecoveryPolicySource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\composables\foregroundRecoveryPolicy.ts")
  Assert-True ($source -match "const\s+currentEventSeq\s*=\s*Math\.max\([\s\S]*?latestRuntimeEventSeqByThreadId\.get\(threadId\)[\s\S]*?shouldApplyRuntimeSnapshotVersion\(\{\s*lastEventSeq:\s*currentEventSeq\s*\},\s*snapshot\)") "runtime snapshots must be checked against the latest buffered event sequence"
  Assert-True ($source -match "eventSeq:\s*notification\.seq") "runtime notification state must retain the authoritative event sequence"
  Assert-True ($source -match "rememberLatestRuntimeEventSequence\(threadId,\s*notification\.seq\)[\s\S]*?method\.endsWith\('/delta'\)") "delta events must record their latest sequence before taking the non-reactive fast path"
  Assert-True ($source -match "method\.endsWith\('/delta'\)[\s\S]*?isRuntimeExecutionActiveState\(currentState\)[\s\S]*?markThreadLiveExecutionSignal\(threadId\)[\s\S]*?isRuntimeExecutionSettledState\(currentState\)\)\s*return") "high-frequency deltas must not rewrite reactive runtime state or revive a settled turn"
  Assert-True ($source -match "const\s+initialRuntimeSnapshotApplied\s*=\s*applyRuntimeSnapshotState\(threadId,\s*snapshot\)[\s\S]*?refreshSettledSnapshotMessagesFromRpc") "foreground recovery must apply the lightweight runtime snapshot before a heavy history refresh"
  Assert-True ($source -match "preferCachedMessages:\s*options\.preferSessionLogMessages\s*===\s*true\s*\|\|\s*shouldShowLoading") "session-log notifications and cold thread selection must request recoverable cached messages before a heavy history read"
  Assert-True ($source -match "preferCachedMessages:\s*options\.preferSessionLogMessages\s*===\s*true\s*\|\|\s*shouldShowLoading\s*\|\|\s*options\.fullHistory\s*===\s*true\s*\|\|\s*Boolean\(options\.olderHistory\)") "session-log refreshes and explicit history paging must reuse the lightweight cached state before an authoritative RPC"
  Assert-True ($gatewaySource -match "preferCachedMessages\s*\?\s*'\?preferCachedMessages=1'") "the frontend gateway must opt into the cache-first thread-state route"
  Assert-True ($serverSnapshotSource -match "options\.preferCachedMessages\s*===\s*true[\s\S]*?readSessionLogThreadRead[\s\S]*?messageState\s*=\s*'cached'") "cache-first state must recover local session messages without presenting them as authoritative"
  Assert-True ($serverSnapshotSource -match "trimThreadTurnsInRpcResult\('thread/read',\s*recoveredThreadRead\)") "cache-first session recovery must retain the bounded initial message window"
  Assert-True ($source -match "shouldDeferCachedRpcRefresh[\s\S]*?scheduleSettledSnapshotMessagesRpcRefresh") "cache-first messages must trigger an immediate background authoritative refresh"
  Assert-True ($source -match "shouldDeferCachedRpcRefresh\s*=\s*options\.forceSettledRpcRefresh\s*!==\s*true") "the forced authoritative refresh must not defer itself again"
  Assert-True ($source -match "options\.preferSessionLogMessages\s*===\s*true\s*&&\s*snapshot\.messageState\s*===\s*'cached'[\s\S]*?scheduleSessionLogAuthoritativeRefresh\(threadId") "session-log projections must coalesce a quiet-period authoritative refresh instead of remaining permanently lossy"
  Assert-True ($source -match "pendingSessionLogMessageRefresh\.add\(threadId\)[\s\S]{0,240}?scheduleSessionLogAuthoritativeRefresh\(threadId\)") "each session-log notification must reset the authoritative quiet window before its local projection begins"
  Assert-True ($source -match "getSessionLogAuthoritativeRefreshAction\(\{[\s\S]*?executionActive:\s*isThreadExecutionActive\(threadId\)[\s\S]*?hasPendingServerRequest:\s*hasPendingServerRequestSignal\(threadId\)[\s\S]*?hasQueuedWork:\s*hasQueuedThreadWork\(threadId\)[\s\S]*?action\s*===\s*'defer'[\s\S]*?scheduleSessionLogAuthoritativeRefresh\(threadId\)") "session-log convergence must not issue a heavy authoritative history read while a turn or queued action is active"
  Assert-True ($source -match "hasTerminalEvidence:\s*hasSettledSessionLogMessageEvidence\([\s\S]*?persistedMessagesByThreadId\.value\[threadId\][\s\S]*?action\s*===\s*'defer'") "cross-process session-log convergence must wait for a final assistant message instead of trusting a false settled light snapshot"
  Assert-True ($source -match "shouldForceCachedSnapshotRefresh\s*=\s*options\.force\s*===\s*true\s*&&\s*snapshot\.messageState\s*===\s*'cached'") "cached historical threads without a terminal event key must still receive an authoritative refresh"
  Assert-True ($source -match "!options\.olderHistory\s*&&\s*!shouldForceCachedSnapshotRefresh") "explicit older-history reads must not be blocked when a legacy thread has no terminal refresh key"
  Assert-True ($conversationSource -match "pendingRemoteOlderHistoryAnchor\s*=\s*anchorSnapshot[\s\S]*?emit\('loadOlderHistory'\)[\s\S]*?props\.messages\.length[\s\S]*?restoreScrollAnchorOverFrames\(anchorSnapshot,\s*6\)") "remote older-history insertion must restore the pre-request reading anchor after messages arrive"
  Assert-True ($source -match "else\s+if\s*\(!shouldDeferCachedRpcRefresh\)\s*\{\s*scheduleNonFreshThreadDetailRetry") "the slow non-fresh retry must not race the immediate cached-message refresh"
  Assert-True ($source -match "connectionStale:\s*notificationStale\.value\s*\|\|\s*syncLagging\.value" -and $foregroundRecoveryPolicySource -match "state\.connectionStale\s*&&\s*!state\.recentlySynced") "startup notification health recovery must not duplicate a just-completed authoritative message refresh"
  Assert-True ($source -match "allowRoutineActiveRefresh:\s*isFirstAttempt" -and $foregroundRecoveryPolicySource -match "if\s*\(!state\.allowRoutineActiveRefresh\)\s*return\s+false") "later Android resume retries must not repeatedly reload a healthy active conversation"
  Assert-True ($source -match "existingWasAuthoritative\s*=\s*authoritativeMessageLoadInFlightThreadIds\.has\(threadId\)[\s\S]*?existingWasAuthoritative\s*&&\s*options\.fullHistory\s*!==\s*true\s*&&\s*!options\.olderHistory") "concurrent snapshot recovery must reuse an in-flight authoritative message read"
  Assert-True ($source -match "const\s+refreshedRuntimeSnapshotApplied\s*=\s*snapshot\s*===\s*initialRuntimeSnapshot[\s\S]*?\?\s*false[\s\S]*?:\s*applyRuntimeSnapshotState") "the same settled snapshot must not be applied twice while queued work starts"
  Assert-True ($source -match "const\s+runtimeSnapshotApplied\s*=\s*initialRuntimeSnapshotApplied\s*\|\|\s*refreshedRuntimeSnapshotApplied") "message reconciliation must retain a runtime snapshot applied before history refresh"
  Assert-True ($source -match "settleOptimisticUserMessagesThrough\(threadId,\s*settledAtMs\)") "authoritative terminal snapshots must clear older optimistic running residue"
  Assert-True ($source -match "setTurnActivityForThread\(threadId,\s*\{\s*reset:\s*true") "a new local send must start a distinct activity timeline"
  Assert-True ($source -match "activityId:\s*activity\?\.activityId") "the live overlay must expose stable activity identity to the conversation renderer"
  Assert-True ($source -match "Math\.min\(previous\.startedAtMs,\s*authoritativeStartedAtMs\)") "foreground recovery must correct a provisional timer with the earlier authoritative start time"
  Assert-True ($source -match "readRuntimeActivityStartedAtMs\(runtimeSummary\)") "activity recovery must reject a start timestamp that belongs to an already completed turn"
  Assert-True ($source -match "const\s+unread\s*=\s*!inProgress\s*&&\s*unreadByEvent") "thread timestamps alone must not mark every sidebar row unread"
  Assert-True ($source -match "function\s+markThreadUnreadByEvent[\s\S]*?threadId\s*===\s*selectedThreadId\.value\)\s*return") "background events must not mark the conversation currently being read as unread"
  Assert-True ($source -match "function\s+markThreadAsUnread[\s\S]*?replaceEventUnreadState") "manual unread actions must reuse the persisted unread state"
  Assert-True ($source -match "const\s+UNREAD_STATE_STORAGE_KEY[\s\S]*?function\s+saveUnreadStateMap") "completion unread state must survive mobile process restarts"
  Assert-True ($source -match "function\s+applyReplayedRuntimeTerminalCleanup[\s\S]*?markThreadUnreadByEvent\(threadId\)") "replayed terminal events must restore unread completion feedback"
  Assert-True ($source -match "clearSettledRuntimeResidue\(threadId,\s*snapshot\.executionState\)[\s\S]*?processQueuedMessages\(threadId\)") "a settled runtime snapshot must release the previous turn and advance queued work"
  Assert-True ($runtimeQueueServerSource -match "next\.status\s*===\s*'queue_failed'[\s\S]*?return") "a failed durable queued follow-up must pause instead of retrying indefinitely"
  Assert-True ($runtimeQueueClientSource -match "persistRuntimeQueuedMessages[\s\S]*?isRetryableQueueError[\s\S]*?deliveryState:\s*'failed'") "queued handoff failures must remain visible and retryable"
  Assert-True ($source -match "function\s+retryQueuedMessage[\s\S]*?setQueuedMessageDeliveryState\(threadId,\s*messageId,\s*'queued'\)[\s\S]*?processQueuedMessages\(threadId\)") "manual queue retry must resume the paused first item"
  Assert-True ($source -match "function\s+deleteQueuedMessage[\s\S]*?removeQueuedMessageByThreadId\(threadId,\s*messageId\)[\s\S]*?processQueuedMessages\(threadId\)") "deleting a failed queue item must release the following item"
  Assert-True ($runtimeQueueClientSource -match "clientMessageId:\s*message\.clientMessageId") "queued follow-ups must reuse a stable idempotency key across pages and retries"
  Assert-True ($source -match "event\.key\s*===\s*QUEUED_MESSAGES_STORAGE_KEY[\s\S]*?api\.loadQueuedMessagesMap\(QUEUED_MESSAGES_STORAGE_KEY\)") "parallel 7420 pages must converge queued-message state without browser-owned execution"
  $strongSignalMatch = [regex]::Match($source, "function\s+hasStrongExecutionSignal[\s\S]*?\n\s*}")
  Assert-True ($strongSignalMatch.Success -and $strongSignalMatch.Value -notmatch "hasQueuedThreadWork") "queued follow-up work must not keep the completed turn marked as running"
  $messageRefreshMatch = [regex]::Match($source, "function\s+shouldRefreshMessagesFromNotification[\s\S]*?\n}")
  Assert-True ($messageRefreshMatch.Success) "could not find message refresh notification policy"
  Assert-True ($messageRefreshMatch.Value -match "turn/completed" -and $messageRefreshMatch.Value -match "thread/completed") "terminal notifications must still refresh authoritative messages"
  Assert-True ($messageRefreshMatch.Value -notmatch "item/completed" -and $messageRefreshMatch.Value -notmatch "startsWith\('thread/'\)") "item completion and generic thread metadata must not trigger repeated full-history reads"
  Assert-True ($source -match "ACTIVE_THREAD_DETAIL_FALLBACK_SYNC_INTERVAL_MS\s*=\s*60000") "healthy active turns must use the one-minute detail fallback instead of continuous heavy reads"
  Assert-True ($source -match "if\s*\(showRecoveryFeedback\)[\s\S]*?beginForegroundRecoveryFeedback\(selectedThreadId\.value\)[\s\S]*?ANDROID_RESUME_SYNC_DEBOUNCE_MS") "foreground recovery feedback must publish before Android resume sync debounce"
  Assert-True ($source -match "foregroundRecoveryThreadId\.value\s*===\s*threadId\)\s*return") "duplicate foreground lifecycle events must not restart recovery feedback"
  Assert-True ($source -match "finishForegroundRecoveryFeedback\(threadId\)[\s\S]*?shouldApplyRuntimeSnapshotVersion") "the first runtime snapshot must settle foreground recovery feedback"
  $conversationSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\components\content\ThreadConversation.vue")
  $queueSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\components\content\QueuedMessages.vue")
  Assert-True ($queueSource -match "队列已暂停。重试、编辑或删除后继续") "the paused queue must explain the available recovery actions"
  Assert-True ($queueSource -match "retry:\s*\[messageId:\s*string\]") "the failed queue row must expose a retry action"
  Assert-True ($conversationSource -match "previousOverlay\.activityId\s*===\s*nextOverlay\.activityId") "elapsed time may only be retained for the same activity"
  Assert-True ($conversationSource -match "live-overlay-inline-recovering[\s\S]*?aria-busy") "foreground recovery must expose one accessible animated status surface"
}

function Assert-ManualUnreadAndComposerAttachmentSource {
  $appSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\App.vue")
  $sidebarSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\components\sidebar\SidebarThreadTree.vue")
  $composerSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\components\content\ThreadComposer.vue")
  $composerSearchDropdownSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\components\content\ComposerSearchDropdown.vue")
  $composerFixtureSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\components\content\ComposerRegressionFixture.vue")
  $composerEnterBehaviorSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\composables\composerEnterBehavior.ts")
  $modalEnvironmentSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\utils\modalEnvironment.ts")
  $lazyModalEnvironmentSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\composables\useLazyModalEnvironment.ts")

  Assert-True (([regex]::Matches($sidebarSource, "onToggleThreadUnread\(openThreadMenuThread\)")).Count -eq 1) "the shared sidebar thread menu must expose exactly one unread toggle"
  Assert-True ($sidebarSource -match "openThreadMenuThread\.unread\s*\?\s*'标记为已读'\s*:\s*'标记为未读'") "the unread menu label must reflect the current thread state"
  Assert-True ($appSource -match '@set-thread-unread="onSetThreadUnread"[\s\S]*?function\s+onSetThreadUnread[\s\S]*?markThreadAsUnread[\s\S]*?markThreadAsRead') "the sidebar unread toggle must reach both persisted state actions"
  Assert-True ($composerSource -match '@dragenter="onComposerDragEnter"[\s\S]*?@drop="onComposerDrop"') "the composer must own the complete file-drag lifecycle"
  Assert-True ($composerSource -match "function\s+onComposerDrop[\s\S]*?addFiles\(files\)") "dropped files must reuse the existing upload queue"
  Assert-True ($composerSource -match 'function\s+onComposerPaste[\s\S]*?item\.kind\s*===\s*''file''[\s\S]*?event\.preventDefault\(\)[\s\S]*?addFiles\(files\)') "clipboard files must be intercepted without replacing ordinary text paste"
  Assert-True ($composerSource -match 'v-if="isFileDragActive"[\s\S]*?松开即可添加') "file drag feedback must remain visible and explicit"
  $inputKeydown = [regex]::Match($composerSource, "function\s+onInputKeydown\(event:\s*KeyboardEvent\):\s*void\s*\{[\s\S]*?\n\}")
  Assert-True ($inputKeydown.Success) "the composer input keydown handler must remain inspectable"
  $imeGuardIndex = $inputKeydown.Value.IndexOf("if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return")
  $fileMentionIndex = $inputKeydown.Value.IndexOf("if (isFileMentionOpen.value)")
  Assert-True ($imeGuardIndex -ge 0 -and $imeGuardIndex -lt $fileMentionIndex) "IME composition must be guarded before file-mention keyboard selection"
  Assert-True ($composerSource -match "\.thread-composer-input\s*\{[\s\S]*?max-h-32[\s\S]*?field-sizing:\s*content;") "the compact composer input must grow with content up to its existing bounded height"
  Assert-True ($composerEnterBehaviorSource -match "storedPreference\s*===\s*'1'[\s\S]*?storedPreference\s*===\s*'0'[\s\S]*?return\s+!isMobile") "the default Enter policy must preserve explicit preferences and use newline only for an unset mobile default"
  Assert-True ($appSource -match "storedSendWithEnterPreference[\s\S]*?resolveSendWithEnterPreference\([\s\S]*?isMobile\.value[\s\S]*?function\s+toggleSendWithEnter[\s\S]*?storedSendWithEnterPreference\.value") "App must keep automatic phone/desktop Enter defaults separate from explicit saved preference"
  Assert-True ($composerFixtureSource -match ':send-with-enter="sendWithEnter"' -and $composerFixtureSource -match "useMobile\(\)[\s\S]*?resolveSendWithEnterPreference\(null,\s*isMobile\.value\)") "the Composer fixture must exercise the responsive unset-preference default"
  Assert-True ($composerSource -match 'aria-haspopup="dialog"[\s\S]*?aria-controls="thread-composer-attach-menu"' -and $composerSource -match 'aria-controls="thread-composer-runtime-panel"[\s\S]*?aria-label="配置模型、质量和速度"') "composer sheet triggers must expose their dialog ownership"
  Assert-True ($composerSource -match "const\s+composerSurfaceKind[\s\S]*?isAttachMenuOpen\.value[\s\S]*?isRuntimeSettingsOpen\.value" -and $composerSource -match "useLazyModalEnvironment\([\s\S]*?composerSurfaceKind[\s\S]*?document\.body[\s\S]*?isCompactViewport\.value" -and $lazyModalEnvironmentSource -match "isModal[\s\S]*?panel\.focus[\s\S]*?import\('\.\./utils/modalEnvironment'\)") "composer sheet environment ownership must remain limited to compact viewports while desktop popovers retain initial focus"
  Assert-True ($modalEnvironmentSource -match "scrollOwner\.style\.overflow\s*=\s*'hidden'" -and $modalEnvironmentSource -match "scrollOwner\.style\.overflow\s*=\s*previousOverflow" -and $modalEnvironmentSource -match "addEventListener\('focusin',\s*onFocusIn,\s*true\)" -and $modalEnvironmentSource -match "removeEventListener\('focusin',\s*onFocusIn,\s*true\)") "compact composer sheets must contain focus and restore background scrolling"
  Assert-True ($modalEnvironmentSource -match "isExternalSurface[\s\S]*?aria-modal[\s\S]*?!panel\.contains\(surface\)" -and $composerSearchDropdownSource -notmatch "document\.body\.style\.overflow") "nested skill search must stay inside the composer modal owner without competing for body scroll state"
  Assert-True ($composerSearchDropdownSource -match 'aria-controls="composer-skill-search-dialog"[\s\S]*?id="composer-skill-search-dialog"[\s\S]*?role="dialog"' -and $composerSearchDropdownSource -match "focusFirstMenuControl[\s\S]*?onDocumentFocusIn[\s\S]*?removeEventListener\('focusin',\s*onDocumentFocusIn,\s*true\)") "the nested skill dialog must expose ownership, contain mobile focus, and clean up its listener"
  Assert-True ($composerFixtureSource -match "composerFixtureFetch[\s\S]*?/codex-api/composer-file-search[\s\S]*?ThreadComposer\.vue" -and $composerFixtureSource -match "window\.fetch\s*===\s*composerFixtureFetch") "composer IME regression must use deterministic file suggestions and restore fetch ownership"
  Assert-True ($composerFixtureSource -match "data-composer-regression-background-focus") "composer fixture must expose a deterministic background focus target for modal ownership checks"
}

function Assert-CurrentReasoningEffortCoverageSource {
  $typeSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\types\codex.ts")
  $appSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\App.vue")
  $gatewaySource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\api\codexGateway.ts")
  $desktopStateSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\composables\useDesktopState.ts")
  $outboxSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\composables\messageOutboxPersistence.ts")
  $composerSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\components\content\ThreadComposer.vue")
  $workbenchSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\components\content\WorkspaceWorkbench.vue")

  foreach ($effort in @('max', 'ultra')) {
    Assert-True ($typeSource -match "ReasoningEffort[^\r\n]+'$effort'") "ReasoningEffort must include the app-server $effort level"
    Assert-True ($gatewaySource -match "allowed:[^\r\n]+'$effort'") "config normalization must retain the app-server $effort level"
    Assert-True ($desktopStateSource -match "REASONING_EFFORT_OPTIONS[^\r\n]+'$effort'") "desktop state must persist and submit the $effort level"
    Assert-True ($outboxSource -match "OUTBOX_REASONING_EFFORTS[^\r\n]+'$effort'") "queued messages must preserve the $effort level"
    Assert-True ($appSource -match "candidate\.reasoningEffort\s*===\s*'$effort'") "workbench presets must accept the $effort level"
  }

  Assert-True ($composerSource -match "max:\s*'最高'" -and $composerSource -match "ultra:\s*'极致'") "every current reasoning option must render a visible and accessible Chinese label"
  Assert-True ($workbenchSource -match "max:\s*'最高'" -and $workbenchSource -match "ultra:\s*'极致'") "workbench summaries must label max and ultra without falling back to smart"
}

function Assert-CollisionAwareThreadMenuSource {
  $sidebarSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\components\sidebar\SidebarThreadTree.vue")
  $threadMenuTemplate = [regex]::Match($sidebarSource, 'id="sidebar-thread-actions-menu"[\s\S]*?</div>\s*</Teleport>')

  Assert-True (([regex]::Matches($sidebarSource, 'class="thread-menu-panel"')).Count -eq 1) "thread actions must render through one shared menu instead of duplicating per collection"
  Assert-True ($sidebarSource -match '<Teleport\s+to="body">[\s\S]*?id="sidebar-thread-actions-menu"[\s\S]*?role="menu"') "the shared thread menu must escape sidebar overflow through a body portal"
  Assert-True ($threadMenuTemplate.Success -and ([regex]::Matches($threadMenuTemplate.Value, '<button[^>]+role="menuitem"')).Count -eq 9) "the shared thread menu must retain all nine thread actions"
  Assert-True ($sidebarSource -match "openThreadMenuKey[\s\S]*?isThreadMenuOpen\(menuKey" -and $sidebarSource -match ':aria-expanded="isThreadMenuOpen') "duplicate thread rows must track the exact menu trigger that owns the open state"
  Assert-True ($sidebarSource -match "function\s+positionThreadMenu[\s\S]*?shouldPlaceAbove[\s\S]*?viewportHeight[\s\S]*?threadMenuPlacement" -and $sidebarSource -match ':data-side="threadMenuPlacement"') "thread menu positioning must flip and clamp against the current viewport"
  Assert-True ($sidebarSource -match "\.thread-menu-panel\s*\{[\s\S]*?@apply\s+fixed[\s\S]*?overflow-y-auto" -and $sidebarSource -match "overscroll-behavior:\s*contain") "thread menu content must stay fixed and independently scrollable in constrained viewports"
  $viewportListenersAreSymmetric = ($sidebarSource -match "addEventListener\('scroll',\s*onThreadMenuViewportChange,\s*true\)") -and ($sidebarSource -match "removeEventListener\('scroll',\s*onThreadMenuViewportChange,\s*true\)") -and ($sidebarSource -match "addEventListener\('resize',\s*onThreadMenuViewportChange\)") -and ($sidebarSource -match "removeEventListener\('resize',\s*onThreadMenuViewportChange\)")
  Assert-True $viewportListenersAreSymmetric "ported thread menus must close symmetrically when their viewport anchor changes"
  Assert-True ($sidebarSource -notmatch '@mouseleave="onThreadRowLeave') "ported thread menus must remain usable after the pointer leaves their source row"
}

function Assert-CollisionAwareProjectMenuSource {
  $sidebarSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\components\sidebar\SidebarThreadTree.vue")
  $projectMenuTemplate = [regex]::Match($sidebarSource, 'id="sidebar-project-actions-menu"[\s\S]*?</div>\s*</Teleport>')

  Assert-True (([regex]::Matches($sidebarSource, 'class="project-menu-panel"')).Count -eq 1) "project actions must render through one shared menu instead of one overflow-clipped panel per project"
  Assert-True ($projectMenuTemplate.Success -and $projectMenuTemplate.Value -match 'role="menu"' -and ([regex]::Matches($projectMenuTemplate.Value, 'role="menuitem"')).Count -eq 3) "the shared project menu must preserve its accessible action set"
  Assert-True ($sidebarSource -match 'aria-controls="sidebar-project-actions-menu"' -and $sidebarSource -match ':aria-expanded="isProjectMenuOpen\(group\.projectName\)"') "each project trigger must expose the shared menu ownership state"
  Assert-True ($sidebarSource -match "function\s+positionProjectMenu[\s\S]*?shouldPlaceAbove[\s\S]*?viewportHeight[\s\S]*?projectMenuPlacement" -and $sidebarSource -match ':data-side="projectMenuPlacement"') "project menu positioning must flip and clamp against the current viewport"
  Assert-True ($sidebarSource -match "\.project-menu-panel\s*\{[\s\S]*?@apply\s+fixed[\s\S]*?overflow-y-auto" -and $sidebarSource -match "overscroll-behavior:\s*contain") "project menu content must stay fixed and independently scrollable in constrained viewports"
  Assert-True ($sidebarSource -match "projectMenuPanelRef[\s\S]*?isEventInsideOpenProjectMenu" -and $sidebarSource -match "closeProjectMenu\(true\)") "ported project menus must include their panel in outside-interaction checks and restore trigger focus on Escape"
}

function Assert-SidebarProjectScrollAnchorSource {
  $sidebarSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\components\sidebar\SidebarThreadTree.vue")
  $fixtureSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\components\sidebar\SidebarRegressionFixture.vue")

  Assert-True ($sidebarSource -match "function\s+captureProjectScrollAnchor[\s\S]*?visibleTopInGroups[\s\S]*?viewportOffset") "sidebar project reorder must capture the first visible project by stable identity"
  Assert-True ($sidebarSource -match "function\s+findProjectTreeScrollContainer[\s\S]*?overflowY[\s\S]*?scrollHeight") "sidebar scroll anchoring must resolve the actual overflow owner instead of assuming one shell"
  Assert-True ($sidebarSource -match "desiredScrollTop\s*=\s*groupsContentTop\s*\+\s*anchorTop\s*-\s*anchor\.viewportOffset" -and $sidebarSource -match "Math\.min\(desiredScrollTop,\s*maxScrollTop\)") "sidebar project reorder must restore and clamp the captured viewport offset"
  Assert-True ($sidebarSource -match "isProjectLayoutMotionReady\.value\s*=\s*false[\s\S]*?scheduleProjectLayoutMotionRestore\(sequence\)") "background project reordering must not animate the anchored row away from the reader"
  Assert-True ($fixtureSource -match 'data-regression-action="promote-background-project"' -and $fixtureSource -match "scrollAnchorMode") "sidebar fixture must retain the deterministic background-reorder probe"
}

function Assert-HiddenPageQuiescenceSource {
  $desktopStateSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\composables\useDesktopState.ts")
  $conversationSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\components\content\ThreadConversation.vue")
  $taskPetSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\components\mobile\TaskPetPreview.vue")
  $sidebarSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\components\sidebar\SidebarThreadTree.vue")
  $backgroundSyncMatch = [regex]::Match($desktopStateSource, "function\s+scheduleBackgroundSync[\s\S]*?\n\s*function\s+shouldRefreshSelectedMessagesForForegroundRecovery")
  $visibilitySyncMatch = [regex]::Match($desktopStateSource, "function\s+scheduleVisibilitySync[\s\S]*?\n\s*function\s+clearVisibilitySyncTimer")

  Assert-True ($desktopStateSource -match "function\s+stopBackgroundSync[\s\S]*?clearInterval\(backgroundSyncTimer\)[\s\S]*?backgroundSyncTimer\s*=\s*null") "hidden-page recovery must be able to fully disarm the fallback sync interval"
  Assert-True ($backgroundSyncMatch.Success -and $backgroundSyncMatch.Value -match "!isDocumentVisible\(\)" -and $backgroundSyncMatch.Value -match "stopBackgroundSync\(\)") "fallback thread synchronization must not run or remain armed while the page is hidden"
  Assert-True ($visibilitySyncMatch.Success -and $visibilitySyncMatch.Value -match "if\s*\(isDocumentVisible\(\)\)\s*scheduleBackgroundSync\(\)" -and ([regex]::Matches($visibilitySyncMatch.Value, "stopBackgroundSync\(\)")).Count -ge 5) "visibility, page, network, and Android lifecycle boundaries must park and visibly re-arm fallback sync"
  Assert-True ($conversationSource -match "function\s+startCommandElapsedTimer[\s\S]*?document\.hidden\)\s*return" -and $conversationSource -match "function\s+onCommandElapsedVisibilityChange[\s\S]*?stopCommandElapsedTimer\(\)[\s\S]*?startCommandElapsedTimer\(\)") "conversation elapsed-time rendering must pause while hidden and catch up when visible"
  Assert-True ($conversationSource -match "addEventListener\('visibilitychange',\s*onCommandElapsedVisibilityChange\)" -and $conversationSource -match "removeEventListener\('visibilitychange',\s*onCommandElapsedVisibilityChange\)") "conversation visibility-clock ownership must be cleaned up with the component"
  Assert-True ($taskPetSource -match "function\s+startFreshnessTimer[\s\S]*?document\.hidden" -and $taskPetSource -match "function\s+onFreshnessVisibilityChange[\s\S]*?stopFreshnessTimer\(\)[\s\S]*?startFreshnessTimer\(\)" -and $taskPetSource -match "removeEventListener\('visibilitychange',\s*onFreshnessVisibilityChange\)") "task-pet freshness labels must use the same hidden-page timer boundary"
  Assert-True ($sidebarSource -match "function\s+startRelativeTimeRefreshTimer[\s\S]*?refreshRelativeTimeNow\(\)[\s\S]*?document\.hidden" -and $sidebarSource -match "function\s+onRelativeTimeVisibilityChange[\s\S]*?stopRelativeTimeRefreshTimer\(\)[\s\S]*?startRelativeTimeRefreshTimer\(\)") "sidebar relative-time labels must pause while hidden and catch up immediately when visible"
  Assert-True ($sidebarSource -match "Math\.abs\(relativeTimeNowMs\.value\s*-\s*timestamp\)" -and $sidebarSource -match "removeEventListener\('visibilitychange',\s*onRelativeTimeVisibilityChange\)" -and $sidebarSource -match "stopRelativeTimeRefreshTimer\(\)") "sidebar relative-time rendering must use the reactive display clock and clean up its lifecycle owner"
}

function Assert-ReliableClipboardSource {
  $clipboardSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\utils\clipboard.ts")
  $appSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\App.vue")
  $sidebarSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\components\sidebar\SidebarThreadTree.vue")
  $conversationSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\components\content\ThreadConversation.vue")
  $conversationFixtureSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\components\content\ConversationRegressionFixture.vue")
  $remoteAccessSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\components\settings\RemoteAccessCard.vue")

  Assert-True ($clipboardSource -match "clipboardData\.setData\('text/plain',\s*text\)[\s\S]*?stopImmediatePropagation\(\)[\s\S]*?preventDefault\(\)[\s\S]*?addEventListener\('copy',\s*onCopy\)") "clipboard fallback must populate the copy event without moving focus into a temporary textarea"
  Assert-True ($clipboardSource -match "execCommand\('copy'\)\s*===\s*true\s*&&\s*clipboardDataWasSet" -and $clipboardSource -match "finally\s*\{[\s\S]*?removeEventListener\('copy',\s*onCopy\)") "clipboard fallback must verify that data was served and always remove its one-shot listener"
  Assert-True ($clipboardSource -match "clipboard\?\.writeText[\s\S]*?await\s+clipboard\.writeText\(text\)[\s\S]*?catch\s*\(error\)[\s\S]*?copyTextViaCopyEvent\(text,\s*document\)[\s\S]*?throw\s+error") "clipboard API rejection must fall back during the same user action and preserve a real failure"
  Assert-True ($clipboardSource -notmatch "createElement\('textarea'\)") "clipboard fallback must not steal focus or selection through a hidden textarea"
  Assert-True ($appSource -match "import\s*\{\s*copyTextToClipboard\s*\}\s*from\s*'\./utils/clipboard'" -and $appSource -match "await\s+copyTextToClipboard\(record\.text\)") "favorite copying must use the shared reliable clipboard path"
  Assert-True (([regex]::Matches($sidebarSource, "onCopyThreadLink\(openThreadMenuThread\.id\)")).Count -eq 1 -and $sidebarSource -match "'copy-thread-link':\s*\[threadId:\s*string\]") "the shared sidebar thread menu must expose the thread-link copy action"
  Assert-True ($appSource -match '@copy-thread-link="onCopyThreadLink"' -and $appSource -match 'function\s+onCopyThreadLink[\s\S]*?url\.hash\s*=\s*`/thread/\$\{encodeURIComponent\(threadId\)\}`[\s\S]*?copyTextToClipboard\(url\.toString\(\)\)[\s\S]*?已复制会话链接') "thread-link copying must preserve the current site and use the canonical encoded hash route with truthful success feedback"
  Assert-True ($appSource -match "复制失败，请手动复制浏览器地址") "thread-link copy failure must remain visible and actionable"
  Assert-True ($conversationSource -match "import\s*\{\s*copyTextToClipboard\s*\}\s*from\s*'\.\./\.\./utils/clipboard'" -and $conversationSource -match "isMessageCopied\(entry\.message\.id\)\s*\?\s*'已复制'\s*:\s*'复制'" -and $conversationSource -match 'IconTablerCheck\s+v-if="isMessageCopied\(entry\.message\.id\)"') "message copying must use the shared path and expose text plus icon success feedback"
  Assert-True ($conversationSource -match "复制失败，请长按链接手动复制" -and $conversationSource -match "消息复制失败，请手动选择复制" -and $conversationSource -match "代码复制失败，请手动选择复制") "conversation copy failures must remain visible and actionable"
  Assert-True ($conversationFixtureSource -match '@copy-status="copyStatus\s*=\s*\$event"' -and $conversationFixtureSource -match 'class="conversation-regression-copy-status"') "the conversation fixture must expose visible clipboard failure feedback"
  Assert-True ($remoteAccessSource -match "import\s*\{\s*copyTextToClipboard\s*\}\s*from\s*'\.\./\.\./utils/clipboard'" -and $remoteAccessSource -match "await\s+copyTextToClipboard\(url\)") "remote-access address copying must share the HTTP-safe fallback"
}

function Assert-TaskAttentionAndFileQuickOpenSource {
  $appSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\App.vue")
  $menuSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\components\content\CommandMenu.vue")
  $fixtureSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\components\content\CommandMenuRegressionFixture.vue")
  $sidebarSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\components\sidebar\SidebarThreadTree.vue")
  $sidebarFixtureSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\components\sidebar\SidebarRegressionFixture.vue")
  $desktopStateSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\composables\useDesktopState.ts")
  $threadTypesSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\types\codex.ts")
  $setPendingRequestsMatch = [regex]::Match($desktopStateSource, "function\s+setPendingServerRequestsForThread[\s\S]*?\n\s*function\s+")
  $upsertPendingRequestMatch = [regex]::Match($desktopStateSource, "function\s+upsertPendingServerRequest[\s\S]*?\n\s*function\s+")
  $removePendingRequestMatch = [regex]::Match($desktopStateSource, "function\s+removePendingServerRequestById[\s\S]*?\n\s*function\s+")

  Assert-True ($menuSource -match "action\?:\s*'new-thread'\s*\|\s*'search-files'" -and $menuSource -match "title:\s*'搜索文件'") "the command menu must expose workspace file search as a discoverable command"
  Assert-True ($menuSource -match "watch\(\[query,\s*mode,\s*normalizedCwd" -and $menuSource -match "if\s*\(!normalizedQuery\)\s*\{[\s\S]*?recentWorkspaceFiles\.value\.length\s*>\s*0\s*\?\s*1\s*:\s*0[\s\S]*?return\s*\}[\s\S]*?const\s+token") "file quick open must use local recents without scanning the workspace for an empty query"
  Assert-True ($menuSource -match "fileSearchToken" -and $menuSource -match "token\s*!==\s*fileSearchToken") "stale file-search responses must not replace newer quick-open results"
  Assert-True ($menuSource -match "const\s+visibleFileSuggestions[\s\S]*?settledFileQuery[\s\S]*?fileSuggestions\.value\.filter[\s\S]*?normalizeSearchText\(file\.path\)\.includes\(normalizedQuery\)" -and $menuSource -match "fileSearchState\.value\s*===\s*'loading'[\s\S]*?visibleFileSuggestions\.value\.length\s*>\s*0\)\s*return\s+null") "type-ahead file search must locally filter held results and reserve the full loading state for an empty initial result set"
  Assert-True ($menuSource -match "watch\(\[query,\s*mode,\s*normalizedCwd[\s\S]*?invalidateFileSearch\(\)[\s\S]*?const\s+activeFilePath[\s\S]*?retainedFileIndex") "type-ahead file search must invalidate stale requests without clearing visible rows and retain the highlighted file when it survives refresh"
  Assert-True ($menuSource -match "searchComposerFiles\(cwd,\s*normalizedQuery,\s*12\)" -and $menuSource -match "fileSearchState\.value\s*=\s*'error'") "file quick open must reuse the bounded composer search route and expose a recoverable failure state"
  Assert-True ($menuSource -match "RECENT_FILE_STORAGE_KEY\s*=\s*'codex-web-local\.command-menu-recent-files\.v1'" -and $menuSource -match "MAX_RECENT_FILES\s*=\s*36" -and $menuSource -match "MAX_RECENT_FILES_PER_WORKSPACE\s*=\s*6") "recent file history must stay versioned and bounded"
  Assert-True ($menuSource -match "const\s+recentWorkspaceFiles[\s\S]*?normalizeFileLocation\(entry\.cwd\)\s*===\s*cwdKey[\s\S]*?slice\(0,\s*MAX_RECENT_FILES_PER_WORKSPACE\)" -and $menuSource -match "id:\s*normalizedQuery\s*\?\s*'files'\s*:\s*'recent-files'" -and $menuSource -match "label:\s*normalizedQuery\s*\?\s*'文件'\s*:\s*'最近文件'") "empty file mode must show only bounded recents from the current workspace"
  Assert-True ($menuSource -match "function\s+rememberRecentFile[\s\S]*?localStorage\.setItem\(RECENT_FILE_STORAGE_KEY" -and $menuSource -match "if\s*\(item\.file\)\s*rememberRecentFile\(item\.file\.path\)[\s\S]*?emit\('close'\)") "opening a quick-open result must remember it before the menu closes"
  Assert-True ($menuSource -match "function\s+enterFileMode[\s\S]*?nextTick\(\(\)\s*=>\s*inputRef\.value\?\.focus\(\)\)" -and $menuSource -match "function\s+enterRootMode[\s\S]*?nextTick\(\(\)\s*=>\s*inputRef\.value\?\.focus\(\)\)") "mode changes must keep keyboard focus in the command-menu search field"
  Assert-True ($menuSource -match "if\s*\(mode\.value\s*===\s*'files'\)[\s\S]*?enterRootMode\(\)") "Escape must return from file search to commands before closing the menu"
  Assert-True ($menuSource -match 'tabindex="-1"[\s\S]*?@keydown="onPanelKeydown"' -and $menuSource -match "event\.key\s*===\s*'Tab'[\s\S]*?getFocusableElements\(\)[\s\S]*?preventScroll:\s*true" -and $menuSource -match "addEventListener\('focusin',\s*onWindowFocusIn,\s*true\)") "the command-menu dialog must contain keyboard and programmatic focus"
  Assert-True ($menuSource -match "document\.body\.style\.overflow\s*=\s*'hidden'" -and $menuSource -match "function\s+restoreModalEnvironment[\s\S]*?document\.body\.style\.overflow\s*=\s*previousBodyOverflow[\s\S]*?restoreFocus\(\)") "the command-menu dialog must lock background scrolling and restore its opener environment"
  Assert-True ($threadTypesSource -match "waitingForInput\?:\s*boolean" -and $desktopStateSource -match "const\s+waitingForInput\s*=\s*\(pendingServerRequestsByThreadId\.value\[thread\.id\]\s*\?\?\s*\[\]\)\.length\s*>\s*0") "waiting task attention must derive from unresolved server requests without changing the protocol"
  Assert-True ($setPendingRequestsMatch.Success -and $setPendingRequestsMatch.Value -match "applyThreadFlags\(\)" -and $upsertPendingRequestMatch.Success -and $upsertPendingRequestMatch.Value -match "applyThreadFlags\(\)" -and $removePendingRequestMatch.Success -and $removePendingRequestMatch.Value -match "applyThreadFlags\(\)") "every pending-request transition must refresh task attention immediately"
  Assert-True ($sidebarSource -match "thread-status-indicator\[data-state='waiting'\]" -and $sidebarSource -match "getThreadActivityLabel[\s\S]*?等待处理") "the sidebar must expose waiting state as text plus a dedicated indicator without changing recent ordering"
  Assert-True ($menuSource -match "filter\(\(thread\)\s*=>\s*thread\.inProgress\s*\|\|\s*thread\.unread\)[\s\S]*?appendThreadSection\('attention',\s*'需要关注'" -and $menuSource -match "function\s+attentionThreadRank[\s\S]*?thread\.waitingForInput[\s\S]*?return\s+0" -and $menuSource -match "item\.thread\?\.waitingForInput[\s\S]*?等待处理") "the command-menu home must order waiting, running, then unread attention with explicit labels"
  Assert-True ($menuSource -match "if\s*\(normalizedQuery\)[\s\S]*?appendThreadSection\('threads',\s*'任务'" -and $menuSource -match "appendThreadSection\('threads',\s*'最近任务',\s*normalRecentThreads\)") "task search must stay unified while the empty-query home separates attention from normal recent tasks"
  Assert-True ($appSource -match "event\.key\.toLowerCase\(\)\s*===\s*'p'[\s\S]*?openCommandMenu\('files'\)" -and $appSource -match ':mode-request-id="commandMenuModeRequestId"') "Ctrl or Command + P must reopen file search even after an in-menu mode change"
  Assert-True ($appSource -match "function\s+onOpenCommandMenuFile[\s\S]*?codex-local-browse[\s\S]*?isNativeAndroidShell\(\)[\s\S]*?window\.location\.href[\s\S]*?window\.open") "quick-open files must use the existing local preview route and avoid fragile new-window behavior on mobile"
  Assert-True ($fixtureSource -match 'cwd="E:/javaword/CXCodex/codexui"' -and $fixtureSource -match '@open-file="status\s*=\s*`file:\$\{\$event\}`"') "the command-menu fixture must expose file-search activation for browser regression"
  Assert-True ($fixtureSource -match "typeAheadFixture" -and $fixtureSource -match "query\s*===\s*'src'\s*\?\s*initialRows" -and $fixtureSource -match "window\.setTimeout\(resolve,\s*query\s*===\s*'src'\s*\?\s*40\s*:\s*900\)") "the command-menu fixture must provide a deterministic slow follow-up search for type-ahead continuity verification"
  Assert-True ($fixtureSource -match 'data-command-menu-regression-launch' -and $fixtureSource -match "focusOwnershipFixture" -and $fixtureSource -match "const\s+isOpen\s*=\s*ref\(!focusOwnershipFixture\)") "the command-menu fixture must support opener focus-restoration verification"
  Assert-True ($fixtureSource -match 'selected-thread-id="thread-gateway"' -and $fixtureSource -match "id:\s*'thread-active'[\s\S]*?waitingForInput:\s*true" -and $fixtureSource -match "id:\s*'thread-running'[\s\S]*?inProgress:\s*true" -and $fixtureSource -match "id:\s*'thread-review'[\s\S]*?unread:\s*true") "the command-menu fixture must cover waiting, running, unread, selection, and recency priority"
  Assert-True ($sidebarFixtureSource -match "id:\s*'fixture-thread-waiting'[\s\S]*?waitingForInput:\s*true" -and $sidebarFixtureSource -match "id:\s*'fixture-thread-background'[\s\S]*?inProgress:\s*true") "the sidebar fixture must cover explicit waiting and working states under fixed recent ordering"
}

function Assert-MobileLatestReplyRecoverySource {
  $routeSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\server\runtimeStateRoutes.ts")
  $runtimeStateSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\server\runtimeState.ts")
  $middlewareStateSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\server\codexBridgeMiddlewareState.ts")
  $desktopStateSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\composables\useDesktopState.ts")
  $latestReplySource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\utils\latestReply.ts")
  $singleSnapshotMatch = [regex]::Match($routeSource, "url\.pathname\s*===\s*'/codex-api/runtime/snapshot'[\s\S]*?setJson\(res,\s*200")
  $batchSnapshotMatch = [regex]::Match($routeSource, "url\.pathname\s*===\s*'/codex-api/runtime/snapshots'[\s\S]*?return\s+true")
  Assert-True ($singleSnapshotMatch.Success -and $singleSnapshotMatch.Value -match 'readLocalRuntimeSnapshot\(threadId\)') "single runtime snapshots must recover persisted latest replies after a server restart"
  Assert-True ($batchSnapshotMatch.Success -and $batchSnapshotMatch.Value.Contains('threadIds.map((threadId) => dependencies.readLocalRuntimeSnapshot(threadId))')) "Android batch snapshots must recover persisted latest replies instead of reading an empty process-local map"
  Assert-True ($middlewareStateSource -match 'loadPersistedSnapshot:[\s\S]*?runtimeStore\.getSnapshot\(threadId\)\?\.snapshot') "the first post-restart runtime mutation must resume from the persisted reply accumulator"
  Assert-True ($runtimeStateSource -match 'Keep one trailing separator while streaming' -and $runtimeStateSource -match 'normalized\.slice\(normalized\.length\s*-\s*LATEST_REPLY_CACHE_LIMIT\)') "stream chunks must preserve word boundaries and completed long replies must retain their newest tail"
  Assert-True ($runtimeStateSource -match 'latestReplyItemId' -and $runtimeStateSource -match 'itemId\s*&&\s*state\.latestReplyItemId\s*&&\s*itemId\s*!==\s*state\.latestReplyItemId[\s\S]*?appendLatestReply\('''',\s*delta\)') "a new assistant item must replace the previous item on its first delta instead of concatenating both messages"
  Assert-True ($runtimeStateSource -match 'latestReplyEventSeq' -and $runtimeStateSource -match 'latestReply:\s*nextLatestReply[\s\S]*?latestReplyEventSeq:\s*Math\.max\(0,\s*Math\.trunc\(event\.seq\)\)' -and $runtimeStateSource -match 'latestReply:\s*completedReply[\s\S]*?latestReplyEventSeq:\s*Math\.max\(0,\s*Math\.trunc\(event\.seq\)\)') "latest reply text must carry its own event version instead of borrowing the generic task cursor"
  Assert-True ($desktopStateSource -match 'function\s+latestTaskPetReply[\s\S]*?compactLatestReplyTail\(value,\s*260\)' -and $latestReplySource -match 'normalized\.slice\(normalized\.length\s*-\s*limit\)') "the renderer-to-native task-pet snapshot must carry the newest reply tail instead of a frozen prefix"
  Assert-True ($desktopStateSource -match 'runtimeReplyMatchesActiveTurn[\s\S]*?runtimeLatestReply[\s\S]*?latestReplyEventSeq:\s*runtimeLatestReply\s*\?\s*runtimeSummary\?\.latestReplyEventSeq\s*\?\?\s*0\s*:\s*0') "frontend fallback replies must remain unversioned and prior-turn Runtime replies must not be paired with a new activity"
}

function Assert-BoundedRuntimeSendRecoverySource {
  $sourcePath = Join-Path (Get-Location) "src\composables\useDesktopState.ts"
  $source = Get-Content -Raw -Encoding UTF8 -LiteralPath $sourcePath
  $appSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\App.vue")
  $serverSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\server\appServerRuntimeStart.ts")
  $runtimeActionSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\server\runtimeActionRoutes.ts")
  $runtimeStoreSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\server\runtimeStore.ts")
  $runtimeQueueClientSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\api\runtimeMessageQueue.ts")
  $runtimeQueueServerSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\server\runtimeMessageQueue.ts")
  $codexBridgeSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\server\codexAppServerBridge.ts")
  $codexBridgeDisposeSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\server\codexBridgeMiddlewareDispose.ts")
  $androidTaskPetSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "android\app\src\main\java\com\cxcodex\bridge\TaskPetOverlayService.java")
  $androidTaskPetPolicySource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "android\app\src\main\java\com\cxcodex\bridge\TaskPetRuntimePolicy.java")
  $androidTaskNotificationPolicySource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "android\app\src\main\java\com\cxcodex\bridge\TaskNotificationPolicy.java")
  $androidTaskNotificationActionSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "android\app\src\main\java\com\cxcodex\bridge\TaskNotificationActionActivity.java")
  $androidNoProgressReviewSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "android\app\src\main\java\com\cxcodex\bridge\TaskPetNoProgressReviewReceiver.java")
  $androidPushServiceSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "android\app\src\main\java\com\cxcodex\bridge\TaskPetFirebaseMessagingService.java")
  $androidPushRegistrationSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "android\app\src\main\java\com\cxcodex\bridge\MobilePushRegistration.java")
  $androidMainActivitySource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "android\app\src\main\java\com\cxcodex\bridge\MainActivity.java")
  $androidResumeRecoveryPolicySource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "android\app\src\main\java\com\cxcodex\bridge\WebViewResumeRecoveryPolicy.java")
  $androidPluginSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "android\app\src\main\java\com\cxcodex\bridge\MobileShellPlugin.java")
  $androidConfigSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "android\app\src\main\java\com\cxcodex\bridge\MobileShellConfig.java")
  $androidManifestSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "android\app\src\main\AndroidManifest.xml")
  $androidBackgroundVerifierSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "scripts\verify-android-background.ps1")
  $mobilePushReadinessSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "scripts\verify-mobile-push-readiness.mjs")
  $mobilePushReadinessTestSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "scripts\verify-mobile-push-readiness.test.mjs")
  $serverMobilePushSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\server\mobilePush.ts")
  $serverMobilePushRoutesSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\server\mobilePushRoutes.ts")
  $chatFeedbackSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\composables\chatFeedbackMetrics.ts")
  $diagnosticsPanelSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\components\content\DiagnosticsPanel.vue")
  $taskPetPreviewSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\components\mobile\TaskPetPreview.vue")
  $sidebarThreadTreeSource = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Get-Location) "src\components\sidebar\SidebarThreadTree.vue")
  Assert-True ($androidTaskNotificationPolicySource -match 'waiting_permission[\s\S]*?return\s+"等待"' -and $androidTaskNotificationPolicySource -match 'start_uncertain[\s\S]*?sync_degraded[\s\S]*?return\s+"同步"' -and $androidTaskNotificationPolicySource -match 'completed[\s\S]*?return\s+"完成"' -and $androidTaskNotificationPolicySource -match 'failed[\s\S]*?return\s+"失败"' -and $androidTaskNotificationPolicySource -match 'interrupted[\s\S]*?return\s+"停止"') "smartwatch notification states must stay truthful and two characters"
  Assert-True ($androidTaskPetSource -match 'setContentTitle\(status\)[\s\S]*?setContentText\(task\.title\)[\s\S]*?setPublicVersion' -and $androidTaskPetSource -match '"回复"[\s\S]*?MODE_REPLY[\s\S]*?"详情"' -and $androidTaskPetSource -match '"停止"[\s\S]*?MODE_STOP') "smartwatch notifications must contain only status and title with separate reply, stop, and detail actions"
  Assert-True ($androidManifestSource -match 'TaskNotificationActionActivity[\s\S]*?android:exported="false"') "the native notification action surface must not be externally launchable"
  $voiceResultMatch = [regex]::Match($androidTaskNotificationActionSource, 'protected\s+void\s+onActivityResult[\s\S]*?\n\s*private\s+void\s+focusManualInput')
  Assert-True ($voiceResultMatch.Success -and $voiceResultMatch.Value -match 'manualInput\.setText' -and $voiceResultMatch.Value -notmatch '\bsubmit\(') "voice recognition must fill a confirmable draft and never auto-send"
  Assert-True ($androidTaskNotificationPolicySource -match '只报告问题、风险和遗漏，不要修改' -and $androidTaskNotificationPolicySource -match '给出下一步计划，不要执行') "review and plan presets must remain read-only"
  Assert-True ($source -match "function\s+classifyThreadLoadFailure[\s\S]*?failed to fetch[\s\S]*?页面会自动重试") "thread history transport failures must map to actionable Chinese recovery copy"
  Assert-True ($source -match "const\s+failure\s*=\s*classifyThreadLoadFailure\(error\)[\s\S]*?setThreadLoadError\(threadId,\s*failure\.message\)[\s\S]*?scheduleNonFreshThreadDetailRetry\(threadId\)") "recoverable thread history failures must retain per-thread error state and schedule bounded retries"
  Assert-True ($appSource -match ':load-error=\"selectedThreadLoadError\"' -and $appSource -match '@open-connection-settings=\"onOpenThreadConnectionSettings\"') "the conversation surface must expose thread recovery and mobile address repair"
  Assert-True ($source -match "const\s+RUNTIME_SEND_RETRY_DELAYS_MS\s*=\s*\[700,\s*2000,\s*5000,\s*10000\]") "runtime send retries must use the bounded mobile weak-network schedule"
  Assert-True ($androidMainActivitySource -match "onRenderProcessGone[\s\S]*?resolveAppRetryUrl[\s\S]*?recreateActivityAfterRendererLoss" -and $androidMainActivitySource -match "recreateActivityAfterRendererLoss[\s\S]*?EXTRA_RENDERER_RECOVERY_URL[\s\S]*?recreate\(\)" -and $androidMainActivitySource -match "onRenderProcessUnresponsive[\s\S]*?renderer\.terminate") "Android must recover visibly on the exact route when the WebView renderer hangs or is reclaimed"
  $rendererPriorityMatch = [regex]::Match($androidMainActivitySource, "setRendererPriorityPolicy\(\s*WebView\.RENDERER_PRIORITY_IMPORTANT\s*,\s*(true|false)\s*\)")
  Assert-True (-not $rendererPriorityMatch.Success -or $rendererPriorityMatch.Groups[1].Value -eq "false") "Android must not waive renderer priority when the app becomes invisible"
  Assert-True ($androidMainActivitySource -match "@TargetApi\(Build\.VERSION_CODES\.O\)[\s\S]*?onRenderProcessGone") "Android renderer-crash inspection must retain its API 26 boundary while minSdk remains 24"
  Assert-True ($androidMainActivitySource -match "detail\.didCrash\(\)[\s\S]*?shouldRestoreExactRoute\(rendererCrashed\)[\s\S]*?restoreExactRoute[\s\S]*?resolveAppRetryUrl" -and $androidResumeRecoveryPolicySource -match "shouldRestoreExactRoute\(boolean\s+rendererCrashed\)[\s\S]*?return\s+!rendererCrashed") "a renderer crash must fall back to the app root instead of reopening a route that may crash repeatedly"
  Assert-True ($androidMainActivitySource -match "probeWebViewAfterResume[\s\S]*?evaluateJavascript[\s\S]*?recoverWebViewAfterResume" -and $androidResumeRecoveryPolicySource -match "beginProbe[\s\S]*?markResponsive[\s\S]*?shouldRecover") "Android resume probes must isolate stale callbacks and reload only an unanswered current probe"
  $functionMatch = [regex]::Match($source, "async\s+function\s+startRuntimeTurnWithBoundedRecovery[\s\S]*?\n\s*function\s+hydrateCachedMessagesForThread")
  Assert-True ($functionMatch.Success) "could not find startRuntimeTurnWithBoundedRecovery source"
  $functionSource = $functionMatch.Value
  Assert-True ($functionSource -match "runWithBoundedRecovery\(\{") "production runtime sends must use the tested bounded recovery coordinator"
  Assert-True ($functionSource -match "getRuntimeRequestByClientMessageId\(args\.clientMessageId\)") "transport failures must reconcile the same client message id before retrying"
  Assert-True ($functionSource -match "markOptimisticUserMessageRetrying") "bounded recovery must publish visible retry progress"
  $existingThreadSendMatch = [regex]::Match($source, "async\s+function\s+sendMessageToSelectedThread[\s\S]*?\n\s*async\s+function\s+sendMessageToNewThread")
  Assert-True ($existingThreadSendMatch.Success) "could not find existing-thread send source"
  $immediateSendMatch = [regex]::Match($existingThreadSendMatch.Value, "const\s+reusedOptimisticMessageId[\s\S]*$")
  Assert-True ($immediateSendMatch.Success) "could not find existing-thread immediate-send path"
  Assert-True ($immediateSendMatch.Value -notmatch "runSendPreflightWithBoundedRecovery|await\s+recoverThreadExecutionState") "an active-thread send must reach durable runtime/send without a separate snapshot preflight"
  Assert-True ($immediateSendMatch.Value -match "const\s+isInProgress\s*=\s*wasThreadInProgressBeforeSubmit") "send failure cleanup must preserve the activity that existed at submit time without delaying dispatch"
  $startTurnMatch = [regex]::Match($source, "async\s+function\s+startTurnForThread[\s\S]*?\n\s*async\s+function\s+processQueuedMessages")
  Assert-True ($startTurnMatch.Success) "could not find startTurnForThread source"
  Assert-True ($startTurnMatch.Value -notmatch "ensureThreadResumed") "durable runtime/send must not be blocked by a frontend thread-resume preflight"
  Assert-True ($serverSource -match "startRuntimeTurnRpcWithResume[\s\S]*?thread/resume[\s\S]*?turn/start") "the durable runtime endpoint must resume a missing thread once before retrying turn/start"
  Assert-True ($source -match "const\s+runtimeStateBeforeSubmit\s*=\s*runtimeExecutionStateByThreadId\.value\[threadId\]") "send failure cleanup must capture the authoritative runtime state before optimistic feedback"
  Assert-True ($source -match "const\s+isInProgress\s*=\s*wasThreadInProgressBeforeSubmit") "an active-thread send must preserve its prior activity without a pre-dispatch network read"
  Assert-True ($source -match "markOptimisticUserMessageFailed\(threadId,\s*optimisticMessageId,\s*failedMessageRequest\)[\s\S]*?setTurnErrorForThread\(threadId,\s*null\)") "local send failure must stay on the message bubble instead of creating a false turn-error overlay"
  $manualRetryMatch = [regex]::Match($source, "async\s+function\s+retryFailedUserMessage[\s\S]*?\n\s*function\s+restoreFailedMessageOutboxEntry")
  Assert-True ($manualRetryMatch.Success) "could not find failed-message retry source"
  Assert-True ($manualRetryMatch.Value -notmatch "removeOptimisticUserMessage") "manual retry must update the failed bubble in place instead of replacing it"
  Assert-True ($manualRetryMatch.Value -match "reuseOptimisticMessageId:\s*messageId") "manual retry must pass the original optimistic message id into the send path"
  Assert-True ($manualRetryMatch.Value -match "targetThreadId:\s*request\.threadId") "manual retry must target the failed message thread instead of depending on transient global selection"
  Assert-True ($manualRetryMatch.Value -notmatch "selectedThreadId\.value\s*!==\s*request\.threadId") "manual retry must not silently stop during route-selection convergence"
  Assert-True ($manualRetryMatch.Value -match "durableEntry\?\.state\s*===\s*'failed'\s*\?\s*failedUserMessageRequestFromOutbox") "manual retry must recover its request from the durable outbox when volatile state was lost"
  Assert-True ($source -match "messageId:\s*reusedOptimisticMessageId\s*\|\|\s*undefined[\s\S]*?deliveryState:\s*'sending'") "the send path must reset a reused failed bubble to sending"
  Assert-True ($source -match "function\s+restoreFailedMessageOutboxEntry[\s\S]*?findOptimisticMessageIdForOutbox\(entry\.clientMessageId,\s*normalizedThreadId\)\s*\|\|\s*addOptimisticUserMessage") "failed outbox recovery must reuse the current optimistic bubble before creating one after reload"
  Assert-True ($appSource -match "function\s+onSubmitThreadMessage[\s\S]*?const\s+feedbackStartedAtMs\s*=\s*isHomeRoute\.value\s*\|\|\s*payload\.mode\s*===\s*'steer'\s*\?\s*chatFeedbackNow\(\)") "message feedback timing must start at the composer submit handler"
  Assert-True ($source -match "const\s+feedbackStartedAtMs\s*=\s*internalOptions\.feedbackStartedAtMs\s*\?\?\s*chatFeedbackNow\(\)") "non-composer sends must retain a local feedback timing fallback"
  Assert-True ($source -match "beginChatFeedbackMetric\(\{[\s\S]*?clientMessageId,[\s\S]*?optimisticMessageId,[\s\S]*?submitStartedAtMs:\s*feedbackStartedAtMs") "message feedback timing must bind the send id to its optimistic bubble"
  Assert-True ($chatFeedbackSource -match "CHAT_FEEDBACK_METRIC_STORAGE_KEY\s*=\s*'codex-web-local\.chat-feedback-metrics\.v1'") "mobile feedback metrics must use a versioned durable storage key"
  Assert-True ($chatFeedbackSource -match "CHAT_FEEDBACK_METRIC_LIMIT\s*=\s*50" -and $chatFeedbackSource -match "CHAT_FEEDBACK_METRIC_TTL_MS\s*=\s*7\s*\*\s*24") "mobile feedback review must remain bounded to fifty samples and seven days"
  Assert-True ($chatFeedbackSource -match "performance\.timeOrigin[\s\S]*?performance\.now\(\)") "mobile feedback timestamps must remain comparable across a WebView reload"
  Assert-True ($chatFeedbackSource -match "p50Ms[\s\S]*?p95Ms[\s\S]*?assistantRenderOverhead") "mobile feedback review must expose P50/P95 stage and render-overhead summaries"
  Assert-True ($chatFeedbackSource -notmatch "\b(prompt|attachments|messageText)\b") "mobile feedback diagnostics must not retain prompt or attachment content"
  Assert-True ($diagnosticsPanelSource -match "MESSAGE_FEEDBACK_MIN_SAMPLE_COUNT\s*=\s*5") "mobile feedback review must not classify a trend before five stage samples"
  Assert-True ($diagnosticsPanelSource -match "stateCommit[\s\S]*?bubbleVisible[\s\S]*?requestDispatched[\s\S]*?serverAcknowledged[\s\S]*?firstAssistantData[\s\S]*?assistantRenderOverhead") "diagnostics must keep the complete local-to-visible response review path"
  Assert-True ($diagnosticsPanelSource -match "消息响应复盘[\s\S]*?P50[\s\S]*?P95[\s\S]*?复盘线") "diagnostics must expose the mobile response review in a user-visible compact surface"
  Assert-True ($source -match "pendingNewThreadPreview\.value\s*=\s*\{[\s\S]*?message:\s*\{[\s\S]*?id:\s*optimisticMessageId") "new-thread sends must publish an immediate in-memory conversation preview"
  Assert-True ($source -match "addOptimisticUserMessage\(threadId,[\s\S]*?messageId:\s*optimisticMessageId") "the real thread must adopt the provisional bubble id instead of creating a duplicate"
  $newThreadSendMatch = [regex]::Match($source, "function\s+sendMessageToNewThread[\s\S]*?\n\s*function\s+clearPendingNewThreadPreview")
  Assert-True ($newThreadSendMatch.Success) "could not find new-thread send source"
  Assert-True ($newThreadSendMatch.Value -match "if\s*\(newThreadSendInFlight\)\s*return\s+newThreadSendInFlight[\s\S]*?Promise\.resolve\(\)\.then\(\(\)\s*=>\s*sendMessageToNewThreadOnce[\s\S]*?newThreadSendInFlight\s*=\s*request") "new-thread delivery must claim a single-flight promise before creating a client message id"
  Assert-True ($appSource -match "if\s*\(newThreadSubmitInFlight\s*\|\|\s*isSendingMessage\.value\s*\|\|\s*pendingNewThreadPreview\.value\)\s*return[\s\S]*?submitFirstMessageForNewThread") "the home composer must synchronously reject duplicate new-thread submit events"
  Assert-True ($appSource -match "if\s*\(newThreadSubmitInFlight\)\s*return\s+newThreadSubmitInFlight[\s\S]*?Promise\.resolve\(\)\.then\(\(\)\s*=>\s*submitFirstMessageForNewThreadOnce[\s\S]*?newThreadSubmitInFlight\s*=\s*request") "worktree setup and new-thread routing must share one submit promise"
  Assert-True ($newThreadSendMatch.Value -notmatch "\bstartThread\(") "new-thread delivery must enter durable runtime/send before any fallible thread/start preflight"
  Assert-True ($newThreadSendMatch.Value -match "putMessageOutboxEntry[\s\S]*?startRuntimeTurnWithBoundedRecovery") "new-thread delivery must persist the outbox before dispatching durable runtime/send"
  Assert-True ($newThreadSendMatch.Value -match "putMessageOutboxEntry[\s\S]*?notifyPendingRequestCreated\(internalOptions\.onPendingRequestCreated,\s*clientMessageId\)[\s\S]*?startRuntimeTurnWithBoundedRecovery") "new-thread delivery must register its stable client id with the native monitor before runtime/send can be suspended"
  Assert-True ($appSource -match "onPendingRequestCreated:[\s\S]*?syncMobileShellTaskPet\(true\)") "the Android shell must force provisional task sync at submit time"
  Assert-True ($source -match "function\s+latestTaskPetClientMessageId[\s\S]*?outboxClientIdByOptimisticMessageId[\s\S]*?clientMessageId:\s*clientMessageId\s*\|\|\s*undefined") "existing-thread task handoff must carry the current durable client message id"
  Assert-True ($existingThreadSendMatch.Value -match "beginChatFeedbackMetric\([\s\S]*?notifyPendingRequestCreated\(internalOptions\.onPendingRequestCreated,\s*clientMessageId\)[\s\S]*?const\s+isInProgress\s*=\s*wasThreadInProgressBeforeSubmit[\s\S]*?startTurnForThread") "existing-thread native handoff must happen before immediate durable runtime dispatch"
  Assert-True ($appSource -match "onDeliveryPersisted:[\s\S]*?onPendingRequestCreated:[\s\S]*?syncMobileShellTaskPet\(true\)[\s\S]*?onRequestDispatched:") "existing-thread sends must force native monitoring without delaying runtime dispatch"
  Assert-True ($appSource -match '@quote="onQuoteQueuedMessage"') "queued-message immediate execution must use the Android-aware submit wrapper"
  Assert-True ($source -match "async\s+function\s+quoteQueuedMessage\([\s\S]*?internalOptions[\s\S]*?sendMessageToSelectedThread\([\s\S]*?internalOptions") "queued-message immediate execution must forward submit timing and native handoff callbacks"
  $quoteQueuedMessageMatch = [regex]::Match($source, "async\s+function\s+quoteQueuedMessage[\s\S]*?\n\s*return\s+\{")
  Assert-True ($quoteQueuedMessageMatch.Success) "could not find queued-message immediate execution source"
  Assert-True ($quoteQueuedMessageMatch.Value -match "if\s*\(!msg\s*\|\|\s*isUpdatingSpeedMode\.value\)\s*return[\s\S]*?removeQueuedMessageByThreadId") "queued-message ownership transfer must not remove the row when speed-mode switching would reject the send"
  Assert-True ($quoteQueuedMessageMatch.Value -match "removeQueuedMessageByThreadId\(threadId,\s*messageId\)[\s\S]*?await\s+sendMessageToSelectedThread") "queued-message immediate execution must transfer ownership to the durable outbox before the network await"
  Assert-True ($quoteQueuedMessageMatch.Value -notmatch "Keep the queued message") "a failed immediate execution must not retain a second queue owner beside its recovery bubble"
  Assert-True ($appSource -match "function\s+onQuoteQueuedMessage\([\s\S]*?feedbackStartedAtMs:\s*chatFeedbackNow\(\)[\s\S]*?onPendingRequestCreated:[\s\S]*?syncMobileShellTaskPet\(true\)[\s\S]*?onRequestDispatched:[\s\S]*?ensureMobileShellTaskNotificationPermission\(\)") "queued-message immediate execution must hand native monitoring ownership over before requesting notification permission"
  Assert-True ($source -match "export\s+function\s+useDesktopState\(submitCallbacks") "all internal send entry points must share one submit-time native handoff contract"
  Assert-True ($source -match "function\s+notifyPendingRequestCreated[\s\S]*?override\s*\?\?\s*submitCallbacks\.onPendingRequestCreated[\s\S]*?function\s+requestDispatchedCallback[\s\S]*?override\s*\?\?\s*submitCallbacks\.onRequestDispatched") "internal retries and rollback resend must inherit the App-level native handoff callbacks when they do not supply an override"
  Assert-True ($appSource -match "useDesktopState\(\{[\s\S]*?onDeliveryPersisted:[\s\S]*?ensureMobileShellTaskNotificationPermission\(\)[\s\S]*?onPendingRequestCreated:[\s\S]*?syncMobileShellTaskPet\(true\)[\s\S]*?onRequestDispatched:[\s\S]*?ensureMobileShellTaskNotificationPermission\(\)") "the App must install native monitoring callbacks for retries, rollback resend, and automatic queue execution"
  $processQueuedMessagesMatch = [regex]::Match($source, "async\s+function\s+processQueuedMessages[\s\S]*?\n\s*async\s+function\s+interruptSelectedThreadTurn")
  Assert-True ($processQueuedMessagesMatch.Success) "could not find automatic queued-message execution source"
  Assert-True ($processQueuedMessagesMatch.Value -match "api\.persistRuntimeQueuedMessages\(threadId,\s*queue\)[\s\S]*?syncRuntimeMessageQueue\(threadId\)") "browser queue processing must hand local rows to the durable 7420 queue instead of owning turn execution"
  Assert-True ($runtimeQueueClientSource -match "persistRuntimeQueuedMessages[\s\S]*?clientMessageId:\s*message\.clientMessageId") "durable queue handoff must preserve the stable idempotency key"
  Assert-True ($source -match "function\s+promoteQueuedMessageToOptimistic[\s\S]*?createMessageOutboxEntry[\s\S]*?clientMessageId:\s*queued\.clientMessageId") "a server-started queue row must transfer its stable id to the durable optimistic outbox"
  Assert-True ($runtimeQueueServerSource -match "setInterval\(\(\)\s*=>\s*this\.scheduleAll\(\),\s*QUEUE_SWEEP_INTERVAL_MS\)" -and $runtimeQueueServerSource -match "listQueuedThreadIds[\s\S]*?processThread") "7420 must advance queued messages independently of the selected conversation and Android renderer lifecycle"
  Assert-True ($appSource -match "const\s+ownsSyncSlot\s*=\s*!mobileShellTaskPetSyncInFlight[\s\S]*?if\s*\(!ownsSyncSlot\s*&&\s*!force\)") "an immediate send handoff must bypass an older renderer sync already awaiting its bridge response"
  Assert-True ($source -match "setQueuedMessagesForThread\(threadId,\s*nextQueue\)[\s\S]*?notifyDeliveryPersisted\(internalOptions\.onDeliveryPersisted\)[\s\S]*?await\s+processQueuedMessages\(threadId\)") "queued delivery must be persisted locally before its immediate durable 7420 handoff"
  Assert-True ($functionMatch.Value -match "const\s+runtimeRequest\s*=\s*startRuntimeThreadTurn\(args\)[\s\S]*?onRequestDispatched\?\.\(\)[\s\S]*?await\s+runtimeRequest") "contextual permission work must begin only after runtime/send has been dispatched"
  Assert-True ($appSource -match "onDeliveryPersisted:[\s\S]*?ensureMobileShellTaskNotificationPermission[\s\S]*?onRequestDispatched:[\s\S]*?ensureMobileShellTaskNotificationPermission") "existing-thread queue and immediate sends must use their respective durable or dispatched permission boundaries"
  Assert-True ($appSource -match "onPendingRequestCreated:[\s\S]*?syncMobileShellTaskPet\(true\)[\s\S]*?onRequestDispatched:[\s\S]*?ensureMobileShellTaskNotificationPermission") "new-thread sends must register provisional native tracking before requesting permission after runtime/send dispatch"
  Assert-True ($androidPluginSource -match '@Permission\(alias\s*=\s*"notifications",\s*strings\s*=\s*\{\s*Manifest\.permission\.POST_NOTIFICATIONS\s*\}\)') "Android notification permission must use a Capacitor permission alias"
  Assert-True ($androidPluginSource -match 'requestPermissionForAlias\("notifications",\s*call,\s*"notificationPermissionAfterRequest"\)[\s\S]*?@PermissionCallback[\s\S]*?notificationPermissionAfterRequest[\s\S]*?buildNotificationPermissionResult\(true\)') "the native permission Promise must resolve from the Android result callback"
  Assert-True ($androidConfigSource -match 'PREF_NOTIFICATION_AUTO_REQUESTED') "the one-time contextual notification prompt marker must live in native app storage"
  Assert-True ($androidPluginSource -match 'getBoolean\(MobileShellConfig\.PREF_NOTIFICATION_AUTO_REQUESTED,\s*false\)[\s\S]*?putBoolean\(MobileShellConfig\.PREF_NOTIFICATION_AUTO_REQUESTED,\s*true\)') "automatic notification permission requests must be attempted only once per app install"
  Assert-True ($androidPluginSource -match 'permissionState\s*!=\s*PermissionState\.DENIED[\s\S]*?openTaskNotificationSettings\(\)') "manual recovery must open Android settings after a permanent denial, system-level disable, or completion-channel block"
  Assert-True ($androidPluginSource -match 'ACTION_APP_NOTIFICATION_SETTINGS[\s\S]*?EXTRA_APP_PACKAGE') "manual notification recovery must target this app's notification settings"
  Assert-True ($androidPluginSource -match 'completionChannelEnabled[\s\S]*?isCompletionNotificationChannelEnabled') "the Android bridge must report the task-completion channel separately from app-level permission"
  Assert-True ($androidTaskPetSource -match 'getNotificationChannel\(COMPLETION_CHANNEL_ID\)[\s\S]*?IMPORTANCE_NONE') "native completion delivery must detect a user-blocked Android channel"
  Assert-True ($androidPluginSource -match 'ACTION_CHANNEL_NOTIFICATION_SETTINGS[\s\S]*?EXTRA_CHANNEL_ID[\s\S]*?COMPLETION_CHANNEL_ID') "manual recovery must target the exact disabled task-completion channel"
  Assert-True ($appSource -match '任务完成通道已关闭[\s\S]*?completionChannelEnabled\s*===\s*false') "mobile settings must expose and make a disabled completion channel recoverable"
  Assert-True ($appSource -match 'function\s+onWindowFocusRefreshAccountState[\s\S]*?refreshMobileShellNotificationPermission\(\)') "returning from Android notification settings must refresh the visible permission state"
  Assert-True ($androidManifestSource -match 'android\.permission\.WAKE_LOCK') "screen-off task monitoring must declare the Android wake-lock permission"
  Assert-True ($androidManifestSource -match 'android:foregroundServiceType="specialUse"[\s\S]*?PROPERTY_SPECIAL_USE_FGS_SUBTYPE[\s\S]*?user-initiated AI task progress monitoring') "long-running task monitoring must use an accurately described special-use foreground service"
  Assert-True ($androidManifestSource -match 'TaskPetOverlayService[\s\S]*?android:stopWithTask="false"') "removing the Android recent task must not stop the native task monitor"
  Assert-True ($androidManifestSource -notmatch 'android:foregroundServiceType="dataSync"') "task monitoring must not regress onto the Android 15 six-hour data-sync foreground-service quota"
  Assert-True ($androidManifestSource -match 'TaskPetFirebaseMessagingService[\s\S]*?com\.google\.firebase\.MESSAGING_EVENT') "Android deep-Doze wake must register the Firebase messaging service"
  $mainActivityCreateMatch = [regex]::Match($androidMainActivitySource, 'protected\s+void\s+onCreate[\s\S]*?\n\s*@Override\s*\n\s*protected\s+void\s+onNewIntent')
  Assert-True ($mainActivityCreateMatch.Success -and $mainActivityCreateMatch.Value -match 'captureTaskPetThreadFromIntent\(getIntent\(\)\)[\s\S]*?if\s*\(MobileShellConfig\.getStoredServerUrl\(this\)\.isEmpty\(\)\)') "a cold notification launch must persist its exact thread before an unconfigured server setup can replace the Activity intent"
  $captureTaskPetThreadMatch = [regex]::Match($androidMainActivitySource, 'private\s+void\s+captureTaskPetThreadFromIntent[\s\S]*?\n\s*private\s+void\s+openPendingTaskPetThread')
  Assert-True ($captureTaskPetThreadMatch.Success -and $captureTaskPetThreadMatch.Value -match 'putString\(MobileShellConfig\.PREF_TASK_PET_PENDING_OPEN_THREAD_ID[\s\S]*?\.commit\(\)[\s\S]*?if\s*\(saved\)\s*intent\.removeExtra') "notification navigation must be committed before its one-shot intent extra is consumed"
  $openPendingTaskPetThreadMatch = [regex]::Match($androidMainActivitySource, 'private\s+void\s+openPendingTaskPetThread[\s\S]*?\n\s*private\s+void\s+configureWebViewDownloadListener')
  Assert-True (
    $openPendingTaskPetThreadMatch.Success -and
    ($openPendingTaskPetThreadMatch.Value -match 'getString\(MobileShellConfig\.PREF_TASK_PET_PENDING_OPEN_THREAD_ID[\s\S]*?buildAppHashUrl[\s\S]*?webView\.loadUrl\(targetUrl\)') -and
    ([regex]::Matches($openPendingTaskPetThreadMatch.Value, 'MobileShellConfig\.shouldLoadPendingAppRoute').Count -ge 2) -and
    ($openPendingTaskPetThreadMatch.Value -notmatch 'remove\(MobileShellConfig\.PREF_TASK_PET_PENDING_OPEN_THREAD_ID')
  ) "WebView dispatch must dedupe an already-visible exact-thread route while retaining pending navigation until the rendered route acknowledges it"
  $markTaskPetThreadReadMatch = [regex]::Match($androidPluginSource, 'public\s+void\s+markTaskPetThreadRead[\s\S]*?\n\s*private\s+JSObject\s+buildTaskPetStatus')
  Assert-True ($markTaskPetThreadReadMatch.Success -and $markTaskPetThreadReadMatch.Value -match 'shouldAcknowledgePendingTaskPetThreadOpen[\s\S]*?remove\(MobileShellConfig\.PREF_TASK_PET_PENDING_OPEN_THREAD_ID\)[\s\S]*?\.commit\(\)') "only the exact thread confirmed visible by the WebView may clear pending notification navigation"
  $visibleThreadAcknowledgementMatch = [regex]::Match($appSource, 'watch\(\s*\(\)\s*=>\s*\[\s*routeThreadId\.value,[\s\S]*?markMobileShellTaskPetThreadRead\(normalizedRouteId\)')
  Assert-True ($visibleThreadAcknowledgementMatch.Success -and $visibleThreadAcknowledgementMatch.Value -match 'displayedThreadMessages\.value\.length' -and $visibleThreadAcknowledgementMatch.Value -match 'isThreadContentSwitching\.value' -and $visibleThreadAcknowledgementMatch.Value -match 'shouldAcknowledgeMobileShellTaskPetThreadOpen\(viewState\)[\s\S]*?acknowledgeMobileShellTaskPetThreadOpen\(normalizedRouteId\)[\s\S]*?shouldMarkMobileShellTaskPetThreadRead\(\{\s*\.\.\.viewState,\s*inProgress\s*\}\)[\s\S]*?markMobileShellTaskPetThreadRead\(normalizedRouteId\)') "visible thread content must acknowledge navigation before terminal read cleanup, while empty or switching routes remain unacknowledged"
  $nativeReadCleanupMatch = [regex]::Match($androidTaskPetSource, 'private\s+void\s+clearCompletedThread[\s\S]*?\n\s*private\s+int\s+expandedPanelOffset')
  Assert-True ($nativeReadCleanupMatch.Success -and $nativeReadCleanupMatch.Value -match 'isActiveTaskState\(task\.state\)[\s\S]*?task\.readAcknowledged\s*=\s*true[\s\S]*?persistTasksSynchronously\(\)' -and $androidTaskPetSource -match 'put\("readAcknowledged",\s*task\.readAcknowledged\)' -and $androidTaskPetSource -match 'sameGeneration[\s\S]*?previous\.readAcknowledged') "a visible-thread read acknowledgement must survive the short frontend/native terminal race for the same task generation"
  Assert-True ($androidTaskPetPolicySource -match 'shouldRetainUnreadSettledTask[\s\S]*?return\s+!readAcknowledged' -and $androidTaskPetSource -match 'shouldRetainUnreadSettledTask\([\s\S]*?task\.readAcknowledged[\s\S]*?if\s*\(retainUnreadCompletion\)[\s\S]*?notifyTaskSettled[\s\S]*?else\s*\{[\s\S]*?tasksToRemove\.add\(task\)[\s\S]*?suppressed_read') "only unread terminal tasks may remain in the pet and post a completion notification"
  Assert-True ($androidPushServiceSource -match 'getPriority\(\)\s*==\s*RemoteMessage\.PRIORITY_HIGH[\s\S]*?isTrackedActiveThread[\s\S]*?shouldWakeForMobilePush') "FCM may cold-wake the monitor only for a delivered high-priority push that matches a tracked task"
  Assert-True ($androidPushServiceSource -match 'claimPushEvent\(this,\s*threadId,\s*eventSeq\)' -and $androidPushRegistrationSource -match 'PREF_MOBILE_PUSH_EVENT_SEQS_JSON[\s\S]*?sha256\(normalizedThreadId\)[\s\S]*?readActiveThreadIds') "FCM dedupe must remain per-thread so one completed task cannot suppress another task's older terminal event"
  Assert-True ($androidPushServiceSource -match 'isPushEventClaimed\(this,\s*threadId,\s*eventSeq\)[\s\S]*?wakeFromMobilePush\(this,\s*threadId,\s*eventSeq,\s*highPriority\)[\s\S]*?if\s*\(!started\)[\s\S]*?"wake_failed"[\s\S]*?return;[\s\S]*?claimPushEvent\(this,\s*threadId,\s*eventSeq\)') "FCM event dedupe must commit only after the native foreground monitor starts successfully"
  Assert-True ($androidPushServiceSource -match 'hasPendingPushAcknowledgement[\s\S]*?retryPendingAcknowledgementAsync[\s\S]*?"ack_retry"' -and $androidPushServiceSource -match 'shouldRestartClaimedMobilePush\(claimed,\s*serviceRunning\)[\s\S]*?wakeFromMobilePush') "a locally reconciled terminal push must retry only its acknowledgement, while a claimed pre-snapshot wake may restart a dead monitor"
  Assert-True ($androidTaskPetSource -match 'notifyTaskSettled\(task,[\s\S]*?MobilePushRegistration\.acknowledgeTerminalAsync\([\s\S]*?task\.lastEventSeq') "Android must acknowledge a terminal push only after authoritative terminal reconciliation and its completion-notification attempt"
  Assert-True ($androidPushRegistrationSource -match 'PREF_MOBILE_PUSH_PENDING_ACKS_JSON[\s\S]*?/codex-api/mobile-push/ack' -and $androidPushRegistrationSource -match 'persistAcknowledgedEventSeq\(context,\s*threadId,\s*eventSeq\)[\s\S]*?clearPendingAcknowledgements\(context,\s*threadId,\s*eventSeq\)') "device acknowledgements must survive process loss and clear locally only after authenticated 7420 acceptance"
  $terminalAcknowledgementMatch = [regex]::Match($androidPushRegistrationSource, 'static\s+void\s+acknowledgeTerminalAsync[\s\S]*?\n\s*static\s+void\s+retryPendingAcknowledgementAsync')
  Assert-True ($terminalAcknowledgementMatch.Success -and $terminalAcknowledgementMatch.Value -match 'shouldPersistMobilePushAcknowledgement[\s\S]*?persistPendingAcknowledgement[\s\S]*?submitPendingAcknowledgementAsync') "a claimed terminal push must persist its acknowledgement even if the cached FCM token is temporarily missing"
  Assert-True ($androidTaskPetPolicySource -match 'shouldPersistMobilePushAcknowledgement[\s\S]*?hasStoredToken\s*\|\|\s*pushEventClaimed\s*\|\|\s*acknowledgementPending') "ordinary completions without push readiness must not accumulate orphan acknowledgement work"
  Assert-True ($appSource -match "wake_restarted[\s\S]*?最近已恢复同步[\s\S]*?ack_retry[\s\S]*?回执重试中") "mobile settings must distinguish recovered monitor wake from a locally complete acknowledgement retry"
  Assert-True ($androidPushRegistrationSource -match '/codex-api/mobile-push/register[\s\S]*?threadIds[\s\S]*?PREF_MOBILE_PUSH_LAST_REGISTRATION_SIGNATURE') "Android push registration must stay scoped to active thread subscriptions and dedupe unchanged registrations"
  Assert-True ($androidPushRegistrationSource -match 'PREF_MOBILE_PUSH_LAST_ATTEMPT_SIGNATURE[\s\S]*?shouldThrottleMobilePushRegistration[\s\S]*?shouldSkipFreshMobilePushRegistration' -and $androidTaskPetPolicySource -match 'sameAttemptSignature[\s\S]*?elapsedSinceAttemptMs\s*<\s*retryThrottleMs') "a changed active-thread subscription must bypass the repeated-registration retry throttle"
  Assert-True ($androidConfigSource -match 'PREF_MOBILE_PUSH_LAST_TOKEN_ATTEMPT_AT_MS' -and $androidPushRegistrationSource -match 'TOKEN_RETRY_THROTTLE_MS\s*=\s*30_000L[\s\S]*?TOKEN_REFRESH_IN_FLIGHT[\s\S]*?shouldThrottleMobilePushTokenRefresh') "Firebase token acquisition failures must use persistent bounded retry and in-flight deduplication"
  Assert-True ($androidPushRegistrationSource -match 'ensureTokenAndSyncAsync[\s\S]*?FirebaseApp\.getApps[\s\S]*?refreshToken\(appContext\)[\s\S]*?syncStoredTokenAsync\(appContext\)' -and ([regex]::Matches($androidTaskPetSource, 'MobilePushRegistration\.ensureTokenAndSyncAsync\(this\)').Count -ge 2)) "the active native monitor must recover a missing FCM token at startup and after authoritative snapshots"
  Assert-True ($serverMobilePushSource -match "isMobilePushTerminalEvent[\s\S]*?turn/completed[\s\S]*?listMobilePushRegistrationsForThread") "the server must send push only from terminal events to registrations subscribed to that thread"
  $latePushRegistrationMatch = [regex]::Match($serverMobilePushSource, 'register\(payload:[\s\S]*?\n\s*unregister\(payload:')
  Assert-True ($latePushRegistrationMatch.Success -and $latePushRegistrationMatch.Value -match 'upsertMobilePushRegistration[\s\S]*?getSnapshot[\s\S]*?isMobilePushTerminalSnapshot[\s\S]*?listEventsAfter[\s\S]*?enqueueTerminalDelivery') "a late active-thread registration must recover the current persisted terminal event"
  $terminalSnapshotMatch = [regex]::Match($serverMobilePushSource, 'function\s+isMobilePushTerminalSnapshot[\s\S]*?\n\}')
  Assert-True ($terminalSnapshotMatch.Success -and $terminalSnapshotMatch.Value -notmatch "running|starting|waiting_permission") "late registration catch-up must reject an older terminal event when the current thread snapshot is active"
  Assert-True ($serverMobilePushSource -match "kind:\s*'task_terminal'[\s\S]*?threadId:[\s\S]*?eventSeq:[\s\S]*?android:[\s\S]*?priority:\s*'high'" -and $serverMobilePushSource -notmatch "createFcmTerminalMessage[\s\S]{0,900}(latestReply|prompt|cookie|serverUrl)") "FCM terminal payload must be high priority and content-free"
  Assert-True ($runtimeStoreSource -match 'CREATE TABLE IF NOT EXISTS mobile_push_outbox[\s\S]*?token_hash[\s\S]*?delivery_key[\s\S]*?next_attempt_at_iso' -and $runtimeStoreSource -notmatch 'CREATE TABLE IF NOT EXISTS mobile_push_outbox[\s\S]{0,900}(params_json|prompt|latest_reply|server_url|authorization)') "terminal push work must be durable without persisting conversation content or credentials"
  Assert-True ($serverMobilePushSource -match 'MOBILE_PUSH_RETRY_DELAYS_MS\s*=\s*\[1_000,\s*5_000,\s*15_000,\s*60_000,\s*5\s*\*\s*60_000,\s*15\s*\*\s*60_000\]' -and $serverMobilePushSource -match 'enqueueMobilePushDelivery[\s\S]*?retryPendingDeliveries[\s\S]*?rescheduleMobilePushDelivery') "transient terminal push failures must enter the durable bounded-backoff worker"
  Assert-True ($serverMobilePushSource -match 'sendTerminalEvent[\s\S]*?markMobilePushProviderAccepted' -and $serverMobilePushSource -notmatch 'sendTerminalEvent[\s\S]{0,900}markMobilePushDelivery') "FCM HTTP acceptance must retain the outbox until the device confirms authoritative terminal processing"
  Assert-True ($serverMobilePushRoutesSource -match '/codex-api/mobile-push/ack[\s\S]*?mobilePushCoordinator\.acknowledge' -and $runtimeStoreSource -match 'acknowledgeMobilePushDeliveries[\s\S]*?app_instance_id[\s\S]*?event_seq\s*<=\s*@eventSeq[\s\S]*?DELETE FROM mobile_push_outbox') "the authenticated device acknowledgement must atomically settle only that app instance's observed thread events"
  Assert-True ($runtimeStoreSource -match 'CREATE TABLE IF NOT EXISTS mobile_push_device_acknowledgements[\s\S]*?PRIMARY KEY \(app_instance_id, thread_id\)' -and $runtimeStoreSource -match 'enqueueMobilePushDelivery[\s\S]*?mobile_push_device_acknowledgements[\s\S]*?acknowledgement\.event_seq\s*>=\s*@eventSeq') "a device acknowledgement that wins the terminal-event enqueue race must durably suppress that stale wake"
  Assert-True ($runtimeStoreSource -match "last_error='awaiting_device_ack'" -and $serverMobilePushSource -match 'awaitingDeviceAckCount') "push diagnostics must distinguish provider-accepted work still waiting for device processing"
  Assert-True ($androidBackgroundVerifierSource -match 'RequireDeviceAcknowledgement[\s\S]*?terminalToAcknowledgementMs[\s\S]*?deviceAcknowledgementSucceeded') "physical Doze verification must enforce and time the device acknowledgement boundary"
  Assert-True ($androidTaskPetSource -match 'replyEventCount[\s\S]*?replySnapshotApplyCount[\s\S]*?replyRenderCount[\s\S]*?lastReplyRenderedAtMs' -and $androidBackgroundVerifierSource -match 'RequireLiveReplyUpdate[\s\S]*?replyEventToRenderMs[\s\S]*?MaxReplyRenderLatencyMs') "physical mobile verification must prove reply event, authoritative snapshot application, and visible overlay rendering without storing reply content"
  Assert-True ($codexBridgeSource -match 'mobilePushCoordinator\.start\(\)' -and $codexBridgeDisposeSource -match 'mobilePushCoordinator\.dispose\(\)[\s\S]*?runtimeStore\.close\(\)') "7420 restart recovery must start the push worker and stop it before closing Runtime Store"
  Assert-True ($appSource -match '深度休眠通知[\s\S]*?mobileShellDeepSleepPushLabel') "mobile settings must expose whether deep-Doze terminal wake is ready"
  Assert-True (
    ($mobilePushReadinessSource -match 'android[\\/]+app[\\/]+google-services\.json') -and
    ($mobilePushReadinessSource -match 'GOOGLE_APPLICATION_CREDENTIALS') -and
    ($mobilePushReadinessSource -match 'firebaseProjectMatch') -and
    ($mobilePushReadinessSource -match '/codex-api/mobile-push/status') -and
    ($mobilePushReadinessSource -match 'registrationCount[\s\S]*?subscribedRegistrationCount')
  ) "deep-Doze readiness must verify both Firebase configurations, project identity, live server state, device registration, and active subscription"
  Assert-True (
    ($mobilePushReadinessSource -match 'requireConfiguration[\s\S]*?requireReady') -and
    ($mobilePushReadinessTestSource -match "serialized\.includes\('PRIVATE KEY'\),\s*false") -and
    ($mobilePushReadinessTestSource -match "serialized\.includes\('fixture@'\),\s*false") -and
    ($mobilePushReadinessTestSource -match 'serialized\.includes\(projectId\),\s*false')
  ) "mobile push readiness gates must stay strict without exposing private keys, service-account email, or Firebase project identity"
  Assert-True ($androidTaskPetSource -match 'PowerManager\.PARTIAL_WAKE_LOCK[\s\S]*?taskWakeLock\.acquire\(remainingMs\)') "active native task monitoring must use a timeout-bounded partial wake lock"
  Assert-True ($androidTaskPetSource -match 'shouldHoldWakeLock\(activeTaskCount\(\)\)[\s\S]*?releaseTaskWakeLock\(\)') "the task wake lock must be released when no active task remains"
  Assert-True ($androidNoProgressReviewSource -match 'INITIAL_REMINDER_MS\s*=\s*10\s*\*\s*60_000L') "native long-task review must begin after ten minutes without progress"
  Assert-True ($androidNoProgressReviewSource -match 'REVIEW_INTERVAL_MS\s*=\s*20\s*\*\s*60_000L') "native long-task review must repeat at a bounded twenty-minute cadence"
  Assert-True ($androidTaskPetSource -match 'lastNoProgressReminderAtMs[\s\S]*?put\("lastNoProgressReminderAtMs"') "no-progress reminder deduplication must survive service restarts"
  Assert-True ($androidTaskPetSource -match 'notifyTaskNoProgress\(task,\s*notificationKey\)[\s\S]*?lastNoProgressReminderAtMs\s*=\s*now') "native long-task review must persist the actual reminder time for periodic review"
  Assert-True ($androidNoProgressReviewSource -match 'CHANNEL_ID[\s\S]*?NotificationManager\.IMPORTANCE_DEFAULT') "no-progress attention must use a separate default-importance notification channel"
  Assert-True ($androidTaskPetSource -match 'notifyTaskSettled[\s\S]*?TaskPetNoProgressReviewReceiver\.cancelNotification') "completion must supersede a stale no-progress reminder"
  Assert-True ($androidManifestSource -match 'TaskPetNoProgressReviewReceiver[\s\S]*?android:exported="false"') "the idle review alarm receiver must be explicit and unavailable to other apps"
  Assert-True ($androidNoProgressReviewSource -match 'setAndAllowWhileIdle\(AlarmManager\.RTC_WAKEUP' -and $androidManifestSource -notmatch 'SCHEDULE_EXACT_ALARM|USE_EXACT_ALARM') "screen-off reviews must use an inexact idle-safe alarm without exact-alarm access"
  Assert-True ($androidNoProgressReviewSource -match 'PREF_TASK_PET_TASKS_JSON[\s\S]*?shouldNotifyNoProgress[\s\S]*?lastNoProgressReminderAtMs[\s\S]*?\.commit\(\)[\s\S]*?scheduleNext') "process-death review must deduplicate from the persisted task snapshot before scheduling again"
  $persistedReviewMatch = [regex]::Match($androidNoProgressReviewSource, 'private\s+static\s+void\s+reviewPersistedTasks[\s\S]*?\n\s*private\s+static\s+long\s+findEarliestReviewAtMs')
  Assert-True ($persistedReviewMatch.Success -and $persistedReviewMatch.Value -match '\.commit\(\);[\s\S]*?notifyNoProgress\(') "process-death review must commit its reminder watermark before alerting"
  Assert-True ($androidTaskPetSource -match 'persistTasks[\s\S]*?TaskPetNoProgressReviewReceiver\.scheduleNext') "every authoritative native task snapshot must reconcile the next idle review"
  Assert-True ($androidNoProgressReviewSource -notmatch 'HttpURLConnection|/codex-api|startForegroundService|ContextCompat\.startForegroundService') "the idle review receiver must not access the network or start a killed foreground service"
  Assert-True ($appSource -match '连续 10 分钟无新进展时首次提醒，之后约每 20 分钟复盘一次，有进展后重新计时。省电模式可能延后提醒') "mobile settings must explain the approximate long-task reminder cadence"
  Assert-True ($androidPluginSource -match 'ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS[\s\S]*?isIgnoringBatteryOptimizations\(getContext\(\)\.getPackageName\(\)\)') "Android runtime info and its manual recovery action must expose the Doze allowlist boundary"
  Assert-True ($appSource -match '后台运行[\s\S]*?mobileShellBackgroundRuntimeLabel[\s\S]*?调整后台运行') "mobile settings must make the background execution restriction visible and actionable"
  Assert-True ($appSource -match 'function\s+onWindowFocusRefreshAccountState[\s\S]*?refreshMobileShellRuntimeInfo\(\)') "returning from Android background settings must refresh the visible runtime state"
  Assert-True ($androidTaskPetSource -match "/codex-api/runtime/request\?clientMessageId=") "the native monitor must look up a provisional client id"
  Assert-True ($androidTaskPetPolicySource -match 'shouldConfirmRuntimeRequest[\s\S]*?!requestAccepted') "every new renderer request must remain confirmation-pending until native acceptance"
  Assert-True ($androidTaskPetSource -match 'shouldConfirmRuntimeRequest\(task\.clientMessageId,\s*task\.requestAccepted\)[\s\S]*?readRuntimeRequest\(task\.clientMessageId\)[\s\S]*?task\.requestAccepted\s*=\s*true') "existing-thread monitoring must confirm the new request before reading a potentially terminal previous-turn snapshot"
  Assert-True ($androidTaskPetSource -match 'put\("requestAccepted",\s*task\.requestAccepted\)') "request acceptance must survive foreground-service recreation"
  Assert-True ($androidTaskPetSource -match 'restoreReplyAttempt\(\)[\s\S]*?ensurePersistedReplyAttemptTask\(\)') "a persisted task-pet reply must be restored into native monitoring after service recreation"
  Assert-True ($androidTaskPetSource -match 'readRuntimeRequest\(replyAttemptClientMessageId\)') "a transport-uncertain native reply must reconcile its original id before any retry"
  Assert-True ($androidTaskPetSource -match 'new ReplyResult\(true,\s*"start_uncertain"') "a lost native send response must remain confirmation-pending instead of becoming a definite failure"
  Assert-True ($androidTaskPetSource -match 'REPLY_CONFIRMATION_MISSING_LIMIT\s*=\s*3[\s\S]*?shouldRequireManualReplyRetry') "a missing native reply request must cross a bounded authoritative confirmation window before manual retry"
  Assert-True ($androidTaskPetSource -match 'task\.state\s*=\s*"retry"[\s\S]*?prepareReplyAttemptForFreshRetry\(\)[\s\S]*?notifyReplyNeedsRetry') "an unconfirmed native reply must stop background monitoring, retain a fresh manual retry, and notify the user"
  Assert-True ($androidTaskPetPolicySource -match 'isActiveTaskState[\s\S]*?"running"\.equals\(state\)[\s\S]*?"waiting"\.equals\(state\)') "manual-retry reply rows must not hold the wake lock or continue polling forever"
  Assert-True ($androidTaskPetSource -match "task\.threadId\s*=\s*request\.threadId") "the native monitor must adopt the authoritative thread returned for a provisional task"
  Assert-True ($androidTaskPetSource -match "threadId\.isEmpty\(\)\s*&&\s*previous\s*!=\s*null[\s\S]*?previous\.threadId") "a stale provisional renderer snapshot must not erase a thread id already resolved by the native monitor"
  Assert-True ($androidTaskPetSource -match "/codex-api/runtime/snapshots\?threadIds=") "the native monitor must continue with batch thread snapshot polling after resolution"
  Assert-True ($androidPluginSource -match 'previousActiveTasksJson[\s\S]*?PREF_TASK_PET_ACTIVE_TASKS_JSON[\s\S]*?countTrackedActiveTasks\(tasksJson,\s*previousActiveTasksJson\)') "the active-to-empty frontend transition must preserve the immediately preceding task snapshot while the native service starts"
  Assert-True ($androidPluginSource -match 'countTrackedActiveTasks[\s\S]*?PREF_TASK_PET_TASKS_JSON[\s\S]*?countActiveTaskRows') "an empty frontend snapshot must not stop a native-owned active task before authoritative reconciliation"
  Assert-True ($androidTaskPetPolicySource -match 'shouldRetainOmittedTask[\s\S]*?"running"\.equals\(state\)[\s\S]*?"waiting"\.equals\(state\)[\s\S]*?"completed"\.equals\(state\)') "frontend omission must retain active and unread-completed native task records"
  Assert-True ($androidTaskPetSource -match 'OMITTED_PROVISIONAL_MISSING_LIMIT\s*=\s*3[\s\S]*?"not_found"\.equals\(result\.executionState\)[\s\S]*?shouldDropOmittedProvisional') "an omitted threadless request must require repeated authoritative not-found results before cleanup"
  Assert-True ($androidTaskPetSource -match 'removeTaskFromFrontendActiveSnapshot\(task\)[\s\S]*?notifyTaskSettled') "native terminal settlement must remove the stale frontend-active preference before emitting completion attention"
  Assert-True ($source -match 'activeTaskPetItems[\s\S]*?activityId:\s*activity\?\.activityId[\s\S]*?startedAtMs:[\s\S]*?lastEventSeq:') "task-pet snapshots must carry the renderer activity generation and authoritative event sequence"
  Assert-True ($appSource -match 'activityId:\s*item\.activityId[\s\S]*?startedAtMs:\s*item\.startedAtMs[\s\S]*?lastEventSeq:\s*item\.lastEventSeq') "the Android bridge payload must preserve task generation metadata"
  $differentTaskGenerationPolicyMatch = [regex]::Match($androidTaskPetPolicySource, 'static\s+boolean\s+shouldAcceptDifferentTaskGeneration[\s\S]*?\n\s*static\s+boolean\s+shouldWakeForRuntimeEvent')
  Assert-True ($differentTaskGenerationPolicyMatch.Success -and $differentTaskGenerationPolicyMatch.Value -match 'currentStartedAtMs\s*>\s*0L\s*&&\s*incomingStartedAtMs\s*>\s*0L[\s\S]*?incomingStartedAtMs\s*!=\s*currentStartedAtMs[\s\S]*?incomingStartedAtMs\s*>\s*currentStartedAtMs[\s\S]*?incomingEventSeq\s*>\s*0L\s*&&\s*incomingEventSeq\s*>\s*currentEventSeq' -and $differentTaskGenerationPolicyMatch.Value -match 'if\s*\(currentStartedAtMs\s*>\s*0L\)\s*return\s+false;[\s\S]*?incomingEventSeq\s*>\s*0L\s*&&\s*incomingEventSeq\s*>\s*currentEventSeq') "different task generations with known start times must be ordered by start time before event sequence, preventing an old activity from borrowing a newer runtime cursor"
  Assert-True ($androidTaskPetSource -match 'requestedGeneration[\s\S]*?isSameTaskGeneration\([\s\S]*?task\.activityId[\s\S]*?requestedGeneration\.activityId') "a delayed native poll result must be rejected after the same thread advances to a newer activity generation"
  Assert-True ($androidTaskPetSource -match 'eventStreamExecutor\s*=\s*Executors\.newSingleThreadExecutor\(\)[\s\S]*?/codex-api/events[\s\S]*?text/event-stream') "active Android tasks must keep a dedicated native SSE event wake channel"
  Assert-True ($androidTaskPetPolicySource -match 'VISIBLE_REPLY_PROGRESS_THROTTLE_MS\s*=\s*250L[\s\S]*?BACKGROUND_REPLY_PROGRESS_THROTTLE_MS\s*=\s*750L[\s\S]*?eventStreamProgressThrottleMs\(boolean overlayExpanded\)') "expanded reply progress must refresh faster while background monitoring stays bounded"
  Assert-True ($androidTaskPetSource -match 'requestImmediateSnapshotPoll\(boolean urgent\)[\s\S]*?eventDrivenPollPending\s*=\s*true[\s\S]*?eventStreamProgressThrottleMs\(expanded\)[\s\S]*?schedulePoll\(delayMs\)') "event-driven snapshot refreshes must use the visibility-aware throttle and preserve an in-flight follow-up poll"
  Assert-True ($androidTaskPetPolicySource -match 'shouldPreferReplyCandidate[\s\S]*?incomingEventSeq\s*>\s*0L\s*&&\s*incomingEventSeq\s*>=\s*currentEventSeq[\s\S]*?compareTaskRecency[\s\S]*?Long\.compare\(rightUpdatedAtMs,\s*leftUpdatedAtMs\)') "native reply ordering must prefer the newest authoritative event and newest visible task activity"
  Assert-True ($androidTaskPetSource -match 'next\.sort\(\(left,\s*right\)\s*->[\s\S]*?compareTaskRecency[\s\S]*?tasks\.addAll\(next\)') "frontend task snapshots must preserve newest-progress-first native ordering"
  Assert-True ($androidTaskPetSource -match 'latestReplyCandidate[\s\S]*?shouldPreferReplyCandidate[\s\S]*?pendingReplyRenderTaskKey\s*=\s*taskNotificationKey\(latestReplyCandidate\)[\s\S]*?tasks\.remove\(latestReplyCandidate\)[\s\S]*?tasks\.add\(0,\s*latestReplyCandidate\)') "the task with the newest assistant reply must enter the visible overlay rows before render evidence is committed"
  Assert-True ($androidTaskPetPolicySource -match 'shouldCommitReplyRender[\s\S]*?overlayExpanded[\s\S]*?panelShown[\s\S]*?panelAlpha\s*>\s*0f[\s\S]*?renderedTaskMatchesPendingReply') "reply-render evidence must require an expanded and actually shown overlay panel"
  Assert-True ($androidTaskPetSource -match 'commitPendingReplyRender\(String renderedReplyTaskKey\)[\s\S]*?taskPanel\.isShown\(\)[\s\S]*?taskPanel\.getAlpha\(\)[\s\S]*?replyRenderCount\s*\+=\s*1L' -and $androidTaskPetSource -match 'withEndAction\(\(\)\s*->\s*\{[\s\S]*?commitPendingReplyRender\(renderedReplyTaskKey\)[\s\S]*?scheduleTaskStackCollapse\(\)') "opening a collapsed panel must commit reply-render evidence only after its visible animation completes"
  Assert-True ($taskPetPreviewSource -match 'task-pet-preview-compact[\s\S]*?primaryItem[\s\S]*?openTask\(primaryItem\)' -and $taskPetPreviewSource -match 'function\s+openTask[\s\S]*?emit\(''open'',\s*item\.threadId\)') "the collapsed web task-pet surface must show one latest-reply preview that opens its exact conversation"
  Assert-True ($taskPetPreviewSource -match 'watch\(\(\)\s*=>\s*props\.items\.length[\s\S]*?count\s*>\s*0[\s\S]*?minimized\.value\s*=\s*false') "a web task arriving after idle must restore the task pet before reply presentation"
  Assert-True ($taskPetPreviewSource -match 'unreadReplyTaskKeys[\s\S]*?item\.state\s*===\s*''waiting''\s*\|\|\s*unreadReplyTaskKeys\.value\.has') "web task-pet attention must count waiting tasks and unread running replies separately"
  Assert-True ($taskPetPreviewSource -match 'function\s+showCloseConfirmation[\s\S]*?stopStackTimer\(\)[\s\S]*?closeConfirmationVisible\.value\s*=\s*true' -and $taskPetPreviewSource -match 'function\s+cancelCloseConfirmation[\s\S]*?closeConfirmationVisible\.value\s*=\s*false[\s\S]*?scheduleStackCollapse\(\)') "web task-pet close confirmation must pause auto-collapse and resume it only after cancellation"
  Assert-True ($androidTaskPetSource -match 'buildCompactPreview[\s\S]*?renderCompactPreview[\s\S]*?compactPreviewReply\.setText\(replyPreview\)[\s\S]*?openThread\(task\.threadId\)' -and $androidTaskPetPolicySource -match 'shouldCommitCompactReplyRender[\s\S]*?!overlayExpanded[\s\S]*?!overlayMinimized[\s\S]*?previewShown[\s\S]*?previewAlpha\s*>\s*0f') "the collapsed native task pet must render the newest reply, open its exact thread, and record visibility only while the compact preview is shown"
  Assert-True ($androidTaskPetPolicySource -match 'hasUnreadReply[\s\S]*?latestReplyEventSeq\s*>\s*readThroughReplyEventSeq' -and $androidTaskPetSource -match 'put\("readThroughReplyEventSeq",\s*task\.readThroughReplyEventSeq\)' -and $androidTaskPetSource -match 'task\.readThroughReplyEventSeq\s*=\s*Math\.max[\s\S]*?task\.latestReplyEventSeq') "native task attention must use a persisted reply-event read cursor instead of a sticky boolean alone"
  Assert-True ($androidTaskPetSource -match 'latestReplyItemId[\s\S]*?replyItemChanged[\s\S]*?showTransientReplyPeek' -and $androidTaskPetSource -match 'REPLY_PEEK_TIMEOUT_MS\s*=\s*5_000L' -and $androidTaskPetSource -match 'getRecommendedTimeoutMillis') "one assistant item may open one accessible five-second reply peek without stream chunks restarting the timer"
  Assert-True ($androidTaskPetSource -match 'TASK_STACK_TIMEOUT_MS\s*=\s*8_000L[\s\S]*?collapseTaskStackRunnable[\s\S]*?setExpanded\(false\)' -and $androidTaskPetSource -match 'EDGE_VISIBLE_HANDLE_DP\s*=\s*32[\s\S]*?screenWidth\s*-\s*visibleHandle[\s\S]*?-\(rootWidth\s*-\s*visibleHandle\)') "the Android task stack must auto-collapse and leave only a bounded side handle"
  Assert-True ($androidMainActivitySource -match 'appForeground\s*=\s*true[\s\S]*?refreshPresentation' -and $androidMainActivitySource -match 'appForeground\s*=\s*false[\s\S]*?refreshPresentation' -and $androidTaskPetSource -match 'shouldAttachOverlay[\s\S]*?!MainActivity\.isAppForeground\(\)' -and $androidTaskPetSource -match 'suppressed_foreground') "the overlay and terminal notification must stay quiet while the Android app itself is foreground"
  Assert-True ($androidTaskPetSource -match 'restorePendingReplyRender\(\)[\s\S]*?PREF_TASK_PET_PENDING_REPLY_RENDER_KEY[\s\S]*?PREF_TASK_PET_PENDING_REPLY_RENDER_EVENT_SEQ' -and $androidTaskPetSource -match 'pendingReplyRenderTaskKey\s*=\s*taskNotificationKey\(latestReplyCandidate\)[\s\S]*?persistPendingReplyRender\(\)' -and $androidTaskPetSource -match 'replyRenderCount\s*\+=\s*1L[\s\S]*?persistPendingReplyRender\(\)') "a collapsed latest-reply render boundary must survive service recreation and clear only after visible render"
  Assert-True ($androidTaskPetPolicySource -match 'shouldPreserveKnownLatestReply[\s\S]*?frontendSnapshot[\s\S]*?sameTaskGeneration[\s\S]*?!currentReply\.isEmpty\(\)[\s\S]*?incomingReplyEventSeq\s*<=\s*0L\s*\|\|\s*incomingReplyEventSeq\s*<=\s*currentReplyEventSeq' -and $androidTaskPetSource -match 'incomingLatestReplyEventSeq[\s\S]*?preserveKnownLatestReply[\s\S]*?resolvedLatestReplyEventSeq[\s\S]*?previous\.latestReplyEventSeq') "an unversioned, equal-version, or older recovering frontend reply must not overwrite a same-generation reply already persisted by the native monitor"
  $nativeSettledStatePolicyMatch = [regex]::Match($androidTaskPetPolicySource, 'static\s+boolean\s+shouldPreserveNativeSettledState[\s\S]*?\n\s*\}')
  Assert-True ($nativeSettledStatePolicyMatch.Success -and $nativeSettledStatePolicyMatch.Value -match 'currentSettled\s*=\s*"completed"\.equals\(currentState\)\s*\|\|\s*"retry"\.equals\(currentState\)[\s\S]*?isActiveTaskState\(incomingState\)' -and $nativeSettledStatePolicyMatch.Value -notmatch 'EventSeq' -and $androidTaskPetSource -match 'shouldPreserveNativeSettledState[\s\S]*?removeTaskFromFrontendActiveSnapshot\(previous\)[\s\S]*?next\.add\(previous\)[\s\S]*?continue;') "a same-generation frontend snapshot must never revive a native completed or manual-retry task, even after later metadata advances the event sequence"
  Assert-True ($androidTaskPetSource -match 'restoreMonitorLifecycleDiagnostics\(\)[\s\S]*?replyRenderCount\s*=\s*Math\.max\(0L,\s*previous\.optLong\("replyRenderCount"' -and $androidTaskPetSource -match 'lastCompletionNotificationAttemptAtMs\s*=\s*Math\.max') "reply and terminal verification counters must remain monotonic across service recreation"
  Assert-True ($androidTaskPetSource -match 'removeTaskFromFrontendActiveSnapshot\(task\)[\s\S]*?persistTasksSynchronously\(\)[\s\S]*?notifyTaskSettled\(task') "each terminal task must commit its completed native snapshot before completion attention is posted"
  $removeFrontendActiveSnapshotMatch = [regex]::Match($androidTaskPetSource, 'private\s+void\s+removeTaskFromFrontendActiveSnapshot[\s\S]*?\n\s*private\s+void\s+markPollUnavailable')
  Assert-True ($removeFrontendActiveSnapshotMatch.Success -and $removeFrontendActiveSnapshotMatch.Value -match 'PREF_TASK_PET_ACTIVE_TASKS_JSON[\s\S]*?\.commit\(\)') "terminal settlement must durably remove its stale frontend-active generation before notification delivery"
  Assert-True ($androidTaskPetSource -match 'completionNotificationAttemptCount\s*\+=\s*1L[\s\S]*?notificationManager\.notify[\s\S]*?completionNotificationPostedCount\s*\+=\s*1L' -and $androidTaskPetSource -match 'restoreMonitorLifecycleDiagnostics\(\)[\s\S]*?completionNotificationAttemptCount\s*=\s*Math\.max[\s\S]*?completionNotificationPostedCount\s*=\s*Math\.max') "multi-task completion verification must keep monotonic attempted and posted notification counts across service recreation"
  Assert-True ($androidBackgroundVerifierSource -match 'MinimumTerminalNotificationAttempts[\s\S]*?notificationAttemptDelta[\s\S]*?notificationPostedDelta[\s\S]*?notificationPostedDelta\s*-lt\s*\$MinimumTerminalNotificationAttempts') "physical multi-task completion verification must require every expected notification attempt to be posted"
  Assert-True ($androidTaskPetPolicySource -match 'nextEventDrivenPollDelayMs[\s\S]*?throttleMs\s*-\s*\(nowMs\s*-\s*lastPollAtMs\)' -and $androidTaskPetSource -match 'eventDrivenPollScheduled\s*=\s*true[\s\S]*?schedulePoll\(delayMs\)' -and $androidTaskPetSource -match 'if\s*\(eventDrivenPollScheduled\)[\s\S]*?lastEventDrivenPollAtMs\s*=\s*System\.currentTimeMillis\(\)') "reply events inside the 750 ms throttle window must retain one trailing authoritative snapshot instead of falling through to the 3-second poll"
  Assert-True ($androidTaskPetPolicySource -match 'shouldWakeForRuntimeEvent[\s\S]*?startsWith\("turn/"\)[\s\S]*?startsWith\("thread/"\)[\s\S]*?startsWith\("server/request"\)[\s\S]*?item/agentMessage/delta') "native SSE wake filtering must include assistant progress without treating every server event as task activity"
  Assert-True ($androidTaskPetSource -match 'catch\s*\(Exception ignored\)[\s\S]*?regular bounded poll remains authoritative[\s\S]*?EVENT_STREAM_RETRY_MS') "SSE failure must reconnect with a bounded delay while regular polling remains authoritative"
  Assert-True ($androidManifestSource -match 'android\.permission\.ACCESS_NETWORK_STATE') "native task recovery must declare Android network-state access"
  Assert-True ($androidTaskPetSource -match 'currentDefaultNetwork\s*=\s*connectivityManager\.getActiveNetwork\(\)[\s\S]*?defaultNetworkKnown\s*=\s*true') "native task recovery must establish the initial default network before observing changes"
  Assert-True ($androidTaskPetSource -match 'new\s+ConnectivityManager\.NetworkCallback\(\)[\s\S]*?onAvailable\(Network network\)[\s\S]*?handleDefaultNetworkAvailable\(network\)[\s\S]*?registerDefaultNetworkCallback\(defaultNetworkCallback\)') "native task recovery must observe later default-network availability"
  Assert-True ($androidTaskPetPolicySource -match 'shouldWakeForDefaultNetworkChange[\s\S]*?networkStateKnown\s*&&\s*!sameNetwork\s*&&\s*activeTaskCount\s*>\s*0') "network availability must wake only a known changed network with active tasks"
  Assert-True ($androidTaskPetSource -match 'handleDefaultNetworkAvailable[\s\S]*?requestImmediateSnapshotPoll\(true\)[\s\S]*?restartEventStreamAfterNetworkRecovery') "network recovery must immediately wake the authoritative snapshot and rebuild SSE"
  Assert-True (($androidTaskPetSource -match 'requestImmediateSnapshotPoll[\s\S]*?if\s*\(pollInFlight\)[\s\S]*?eventDrivenPollPending\s*=\s*true') -and ($androidTaskPetSource -match 'if\s*\(eventDrivenPollPending\)[\s\S]*?eventDrivenPollScheduled\s*=\s*true[\s\S]*?nextDelayMs\s*=\s*0L')) "network recovery must coalesce behind an in-flight authoritative snapshot"
  Assert-True ($androidTaskPetSource -match 'onDestroy\(\)[\s\S]*?unregisterDefaultNetworkCallback[\s\S]*?unregisterNetworkCallback') "the default-network callback must be released with the foreground service"
  Assert-True ($androidConfigSource -match 'PREF_TASK_PET_MONITOR_DIAGNOSTICS_JSON') "native task monitoring diagnostics must survive a service/process restart"
  Assert-True ($androidTaskPetSource -match 'persistMonitorDiagnostics[\s\S]*?lastRelevantEventAtMs[\s\S]*?lastEventDrivenPollAtMs[\s\S]*?lastSnapshotSuccessAtMs[\s\S]*?lastTerminalAtMs[\s\S]*?lastCompletionNotificationResult[\s\S]*?lastCompletionNotificationBodySource[\s\S]*?networkRecoveryCount[\s\S]*?lastDefaultNetworkAvailableAtMs') "native task monitoring must retain stream, event, authoritative snapshot, terminal, notification body source, and network-recovery evidence"
  Assert-True (
    ($androidTaskPetSource -match 'setContentTitle\(status\)[\s\S]*?setContentText\(task\.title\)') -and
    ($androidTaskPetSource -match 'lastCompletionNotificationBodySource\s*=\s*"title_only"[\s\S]*?notificationManager\.notify')
  ) "completion notifications must expose only the truthful two-character status and task title"
  $monitorDiagnosticsMatch = [regex]::Match($androidTaskPetSource, 'private\s+void\s+persistMonitorDiagnostics[\s\S]*?\n\s*private\s+boolean\s+reconcileNoProgressNotifications')
  Assert-True ($monitorDiagnosticsMatch.Success) "could not find native task monitor diagnostics persistence"
  Assert-True ($monitorDiagnosticsMatch.Value -notmatch 'threadId|clientMessageId|latestReply|serverUrl') "native task monitor diagnostics must not persist conversation content, identity, or server addresses"
  Assert-True ($androidPluginSource -match 'monitorRunning[\s\S]*?PREF_TASK_PET_MONITOR_DIAGNOSTICS_JSON[\s\S]*?monitorDiagnostics') "the Android bridge must expose sanitized background-monitor evidence for real-device review"
  $monitorDumpMatch = [regex]::Match($androidTaskPetSource, 'protected\s+void\s+dump[\s\S]*?\n\s*@Override\s*\n\s*public\s+void\s+onDestroy')
  Assert-True ($monitorDumpMatch.Success -and $monitorDumpMatch.Value -match 'CX_CODEX_TASK_PET_DIAGNOSTICS') "adb dumpsys must expose sanitized native monitor evidence without waking the WebView"
  Assert-True ($monitorDumpMatch.Value -notmatch 'threadId|clientMessageId|latestReply|serverUrl') "adb monitor evidence must not expose conversation content, identity, or server addresses"
  Assert-True ($androidBackgroundVerifierSource -match 'ValidateSet\("Snapshot",\s*"Observe",\s*"ScreenOff",\s*"Doze"\)[\s\S]*?\[string\]\$Mode\s*=\s*"Snapshot"') "the Android background verifier must stay read-only unless a disruptive mode is explicit"
  Assert-True ($androidBackgroundVerifierSource -match 'finally\s*\{[\s\S]*?deviceidle",\s*"unforce"[\s\S]*?battery",\s*"reset"[\s\S]*?KEYCODE_WAKEUP') "the Android background verifier must restore forced-idle, battery, and screen state"
  Assert-True ($androidBackgroundVerifierSource -match '\[switch\]\$RequireActiveTask[\s\S]*?\[switch\]\$RequireTerminalNotification[\s\S]*?MaxTerminalNotificationLatencyMs') "the Android background verifier must support explicit active-task and terminal-notification gates"
  Assert-True (
    ($androidBackgroundVerifierSource -match 'noProgressReviewScheduledAtMs[\s\S]*?summary\.json') -and
    ($androidBackgroundVerifierSource -match 'lastCompletionNotificationBodySource[\s\S]*?terminalToNotificationMs[\s\S]*?summary\.json') -and
    ($androidBackgroundVerifierSource -match 'dumpsys",\s*"alarm"[\s\S]*?noProgressReviewAlarm')
  ) "the Android background verifier must summarize scheduled review, alarm registration, content-free notification source, and terminal latency evidence"
  Assert-True ($androidBackgroundVerifierSource -match 'notificationResult\s*-ne\s*"posted"[\s\S]*?notificationBodySource\s*-ne\s*"title_only"') "strict Android completion verification must reject blocked, retry, or verbose completion notifications"
  Assert-True ($androidTaskPetSource -match 'restoreMonitorLifecycleDiagnostics\(\)[\s\S]*?START_STICKY' -and $androidTaskPetSource -match 'onTaskRemoved\(Intent\s+rootIntent\)[\s\S]*?taskRemovedCount\s*\+=\s*1L[\s\S]*?persistMonitorDiagnostics\(true\)') "native monitoring must preserve sticky restart and recent-task removal evidence"
  Assert-True ($androidBackgroundVerifierSource -match 'serviceRecreated[\s\S]*?stickyRestartAdvanced[\s\S]*?taskRemovedAdvanced[\s\S]*?RequireTaskRemoval[\s\S]*?RequireStickyRestart') "Android lifecycle verification must summarize and gate task removal and sticky recreation"
  Assert-True ($source -match "internalOptions\.onThreadCreated\?\.\(threadId\)") "new-thread sends must announce the authoritative thread returned by runtime/send"
  Assert-True ($appSource -match "routeToCreatedThreadPromise\s*=\s*navigateToCreatedThread\(threadId\)") "the app must enter a newly created thread while its first turn continues in the background"
  Assert-True ($serverSource -match "const\s+promise\s*=\s*startParsedRuntimeTurnWithAppServer[\s\S]*?getLatestRequestByClientMessageId\(clientMessageId\)[\s\S]*?return\s+runtimeStartResultFromRequest\(accepted\)") "runtime/send must return the durable accepted record without awaiting slow thread/start"
  Assert-True ($serverSource -match "void\s+promise\.then\([\s\S]*?clearInFlightRuntimeStart") "accepted runtime starts must remain owned and deduplicated after the HTTP response"
  Assert-True ($serverSource -match "platform\s*===\s*'win32'[\s\S]*?'features\.shell_snapshot':\s*false") "Windows runtime threads must skip the unsupported shell snapshot startup timeout"
  Assert-True ($runtimeActionSource -match "setJson\(res,\s*isRuntimeStartPending\(result\.status\)\s*\?\s*202" -and $runtimeActionSource -match "status\s*===\s*'pending_start'[\s\S]*?status\s*===\s*'starting'") "accepted pending runtime starts must use HTTP 202"
  Assert-True ($source -match "isRuntimeRequestAwaitingDeliveryConfirmation\(runtimeResult\.status\)[\s\S]*?markPendingNewThreadPreviewConfirming[\s\S]*?reconcileAcceptedNewThreadInBackground\(\)[\s\S]*?return\s+''") "a threadless 202 must keep the provisional bubble confirming while background binding continues"
  Assert-True ($source -match "NEW_THREAD_ACCEPTED_RECONCILE_DELAYS_MS[\s\S]*?getRuntimeRequestByClientMessageId\(clientMessageId\)[\s\S]*?recoverRuntimeRequestByClientMessage\(\)") "foreground new-thread binding must use a bounded request lookup schedule"
  Assert-True ($source -match "notification\.method\s*===\s*'turn/started'[\s\S]*?notification\.method\s*===\s*'thread/started'[\s\S]*?recoverPersistentMessageOutbox\(\)") "thread/started must immediately reconcile the durable provisional outbox"
  Assert-True ($appSource -match "if\s*\(!threadId\)\s*\{[\s\S]*?if\s*\(!pendingNewThreadPreview\.value\)[\s\S]*?restoreHomeThreadComposerDraft") "an accepted provisional first message must not be duplicated back into the composer"
  Assert-True ($source -match "markPendingNewThreadPreviewWaiting\(clientMessageId,\s*optimisticMessageId\)[\s\S]*?markPendingNewThreadPreviewFailed\(clientMessageId,\s*optimisticMessageId\)") "threadless transport failures must wait for reconnect while definitive failures remain actionable"
  Assert-True ($source -match "async\s+function\s+retryFailedNewThreadMessage[\s\S]*?reuseOptimisticMessageId:\s*messageId") "threadless manual retry must reuse the same visual message id"
  Assert-True ($source -match "function\s+takeFailedNewThreadMessageForEditing[\s\S]*?removeMessageOutboxEntry\(entry\.clientMessageId\)[\s\S]*?pendingNewThreadPreview\.value\s*=\s*null") "editing a failed threadless message must atomically leave preview mode and clear its outbox attempt"
  Assert-True ($source -match "if\s*\(newestDraftEntry\)\s*\{\s*restoreFailedNewThreadOutboxEntry\(newestDraftEntry\)") "restart recovery must restore a failed new-thread bubble instead of silently moving it back to the composer"
  Assert-True ($appSource -match 'data-testid="pending-new-thread-preview"[\s\S]*?:messages="\[pendingNewThreadPreview\.message\]"') "the home route must render the provisional first turn as a conversation"
  Assert-True ($appSource -match ':is-turn-in-progress="pendingNewThreadPreview\.liveOverlay\s*!==\s*null"') "a waiting new-thread preview must not retain a stale running overlay"
  Assert-True ($functionSource -match "markChatFeedbackRequestDispatched\(args\.clientMessageId\)") "runtime sends must mark the first request dispatch"
  Assert-True ($functionSource -match "markChatFeedbackServerAcknowledged\(\{[\s\S]*?clientMessageId:\s*args\.clientMessageId,[\s\S]*?threadId:\s*result\.threadId\s*\|\|\s*feedback\.threadId\s*\|\|\s*PENDING_NEW_THREAD_ID") "a successful threadless 202 response must record durable server acknowledgement before turn identity is available"
  Assert-True ($functionSource -match "if\s*\(recovered\)[\s\S]*?markChatFeedbackServerAcknowledged\(\{[\s\S]*?threadId:\s*recovered\.threadId\s*\|\|\s*feedback\.threadId\s*\|\|\s*PENDING_NEW_THREAD_ID") "runtime-request recovery must record durable server acknowledgement even before a new thread is bound"
  Assert-True ($source -match "recoverRuntimeRequestByClientMessage[\s\S]*?markChatFeedbackServerAcknowledged\(\{[\s\S]*?clientMessageId,[\s\S]*?threadId:\s*recovered\.threadId[\s\S]*?turnStarted:\s*Boolean\(recovered\.turnId\s*&&\s*!awaitingDeliveryConfirmation\)") "new-thread recovery must restore authoritative acknowledgement and turn-start timing after a lost response"
  Assert-True ($source -match "const\s+startedTurn\s*=\s*readTurnStartedInfo\(notification\)[\s\S]*?markChatFeedbackServerAcknowledged\(\{[\s\S]*?turnStarted:\s*true") "turn/started must mark authoritative server acceptance"
  Assert-True ($source -match "function\s+applyRuntimeSnapshotState[\s\S]*?parseIsoTimestamp\(snapshot\.lastStartedAtIso[\s\S]*?markChatFeedbackServerAcknowledged\(\{[\s\S]*?turnStartedAtMs:\s*authoritativeTurnStartedAtMs") "runtime snapshot recovery must restore turn-start timing when the live notification was missed"
  Assert-True ($source -match "const\s+liveAgentMessageDelta\s*=\s*readAgentMessageDelta\(notification\)[\s\S]*?markChatFeedbackFirstAssistantData") "the first assistant delta must mark data receipt before rendering"
}

function Invoke-AgentBrowser {
  param([string[]]$Arguments)

  $command = Get-Command agent-browser -ErrorAction Stop
  $stdoutPath = [IO.Path]::GetTempFileName()
  $stderrPath = [IO.Path]::GetTempFileName()
  $process = $null
  try {
    if ($command.CommandType -eq "ExternalScript") {
      $fileName = "powershell"
      $argumentList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $command.Source) + $Arguments
    } else {
      $fileName = $command.Source
      $argumentList = $Arguments
    }

    $process = Start-Process `
      -FilePath $fileName `
      -ArgumentList $argumentList `
      -NoNewWindow `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath `
      -PassThru

    if (-not $process.WaitForExit($AgentBrowserTimeoutSec * 1000)) {
      try {
        Stop-Process -Id $process.Id -Force -ErrorAction Stop
      } catch {}
      throw "agent-browser $($Arguments -join ' ') timed out after $AgentBrowserTimeoutSec seconds"
    }

    $output = @()
    if (Test-Path -LiteralPath $stdoutPath) {
      $output += Get-Content -LiteralPath $stdoutPath -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $stderrPath) {
      $output += Get-Content -LiteralPath $stderrPath -ErrorAction SilentlyContinue
    }
    $exitCode = if ($null -eq $process.ExitCode) { 0 } else { [int]$process.ExitCode }
    if ($exitCode -ne 0) {
      throw "agent-browser $($Arguments -join ' ') failed with exit code $exitCode`n$($output -join "`n")"
    }
    return @($output)
  } finally {
    Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
  }
}

function Initialize-ScreenshotOutputDir {
  if (-not $CaptureScreenshots) {
    return $null
  }

  $repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
  $outputRoot = if ([string]::IsNullOrWhiteSpace($ScreenshotOutputDir)) {
    Join-Path $repoRoot (Join-Path "output" (Join-Path "regression-7420" (Convert-ToSafeFileName -Name $ScreenshotTaskName)))
  } else {
    $ScreenshotOutputDir
  }
  $resolvedParent = Split-Path -Parent $outputRoot
  if (-not [string]::IsNullOrWhiteSpace($resolvedParent)) {
    New-Item -ItemType Directory -Force -Path $resolvedParent | Out-Null
  }
  New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
  return (Resolve-Path -LiteralPath $outputRoot).Path
}

function Save-RegressionScreenshot {
  param(
    [string]$Session,
    [string]$Name
  )

  if ([string]::IsNullOrWhiteSpace($script:screenshotOutputDir)) {
    return $null
  }

  $fileName = (Convert-ToSafeFileName -Name $Name) + ".png"
  $path = Join-Path $script:screenshotOutputDir $fileName
  Invoke-AgentBrowser -Arguments @("--session", $Session, "screenshot", $path) | Out-Null
  $resolved = (Resolve-Path -LiteralPath $path).Path
  Write-Step "screenshot saved -> $resolved"
  return $resolved
}

function Invoke-BrowserEvalJson {
  param(
    [string]$Session,
    [string]$Script
  )

  $bytes = [Text.Encoding]::UTF8.GetBytes($Script)
  $base64 = [Convert]::ToBase64String($bytes)
  $output = Invoke-AgentBrowser -Arguments @("--session", $Session, "eval", "-b", $base64)
  $jsonLines = $output |
    ForEach-Object { [string]$_ } |
    Where-Object {
      $line = $_.Trim()
      $line.StartsWith("{") -or $line.StartsWith('"')
    }
  $jsonLine = (($jsonLines | ForEach-Object { $_.Trim() }) -join "")

  if (-not $jsonLine) {
    throw "agent-browser eval did not return JSON. Output:`n$($output -join "`n")"
  }
  $parsed = $jsonLine | ConvertFrom-Json
  if ($parsed -is [string]) {
    return ($parsed | ConvertFrom-Json)
  }
  return $parsed
}

function Invoke-AgentBrowserJson {
  param([string[]]$Arguments)

  $output = Invoke-AgentBrowser -Arguments (@('--json') + $Arguments)
  $jsonLine = $output |
    ForEach-Object { ([string]$_).Trim() } |
    Where-Object { $_.StartsWith('{') } |
    Select-Object -First 1
  if (-not $jsonLine) {
    throw "agent-browser did not return structured JSON. Output:`n$($output -join "`n")"
  }
  $result = $jsonLine | ConvertFrom-Json
  if ($result.success -ne $true) {
    throw "agent-browser structured command failed: $($result.error | ConvertTo-Json -Compress)"
  }
  return $result.data
}

function Measure-ThreadSendFeedbackBudget {
  param(
    [string]$Session,
    [string]$ThreadId
  )

  $probeText = "7420-send-feedback-budget-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
  $prepareScript = @'
JSON.stringify((() => {
  window.localStorage.removeItem('codex-web-local.message-outbox.v1');
  window.localStorage.removeItem('codex-web-local.chat-feedback-metrics.v1');
  delete window.__cxCodexChatFeedbackMetrics;
  delete window.__cxCodexChatFeedbackSummary;
  return { prepared: true };
})())
'@
  Invoke-BrowserEvalJson -Session $Session -Script $prepareScript | Out-Null
  Invoke-AgentBrowser -Arguments @('--session', $Session, 'set', 'offline', 'on') | Out-Null

  try {
    Invoke-AgentBrowser -Arguments @('--session', $Session, 'fill', '.thread-composer-input', $probeText) | Out-Null
    $clickScript = @'
JSON.stringify((() => {
  const button = document.querySelector('.thread-composer-submit');
  if (!(button instanceof HTMLButtonElement) || button.disabled) return { clicked: false };
  button.click();
  return { clicked: true };
})())
'@
    $clickState = Invoke-BrowserEvalJson -Session $Session -Script $clickScript
    Assert-True ($clickState.clicked -eq $true) "send feedback probe could not click the composer submit button"

    $metrics = $null
    $escapedProbe = $probeText.Replace('\', '\\').Replace("'", "\'")
    for ($attempt = 1; $attempt -le 10; $attempt++) {
      $readScript = @"
JSON.stringify((() => {
  const rows = window.__cxCodexChatFeedbackMetrics ?? [];
  const metric = rows.length > 0 ? rows[rows.length - 1] : null;
  const promptCount = Array.from(document.querySelectorAll('.conversation-item[data-message-id]'))
    .filter((item) => item.textContent?.includes('$escapedProbe'))
    .length;
  return { metric, promptCount };
})())
"@
      $metrics = Invoke-BrowserEvalJson -Session $Session -Script $readScript
      if (
        $null -ne $metrics.metric -and
        $null -ne $metrics.metric.bubbleVisibleLatencyMs -and
        $null -ne $metrics.metric.runningVisibleLatencyMs
      ) {
        break
      }
      Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '50') | Out-Null
    }

    Assert-True ($null -ne $metrics.metric) "send feedback page metric was not recorded"
    Assert-True ([int]$metrics.promptCount -eq 1) "send feedback probe did not render exactly one optimistic bubble"
    Assert-True ([int]$metrics.metric.stateCommitLatencyMs -le 50) "send feedback state commit exceeded 50 ms"
    Assert-True ([int]$metrics.metric.bubbleVisibleLatencyMs -le 200) "send feedback bubble exceeded 200 ms"
    Assert-True ([int]$metrics.metric.runningVisibleLatencyMs -le 200) "send feedback running indicator exceeded 200 ms"
    Write-Step ("send feedback timing -> " + (@{
      threadId = $ThreadId
      stateCommitMs = [int]$metrics.metric.stateCommitLatencyMs
      bubbleVisibleMs = [int]$metrics.metric.bubbleVisibleLatencyMs
      runningVisibleMs = [int]$metrics.metric.runningVisibleLatencyMs
    } | ConvertTo-Json -Compress))
    $focusScript = @"
JSON.stringify((() => {
  const item = Array.from(document.querySelectorAll('.conversation-item[data-message-id]'))
    .find((row) => row.textContent?.includes('$escapedProbe'));
  item?.scrollIntoView({ block: 'center' });
  return { focused: Boolean(item) };
})())
"@
    $focusState = Invoke-BrowserEvalJson -Session $Session -Script $focusScript
    Assert-True ($focusState.focused -eq $true) "send feedback probe could not be focused for screenshot evidence"
    Save-RegressionScreenshot -Session $Session -Name 'send-feedback-budget-phone' | Out-Null
  } finally {
    try { Invoke-AgentBrowser -Arguments @('--session', $Session, 'set', 'offline', 'off') | Out-Null } catch {}
    try {
      $cleanupScript = @'
JSON.stringify((() => {
  window.localStorage.removeItem('codex-web-local.message-outbox.v1');
  window.localStorage.removeItem('codex-web-local.chat-feedback-metrics.v1');
  delete window.__cxCodexChatFeedbackMetrics;
  delete window.__cxCodexChatFeedbackSummary;
  const input = document.querySelector('.thread-composer-input');
  if (input instanceof HTMLTextAreaElement) {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  return { cleared: true };
})())
'@
      Invoke-BrowserEvalJson -Session $Session -Script $cleanupScript | Out-Null
      Invoke-AgentBrowser -Arguments @('--session', $Session, 'reload') | Out-Null
      Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '--load', 'networkidle') | Out-Null
    } catch {}
  }
}

function Measure-NewThreadSendFeedbackBudget {
  param([string]$Session)

  $probeText = "7420-new-thread-feedback-budget-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
  $prepareScript = @'
JSON.stringify((() => {
  window.localStorage.removeItem('codex-web-local.message-outbox.v1');
  window.localStorage.removeItem('codex-web-local.chat-feedback-metrics.v1');
  delete window.__cxCodexChatFeedbackMetrics;
  delete window.__cxCodexChatFeedbackSummary;
  return { prepared: true };
})())
'@
  Invoke-BrowserEvalJson -Session $Session -Script $prepareScript | Out-Null
  Invoke-AgentBrowser -Arguments @('--session', $Session, 'set', 'offline', 'on') | Out-Null

  try {
    Invoke-AgentBrowser -Arguments @('--session', $Session, 'fill', '.thread-composer-input', $probeText) | Out-Null
    $clickScript = @'
JSON.stringify((() => {
  const button = document.querySelector('.thread-composer-submit');
  if (!(button instanceof HTMLButtonElement) || button.disabled) return { clicked: false };
  button.click();
  return { clicked: true };
})())
'@
    $clickState = Invoke-BrowserEvalJson -Session $Session -Script $clickScript
    Assert-True ($clickState.clicked -eq $true) "new-thread feedback probe could not click the composer submit button"

    $metrics = $null
    $escapedProbe = $probeText.Replace('\', '\\').Replace("'", "\'")
    for ($attempt = 1; $attempt -le 12; $attempt++) {
      $readScript = @"
JSON.stringify((() => {
  const rows = window.__cxCodexChatFeedbackMetrics ?? [];
  const metric = rows.length > 0 ? rows[rows.length - 1] : null;
  const summary = window.__cxCodexChatFeedbackSummary ?? null;
  const storedRaw = window.localStorage.getItem('codex-web-local.chat-feedback-metrics.v1') || '';
  let storedMetricCount = 0;
  try {
    const stored = JSON.parse(storedRaw || '{}');
    storedMetricCount = Array.isArray(stored.metrics) ? stored.metrics.length : 0;
  } catch {}
  const preview = document.querySelector('[data-testid="pending-new-thread-preview"]');
  const promptCount = Array.from(document.querySelectorAll('.conversation-item[data-message-id]'))
    .filter((item) => item.textContent?.includes('$escapedProbe'))
    .length;
  return {
    metric,
    summary,
    storedMetricCount,
    storageContainsPrompt: storedRaw.includes('$escapedProbe'),
    previewVisible: Boolean(preview),
    promptCount,
    composerDisabled: document.querySelector('.thread-composer-input')?.disabled === true
  };
})())
"@
      $metrics = Invoke-BrowserEvalJson -Session $Session -Script $readScript
      if (
        $null -ne $metrics.metric -and
        $null -ne $metrics.metric.bubbleVisibleLatencyMs -and
        $null -ne $metrics.metric.runningVisibleLatencyMs
      ) {
        break
      }
      Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '50') | Out-Null
    }

    Assert-True ($null -ne $metrics.metric) "new-thread feedback page metric was not recorded"
    Assert-True ($metrics.previewVisible -eq $true) "new-thread feedback did not replace the empty home state"
    Assert-True ([int]$metrics.promptCount -eq 1) "new-thread feedback did not render exactly one provisional bubble"
    Assert-True ($metrics.composerDisabled -eq $true) "new-thread feedback did not guard against duplicate submit"
    Assert-True ([int]$metrics.metric.stateCommitLatencyMs -le 50) "new-thread feedback state commit exceeded 50 ms"
    Assert-True ([int]$metrics.metric.bubbleVisibleLatencyMs -le 200) "new-thread feedback bubble exceeded 200 ms"
    Assert-True ([int]$metrics.metric.runningVisibleLatencyMs -le 200) "new-thread feedback running indicator exceeded 200 ms"
    Assert-True ([int]$metrics.storedMetricCount -eq 1) "new-thread feedback metric was not persisted"
    Assert-True ([int]$metrics.summary.sampleCount -eq 1) "new-thread feedback summary did not include the isolated sample"
    Assert-True ([int]$metrics.summary.stages.stateCommit.p50Ms -eq [int]$metrics.metric.stateCommitLatencyMs) "new-thread feedback state-commit P50 did not match the isolated sample"
    Assert-True ([int]$metrics.summary.stages.stateCommit.p95Ms -eq [int]$metrics.metric.stateCommitLatencyMs) "new-thread feedback state-commit P95 did not match the isolated sample"
    Assert-True ([int]$metrics.summary.stages.bubbleVisible.p50Ms -eq [int]$metrics.metric.bubbleVisibleLatencyMs) "new-thread feedback bubble P50 did not match the isolated sample"
    Assert-True ([int]$metrics.summary.stages.bubbleVisible.p95Ms -eq [int]$metrics.metric.bubbleVisibleLatencyMs) "new-thread feedback bubble P95 did not match the isolated sample"
    Assert-True ($metrics.storageContainsPrompt -eq $false) "new-thread feedback diagnostics persisted prompt content"
    Write-Step ("new-thread feedback timing -> " + (@{
      stateCommitMs = [int]$metrics.metric.stateCommitLatencyMs
      bubbleVisibleMs = [int]$metrics.metric.bubbleVisibleLatencyMs
      runningVisibleMs = [int]$metrics.metric.runningVisibleLatencyMs
    } | ConvertTo-Json -Compress))
    Save-RegressionScreenshot -Session $Session -Name 'new-thread-feedback-budget-phone' | Out-Null

    $waitingState = $null
    $waitingScript = @"
JSON.stringify((() => {
  const item = Array.from(document.querySelectorAll('.conversation-item[data-message-id]'))
    .find((row) => row.textContent?.includes('$escapedProbe'));
  const delivery = item?.querySelector('.message-delivery-state');
  let outboxState = '';
  try {
    outboxState = JSON.parse(window.localStorage.getItem('codex-web-local.message-outbox.v1') || '{}')?.entries?.[0]?.state || '';
  } catch {}
  return {
    messageId: item?.getAttribute('data-message-id') || '',
    deliveryState: delivery?.getAttribute('data-state') || '',
    retryButtonCount: Array.from(item?.querySelectorAll('.message-delivery-retry') || [])
      .filter((button) => button.textContent?.trim() === '重试').length,
    editButtonCount: Array.from(item?.querySelectorAll('.message-delivery-retry') || [])
      .filter((button) => button.textContent?.trim() === '编辑').length,
    runningCount: document.querySelectorAll('.live-overlay-inline').length,
    outboxState,
    promptCount: Array.from(document.querySelectorAll('.conversation-item[data-message-id]'))
      .filter((row) => row.textContent?.includes('$escapedProbe')).length
  };
})())
"@
    for ($attempt = 1; $attempt -le 60; $attempt++) {
      $waitingState = Invoke-BrowserEvalJson -Session $Session -Script $waitingScript
      if (
        [string]$waitingState.deliveryState -eq 'waiting' -and
        [string]$waitingState.outboxState -eq 'waiting'
      ) { break }
      Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '250') | Out-Null
    }
    Assert-True ([string]$waitingState.deliveryState -eq 'waiting') "threadless transport loss did not keep the original bubble waiting for recovery"
    Assert-True ([string]$waitingState.outboxState -eq 'waiting') "threadless transport loss was removed from the durable outbox"
    Assert-True ([int]$waitingState.retryButtonCount -eq 0) "retryable transport loss was incorrectly presented as a definitive retry action"
    Assert-True ([int]$waitingState.editButtonCount -eq 0) "retryable transport loss was incorrectly presented as a definitive edit action"
    Assert-True ([int]$waitingState.runningCount -eq 0) "threadless waiting state left a false running indicator"
    Assert-True ([int]$waitingState.promptCount -eq 1) "threadless waiting state duplicated or removed the original bubble"
    Save-RegressionScreenshot -Session $Session -Name 'new-thread-offline-waiting-phone' | Out-Null

    $metricClientMessageId = [string]$metrics.metric.clientMessageId
    $safeReloadScript = @'
JSON.stringify((() => {
  window.localStorage.removeItem('codex-web-local.message-outbox.v1');
  window.localStorage.removeItem('codex-web-local.thread-draft.v1.__new-thread__');
  return { clearedOutbox: true };
})())
'@
    Invoke-BrowserEvalJson -Session $Session -Script $safeReloadScript | Out-Null
    Invoke-AgentBrowser -Arguments @('--session', $Session, 'set', 'offline', 'off') | Out-Null
    Invoke-AgentBrowser -Arguments @('--session', $Session, 'reload') | Out-Null
    Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '--load', 'networkidle') | Out-Null

    $restoredMetrics = $null
    for ($attempt = 1; $attempt -le 20; $attempt++) {
      $restoredScript = @"
JSON.stringify((() => {
  const rows = window.__cxCodexChatFeedbackMetrics ?? [];
  const metric = rows.find((row) => row.clientMessageId === '$metricClientMessageId') ?? null;
  const summary = window.__cxCodexChatFeedbackSummary ?? null;
  const storedRaw = window.localStorage.getItem('codex-web-local.chat-feedback-metrics.v1') || '';
  return {
    metric,
    summary,
    storageContainsPrompt: storedRaw.includes('$escapedProbe')
  };
})())
"@
      $restoredMetrics = Invoke-BrowserEvalJson -Session $Session -Script $restoredScript
      if ($null -ne $restoredMetrics.metric -and [int]$restoredMetrics.summary.sampleCount -eq 1) { break }
      Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '100') | Out-Null
    }
    Assert-True ($null -ne $restoredMetrics.metric) "chat feedback metric did not survive a full page reload"
    Assert-True ([int]$restoredMetrics.summary.sampleCount -eq 1) "chat feedback summary did not rehydrate after a full page reload"
    Assert-True ([int]$restoredMetrics.summary.stages.runningVisible.p95Ms -eq [int]$metrics.metric.runningVisibleLatencyMs) "rehydrated running-feedback P95 changed after reload"
    Assert-True ($restoredMetrics.storageContainsPrompt -eq $false) "rehydrated diagnostics persisted prompt content"
    Write-Step ("new-thread waiting + persisted feedback summary -> " + (@{
      deliveryState = [string]$waitingState.deliveryState
      sampleCount = [int]$restoredMetrics.summary.sampleCount
      bubbleP50Ms = [int]$restoredMetrics.summary.stages.bubbleVisible.p50Ms
      bubbleP95Ms = [int]$restoredMetrics.summary.stages.bubbleVisible.p95Ms
    } | ConvertTo-Json -Compress))
  } finally {
    try { Invoke-AgentBrowser -Arguments @('--session', $Session, 'set', 'offline', 'off') | Out-Null } catch {}
    try {
      $cleanupScript = @'
JSON.stringify((() => {
  window.localStorage.removeItem('codex-web-local.message-outbox.v1');
  window.localStorage.removeItem('codex-web-local.thread-draft.v1.__new-thread__');
  window.localStorage.removeItem('codex-web-local.chat-feedback-metrics.v1');
  delete window.__cxCodexChatFeedbackMetrics;
  delete window.__cxCodexChatFeedbackSummary;
  return { cleared: true };
})())
'@
      Invoke-BrowserEvalJson -Session $Session -Script $cleanupScript | Out-Null
      Invoke-AgentBrowser -Arguments @('--session', $Session, 'reload') | Out-Null
      Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '--load', 'networkidle') | Out-Null
    } catch {}
  }
}

function Measure-NewThreadAuthoritativeHandoff {
  param(
    [string]$Session,
    [string]$BaseUrl
  )

  $probeText = "请只回复：7420-new-thread-handoff-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
  $prepareScript = @'
JSON.stringify((() => {
  window.localStorage.removeItem('codex-web-local.message-outbox.v1');
  window.localStorage.removeItem('codex-web-local.chat-feedback-metrics.v1');
  delete window.__cxCodexChatFeedbackMetrics;
  delete window.__cxCodexChatFeedbackSummary;
  const originalFetch = window.fetch.bind(window);
  window.__cxCodexHandoffStartedAt = performance.now();
  window.__cxCodexHandoffServerAccepted = false;
  window.__cxCodexHandoffAcceptedLatencyMs = 0;
  window.__cxCodexHandoffAcceptedHttpStatus = 0;
  window.__cxCodexHandoffSawConfirmingPreview = false;
  delete window.__cxCodexHandoffRouteLatencyMs;
  window.fetch = (input, init) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof Request
        ? input.url
        : String(input);
    if (url.includes('/codex-api/runtime/send')) {
      return originalFetch(input, init).then((response) => {
        window.__cxCodexHandoffServerAccepted = response.ok;
        window.__cxCodexHandoffAcceptedLatencyMs = Math.round(performance.now() - window.__cxCodexHandoffStartedAt);
        window.__cxCodexHandoffAcceptedHttpStatus = response.status;
        return new Promise((_, reject) => {
          window.setTimeout(() => reject(new TypeError('simulated lost runtime response')), 1200);
        });
      });
    }
    return originalFetch(input, init);
  };
  return { prepared: true };
})())
'@
  Invoke-BrowserEvalJson -Session $Session -Script $prepareScript | Out-Null
  Invoke-AgentBrowser -Arguments @('--session', $Session, 'fill', '.thread-composer-input', $probeText) | Out-Null
  $clickScript = @'
JSON.stringify((() => {
  const button = document.querySelector('.thread-composer-submit');
  if (!(button instanceof HTMLButtonElement) || button.disabled) return { clicked: false };
  window.__cxCodexHandoffStartedAt = performance.now();
  button.click();
  return { clicked: true };
})())
'@
  $clickState = Invoke-BrowserEvalJson -Session $Session -Script $clickScript
  Assert-True ($clickState.clicked -eq $true) "new-thread handoff probe could not click submit"

  $handoff = $null
  $escapedProbe = $probeText.Replace('\', '\\').Replace("'", "\'")
  for ($attempt = 1; $attempt -le 100; $attempt++) {
    $readScript = @"
JSON.stringify((() => {
  const match = window.location.hash.match(/\/thread\/([^/?#]+)/);
  const threadId = match?.[1] ? decodeURIComponent(match[1]) : '';
  const items = Array.from(document.querySelectorAll('.conversation-item[data-message-id]'))
    .filter((item) => item.textContent?.includes('$escapedProbe'));
  const delivery = items[0]?.querySelector('.message-delivery-state');
  const metricRows = window.__cxCodexChatFeedbackMetrics ?? [];
  const metric = metricRows.length > 0 ? metricRows[metricRows.length - 1] : null;
  const currentRouteLatencyMs = Math.round(performance.now() - (window.__cxCodexHandoffStartedAt || performance.now()));
  if (threadId && !Number.isFinite(window.__cxCodexHandoffRouteLatencyMs)) {
    window.__cxCodexHandoffRouteLatencyMs = currentRouteLatencyMs;
  }
  const previewCount = document.querySelectorAll('[data-testid="pending-new-thread-preview"]').length;
  const deliveryState = delivery?.getAttribute('data-state') || '';
  if (!threadId && previewCount === 1 && deliveryState === 'confirming') {
    window.__cxCodexHandoffSawConfirmingPreview = true;
  }
  return {
    threadId,
    routeLatencyMs: Number.isFinite(window.__cxCodexHandoffRouteLatencyMs)
      ? window.__cxCodexHandoffRouteLatencyMs
      : currentRouteLatencyMs,
    promptCount: items.length,
    deliveryState,
    runningCount: document.querySelectorAll('.live-overlay-inline').length,
    previewCount,
    serverAccepted: window.__cxCodexHandoffServerAccepted === true,
    acceptedLatencyMs: window.__cxCodexHandoffAcceptedLatencyMs || 0,
    acceptedHttpStatus: window.__cxCodexHandoffAcceptedHttpStatus || 0,
    sawConfirmingPreview: window.__cxCodexHandoffSawConfirmingPreview === true,
    metric
  };
})())
"@
    $handoff = Invoke-BrowserEvalJson -Session $Session -Script $readScript
    if (
      -not [string]::IsNullOrWhiteSpace([string]$handoff.threadId) -and
      [int]$handoff.promptCount -eq 1 -and
      [string]$handoff.deliveryState -in @('sending', 'retrying', 'confirming', 'sent') -and
      [int]$handoff.metric.serverAcknowledgedLatencyMs -gt 0 -and
      [int]$handoff.metric.turnStartedLatencyMs -gt 0
    ) { break }
    Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '100') | Out-Null
  }

  $threadId = [string]$handoff.threadId
  try {
    Assert-True (-not [string]::IsNullOrWhiteSpace($threadId)) "new-thread handoff did not enter the authoritative thread"
    Assert-True ($handoff.serverAccepted -eq $true) "new-thread handoff did not simulate a lost response after server acceptance"
    Assert-True ([int]$handoff.acceptedHttpStatus -eq 202) "new-thread handoff was not durably accepted with HTTP 202"
    Assert-True ([int]$handoff.acceptedLatencyMs -gt 0 -and [int]$handoff.acceptedLatencyMs -le 750) "new-thread durable acceptance exceeded the 750 ms browser budget"
    Assert-True ($handoff.sawConfirmingPreview -eq $true) "new-thread handoff did not show a confirming provisional bubble before thread binding"
    Assert-True ([int]$handoff.promptCount -eq 1) "new-thread handoff did not preserve exactly one message bubble"
    Assert-True ([string]$handoff.deliveryState -in @('sending', 'retrying', 'confirming', 'sent')) "new-thread handoff treated a lost accepted response as a definitive failure"
    Assert-True ([int]$handoff.runningCount -ge 1) "new-thread handoff lost the running timeline"
    Assert-True ([int]$handoff.previewCount -eq 0) "new-thread handoff left the provisional home surface mounted"
    Assert-True ([string]$handoff.metric.threadId -eq $threadId) "new-thread handoff metric was not rebound to the authoritative thread"
    Assert-True ([int]$handoff.metric.serverAcknowledgedLatencyMs -gt 0) "new-thread handoff did not retain product-side server acknowledgement timing"
    Assert-True ([int]$handoff.metric.turnStartedLatencyMs -gt 0) "new-thread handoff did not retain product-side turn-start timing"
    Write-Step ("new-thread authoritative handoff -> " + (@{
      threadId = $threadId
      acceptedLatencyMs = [int]$handoff.acceptedLatencyMs
      acceptedHttpStatus = [int]$handoff.acceptedHttpStatus
      routeLatencyMs = [int]$handoff.routeLatencyMs
      serverAcknowledgedLatencyMs = [int]$handoff.metric.serverAcknowledgedLatencyMs
      turnStartedLatencyMs = [int]$handoff.metric.turnStartedLatencyMs
      deliveryState = [string]$handoff.deliveryState
      sawConfirmingPreview = $true
      recoveredAfterLostResponse = $true
    } | ConvertTo-Json -Compress))
    Save-RegressionScreenshot -Session $Session -Name 'new-thread-authoritative-handoff-phone' | Out-Null
  } finally {
    try {
      $cleanupScript = @'
JSON.stringify((() => {
  window.localStorage.removeItem('codex-web-local.message-outbox.v1');
  window.localStorage.removeItem('codex-web-local.chat-feedback-metrics.v1');
  delete window.__cxCodexChatFeedbackMetrics;
  delete window.__cxCodexChatFeedbackSummary;
  return { cleared: true };
})())
'@
      Invoke-BrowserEvalJson -Session $Session -Script $cleanupScript | Out-Null
    } catch {}
    if (-not [string]::IsNullOrWhiteSpace($threadId)) {
      try {
        Invoke-PostJson -Name 'archive new-thread handoff probe' -Url "$($BaseUrl)/codex-api/rpc" -Payload @{
          method = 'thread/archive'
          params = @{ threadId = $threadId }
        } | Out-Null
      } catch {}
    }
    try {
      Open-And-ReadPage -Session $Session -Url "$($BaseUrl)/#/" -Width 393 -Height 852 | Out-Null
    } catch {}
  }
}

function Measure-ThreadResponseFeedbackBudget {
  param(
    [string]$Session,
    [string]$ThreadId
  )

  $probeText = "请只回复：7420-ACK-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
  $escapedProbe = $probeText.Replace('\', '\\').Replace("'", "\'")
  $prepareScript = @'
JSON.stringify((() => {
  window.localStorage.removeItem('codex-web-local.chat-feedback-metrics.v1');
  delete window.__cxCodexChatFeedbackMetrics;
  delete window.__cxCodexChatFeedbackSummary;
  return { prepared: true };
})())
'@
  Invoke-BrowserEvalJson -Session $Session -Script $prepareScript | Out-Null
  Invoke-AgentBrowser -Arguments @('--session', $Session, 'fill', '.thread-composer-input', $probeText) | Out-Null
  $clickScript = @'
JSON.stringify((() => {
  const button = document.querySelector('.thread-composer-submit');
  if (!(button instanceof HTMLButtonElement) || button.disabled) return { clicked: false };
  button.click();
  return { clicked: true };
})())
'@
  $clickState = Invoke-BrowserEvalJson -Session $Session -Script $clickScript
  Assert-True ($clickState.clicked -eq $true) "response feedback probe could not click the composer submit button"

  $metrics = $null
  for ($attempt = 1; $attempt -le 240; $attempt++) {
    $readScript = @"
JSON.stringify((() => {
  const rows = window.__cxCodexChatFeedbackMetrics ?? [];
  const metric = rows.length > 0 ? rows[rows.length - 1] : null;
  const promptCount = Array.from(document.querySelectorAll('.conversation-item[data-message-id]'))
    .filter((item) => item.textContent?.includes('$escapedProbe'))
    .length;
  return { metric, promptCount };
})())
"@
    $metrics = Invoke-BrowserEvalJson -Session $Session -Script $readScript
    if ($null -ne $metrics.metric.firstAssistantVisibleLatencyMs) {
      break
    }
    Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '250') | Out-Null
  }

  Assert-True ($null -ne $metrics.metric) "response feedback page metric was not recorded"
  Assert-True ([int]$metrics.promptCount -eq 1) "response feedback probe did not render exactly one user bubble"
  Assert-True ($null -ne $metrics.metric.serverAcknowledgedLatencyMs) "server acknowledgement was not observed"
  Assert-True ($null -ne $metrics.metric.firstAssistantDataLatencyMs) "first assistant data was not observed"
  Assert-True ($null -ne $metrics.metric.firstAssistantVisibleLatencyMs) "first assistant response was not visibly rendered"
  $renderOverheadMs = [int]$metrics.metric.firstAssistantVisibleLatencyMs - [int]$metrics.metric.firstAssistantDataLatencyMs
  Write-Step ("response feedback timing -> " + (@{
    threadId = $ThreadId
    requestDispatchedMs = [int]$metrics.metric.requestDispatchedLatencyMs
    serverAcknowledgedMs = [int]$metrics.metric.serverAcknowledgedLatencyMs
    turnStartedMs = [int]$metrics.metric.turnStartedLatencyMs
    firstAssistantDataMs = [int]$metrics.metric.firstAssistantDataLatencyMs
    firstAssistantVisibleMs = [int]$metrics.metric.firstAssistantVisibleLatencyMs
    renderOverheadMs = $renderOverheadMs
  } | ConvertTo-Json -Compress))
  Assert-True ([int]$metrics.metric.requestDispatchedLatencyMs -le 500) "runtime request dispatch exceeded 500 ms"
  Assert-True ([int]$metrics.metric.serverAcknowledgedLatencyMs -le 5000) "server acknowledgement exceeded 5000 ms"
  Assert-True ([int]$metrics.metric.firstAssistantDataLatencyMs -le 45000) "first assistant data exceeded 45000 ms"
  Assert-True ($renderOverheadMs -le 250) "first assistant render overhead exceeded 250 ms"
  Save-RegressionScreenshot -Session $Session -Name 'response-feedback-budget-phone' | Out-Null
}

function Reset-AppShellLayoutPreferences {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  window.localStorage.setItem('codex-web-local.sidebar-collapsed.v1', '0');
  window.localStorage.removeItem('codex-web-local.sidebar-width.v1');
  window.localStorage.removeItem('codex-web-local.collapsed-projects.v1');
  window.localStorage.setItem('codex-web-local.thread-view-mode.v1', 'project');
  return { reset: true };
})())
'@
  Invoke-BrowserEvalJson -Session $Session -Script $script | Out-Null
}

function Set-SidebarCollapsedPreference {
  param(
    [string]$Session,
    [bool]$Collapsed
  )

  $collapsedValue = if ($Collapsed) { "1" } else { "0" }
  $script = @"
JSON.stringify((() => {
  window.localStorage.setItem('codex-web-local.sidebar-collapsed.v1', '$collapsedValue');
  return { collapsed: '$collapsedValue' };
})())
"@
  Invoke-BrowserEvalJson -Session $Session -Script $script | Out-Null
}

function Seed-PersistentOutboxDraftRecoveryProbe {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const now = Date.now();
  window.localStorage.removeItem('codex-web-local.thread-draft.v1.__new-thread__');
  window.localStorage.setItem('codex-web-local.message-outbox.v1', JSON.stringify({
    version: 1,
    entries: [{
      clientMessageId: `regression-outbox-${now}`,
      threadId: '',
      cwd: 'E:/regression-outbox-project',
      text: '刷新后仍然保留的待发送消息',
      imageUrls: [],
      skills: [],
      fileAttachments: [],
      modelId: '',
      reasoningEffort: 'medium',
      collaborationMode: 'execute',
      state: 'failed',
      createdAtMs: now,
      updatedAtMs: now
    }]
  }));
  return { seeded: true };
})())
'@
  Invoke-BrowserEvalJson -Session $Session -Script $script | Out-Null
}

function Read-PersistentOutboxDraftRecoveryMetrics {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const input = document.querySelector('.thread-composer-input');
  const persistedDraftRaw = window.localStorage.getItem('codex-web-local.thread-draft.v1.__new-thread__');
  let persistedDraftText = '';
  try {
    persistedDraftText = JSON.parse(persistedDraftRaw || '{}')?.text || '';
  } catch {}
  let outboxState = '';
  try {
    outboxState = JSON.parse(window.localStorage.getItem('codex-web-local.message-outbox.v1') || '{}')?.entries?.[0]?.state || '';
  } catch {}
  const preview = document.querySelector('[data-testid="pending-new-thread-preview"]');
  const failedMessage = preview?.querySelector('.message-delivery-state[data-state="failed"]');
  return {
    inputValue: input instanceof HTMLTextAreaElement ? input.value : '',
    outboxPresent: window.localStorage.getItem('codex-web-local.message-outbox.v1') !== null,
    outboxState,
    persistedDraftText,
    previewVisible: Boolean(preview),
    failedMessageCount: failedMessage ? 1 : 0,
    retryButtonCount: Array.from(preview?.querySelectorAll('.message-delivery-retry') || [])
      .filter((button) => button.textContent?.trim() === '重试').length,
    editButtonCount: Array.from(preview?.querySelectorAll('.message-delivery-retry') || [])
      .filter((button) => button.textContent?.trim() === '编辑').length,
    previewText: preview?.textContent || ''
  };
})())
'@
  return Invoke-BrowserEvalJson -Session $Session -Script $script
}

function Assert-PersistentOutboxDraftRecovery {
  param([string]$Session)

  $metrics = $null
  for ($attempt = 1; $attempt -le 8; $attempt++) {
    $metrics = Read-PersistentOutboxDraftRecoveryMetrics -Session $Session
    if ($metrics.previewVisible -eq $true -and [int]$metrics.failedMessageCount -eq 1) {
      break
    }
    Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '350') | Out-Null
  }
  Assert-True ($metrics.previewVisible -eq $true) "persistent outbox did not restore the new-thread conversation preview"
  Assert-True ([string]$metrics.previewText -like '*刷新后仍然保留的待发送消息*') "persistent outbox preview lost the original message"
  Assert-True ([int]$metrics.failedMessageCount -eq 1) "persistent outbox did not restore an actionable failed delivery state"
  Assert-True ([int]$metrics.retryButtonCount -eq 1) "persistent outbox did not restore the retry action"
  Assert-True ([int]$metrics.editButtonCount -eq 1) "persistent outbox did not restore the edit action"
  Assert-True ([bool]$metrics.outboxPresent) "persistent outbox was removed before the user retried or discarded the message"
  Assert-True ([string]$metrics.outboxState -eq 'failed') "persistent outbox did not converge to failed state"
  Assert-True ([string]$metrics.inputValue -eq '') "persistent outbox duplicated the failed message into the composer"
}

function Clear-PersistentOutboxDraftRecoveryProbe {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  window.localStorage.removeItem('codex-web-local.message-outbox.v1');
  window.localStorage.removeItem('codex-web-local.thread-draft.v1.__new-thread__');
  return { cleared: true };
})())
'@
  Invoke-BrowserEvalJson -Session $Session -Script $script | Out-Null
}

function Dispatch-MobileResumeOutboxRecoveryProbe {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const input = document.querySelector('.thread-composer-input');
  if (input instanceof HTMLTextAreaElement) {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const now = Date.now();
  window.localStorage.removeItem('codex-web-local.thread-draft.v1.__new-thread__');
  window.localStorage.setItem('codex-web-local.message-outbox.v1', JSON.stringify({
    version: 1,
    entries: [{
      clientMessageId: `regression-mobile-resume-${now}`,
      threadId: '',
      cwd: 'E:/regression-mobile-resume-project',
      text: '回到前台自动恢复的待发送消息',
      imageUrls: [],
      skills: [],
      fileAttachments: [],
      modelId: '',
      reasoningEffort: 'medium',
      collaborationMode: 'execute',
      state: 'confirming',
      createdAtMs: now,
      updatedAtMs: now
    }]
  }));
  window.dispatchEvent(new Event('codex-mobile-resume'));
  return { dispatched: true };
})())
'@
  Invoke-BrowserEvalJson -Session $Session -Script $script | Out-Null
}

function Assert-MobileResumeOutboxRecovery {
  param([string]$Session)

  $metrics = $null
  for ($attempt = 1; $attempt -le 10; $attempt++) {
    $metrics = Read-PersistentOutboxDraftRecoveryMetrics -Session $Session
    if ($metrics.previewVisible -eq $true -and [string]$metrics.previewText -like '*回到前台自动恢复的待发送消息*') {
      break
    }
    Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '300') | Out-Null
  }
  Assert-True ($metrics.previewVisible -eq $true) "mobile resume did not restore the durable message bubble"
  Assert-True ([string]$metrics.previewText -like '*回到前台自动恢复的待发送消息*') "mobile resume lost the durable message content"
  Assert-True ([int]$metrics.failedMessageCount -eq 1) "mobile resume did not make the unresolved message retryable"
  Assert-True ([int]$metrics.retryButtonCount -eq 1) "mobile resume did not restore the retry control"
  Assert-True ([int]$metrics.editButtonCount -eq 1) "mobile resume did not restore the edit control"
  Assert-True ([bool]$metrics.outboxPresent) "mobile resume removed the durable message before user action"
  Assert-True ([string]$metrics.outboxState -eq 'failed') "mobile resume outbox did not converge to failed state"
}

function Close-SettingsPanelIfOpen {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const panel = document.querySelector('.sidebar-settings-panel');
  if (!panel) return { hadPanel: false, closed: false };
  const button = document.querySelector('.sidebar-settings-button[aria-expanded]');
  if (button instanceof HTMLElement) {
    button.click();
    return { hadPanel: true, closed: true };
  }
  return { hadPanel: true, closed: false };
})())
'@
  Invoke-BrowserEvalJson -Session $Session -Script $script | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "200") | Out-Null
}

function Test-HttpJson {
  param(
    [string]$Name,
    [string]$Url
  )

  Write-Step "checking $Name -> $Url"
  $lastError = $null
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 25
      Assert-True ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) "$Name returned HTTP $($response.StatusCode)"
      return ($response.Content | ConvertFrom-Json)
    } catch {
      $lastError = $_
      Write-Step "$Name request failed (attempt $attempt/3): $($_.Exception.Message)"
      Start-Sleep -Milliseconds 900
    }
  }
  throw $lastError
}

function Invoke-PostJson {
  param(
    [string]$Name,
    [string]$Url,
    [object]$Payload
  )

  Write-Step "posting $Name -> $Url"
  $lastError = $null
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
      $response = Invoke-WebRequest `
        -Uri $Url `
        -UseBasicParsing `
        -Method Post `
        -ContentType "application/json" `
        -Body ($Payload | ConvertTo-Json -Depth 12 -Compress) `
        -TimeoutSec 35
      Assert-True ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) "$Name returned HTTP $($response.StatusCode)"
      return ($response.Content | ConvertFrom-Json)
    } catch {
      $lastError = $_
      Write-Step "$Name request failed (attempt $attempt/3): $($_.Exception.Message)"
      Start-Sleep -Milliseconds 900
    }
  }
  throw $lastError
}

function Get-WorkspaceProjectName {
  param([string]$Path)

  $normalized = ([string]$Path).Trim().TrimEnd("\", "/")
  if ([string]::IsNullOrWhiteSpace($normalized)) {
    return ""
  }

  $parts = @($normalized -split '[\\/]+' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  if ($parts.Count -eq 0) {
    return $normalized
  }
  return [string]$parts[$parts.Count - 1]
}

function Get-ThreadDisplayTitle {
  param([object]$Thread)

  foreach ($propertyName in @("title", "name", "thread_name")) {
    $value = [string]$Thread.$propertyName
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      return $value.Trim()
    }
  }
  return ""
}

function Resolve-RequiredSidebarThread {
  param(
    [string]$BaseUrl,
    [string]$Title
  )

  if ([string]::IsNullOrWhiteSpace($Title)) {
    return $null
  }

  $search = Invoke-PostJson `
    -Name "required thread search '$Title'" `
    -Url "$($BaseUrl)/codex-api/thread-search" `
    -Payload @{ query = $Title; limit = 20 }
  $threadIds = @($search.data.threadIds | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
  Assert-True ($threadIds.Count -gt 0) "required thread title was not found in Desktop/session search index: $Title"

  foreach ($threadId in $threadIds) {
    try {
      $read = Invoke-PostJson `
        -Name "thread/read $threadId" `
        -Url "$($BaseUrl)/codex-api/rpc" `
        -Payload @{ method = "thread/read"; params = @{ threadId = [string]$threadId; includeTurns = $false } }
      $thread = $read.result.thread
      if ($null -eq $thread) {
        continue
      }
      $threadTitle = Get-ThreadDisplayTitle -Thread $thread
      if ($threadTitle -eq $Title -or $threadTitle.Contains($Title)) {
        return [pscustomobject]@{
          id = [string]$thread.id
          title = $threadTitle
          cwd = [string]$thread.cwd
          projectName = Get-WorkspaceProjectName -Path ([string]$thread.cwd)
        }
      }
    } catch {
      Write-Step "candidate required thread $threadId was not readable: $($_.Exception.Message)"
    }
  }

  throw "required thread title was found by search but no readable matching thread was returned: $Title"
}

function Read-HomeWorkspaceProjectMetrics {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const groups = Array.from(document.querySelectorAll('.project-group')).map((node) => ({
    projectName: node.getAttribute('data-project-name') || '',
    pinnedProject: node.getAttribute('data-pinned-project') === 'true',
    text: (node.textContent || '').replace(/\s+/g, ' ').trim(),
    threadRowCount: node.querySelectorAll('.thread-row').length,
    newThreadButtonCount: node.querySelectorAll('.thread-start-button').length
  }));
  const readyMetric = window.__cxCodexHomeWorkspaceProjectsReady ?? null;
  return {
    groupCount: groups.length,
    groups,
    pageObservedAtMs: Math.round(performance.now()),
    pageReadyAtMs: Number.isFinite(readyMetric?.readyAtMs) ? readyMetric.readyAtMs : null,
    pageReadyGroupCount: Number.isFinite(readyMetric?.groupCount) ? readyMetric.groupCount : 0
  };
})())
'@
  return Invoke-BrowserEvalJson -Session $Session -Script $script
}

function Get-WorkspaceRootSample {
  param([object]$RootsState)

  $workspaceRoots = @()
  foreach ($rootPath in @($RootsState.data.pinnedProjectIds) + @($RootsState.data.projectOrder) + @($RootsState.data.order)) {
    $normalizedRootPath = [string]$rootPath
    if ([string]::IsNullOrWhiteSpace($normalizedRootPath)) {
      continue
    }
    if ($workspaceRoots -notcontains $normalizedRootPath) {
      $workspaceRoots += $normalizedRootPath
    }
  }
  return @($workspaceRoots | Select-Object -First ([Math]::Min(3, $workspaceRoots.Count)))
}

function Wait-HomeWorkspaceProjectMetrics {
  param(
    [string]$Session,
    [object]$RootsState,
    [long]$NavigationStartedAtMs,
    [int]$TimeoutMs = $HomeWorkspaceProjectsPollingTimeoutMs
  )

  $expectedGroupCount = @(Get-WorkspaceRootSample -RootsState $RootsState).Count
  $metrics = $null
  do {
    $metrics = Read-HomeWorkspaceProjectMetrics -Session $Session
    $elapsedMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $NavigationStartedAtMs
    if ([int]$metrics.groupCount -ge $expectedGroupCount -or $elapsedMs -ge $TimeoutMs) {
      break
    }
    Start-Sleep -Milliseconds 250
  } while ($true)

  $browserObservedReadyMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $NavigationStartedAtMs
  $firstUsableMs = if (
    $null -ne $metrics.pageReadyAtMs `
      -and [int]$metrics.pageReadyAtMs -gt 0 `
      -and [int]$metrics.pageReadyGroupCount -ge $expectedGroupCount
  ) {
    [int]$metrics.pageReadyAtMs
  } else {
    [int]$metrics.pageObservedAtMs
  }
  $metrics | Add-Member -NotePropertyName "workspaceProjectsFirstUsableMs" -NotePropertyValue $firstUsableMs -Force
  $metrics | Add-Member -NotePropertyName "workspaceProjectsFirstUsableBudgetMs" -NotePropertyValue $HomeWorkspaceProjectsFirstUsableBudgetMs -Force
  $metrics | Add-Member -NotePropertyName "workspaceProjectsFirstUsableWithinBudget" -NotePropertyValue ($firstUsableMs -le $HomeWorkspaceProjectsFirstUsableBudgetMs) -Force
  $metrics | Add-Member -NotePropertyName "browserObservedWorkspaceProjectsReadyMs" -NotePropertyValue $browserObservedReadyMs -Force
  Write-Step "home workspace projects ready: product=$firstUsableMs ms, browser-observed=$browserObservedReadyMs ms ($($metrics.groupCount)/$expectedGroupCount groups)"
  return $metrics
}

function Read-RequiredSidebarThreadMetrics {
  param(
    [string]$Session,
    [object]$Thread,
    [string]$RootSelector = ""
  )

  $payload = @{
    threadId = [string]$Thread.id
    projectName = [string]$Thread.projectName
    rootSelector = [string]$RootSelector
  } | ConvertTo-Json -Depth 5 -Compress
  $script = @"
JSON.stringify((() => {
  const target = $payload;
  const root = target.rootSelector ? document.querySelector(target.rootSelector) : document;
  if (!root) return { hasRoot: false, rowCount: 0, groupCount: 0, hasThreadId: false, hasProjectGroup: false, targetRowText: '', targetGroupText: '' };
  const rows = Array.from(root.querySelectorAll('.thread-row'));
  const groups = Array.from(root.querySelectorAll('.project-group'));
  const targetRow = rows.find((row) => row.getAttribute('data-thread-id') === target.threadId) || null;
  const targetGroup = groups.find((group) => group.getAttribute('data-project-name') === target.projectName) || null;
  return {
    hasRoot: true,
    rowCount: rows.length,
    groupCount: groups.length,
    hasThreadId: !!targetRow,
    hasProjectGroup: !!targetGroup,
    targetRowText: (targetRow?.textContent || '').replace(/\s+/g, ' ').trim(),
    targetGroupText: (targetGroup?.textContent || '').replace(/\s+/g, ' ').trim()
  };
})())
"@
  return Invoke-BrowserEvalJson -Session $Session -Script $script
}

function Assert-RequiredSidebarThreadDom {
  param(
    [object]$Thread,
    [object]$Metrics,
    [string]$Context
  )

  if ($null -eq $Thread) {
    return
  }

  Assert-True ($Metrics.hasRoot -eq $true) "$Context sidebar root was not found while checking required thread"
  Assert-True ($Metrics.hasProjectGroup -eq $true) "$Context sidebar is missing required thread project group: $($Thread.projectName)"
  Assert-True ($Metrics.hasThreadId -eq $true) "$Context sidebar is missing Desktop/session thread '$($Thread.title)' ($($Thread.id))"
  Assert-True ([string]$Metrics.targetRowText -like "*$($Thread.title)*") "$Context sidebar row text does not include required thread title: $($Thread.title)"
}

function Assert-WorkspaceRootProjectParity {
  param(
    [object]$RootsState,
    [object]$Metrics
  )

  $pinnedRootSet = @{}
  foreach ($rootPath in @($RootsState.data.pinnedProjectIds)) {
    $normalizedPinnedRootPath = [string]$rootPath
    if (-not [string]::IsNullOrWhiteSpace($normalizedPinnedRootPath)) {
      $pinnedRootSet[$normalizedPinnedRootPath] = $true
    }
  }

  $expectedRoots = @(Get-WorkspaceRootSample -RootsState $RootsState)
  if ($expectedRoots.Count -eq 0) {
    return
  }

  $labelsByRoot = @{}
  foreach ($property in @($RootsState.data.labels.PSObject.Properties)) {
    $labelsByRoot[[string]$property.Name] = [string]$property.Value
  }

  Assert-True ($Metrics.workspaceProjectsFirstUsableWithinBudget -eq $true) "home sidebar workspace projects exceeded the $($Metrics.workspaceProjectsFirstUsableBudgetMs) ms product-side first-usable budget: $($Metrics.workspaceProjectsFirstUsableMs) ms"
  Assert-True ($Metrics.groupCount -ge $expectedRoots.Count) "home sidebar project group count is below workspace root count sample after $($Metrics.browserObservedWorkspaceProjectsReadyMs) browser-observed ms"

  for ($index = 0; $index -lt $expectedRoots.Count; $index++) {
    $rootPath = [string]$expectedRoots[$index]
    $expectedProjectName = Get-WorkspaceProjectName -Path $rootPath
    $expectedLabel = if ($labelsByRoot.ContainsKey($rootPath)) { $labelsByRoot[$rootPath] } else { $expectedProjectName }
    $group = @($Metrics.groups | Where-Object { [string]$_.projectName -eq $expectedProjectName } | Select-Object -First 1)

    Assert-True ($group.Count -eq 1) "home sidebar is missing workspace project $expectedProjectName from root $rootPath"
    $group = $group[0]
    Assert-True ([string]$group.text -like "*$expectedLabel*") "home sidebar project label drifted for $rootPath; expected label $expectedLabel"
    if ($pinnedRootSet.ContainsKey($rootPath)) {
      Assert-True ($group.pinnedProject -eq $true) "home sidebar pinned project $expectedProjectName is missing pinned marker"
    }
    Assert-True ([int]$group.newThreadButtonCount -eq 1) "home sidebar project $expectedProjectName is missing project-level new-thread action"
    if ([int]$group.threadRowCount -eq 0) {
      Assert-True ([string]$group.text -like "*暂无会话*") "home sidebar empty workspace project $expectedProjectName is missing empty-state text"
    }
  }

}

function Wait-CodexHealthIdle {
  param([string]$Url)

  $lastHealth = $null
  for ($attempt = 1; $attempt -le 8; $attempt++) {
    $lastHealth = Test-HttpJson -Name "codex health" -Url $Url
    $statusQueueOnly = Test-CodexHealthStatusQueueOnly -Health $lastHealth
    if (
      $lastHealth.status -eq "ok" `
      -and $lastHealth.data.appServer.pendingRpcCount -le 2 `
      -and ($lastHealth.data.appServer.queuedRpcCount -eq 0 -or $statusQueueOnly) `
      -and $lastHealth.data.appServer.pendingServerRequestCount -eq 0 `
      -and $lastHealth.data.appServer.activePlanModeTurnCount -eq 0 `
      -and $lastHealth.data.runtimeStore.uncertainRequestCount -eq 0
    ) {
      return $lastHealth
    }

    Write-Step "codex health not idle yet (attempt $attempt/8): pending=$($lastHealth.data.appServer.pendingRpcCount), queued=$($lastHealth.data.appServer.queuedRpcCount), serverRequests=$($lastHealth.data.appServer.pendingServerRequestCount), planTurns=$($lastHealth.data.appServer.activePlanModeTurnCount), uncertain=$($lastHealth.data.runtimeStore.uncertainRequestCount)"
    Start-Sleep -Milliseconds 900
  }

  return $lastHealth
}

function Test-CodexHealthStatusQueueOnly {
  param([object]$Health)

  $queued = [int]$Health.data.appServer.queuedRpcCount
  if ($queued -le 0) {
    return $true
  }
  if ($queued -gt 50) {
    return $false
  }
  if ([int]$Health.data.appServer.pendingServerRequestCount -ne 0) {
    return $false
  }
  if ([int]$Health.data.appServer.activePlanModeTurnCount -ne 0) {
    return $false
  }
  if ([int]$Health.data.runtimeStore.uncertainRequestCount -ne 0) {
    return $false
  }

  $recentSlowRpc = @($Health.data.appServer.rpcDiagnostics.recentSlowRpc)
  if ($recentSlowRpc.Count -lt 3) {
    return $false
  }

  $statusReadMethods = @("mcpServerStatus/list", "account/rateLimits/read")
  $nonStatusRecent = @($recentSlowRpc | Select-Object -First 6 | Where-Object { $statusReadMethods -notcontains $_.method })
  return $nonStatusRecent.Count -eq 0
}

function Assert-CodexHealthReadyForFrontendRegression {
  param([object]$Health)

  $statusQueueOnly = Test-CodexHealthStatusQueueOnly -Health $Health
  Assert-True ($Health.status -eq "ok") "codex health status is not ok"
  Assert-True (($Health.data.appServer.queuedRpcCount -eq 0) -or $statusQueueOnly) "queuedRpcCount is not zero and does not look like status polling backlog"
  Assert-True ($Health.data.appServer.pendingRpcCount -le 2) "pendingRpcCount is above the tolerated background status calls: $($Health.data.appServer.pendingRpcCount)"
  Assert-True ($Health.data.appServer.pendingServerRequestCount -eq 0) "pendingServerRequestCount is not zero"
  Assert-True ($Health.data.appServer.activePlanModeTurnCount -eq 0) "activePlanModeTurnCount is not zero"
  Assert-True ($Health.data.runtimeStore.uncertainRequestCount -eq 0) "uncertainRequestCount is not zero"
}

function Open-And-ReadPage {
  param(
    [string]$Session,
    [string]$Url,
    [int]$Width,
    [int]$Height
  )

  Write-Step "opening $Url at ${Width}x${Height}"
  Invoke-AgentBrowser -Arguments @("--session", $Session, "set", "viewport", "$Width", "$Height") | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "open", "about:blank") | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "200") | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "open", $Url) | Out-Null
  return Wait-And-ReadPage -Session $Session
}

function Wait-And-ReadPage {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const text = document.body.innerText.replace(/\s+/g, ' ').trim();
  const hasComposer = !!document.querySelector('textarea,[contenteditable=true],input[type=text],.thread-composer');
  const hasSkillsHub = !!document.querySelector('.skills-hub');
  const hasTrendingHub = !!document.querySelector('.trending-hub');
  const hasRuntimeBar = !!document.querySelector('.runtime-status-bar');
  const hasDiagnosticsPanel = !!document.querySelector('.diagnostics-panel');
  const hasMarkdownBody = !!document.querySelector('.markdown-body');
  const notificationRecovery = document.querySelector('.fixture-notification-recovery');
  return {
    url: location.href,
    text: text.includes('Runtime Store') ? 'Runtime Store' : '',
    textLength: text.length,
    hasInternalCodexContext: /<codex_internal_context\s+source=/i.test(text),
    hasInternalThreadReadError: /thread-store internal error|failed to read thread\s+[A-Za-z]:\\/i.test(text),
    hasBlankBody: text.length < 5 && !hasComposer && !hasSkillsHub && !hasTrendingHub && !hasRuntimeBar && !hasDiagnosticsPanel && !hasMarkdownBody,
    hasComposer,
    hasSkillsHub,
    hasTrendingHub,
    hasRuntimeBar,
    hasDiagnosticsPanel,
    hasMarkdownBody,
    hasCompletionNotificationRecovery: !!notificationRecovery
      && notificationRecovery.textContent.includes('任务完成通道已关闭')
      && notificationRecovery.textContent.includes('开启任务通知'),
    hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    viewport: { width: window.innerWidth, height: window.innerHeight }
  };
})())
'@
  $page = $null
  for ($attempt = 1; $attempt -le 7; $attempt++) {
    Start-Sleep -Milliseconds 700
    $page = Invoke-BrowserEvalJson -Session $Session -Script $script
    if ($page.hasBlankBody -ne $true) {
      return $page
    }
    Write-Step "page body still blank after navigation (attempt $attempt/7)"
  }
  return $page
}

function Assert-Page {
  param(
    [object]$Page,
    [string]$Name,
    [string[]]$RequiredText = @(),
    [switch]$RequireComposer,
    [switch]$RequireSkillsHub,
    [switch]$RequireTrendingHub,
    [switch]$RequireRuntimeBar,
    [switch]$RequireDiagnostics,
    [switch]$RequireMarkdown
  )

  Assert-True (-not $Page.hasBlankBody) "$Name rendered a blank body"
  Assert-True (-not $Page.hasHorizontalOverflow) "$Name has horizontal overflow: $($Page.scrollWidth) > $($Page.clientWidth)"
  Assert-True (-not $Page.hasInternalCodexContext) "$Name exposed internal codex context"
  Assert-True (-not $Page.hasInternalThreadReadError) "$Name exposed an internal thread-store read error"
  if ($RequireComposer) {
    Assert-True ($Page.hasComposer -eq $true) "$Name is missing composer controls"
  }
  if ($RequireSkillsHub) {
    Assert-True ($Page.hasSkillsHub -eq $true) "$Name is missing skills hub"
  }
  if ($RequireTrendingHub) {
    Assert-True ($Page.hasTrendingHub -eq $true) "$Name is missing GitHub trending hub"
  }
  if ($RequireRuntimeBar) {
    Assert-True ($Page.hasRuntimeBar -eq $true) "$Name is missing runtime status bar"
  }
  if ($RequireDiagnostics) {
    Assert-True ($Page.hasDiagnosticsPanel -eq $true) "$Name is missing diagnostics panel"
  }
  if ($RequireMarkdown) {
    Assert-True ($Page.hasMarkdownBody -eq $true) "$Name is missing markdown preview"
  }
  foreach ($text in $RequiredText) {
    Assert-True ([string]$Page.text -like "*$text*") "$Name is missing required text: $text"
  }
}

function Assert-SkillDetailReadmeRecovery {
  param([string]$Session)

  $initialScript = @'
JSON.stringify((() => {
  const panel = document.querySelector('.sdm-panel');
  const error = document.querySelector('.sdm-readme-error');
  const retry = document.querySelector('.sdm-readme-retry');
  const rect = panel?.getBoundingClientRect();
  return {
    hasPanel: !!panel,
    hasError: !!error,
    errorText: error?.textContent?.replace(/\s+/g, ' ').trim() || '',
    hasRetry: !!retry,
    retryLabel: retry?.textContent?.trim() || '',
    activeClass: document.activeElement?.className || '',
    panelContainsFocus: !!panel && panel.contains(document.activeElement),
    panelFitsViewport: !!rect && rect.left >= -2 && rect.right <= window.innerWidth + 2 && rect.top >= -2 && rect.bottom <= window.innerHeight + 2
  };
})())
'@
  $initial = Invoke-BrowserEvalJson -Session $Session -Script $initialScript
  Assert-True ($initial.hasPanel -eq $true) "skill detail recovery fixture is missing the detail panel"
  Assert-True ($initial.hasError -eq $true) "failed skill content load did not remain visible"
  Assert-True ([string]$initial.errorText -like '*无法加载技能内容*') "skill content failure is missing a clear explanation"
  Assert-True ($initial.hasRetry -eq $true -and [string]$initial.retryLabel -eq '重试') "skill content failure is missing an inline retry action"
  Assert-True ($initial.panelContainsFocus -eq $true -and [string]$initial.activeClass -like '*sdm-close*') "skill detail did not move initial focus into the modal"
  Assert-True ($initial.panelFitsViewport -eq $true) "skill detail failure state does not fit the phone viewport"

  Invoke-AgentBrowser -Arguments @('--session', $Session, 'press', 'Shift+Tab') | Out-Null
  $backwardWrap = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify({
  activeClass: document.activeElement?.className || '',
  panelContainsFocus: document.querySelector('.sdm-panel')?.contains(document.activeElement) === true
})
'@
  Assert-True ($backwardWrap.panelContainsFocus -eq $true -and [string]$backwardWrap.activeClass -like '*sdm-btn-primary*') "Shift+Tab did not wrap to the last skill-detail action"

  Invoke-AgentBrowser -Arguments @('--session', $Session, 'press', 'Tab') | Out-Null
  $forwardWrap = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify({
  activeClass: document.activeElement?.className || '',
  panelContainsFocus: document.querySelector('.sdm-panel')?.contains(document.activeElement) === true
})
'@
  Assert-True ($forwardWrap.panelContainsFocus -eq $true -and [string]$forwardWrap.activeClass -like '*sdm-close*') "Tab did not wrap back to the first skill-detail action"

  $externalFocus = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  document.querySelector('.docs-skill-detail-launch')?.focus();
  return {
    activeClass: document.activeElement?.className || '',
    panelContainsFocus: document.querySelector('.sdm-panel')?.contains(document.activeElement) === true
  };
})())
'@
  Assert-True ($externalFocus.panelContainsFocus -eq $true -and [string]$externalFocus.activeClass -like '*sdm-close*') "skill detail allowed focus to escape to the background page"

  $retryScript = @'
JSON.stringify((() => {
  const retry = document.querySelector('.sdm-readme-retry');
  if (!(retry instanceof HTMLButtonElement)) return { clicked: false };
  retry.click();
  return { clicked: true };
})())
'@
  $retryResult = Invoke-BrowserEvalJson -Session $Session -Script $retryScript
  Assert-True ($retryResult.clicked -eq $true) "skill content retry action could not be triggered"
  Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '150') | Out-Null

  $recoveredScript = @'
JSON.stringify((() => {
  const readme = document.querySelector('.sdm-readme');
  return {
    hasReadme: !!readme,
    readmeText: readme?.textContent?.replace(/\s+/g, ' ').trim() || '',
    hasError: document.querySelector('.sdm-readme-error') !== null,
    hasRetry: document.querySelector('.sdm-readme-retry') !== null
  };
})())
'@
  $recovered = Invoke-BrowserEvalJson -Session $Session -Script $recoveredScript
  Assert-True ($recovered.hasReadme -eq $true) "skill detail did not restore README content after retry"
  Assert-True ([string]$recovered.readmeText -like '*重试后已恢复技能说明*') "skill detail retry restored the wrong README content"
  Assert-True ($recovered.hasError -eq $false -and $recovered.hasRetry -eq $false) "skill detail kept stale failure controls after recovery"

  $closeResult = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const close = document.querySelector('.sdm-close');
  if (!(close instanceof HTMLButtonElement)) return { clicked: false };
  close.click();
  return { clicked: true };
})())
'@
  Assert-True ($closeResult.clicked -eq $true) "skill detail close action could not be triggered"
  Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '100') | Out-Null
  $closed = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify({
  hasPanel: document.querySelector('.sdm-panel') !== null,
  activeClass: document.activeElement?.className || ''
})
'@
  Assert-True ($closed.hasPanel -eq $false) "skill detail remained visible after close"
  Assert-True ([string]$closed.activeClass -like '*docs-skill-detail-launch*') "closing skill detail did not restore focus to its opener"
}

function Assert-GithubTrendingCompactLayout {
  param([string]$Session)

  $initial = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const hub = document.querySelector('.trending-hub');
  const filter = document.querySelector('.trending-hub-filter');
  const grid = document.querySelector('.trending-hub-grid');
  const cards = Array.from(document.querySelectorAll('.trending-card:not(.trending-card-skeleton)'));
  const firstCard = cards[0];
  const firstSummary = firstCard?.querySelector('.trending-card-summary');
  const firstExpand = firstCard?.querySelector('.trending-card-expand');
  const filterRect = filter?.getBoundingClientRect();
  const firstRect = firstCard?.getBoundingClientRect();
  const secondRect = cards[1]?.getBoundingClientRect();
  const gridStyle = grid ? getComputedStyle(grid) : null;
  const summaryStyle = firstSummary ? getComputedStyle(firstSummary) : null;
  return {
    ready: !!hub && !!filter && !!grid && cards.length >= 3 && !!firstSummary && !!firstExpand,
    hasLegacyHero: document.querySelector('.trending-hub-header') !== null,
    filterHeight: filterRect?.height ?? 0,
    columnCount: gridStyle?.gridTemplateColumns.split(' ').filter(Boolean).length ?? 0,
    firstCardHeight: firstRect?.height ?? 0,
    secondCardHeight: secondRect?.height ?? 0,
    sameFirstRow: !!firstRect && !!secondRect && Math.abs(firstRect.top - secondRect.top) <= 1,
    summaryLineClamp: summaryStyle?.webkitLineClamp || '',
    expandState: firstExpand?.getAttribute('aria-expanded') || '',
    expandLabel: firstExpand?.textContent?.replace(/\s+/g, ' ').trim() || '',
    hasDetails: firstCard?.querySelector('.trending-card-details') !== null,
    hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  };
})())
'@
  Assert-True ($initial.ready -eq $true) "GitHub trending compact fixture did not render its filter and project cards"
  Assert-True ($initial.hasLegacyHero -eq $false) "GitHub trending retained the oversized duplicate hero card"
  Assert-True ([double]$initial.filterHeight -le 52) "GitHub trending filter is taller than the compact control contract"
  Assert-True ([int]$initial.columnCount -eq 2) "GitHub trending phone layout did not render two cards per row"
  Assert-True ($initial.sameFirstRow -eq $true) "GitHub trending first two cards are not aligned in one row"
  Assert-True ([Math]::Abs([double]$initial.firstCardHeight - 272) -le 2) "GitHub trending first card does not keep the 17rem collapsed height"
  Assert-True ([Math]::Abs([double]$initial.firstCardHeight - [double]$initial.secondCardHeight) -le 1) "GitHub trending collapsed cards do not keep a consistent height"
  Assert-True ([string]$initial.summaryLineClamp -eq '3') "GitHub trending summary is not clamped to three lines"
  Assert-True ([string]$initial.expandState -eq 'false' -and [string]$initial.expandLabel -like '展开*') "GitHub trending collapsed card is missing its expand action"
  Assert-True ($initial.hasDetails -eq $false) "GitHub trending rendered repository details before expansion"
  Assert-True ($initial.hasHorizontalOverflow -eq $false) "GitHub trending compact grid caused horizontal overflow"

  $expanded = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const firstExpand = document.querySelector('.trending-card-expand');
  if (!(firstExpand instanceof HTMLButtonElement)) return { clicked: false };
  firstExpand.click();
  return { clicked: true };
})())
'@
  Assert-True ($expanded.clicked -eq $true) "GitHub trending first card could not be expanded"
  Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '150') | Out-Null

  $expandedState = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const grid = document.querySelector('.trending-hub-grid');
  const cards = Array.from(document.querySelectorAll('.trending-card:not(.trending-card-skeleton)'));
  const firstCard = cards[0];
  const secondCard = cards[1];
  const firstExpand = firstCard?.querySelector('.trending-card-expand');
  const firstRect = firstCard?.getBoundingClientRect();
  const secondRect = secondCard?.getBoundingClientRect();
  const gridRect = grid?.getBoundingClientRect();
  return {
    isExpanded: firstCard?.classList.contains('is-expanded') === true,
    expandState: firstExpand?.getAttribute('aria-expanded') || '',
    expandLabel: firstExpand?.textContent?.replace(/\s+/g, ' ').trim() || '',
    hasDetails: firstCard?.querySelector('.trending-card-details') !== null,
    spansGrid: !!firstRect && !!gridRect && Math.abs(firstRect.width - gridRect.width) <= 2,
    nextRowStartsAfterExpandedCard: !!firstRect && !!secondRect && secondRect.top >= firstRect.bottom - 1,
    summaryIsExpanded: firstCard?.querySelector('.trending-card-summary')?.classList.contains('is-expanded') === true,
    hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  };
})())
'@
  Assert-True ($expandedState.isExpanded -eq $true) "GitHub trending expanded card is missing its state class"
  Assert-True ([string]$expandedState.expandState -eq 'true' -and [string]$expandedState.expandLabel -like '收起*') "GitHub trending expanded card is missing its collapse action"
  Assert-True ($expandedState.hasDetails -eq $true -and $expandedState.summaryIsExpanded -eq $true) "GitHub trending expansion did not reveal the complete project content"
  Assert-True ($expandedState.spansGrid -eq $true) "GitHub trending expanded card did not span the full grid width"
  Assert-True ($expandedState.nextRowStartsAfterExpandedCard -eq $true) "GitHub trending expanded card overlaps the following row"
  Assert-True ($expandedState.hasHorizontalOverflow -eq $false) "GitHub trending expanded card caused horizontal overflow"
}

function Read-SettingsPanelMetrics {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const panel = document.querySelector('.sidebar-settings-panel');
  const brandCard = document.querySelector('.sidebar-settings-brand-card');
  const closeButton = document.querySelector('.sidebar-settings-panel-close');
  const inputs = Array.from(document.querySelectorAll('.sidebar-settings-input, .sidebar-settings-code, .sidebar-settings-copy-button, .sidebar-settings-language-dropdown .composer-dropdown-trigger'));
  const panelRect = panel?.getBoundingClientRect();
  const panelStyle = panel ? window.getComputedStyle(panel) : null;
  const brandStyle = brandCard ? window.getComputedStyle(brandCard) : null;
  const warmColors = new Set([
    'rgb(255, 253, 248)',
    'rgb(255, 250, 243)',
    'rgb(247, 243, 234)',
    'rgb(241, 235, 222)',
    'rgb(251, 248, 242)'
  ]);
  const sampledStyles = [panel, brandCard, ...inputs].filter(Boolean).map((node) => {
    const style = window.getComputedStyle(node);
    return {
      className: node.className || node.tagName,
      backgroundColor: style.backgroundColor,
      borderColor: style.borderTopColor,
      borderWidth: Number.parseFloat(style.borderTopWidth || '0'),
      radius: Number.parseFloat(style.borderTopLeftRadius || '0')
    };
  });
  const viewportWidth = document.documentElement.clientWidth;
  const fitFailure = panelRect ? (panelRect.left < -2 || panelRect.right > viewportWidth + 2) : true;
  return {
    hasPanel: !!panel,
    hasBrandCard: !!brandCard,
    hasCloseButton: !!closeButton,
    panelBackground: panelStyle?.backgroundColor || '',
    panelRadius: panelStyle ? Number.parseFloat(panelStyle.borderTopLeftRadius || '0') : 0,
    panelBorderWidth: panelStyle ? Number.parseFloat(panelStyle.borderTopWidth || '0') : 0,
    brandRadius: brandStyle ? Number.parseFloat(brandStyle.borderTopLeftRadius || '0') : 0,
    sampledWarmBackgroundCount: sampledStyles.filter((item) => warmColors.has(item.backgroundColor)).length,
    maxSampleRadius: sampledStyles.length ? Math.max(...sampledStyles.map((item) => item.radius)) : 0,
    fitFailure,
    hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  };
})())
'@
  return Invoke-BrowserEvalJson -Session $Session -Script $script
}

function Assert-SettingsPanel {
  param([object]$Metrics)

  Assert-True ($Metrics.hasPanel -eq $true) "settings panel did not open"
  Assert-True ($Metrics.hasBrandCard -eq $true) "settings panel is missing about/brand block"
  Assert-True ($Metrics.hasCloseButton -eq $true) "settings panel is missing compact close button"
  Assert-True ($Metrics.panelRadius -le 22) "settings panel radius is too large: $($Metrics.panelRadius)"
  Assert-True ($Metrics.panelBorderWidth -le 1) "settings panel border is too heavy: $($Metrics.panelBorderWidth)"
  Assert-True ($Metrics.brandRadius -le 8) "settings brand block radius is too large: $($Metrics.brandRadius)"
  Assert-True ($Metrics.sampledWarmBackgroundCount -eq 0) "settings panel still uses warm beige sampled backgrounds"
  Assert-True ($Metrics.maxSampleRadius -le 22) "settings sampled controls exceed radius ceiling: $($Metrics.maxSampleRadius)"
  Assert-True ($Metrics.fitFailure -eq $false) "settings panel overflows viewport horizontally"
  Assert-True ($Metrics.hasHorizontalOverflow -eq $false) "settings panel page has horizontal overflow: $($Metrics.scrollWidth) > $($Metrics.clientWidth)"
}

function Read-FoldableShellMetrics {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const layout = document.querySelector('.desktop-layout');
  const sidebar = document.querySelector('.desktop-sidebar');
  const main = document.querySelector('.desktop-main');
  const contentRoot = document.querySelector('.content-root');
  const contentGrid = document.querySelector('.content-grid');
  const composer = document.querySelector('.thread-composer-shell');
  const settingsPanel = document.querySelector('.sidebar-settings-panel');
  const actionGrid = document.querySelector('.sidebar-action-grid');
  const actionTiles = Array.from(document.querySelectorAll('.sidebar-action-tile'));
  const actionIcons = Array.from(document.querySelectorAll('.sidebar-action-icon'));
  const actionGridStyle = actionGrid ? window.getComputedStyle(actionGrid) : null;
  const actionTileStyles = actionTiles.map((node) => {
    const style = window.getComputedStyle(node);
    return {
      radius: Number.parseFloat(style.borderTopLeftRadius || '0'),
      height: node.getBoundingClientRect().height
    };
  });
  const actionGridRows = new Set(actionTiles.map((node) => Math.round(node.getBoundingClientRect().top))).size;
  const actionGridRect = actionGrid?.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth;
  const layoutRect = layout?.getBoundingClientRect();
  const sidebarRect = sidebar?.getBoundingClientRect();
  const mainRect = main?.getBoundingClientRect();
  const contentGridRect = contentGrid?.getBoundingClientRect();
  const composerRect = composer?.getBoundingClientRect();
  const fitTargets = [layout, sidebar, main, contentRoot, contentGrid, composer].filter(Boolean);
  const fitFailures = fitTargets
    .map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        className: node.className || node.tagName,
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width)
      };
    })
    .filter((rect) => rect.left < -2 || rect.right > viewportWidth + 2);
  return {
    hasLayout: !!layout,
    hasSidebar: !!sidebar,
    hasMain: !!main,
    hasContentGrid: !!contentGrid,
    hasComposer: !!composer,
    hasSettingsPanel: !!settingsPanel,
    hasActionGrid: !!actionGrid,
    actionGridDisplay: actionGridStyle?.display || '',
    actionGridTemplateColumns: actionGridStyle?.gridTemplateColumns || '',
    actionGridHeight: actionGridRect ? Math.round(actionGridRect.height) : 0,
    actionGridRowCount: actionGridRows,
    actionTileCount: actionTiles.length,
    actionIconCount: actionIcons.length,
    actionTileMaxRadius: actionTileStyles.length ? Math.max(...actionTileStyles.map((item) => item.radius)) : 0,
    actionTileMinHeight: actionTileStyles.length ? Math.min(...actionTileStyles.map((item) => item.height)) : 0,
    layoutWidth: layoutRect ? Math.round(layoutRect.width) : 0,
    sidebarWidth: sidebarRect ? Math.round(sidebarRect.width) : 0,
    mainWidth: mainRect ? Math.round(mainRect.width) : 0,
    contentGridWidth: contentGridRect ? Math.round(contentGridRect.width) : 0,
    composerWidth: composerRect ? Math.round(composerRect.width) : 0,
    sidebarRatio: sidebarRect && layoutRect && layoutRect.width > 0 ? sidebarRect.width / layoutRect.width : 0,
    fitFailureCount: fitFailures.length,
    fitFailures: fitFailures.slice(0, 5),
    hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    viewport: { width: window.innerWidth, height: window.innerHeight }
  };
})())
'@
  return Invoke-BrowserEvalJson -Session $Session -Script $script
}

function Assert-FoldableShell {
  param([object]$Metrics)

  Assert-True ($Metrics.hasLayout -eq $true) "foldable shell is missing desktop layout"
  Assert-True ($Metrics.hasSidebar -eq $true) "foldable shell is missing sidebar"
  Assert-True ($Metrics.hasMain -eq $true) "foldable shell is missing main content"
  Assert-True ($Metrics.hasContentGrid -eq $true) "foldable shell is missing content grid"
  Assert-True ($Metrics.hasComposer -eq $true) "foldable shell is missing composer"
  Assert-True ($Metrics.hasSettingsPanel -eq $false) "foldable shell screenshot is polluted by an open settings panel"
  Assert-True ($Metrics.hasActionGrid -eq $true) "foldable shell is missing compact sidebar action grid"
  Assert-True ($Metrics.actionGridDisplay -eq "grid") "foldable sidebar action grid is not grid: $($Metrics.actionGridDisplay)"
  Assert-True (-not [string]::IsNullOrWhiteSpace($Metrics.actionGridTemplateColumns)) "foldable sidebar action grid is missing columns"
  Assert-True ($Metrics.actionGridRowCount -le 2) "foldable sidebar action grid uses too many rows: $($Metrics.actionGridRowCount)"
  Assert-True ($Metrics.actionGridHeight -le 96) "foldable sidebar action grid is too tall: $($Metrics.actionGridHeight)"
  Assert-True ($Metrics.actionTileCount -eq 4) "foldable sidebar action grid should keep four primary entries: $($Metrics.actionTileCount)"
  Assert-True ($Metrics.actionIconCount -ge $Metrics.actionTileCount) "foldable sidebar action grid is missing icons"
  Assert-True ($Metrics.actionTileMaxRadius -le 10) "foldable sidebar action tiles are too rounded: $($Metrics.actionTileMaxRadius)"
  Assert-True ($Metrics.actionTileMinHeight -ge 42) "foldable sidebar action tiles are too small for touch: $($Metrics.actionTileMinHeight)"
  Assert-True ($Metrics.sidebarWidth -ge 260) "foldable sidebar is too narrow: $($Metrics.sidebarWidth)"
  Assert-True ($Metrics.sidebarWidth -le 370) "foldable sidebar is too wide: $($Metrics.sidebarWidth)"
  Assert-True ($Metrics.sidebarRatio -le 0.42) "foldable sidebar takes too much width: $($Metrics.sidebarRatio)"
  Assert-True ($Metrics.mainWidth -ge 500) "foldable main content is too narrow: $($Metrics.mainWidth)"
  Assert-True ($Metrics.contentGridWidth -ge 430) "foldable content grid is too narrow: $($Metrics.contentGridWidth)"
  Assert-True ($Metrics.composerWidth -ge 430) "foldable composer is too narrow: $($Metrics.composerWidth)"
  Assert-True ($Metrics.fitFailureCount -eq 0) "foldable shell elements overflow viewport: $($Metrics.fitFailures | ConvertTo-Json -Compress)"
  Assert-True ($Metrics.hasHorizontalOverflow -eq $false) "foldable shell has horizontal overflow: $($Metrics.scrollWidth) > $($Metrics.clientWidth)"
}

function Read-MobileDrawerSidebarMetrics {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const drawer = document.querySelector('.mobile-drawer');
  const actionGrid = drawer?.querySelector('.sidebar-action-grid') || null;
  const rows = Array.from(drawer?.querySelectorAll('.thread-row') || []);
  const groups = Array.from(drawer?.querySelectorAll('.project-group') || []);
  const projectHeaders = groups.map((group) => group.querySelector('.project-header-row')).filter(Boolean);
  const projectToggleButtons = groups.map((group) => group.querySelector('.project-main-button')).filter(Boolean);
  const pinButtons = rows.map((row) => row.querySelector('.thread-pin-button')).filter(Boolean);
  const threadOpenButtons = rows.map((row) => row.querySelector('.thread-main-button')).filter(Boolean);
  const threadMenuTriggers = rows.map((row) => row.querySelector('.thread-menu-trigger')).filter(Boolean);
  const threadTimes = rows.map((row) => row.querySelector('.thread-row-time')).filter(Boolean);
  const isRendered = (node) => node.getClientRects().length > 0 && window.getComputedStyle(node).visibility !== 'hidden';
  const displayedPinButtons = pinButtons.filter(isRendered);
  const displayedThreadMenuTriggers = threadMenuTriggers.filter(isRendered);
  const displayedThreadTimes = threadTimes.filter(isRendered);
  const actionTiles = Array.from(drawer?.querySelectorAll(
    '.sidebar-action-grid > .sidebar-action-tile, .sidebar-action-grid > .sidebar-tools-menu > .sidebar-action-tile'
  ) || []);
  const loading = drawer?.querySelector('.thread-tree-loading') || null;
  const emptyText = drawer?.querySelector('.thread-tree-empty-text') || null;
  const drawerRect = drawer?.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth;
  const fitFailures = [drawer, actionGrid].filter(Boolean)
    .map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        className: node.className || node.tagName,
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width)
      };
    })
    .filter((rect) => rect.left < -2 || rect.right > viewportWidth + 2);
  return {
    hasDrawer: !!drawer,
    hasActionGrid: !!actionGrid,
    rowCount: rows.length,
    groupCount: groups.length,
    projectToggleButtonCount: projectToggleButtons.length,
    exactProjectToggleLabelCount: projectToggleButtons.filter((node) => {
      const label = node.getAttribute('aria-label') || '';
      const expanded = node.getAttribute('aria-expanded');
      return (label.startsWith('收起项目：') || label.startsWith('展开项目：'))
        && (expanded === 'true' || expanded === 'false');
    }).length,
    nestedProjectInteractiveOwnerCount: projectHeaders.filter((node) => (
      node.getAttribute('role') === 'button' || node.hasAttribute('tabindex')
    ) && !!node.querySelector('button')).length,
    pinButtonCount: pinButtons.length,
    displayedPinButtonCount: displayedPinButtons.length,
    displayedPinButtonTabStopCount: displayedPinButtons.filter((node) => node.tabIndex >= 0 && !node.disabled).length,
    threadOpenButtonCount: threadOpenButtons.length,
    exactThreadOpenLabelCount: rows.filter((row) => {
      const button = row.querySelector('.thread-main-button');
      const title = (row.querySelector('.thread-row-title')?.textContent || '').trim();
      const indicatorState = row.querySelector('.thread-status-indicator')?.getAttribute('data-state') || '';
      const states = [];
      if (indicatorState === 'waiting') states.push('等待处理');
      else if (indicatorState === 'working') states.push('执行中');
      if (indicatorState === 'unread') states.push('未读');
      if (row.querySelector('.thread-row-worktree-icon')) states.push('工作树会话');
      const expected = `打开会话：${title}${states.length > 0 ? `，${states.join('，')}` : ''}`;
      return button?.getAttribute('aria-label') === expected;
    }).length,
    threadOpenPreviewLeakCount: rows.filter((row) => {
      const label = row.querySelector('.thread-main-button')?.getAttribute('aria-label') || '';
      const title = (row.querySelector('.thread-row-title')?.textContent || '').trim();
      const preview = (row.querySelector('.thread-row-preview')?.textContent || '').trim();
      return preview.length > title.length && label.includes(preview);
    }).length,
    threadMenuTriggerCount: threadMenuTriggers.length,
    displayedThreadMenuTriggerCount: displayedThreadMenuTriggers.length,
    minThreadMenuTarget: displayedThreadMenuTriggers.length
      ? Math.min(...displayedThreadMenuTriggers.map((node) => {
          const rect = node.getBoundingClientRect();
          return Math.min(rect.width, rect.height);
        }))
      : 0,
    exactThreadMenuLabelCount: threadMenuTriggers.filter((node) => {
      const label = node.getAttribute('aria-label') || '';
      return label.startsWith('会话操作：') && node.getAttribute('title') === label;
    }).length,
    displayedThreadTimeCount: displayedThreadTimes.length,
    isLoading: !!loading,
    hasEmptyText: !!emptyText,
    actionTileCount: actionTiles.filter((node) => window.getComputedStyle(node).display !== 'none').length,
    hasVisibleWorkbenchTile: actionTiles.some((node) => (
      window.getComputedStyle(node).display !== 'none' && (node.textContent || '').includes('工作台')
    )),
    drawerWidth: drawerRect ? Math.round(drawerRect.width) : 0,
    drawerRightGap: drawerRect ? Math.round(viewportWidth - drawerRect.right) : 0,
    sidebarCollapsedPreference: window.localStorage.getItem('codex-web-local.sidebar-collapsed.v1'),
    role: drawer?.getAttribute('role') || '',
    ariaModal: drawer?.getAttribute('aria-modal') || '',
    ariaLabel: drawer?.getAttribute('aria-label') || '',
    focusInside: !!drawer?.contains(document.activeElement),
    activeLabel: document.activeElement?.getAttribute?.('aria-label') || '',
    backgroundInert: !!document.querySelector('.desktop-layout')?.closest('[inert]'),
    skipLinkInert: !!document.querySelector('.skip-to-content')?.closest('[inert]'),
    rootOverflow: document.documentElement.style.overflow,
    fitFailureCount: fitFailures.length,
    fitFailures: fitFailures.slice(0, 5),
    hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  };
})())
'@
  return Invoke-BrowserEvalJson -Session $Session -Script $script
}

function Assert-MobileDrawerSidebar {
  param([object]$Metrics)

  Assert-True ($Metrics.hasDrawer -eq $true) "mobile home did not open sidebar drawer"
  Assert-True ($Metrics.hasActionGrid -eq $true) "mobile drawer is missing compact action grid"
  Assert-True ($Metrics.isLoading -eq $false) "mobile drawer sidebar is still showing loading skeletons"
  Assert-True ([int]$Metrics.rowCount -gt 0) "mobile drawer sidebar did not render thread rows"
  Assert-True ([int]$Metrics.groupCount -gt 0) "mobile drawer sidebar did not render project groups"
  Assert-True ([int]$Metrics.projectToggleButtonCount -eq [int]$Metrics.groupCount -and [int]$Metrics.exactProjectToggleLabelCount -eq [int]$Metrics.groupCount) "mobile drawer project groups are missing independent exact collapse controls"
  Assert-True ([int]$Metrics.nestedProjectInteractiveOwnerCount -eq 0) "mobile drawer still exposes a composite project button containing nested buttons"
  Assert-True ([int]$Metrics.pinButtonCount -eq [int]$Metrics.rowCount) "mobile drawer thread rows lost their desktop pin action source"
  Assert-True ([int]$Metrics.displayedPinButtonCount -eq 0 -and [int]$Metrics.displayedPinButtonTabStopCount -eq 0) "mobile drawer still exposes invisible direct-pin focus stops"
  Assert-True ([int]$Metrics.threadOpenButtonCount -eq [int]$Metrics.rowCount -and [int]$Metrics.exactThreadOpenLabelCount -eq [int]$Metrics.rowCount) "mobile drawer thread rows are missing concise exact open labels"
  Assert-True ([int]$Metrics.threadOpenPreviewLeakCount -eq 0) "mobile drawer thread open labels still expose an unbounded preview"
  Assert-True ([int]$Metrics.threadMenuTriggerCount -eq [int]$Metrics.rowCount -and [int]$Metrics.displayedThreadMenuTriggerCount -eq [int]$Metrics.rowCount) "mobile drawer thread action menus are not consistently discoverable"
  Assert-True ([double]$Metrics.minThreadMenuTarget -ge 35.5) "mobile drawer thread action target is smaller than 36px: $($Metrics.minThreadMenuTarget)"
  Assert-True ([int]$Metrics.exactThreadMenuLabelCount -eq [int]$Metrics.threadMenuTriggerCount) "mobile drawer thread action menus are missing exact accessible labels"
  Assert-True ([int]$Metrics.displayedThreadTimeCount -eq 0) "mobile drawer still prioritizes passive timestamps over its primary action entry"
  Assert-True ($Metrics.hasEmptyText -eq $false) "mobile drawer sidebar rendered empty/error text despite available threads"
  Assert-True ([int]$Metrics.actionTileCount -eq 3) "mobile drawer should keep three primary actions: $($Metrics.actionTileCount)"
  Assert-True ($Metrics.hasVisibleWorkbenchTile -eq $false) "mobile drawer should move Workbench into the Tools menu"
  Assert-True ($Metrics.drawerWidth -lt $Metrics.clientWidth) "mobile drawer should leave a visible backdrop edge: $($Metrics.drawerWidth) >= $($Metrics.clientWidth)"
  Assert-True ($Metrics.drawerRightGap -ge 32) "mobile drawer backdrop edge is too narrow: $($Metrics.drawerRightGap)"
  if ($Metrics.clientWidth -le 480) {
    Assert-True ($Metrics.drawerRightGap -le 64) "portrait mobile drawer backdrop edge is too wide: $($Metrics.drawerRightGap)"
  }
  Assert-True ($Metrics.sidebarCollapsedPreference -eq "0") "mobile drawer changed the persisted desktop sidebar preference: $($Metrics.sidebarCollapsedPreference)"
  Assert-True ($Metrics.role -eq "dialog" -and $Metrics.ariaModal -eq "true" -and $Metrics.ariaLabel -eq "会话导航") "mobile drawer is missing its named modal semantics"
  Assert-True ($Metrics.focusInside -eq $true -and $Metrics.activeLabel -eq "收起侧栏") "mobile drawer did not focus its close action on open"
  Assert-True ($Metrics.backgroundInert -eq $true -and $Metrics.skipLinkInert -eq $true) "mobile drawer left background navigation exposed to keyboard or assistive browsing"
  Assert-True ($Metrics.rootOverflow -eq "hidden") "mobile drawer did not lock background root scrolling"
  Assert-True ($Metrics.fitFailureCount -eq 0) "mobile drawer elements overflow viewport: $($Metrics.fitFailures | ConvertTo-Json -Compress)"
  Assert-True ($Metrics.hasHorizontalOverflow -eq $false) "mobile drawer has horizontal overflow: $($Metrics.scrollWidth) > $($Metrics.clientWidth)"
}

function Open-MobileDrawerSidebar {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  if (document.querySelector('.mobile-drawer')) return { alreadyOpen: true, clicked: false };
  const buttons = Array.from(document.querySelectorAll('.sidebar-thread-controls-header-host .sidebar-thread-controls-button'));
  const visibleButtons = buttons.filter((button) => {
    const rect = button.getBoundingClientRect();
    const style = window.getComputedStyle(button);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  });
  const button = visibleButtons.find((node) => node.getAttribute('aria-label') === 'Expand sidebar')
    || visibleButtons.find((node) => (node.getAttribute('title') || '').toLowerCase().includes('sidebar'))
    || visibleButtons[0]
    || null;
  if (button instanceof HTMLElement) {
    window.__cxRegressionMobileDrawerPreviousRootOverflow = document.documentElement.style.overflow;
    button.focus({ preventScroll: true });
    button.click();
    return { alreadyOpen: false, clicked: true, label: button.getAttribute('aria-label') || '' };
  }
  return { alreadyOpen: false, clicked: false, label: '' };
})())
'@

  for ($attempt = 1; $attempt -le 5; $attempt++) {
    Invoke-BrowserEvalJson -Session $Session -Script $script | Out-Null
    Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "350") | Out-Null
    $metrics = Read-MobileDrawerSidebarMetrics -Session $Session
    if ($metrics.hasDrawer -eq $true) {
      return $metrics
    }
  }

  return Read-MobileDrawerSidebarMetrics -Session $Session
}

function Assert-MobileDrawerProjectBulkCollapse {
  param([string]$Session)

  $opened = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const drawer = document.querySelector('.mobile-drawer');
  const trigger = drawer?.querySelector('.organize-menu-trigger');
  if (!(trigger instanceof HTMLButtonElement)) return { clicked: false };
  trigger.click();
  return {
    clicked: true,
    triggerHasPopup: trigger.getAttribute('aria-haspopup') === 'menu',
    triggerControlsMenu: trigger.getAttribute('aria-controls') === 'sidebar-organize-menu'
  };
})())
'@
  Assert-True ($opened.clicked -eq $true) "mobile drawer is missing the organize menu trigger"
  Assert-True ($opened.triggerHasPopup -eq $true -and $opened.triggerControlsMenu -eq $true) "mobile drawer organize trigger is missing connected menu semantics"
  Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '100') | Out-Null

  $triggered = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const drawer = document.querySelector('.mobile-drawer');
  const menu = drawer.querySelector('#sidebar-organize-menu');
  const collapse = menu?.querySelector('[data-organize-action="collapse-all-projects"]');
  const expand = menu?.querySelector('[data-organize-action="expand-all-projects"]');
  const result = {
    hasMenu: !!menu,
    menuRole: menu?.getAttribute('role') || '',
    collapseLabel: collapse?.textContent?.replace(/\s+/g, ' ').trim() || '',
    expandLabel: expand?.textContent?.replace(/\s+/g, ' ').trim() || '',
    collapseDisabled: collapse instanceof HTMLButtonElement ? collapse.disabled : null,
    expandDisabled: expand instanceof HTMLButtonElement ? expand.disabled : null
  };
  if (collapse instanceof HTMLButtonElement) collapse.click();
  return result;
})())
'@
  Assert-True ($triggered.hasMenu -eq $true -and $triggered.menuRole -eq 'menu') "mobile drawer organize panel is missing menu semantics"
  Assert-True ([string]$triggered.collapseLabel -eq '收起全部目录' -and [string]$triggered.expandLabel -eq '展开全部目录') "mobile drawer organize menu is missing exact bulk directory actions"
  Assert-True ($triggered.collapseDisabled -eq $false -and $triggered.expandDisabled -eq $true) "fully expanded projects did not expose the correct bulk action state"

  Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '250') | Out-Null
  $collapsed = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const drawer = document.querySelector('.mobile-drawer');
  const groups = Array.from(drawer?.querySelectorAll('.project-group') || []);
  let stored = {};
  try { stored = JSON.parse(window.localStorage.getItem('codex-web-local.collapsed-projects.v1') || '{}'); } catch {}
  return {
    groupCount: groups.length,
    expandedCount: groups.filter((group) => group.getAttribute('data-expanded') === 'true').length,
    projectThreadRowCount: drawer?.querySelectorAll('.project-group .thread-row').length || 0,
    storedCollapsedCount: Object.values(stored).filter(Boolean).length,
    menuClosed: drawer?.querySelector('#sidebar-organize-menu') === null
  };
})())
'@
  Assert-True ([int]$collapsed.groupCount -gt 1) "bulk collapse regression needs multiple real project groups"
  Assert-True ([int]$collapsed.expandedCount -eq 0 -and [int]$collapsed.projectThreadRowCount -eq 0) "collapse-all did not remove expanded project thread rows"
  Assert-True ([int]$collapsed.storedCollapsedCount -ge [int]$collapsed.groupCount) "collapse-all did not persist every visible project"
  Assert-True ($collapsed.menuClosed -eq $true) "collapse-all left the organization popover obstructing navigation"

  $expandMenuOpened = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const drawer = document.querySelector('.mobile-drawer');
  const trigger = drawer?.querySelector('.organize-menu-trigger');
  if (!(trigger instanceof HTMLButtonElement)) return { clicked: false };
  trigger.click();
  return { clicked: true };
})())
'@
  Assert-True ($expandMenuOpened.clicked -eq $true) "mobile drawer could not reopen the organize menu"
  Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '100') | Out-Null

  $expanded = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const drawer = document.querySelector('.mobile-drawer');
  const menu = drawer.querySelector('#sidebar-organize-menu');
  const collapse = menu?.querySelector('[data-organize-action="collapse-all-projects"]');
  const expand = menu?.querySelector('[data-organize-action="expand-all-projects"]');
  const result = {
    hasMenu: !!menu,
    collapseDisabled: collapse instanceof HTMLButtonElement ? collapse.disabled : null,
    expandDisabled: expand instanceof HTMLButtonElement ? expand.disabled : null
  };
  if (expand instanceof HTMLButtonElement) expand.click();
  return result;
})())
'@
  Assert-True ($expanded.hasMenu -eq $true -and $expanded.collapseDisabled -eq $true -and $expanded.expandDisabled -eq $false) "fully collapsed projects did not expose the inverse bulk action state"

  Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '250') | Out-Null
  $restored = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const drawer = document.querySelector('.mobile-drawer');
  const groups = Array.from(drawer?.querySelectorAll('.project-group') || []);
  let stored = {};
  try { stored = JSON.parse(window.localStorage.getItem('codex-web-local.collapsed-projects.v1') || '{}'); } catch {}
  return {
    groupCount: groups.length,
    expandedCount: groups.filter((group) => group.getAttribute('data-expanded') === 'true').length,
    projectThreadRowCount: drawer?.querySelectorAll('.project-group .thread-row').length || 0,
    storedCollapsedCount: Object.values(stored).filter(Boolean).length,
    menuClosed: drawer?.querySelector('#sidebar-organize-menu') === null
  };
})())
'@
  Assert-True ([int]$restored.expandedCount -eq [int]$restored.groupCount -and [int]$restored.projectThreadRowCount -gt 0) "expand-all did not restore project thread rows"
  Assert-True ([int]$restored.storedCollapsedCount -eq 0) "expand-all left stale collapsed project preferences"
  Assert-True ($restored.menuClosed -eq $true) "expand-all left the organization popover obstructing navigation"
}

function Assert-MobileDrawerEnvironmentOwnership {
  param([string]$Session)

  $interaction = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const drawer = document.querySelector('.mobile-drawer');
  const focusable = Array.from(drawer?.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  ) || []).filter((element) => element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true');
  const first = focusable[0] || null;
  const last = focusable[focusable.length - 1] || null;
  const initialFocusInside = !!drawer?.contains(document.activeElement);
  const initialFocusLabel = document.activeElement?.getAttribute?.('aria-label') || '';
  if (first instanceof HTMLElement) {
    first.focus({ preventScroll: true });
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
  }
  const backwardWrap = document.activeElement === last;
  if (last instanceof HTMLElement) {
    last.focus({ preventScroll: true });
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  }
  const forwardWrap = document.activeElement === first;
  const composer = document.querySelector('.thread-composer-input');
  if (composer instanceof HTMLElement) composer.focus({ preventScroll: true });
  const outsideFocusReclaimed = !!drawer?.contains(document.activeElement);
  const routeBefore = window.location.hash;
  const prevented = !window.dispatchEvent(new CustomEvent('codex-mobile-back-button', { cancelable: true }));
  return {
    initialFocusInside,
    initialFocusLabel,
    backwardWrap,
    forwardWrap,
    outsideFocusReclaimed,
    rootScrollLocked: document.documentElement.style.overflow === 'hidden',
    routeBefore,
    prevented
  };
})())
'@

  Assert-True ($interaction.initialFocusInside -eq $true -and $interaction.initialFocusLabel -eq "收起侧栏") "mobile drawer did not transfer focus to its close action"
  Assert-True ($interaction.backwardWrap -eq $true -and $interaction.forwardWrap -eq $true) "mobile drawer did not contain forward and reverse Tab navigation"
  Assert-True ($interaction.outsideFocusReclaimed -eq $true) "mobile drawer let programmatic focus escape to the background composer"
  Assert-True ($interaction.rootScrollLocked -eq $true) "mobile drawer lost its background scroll lock while open"
  Assert-True ($interaction.prevented -eq $true) "Android back was not claimed while the mobile drawer owned focus"
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "350") | Out-Null

  $restored = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const active = document.activeElement;
  const expectedOverflow = window.__cxRegressionMobileDrawerPreviousRootOverflow || '';
  const state = {
    hasDrawer: !!document.querySelector('.mobile-drawer'),
    route: window.location.hash,
    openerFocusRestored: active instanceof HTMLElement
      && active.matches('.sidebar-thread-controls-header-host .sidebar-thread-controls-button'),
    backgroundInert: !!document.querySelector('.desktop-layout')?.closest('[inert]'),
    skipLinkInert: !!document.querySelector('.skip-to-content')?.closest('[inert]'),
    rootOverflow: document.documentElement.style.overflow,
    expectedOverflow
  };
  delete window.__cxRegressionMobileDrawerPreviousRootOverflow;
  return state;
})())
'@
  Assert-True ($restored.hasDrawer -eq $false) "Android back left the mobile drawer open"
  Assert-True ($restored.route -eq $interaction.routeBefore) "closing the mobile drawer changed route: $($restored.route)"
  Assert-True ($restored.openerFocusRestored -eq $true) "closing the mobile drawer did not restore its exact opener"
  Assert-True ($restored.backgroundInert -eq $false -and $restored.skipLinkInert -eq $false) "closing the mobile drawer did not restore background navigation"
  Assert-True ($restored.rootOverflow -eq $restored.expectedOverflow) "closing the mobile drawer did not restore root scrolling"

  Assert-MobileDrawerSidebar -Metrics (Open-MobileDrawerSidebar -Session $Session)
}

function Assert-MobileSettingsEnvironmentOwnership {
  param([string]$Session)

  $opened = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const trigger = document.querySelector('.sidebar-settings-button[aria-expanded]');
  if (!(trigger instanceof HTMLButtonElement)) return { clicked: false };
  trigger.focus({ preventScroll: true });
  trigger.click();
  return { clicked: true };
})())
'@
  Assert-True ($opened.clicked -eq $true) "mobile settings trigger could not be activated"
  Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '350') | Out-Null

  $interaction = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const panel = document.querySelector('.sidebar-settings-panel-mobile');
  const drawer = document.querySelector('.mobile-drawer');
  const sidebarScrollable = document.querySelector('.sidebar-scrollable');
  const footerActions = document.querySelector('.sidebar-footer-actions');
  const backdrop = document.querySelector('.sidebar-settings-mobile-backdrop');
  const panelClose = panel?.querySelector('.sidebar-settings-panel-close') || null;
  const backgroundAction = document.querySelector('.sidebar-action-tile');
  const focusable = Array.from(panel?.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  ) || []).filter((element) => element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true');
  const first = focusable[0] || null;
  const last = focusable[focusable.length - 1] || null;
  const initialFocusInside = !!panel?.contains(document.activeElement);
  const initialFocusClass = document.activeElement?.className || '';
  if (first instanceof HTMLElement) {
    first.focus({ preventScroll: true });
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
  }
  const backwardWrap = document.activeElement === last;
  if (last instanceof HTMLElement) {
    last.focus({ preventScroll: true });
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  }
  const forwardWrap = document.activeElement === first;
  if (backgroundAction instanceof HTMLElement) backgroundAction.focus({ preventScroll: true });
  const outsideFocusReclaimed = !!panel?.contains(document.activeElement);
  return {
    hasPanel: !!panel,
    drawerStillOpen: !!drawer,
    initialFocusInside,
    initialFocusClass,
    backwardWrap,
    forwardWrap,
    outsideFocusReclaimed,
    sidebarScrollableInert: sidebarScrollable?.inert === true,
    footerActionsInert: footerActions?.inert === true,
    backgroundActionHidden: !!backgroundAction?.closest('[inert]'),
    backdropTabIndex: backdrop?.tabIndex ?? 0,
    backdropAriaHidden: backdrop?.getAttribute('aria-hidden') === 'true',
    namedCloseActionCount: [backdrop, panelClose].filter((element) => (
      element instanceof HTMLElement
      && element.getAttribute('aria-hidden') !== 'true'
      && !!element.getAttribute('aria-label')?.trim()
    )).length,
    rootScrollLocked: document.documentElement.style.overflow === 'hidden'
  };
})())
'@

  Assert-True ($interaction.hasPanel -eq $true -and $interaction.drawerStillOpen -eq $true) "mobile settings sheet did not stay above its drawer"
  Assert-True ($interaction.initialFocusInside -eq $true -and [string]$interaction.initialFocusClass -like '*sidebar-settings-panel-close*') "mobile settings sheet did not focus its close action on open"
  Assert-True ($interaction.backwardWrap -eq $true -and $interaction.forwardWrap -eq $true) "mobile settings sheet did not contain forward and reverse Tab navigation"
  Assert-True ($interaction.outsideFocusReclaimed -eq $true) "mobile settings sheet let programmatic focus escape to the underlying drawer"
  Assert-True ($interaction.sidebarScrollableInert -eq $true -and $interaction.footerActionsInert -eq $true -and $interaction.backgroundActionHidden -eq $true) "mobile settings sheet left underlying drawer controls exposed to sequential or assistive navigation"
  Assert-True ([int]$interaction.backdropTabIndex -eq -1) "mobile settings backdrop added a duplicate close action to sequential navigation"
  Assert-True ($interaction.backdropAriaHidden -eq $true -and [int]$interaction.namedCloseActionCount -eq 1) "mobile settings backdrop remained a duplicate named close action in assistive navigation"
  Assert-True ($interaction.rootScrollLocked -eq $true) "mobile settings sheet lost the drawer's root scroll lock"

  $close = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify({ prevented: !window.dispatchEvent(new CustomEvent('codex-mobile-back-button', { cancelable: true })) })
'@
  Assert-True ($close.prevented -eq $true) "Android back was not claimed by the mobile settings sheet"
  Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '350') | Out-Null

  $restored = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const trigger = document.querySelector('.sidebar-settings-button[aria-expanded]');
  return {
    hasPanel: !!document.querySelector('.sidebar-settings-panel'),
    drawerStillOpen: !!document.querySelector('.mobile-drawer'),
    triggerFocusRestored: document.activeElement === trigger,
    sidebarScrollableInert: document.querySelector('.sidebar-scrollable')?.inert === true,
    footerActionsInert: document.querySelector('.sidebar-footer-actions')?.inert === true,
    rootScrollLocked: document.documentElement.style.overflow === 'hidden'
  };
})())
'@
  Assert-True ($restored.hasPanel -eq $false -and $restored.drawerStillOpen -eq $true) "closing mobile settings dismissed the drawer or left the sheet open"
  Assert-True ($restored.triggerFocusRestored -eq $true) "closing mobile settings did not restore focus to its exact trigger"
  Assert-True ($restored.sidebarScrollableInert -eq $false -and $restored.footerActionsInert -eq $false) "closing mobile settings did not restore underlying drawer controls"
  Assert-True ($restored.rootScrollLocked -eq $true) "closing nested mobile settings released the outer drawer scroll lock"

  $backdropOpen = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const trigger = document.querySelector('.sidebar-settings-button[aria-expanded]');
  if (!(trigger instanceof HTMLButtonElement)) return { clicked: false };
  trigger.focus({ preventScroll: true });
  trigger.click();
  return { clicked: true };
})())
'@
  Assert-True ($backdropOpen.clicked -eq $true) "mobile settings trigger could not be reactivated for backdrop dismissal"
  Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '350') | Out-Null

  $backdropPoint = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const backdrop = document.querySelector('.sidebar-settings-mobile-backdrop');
  const panel = document.querySelector('.sidebar-settings-panel-mobile');
  if (!(backdrop instanceof HTMLElement) || !(panel instanceof HTMLElement)) return { available: false };
  const backdropRect = backdrop.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  return {
    available: panelRect.top > backdropRect.top,
    x: Math.round(backdropRect.left + (backdropRect.width / 2)),
    y: Math.round(backdropRect.top + ((panelRect.top - backdropRect.top) / 2))
  };
})())
'@
  Assert-True ($backdropPoint.available -eq $true) "mobile settings backdrop has no visible pointer dismissal target"
  Invoke-AgentBrowser -Arguments @('--session', $Session, 'mouse', 'move', [string]$backdropPoint.x, [string]$backdropPoint.y) | Out-Null
  Invoke-AgentBrowser -Arguments @('--session', $Session, 'mouse', 'down') | Out-Null
  Invoke-AgentBrowser -Arguments @('--session', $Session, 'mouse', 'up') | Out-Null
  Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '350') | Out-Null

  $backdropRestored = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const trigger = document.querySelector('.sidebar-settings-button[aria-expanded]');
  return {
    hasPanel: !!document.querySelector('.sidebar-settings-panel'),
    drawerStillOpen: !!document.querySelector('.mobile-drawer'),
    triggerFocusRestored: document.activeElement === trigger,
    rootScrollLocked: document.documentElement.style.overflow === 'hidden'
  };
})())
'@
  Assert-True ($backdropRestored.hasPanel -eq $false -and $backdropRestored.drawerStillOpen -eq $true) "backdrop dismissal closed the mobile drawer or left settings open"
  Assert-True ($backdropRestored.triggerFocusRestored -eq $true) "backdrop dismissal did not restore focus to the mobile settings trigger"
  Assert-True ($backdropRestored.rootScrollLocked -eq $true) "backdrop dismissal released the outer drawer scroll lock"
}

function Assert-MobileDrawerThreadNavigationStability {
  param([string]$Session)

  $selectScript = @'
JSON.stringify((() => {
  const row = document.querySelector('.mobile-drawer .thread-row');
  const button = row?.querySelector('.thread-main-button') || null;
  const threadId = row?.getAttribute('data-thread-id') || '';
  if (button instanceof HTMLElement) button.click();
  return {
    clicked: button instanceof HTMLElement,
    threadId,
    sidebarCollapsedPreference: window.localStorage.getItem('codex-web-local.sidebar-collapsed.v1')
  };
})())
'@
  $selection = Invoke-BrowserEvalJson -Session $Session -Script $selectScript
  Assert-True ($selection.clicked -eq $true) "mobile drawer has no clickable thread row"
  Assert-True (-not [string]::IsNullOrWhiteSpace($selection.threadId)) "mobile drawer thread row has no stable thread id"

  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "500") | Out-Null
  $selectedState = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify({
  hasDrawer: !!document.querySelector('.mobile-drawer'),
  route: window.location.hash,
  sidebarCollapsedPreference: window.localStorage.getItem('codex-web-local.sidebar-collapsed.v1'),
  mainContentFocused: document.activeElement?.id === 'main-content',
  activeTag: document.activeElement?.tagName || '',
  activeId: document.activeElement?.id || ''
})
'@
  Assert-True ($selectedState.hasDrawer -eq $false) "mobile drawer stayed open after selecting a thread"
  Assert-True ($selectedState.route -like "#/thread/*") "mobile thread selection did not navigate to the thread route: $($selectedState.route)"
  Assert-True ($selectedState.sidebarCollapsedPreference -eq "0") "mobile thread selection changed the desktop sidebar preference"
  Assert-True ($selectedState.mainContentFocused -eq $true) "mobile thread selection lost focus instead of moving it to main content: $($selectedState.activeTag)#$($selectedState.activeId)"

  Assert-MobileThreadHeaderTouchTargets -Session $Session
  Assert-MobileComposerViewportCompression -Session $Session

  $backState = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify({
  prevented: !window.dispatchEvent(new CustomEvent('codex-mobile-back-button', { cancelable: true }))
})
'@
  Assert-True ($backState.prevented -eq $true) "Android back was not claimed on a thread route"
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "350") | Out-Null

  $homeState = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify({
  route: window.location.hash,
  hasDrawer: !!document.querySelector('.mobile-drawer'),
  sidebarCollapsedPreference: window.localStorage.getItem('codex-web-local.sidebar-collapsed.v1')
})
'@
  Assert-True ($homeState.route -eq "#/") "Android back did not return the mobile thread route to home: $($homeState.route)"
  Assert-True ($homeState.hasDrawer -eq $false) "Android back unexpectedly reopened the mobile drawer"
  Assert-True ($homeState.sidebarCollapsedPreference -eq "0") "Android back changed the desktop sidebar preference"
}

function Assert-MobileThreadHeaderTouchTargets {
  param([string]$Session)

  $metrics = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const readButton = (selector) => {
    const button = document.querySelector(selector);
    const rect = button?.getBoundingClientRect();
    return {
      present: button instanceof HTMLButtonElement,
      width: rect ? Math.round(rect.width) : 0,
      height: rect ? Math.round(rect.height) : 0,
      label: button?.getAttribute('aria-label') || ''
    };
  };
  const titleRect = document.querySelector('.content-title')?.getBoundingClientRect();
  const headerRect = document.querySelector('.content-header')?.getBoundingClientRect();
  const contextBadge = document.querySelector('.content-context-badge');
  return {
    refresh: readButton('.content-title-refresh-button'),
    favorites: readButton('.content-favorites-button'),
    contextBadge: {
      present: contextBadge instanceof HTMLElement,
      text: contextBadge?.textContent?.trim() || '',
      label: contextBadge?.getAttribute('aria-label') || ''
    },
    titleWidth: titleRect ? Math.round(titleRect.width) : 0,
    headerHeight: headerRect ? Math.round(headerRect.height) : 0,
    hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
  };
})())
'@

  Assert-True ($metrics.refresh.present -eq $true -and $metrics.favorites.present -eq $true) "mobile thread header is missing recovery or Favorites actions"
  Assert-True ([int]$metrics.refresh.height -ge 36 -and [int]$metrics.favorites.height -ge 36) "mobile thread header actions are too short for reliable touch: refresh=$($metrics.refresh.height), favorites=$($metrics.favorites.height)"
  Assert-True (-not [string]::IsNullOrWhiteSpace([string]$metrics.refresh.label) -and -not [string]::IsNullOrWhiteSpace([string]$metrics.favorites.label)) "mobile thread header actions lost accessible labels"
  if ($metrics.contextBadge.present -eq $true) {
    Assert-True ([string]$metrics.contextBadge.text -match '^\d+%$') "visible mobile context usage is missing its percent unit: $($metrics.contextBadge.text)"
    Assert-True ([string]$metrics.contextBadge.label -match '上下文已使用\s+\d+%') "mobile context usage accessible label drifted from the visible percentage"
  }
  Assert-True ([int]$metrics.titleWidth -ge 64) "mobile thread header actions squeezed the conversation title too far: $($metrics.titleWidth)px"
  Assert-True ([int]$metrics.headerHeight -le 96) "compact touch targets made the conversation header too tall: $($metrics.headerHeight)px"
  Assert-True ($metrics.hasHorizontalOverflow -eq $false) "mobile thread header touch targets caused horizontal overflow"
}

function Assert-MobileComposerViewportCompression {
  param([string]$Session)

  $before = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const input = document.querySelector('.thread-composer-input');
  if (input instanceof HTMLElement) input.focus({ preventScroll: true });
  const composer = document.querySelector('.composer-with-queue');
  const rect = composer?.getBoundingClientRect();
  return {
    hasInput: input instanceof HTMLElement,
    focused: document.activeElement === input,
    width: window.innerWidth,
    height: window.innerHeight,
    composerBottom: rect ? Math.round(rect.bottom) : 0,
    route: window.location.hash
  };
})())
'@
  Assert-True ($before.hasInput -eq $true) "mobile thread route is missing its composer input"
  Assert-True ($before.focused -eq $true) "mobile composer could not receive focus before viewport compression"
  Assert-True ($before.route -like "#/thread/*") "viewport compression probe is not on a thread route"

  $compressedHeight = [Math]::Max(280, [Math]::Min(500, [int]$before.height - 160))
  Invoke-AgentBrowser -Arguments @(
    "--session", $Session, "set", "viewport",
    ([string][int]$before.width), ([string]$compressedHeight)
  ) | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "250") | Out-Null

  $compressed = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const input = document.querySelector('.thread-composer-input');
  const composer = document.querySelector('.composer-with-queue');
  const layout = document.querySelector('.desktop-layout');
  const rect = composer?.getBoundingClientRect();
  return {
    focused: document.activeElement === input,
    mobile: layout?.classList.contains('is-mobile') || false,
    drawer: !!document.querySelector('.mobile-drawer'),
    composerTop: rect ? Math.round(rect.top) : -1,
    composerBottom: rect ? Math.round(rect.bottom) : 0,
    viewportHeight: window.innerHeight,
    visualViewportHeight: Math.round(window.visualViewport?.height || window.innerHeight),
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    route: window.location.hash,
    sidebarCollapsedPreference: window.localStorage.getItem('codex-web-local.sidebar-collapsed.v1')
  };
})())
'@
  Assert-True ($compressed.mobile -eq $true) "keyboard-sized viewport switched the handset into the desktop shell"
  Assert-True ($compressed.drawer -eq $false) "keyboard-sized viewport reopened the mobile drawer"
  Assert-True ($compressed.focused -eq $true) "keyboard-sized viewport lost composer focus"
  Assert-True ([int]$compressed.composerTop -ge 0) "keyboard-sized viewport moved the composer above the visible area"
  Assert-True ([int]$compressed.composerBottom -le [int]$compressed.visualViewportHeight + 2) "keyboard-sized viewport left the composer below the visual viewport"
  Assert-True ([int]$compressed.scrollWidth -le [int]$compressed.clientWidth + 2) "keyboard-sized viewport introduced horizontal overflow"
  Assert-True ($compressed.route -eq $before.route) "keyboard-sized viewport changed the active thread route"
  Assert-True ($compressed.sidebarCollapsedPreference -eq "0") "keyboard-sized viewport changed the desktop sidebar preference"

  Invoke-AgentBrowser -Arguments @(
    "--session", $Session, "set", "viewport",
    ([string][int]$before.width), ([string][int]$before.height)
  ) | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "250") | Out-Null

  $restored = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const input = document.querySelector('.thread-composer-input');
  const composer = document.querySelector('.composer-with-queue');
  const rect = composer?.getBoundingClientRect();
  return {
    focused: document.activeElement === input,
    width: window.innerWidth,
    height: window.innerHeight,
    composerBottom: rect ? Math.round(rect.bottom) : 0,
    route: window.location.hash
  };
})())
'@
  Assert-True ([int]$restored.width -eq [int]$before.width -and [int]$restored.height -eq [int]$before.height) "mobile viewport did not restore after keyboard compression"
  Assert-True ($restored.focused -eq $true) "restoring the mobile viewport lost composer focus"
  Assert-True ([int]$restored.composerBottom -le [int]$restored.height + 2) "restored mobile viewport left the composer outside the screen"
  Assert-True ($restored.route -eq $before.route) "restoring the mobile viewport changed the active thread route"
}

function Assert-MobileBackDismissesSidebarDialog {
  param([string]$Session)

  $menuRequested = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const row = document.querySelector('.mobile-drawer .thread-row');
  if (!(row instanceof HTMLElement)) return { requested: false };
  row.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    button: 2,
    buttons: 2
  }));
  return { requested: true };
})())
'@
  Assert-True ($menuRequested.requested -eq $true) "mobile sidebar has no thread row for dialog Back verification"
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "100") | Out-Null

  $opened = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const menu = Array.from(document.querySelectorAll('.thread-menu-panel')).find((candidate) => {
    const rect = candidate.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  const archiveButton = Array.from(menu?.querySelectorAll('[role="menuitem"]') || []).find((button) => button.textContent?.trim() === '归档会话') || null;
  if (archiveButton instanceof HTMLElement) archiveButton.click();
  return { opened: archiveButton instanceof HTMLElement };
})())
'@
  Assert-True ($opened.opened -eq $true) "mobile sidebar could not open its archive confirmation"
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "100") | Out-Null

  $back = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const dialogBefore = !!document.querySelector('[role="dialog"][aria-label="归档会话"]');
  const prevented = !window.dispatchEvent(new CustomEvent('codex-mobile-back-button', { cancelable: true }));
  return { dialogBefore, prevented };
})())
'@
  Assert-True ($back.dialogBefore -eq $true) "mobile sidebar archive confirmation did not render"
  Assert-True ($back.prevented -eq $true) "Android back was not claimed by the mobile sidebar dialog"
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "100") | Out-Null

  $closed = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify({
  dialog: !!document.querySelector('[role="dialog"][aria-label="归档会话"]'),
  drawer: !!document.querySelector('.mobile-drawer'),
  route: window.location.hash,
  sidebarCollapsedPreference: window.localStorage.getItem('codex-web-local.sidebar-collapsed.v1')
})
'@
  Assert-True ($closed.dialog -eq $false) "Android back left the mobile sidebar dialog open"
  Assert-True ($closed.drawer -eq $true) "Android back closed the drawer underneath its child dialog"
  Assert-True ($closed.route -eq "#/") "closing the mobile sidebar dialog changed route: $($closed.route)"
  Assert-True ($closed.sidebarCollapsedPreference -eq "0") "closing the mobile sidebar dialog changed the desktop sidebar preference"
}

function Assert-MobileBackDismissesSkillDetail {
  param([string]$Session)

  $skillState = $null
  for ($attempt = 0; $attempt -lt 50; $attempt += 1) {
    $skillState = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify({
  hasCard: !!document.querySelector('.skill-card'),
  loading: !!document.querySelector('[aria-label="正在加载技能"]'),
  error: document.querySelector('.skills-hub-error')?.textContent?.trim() || ''
})
'@
    if ($skillState.hasCard -eq $true) {
      break
    }
    Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "100") | Out-Null
  }
  Assert-True ($skillState.hasCard -eq $true) "skills route has no detail card for Back verification (loading=$($skillState.loading), error=$($skillState.error))"

  $opened = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const card = document.querySelector('.skill-card');
  if (card instanceof HTMLElement) card.click();
  return { opened: card instanceof HTMLElement };
})())
'@
  Assert-True ($opened.opened -eq $true) "skills route could not open its available detail card"
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "100") | Out-Null

  $back = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const dialogBefore = !!document.querySelector('.sdm-panel[role="dialog"]');
  const routeBefore = window.location.hash;
  const prevented = !window.dispatchEvent(new CustomEvent('codex-mobile-back-button', { cancelable: true }));
  return { dialogBefore, routeBefore, prevented };
})())
'@
  Assert-True ($back.dialogBefore -eq $true) "skill detail dialog did not render"
  Assert-True ($back.prevented -eq $true) "Android back was not claimed by skill details"
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "100") | Out-Null

  $closed = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify({
  dialog: !!document.querySelector('.sdm-panel[role="dialog"]'),
  route: window.location.hash
})
'@
  Assert-True ($closed.dialog -eq $false) "Android back left skill details open"
  Assert-True ($closed.route -eq $back.routeBefore) "closing skill details changed route: $($closed.route)"
}

function Assert-MobileBackDismissesComposerSurface {
  param([string]$Session)

  $openState = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const button = document.querySelector('button[aria-label="展开为半屏长文输入框"]');
  if (button instanceof HTMLElement) button.click();
  return { clicked: button instanceof HTMLElement };
})())
'@
  Assert-True ($openState.clicked -eq $true) "mobile composer expand control is missing"
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "100") | Out-Null

  $expandedState = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify({
  expanded: !!document.querySelector('.thread-composer-shell--expanded'),
  prevented: !window.dispatchEvent(new CustomEvent('codex-mobile-back-button', { cancelable: true }))
})
'@
  Assert-True ($expandedState.expanded -eq $true) "mobile composer did not expand"
  Assert-True ($expandedState.prevented -eq $true) "Android back was not claimed by the expanded composer"
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "100") | Out-Null

  $closedState = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify({
  expanded: !!document.querySelector('.thread-composer-shell--expanded'),
  route: window.location.hash
})
'@
  Assert-True ($closedState.expanded -eq $false) "Android back did not collapse the expanded composer"
  Assert-True ($closedState.route -eq "#/") "closing the expanded composer unexpectedly changed route: $($closedState.route)"
}

function Assert-MobileBackDismissesFavoritesModal {
  param([string]$Session)

  $opened = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const button = document.querySelector('.content-favorites-button');
  const state = {
    clicked: button instanceof HTMLButtonElement,
    routeBefore: window.location.hash,
    overflowBefore: document.body.style.overflow
  };
  if (button instanceof HTMLButtonElement) button.click();
  return state;
})())
'@
  Assert-True ($opened.clicked -eq $true) "mobile Favorites control is missing"
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "100") | Out-Null

  $visible = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify({
  panelCount: document.querySelectorAll('.favorites-panel').length,
  panelFocused: document.activeElement?.classList.contains('favorites-panel') === true,
  bodyOverflow: document.body.style.overflow
})
'@
  Assert-True ([int]$visible.panelCount -eq 1) "Favorites modal did not open"
  Assert-True ($visible.panelFocused -eq $true) "Favorites modal did not take focus from the underlying page"
  Assert-True ($visible.bodyOverflow -eq "hidden") "Favorites modal did not lock background scrolling"

  $back = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify({
  prevented: !window.dispatchEvent(new CustomEvent('codex-mobile-back-button', { cancelable: true }))
})
'@
  Assert-True ($back.prevented -eq $true) "Android Back was not claimed by Favorites"
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "100") | Out-Null

  $closed = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify({
  panelCount: document.querySelectorAll('.favorites-panel').length,
  routeAfter: window.location.hash,
  bodyOverflow: document.body.style.overflow
})
'@
  Assert-True ([int]$closed.panelCount -eq 0) "Android Back left Favorites open"
  Assert-True ($closed.routeAfter -eq $opened.routeBefore) "closing Favorites changed route: $($closed.routeAfter)"
  Assert-True ($closed.bodyOverflow -eq $opened.overflowBefore) "closing Favorites did not restore background scrolling"
}

function Assert-BlockingDialogEnvironment {
  param([string]$Session)

  foreach ($kind in @('desktop-refresh', 'queued-edit', 'mobile-update')) {
    $openScript = @"
JSON.stringify((() => {
  const input = document.querySelector('.thread-composer-input');
  if (input instanceof HTMLElement) input.focus();
  const routeBefore = window.location.hash;
  const overflowBefore = document.body.style.overflow;
  window.dispatchEvent(new CustomEvent('cx-codex-regression-open-blocking-dialog', {
    detail: { kind: '$kind' }
  }));
  return { inputFound: input instanceof HTMLElement, routeBefore, overflowBefore };
})())
"@
    $opened = Invoke-BrowserEvalJson -Session $Session -Script $openScript
    Assert-True ($opened.inputFound -eq $true) "$kind regression could not focus the underlying composer"
    Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "100") | Out-Null

    $visible = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const dialog = document.querySelector('.mobile-update-confirm-dialog, .desktop-refresh-confirm-dialog');
  return {
    dialogCount: document.querySelectorAll('.mobile-update-confirm-dialog, .desktop-refresh-confirm-dialog').length,
    dialogFocused: document.activeElement === dialog,
    bodyOverflow: document.body.style.overflow,
    route: window.location.hash
  };
})())
'@
    Assert-True ([int]$visible.dialogCount -eq 1) "$kind regression did not open exactly one blocking dialog"
    Assert-True ($visible.dialogFocused -eq $true) "$kind blocking dialog did not take focus from the underlying composer"
    Assert-True ($visible.bodyOverflow -eq 'hidden') "$kind blocking dialog did not lock background scrolling"
    Assert-True ($visible.route -eq $opened.routeBefore) "$kind blocking dialog changed route while opening"

    $back = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify({
  prevented: !window.dispatchEvent(new CustomEvent('codex-mobile-back-button', { cancelable: true }))
})
'@
    Assert-True ($back.prevented -eq $true) "Android Back was not claimed by $kind blocking dialog"
    Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "100") | Out-Null

    $closed = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify({
  dialogCount: document.querySelectorAll('.mobile-update-confirm-dialog, .desktop-refresh-confirm-dialog').length,
  composerFocused: document.activeElement?.classList.contains('thread-composer-input') === true,
  bodyOverflow: document.body.style.overflow,
  route: window.location.hash
})
'@
    Assert-True ([int]$closed.dialogCount -eq 0) "Android Back left $kind blocking dialog open"
    Assert-True ($closed.composerFocused -eq $true) "$kind blocking dialog did not restore the previous focus"
    Assert-True ($closed.bodyOverflow -eq $opened.overflowBefore) "$kind blocking dialog did not restore background scrolling"
    Assert-True ($closed.route -eq $opened.routeBefore) "closing $kind blocking dialog changed route"
  }
}

function Assert-ArchiveUndoToast {
  param([string]$Session)

  $opened = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  window.dispatchEvent(new CustomEvent('cx-codex-regression-open-blocking-dialog', {
    detail: { kind: 'archive-undo' }
  }));
  return { route: window.location.hash };
})())
'@
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "100") | Out-Null

  $visible = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const toast = document.querySelector('.product-toast');
  const action = toast?.querySelector('.product-toast-action');
  const close = toast?.querySelector('.product-toast-close');
  const message = toast?.querySelector('.product-toast-message');
  const toastRect = toast?.getBoundingClientRect();
  const actionRect = action?.getBoundingClientRect();
  const messageRect = message?.getBoundingClientRect();
  return {
    role: toast?.getAttribute('role') || '',
    message: toast?.querySelector('.product-toast-message')?.textContent?.trim() || '',
    actionLabel: action?.textContent?.trim() || '',
    closeLabel: close?.getAttribute('aria-label') || '',
    actionHeight: actionRect ? Math.round(actionRect.height) : 0,
    messageSingleLine: !!messageRect && messageRect.height <= 24,
    fitsViewport: !!toastRect && toastRect.left >= -2 && toastRect.right <= window.innerWidth + 2 && toastRect.top >= -2 && toastRect.bottom <= window.innerHeight + 2,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    route: window.location.hash
  };
})())
'@
  Assert-True ($visible.role -eq 'status') "archive undo feedback must be announced as a non-error status"
  Assert-True ($visible.message -eq '会话已移到归档。') "archive undo feedback is missing its truthful completion message"
  Assert-True ($visible.actionLabel -eq '撤销') "archive feedback is missing the immediate undo action"
  Assert-True ($visible.closeLabel -eq '关闭提示') "archive undo feedback cannot be dismissed independently"
  Assert-True ([int]$visible.actionHeight -ge 44) "archive undo action is smaller than the mobile touch target"
  Assert-True ($visible.messageSingleLine -eq $true) "archive undo message wraps awkwardly beside its actions on a phone"
  Assert-True ($visible.fitsViewport -eq $true -and $visible.overflow -eq $false) "archive undo feedback does not fit the phone viewport"
  Assert-True ($visible.route -eq $opened.route) "archive feedback changed route before the user chose an action"

  Invoke-AgentBrowser -Arguments @("--session", $Session, "click", ".product-toast-action") | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "100") | Out-Null
  $restored = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify({
  message: document.querySelector('.product-toast-message')?.textContent?.trim() || '',
  actionCount: document.querySelectorAll('.product-toast-action').length,
  route: window.location.hash
})
'@
  Assert-True ($restored.message -eq '会话已恢复。') "archive undo did not replace the toast with restoration feedback"
  Assert-True ([int]$restored.actionCount -eq 0) "completed archive undo left a stale action visible"
  Assert-True ($restored.route -eq $opened.route) "archive undo changed the current route"
}

function Read-ConversationFixtureMetrics {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const codeBlocks = Array.from(document.querySelectorAll('.message-code-block'));
  const copyButtons = Array.from(document.querySelectorAll('.message-code-copy'));
  const fileCards = Array.from(document.querySelectorAll('.message-file-card'));
  const rawCards = Array.from(document.querySelectorAll('.message-structured-card'));
  const commandRows = Array.from(document.querySelectorAll('.cmd-row'));
  const commandOutputWraps = Array.from(document.querySelectorAll('.cmd-output-wrap'));
  const requestCards = Array.from(document.querySelectorAll('.request-card'));
  const permissionPanels = Array.from(document.querySelectorAll('.request-permission-panel'));
  const toolPanels = Array.from(document.querySelectorAll('.request-tool-panel'));
  const requestButtons = Array.from(document.querySelectorAll('.request-button'));
  const tableScrolls = Array.from(document.querySelectorAll('.message-table-scroll'));
  const tableCardGroups = Array.from(document.querySelectorAll('.message-table-cards'));
  const tableCards = Array.from(document.querySelectorAll('.message-table-card'));
  const tableScrollableCount = tableScrolls.filter((node) => node.scrollWidth > node.clientWidth + 2).length;
  const tableFontSizes = tableScrolls.flatMap((node) => Array.from(node.querySelectorAll('th, td')))
    .map((node) => Number.parseFloat(window.getComputedStyle(node).fontSize || '0'));
  const runtimeStatusBars = Array.from(document.querySelectorAll('.conversation-regression-fixture .runtime-status-bar'));
  const runtimeStatusHeights = runtimeStatusBars.map((node) => Math.round(node.getBoundingClientRect().height));
  const queuedPanels = Array.from(document.querySelectorAll('.conversation-regression-fixture .queued-messages-inner'));
  const queuedRows = Array.from(document.querySelectorAll('.conversation-regression-fixture .queued-row'));
  const chromeTargets = Array.from(document.querySelectorAll([
    '.conversation-regression-fixture .runtime-status-bar',
    '.conversation-regression-fixture .queued-messages-inner',
    '.conversation-regression-fixture .queued-row',
    '.conversation-regression-fixture .live-overlay-inline',
    '.conversation-regression-fixture .message-card',
    '.conversation-regression-fixture .message-table-scroll',
    '.conversation-regression-fixture .message-table-card',
    '.conversation-regression-fixture .message-structured-card',
    '.conversation-regression-fixture .message-structured-pre',
    '.conversation-regression-fixture .message-text-flow--long-collapsed',
    '.conversation-regression-fixture .guided-turn-toggle'
  ].join(',')));
  const warmBackgrounds = new Set([
    'rgb(255, 253, 248)',
    'rgb(255, 252, 247)',
    'rgb(255, 250, 243)',
    'rgb(255, 250, 242)',
    'rgb(255, 249, 238)',
    'rgb(255, 248, 223)',
    'rgb(247, 243, 234)',
    'rgb(247, 241, 229)',
    'rgb(248, 244, 236)',
    'rgb(241, 235, 222)'
  ]);
  const firstCopyButton = copyButtons[0];
  const firstCommandRow = commandRows[0];
  const firstRequestCard = requestCards[0];
  const firstPermissionPanel = permissionPanels[0];
  const firstToolPanel = toolPanels[0];
  const commandRowRadius = firstCommandRow ? Number.parseFloat(window.getComputedStyle(firstCommandRow).borderTopLeftRadius || '0') : 0;
  const requestCardRadius = firstRequestCard ? Number.parseFloat(window.getComputedStyle(firstRequestCard).borderTopLeftRadius || '0') : 0;
  const permissionPanelRadius = firstPermissionPanel ? Number.parseFloat(window.getComputedStyle(firstPermissionPanel).borderTopLeftRadius || '0') : 0;
  const toolPanelRadius = firstToolPanel ? Number.parseFloat(window.getComputedStyle(firstToolPanel).borderTopLeftRadius || '0') : 0;
  const chromeStyles = chromeTargets.map((node) => {
    const style = window.getComputedStyle(node);
    return {
      className: node.className || node.tagName,
      backgroundColor: style.backgroundColor,
      radius: Number.parseFloat(style.borderTopLeftRadius || '0')
    };
  });
  const chromeWarmBackgrounds = chromeStyles.filter((style) => warmBackgrounds.has(style.backgroundColor));
  const chromeMaxRadius = chromeStyles.length ? Math.max(...chromeStyles.map((style) => style.radius)) : 0;
  const fitTargets = Array.from(document.querySelectorAll([
    '.request-card',
    '.request-permission-panel',
    '.request-tool-panel',
    '.message-file-card',
    '.message-code-block',
    '.message-structured-card',
    '.runtime-status-bar',
    '.queued-messages-inner',
    '.queued-row',
    '.message-table-scroll',
    '.message-table-card',
    '.live-overlay-inline',
    '.cmd-row',
    '.cmd-output-wrap'
  ].join(',')));
  const viewportWidth = document.documentElement.clientWidth;
  const viewportFitFailures = fitTargets
    .map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        className: node.className || node.tagName,
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width)
      };
    })
    .filter((rect) => rect.left < -2 || rect.right > viewportWidth + 2);
  const textContent = document.body.textContent || '';
  return {
    codeBlockCount: codeBlocks.length,
    diffBlockCount: codeBlocks.filter((node) => node.getAttribute('data-diff') === 'true').length,
    copyButtonCount: copyButtons.length,
    fileCardCount: fileCards.length,
    rawPayloadCardCount: rawCards.length,
    commandRowCount: commandRows.length,
    commandOutputWrapCount: commandOutputWraps.length,
    expandedCommandOutputCount: commandOutputWraps.filter((node) => node.classList.contains('cmd-output-visible')).length,
    commandRowRadius,
    requestCardCount: requestCards.length,
    permissionPanelCount: permissionPanels.length,
    toolPanelCount: toolPanels.length,
    requestButtonCount: requestButtons.length,
    tableScrollCount: tableScrolls.length,
    tableCardGroupCount: tableCardGroups.length,
    tableCardCount: tableCards.length,
    tableScrollableCount,
    tableMaxFontSize: tableFontSizes.length ? Math.max(...tableFontSizes) : 0,
    runtimeStatusBarCount: runtimeStatusBars.length,
    runtimeStatusMaxHeight: runtimeStatusHeights.length ? Math.max(...runtimeStatusHeights) : 0,
    viewportWidth,
    queuedPanelCount: queuedPanels.length,
    queuedRowCount: queuedRows.length,
    conversationChromeWarmBackgroundCount: chromeWarmBackgrounds.length,
    conversationChromeWarmBackgrounds: chromeWarmBackgrounds.slice(0, 5),
    conversationChromeMaxRadius: chromeMaxRadius,
    requestCardRadius,
    permissionPanelRadius,
    toolPanelRadius,
    hasAddLine: !!document.querySelector('.message-code-line[data-kind="add"]'),
    hasDeleteLine: !!document.querySelector('.message-code-line[data-kind="delete"]'),
    hasMetaLine: !!document.querySelector('.message-code-line[data-kind="meta"]'),
    hasLatestTurnPromptContext: textContent.includes('请审查这些文件，并说明代码块'),
    hasFixtureCodeText: textContent.includes('fixture-code-block'),
    hasFixtureRawText: textContent.includes('fixture-raw-payload'),
    hasOptimisticInternalText: textContent.includes('userMessage.optimistic') || textContent.includes('optimisticUserMessage'),
    sendingDeliveryStateCount: document.querySelectorAll('.message-delivery-state[data-state="sending"]').length,
    failedDeliveryStateCount: document.querySelectorAll('.message-delivery-state[data-state="failed"]').length,
    retryingDeliveryStateCount: document.querySelectorAll('.message-delivery-state[data-state="retrying"]').length,
    waitingDeliveryStateCount: document.querySelectorAll('.message-delivery-state[data-state="waiting"]').length,
    confirmingDeliveryStateCount: document.querySelectorAll('.message-delivery-state[data-state="confirming"]').length,
    sentDeliveryStateCount: document.querySelectorAll('.message-delivery-state[data-state="sent"]').length,
    failedDeliveryRetryCount: document.querySelectorAll('.message-delivery-retry').length,
    hasBoundedReconnectText: textContent.includes('正在重连 1/4'),
    hasWaitingDeliveryText: textContent.includes('等待网络'),
    hasConfirmingDeliveryText: textContent.includes('确认中'),
    hasStableLiveElapsedTime: /已(?:等待|运行)\s+(?:[6-9]|[1-9]\d+)\s*秒/.test(textContent) || /正在(?:运行|处理)(?:\s*·)?\s*(?:[6-9]|[1-9]\d+)\s*秒/.test(textContent),
    interruptedTurnCardCount: document.querySelectorAll('.interrupted-turn-card').length,
    interruptedTurnEditCount: document.querySelectorAll('.interrupted-turn-edit').length,
    hasHiddenUnhandledNoise: textContent.includes('fixture-hidden-file-change-noise') || textContent.includes('Unhandled App Server item: fileChange') || textContent.includes('unhandled.fileChange') || textContent.includes('fixture-hidden-web-search-noise') || textContent.includes('Unhandled App Server item: webSearch') || textContent.includes('unhandled.webSearch') || textContent.includes('未适配的 App Server 内容'),
    hasFixtureCommandText: textContent.includes('fixture-command-output: ok'),
    hasFixtureCommandLabel: textContent.includes('npm.cmd run test:7420:frontend'),
    hasFixturePermissionText: textContent.includes('fixture-permission-workbench'),
    hasFixtureToolCallText: textContent.includes('fixture-tool-call-workbench') || textContent.includes('Browser tool call cannot be executed directly'),
    hasPermissionServerText: textContent.includes('GitHub'),
    hasPermissionToolText: textContent.includes('github_update_pull_request'),
    hasPermissionTargetText: textContent.includes('Qjzn/CX-Codex') && textContent.includes('关闭'),
    hasToolCallActionText: textContent.includes('让 Codex 改用文字继续'),
    hasPermissionActionText: textContent.includes('仅本次允许') && textContent.includes('本会话允许') && textContent.includes('始终允许此工具') && textContent.includes('拒绝'),
    loadMoreButtonText: document.querySelector('.conversation-load-more-button')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    loadMoreButtonDisabled: document.querySelector('.conversation-load-more-button')?.disabled === true,
    olderHistoryRequestCount: Number(document.querySelector('.conversation-regression-older-history-count')?.getAttribute('data-count') || '0'),
    firstCopyButtonText: firstCopyButton ? firstCopyButton.textContent.trim() : '',
    hasEmojiFileIcon: document.body.innerText.includes('📄'),
    hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    structuredViewportFitFailureCount: viewportFitFailures.length,
    structuredViewportFitFailures: viewportFitFailures.slice(0, 5),
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  };
})())
'@
  return Invoke-BrowserEvalJson -Session $Session -Script $script
}

function Assert-ConversationStreamingResponsiveness {
  param([string]$Session)

  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "3000") | Out-Null
  $before = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const status = document.querySelector('[data-testid="conversation-streaming-stress-status"]');
  return {
    found: Boolean(status),
    updateCount: Number.parseInt(status?.getAttribute('data-update-count') || '0', 10),
    heartbeatCount: Number.parseInt(status?.getAttribute('data-heartbeat-count') || '0', 10),
    maxHeartbeatLagMs: Number.parseInt(status?.getAttribute('data-max-heartbeat-lag-ms') || '0', 10),
    actionCount: Number.parseInt(status?.getAttribute('data-action-count') || '0', 10),
    mountedConversationItems: document.querySelectorAll('.conversation-list > .conversation-item').length,
    totalMessageCount: Number.parseInt(document.querySelector('.conversation-list')?.getAttribute('data-message-count') || '0', 10)
  };
})())
'@
  Assert-True ($before.found -eq $true) "streaming stress fixture status is missing"
  Assert-True ([int]$before.updateCount -ge 20) "streaming stress fixture did not sustain live message updates"
  Assert-True ([int]$before.heartbeatCount -ge 20) "streaming stress fixture event-loop heartbeat stopped"
  Assert-True ([int]$before.maxHeartbeatLagMs -le 250) "streaming updates blocked the UI event loop for $($before.maxHeartbeatLagMs) ms"
  Assert-True ([int]$before.totalMessageCount -ge 1500) "streaming stress fixture did not exercise a dense active turn"
  Assert-True ([int]$before.mountedConversationItems -le 48) "streaming stress fixture mounted too many conversation items"

  Invoke-AgentBrowser -Arguments @("--session", $Session, "click", '[data-testid="conversation-streaming-stress-action"]') | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "150") | Out-Null
  $after = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const status = document.querySelector('[data-testid="conversation-streaming-stress-status"]');
  return {
    actionCount: Number.parseInt(status?.getAttribute('data-action-count') || '0', 10),
    updateCount: Number.parseInt(status?.getAttribute('data-update-count') || '0', 10)
  };
})())
'@
  Assert-True ([int]$after.actionCount -eq ([int]$before.actionCount + 1)) "streaming stress fixture did not accept a user action while output was active"
  Assert-True ([int]$after.updateCount -gt [int]$before.updateCount) "streaming output stopped while the user interacted with the page"
  Write-Step ("conversation streaming responsiveness -> " + ($before | ConvertTo-Json -Compress))
}

function Read-ConversationLoadFailureFixtureMetrics {
  param([string]$Session)

  return Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const card = document.querySelector('.conversation-load-error');
  const actions = Array.from(document.querySelectorAll('.conversation-load-error-action'));
  const text = card?.textContent?.replace(/\s+/g, ' ').trim() || '';
  return {
    cardCount: document.querySelectorAll('.conversation-load-error').length,
    emptyStateCount: document.querySelectorAll('.conversation-empty-state').length,
    actionCount: actions.length,
    actionLabels: actions.map((node) => node.textContent?.trim() || ''),
    minimumActionHeight: actions.length
      ? Math.min(...actions.map((node) => Math.round(node.getBoundingClientRect().height)))
      : 0,
    hasFriendlyCopy: text.includes('会话内容未加载') && text.includes('连接不到桌面端'),
    hasRawFetchError: text.includes('Failed to fetch'),
    retryCount: Number(document.querySelector('.conversation-regression-load-retry-count')?.getAttribute('data-count') || '0'),
    connectionSettingsCount: Number(document.querySelector('.conversation-regression-connection-settings-count')?.getAttribute('data-count') || '0'),
    hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
  };
})())
'@
}

function Assert-ConversationLoadFailureFixture {
  param([string]$Session)

  $before = Read-ConversationLoadFailureFixtureMetrics -Session $Session
  Assert-True ([int]$before.cardCount -eq 1) "conversation load failure fixture must render one recovery card"
  Assert-True ([int]$before.emptyStateCount -eq 0) "conversation load failure must not be presented as an empty conversation"
  Assert-True ($before.hasFriendlyCopy -eq $true) "conversation load failure fixture is missing actionable Chinese recovery copy"
  Assert-True ($before.hasRawFetchError -eq $false) "conversation load failure fixture leaked the raw Failed to fetch error"
  Assert-True ([int]$before.actionCount -eq 2) "conversation load failure fixture must expose retry and connection settings actions"
  Assert-True (($before.actionLabels -join '|') -match '重新连接' -and ($before.actionLabels -join '|') -match '修改地址') "conversation load failure actions drifted"
  Assert-True ([int]$before.minimumActionHeight -ge 44) "conversation load failure actions must keep a 44px mobile touch target"
  Assert-True ($before.hasHorizontalOverflow -eq $false) "conversation load failure fixture overflowed horizontally"

  Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  document.querySelector('.conversation-load-error-action-primary')?.click();
  document.querySelector('.conversation-load-error-action:not(.conversation-load-error-action-primary)')?.click();
  return { clicked: true };
})())
'@ | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "100") | Out-Null

  $after = Read-ConversationLoadFailureFixtureMetrics -Session $Session
  Assert-True ([int]$after.retryCount -eq 1) "conversation load failure retry action did not emit exactly once"
  Assert-True ([int]$after.connectionSettingsCount -eq 1) "conversation load failure settings action did not emit exactly once"
}

function Assert-ConversationTailStatusFixture {
  param([string]$Session)

  $beforeScript = @'
JSON.stringify((() => {
  const overlay = document.querySelector('.live-overlay-inline');
  const compact = document.querySelector('.live-overlay-inline-compact');
  const streamingMessage = document.querySelector('[data-message-id="fixture-streaming-assistant-tail"]');
  const textContent = document.body.textContent || '';
  const overlayRect = overlay?.getBoundingClientRect();
  const streamingRect = streamingMessage?.getBoundingClientRect();
  return {
    overlayCount: document.querySelectorAll('.live-overlay-inline').length,
    compactCount: document.querySelectorAll('.live-overlay-inline-compact').length,
    detailedSheetCount: document.querySelectorAll('.live-overlay-detail-sheet').length,
    visibleRunningCommandRowCount: Array.from(document.querySelectorAll('.conversation-item[data-message-type="commandExecution"] .cmd-row')).filter((node) => node.textContent?.includes('npm.cmd run verify:frontend-normalizers')).length,
    statusFollowsStreamingReply: Boolean(overlayRect && streamingRect && overlayRect.top >= streamingRect.bottom - 1),
    statusFollowsStreamingReplyInDom: Boolean(
      overlay && streamingMessage && (streamingMessage.compareDocumentPosition(overlay) & Node.DOCUMENT_POSITION_FOLLOWING)
    ),
    hasUnifiedStatusLabel: textContent.includes('正在处理 ·'),
    hasLatestExecutionHint: textContent.includes('正在执行最新操作'),
    hasStreamingReply: textContent.includes('回复仍在继续生成，不应让运行状态消失'),
    hasStableElapsedTime: /正在处理\s*·\s*(?:[6-9]|[1-9]\d+)\s*秒/.test(textContent),
    bodyOverflowBefore: document.body.style.overflow
  };
})())
'@
  $before = Invoke-BrowserEvalJson -Session $Session -Script $beforeScript
  Assert-True ([int]$before.overlayCount -eq 1) "conversation tail status must render exactly one active surface"
  Assert-True ([int]$before.compactCount -eq 1) "conversation tail status is not collapsed by default"
  Assert-True ([int]$before.detailedSheetCount -eq 0) "conversation tail status opened details without user action"
  Assert-True ([int]$before.visibleRunningCommandRowCount -eq 0) "conversation tail status duplicated the current command in message history"
  Assert-True ($before.statusFollowsStreamingReply -eq $true) "conversation tail status is not visually placed after the streaming reply"
  Assert-True ($before.statusFollowsStreamingReplyInDom -eq $true) "conversation tail status is not placed after the streaming reply in DOM reading order"
  Assert-True ($before.hasUnifiedStatusLabel -eq $true) "conversation tail status is missing the unified processing label"
  Assert-True ($before.hasLatestExecutionHint -eq $true) "conversation tail status is missing the latest execution hint"
  Assert-True ($before.hasStreamingReply -eq $true) "conversation tail status fixture is missing streaming reply content"
  Assert-True ($before.hasStableElapsedTime -eq $true) "conversation tail status disappeared or reset elapsed time after a transient overlay gap"

  $openScript = @'
JSON.stringify((() => {
  const button = document.querySelector('.live-overlay-compact-main');
  if (!(button instanceof HTMLButtonElement)) return { clicked: false };
  button.click();
  return { clicked: true };
})())
'@
  $openResult = Invoke-BrowserEvalJson -Session $Session -Script $openScript
  Assert-True ($openResult.clicked -eq $true) "conversation tail status could not be opened"
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "150") | Out-Null

  $afterScript = @'
JSON.stringify((() => {
  const sheet = document.querySelector('.live-overlay-detail-sheet');
  const textContent = sheet?.textContent || '';
  return {
    sheetCount: document.querySelectorAll('.live-overlay-detail-sheet').length,
    sheetFocused: document.activeElement === sheet,
    bodyOverflow: document.body.style.overflow,
    hasCurrentCommand: textContent.includes('npm.cmd run verify:frontend-normalizers'),
    hasCurrentOutput: textContent.includes('fixture-current-command: running'),
    hasHistoricalCommand: textContent.includes('npm.cmd run test:7420:frontend')
  };
})())
'@
  $after = Invoke-BrowserEvalJson -Session $Session -Script $afterScript
  Assert-True ([int]$after.sheetCount -eq 1) "conversation tail status did not open one detail sheet"
  Assert-True ($after.sheetFocused -eq $true) "conversation tail detail did not take focus from the underlying page"
  Assert-True ($after.bodyOverflow -eq "hidden") "conversation tail detail did not lock background scrolling"
  Assert-True ($after.hasCurrentCommand -eq $true) "conversation tail detail is missing the current command"
  Assert-True ($after.hasCurrentOutput -eq $true) "conversation tail detail is missing current command output"
  Assert-True ($after.hasHistoricalCommand -eq $false) "conversation tail detail mixed historical execution into the current status"

  $backResult = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const routeBefore = window.location.hash;
  const event = new CustomEvent('codex-mobile-back-button', { cancelable: true });
  window.dispatchEvent(event);
  return {
    prevented: event.defaultPrevented,
    routeBefore
  };
})())
'@
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "100") | Out-Null
  $afterBack = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify({
  routeAfter: window.location.hash,
  sheetCount: document.querySelectorAll('.live-overlay-detail-sheet').length,
  compactCount: document.querySelectorAll('.live-overlay-compact-main').length,
  bodyOverflow: document.body.style.overflow
})
'@
  Assert-True ($backResult.prevented -eq $true) "Android Back was not consumed by the topmost conversation detail"
  Assert-True ([int]$afterBack.sheetCount -eq 0) "Android Back did not close the topmost conversation detail"
  Assert-True ([string]$afterBack.routeAfter -eq [string]$backResult.routeBefore) "Android Back changed route while closing conversation detail"
  Assert-True ([int]$afterBack.compactCount -eq 1) "conversation tail status disappeared after closing its detail"
  Assert-True ([string]$afterBack.bodyOverflow -eq [string]$before.bodyOverflowBefore) "conversation tail detail did not restore background scrolling"
}

function Assert-ConversationNewActivityTimerFixture {
  param([string]$Session)

  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "500") | Out-Null
  $script = @'
JSON.stringify((() => {
  const text = document.querySelector('.live-overlay-inline')?.textContent?.replace(/\s+/g, ' ').trim() || '';
  const match = text.match(/正在处理\s*·\s*(?:(\d+)\s*分\s*)?(\d+)\s*秒/);
  return {
    overlayCount: document.querySelectorAll('.live-overlay-inline').length,
    elapsedSeconds: text.includes('正在处理 · <1 秒')
      ? 0
      : match ? (Number(match[1] || '0') * 60 + Number(match[2] || '0')) : -1,
    text
  };
})())
'@
  $metrics = Invoke-BrowserEvalJson -Session $Session -Script $script
  Assert-True ([int]$metrics.overlayCount -eq 1) "new activity fixture must keep one active surface"
  Assert-True ([int]$metrics.elapsedSeconds -ge 0) "new activity fixture did not expose elapsed time"
  Assert-True ([int]$metrics.elapsedSeconds -lt 30) "a later activity inherited the previous five-minute timer: $($metrics.text)"
}

function Assert-ConversationResumeRecoveryFixture {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const overlay = document.querySelector('.live-overlay-inline-recovering');
  const ring = overlay?.querySelector('.live-overlay-indicator-ring');
  const text = overlay?.textContent?.replace(/\s+/g, ' ').trim() || '';
  return {
    overlayCount: document.querySelectorAll('.live-overlay-inline-recovering').length,
    ariaBusy: overlay?.getAttribute('aria-busy') || '',
    hasRecoveryLabel: text.includes('正在恢复任务'),
    hasRecoveryHint: text.includes('正在同步最新进度'),
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    ringAnimationName: ring ? getComputedStyle(ring).animationName : '',
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  };
})())
'@
  $metrics = Invoke-BrowserEvalJson -Session $Session -Script $script
  Assert-True ([int]$metrics.overlayCount -eq 1) "resume recovery fixture must render exactly one recovery surface"
  Assert-True ($metrics.ariaBusy -eq 'true') "resume recovery fixture must expose aria-busy"
  Assert-True ($metrics.hasRecoveryLabel -eq $true) "resume recovery fixture is missing the recovery label"
  Assert-True ($metrics.hasRecoveryHint -eq $true) "resume recovery fixture is missing the automatic-sync hint"
  if ($metrics.reducedMotion -eq $true) {
    Assert-True ($metrics.ringAnimationName -eq 'none') "resume recovery fixture must disable indicator animation when reduced motion is enabled"
  } else {
    Assert-True (-not [string]::IsNullOrWhiteSpace([string]$metrics.ringAnimationName) -and $metrics.ringAnimationName -ne 'none') "resume recovery fixture is missing the lightweight indicator animation"
  }
  Assert-True ([int]$metrics.scrollWidth -le [int]$metrics.width + 2) "resume recovery fixture introduced horizontal overflow"
}

function Wait-ConversationImagePreviewUiState {
  param(
    [string]$Session,
    [int]$ExpectedScale = -1,
    [int]$ExpectedDialogCount = -1
  )

  $state = $null
  for ($attempt = 1; $attempt -le 30; $attempt++) {
    $state = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => ({
  scale: Number.parseFloat(document.querySelector('.image-modal-scale')?.textContent || '0'),
  dialogCount: document.querySelectorAll('.image-modal-content').length
}))())
'@
    $scaleMatches = $ExpectedScale -lt 0 -or [int]$state.scale -eq $ExpectedScale
    $dialogMatches = $ExpectedDialogCount -lt 0 -or [int]$state.dialogCount -eq $ExpectedDialogCount
    if ($scaleMatches -and $dialogMatches) { return $state }
    Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '100') | Out-Null
  }

  throw "image preview state did not settle: expectedScale=$ExpectedScale, actualScale=$($state.scale), expectedDialogCount=$ExpectedDialogCount, actualDialogCount=$($state.dialogCount)"
}

function Assert-ConversationImagePreviewGestures {
  param([string]$Session)

  $imagePrepared = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const image = document.querySelector('[data-message-id="fixture-image-preview-gestures"] .message-image-preview');
  image?.scrollIntoView({ block: 'center' });
  return { found: image instanceof HTMLImageElement };
})())
'@
  Assert-True ($imagePrepared.found -eq $true) "image preview gesture fixture is missing its deterministic image"
  $imageReady = $null
  for ($attempt = 1; $attempt -le 30; $attempt++) {
    $imageReady = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const image = document.querySelector('[data-message-id="fixture-image-preview-gestures"] .message-image-preview');
  return {
    loaded: image instanceof HTMLImageElement
      && image.complete
      && image.naturalWidth > 0
      && image.classList.contains('is-loaded'),
    complete: image instanceof HTMLImageElement && image.complete,
    naturalWidth: image instanceof HTMLImageElement ? image.naturalWidth : 0
  };
})())
'@
    if ($imageReady.loaded -eq $true) { break }
    Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '100') | Out-Null
  }
  Assert-True ($imageReady.loaded -eq $true) "image preview gesture fixture did not settle its cached image: complete=$($imageReady.complete), naturalWidth=$($imageReady.naturalWidth)"

  $opened = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const trigger = document.querySelector('[data-message-id="fixture-image-preview-gestures"] .message-image-button');
  if (!(trigger instanceof HTMLButtonElement)) return { opened: false };
  trigger.click();
  return { opened: true };
})())
'@
  Assert-True ($opened.opened -eq $true) "image preview gesture fixture could not open its image"
  Wait-ConversationImagePreviewUiState -Session $Session -ExpectedScale 100 -ExpectedDialogCount 1 | Out-Null

  $initialControls = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const zoomOut = document.querySelector('[aria-label="缩小图片"]');
  const reset = document.querySelector('[aria-label="重置图片缩放"]');
  const zoomIn = document.querySelector('[aria-label="放大图片"]');
  return {
    zoomOutDisabled: zoomOut instanceof HTMLButtonElement && zoomOut.disabled,
    resetDisabled: reset instanceof HTMLButtonElement && reset.disabled,
    zoomInEnabled: zoomIn instanceof HTMLButtonElement && !zoomIn.disabled
  };
})())
'@
  Assert-True ($initialControls.zoomOutDisabled -eq $true) "image preview zoom-out control must be disabled at its minimum"
  Assert-True ($initialControls.resetDisabled -eq $true) "image preview reset control must be disabled at 100%"
  Assert-True ($initialControls.zoomInEnabled -eq $true) "image preview zoom-in control must remain enabled below its maximum"

  $ctrlWheelDispatch = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const stage = document.querySelector('.image-modal-stage');
  const content = document.querySelector('.image-modal-content');
  if (!(stage instanceof HTMLElement) || !(content instanceof HTMLElement)) return { dispatched: false };
  let bubbled = 0;
  const onBubble = () => { bubbled += 1; };
  content.addEventListener('wheel', onBubble);
  const bounds = stage.getBoundingClientRect();
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    clientX: bounds.left + bounds.width * 0.75,
    clientY: bounds.top + bounds.height * 0.5,
    ctrlKey: true,
    deltaMode: WheelEvent.DOM_DELTA_PIXEL,
    deltaY: -12
  });
  stage.dispatchEvent(event);
  content.removeEventListener('wheel', onBubble);
  return { dispatched: true, defaultPrevented: event.defaultPrevented, bubbled };
})())
'@
  Assert-True ($ctrlWheelDispatch.dispatched -eq $true) "image preview ctrl-wheel probe did not find the modal surface"
  Assert-True ($ctrlWheelDispatch.defaultPrevented -eq $true) "image preview ctrl-wheel must prevent browser-level zoom"
  Assert-True ([int]$ctrlWheelDispatch.bubbled -eq 0) "image preview ctrl-wheel escaped its local modal surface"
  Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '100') | Out-Null

  $smoothZoom = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const scale = Number.parseFloat(document.querySelector('.image-modal-scale')?.textContent || '0');
  const image = document.querySelector('.image-modal-image');
  return {
    scale,
    transform: image instanceof HTMLElement ? image.style.transform : '',
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
  };
})())
'@
  Assert-True ([double]$smoothZoom.scale -gt 100 -and [double]$smoothZoom.scale -lt 125) "small ctrl-wheel input must zoom smoothly instead of jumping by a full 25% step: $($smoothZoom.scale)%"
  Assert-True (-not [string]::IsNullOrWhiteSpace([string]$smoothZoom.transform)) "smooth image zoom did not update the image transform"
  Assert-True ($smoothZoom.horizontalOverflow -eq $false) "image preview smooth zoom introduced page-level horizontal overflow"

  Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const reset = document.querySelector('.image-modal-scale');
  if (!(reset instanceof HTMLButtonElement)) return { reset: false };
  reset.click();
  return { reset: true };
})())
'@ | Out-Null
  Wait-ConversationImagePreviewUiState -Session $Session -ExpectedScale 100 -ExpectedDialogCount 1 | Out-Null

  $ordinaryWheelDispatch = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const stage = document.querySelector('.image-modal-stage');
  if (!(stage instanceof HTMLElement)) return { dispatched: false };
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120 });
  stage.dispatchEvent(event);
  return { dispatched: true, defaultPrevented: event.defaultPrevented };
})())
'@
  Assert-True ($ordinaryWheelDispatch.dispatched -eq $true -and $ordinaryWheelDispatch.defaultPrevented -eq $true) "ordinary image-preview wheel zoom must remain locally handled"
  Wait-ConversationImagePreviewUiState -Session $Session -ExpectedScale 125 -ExpectedDialogCount 1 | Out-Null

  Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const reset = document.querySelector('.image-modal-scale');
  if (!(reset instanceof HTMLButtonElement)) return { reset: false };
  reset.click();
  return { reset: true };
})())
'@ | Out-Null
  Wait-ConversationImagePreviewUiState -Session $Session -ExpectedScale 100 -ExpectedDialogCount 1 | Out-Null

  $pinchDispatch = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const stage = document.querySelector('.image-modal-stage');
  if (!(stage instanceof HTMLElement)) return { dispatched: false };
  const bounds = stage.getBoundingClientRect();
  const centerX = bounds.left + bounds.width / 2;
  const centerY = bounds.top + bounds.height / 2;
  const dispatch = (type, pointerId, clientX, clientY, buttons) => stage.dispatchEvent(new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId,
    pointerType: 'touch',
    isPrimary: pointerId === 74201,
    button: 0,
    buttons,
    clientX,
    clientY
  }));
  dispatch('pointerdown', 74201, centerX - 50, centerY, 1);
  dispatch('pointerdown', 74202, centerX + 50, centerY, 1);
  dispatch('pointermove', 74202, centerX + 100, centerY, 1);
  window.__cxImagePreviewPinchProbe = { stage, centerX, centerY, dispatch };
  return {
    dispatched: true,
    touchAction: getComputedStyle(stage).touchAction,
    dragging: stage.classList.contains('image-modal-stage--dragging')
  };
})())
'@
  Assert-True ($pinchDispatch.dispatched -eq $true) "image preview touch pinch probe did not find the modal surface"
  Assert-True ($pinchDispatch.touchAction -eq 'none') "image preview stage must own touch gestures while the modal is open"
  Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '100') | Out-Null

  $pinchZoom = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const image = document.querySelector('.image-modal-image');
  return {
    scale: Number.parseFloat(document.querySelector('.image-modal-scale')?.textContent || '0'),
    transform: image instanceof HTMLElement ? image.style.transform : '',
    dragging: document.querySelector('.image-modal-stage')?.classList.contains('image-modal-stage--dragging') === true
  };
})())
'@
  Assert-True ([double]$pinchZoom.scale -ge 149 -and [double]$pinchZoom.scale -le 151) "two-pointer pinch must scale proportionally from 100% to 150%: $($pinchZoom.scale)%"
  Assert-True ($pinchZoom.dragging -eq $true) "image preview pinch did not enter its direct-manipulation state"

  $panDispatch = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const probe = window.__cxImagePreviewPinchProbe;
  const image = document.querySelector('.image-modal-image');
  if (!probe || !(image instanceof HTMLElement)) return { dispatched: false };
  const before = image.style.transform;
  probe.dispatch('pointerup', 74202, probe.centerX + 100, probe.centerY, 0);
  probe.dispatch('pointermove', 74201, probe.centerX - 80, probe.centerY + 12, 1);
  return { dispatched: true, before };
})())
'@
  Assert-True ($panDispatch.dispatched -eq $true) "image preview single-pointer continuation probe did not run"
  Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '100') | Out-Null
  $panResult = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const probe = window.__cxImagePreviewPinchProbe;
  const stage = document.querySelector('.image-modal-stage');
  const image = document.querySelector('.image-modal-image');
  if (!probe || !(stage instanceof HTMLElement) || !(image instanceof HTMLElement)) return { finished: false };
  const after = image.style.transform;
  probe.dispatch('pointerup', 74201, probe.centerX - 80, probe.centerY + 12, 0);
  delete window.__cxImagePreviewPinchProbe;
  return { finished: true, after, draggingBeforeRelease: stage.classList.contains('image-modal-stage--dragging') };
})())
'@
  Assert-True ($panResult.finished -eq $true) "image preview touch gesture did not finish cleanly"
  Assert-True ($panResult.draggingBeforeRelease -eq $true) "lifting one pinch pointer did not continue as single-pointer panning"
  Assert-True ([string]$panResult.after -ne [string]$panDispatch.before) "single-pointer panning after pinch did not move the zoomed image"
  Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '100') | Out-Null

  $settled = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const stage = document.querySelector('.image-modal-stage');
  return {
    scale: Number.parseFloat(document.querySelector('.image-modal-scale')?.textContent || '0'),
    dragging: stage?.classList.contains('image-modal-stage--dragging') === true,
    dialogCount: document.querySelectorAll('.image-modal-content').length
  };
})())
'@
  Assert-True ([double]$settled.scale -ge 149 -and [double]$settled.scale -le 151) "finishing the touch gesture changed the selected zoom"
  Assert-True ($settled.dragging -eq $false) "image preview remained stuck in dragging state after all touch pointers were released"
  Assert-True ([int]$settled.dialogCount -eq 1) "image preview touch gesture unexpectedly closed or duplicated the modal"

  Save-RegressionScreenshot -Session $Session -Name 'conversation-image-preview-pinch-phone' | Out-Null
  Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const close = document.querySelector('.image-modal-close');
  if (!(close instanceof HTMLButtonElement)) return { closed: false };
  close.click();
  return { closed: true };
})())
'@ | Out-Null
  Wait-ConversationImagePreviewUiState -Session $Session -ExpectedDialogCount 0 | Out-Null
}

function Assert-ConversationMarkdownImageRecovery {
  param([string]$Session)

  $prepared = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const visibleCard = document.querySelector('[data-message-id="fixture-markdown-image-visible"]');
  const image = visibleCard?.querySelector('.message-markdown-image');
  image?.scrollIntoView({ block: 'center' });
  return { found: image instanceof HTMLImageElement };
})())
'@
  Assert-True ($prepared.found -eq $true) "markdown-image fixture is missing its deterministic image"

  $state = $null
  for ($attempt = 1; $attempt -le 40; $attempt++) {
    $state = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const visibleCard = document.querySelector('[data-message-id="fixture-markdown-image-visible"]');
  const image = visibleCard?.querySelector('.message-markdown-image');
  const trigger = visibleCard?.querySelector('.message-markdown-image-button');
  const failedCard = document.querySelector('[data-message-id="fixture-markdown-image-failed"]');
  const failure = failedCard?.querySelector('.message-markdown-image-failed');
  const retry = failedCard?.querySelector('.message-markdown-image-retry');
  const imageStyle = image instanceof HTMLImageElement ? getComputedStyle(image) : null;
  return {
    loaded: image instanceof HTMLImageElement
      && image.complete
      && image.naturalWidth > 0
      && image.classList.contains('is-loaded'),
    opacity: imageStyle?.opacity || '',
    triggerDisabled: trigger instanceof HTMLButtonElement ? trigger.disabled : null,
    triggerLabel: trigger?.getAttribute('aria-label') || '',
    triggerBusy: trigger?.getAttribute('aria-busy') || '',
    failureVisible: failure instanceof HTMLElement,
    failureText: failure?.textContent?.replace(/\s+/g, ' ').trim() || '',
    retryLabel: retry?.textContent?.trim() || '',
    rawMarkdownVisible: failedCard?.textContent?.includes('/__missing-markdown-image-regression.png') === true
  };
})())
'@
    if ($state.loaded -eq $true -and $state.failureVisible -eq $true) { break }
    Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '100') | Out-Null
  }

  Assert-True ($state.loaded -eq $true) "markdown image did not enter its visible loaded state"
  Assert-True ([double]$state.opacity -eq 1) "loaded markdown image remained visually hidden: opacity=$($state.opacity)"
  Assert-True ($state.triggerDisabled -eq $false) "loaded markdown image preview trigger remained disabled"
  Assert-True ($state.triggerLabel -eq '预览图片：Markdown 图片回归') "loaded markdown image is missing its descriptive preview label: $($state.triggerLabel)"
  Assert-True ([string]::IsNullOrWhiteSpace([string]$state.triggerBusy)) "loaded markdown image retained aria-busy"
  Assert-True ($state.failureVisible -eq $true -and $state.failureText -match '图片加载失败' -and $state.retryLabel -eq '重试') "failed markdown image is missing its explicit recovery action"
  Assert-True ($state.rawMarkdownVisible -eq $false) "failed markdown image exposed its raw markdown source instead of recovery UI"

  $opened = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const trigger = document.querySelector('[data-message-id="fixture-markdown-image-visible"] .message-markdown-image-button');
  if (!(trigger instanceof HTMLButtonElement)) return { opened: false };
  trigger.click();
  return { opened: true };
})())
'@
  Assert-True ($opened.opened -eq $true) "loaded markdown image could not open the shared preview"
  Wait-ConversationImagePreviewUiState -Session $Session -ExpectedDialogCount 1 | Out-Null
  Invoke-AgentBrowser -Arguments @('--session', $Session, 'press', 'Escape') | Out-Null
  Wait-ConversationImagePreviewUiState -Session $Session -ExpectedDialogCount 0 | Out-Null

  $retryStarted = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const retry = document.querySelector('[data-message-id="fixture-markdown-image-failed"] .message-markdown-image-retry');
  if (!(retry instanceof HTMLButtonElement)) return { clicked: false };
  window.__cxPreviousMarkdownImageRetry = retry;
  retry.click();
  return { clicked: true };
})())
'@
  Assert-True ($retryStarted.clicked -eq $true) "failed markdown image retry action could not be activated"

  $retryState = $null
  for ($attempt = 1; $attempt -le 30; $attempt++) {
    $retryState = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const retry = document.querySelector('[data-message-id="fixture-markdown-image-failed"] .message-markdown-image-retry');
  return {
    recoveredFailureUi: retry instanceof HTMLButtonElement,
    replaced: retry instanceof HTMLButtonElement && retry !== window.__cxPreviousMarkdownImageRetry
  };
})())
'@
    if ($retryState.recoveredFailureUi -eq $true -and $retryState.replaced -eq $true) { break }
    Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '100') | Out-Null
  }
  Assert-True ($retryState.recoveredFailureUi -eq $true -and $retryState.replaced -eq $true) "markdown image retry did not remount the request and recover its failure UI"
  Save-RegressionScreenshot -Session $Session -Name 'conversation-markdown-image-recovery-phone' | Out-Null
}

function Assert-ConversationFixture {
  param(
    [object]$Metrics,
    [string]$ViewportName = ""
  )

  Assert-True ($Metrics.codeBlockCount -ge 2) "conversation fixture is missing code/diff blocks"
  Assert-True ($Metrics.diffBlockCount -ge 1) "conversation fixture is missing diff block"
  Assert-True ($Metrics.copyButtonCount -ge 2) "conversation fixture is missing code copy buttons"
  Assert-True ($Metrics.rawPayloadCardCount -ge 1) "conversation fixture is missing raw payload card"
  Assert-True ($Metrics.commandRowCount -ge 1) "conversation fixture is missing command row"
  Assert-True ($Metrics.commandOutputWrapCount -ge 1) "conversation fixture is missing command output wrapper"
  Assert-True ($Metrics.expandedCommandOutputCount -ge 1) "conversation fixture command output did not expand"
  Assert-True ($Metrics.commandRowRadius -le 10) "conversation fixture command row radius is too large: $($Metrics.commandRowRadius)"
  Assert-True ($Metrics.requestCardCount -ge 1) "conversation fixture is missing pending request card"
  Assert-True ($Metrics.permissionPanelCount -ge 1) "conversation fixture is missing MCP permission panel"
  Assert-True ($Metrics.toolPanelCount -ge 1) "conversation fixture is missing tool call panel"
  Assert-True ($Metrics.requestButtonCount -ge 3) "conversation fixture is missing permission action buttons"
  if ([int]$Metrics.viewportWidth -lt 768) {
    Assert-True ([int]$Metrics.tableScrollCount -ge 1) "conversation fixture phone viewport is missing semantic table scroll region"
    Assert-True ([int]$Metrics.tableScrollableCount -ge 1) "conversation fixture phone table is not horizontally scrollable"
    Assert-True ([double]$Metrics.tableMaxFontSize -le 13.5) "conversation fixture phone table font is too large: $($Metrics.tableMaxFontSize)"
    Assert-True ([int]$Metrics.tableCardGroupCount -eq 0) "conversation fixture phone viewport still mounted vertical table cards"
  } else {
    Assert-True ([int]$Metrics.tableScrollCount -ge 1) "conversation fixture $ViewportName viewport is missing desktop table DOM"
    Assert-True ([int]$Metrics.tableCardGroupCount -eq 0) "conversation fixture $ViewportName viewport mounted mobile table DOM: $($Metrics.tableCardGroupCount)"
  }
  Assert-True ($Metrics.runtimeStatusBarCount -ge 1) "conversation fixture is missing runtime status bar"
  $runtimeStatusMaxHeight = if ([int]$Metrics.viewportWidth -lt 768) { 48 } else { 40 }
  Assert-True ($Metrics.runtimeStatusMaxHeight -le $runtimeStatusMaxHeight) "conversation fixture runtime status bar is too tall: $($Metrics.runtimeStatusMaxHeight)"
  Assert-True ($Metrics.queuedPanelCount -ge 1) "conversation fixture is missing queued message panel"
  Assert-True ($Metrics.queuedRowCount -ge 2) "conversation fixture is missing queued message rows"
  Assert-True ($Metrics.conversationChromeWarmBackgroundCount -eq 0) "conversation fixture still has warm chrome backgrounds: $($Metrics.conversationChromeWarmBackgrounds | ConvertTo-Json -Compress)"
  Assert-True ($Metrics.conversationChromeMaxRadius -le 18) "conversation fixture chrome radius is too large: $($Metrics.conversationChromeMaxRadius)"
  Assert-True ($Metrics.requestCardRadius -le 10) "conversation fixture request card radius is too large: $($Metrics.requestCardRadius)"
  Assert-True ($Metrics.permissionPanelRadius -le 10) "conversation fixture permission panel radius is too large: $($Metrics.permissionPanelRadius)"
  Assert-True ($Metrics.toolPanelRadius -le 10) "conversation fixture tool call panel radius is too large: $($Metrics.toolPanelRadius)"
  Assert-True ($Metrics.hasAddLine -eq $true) "conversation fixture is missing diff add line styling"
  Assert-True ($Metrics.hasDeleteLine -eq $true) "conversation fixture is missing diff delete line styling"
  Assert-True ($Metrics.hasMetaLine -eq $true) "conversation fixture is missing diff metadata line styling"
  Assert-True ($Metrics.hasFixtureCodeText -eq $true) "conversation fixture is missing fixture code text"
  Assert-True ($Metrics.hasFixtureRawText -eq $true) "conversation fixture is missing raw payload marker"
  Assert-True ($Metrics.hasOptimisticInternalText -eq $false) "conversation fixture exposed optimistic-message internal metadata"
  Assert-True ([int]$Metrics.sendingDeliveryStateCount -eq 1) "conversation fixture is missing the sending delivery state"
  Assert-True ([int]$Metrics.failedDeliveryStateCount -eq 1) "conversation fixture is missing the failed delivery state"
  Assert-True ([int]$Metrics.retryingDeliveryStateCount -eq 1) "conversation fixture is missing the reconnecting delivery state"
  Assert-True ([int]$Metrics.waitingDeliveryStateCount -eq 1) "conversation fixture is missing the waiting-for-network delivery state"
  Assert-True ([int]$Metrics.confirmingDeliveryStateCount -eq 1) "conversation fixture is missing the confirming delivery state"
  Assert-True ([int]$Metrics.sentDeliveryStateCount -eq 1) "conversation fixture is missing the sent delivery state"
  Assert-True ([int]$Metrics.failedDeliveryRetryCount -eq 1) "conversation fixture is missing the failed-message retry action"
  Assert-True ($Metrics.hasBoundedReconnectText -eq $true) "conversation fixture is missing bounded reconnect progress"
  Assert-True ($Metrics.hasWaitingDeliveryText -eq $true) "conversation fixture is missing waiting-for-network feedback"
  Assert-True ($Metrics.hasConfirmingDeliveryText -eq $true) "conversation fixture is missing unconfirmed-send feedback"
  Assert-True ($Metrics.hasStableLiveElapsedTime -eq $true) "conversation fixture reset or ignored the authoritative live-overlay start time"
  Assert-True ([int]$Metrics.interruptedTurnCardCount -eq 1) "conversation fixture is missing stopped-turn feedback"
  Assert-True ([int]$Metrics.interruptedTurnEditCount -eq 1) "conversation fixture is missing stopped-turn edit action"
  Assert-True ($Metrics.hasHiddenUnhandledNoise -eq $false) "conversation fixture rendered unhandled App Server system noise"
  Assert-True ($Metrics.hasFixtureCommandText -eq $true) "conversation fixture is missing command output marker"
  Assert-True ($Metrics.hasFixtureCommandLabel -eq $true) "conversation fixture is missing command label"
  Assert-True ($Metrics.hasFixturePermissionText -eq $true) "conversation fixture is missing permission workbench marker"
  Assert-True ($Metrics.hasFixtureToolCallText -eq $true) "conversation fixture is missing tool call workbench marker"
  Assert-True ($Metrics.hasPermissionServerText -eq $true) "conversation fixture is missing MCP server label"
  Assert-True ($Metrics.hasPermissionToolText -eq $true) "conversation fixture is missing MCP tool label"
  Assert-True ($Metrics.hasPermissionTargetText -eq $true) "conversation fixture is missing MCP permission target details"
  Assert-True ($Metrics.hasToolCallActionText -eq $true) "conversation fixture is missing tool call action label"
  Assert-True ($Metrics.hasPermissionActionText -eq $true) "conversation fixture is missing permission action labels"
  Assert-True ([string]$Metrics.loadMoreButtonText -like "*继续查看*") "conversation fixture local older-history affordance is missing unified load-more button"
  Assert-True ([string]$Metrics.firstCopyButtonText -like "*复制*") "conversation fixture first code block copy button is not visible"
  Assert-True ($Metrics.hasEmojiFileIcon -eq $false) "conversation fixture still renders emoji file icons"
  Assert-True ($Metrics.hasHorizontalOverflow -eq $false) "conversation fixture has horizontal overflow: $($Metrics.scrollWidth) > $($Metrics.clientWidth)"
  Assert-True ($Metrics.structuredViewportFitFailureCount -eq 0) "conversation fixture structured blocks overflow viewport: $($Metrics.structuredViewportFitFailures | ConvertTo-Json -Compress)"
}

function Assert-ConversationViewportControls {
  param([string]$Session)

  $prepareScript = @'
JSON.stringify((() => {
  const list = document.querySelector('.conversation-list');
  if (!(list instanceof HTMLElement)) return { ready: false };
  window.__cxConversationViewportStyle = {
    flex: list.style.flex,
    height: list.style.height,
    minHeight: list.style.minHeight,
    maxHeight: list.style.maxHeight
  };
  let maxScrollTop = Math.max(list.scrollHeight - list.clientHeight, 0);
  if (maxScrollTop <= 180) {
    const probeHeight = Math.max(Math.min(list.scrollHeight - 240, 360), 160);
    list.style.flex = `0 0 ${probeHeight}px`;
    list.style.height = `${probeHeight}px`;
    list.style.minHeight = `${probeHeight}px`;
    list.style.maxHeight = `${probeHeight}px`;
    maxScrollTop = Math.max(list.scrollHeight - list.clientHeight, 0);
  }
  list.scrollTop = Math.max(maxScrollTop - 180, 0);
  list.dispatchEvent(new Event('scroll'));
  return {
    ready: true,
    maxScrollTop,
    overflowAnchor: getComputedStyle(list).overflowAnchor,
    tabIndex: list.tabIndex
  };
})())
'@
  $prepared = Invoke-BrowserEvalJson -Session $Session -Script $prepareScript
  Assert-True ($prepared.ready -eq $true) "conversation viewport control probe could not find the message list"
  Assert-True ([int]$prepared.maxScrollTop -gt 180) "conversation viewport fixture is not tall enough to verify away-from-bottom behavior"
  Assert-True ([string]$prepared.overflowAnchor -eq 'none') "conversation viewport did not disable browser-native scroll anchoring"
  Assert-True ([int]$prepared.tabIndex -eq 0) "conversation viewport is not keyboard focusable"

  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "250") | Out-Null
  $awayMetrics = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const list = document.querySelector('.conversation-list');
  const button = document.querySelector('.conversation-jump-to-latest');
  const distance = list instanceof HTMLElement
    ? Math.max(list.scrollHeight - list.scrollTop - list.clientHeight, 0)
    : -1;
  const rect = button?.getBoundingClientRect();
  return {
    distance,
    hasButton: button instanceof HTMLButtonElement,
    buttonVisible: !!rect && rect.width > 0 && rect.height > 0,
    ariaLabel: button?.getAttribute('aria-label') || ''
  };
})())
'@
  Assert-True ([int]$awayMetrics.distance -gt 24) "conversation viewport probe did not leave the bottom threshold"
  Assert-True ($awayMetrics.hasButton -eq $true -and $awayMetrics.buttonVisible -eq $true) "conversation viewport hid the return-to-bottom action without new output"
  Assert-True (-not [string]::IsNullOrWhiteSpace([string]$awayMetrics.ariaLabel)) "conversation return-to-bottom action is missing an accessible label"

  Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const button = document.querySelector('.conversation-jump-to-latest');
  if (!(button instanceof HTMLButtonElement)) return { clicked: false };
  button.focus();
  button.click();
  return { clicked: true };
})())
'@ | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "250") | Out-Null
  $returnedMetrics = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const list = document.querySelector('.conversation-list');
  if (!(list instanceof HTMLElement)) return { distance: -1, hasButton: true };
  const result = {
    distance: Math.max(list.scrollHeight - list.scrollTop - list.clientHeight, 0),
    hasButton: !!document.querySelector('.conversation-jump-to-latest'),
    focusReturnedToTranscript: document.activeElement === list
  };
  const originalStyle = window.__cxConversationViewportStyle;
  if (originalStyle) {
    list.style.flex = originalStyle.flex;
    list.style.height = originalStyle.height;
    list.style.minHeight = originalStyle.minHeight;
    list.style.maxHeight = originalStyle.maxHeight;
    delete window.__cxConversationViewportStyle;
  }
  return result;
})())
'@
  Assert-True ([int]$returnedMetrics.distance -le 24) "conversation return-to-bottom action did not restore the bottom anchor"
  Assert-True ($returnedMetrics.hasButton -eq $false) "conversation return-to-bottom action remained visible after bottom recovery"
  Assert-True ($returnedMetrics.focusReturnedToTranscript -eq $true) "conversation return-to-bottom action lost keyboard focus when its button unmounted"
}

function Assert-ConversationThreadSwitchScrollIsolation {
  param([string]$Session)

  $firstSwitch = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const list = document.querySelector('.conversation-list');
  const switchButton = document.querySelector('[data-testid="switch-scroll-thread-b"]');
  if (!(list instanceof HTMLElement) || !(switchButton instanceof HTMLButtonElement)) {
    return { ready: false };
  }
  list.style.flex = '0 0 320px';
  list.style.height = '320px';
  list.style.minHeight = '320px';
  list.style.maxHeight = '320px';
  const maxScrollTop = Math.max(list.scrollHeight - list.clientHeight, 0);
  const targetScrollTop = Math.round(maxScrollTop * 0.28);
  list.scrollTop = targetScrollTop;
  list.dispatchEvent(new Event('scroll'));
  switchButton.click();
  return {
    ready: true,
    maxScrollTop,
    targetScrollTop,
    targetRatio: maxScrollTop > 0 ? targetScrollTop / maxScrollTop : 0
  };
})())
'@
  Assert-True ($firstSwitch.ready -eq $true) "conversation thread-switch fixture is missing its list or switch control"
  Assert-True ([int]$firstSwitch.maxScrollTop -gt 300) "conversation thread-switch fixture is not scrollable enough"

  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "350") | Out-Null
  $threadBMetrics = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const list = document.querySelector('.conversation-list');
  const state = document.querySelector('.conversation-scroll-switch-state');
  if (!(list instanceof HTMLElement) || !(state instanceof HTMLElement)) return { ready: false };
  const maxScrollTop = Math.max(list.scrollHeight - list.clientHeight, 0);
  return {
    ready: true,
    activeThreadId: state.dataset.activeThreadId || '',
    listThreadId: list.dataset.threadId || '',
    threadAScrollTop: Number(state.dataset.threadAScrollTop || -1),
    threadAAtBottom: state.dataset.threadAAtBottom || '',
    threadBScrollTop: Number(state.dataset.threadBScrollTop || -1),
    threadBAtBottom: state.dataset.threadBAtBottom || '',
    distanceFromBottom: Math.max(list.scrollHeight - list.scrollTop - list.clientHeight, 0),
    maxScrollTop
  };
})())
'@
  Assert-True ($threadBMetrics.ready -eq $true) "conversation thread-switch fixture did not render thread B"
  Assert-True ([string]$threadBMetrics.activeThreadId -eq 'regression-scroll-b') "conversation thread switch did not select thread B"
  Assert-True ([string]$threadBMetrics.listThreadId -eq 'regression-scroll-b') "conversation list retained thread A ownership after selecting thread B"
  Assert-True ([double]$threadBMetrics.threadAScrollTop -gt 0) "conversation thread A scroll state was not settled before switching"
  Assert-True ([string]$threadBMetrics.threadAAtBottom -eq 'false') "conversation thread A scroll state was incorrectly saved at the bottom"
  Assert-True ([int]$threadBMetrics.distanceFromBottom -le 24) "thread A's delayed scroll state moved a fresh thread B away from the bottom"
  Assert-True (
    [string]$threadBMetrics.threadBAtBottom -eq '' -or [string]$threadBMetrics.threadBAtBottom -eq 'true'
  ) "thread A's delayed scroll state was written under thread B"

  $secondSwitch = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const list = document.querySelector('.conversation-list');
  const switchButton = document.querySelector('[data-testid="switch-scroll-thread-a"]');
  if (!(list instanceof HTMLElement) || !(switchButton instanceof HTMLButtonElement)) {
    return { ready: false };
  }
  const maxScrollTop = Math.max(list.scrollHeight - list.clientHeight, 0);
  const targetScrollTop = Math.round(maxScrollTop * 0.62);
  list.scrollTop = targetScrollTop;
  list.dispatchEvent(new Event('scroll'));
  switchButton.click();
  return {
    ready: true,
    targetRatio: maxScrollTop > 0 ? targetScrollTop / maxScrollTop : 0
  };
})())
'@
  Assert-True ($secondSwitch.ready -eq $true) "conversation thread-switch fixture could not return to thread A"

  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "350") | Out-Null
  $restoredMetrics = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const list = document.querySelector('.conversation-list');
  const state = document.querySelector('.conversation-scroll-switch-state');
  if (!(list instanceof HTMLElement) || !(state instanceof HTMLElement)) return { ready: false };
  const maxScrollTop = Math.max(list.scrollHeight - list.clientHeight, 0);
  return {
    ready: true,
    activeThreadId: state.dataset.activeThreadId || '',
    listThreadId: list.dataset.threadId || '',
    currentRatio: maxScrollTop > 0 ? list.scrollTop / maxScrollTop : 1,
    threadBScrollTop: Number(state.dataset.threadBScrollTop || -1),
    threadBAtBottom: state.dataset.threadBAtBottom || ''
  };
})())
'@
  Assert-True ($restoredMetrics.ready -eq $true) "conversation thread A did not render after the return switch"
  Assert-True ([string]$restoredMetrics.activeThreadId -eq 'regression-scroll-a') "conversation return switch did not select thread A"
  Assert-True ([string]$restoredMetrics.listThreadId -eq 'regression-scroll-a') "conversation list retained thread B ownership after returning to thread A"
  Assert-True ([double]$restoredMetrics.threadBScrollTop -gt 0) "conversation thread B scroll state was not settled before returning"
  Assert-True ([string]$restoredMetrics.threadBAtBottom -eq 'false') "conversation thread B scroll state was incorrectly saved at the bottom"
  Assert-True (
    [Math]::Abs([double]$restoredMetrics.currentRatio - [double]$firstSwitch.targetRatio) -le 0.08
  ) "conversation thread A did not restore its own saved scroll ratio"
}

function Assert-ConversationForegroundResumeScrollIntent {
  param(
    [string]$Session,
    [ValidateSet('bottom', 'reading', 'user')]
    [string]$Mode
  )

  $prepared = Invoke-BrowserEvalJson -Session $Session -Script @"
JSON.stringify((() => {
  const list = document.querySelector('.conversation-list');
  const target = document.querySelector('[data-message-id="regression-scroll-a-message-44"]');
  if (!(list instanceof HTMLElement) || !(target instanceof HTMLElement)) return { ready: false };
  list.style.flex = '0 0 320px';
  list.style.height = '320px';
  list.style.minHeight = '320px';
  list.style.maxHeight = '320px';
  if ('$Mode' === 'bottom' || '$Mode' === 'user') {
    list.scrollTop = list.scrollHeight;
  } else {
    target.scrollIntoView({ behavior: 'auto', block: 'center' });
  }
  list.dispatchEvent(new Event('scroll'));
  window.__cxResumeInitialMessageCount = Number(list.dataset.messageCount || '0');
  return {
    ready: true,
    distanceFromBottom: Math.max(list.scrollHeight - list.scrollTop - list.clientHeight, 0),
    maxScrollTop: Math.max(list.scrollHeight - list.clientHeight, 0)
  };
})())
"@
  Assert-True ($prepared.ready -eq $true) "foreground resume scroll fixture is missing its list or reading target"
  Assert-True ([int]$prepared.maxScrollTop -gt 300) "foreground resume scroll fixture is not scrollable enough"
  Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '180') | Out-Null

  $captured = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const list = document.querySelector('.conversation-list');
  if (!(list instanceof HTMLElement)) return { ready: false };
  const listRect = list.getBoundingClientRect();
  const anchor = Array.from(list.querySelectorAll('.conversation-item[data-message-id]')).find((node) => {
    const rect = node.getBoundingClientRect();
    return rect.bottom > listRect.top + 1 && rect.top < listRect.bottom;
  });
  let hidden = true;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
  hidden = false;
  document.dispatchEvent(new Event('visibilitychange'));
  window.__cxResumeAnchorId = anchor?.getAttribute('data-message-id') || '';
  window.__cxResumeAnchorOffset = anchor ? Math.round(anchor.getBoundingClientRect().top - listRect.top) : 0;
  return {
    ready: true,
    anchorId: window.__cxResumeAnchorId,
    anchorOffset: window.__cxResumeAnchorOffset
  };
})())
'@
  Assert-True ($captured.ready -eq $true) "foreground resume fixture could not dispatch the hidden-to-visible lifecycle"
  Assert-True (-not [string]::IsNullOrWhiteSpace([string]$captured.anchorId)) "foreground resume fixture did not capture a visible reading anchor"
  Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '120') | Out-Null

  Invoke-BrowserEvalJson -Session $Session -Script @"
JSON.stringify((() => {
  const list = document.querySelector('.conversation-list');
  if (!(list instanceof HTMLElement)) return { ready: false };
  const maxScrollTop = Math.max(list.scrollHeight - list.clientHeight, 0);
  if ('$Mode' === 'user') {
    list.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }));
  }
  list.scrollTop = '$Mode' === 'bottom' ? Math.max(maxScrollTop - 180, 0) : maxScrollTop;
  if ('$Mode' === 'user') {
    list.scrollTop = Math.max(maxScrollTop - 180, 0);
  }
  list.dispatchEvent(new Event('scroll'));
  return { ready: true };
})())
"@ | Out-Null
  Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '120') | Out-Null

  $appended = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const button = document.querySelector('[data-testid="append-resume-output"]');
  if (!(button instanceof HTMLButtonElement)) return { clicked: false };
  button.click();
  return { clicked: true };
})())
'@
  Assert-True ($appended.clicked -eq $true) "foreground resume fixture could not append recovered output"
  Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '650') | Out-Null

  $settled = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const list = document.querySelector('.conversation-list');
  const anchorId = String(window.__cxResumeAnchorId || '');
  const anchor = anchorId ? document.querySelector(`[data-message-id="${anchorId}"]`) : null;
  const returnButton = document.querySelector('.conversation-jump-to-latest');
  const returnLabel = returnButton?.querySelector('.conversation-jump-to-latest-label');
  const returnButtonRect = returnButton?.getBoundingClientRect();
  if (!(list instanceof HTMLElement)) return { ready: false };
  return {
    ready: true,
    initialMessageCount: Number(window.__cxResumeInitialMessageCount || '0'),
    messageCount: Number(list.dataset.messageCount || '0'),
    distanceFromBottom: Math.max(list.scrollHeight - list.scrollTop - list.clientHeight, 0),
    anchorDelta: anchor instanceof HTMLElement
      ? Math.round((anchor.getBoundingClientRect().top - list.getBoundingClientRect().top) - Number(window.__cxResumeAnchorOffset || 0))
      : 10000,
    hasReturnToLatest: returnButton instanceof HTMLButtonElement,
    returnToLatestLabel: returnLabel?.textContent?.trim() || '',
    returnToLatestLabelDisplay: returnLabel instanceof HTMLElement ? getComputedStyle(returnLabel).display : '',
    returnToLatestWidth: returnButtonRect ? Math.round(returnButtonRect.width) : 0,
    hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
  };
})())
'@
  Assert-True ($settled.ready -eq $true) "foreground resume fixture did not settle after recovered output"
  Assert-True ([int]$settled.messageCount -eq [int]$settled.initialMessageCount + 1) "foreground resume fixture did not render exactly one recovered output"
  Assert-True ($settled.hasHorizontalOverflow -eq $false) "foreground resume scroll recovery introduced horizontal overflow"
  if ($Mode -eq 'bottom') {
    Assert-True ([int]$settled.distanceFromBottom -le 24) "foreground recovery lost bottom-follow intent after a transient viewport scroll"
    Assert-True ($settled.hasReturnToLatest -eq $false) "bottom-follow recovery exposed a stale return-to-latest action"
  } elseif ($Mode -eq 'reading') {
    Assert-True ([Math]::Abs([int]$settled.anchorDelta) -le 8) "foreground recovery moved the user's reading anchor: delta=$($settled.anchorDelta)"
    Assert-True ([int]$settled.distanceFromBottom -gt 24) "foreground recovery pulled a history reader to the latest output"
    Assert-True ($settled.hasReturnToLatest -eq $true) "history-reading recovery lost the return-to-latest affordance"
  } else {
    Assert-True ([int]$settled.distanceFromBottom -gt 24) "fresh user scrolling after resume was overridden by the stale bottom-follow intent"
    Assert-True ($settled.hasReturnToLatest -eq $true) "fresh user scrolling after resume lost the return-to-latest affordance"
  }
  if ($Mode -ne 'bottom') {
    Assert-True ($settled.returnToLatestLabel -eq '最新输出') "phone return-to-latest action is missing its visible new-output label"
    Assert-True ($settled.returnToLatestLabelDisplay -ne 'none' -and [int]$settled.returnToLatestWidth -ge 96) "phone return-to-latest new-output label remained visually hidden"
  }
}

function Assert-ConversationMessageReadingAnchor {
  param([string]$Session)

  $prepared = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const list = document.querySelector('.conversation-list');
  const target = document.querySelector('[data-message-id="regression-scroll-a-message-44"]');
  const card = target?.querySelector('.message-card');
  if (!(list instanceof HTMLElement) || !(target instanceof HTMLElement) || !(card instanceof HTMLElement)) {
    return { ready: false };
  }
  window.__cxConversationReadingAnchorStyle = {
    flex: list.style.flex,
    height: list.style.height,
    minHeight: list.style.minHeight,
    maxHeight: list.style.maxHeight
  };
  list.style.flex = '0 0 320px';
  list.style.height = '320px';
  list.style.minHeight = '320px';
  list.style.maxHeight = '320px';
  target.scrollIntoView({ behavior: 'auto', block: 'center' });
  list.dispatchEvent(new Event('scroll'));
  card.click();
  return {
    ready: true,
    distanceBefore: Math.round(target.getBoundingClientRect().top - list.getBoundingClientRect().top),
    maxScrollTop: Math.max(list.scrollHeight - list.clientHeight, 0)
  };
})())
'@
  Assert-True ($prepared.ready -eq $true) "conversation reading-anchor fixture is missing its list, target response, or message card"
  Assert-True ([int]$prepared.maxScrollTop -gt 300) "conversation reading-anchor fixture is not scrollable enough"
  Assert-True ([Math]::Abs([int]$prepared.distanceBefore - 160) -lt 140) "conversation reading-anchor probe did not place the response away from the viewport top"

  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "120") | Out-Null
  $actionMetrics = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const target = document.querySelector('[data-message-id="regression-scroll-a-message-44"]');
  const button = target?.querySelector('[aria-label="将这条回复滚动到阅读区顶部"]');
  const rect = button?.getBoundingClientRect();
  const opacity = button instanceof HTMLElement ? Number.parseFloat(getComputedStyle(button).opacity || '0') : 0;
  if (button instanceof HTMLButtonElement) button.click();
  return {
    hasButton: button instanceof HTMLButtonElement,
    title: button?.getAttribute('title') || '',
    ariaLabel: button?.getAttribute('aria-label') || '',
    width: rect ? Math.round(rect.width) : 0,
    height: rect ? Math.round(rect.height) : 0,
    opacity
  };
})())
'@
  Assert-True ($actionMetrics.hasButton -eq $true) "assistant response is missing its move-to-top action"
  Assert-True ([string]$actionMetrics.title -eq '将这条回复滚动到阅读区顶部') "assistant move-to-top action is missing its explanatory tooltip"
  Assert-True ([string]$actionMetrics.ariaLabel -eq '将这条回复滚动到阅读区顶部') "assistant move-to-top action is missing its accessible name"
  Assert-True ([int]$actionMetrics.width -ge 32 -and [int]$actionMetrics.height -ge 32) "assistant move-to-top action is too small for touch"
  Assert-True ([double]$actionMetrics.opacity -ge 0.8) "assistant move-to-top action did not become visible after activating the message"

  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "700") | Out-Null
  $anchoredMetrics = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const list = document.querySelector('.conversation-list');
  const target = document.querySelector('[data-message-id="regression-scroll-a-message-44"]');
  if (!(list instanceof HTMLElement) || !(target instanceof HTMLElement)) return { ready: false };
  const metrics = {
    ready: true,
    topOffset: Math.round(target.getBoundingClientRect().top - list.getBoundingClientRect().top),
    hasReturnToLatest: document.querySelector('.conversation-jump-to-latest') instanceof HTMLButtonElement,
    hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
  };
  const originalStyle = window.__cxConversationReadingAnchorStyle;
  if (originalStyle) {
    list.style.flex = originalStyle.flex;
    list.style.height = originalStyle.height;
    list.style.minHeight = originalStyle.minHeight;
    list.style.maxHeight = originalStyle.maxHeight;
    delete window.__cxConversationReadingAnchorStyle;
  }
  list.scrollTop = list.scrollHeight;
  list.dispatchEvent(new Event('scroll'));
  return metrics;
})())
'@
  Assert-True ($anchoredMetrics.ready -eq $true) "conversation reading-anchor result is missing its list or target response"
  Assert-True ([int]$anchoredMetrics.topOffset -ge 8 -and [int]$anchoredMetrics.topOffset -le 28) "assistant response did not align to the reading-area top: $($anchoredMetrics.topOffset)"
  Assert-True ($anchoredMetrics.hasReturnToLatest -eq $true) "assistant move-to-top action did not preserve the return-to-latest affordance"
  Assert-True ($anchoredMetrics.hasHorizontalOverflow -eq $false) "assistant move-to-top action introduced horizontal overflow"
}

function Assert-ConversationOlderHistoryAffordance {
  param([string]$Session)

  $before = Read-ConversationFixtureMetrics -Session $Session
  Assert-True ([int]$before.olderHistoryRequestCount -eq 0) "conversation fixture older-history request count should start at 0"
  $localClickScript = @'
JSON.stringify((() => {
  const button = document.querySelector('.conversation-load-more-button');
  if (!(button instanceof HTMLButtonElement)) return { clicked: 0 };
  button.click();
  return { clicked: 1 };
})())
'@
  Invoke-BrowserEvalJson -Session $Session -Script $localClickScript | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "200") | Out-Null
  $afterLocal = Read-ConversationFixtureMetrics -Session $Session
  Assert-True ($afterLocal.fileCardCount -ge 2) "conversation fixture did not restore file cards after loading local older history"
  Assert-True ($afterLocal.hasLatestTurnPromptContext -eq $true) "conversation fixture did not restore the earlier user prompt context"
  Assert-True ([int]$afterLocal.olderHistoryRequestCount -eq 0) "conversation fixture requested remote older history while local messages were still available"

  $remoteClickScript = @'
JSON.stringify((() => {
  const button = document.querySelector('.conversation-load-more-button');
  if (!(button instanceof HTMLButtonElement)) return { clicked: 0 };
  button.click();
  button.click();
  return { clicked: 2 };
})())
'@
  Invoke-BrowserEvalJson -Session $Session -Script $remoteClickScript | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "200") | Out-Null
  $after = Read-ConversationFixtureMetrics -Session $Session
  Assert-True ([int]$after.olderHistoryRequestCount -eq 1) "conversation fixture load-more button emitted duplicate remote older-history requests"
  Assert-True ($after.loadMoreButtonDisabled -eq $true) "conversation fixture load-more button did not stay disabled while remote older-history request was in flight"
}

function Reveal-ConversationFixtureLocalHistory {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const button = document.querySelector('.conversation-load-more-button');
  if (!(button instanceof HTMLButtonElement)) return { clicked: false };
  button.click();
  return { clicked: true };
})())
'@
  $result = Invoke-BrowserEvalJson -Session $Session -Script $script
  Assert-True ($result.clicked -eq $true) "conversation fixture could not reveal local history before structured-block checks"
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "200") | Out-Null
}

function Expand-ConversationFixturePendingRequests {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  if (!document.querySelector('.request-card')) {
    document.querySelector('.conversation-process-toggle')?.click();
  }
  return { expanded: Boolean(document.querySelector('.request-card')) };
})())
'@
  Invoke-BrowserEvalJson -Session $Session -Script $script | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "150") | Out-Null
}

function Expand-ConversationFixtureCommandOutput {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  if (!document.querySelector('.conversation-item[data-message-type="commandExecution"] .cmd-output-wrap.cmd-output-visible')) {
    document.querySelector('.conversation-item[data-message-type="commandExecution"] .cmd-row')?.click();
  }
  return { expanded: Boolean(document.querySelector('.conversation-item[data-message-type="commandExecution"] .cmd-output-wrap.cmd-output-visible')) };
})())
'@
  Invoke-BrowserEvalJson -Session $Session -Script $script | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "150") | Out-Null
}

function Assert-ConversationCommandOutputLazy {
  param([string]$Session)

  $beforeScript = @'
JSON.stringify((() => {
  const commandOutputs = Array.from(document.querySelectorAll('.conversation-regression-fixture .cmd-output-wrap .cmd-output'));
  const textContent = document.body.textContent || '';
  return {
    commandOutputCount: commandOutputs.length,
    hasFixtureCommandOutputText: textContent.includes('fixture-command-output: ok')
  };
})())
'@
  $before = Invoke-BrowserEvalJson -Session $Session -Script $beforeScript
  Assert-True ([int]$before.commandOutputCount -eq 0) "conversation fixture command output should be lazy before expand"
  Assert-True ($before.hasFixtureCommandOutputText -eq $false) "conversation fixture command output marker rendered before expand"

  Expand-ConversationFixtureCommandOutput -Session $Session

  $afterScript = @'
JSON.stringify((() => {
  const commandOutputs = Array.from(document.querySelectorAll('.conversation-regression-fixture .cmd-output-wrap .cmd-output'));
  const textContent = document.body.textContent || '';
  return {
    commandOutputCount: commandOutputs.length,
    hasFixtureCommandOutputText: textContent.includes('fixture-command-output: ok')
  };
})())
'@
  $after = Invoke-BrowserEvalJson -Session $Session -Script $afterScript
  Assert-True ([int]$after.commandOutputCount -ge 1) "conversation fixture command output did not render after expand"
  Assert-True ($after.hasFixtureCommandOutputText -eq $true) "conversation fixture command output marker missing after expand"
}

function Assert-ConversationRawPayloadLazy {
  param([string]$Session)

  $beforeScript = @'
JSON.stringify((() => {
  const rawCards = Array.from(document.querySelectorAll('.message-structured-card'));
  const rawPres = Array.from(document.querySelectorAll('.message-structured-pre'));
  const textContent = document.body.textContent || '';
  return {
    rawPayloadCardCount: rawCards.length,
    rawPayloadPreCount: rawPres.length,
    hasFixtureRawText: textContent.includes('fixture-raw-payload')
  };
})())
'@
  $before = Invoke-BrowserEvalJson -Session $Session -Script $beforeScript
  Assert-True ($before.rawPayloadCardCount -ge 1) "conversation fixture is missing raw payload card"
  Assert-True ([int]$before.rawPayloadPreCount -eq 0) "conversation fixture raw payload preview should be lazy before expand"
  Assert-True ($before.hasFixtureRawText -eq $false) "conversation fixture raw payload marker rendered before card expand"

  $expandScript = @'
JSON.stringify((() => {
  const summary = document.querySelector('.message-structured-summary');
  if (summary instanceof HTMLElement) {
    summary.click();
  }
  return { clicked: summary instanceof HTMLElement };
})())
'@
  $expanded = Invoke-BrowserEvalJson -Session $Session -Script $expandScript
  Assert-True ($expanded.clicked -eq $true) "conversation fixture raw payload summary could not be clicked"
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "300") | Out-Null

  $afterScript = @'
JSON.stringify((() => {
  const rawPres = Array.from(document.querySelectorAll('.message-structured-pre'));
  const textContent = document.body.textContent || '';
  return {
    rawPayloadPreCount: rawPres.length,
    hasFixtureRawText: textContent.includes('fixture-raw-payload')
  };
})())
'@
  $after = Invoke-BrowserEvalJson -Session $Session -Script $afterScript
  Assert-True ([int]$after.rawPayloadPreCount -ge 1) "conversation fixture raw payload preview did not render after expand"
  Assert-True ($after.hasFixtureRawText -eq $true) "conversation fixture raw payload marker missing after card expand"
}

function Assert-ConversationFixtureCopyInteraction {
  param([string]$Session)

  $stubScript = @'
JSON.stringify((() => {
  window.__cxCodexCopiedText = '';
  window.__cxCodexClipboardWriteAttempts = 0;
  window.__cxCodexFallbackCopyAttempts = 0;
  const originalSetTimeout = window.setTimeout.bind(window);
  window.setTimeout = (handler, timeout, ...args) => originalSetTimeout(handler, timeout === 1600 ? 10000 : timeout, ...args);
  const existingClipboard = navigator.clipboard || {};
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      ...existingClipboard,
      writeText: async () => {
        window.__cxCodexClipboardWriteAttempts += 1;
        throw new DOMException('fixture clipboard permission rejection', 'NotAllowedError');
      },
    },
  });
  document.execCommand = (command) => {
    if (command !== 'copy') return false;
    window.__cxCodexFallbackCopyAttempts += 1;
    const event = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: {
        setData: (type, text) => {
          if (type === 'text/plain') window.__cxCodexCopiedText = String(text);
        },
      },
    });
    document.dispatchEvent(event);
    return true;
  };
  return { stubbed: true };
})())
'@
  Invoke-BrowserEvalJson -Session $Session -Script $stubScript | Out-Null
  $clickScript = @'
JSON.stringify((() => {
  const button = document.querySelector('.message-code-block[data-diff="false"] .message-code-copy');
  if (!(button instanceof HTMLButtonElement)) return { clicked: false };
  button.focus();
  button.click();
  return { clicked: true };
})())
'@
  $clickState = Invoke-BrowserEvalJson -Session $Session -Script $clickScript
  Assert-True ($clickState.clicked -eq $true) "conversation fixture code copy button was not clickable"
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "300") | Out-Null

  $stateScript = @'
JSON.stringify({
  copiedText: window.__cxCodexCopiedText || '',
  clipboardWriteAttempts: window.__cxCodexClipboardWriteAttempts || 0,
  fallbackCopyAttempts: window.__cxCodexFallbackCopyAttempts || 0,
  copyButtonKeptFocus: document.activeElement?.classList.contains('message-code-copy') === true,
  copiedButtonCount: Array.from(document.querySelectorAll('.message-code-copy')).filter((button) => button.textContent.includes('已复制')).length
})
'@
  $state = Invoke-BrowserEvalJson -Session $Session -Script $stateScript
  $copiedText = [string]$state.copiedText
  Assert-True ([int]$state.clipboardWriteAttempts -eq 1) "conversation fixture did not exercise the primary clipboard rejection"
  Assert-True ([int]$state.fallbackCopyAttempts -eq 1) "conversation fixture did not exercise exactly one copy-event fallback"
  Assert-True ($copiedText -like '*fixture-code-block*') "conversation fixture copy did not capture the code block body"
  Assert-True ($copiedText -notlike '*```*') "conversation fixture copy included markdown fence markers"
  Assert-True ($state.copyButtonKeptFocus -eq $true) "copy fallback moved focus away from the invoking code button"
  Assert-True ([int]$state.copiedButtonCount -ge 1) "conversation fixture copy button did not show copied feedback"

  $failureSetupScript = @'
JSON.stringify((() => {
  document.execCommand = () => false;
  const buttons = Array.from(document.querySelectorAll('.message-code-copy'));
  const button = buttons[1];
  if (!(button instanceof HTMLButtonElement)) return { clicked: false };
  button.focus();
  button.click();
  return { clicked: true };
})())
'@
  $failureSetup = Invoke-BrowserEvalJson -Session $Session -Script $failureSetupScript
  Assert-True ($failureSetup.clicked -eq $true) "conversation fixture is missing a second code copy control for failure feedback"
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "300") | Out-Null

  $failureStateScript = @'
JSON.stringify({
  statusText: document.querySelector('.conversation-regression-copy-status')?.textContent?.trim() || '',
  statusTone: document.querySelector('.conversation-regression-copy-status')?.getAttribute('data-tone') || '',
  failedButtonClaimedSuccess: Array.from(document.querySelectorAll('.message-code-copy'))[1]?.textContent?.includes('已复制') === true
})
'@
  $failureState = Invoke-BrowserEvalJson -Session $Session -Script $failureStateScript
  Assert-True ($failureState.statusText -eq '代码复制失败，请手动选择复制。') "clipboard failure did not expose actionable conversation feedback"
  Assert-True ($failureState.statusTone -eq 'danger') "clipboard failure feedback did not retain danger semantics"
  Assert-True ($failureState.failedButtonClaimedSuccess -eq $false) "failed clipboard fallback incorrectly reported copied success"
}

function Assert-ConversationMessageActionHitTesting {
  param([string]$Session)

  $result = Invoke-BrowserEvalJson -Session $Session -Script @'
(async () => {
  const isOnScreen = (element) => {
    const rect = element.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
  };
  const action = Array.from(document.querySelectorAll('.message-action-button'))
    .find((element) => element instanceof HTMLButtonElement
      && element.getAttribute('aria-label') === '编辑并从此处继续'
      && isOnScreen(element));
  if (!(action instanceof HTMLButtonElement)) return JSON.stringify({ actionFound: false });
  const card = action.closest('.conversation-item')?.querySelector('.message-card');
  if (!(card instanceof HTMLElement)) return JSON.stringify({ actionFound: true, cardFound: false });
  const favorite = action.closest('.conversation-item')?.querySelector('.message-action-button--favorite.is-favorited');
  const read = (element) => {
    if (!(element instanceof HTMLButtonElement)) return null;
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      opacity: Number.parseFloat(getComputedStyle(element).opacity),
      pointerEvents: getComputedStyle(element).pointerEvents,
      hitLabel: hit?.closest('button')?.getAttribute('aria-label') || '',
    };
  };
  const inactive = read(action);
  const favoriteInactive = read(favorite);
  card.click();
  await Promise.resolve();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const active = read(action);
  window.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  }));
  await Promise.resolve();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  return JSON.stringify({
    actionFound: true,
    cardFound: true,
    label: action.getAttribute('aria-label'),
    favoriteLabel: favorite?.getAttribute('aria-label') || '',
    inactive,
    favoriteInactive,
    active,
    restored: read(action),
    favoriteRestored: read(favorite),
  });
})()
'@

  Assert-True ($result.actionFound -eq $true -and $result.cardFound -eq $true) "conversation fixture is missing an on-screen editable message action"
  Assert-True ([double]$result.inactive.opacity -eq 0) "inactive message action must remain visually hidden"
  Assert-True ($result.inactive.pointerEvents -eq 'none') "inactive message action must not intercept pointer input"
  Assert-True ($result.inactive.hitLabel -ne $result.label) "inactive message action center must resolve to the content beneath it"
  Assert-True ($result.favoriteLabel -eq '取消收藏这条消息') "conversation fixture is missing its always-visible favorited action"
  Assert-True ([double]$result.favoriteInactive.opacity -eq 1) "favorited action must remain visibly persistent"
  Assert-True ($result.favoriteInactive.pointerEvents -eq 'auto' -and $result.favoriteInactive.hitLabel -eq $result.favoriteLabel) "visible favorited action must remain pointer-operable"
  Assert-True ([double]$result.active.opacity -ge 0.89) "activated message action must become visible"
  Assert-True ($result.active.pointerEvents -eq 'auto') "activated message action must accept pointer input"
  Assert-True ($result.active.hitLabel -eq $result.label) "activated message action center must resolve to the action button"
  Assert-True ([double]$result.restored.opacity -eq 0) "Escape must hide the active message action"
  Assert-True ($result.restored.pointerEvents -eq 'none') "Escape must remove pointer ownership from the hidden message action"
  Assert-True ($result.restored.hitLabel -ne $result.label) "dismissed message action must no longer own its former hit target"
  Assert-True ($result.favoriteRestored.pointerEvents -eq 'auto' -and $result.favoriteRestored.hitLabel -eq $result.favoriteLabel) "Escape must not disable the still-visible favorited action"
  Write-Step ("conversation message-action hit testing -> inactive=" + $result.inactive.pointerEvents + ", active=" + $result.active.pointerEvents + ", restored=" + $result.restored.pointerEvents)
}

function Read-SidebarFixtureMetrics {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const rows = Array.from(document.querySelectorAll('.sidebar-regression-fixture .thread-row'));
  const projectGroups = Array.from(document.querySelectorAll('.sidebar-regression-fixture .project-group'));
  const codexProjectGroup = projectGroups.find((node) => node.getAttribute('data-project-name') === 'E:/javaword/CXCodex/codexui') || null;
  const codexProjectRows = Array.from(codexProjectGroup?.querySelectorAll('.thread-row') || []);
  const codexProjectThreadIds = codexProjectRows.map((node) => node.getAttribute('data-thread-id') || '');
  const emptyProjectGroup = projectGroups.find((node) => node.getAttribute('data-project-name') === 'empty-root') || null;
  const pinnedProjectGroups = projectGroups.filter((node) => node.getAttribute('data-pinned-project') === 'true');
  const showMoreButtons = Array.from(document.querySelectorAll('.sidebar-regression-fixture .thread-show-more-button'));
  const sections = Array.from(document.querySelectorAll('.sidebar-regression-fixture .thread-section'));
  const getSectionThreadIds = (label) => {
    const section = sections.find((node) => (node.querySelector('.thread-section-label')?.textContent || '').trim() === label);
    return Array.from(section?.querySelectorAll('.thread-row') || []).map((node) => node.getAttribute('data-thread-id') || '');
  };
  const pinnedSectionThreadIds = getSectionThreadIds('置顶');
  const runningSectionThreadIds = getSectionThreadIds('正在运行');
  const sources = Array.from(document.querySelectorAll('.sidebar-regression-fixture .thread-row-source'));
  const indicators = Array.from(document.querySelectorAll('.sidebar-regression-fixture .thread-status-indicator'));
  const threadTitles = rows.map((row) => row.querySelector('.thread-row-title')).filter(Boolean);
  const runningThreadTitles = rows
    .filter((row) => row.getAttribute('data-thread-id') === 'fixture-thread-running')
    .map((row) => row.querySelector('.thread-row-title'))
    .filter(Boolean);
  const threadMenuTriggers = rows.map((row) => row.querySelector('.thread-menu-trigger')).filter(Boolean);
  const threadPinButtons = rows.map((row) => row.querySelector('.thread-pin-button')).filter(Boolean);
  const projectTitles = projectGroups.map((group) => group.querySelector('.project-title')).filter(Boolean);
  const attentionBadge = document.querySelector('.sidebar-regression-fixture .sidebar-thread-controls-attention-badge');
  const attentionButton = attentionBadge?.closest('button') || null;
  const directoryHeader = document.querySelector('.sidebar-regression-fixture .thread-tree-header');
  const directorySubtitle = document.querySelector('.sidebar-regression-fixture .thread-tree-header-subtitle');
  const countRowsByThreadId = (threadId) => rows.filter((node) => node.getAttribute('data-thread-id') === threadId).length;
  const countProjectRowsByThreadId = (threadId) => projectGroups.reduce((count, group) => (
    count + group.querySelectorAll(`.thread-row[data-thread-id="${threadId}"]`).length
  ), 0);
  const rowRects = rows.map((node) => {
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    return {
      height: rect.height,
      left: rect.left,
      right: rect.right,
      radius: Number.parseFloat(style.borderTopLeftRadius || '0')
    };
  });
  const sourceStyles = sources.map((node) => {
    const style = window.getComputedStyle(node);
    return {
      backgroundColor: style.backgroundColor,
      borderTopWidth: Number.parseFloat(style.borderTopWidth || '0'),
      borderRadius: Number.parseFloat(style.borderTopLeftRadius || '0'),
      paddingLeft: Number.parseFloat(style.paddingLeft || '0'),
      paddingRight: Number.parseFloat(style.paddingRight || '0')
    };
  });
  const indicatorStyles = indicators.map((node) => {
    const style = window.getComputedStyle(node);
    return {
      state: node.getAttribute('data-state') || '',
      animationName: style.animationName || 'none',
      backgroundColor: style.backgroundColor,
      width: Number.parseFloat(style.width || '0'),
      height: Number.parseFloat(style.height || '0')
    };
  });
  const viewportWidth = document.documentElement.clientWidth;
  const rowFitFailures = rowRects.filter((rect) => rect.left < -2 || rect.right > viewportWidth + 2);
  const hasPillSourceStyle = sourceStyles.some((style) => (
    style.borderTopWidth > 0
    || style.borderRadius > 0
    || style.paddingLeft > 0
    || style.paddingRight > 0
    || (style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent')
  ));
  const workingIndicator = indicatorStyles.find((style) => style.state === 'working') || null;
  const waitingIndicator = indicatorStyles.find((style) => style.state === 'waiting') || null;
  return {
    rowCount: rows.length,
    projectOrder: projectGroups.map((node) => node.getAttribute('data-project-name') || ''),
    pinnedProjectCount: pinnedProjectGroups.length,
    firstProjectPinned: projectGroups[0]?.getAttribute('data-pinned-project') === 'true',
    directoryHeaderText: directoryHeader?.textContent?.trim() || '',
    directorySubtitleText: directorySubtitle?.textContent?.trim() || '',
    hasEmptyWorkspaceProject: !!emptyProjectGroup,
    emptyWorkspaceProjectText: emptyProjectGroup?.textContent?.trim() || '',
    emptyWorkspaceNewThreadButtonCount: emptyProjectGroup?.querySelectorAll('.thread-start-button').length || 0,
    emptyWorkspaceProjectMenuTriggerCount: emptyProjectGroup?.querySelectorAll('.project-menu-trigger').length || 0,
    codexProjectThreadRowCount: codexProjectRows.length,
    codexProjectThreadIds,
    showMoreButtonCount: showMoreButtons.length,
    firstShowMoreText: showMoreButtons[0]?.textContent?.trim() || '',
    pinnedSectionThreadIds,
    runningSectionThreadIds,
    runningThreadRowCount: countRowsByThreadId('fixture-thread-running'),
    runningThreadProjectRowCount: countProjectRowsByThreadId('fixture-thread-running'),
    waitingThreadRowCount: countRowsByThreadId('fixture-thread-waiting'),
    backgroundThreadRowCount: countRowsByThreadId('fixture-thread-background'),
    waitingSourceCount: rows.filter((node) => (
      node.getAttribute('data-thread-id') === 'fixture-thread-waiting'
      && (node.querySelector('.thread-row-source')?.textContent || '').trim() === '等待处理'
    )).length,
    pinnedThreadRowCount: countRowsByThreadId('fixture-thread-unread'),
    pinnedThreadProjectRowCount: countProjectRowsByThreadId('fixture-thread-unread'),
    sourceCount: sources.length,
    indicatorCount: indicators.length,
    maxRowHeight: rowRects.length ? Math.max(...rowRects.map((rect) => rect.height)) : 0,
    minRowHeight: rowRects.length ? Math.min(...rowRects.map((rect) => rect.height)) : 0,
    maxRowRadius: rowRects.length ? Math.max(...rowRects.map((rect) => rect.radius)) : 0,
    hasPillSourceStyle,
    workingIndicator,
    waitingIndicator,
    threadTitleCount: threadTitles.length,
    threadTitleTooltipCount: threadTitles.filter((node) => node.getAttribute('title') === (node.textContent || '').trim()).length,
    runningTitleClippedCount: runningThreadTitles.filter((node) => node.scrollWidth > node.clientWidth).length,
    runningTitleTooltipCount: runningThreadTitles.filter((node) => node.getAttribute('title') === (node.textContent || '').trim()).length,
    threadMenuTriggerCount: threadMenuTriggers.length,
    threadMenuAccessibleCount: threadMenuTriggers.filter((node) => {
      const label = node.getAttribute('aria-label') || '';
      return label.startsWith('会话操作：') && node.getAttribute('title') === label;
    }).length,
    internalThreadMenuKeyCount: threadMenuTriggers.filter((node) => node.getAttribute('title') === 'thread_menu').length,
    threadPinButtonCount: threadPinButtons.length,
    exactThreadPinActionCount: rows.filter((row) => {
      const button = row.querySelector('.thread-pin-button');
      const title = (row.querySelector('.thread-row-title')?.textContent || '').trim();
      const expected = `${row.getAttribute('data-pinned') === 'true' ? '取消置顶' : '置顶会话'}：${title}`;
      return !!button && button.getAttribute('aria-label') === expected && button.getAttribute('title') === expected;
    }).length,
    projectTitleCount: projectTitles.length,
    projectTitleTooltipCount: projectTitles.filter((node) => node.getAttribute('title') === (node.textContent || '').trim()).length,
    attentionBadgeText: attentionBadge?.textContent?.trim() || '',
    attentionButtonLabel: attentionButton?.getAttribute('aria-label') || '',
    attentionBadgeVisible: !!attentionBadge && attentionBadge.getBoundingClientRect().width > 0,
    rowFitFailureCount: rowFitFailures.length,
    hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  };
})())
'@
  return Invoke-BrowserEvalJson -Session $Session -Script $script
}

function Assert-SidebarFixture {
  param([object]$Metrics)

  Assert-True ($Metrics.rowCount -ge 4) "sidebar fixture is missing thread rows"
  Assert-True ($Metrics.projectOrder.Count -ge 3) "sidebar fixture is missing project groups"
  Assert-True ([string]$Metrics.projectOrder[0] -eq "E:/javaword/CXCodex/playground") "sidebar fixture newest directory is not first"
  Assert-True ([string]$Metrics.projectOrder[1] -eq "E:/javaword/CXCodex/codexui") "sidebar fixture second-newest directory order drifted"
  Assert-True ([string]$Metrics.projectOrder[2] -eq "empty-root") "sidebar fixture empty workspace should remain after projects with recent conversations"
  Assert-True ([int]$Metrics.pinnedProjectCount -eq 1) "sidebar fixture pinned project marker count is unexpected: $($Metrics.pinnedProjectCount)"
  Assert-True ($Metrics.firstProjectPinned -eq $false) "pinned-project metadata must not override recent directory order"
  Assert-True ([string]$Metrics.directoryHeaderText -eq "目录") "sidebar fixture fixed hierarchy header drifted"
  Assert-True ([string]$Metrics.directorySubtitleText -eq "最近会话优先") "sidebar fixture recency contract is not visible"
  Assert-True ($Metrics.hasEmptyWorkspaceProject -eq $true) "sidebar fixture filtered out empty workspace-root project"
  Assert-True ([string]$Metrics.emptyWorkspaceProjectText -like "*暂无会话*") "sidebar fixture empty workspace-root project does not show empty state"
  Assert-True ([int]$Metrics.emptyWorkspaceNewThreadButtonCount -eq 0) "sidebar fixture desktop-parity mode should keep the project-level new-thread action in the project menu"
  Assert-True ([int]$Metrics.emptyWorkspaceProjectMenuTriggerCount -eq 1) "sidebar fixture empty workspace-root project is missing its project menu"
  Assert-True ([int]$Metrics.codexProjectThreadRowCount -eq 5) "sidebar fixture codex directory should show exactly 5 threads by default, got $($Metrics.codexProjectThreadRowCount)"
  $expectedCodexProjectThreadIds = @(
    "fixture-thread-running",
    "fixture-thread-unread",
    "fixture-thread-idle",
    "fixture-thread-four",
    "fixture-thread-five"
  )
  for ($index = 0; $index -lt $expectedCodexProjectThreadIds.Count; $index++) {
    Assert-True ([string]$Metrics.codexProjectThreadIds[$index] -eq $expectedCodexProjectThreadIds[$index]) "sidebar fixture directory thread order drifted at index $index; expected $($expectedCodexProjectThreadIds[$index]), got $($Metrics.codexProjectThreadIds[$index])"
  }
  Assert-True ([int]$Metrics.showMoreButtonCount -ge 1) "sidebar fixture is missing show more control for long project thread list"
  Assert-True ([string]$Metrics.firstShowMoreText -eq "显示更多 3 条") "sidebar fixture show more label is unexpected: $($Metrics.firstShowMoreText)"
  Assert-True ([int]$Metrics.pinnedSectionThreadIds.Count -eq 2) "sidebar fixture pinned section should show exactly 2 pinned threads, got $($Metrics.pinnedSectionThreadIds.Count)"
  Assert-True ([string]$Metrics.pinnedSectionThreadIds[0] -eq "fixture-thread-running") "sidebar fixture newest pinned conversation is not first"
  Assert-True ([string]$Metrics.pinnedSectionThreadIds[1] -eq "fixture-thread-unread") "sidebar fixture older pinned conversation order drifted"
  Assert-True ([int]$Metrics.runningSectionThreadIds.Count -eq 0) "sidebar fixture must not create a parallel running section"
  Assert-True ([int]$Metrics.runningThreadRowCount -eq 2) "sidebar fixture pinned running thread should appear only in pinned section and project list"
  Assert-True ([int]$Metrics.runningThreadProjectRowCount -eq 1) "sidebar fixture running thread is not retained exactly once in project list"
  Assert-True ([int]$Metrics.waitingThreadRowCount -ge 1) "sidebar fixture is missing the waiting task row"
  Assert-True ([int]$Metrics.waitingSourceCount -eq [int]$Metrics.waitingThreadRowCount) "sidebar fixture waiting task must use explicit text instead of color alone"
  Assert-True ([int]$Metrics.pinnedThreadRowCount -eq 2) "sidebar fixture pinned thread should appear only in pinned section and project list"
  Assert-True ([int]$Metrics.pinnedThreadProjectRowCount -eq 1) "sidebar fixture pinned thread is not retained exactly once in project list"
  Assert-True ([int]$Metrics.sourceCount -eq ([int]$Metrics.runningThreadRowCount + [int]$Metrics.waitingThreadRowCount + [int]$Metrics.backgroundThreadRowCount)) "sidebar fixture should only keep text metadata for active threads"
  Assert-True ($Metrics.indicatorCount -ge 2) "sidebar fixture is missing unread/running indicators"
  Assert-True ($Metrics.minRowHeight -ge 40) "sidebar fixture row height is too small: $($Metrics.minRowHeight)"
  Assert-True ($Metrics.maxRowHeight -le 52) "sidebar fixture row height is too large: $($Metrics.maxRowHeight)"
  Assert-True ($Metrics.maxRowRadius -le 10) "sidebar fixture row radius is too large: $($Metrics.maxRowRadius)"
  Assert-True ($Metrics.hasPillSourceStyle -eq $false) "sidebar fixture still renders source/status as pill chips"
  Assert-True ($Metrics.workingIndicator.animationName -notlike "*spin*") "sidebar fixture running indicator still uses spinner animation"
  Assert-True ($null -ne $Metrics.waitingIndicator) "sidebar fixture is missing the waiting indicator"
  Assert-True ([string]$Metrics.waitingIndicator.backgroundColor -ne [string]$Metrics.workingIndicator.backgroundColor) "sidebar fixture waiting indicator must remain visually distinct from ordinary running work"
  Assert-True ([int]$Metrics.threadTitleCount -eq [int]$Metrics.threadTitleTooltipCount) "sidebar fixture does not expose every full thread title on hover"
  Assert-True ([int]$Metrics.runningTitleClippedCount -eq [int]$Metrics.runningThreadRowCount) "sidebar fixture long-title probe is no longer clipped in every rendered location"
  Assert-True ([int]$Metrics.runningTitleTooltipCount -eq [int]$Metrics.runningThreadRowCount) "sidebar fixture clipped running title is missing its full-title affordance"
  Assert-True ([int]$Metrics.threadMenuTriggerCount -eq [int]$Metrics.threadMenuAccessibleCount) "sidebar fixture thread action triggers are missing exact accessible labels"
  Assert-True ([int]$Metrics.internalThreadMenuKeyCount -eq 0) "sidebar fixture exposed the internal thread_menu key to users"
  Assert-True ([int]$Metrics.threadPinButtonCount -eq [int]$Metrics.exactThreadPinActionCount) "sidebar fixture direct pin actions do not match their current pinned state and thread title"
  Assert-True ([int]$Metrics.projectTitleCount -eq [int]$Metrics.projectTitleTooltipCount) "sidebar fixture does not expose every full project title on hover"
  Assert-True ($Metrics.attentionBadgeVisible -eq $true) "sidebar fixture collapsed control is missing its visible attention badge"
  Assert-True ([string]$Metrics.attentionBadgeText -eq "2") "sidebar fixture attention badge count is unexpected: $($Metrics.attentionBadgeText)"
  Assert-True ([string]$Metrics.attentionButtonLabel -eq "展开侧栏，2 个任务需要关注") "sidebar fixture attention control is missing its exact accessible label"
  Assert-True ($Metrics.rowFitFailureCount -eq 0) "sidebar fixture rows overflow viewport"
  Assert-True ($Metrics.hasHorizontalOverflow -eq $false) "sidebar fixture has horizontal overflow: $($Metrics.scrollWidth) > $($Metrics.clientWidth)"
}

function Assert-SidebarFixtureNewThreadMenu {
  param([string]$Session)

  $openScript = @'
JSON.stringify((() => {
  const trigger = document.querySelector('.project-group[data-project-name="empty-root"] .project-menu-trigger');
  if (trigger instanceof HTMLElement) trigger.scrollIntoView({ block: 'end' });
  return { triggerFound: trigger instanceof HTMLElement };
})())
'@
  $openState = Invoke-BrowserEvalJson -Session $Session -Script $openScript
  Assert-True ($openState.triggerFound -eq $true) "sidebar fixture empty workspace-root project menu trigger is missing"
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "100") | Out-Null
  Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const trigger = document.querySelector('.project-group[data-project-name="empty-root"] .project-menu-trigger');
  if (trigger instanceof HTMLElement) trigger.click();
  return { clicked: trigger instanceof HTMLElement };
})())
'@ | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "150") | Out-Null
  $script = @'
JSON.stringify({
  menuCount: document.querySelectorAll('.project-menu-panel').length,
  itemCount: document.querySelectorAll('.project-menu-panel [role="menuitem"]').length,
  newThreadActionCount: Array.from(document.querySelectorAll('.project-menu-panel .project-menu-item')).filter((node) => (node.textContent || '').trim() === '新建任务').length,
  expandedTriggerCount: document.querySelectorAll('.project-menu-trigger[aria-expanded="true"]').length,
  activeText: document.activeElement?.textContent?.trim() || '',
  side: document.querySelector('.project-menu-panel')?.getAttribute('data-side') || '',
  fitsViewport: (() => {
    const rect = document.querySelector('.project-menu-panel')?.getBoundingClientRect();
    return !!rect
      && rect.left >= 7
      && rect.top >= 7
      && rect.right <= document.documentElement.clientWidth - 7
      && rect.bottom <= document.documentElement.clientHeight - 7;
  })(),
  hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
})
'@
  $state = Invoke-BrowserEvalJson -Session $Session -Script $script
  Assert-True ([int]$state.menuCount -eq 1) "one project-menu request rendered duplicate panels: $($state.menuCount)"
  Assert-True ([int]$state.itemCount -eq 3) "shared project menu lost one or more actions: $($state.itemCount)"
  Assert-True ([int]$state.newThreadActionCount -eq 1) "sidebar fixture empty workspace-root project menu is missing new-thread action"
  Assert-True ([int]$state.expandedTriggerCount -eq 1) "only the exact project trigger may claim the shared open menu"
  Assert-True ([string]$state.activeText -eq "新建任务") "shared project menu did not move focus to its first action"
  Assert-True ([string]$state.side -eq "top") "lower project menu did not flip above its viewport anchor"
  Assert-True ($state.fitsViewport -eq $true) "shared project menu escaped the phone viewport"
  Assert-True ($state.hasHorizontalOverflow -eq $false) "shared project menu introduced horizontal page overflow"

  $keyboardState = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'ArrowDown',
    bubbles: true,
    cancelable: true
  }));
  return { activeText: document.activeElement?.textContent?.trim() || '' };
})())
'@
  Assert-True ([string]$keyboardState.activeText -eq "修改名称") "ArrowDown did not move focus through the shared project menu"

  Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  if (document.activeElement instanceof HTMLElement) document.activeElement.click();
  return { clicked: true };
})())
'@ | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "100") | Out-Null
  $renameState = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const input = document.querySelector('#sidebar-project-rename-input');
  const rect = document.querySelector('.project-menu-panel')?.getBoundingClientRect();
  return {
    inputFocused: input instanceof HTMLElement && document.activeElement === input,
    inputValue: input instanceof HTMLInputElement ? input.value : '',
    fitsViewport: !!rect
      && rect.left >= 7
      && rect.top >= 7
      && rect.right <= document.documentElement.clientWidth - 7
      && rect.bottom <= document.documentElement.clientHeight - 7
  };
})())
'@
  Assert-True ($renameState.inputFocused -eq $true) "project rename mode did not focus its editable field"
  Assert-True ([string]$renameState.inputValue -eq "Empty Workspace") "project rename mode did not preserve the current display name"
  Assert-True ($renameState.fitsViewport -eq $true) "project rename mode escaped the phone viewport after resizing"

  Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true
  }));
  return { dispatched: true };
})())
'@ | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "100") | Out-Null
  $closedState = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const trigger = document.querySelector('.project-group[data-project-name="empty-root"] .project-menu-trigger');
  return {
    menuCount: document.querySelectorAll('.project-menu-panel').length,
    focusRestored: document.activeElement === trigger
  };
})())
'@
  Assert-True ([int]$closedState.menuCount -eq 0) "Escape left the shared project menu open"
  Assert-True ($closedState.focusRestored -eq $true) "Escape did not restore focus to the exact project trigger"
}

function Assert-SidebarFixtureThreadMenuCollisionHandling {
  param([string]$Session)

  $openState = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const duplicateRows = document.querySelectorAll('[data-thread-id="fixture-thread-running"]');
  const trigger = document.querySelector('.pinned-section [data-thread-id="fixture-thread-running"] .thread-menu-trigger');
  if (trigger instanceof HTMLElement) trigger.click();
  return {
    duplicateRowCount: duplicateRows.length,
    triggerFound: trigger instanceof HTMLElement
  };
})())
'@
  Assert-True ([int]$openState.duplicateRowCount -ge 2) "sidebar fixture must render the pinned thread in more than one collection for collision verification"
  Assert-True ($openState.triggerFound -eq $true) "sidebar fixture pinned-thread menu trigger is missing"
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "150") | Out-Null

  $openMetrics = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const menus = Array.from(document.querySelectorAll('.thread-menu-panel'));
  const menu = menus[0];
  const rect = menu?.getBoundingClientRect();
  const expandedTriggers = Array.from(document.querySelectorAll('.thread-menu-trigger[aria-expanded="true"]'));
  return {
    menuCount: menus.length,
    itemCount: menu?.querySelectorAll('[role="menuitem"]').length || 0,
    expandedTriggerCount: expandedTriggers.length,
    activeText: document.activeElement?.textContent?.trim() || '',
    side: menu?.getAttribute('data-side') || '',
    fitsViewport: !!rect
      && rect.left >= 7
      && rect.top >= 7
      && rect.right <= document.documentElement.clientWidth - 7
      && rect.bottom <= document.documentElement.clientHeight - 7,
    hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
  };
})())
'@
  Assert-True ([int]$openMetrics.menuCount -eq 1) "one thread-menu request rendered duplicate panels: $($openMetrics.menuCount)"
  Assert-True ([int]$openMetrics.itemCount -eq 9) "shared thread menu lost one or more actions: $($openMetrics.itemCount)"
  Assert-True ([int]$openMetrics.expandedTriggerCount -eq 1) "duplicate thread rows must not all claim the same open menu"
  Assert-True ([string]$openMetrics.activeText -eq "浏览文件") "shared thread menu did not move focus to its first action"
  Assert-True ($openMetrics.fitsViewport -eq $true) "shared thread menu escaped the phone viewport"
  Assert-True ($openMetrics.hasHorizontalOverflow -eq $false) "shared thread menu introduced horizontal page overflow"

  $keyboardState = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'ArrowDown',
    bubbles: true,
    cancelable: true
  }));
  return { activeText: document.activeElement?.textContent?.trim() || '' };
})())
'@
  Assert-True ([string]$keyboardState.activeText -eq "导出会话") "ArrowDown did not move focus through the shared thread menu"

  Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true
  }));
  return { dispatched: true };
})())
'@ | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "100") | Out-Null
  $closedState = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const trigger = document.querySelector('.pinned-section [data-thread-id="fixture-thread-running"] .thread-menu-trigger');
  return {
    menuCount: document.querySelectorAll('.thread-menu-panel').length,
    focusRestored: document.activeElement === trigger
  };
})())
'@
  Assert-True ([int]$closedState.menuCount -eq 0) "Escape left the shared thread menu open"
  Assert-True ($closedState.focusRestored -eq $true) "Escape did not restore focus to the exact duplicate-row trigger"

  $outsideOpenState = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const trigger = document.querySelector('.pinned-section [data-thread-id="fixture-thread-running"] .thread-menu-trigger');
  if (trigger instanceof HTMLElement) trigger.click();
  return { triggerFound: trigger instanceof HTMLElement };
})())
'@
  Assert-True ($outsideOpenState.triggerFound -eq $true) "sidebar fixture pinned-thread menu trigger is missing before outside-close verification"
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "100") | Out-Null
  Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  document.body.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    composed: true,
    pointerType: 'mouse'
  }));
  return { dispatched: true };
})())
'@ | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "100") | Out-Null
  $outsideClosedState = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify({ menuCount: document.querySelectorAll('.thread-menu-panel').length })
'@
  Assert-True ([int]$outsideClosedState.menuCount -eq 0) "outside pointer interaction left the shared thread menu open"

  $scrolledState = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const rows = Array.from(document.querySelectorAll('.project-group .thread-row'));
  const row = rows.at(-1);
  row?.scrollIntoView({ block: 'end' });
  return { rowFound: row instanceof HTMLElement };
})())
'@
  Assert-True ($scrolledState.rowFound -eq $true) "sidebar fixture has no lower project row for menu flip verification"
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "100") | Out-Null
  $lowerOpenState = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const rows = Array.from(document.querySelectorAll('.project-group .thread-row'));
  const trigger = rows.at(-1)?.querySelector('.thread-menu-trigger');
  if (trigger instanceof HTMLElement) trigger.click();
  return { triggerFound: trigger instanceof HTMLElement };
})())
'@
  Assert-True ($lowerOpenState.triggerFound -eq $true) "sidebar fixture lower thread menu trigger is missing"
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "150") | Out-Null
  $lowerMetrics = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const menu = document.querySelector('.thread-menu-panel');
  const rect = menu?.getBoundingClientRect();
  return {
    menuCount: document.querySelectorAll('.thread-menu-panel').length,
    side: menu?.getAttribute('data-side') || '',
    fitsViewport: !!rect
      && rect.left >= 7
      && rect.top >= 7
      && rect.right <= document.documentElement.clientWidth - 7
      && rect.bottom <= document.documentElement.clientHeight - 7
  };
})())
'@
  Assert-True ([int]$lowerMetrics.menuCount -eq 1) "lower thread row rendered more than one menu"
  Assert-True ([string]$lowerMetrics.side -eq "top") "lower thread menu did not flip above its viewport anchor"
  Assert-True ($lowerMetrics.fitsViewport -eq $true) "flipped lower thread menu escaped the phone viewport"

  Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true
  }));
  return { dispatched: true };
})())
'@ | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "100") | Out-Null
}

function Assert-SidebarFixtureProjectScrollAnchor {
  param([string]$Session)

  $before = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const scroll = document.querySelector('.sidebar-regression-tree');
  const playground = document.querySelector('[data-project-name="E:/javaword/CXCodex/playground"]');
  const promote = document.querySelector('[data-regression-action="promote-background-project"]');
  if (!(scroll instanceof HTMLElement) || !(playground instanceof HTMLElement) || !(promote instanceof HTMLButtonElement)) {
    return { ready: false };
  }
  scroll.scrollTop = 220;
  const viewport = scroll.getBoundingClientRect();
  return {
    ready: true,
    scrollTop: scroll.scrollTop,
    playgroundTop: playground.getBoundingClientRect().top - viewport.top,
    projectOrder: Array.from(scroll.querySelectorAll('.project-group')).map((node) => node.getAttribute('data-project-name') || '')
  };
})())
'@
  Assert-True ($before.ready -eq $true) "sidebar fixture scroll-anchor probe is not ready"
  Assert-True ([string]$before.projectOrder[0] -eq "E:/javaword/CXCodex/playground") "sidebar fixture scroll-anchor baseline order drifted"

  Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const promote = document.querySelector('[data-regression-action="promote-background-project"]');
  promote?.click();
  return { clicked: promote instanceof HTMLButtonElement };
})())
'@ | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "350") | Out-Null

  $after = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const scroll = document.querySelector('.sidebar-regression-tree');
  const playground = document.querySelector('[data-project-name="E:/javaword/CXCodex/playground"]');
  const viewport = scroll?.getBoundingClientRect();
  return {
    scrollTop: scroll?.scrollTop || 0,
    playgroundTop: playground && viewport ? playground.getBoundingClientRect().top - viewport.top : Number.NaN,
    projectOrder: Array.from(document.querySelectorAll('.sidebar-regression-tree .project-group')).map((node) => node.getAttribute('data-project-name') || ''),
    hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
  };
})())
'@
  Assert-True ([string]$after.projectOrder[0] -eq "empty-root") "background materialization did not promote the updated workspace"
  Assert-True ([string]$after.projectOrder[1] -eq "E:/javaword/CXCodex/playground") "background materialization lost the previously visible project"
  Assert-True ([Math]::Abs([double]$after.playgroundTop - [double]$before.playgroundTop) -le 1.5) "background project reorder moved the visible anchor by $([Math]::Round([double]$after.playgroundTop - [double]$before.playgroundTop, 2)) px"
  Assert-True ([double]$after.scrollTop -gt [double]$before.scrollTop) "sidebar did not compensate scroll position for the promoted workspace"
  Assert-True ($after.hasHorizontalOverflow -eq $false) "sidebar scroll anchoring introduced horizontal page overflow"
}

function Assert-SidebarFixtureCurrentThreadReveal {
  param([string]$Session)

  $before = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const scroll = document.querySelector('.sidebar-regression-tree');
  const selectedProject = document.querySelector('.sidebar-regression-tree .project-group[data-project-name="E:/javaword/CXCodex/codexui"]');
  const action = document.querySelector('[data-regression-action="reveal-current-thread"]');
  if (!(scroll instanceof HTMLElement) || !(action instanceof HTMLButtonElement)) {
    return { ready: false };
  }
  scroll.scrollTop = 0;
  return {
    ready: true,
    activeMounted: document.querySelector('.sidebar-regression-tree .thread-row[data-active="true"]') !== null,
    renderedProjectRows: selectedProject?.querySelectorAll('.thread-row').length || 0,
    scrollTop: scroll.scrollTop
  };
})())
'@
  Assert-True ($before.ready -eq $true) "sidebar current-thread reveal fixture is not ready"
  Assert-True ($before.activeMounted -eq $false) "sidebar current-thread fixture target must begin outside the five-row preview"
  Assert-True ([int]$before.renderedProjectRows -eq 5) "sidebar current-thread fixture preview baseline drifted"

  Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const action = document.querySelector('[data-regression-action="reveal-current-thread"]');
  action?.click();
  return { clicked: action instanceof HTMLButtonElement };
})())
'@ | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "650") | Out-Null

  $after = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const scroll = document.querySelector('.sidebar-regression-tree');
  const row = document.querySelector('.sidebar-regression-tree .thread-row[data-active="true"]');
  const selectedProject = document.querySelector('.sidebar-regression-tree .project-group[data-project-name="E:/javaword/CXCodex/codexui"]');
  const viewport = scroll?.getBoundingClientRect();
  const bounds = row?.getBoundingClientRect();
  return {
    activeThreadId: row?.getAttribute('data-thread-id') || '',
    renderedProjectRows: selectedProject?.querySelectorAll('.thread-row').length || 0,
    moreLabel: selectedProject?.querySelector('.thread-show-more-button')?.textContent?.trim() || '',
    scrollTop: scroll?.scrollTop || 0,
    visible: !!viewport && !!bounds && bounds.top >= viewport.top && bounds.bottom <= viewport.bottom,
    hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
  };
})())
'@
  Assert-True ([string]$after.activeThreadId -eq "fixture-thread-eight") "current-thread reveal did not mount the selected hidden conversation"
  Assert-True ([int]$after.renderedProjectRows -eq 8 -and [string]$after.moreLabel -eq "收起") "current-thread reveal did not expand the truncated project preview"
  Assert-True ([double]$after.scrollTop -gt 0 -and $after.visible -eq $true) "current-thread reveal did not scroll the selected row into view"
  Assert-True ($after.hasHorizontalOverflow -eq $false) "current-thread reveal introduced horizontal page overflow"

  $manual = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const scroll = document.querySelector('.sidebar-regression-tree');
  if (scroll instanceof HTMLElement) scroll.scrollTop = 0;
  return { scrollTop: scroll?.scrollTop || 0 };
})())
'@
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "250") | Out-Null
  $settled = Invoke-BrowserEvalJson -Session $Session -Script "JSON.stringify({ scrollTop: document.querySelector('.sidebar-regression-tree')?.scrollTop || 0 })"
  Assert-True ([double]$manual.scrollTop -eq 0 -and [double]$settled.scrollTop -eq 0) "current-thread reveal must not auto-snap after later user-owned scrolling"
}

function Assert-SidebarFixtureStaleSearchMerge {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const projectRows = Array.from(document.querySelectorAll('.project-group .thread-row'));
  return {
    threadIds: projectRows.map((node) => node.getAttribute('data-thread-id') || ''),
    hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
  };
})())
'@
  $state = Invoke-BrowserEvalJson -Session $Session -Script $script
  Assert-True (@($state.threadIds) -contains "fixture-thread-six") "sidebar stale server search result suppressed a current local title match"
  Assert-True (@($state.threadIds) -contains "fixture-thread-unread") "sidebar stale-search fixture lost the server-index match"
  Assert-True ($state.hasHorizontalOverflow -eq $false) "sidebar stale-search fixture has horizontal overflow"
}

function Assert-SidebarFixtureSearchContinuity {
  param([string]$Session)

  $readState = {
    Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify({
  threadIds: Array.from(document.querySelectorAll('.project-group .thread-row')).map((node) => node.getAttribute('data-thread-id') || ''),
  noResultsVisible: document.querySelector('.thread-tree-no-results') !== null,
  hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
})
'@
  }

  $held = & $readState
  Assert-True (@($held.threadIds) -contains "fixture-thread-unread") "sidebar search did not hold the compatible prefix result"
  Assert-True (@($held.threadIds) -contains "fixture-thread-six") "sidebar search lost the current local-title match while holding prefix results"

  $divergeAction = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const button = document.querySelector('[data-regression-action="diverge-search-query"]');
  button?.click();
  return { clicked: button instanceof HTMLButtonElement };
})())
'@
  Assert-True ($divergeAction.clicked -eq $true) "sidebar search continuity fixture diverge action is unavailable"
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "80") | Out-Null
  $diverged = & $readState
  Assert-True (-not (@($diverged.threadIds) -contains "fixture-thread-unread")) "sidebar search kept an unrelated stale server result after the query diverged"
  Assert-True (@($diverged.threadIds) -contains "fixture-thread-idle") "sidebar search did not fall back to the current local-title match"
  Assert-True ($diverged.noResultsVisible -eq $false) "sidebar search flashed an empty state despite a current local-title match"

  $restoreAction = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const button = document.querySelector('[data-regression-action="restore-search-prefix"]');
  button?.click();
  return { clicked: button instanceof HTMLButtonElement };
})())
'@
  Assert-True ($restoreAction.clicked -eq $true) "sidebar search continuity fixture restore action is unavailable"
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "80") | Out-Null
  $restored = & $readState
  Assert-True (@($restored.threadIds) -contains "fixture-thread-unread") "sidebar search did not restore the compatible held result"
  Assert-True (@($restored.threadIds) -contains "fixture-thread-six") "sidebar search did not restore the current local-title match"
  Assert-True ($restored.noResultsVisible -eq $false) "sidebar search showed an empty state after restoring the compatible prefix"
  Assert-True ($held.hasHorizontalOverflow -eq $false -and $diverged.hasHorizontalOverflow -eq $false -and $restored.hasHorizontalOverflow -eq $false) "sidebar search continuity fixture has horizontal overflow"
  Write-Step ("sidebar search continuity -> " + (@{
    held = @($held.threadIds)
    diverged = @($diverged.threadIds)
    restored = @($restored.threadIds)
  } | ConvertTo-Json -Compress))
}

function Read-ComposerFixtureMetrics {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const fixture = document.querySelector('.composer-regression-fixture');
  const form = document.querySelector('.composer-regression-fixture .thread-composer');
  const shell = document.querySelector('.composer-regression-fixture .thread-composer-shell');
  const input = document.querySelector('.composer-regression-fixture .thread-composer-input');
  const controls = document.querySelector('.composer-regression-fixture .thread-composer-controls');
  const attach = document.querySelector('.composer-regression-fixture .thread-composer-attach-trigger');
  const runtime = document.querySelector('.composer-regression-fixture .thread-composer-runtime-trigger');
  const mic = document.querySelector('.composer-regression-fixture .thread-composer-mic');
  const expand = document.querySelector('.composer-regression-fixture .thread-composer-expand');
  const submit = document.querySelector('.composer-regression-fixture .thread-composer-submit');
  const dictationStatusText = document.querySelector('.composer-regression-fixture .thread-composer-dictation-statusbar-text');
  const dictationProbe = document.querySelector('.composer-regression-fixture .composer-regression-dictation-insert');
  const submitCount = document.querySelector('.composer-regression-fixture .composer-regression-submit-count');
  const shellRect = shell?.getBoundingClientRect();
  const formRect = form?.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth;
  const fitTargets = [form, shell, input, controls, attach, runtime, expand, mic, submit].filter(Boolean);
  const fitFailures = fitTargets
    .map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        className: node.className || node.tagName,
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width)
      };
    })
    .filter((rect) => rect.left < -2 || rect.right > viewportWidth + 2);
  const style = shell ? window.getComputedStyle(shell) : null;
  const bg = style?.backgroundColor || '';
  return {
    hasFixture: !!fixture,
    hasForm: !!form,
    hasShell: !!shell,
    hasInput: !!input,
    hasAttach: !!attach,
    hasRuntime: !!runtime,
    hasMic: !!mic,
    hasExpand: !!expand,
    hasSubmit: !!submit,
    hasDictationHelper: !!dictationStatusText,
    hasDictationProbe: !!dictationProbe,
    inputValue: input?.value || '',
    inputPlaceholder: input?.getAttribute('placeholder') || '',
    inputAriaLabel: input?.getAttribute('aria-label') || '',
    submitCount: Number.parseInt(submitCount?.textContent || '0', 10),
    dictationHelperText: dictationStatusText?.textContent?.trim() || '',
    shellWidth: shellRect ? Math.round(shellRect.width) : 0,
    viewportWidth,
    formWidth: formRect ? Math.round(formRect.width) : 0,
    shellHeight: shellRect ? Math.round(shellRect.height) : 0,
    shellRadius: style ? Number.parseFloat(style.borderTopLeftRadius || '0') : 0,
    shellBorderWidth: style ? Number.parseFloat(style.borderTopWidth || '0') : 0,
    shellBackground: bg,
    shellShadow: style?.boxShadow || '',
    usesWarmShell: bg === 'rgb(255, 253, 248)' || bg === 'rgb(255, 250, 243)',
    attachSize: attach ? Math.round(attach.getBoundingClientRect().width) : 0,
    expandSize: expand ? Math.round(expand.getBoundingClientRect().width) : 0,
    micSize: mic ? Math.round(mic.getBoundingClientRect().width) : 0,
    submitSize: submit ? Math.round(submit.getBoundingClientRect().width) : 0,
    runtimeWidth: runtime ? Math.round(runtime.getBoundingClientRect().width) : 0,
    fitFailureCount: fitFailures.length,
    fitFailures: fitFailures.slice(0, 5),
    hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  };
})())
'@
  return Invoke-BrowserEvalJson -Session $Session -Script $script
}

function Assert-ComposerFixture {
  param(
    [object]$Metrics,
    [string]$ViewportName
  )

  Assert-True ($Metrics.hasFixture -eq $true) "$ViewportName composer fixture is missing fixture root"
  Assert-True ($Metrics.hasForm -eq $true) "$ViewportName composer fixture is missing form"
  Assert-True ($Metrics.hasShell -eq $true) "$ViewportName composer fixture is missing shell"
  Assert-True ($Metrics.hasInput -eq $true) "$ViewportName composer fixture is missing input"
  Assert-True (-not [string]::IsNullOrWhiteSpace([string]$Metrics.inputAriaLabel)) "$ViewportName composer input is missing an accessible name"
  Assert-True ([string]$Metrics.inputAriaLabel -eq [string]$Metrics.inputPlaceholder) "$ViewportName composer accessible name drifted from its current placeholder"
  Assert-True ($Metrics.hasAttach -eq $true) "$ViewportName composer fixture is missing attach trigger"
  Assert-True ($Metrics.hasRuntime -eq $true) "$ViewportName composer fixture is missing runtime trigger"
  Assert-True ($Metrics.hasMic -eq $true) "$ViewportName composer fixture is missing dictation button"
  Assert-True ($Metrics.hasExpand -eq $true) "$ViewportName composer fixture is missing long-input expand button"
  Assert-True ($Metrics.hasSubmit -eq $true) "$ViewportName composer fixture is missing submit button"
  Assert-True ($Metrics.hasDictationHelper -eq $false) "$ViewportName composer fixture shows idle dictation helper text"
  Assert-True ($Metrics.hasDictationProbe -eq $true) "$ViewportName composer fixture is missing dictation regression probe"
  Assert-True ($Metrics.shellHeight -ge 82) "$ViewportName composer shell is too short: $($Metrics.shellHeight)"
  Assert-True ($Metrics.shellHeight -le 112) "$ViewportName composer shell is too tall: $($Metrics.shellHeight)"
  Assert-True ($Metrics.shellRadius -le 22) "$ViewportName composer shell radius is too large: $($Metrics.shellRadius)"
  Assert-True ($Metrics.shellBorderWidth -le 1) "$ViewportName composer shell border is too heavy: $($Metrics.shellBorderWidth)"
  Assert-True ($Metrics.usesWarmShell -eq $false) "$ViewportName composer shell still uses warm beige background: $($Metrics.shellBackground)"
  $minimumControlSize = if ([int]$Metrics.viewportWidth -lt 768) { 44 } else { 34 }
  Assert-True ($Metrics.attachSize -ge $minimumControlSize) "$ViewportName composer attach button is too small: $($Metrics.attachSize)"
  Assert-True ($Metrics.expandSize -ge $minimumControlSize) "$ViewportName composer expand button is too small: $($Metrics.expandSize)"
  Assert-True ($Metrics.micSize -ge $minimumControlSize) "$ViewportName composer mic button is too small: $($Metrics.micSize)"
  Assert-True ($Metrics.submitSize -ge $minimumControlSize) "$ViewportName composer submit button is too small: $($Metrics.submitSize)"
  Assert-True ($Metrics.runtimeWidth -ge 112) "$ViewportName composer runtime trigger is too narrow: $($Metrics.runtimeWidth)"
  Assert-True ($Metrics.fitFailureCount -eq 0) "$ViewportName composer controls overflow viewport: $($Metrics.fitFailures | ConvertTo-Json -Compress)"
  Assert-True ($Metrics.hasHorizontalOverflow -eq $false) "$ViewportName composer fixture has horizontal overflow: $($Metrics.scrollWidth) > $($Metrics.clientWidth)"
}

function Assert-ComposerAutoGrow {
  param(
    [string]$Session,
    [string]$ViewportName
  )

  $result = Invoke-BrowserEvalJson -Session $Session -Script @'
(async () => {
  const input = document.querySelector('.composer-regression-fixture .thread-composer-input');
  const expand = document.querySelector('.composer-regression-fixture .thread-composer-expand');
  const shell = document.querySelector('.composer-regression-fixture .thread-composer-shell');
  if (!(input instanceof HTMLTextAreaElement) || !(expand instanceof HTMLButtonElement) || !(shell instanceof HTMLElement)) {
    return JSON.stringify({ inputFound: false });
  }
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const setValue = async (value) => {
    valueSetter?.call(input, value);
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: value ? 'insertText' : 'deleteContentBackward',
      data: value || null,
    }));
    await settle();
    return {
      clientHeight: input.clientHeight,
      scrollHeight: input.scrollHeight,
    };
  };

  const initial = await setValue('');
  const multiline = await setValue(['第一行', '第二行', '第三行', '第四行', '第五行'].join('\n'));
  const capped = await setValue(Array.from({ length: 20 }, (_, index) => `第 ${index + 1} 行内容`).join('\n'));
  const shrunk = await setValue('');
  expand.click();
  await settle();
  const expanded = {
    inputHeight: input.clientHeight,
    shellHeight: shell.clientHeight,
    active: shell.classList.contains('thread-composer-shell--expanded'),
  };
  expand.click();
  await settle();

  return JSON.stringify({
    inputFound: true,
    supported: CSS.supports('field-sizing', 'content'),
    fieldSizing: getComputedStyle(input).fieldSizing,
    initial,
    multiline,
    capped,
    shrunk,
    expanded,
    hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
  });
})()
'@

  Assert-True ($result.inputFound -eq $true) "$ViewportName composer auto-grow probe could not find its input"
  Assert-True ($result.supported -eq $true) "$ViewportName regression browser does not support field-sizing: content"
  Assert-True ($result.fieldSizing -eq 'content') "$ViewportName composer did not enable content-driven field sizing"
  Assert-True ([int]$result.multiline.clientHeight -ge [int]$result.initial.clientHeight + 40) "$ViewportName composer did not grow for five lines: $($result.initial.clientHeight) -> $($result.multiline.clientHeight)"
  Assert-True ([int]$result.multiline.scrollHeight -le [int]$result.multiline.clientHeight + 1) "$ViewportName five-line composer scrolled before reaching its height cap"
  Assert-True ([int]$result.capped.clientHeight -ge [int]$result.multiline.clientHeight) "$ViewportName composer shrank while content grew"
  Assert-True ([int]$result.capped.clientHeight -le 132) "$ViewportName composer exceeded its compact 8rem cap: $($result.capped.clientHeight)"
  Assert-True ([int]$result.capped.scrollHeight -gt [int]$result.capped.clientHeight + 100) "$ViewportName long composer content did not retain bounded internal scrolling"
  Assert-True ([int]$result.shrunk.clientHeight -le [int]$result.initial.clientHeight + 1) "$ViewportName composer did not shrink after clearing: $($result.shrunk.clientHeight)"
  Assert-True ($result.expanded.active -eq $true -and [int]$result.expanded.inputHeight -gt [int]$result.capped.clientHeight) "$ViewportName half-screen composer no longer overrides compact auto-grow"
  Assert-True ($result.hasHorizontalOverflow -eq $false) "$ViewportName composer auto-grow introduced horizontal overflow"
  Write-Step ("composer auto-grow ($ViewportName) -> " + (@{
    initial = [int]$result.initial.clientHeight
    multiline = [int]$result.multiline.clientHeight
    capped = [int]$result.capped.clientHeight
    longScrollHeight = [int]$result.capped.scrollHeight
    shrunk = [int]$result.shrunk.clientHeight
    expanded = [int]$result.expanded.inputHeight
  } | ConvertTo-Json -Compress))
}

function Assert-ComposerEnterDefault {
  param(
    [string]$Session,
    [bool]$ExpectEnterSubmit,
    [string]$ViewportName
  )

  Invoke-AgentBrowser -Arguments @('--session', $Session, 'fill', '.thread-composer-input', '第一行') | Out-Null
  Invoke-AgentBrowser -Arguments @('--session', $Session, 'press', 'Enter') | Out-Null
  Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '80') | Out-Null
  $afterValue = Invoke-AgentBrowserJson -Arguments @('--session', $Session, 'get', 'value', '.thread-composer-input')
  $afterCount = Invoke-AgentBrowserJson -Arguments @('--session', $Session, 'get', 'text', '.composer-regression-submit-count')
  $afterBox = Invoke-AgentBrowserJson -Arguments @('--session', $Session, 'get', 'box', '.thread-composer-input')
  Invoke-AgentBrowserJson -Arguments @('--session', $Session, 'keyboard', 'type', '焦点保留') | Out-Null
  $afterFocusProbe = Invoke-AgentBrowserJson -Arguments @('--session', $Session, 'get', 'value', '.thread-composer-input')

  if ($ExpectEnterSubmit) {
    Assert-True ([int]$afterCount.text -eq 1) "$ViewportName default Enter did not submit"
    Assert-True ([string]$afterValue.value -eq '') "$ViewportName submitted Composer did not clear its draft"
    Assert-True ([string]$afterFocusProbe.value -eq '焦点保留') "$ViewportName desktop Composer did not retain keyboard focus after Enter submit"
    Invoke-AgentBrowser -Arguments @('--session', $Session, 'fill', '.thread-composer-input', '') | Out-Null
  } else {
    Assert-True ([int]$afterCount.text -eq 0) "$ViewportName default Enter submitted instead of inserting a line break"
    Assert-True ([string]$afterValue.value -eq "第一行`n") "$ViewportName default Enter did not append one line break: $($afterValue.value | ConvertTo-Json -Compress)"
    Assert-True ([double]$afterBox.height -gt 32) "$ViewportName line break did not grow the Composer"
    Assert-True ([string]$afterFocusProbe.value -eq "第一行`n焦点保留") "$ViewportName line break moved focus away from the Composer"

    Invoke-AgentBrowser -Arguments @('--session', $Session, 'press', 'Control+Enter') | Out-Null
    Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '80') | Out-Null
    $afterShortcutCount = Invoke-AgentBrowserJson -Arguments @('--session', $Session, 'get', 'text', '.composer-regression-submit-count')
    $afterShortcutValue = Invoke-AgentBrowserJson -Arguments @('--session', $Session, 'get', 'value', '.thread-composer-input')
    Assert-True ([int]$afterShortcutCount.text -eq 1) "$ViewportName Ctrl+Enter fallback did not submit"
    Assert-True ([string]$afterShortcutValue.value -eq '') "$ViewportName Ctrl+Enter submit did not clear its draft"
  }

  Write-Step ("composer Enter default ($ViewportName) -> " + (@{
    enter = if ($ExpectEnterSubmit) { 'submit' } else { 'newline' }
    ctrlEnter = if ($ExpectEnterSubmit) { 'not-probed' } else { 'submit' }
    enterHeight = [Math]::Round([double]$afterBox.height)
  } | ConvertTo-Json -Compress))
}

function Assert-ComposerSheetEnvironmentOwnership {
  param(
    [string]$Session,
    [bool]$ExpectModal,
    [string]$ViewportName
  )

  $cases = @(
    @{
      Name = 'attachment'
      Trigger = '.thread-composer-attach-trigger'
      Panel = '.thread-composer-attach-menu'
      PanelId = 'thread-composer-attach-menu'
    },
    @{
      Name = 'runtime'
      Trigger = '.thread-composer-runtime-trigger'
      Panel = '.thread-composer-runtime-panel'
      PanelId = 'thread-composer-runtime-panel'
    }
  )
  $results = @()

  foreach ($case in $cases) {
    $triggerSelector = $case.Trigger | ConvertTo-Json -Compress
    $panelSelector = $case.Panel | ConvertTo-Json -Compress
    $panelId = $case.PanelId
    $overflowBefore = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify({ value: document.body.style.overflow })
'@

    Invoke-AgentBrowser -Arguments @('--session', $Session, 'click', $case.Trigger) | Out-Null
    Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '100') | Out-Null
    $opened = Invoke-BrowserEvalJson -Session $Session -Script @"
JSON.stringify((() => {
  const trigger = document.querySelector($triggerSelector);
  const panel = document.querySelector($panelSelector);
  return {
    panelCount: document.querySelectorAll($panelSelector).length,
    panelContainsFocus: !!panel && panel.contains(document.activeElement),
    bodyOverflow: document.body.style.overflow,
    ariaModal: panel?.getAttribute('aria-modal') || '',
    triggerExpanded: trigger?.getAttribute('aria-expanded') || '',
    triggerHasPopup: trigger?.getAttribute('aria-haspopup') || '',
    triggerControls: trigger?.getAttribute('aria-controls') || ''
  };
})())
"@
    Assert-True ([int]$opened.panelCount -eq 1) "$ViewportName $($case.Name) composer panel did not open"
    Assert-True ($opened.panelContainsFocus -eq $true) "$ViewportName $($case.Name) composer panel did not receive initial focus"
    Assert-True ($opened.triggerExpanded -eq 'true') "$ViewportName $($case.Name) composer trigger did not expose its open state"
    Assert-True ($opened.triggerHasPopup -eq 'dialog') "$ViewportName $($case.Name) composer trigger lost dialog semantics"
    Assert-True ($opened.triggerControls -eq $panelId) "$ViewportName $($case.Name) composer trigger does not identify its panel"
    if ($case.Name -eq 'runtime') {
      $reasoningOptions = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const section = Array.from(document.querySelectorAll('.thread-composer-runtime-section'))
    .find((row) => row.querySelector('.thread-composer-runtime-section-title')?.textContent?.trim() === '质量');
  const labels = Array.from(section?.querySelectorAll('button') || [])
    .map((button) => button.textContent?.trim() || button.getAttribute('aria-label')?.trim() || '');
  return {
    count: labels.length,
    labels,
    unnamedCount: labels.filter((label) => !label).length
  };
})())
'@
      Assert-True ([int]$reasoningOptions.count -eq 6) "$ViewportName runtime fixture must expose all six current selectable reasoning levels"
      Assert-True ([int]$reasoningOptions.unnamedCount -eq 0) "$ViewportName runtime panel exposed an unnamed reasoning-level button"
      Assert-True ($reasoningOptions.labels -contains '最高' -and $reasoningOptions.labels -contains '极致') "$ViewportName runtime panel must label max and ultra distinctly"
    }

    $forwardContained = $false
    $backwardContained = $false
    $outsideFocusReclaimed = $false
    $outsideFocusAllowed = $false
    $nestedSkillOwned = $false
    if ($ExpectModal) {
      Assert-True ($opened.ariaModal -eq 'true') "$ViewportName $($case.Name) compact composer sheet is not exposed as modal"
      Assert-True ($opened.bodyOverflow -eq 'hidden') "$ViewportName $($case.Name) compact composer sheet did not lock background scrolling"

      Invoke-AgentBrowser -Arguments @('--session', $Session, 'press', 'Shift+Tab') | Out-Null
      $backward = Invoke-BrowserEvalJson -Session $Session -Script @"
JSON.stringify({ contained: document.querySelector($panelSelector)?.contains(document.activeElement) === true })
"@
      $backwardContained = $backward.contained -eq $true
      Assert-True $backwardContained "$ViewportName $($case.Name) compact composer sheet allowed Shift+Tab to escape"

      Invoke-AgentBrowser -Arguments @('--session', $Session, 'press', 'Tab') | Out-Null
      $forward = Invoke-BrowserEvalJson -Session $Session -Script @"
JSON.stringify({ contained: document.querySelector($panelSelector)?.contains(document.activeElement) === true })
"@
      $forwardContained = $forward.contained -eq $true
      Assert-True $forwardContained "$ViewportName $($case.Name) compact composer sheet allowed Tab to escape"

      $externalFocus = Invoke-BrowserEvalJson -Session $Session -Script @"
JSON.stringify((() => {
  const background = document.querySelector('[data-composer-regression-background-focus]');
  background?.focus();
  const panel = document.querySelector($panelSelector);
  return {
    panelCount: document.querySelectorAll($panelSelector).length,
    contained: !!panel && panel.contains(document.activeElement),
    backgroundFocused: document.activeElement === background
  };
})())
"@
      $outsideFocusReclaimed = $externalFocus.contained -eq $true -and $externalFocus.backgroundFocused -eq $false
      Assert-True ($externalFocus.panelCount -eq 1 -and $outsideFocusReclaimed) "$ViewportName $($case.Name) compact composer sheet allowed focus to escape to the background"
      if ($case.Name -eq 'attachment') {
        Invoke-AgentBrowser -Arguments @('--session', $Session, 'click', '.search-dropdown-trigger') | Out-Null
        Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '100') | Out-Null
        $nestedOpen = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const search = document.querySelector('.search-dropdown-search');
  document.querySelector('[data-composer-regression-background-focus]')?.focus();
  return {
    dialogCount: document.querySelectorAll('.search-dropdown-mobile-dialog').length,
    ariaModal: document.querySelector('.search-dropdown-mobile-dialog')?.getAttribute('aria-modal') || '',
    searchFocused: document.activeElement === search,
    bodyOverflow: document.body.style.overflow
  };
})())
'@
        Assert-True ([int]$nestedOpen.dialogCount -eq 1 -and $nestedOpen.ariaModal -eq 'true') "$ViewportName nested skill selector did not expose its compact modal boundary"
        Assert-True ($nestedOpen.searchFocused -eq $true) "$ViewportName nested skill selector allowed focus to escape"
        Assert-True ($nestedOpen.bodyOverflow -eq 'hidden') "$ViewportName nested skill selector released the outer composer scroll lock"
        Invoke-AgentBrowser -Arguments @('--session', $Session, 'press', 'Escape') | Out-Null
        Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '100') | Out-Null
        $nestedClosed = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify({
  dialogCount: document.querySelectorAll('.search-dropdown-mobile-dialog').length,
  attachmentCount: document.querySelectorAll('.thread-composer-attach-menu').length,
  triggerFocused: document.activeElement === document.querySelector('.search-dropdown-trigger'),
  bodyOverflow: document.body.style.overflow
})
'@
        $nestedSkillOwned = [int]$nestedClosed.dialogCount -eq 0 -and [int]$nestedClosed.attachmentCount -eq 1 -and $nestedClosed.triggerFocused -eq $true -and $nestedClosed.bodyOverflow -eq 'hidden'
        Assert-True $nestedSkillOwned "$ViewportName nested skill selector did not restore focus while preserving the attachment sheet"
        Save-RegressionScreenshot -Session $Session -Name 'composer-compact-sheet-focus-ownership-phone' | Out-Null
      }
    } else {
      Assert-True ([string]::IsNullOrEmpty([string]$opened.ariaModal)) "$ViewportName $($case.Name) desktop composer popover incorrectly claims modal semantics"
      Assert-True ($opened.bodyOverflow -eq $overflowBefore.value) "$ViewportName $($case.Name) desktop composer popover incorrectly locked body scrolling"
      $externalFocus = Invoke-BrowserEvalJson -Session $Session -Script @"
JSON.stringify((() => {
  const background = document.querySelector('[data-composer-regression-background-focus]');
  background?.focus();
  return {
    panelCount: document.querySelectorAll($panelSelector).length,
    backgroundFocused: document.activeElement === background
  };
})())
"@
      $outsideFocusAllowed = $externalFocus.panelCount -eq 1 -and $externalFocus.backgroundFocused -eq $true
      Assert-True $outsideFocusAllowed "$ViewportName $($case.Name) desktop composer popover unexpectedly trapped background focus"
    }

    Invoke-AgentBrowser -Arguments @('--session', $Session, 'press', 'Escape') | Out-Null
    Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '100') | Out-Null
    $closed = Invoke-BrowserEvalJson -Session $Session -Script @"
JSON.stringify((() => {
  const trigger = document.querySelector($triggerSelector);
  return {
    panelCount: document.querySelectorAll($panelSelector).length,
    triggerFocused: document.activeElement === trigger,
    triggerExpanded: trigger?.getAttribute('aria-expanded') || '',
    bodyOverflow: document.body.style.overflow
  };
})())
"@
    Assert-True ([int]$closed.panelCount -eq 0) "$ViewportName $($case.Name) composer panel remained open after Escape"
    Assert-True ($closed.triggerFocused -eq $true) "$ViewportName $($case.Name) composer panel did not restore focus to its opener"
    Assert-True ($closed.triggerExpanded -eq 'false') "$ViewportName $($case.Name) composer trigger did not expose its closed state"
    Assert-True ($closed.bodyOverflow -eq $overflowBefore.value) "$ViewportName $($case.Name) composer panel did not restore background scrolling"

    $results += [pscustomobject]@{
      panel = $case.Name
      modal = $ExpectModal
      backwardTabContained = $backwardContained
      forwardTabContained = $forwardContained
      outsideFocusReclaimed = $outsideFocusReclaimed
      outsideFocusAllowed = $outsideFocusAllowed
      nestedSkillOwned = $nestedSkillOwned
      openerFocusRestored = $true
      bodyScrollRestored = $true
    }
  }

  Write-Step ("composer sheet environment ownership ($ViewportName) -> " + ($results | ConvertTo-Json -Compress))
}

function Read-CommandMenuTypeAheadMetrics {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const input = document.querySelector('.command-menu-input');
  const results = Array.from(document.querySelectorAll('.command-menu-result'))
    .filter((row) => row.querySelector('.command-menu-result-icon--file'));
  const activeId = input?.getAttribute('aria-activedescendant') || '';
  const activeRow = activeId ? document.getElementById(activeId) : null;
  return {
    query: input instanceof HTMLInputElement ? input.value : '',
    focused: document.activeElement === input,
    busy: document.querySelector('.command-menu-results')?.getAttribute('aria-busy') === 'true',
    fileCount: results.length,
    filePaths: results.map((row) => row.querySelector('.command-menu-result-detail')?.textContent?.trim() || ''),
    loadingPanelCount: document.querySelectorAll('.command-menu-empty--files .command-menu-loading-indicator').length,
    activeId,
    activeRowConnected: activeRow?.isConnected === true,
    activeRowIsFile: activeRow?.querySelector('.command-menu-result-icon--file') != null,
  };
})())
'@
  return Invoke-BrowserEvalJson -Session $Session -Script $script
}

function Assert-CommandMenuModalFocusOwnership {
  param([string]$Session)

  $opened = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const launcher = document.querySelector('[data-command-menu-regression-launch]');
  const overflowBefore = document.body.style.overflow;
  if (launcher instanceof HTMLButtonElement) {
    launcher.focus();
    launcher.click();
  }
  return { clicked: launcher instanceof HTMLButtonElement, overflowBefore };
})())
'@
  Assert-True ($opened.clicked -eq $true) "command-menu focus fixture is missing its launcher"
  Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '100') | Out-Null

  $visible = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  const panel = document.querySelector('.command-menu-panel');
  const input = document.querySelector('.command-menu-input');
  return {
    panelCount: document.querySelectorAll('.command-menu-panel').length,
    inputFocused: document.activeElement === input,
    panelContainsFocus: !!panel && panel.contains(document.activeElement),
    bodyOverflow: document.body.style.overflow
  };
})())
'@
  Assert-True ([int]$visible.panelCount -eq 1) "command-menu focus fixture did not open the dialog"
  Assert-True ($visible.inputFocused -eq $true -and $visible.panelContainsFocus -eq $true) "command menu did not move initial focus into its search field"
  Assert-True ($visible.bodyOverflow -eq 'hidden') "command menu did not lock background scrolling"

  Invoke-AgentBrowser -Arguments @('--session', $Session, 'press', 'Tab') | Out-Null
  $forwardWrap = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify({
  inputFocused: document.activeElement === document.querySelector('.command-menu-input'),
  panelContainsFocus: document.querySelector('.command-menu-panel')?.contains(document.activeElement) === true
})
'@
  Assert-True ($forwardWrap.inputFocused -eq $true -and $forwardWrap.panelContainsFocus -eq $true) "Tab escaped the command-menu dialog"

  Invoke-AgentBrowser -Arguments @('--session', $Session, 'press', 'Shift+Tab') | Out-Null
  $backwardWrap = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify({
  inputFocused: document.activeElement === document.querySelector('.command-menu-input'),
  panelContainsFocus: document.querySelector('.command-menu-panel')?.contains(document.activeElement) === true
})
'@
  Assert-True ($backwardWrap.inputFocused -eq $true -and $backwardWrap.panelContainsFocus -eq $true) "Shift+Tab escaped the command-menu dialog"

  $externalFocus = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify((() => {
  document.querySelector('[data-command-menu-regression-launch]')?.focus();
  return {
    inputFocused: document.activeElement === document.querySelector('.command-menu-input'),
    panelContainsFocus: document.querySelector('.command-menu-panel')?.contains(document.activeElement) === true
  };
})())
'@
  Assert-True ($externalFocus.inputFocused -eq $true -and $externalFocus.panelContainsFocus -eq $true) "command menu allowed programmatic focus to escape to the background page"

  Invoke-AgentBrowser -Arguments @('--session', $Session, 'press', 'Escape') | Out-Null
  Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '100') | Out-Null
  $closed = Invoke-BrowserEvalJson -Session $Session -Script @'
JSON.stringify({
  panelCount: document.querySelectorAll('.command-menu-panel').length,
  launcherFocused: document.activeElement === document.querySelector('[data-command-menu-regression-launch]'),
  bodyOverflow: document.body.style.overflow
})
'@
  Assert-True ([int]$closed.panelCount -eq 0) "Escape left the command menu open"
  Assert-True ($closed.launcherFocused -eq $true) "closing the command menu did not restore focus to its opener"
  Assert-True ($closed.bodyOverflow -eq $opened.overflowBefore) "closing the command menu did not restore background scrolling"
  Write-Step ("command-menu modal focus ownership -> " + (@{
    forwardWrap = $true
    backwardWrap = $true
    outsideFocusReclaimed = $true
    openerFocusRestored = $true
    bodyScrollRestored = $true
  } | ConvertTo-Json -Compress))
}

function Assert-CommandMenuTypeAheadContinuity {
  param([string]$Session)

  Invoke-AgentBrowser -Arguments @('--session', $Session, 'fill', '.command-menu-input', 'src') | Out-Null
  Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '400') | Out-Null
  $settled = Read-CommandMenuTypeAheadMetrics -Session $Session
  Assert-True ([int]$settled.fileCount -eq 3) "command-menu type-ahead fixture did not settle its initial three file rows"
  Assert-True ($settled.focused -eq $true) "command-menu file search lost input focus after the initial result set"
  Assert-True ($settled.busy -eq $false) "command-menu initial file search did not settle"

  $heldScript = @'
(async () => {
  const input = document.querySelector('.command-menu-input');
  if (!(input instanceof HTMLInputElement)) return JSON.stringify({ inputFound: false });
  const suffix = '/components/content/c';
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  valueSetter?.call(input, `${input.value}${suffix}`);
  input.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    inputType: 'insertText',
    data: suffix,
  }));
  await new Promise((resolve) => window.setTimeout(resolve, 260));
  const results = Array.from(document.querySelectorAll('.command-menu-result'))
    .filter((row) => row.querySelector('.command-menu-result-icon--file'));
  const activeId = input.getAttribute('aria-activedescendant') || '';
  const activeRow = activeId ? document.getElementById(activeId) : null;
  return JSON.stringify({
    inputFound: true,
    query: input.value,
    focused: document.activeElement === input,
    busy: document.querySelector('.command-menu-results')?.getAttribute('aria-busy') === 'true',
    fileCount: results.length,
    filePaths: results.map((row) => row.querySelector('.command-menu-result-detail')?.textContent?.trim() || ''),
    loadingPanelCount: document.querySelectorAll('.command-menu-empty--files .command-menu-loading-indicator').length,
    activeId,
    activeRowConnected: activeRow?.isConnected === true,
    activeRowIsFile: activeRow?.querySelector('.command-menu-result-icon--file') != null,
  });
})()
'@
  $held = Invoke-BrowserEvalJson -Session $Session -Script $heldScript
  Assert-True ($held.inputFound -eq $true) "command-menu type-ahead fixture lost its search input"
  Assert-True ($held.busy -eq $true) "command-menu follow-up search was not exposed as busy"
  Assert-True ([int]$held.fileCount -eq 2) "command-menu follow-up search did not locally narrow the held file rows"
  Assert-True ([int]$held.loadingPanelCount -eq 0) "command-menu follow-up search replaced useful file rows with the full loading panel"
  Assert-True ($held.focused -eq $true) "command-menu follow-up search moved focus away from the input"
  Assert-True ($held.activeRowConnected -eq $true -and $held.activeRowIsFile -eq $true) "command-menu follow-up search lost its active file row while the request was pending"
  Save-RegressionScreenshot -Session $Session -Name 'command-menu-type-ahead-held-results' | Out-Null

  Invoke-AgentBrowser -Arguments @('--session', $Session, 'wait', '900') | Out-Null
  $resolved = Read-CommandMenuTypeAheadMetrics -Session $Session
  Assert-True ($resolved.busy -eq $false) "command-menu follow-up search did not settle"
  Assert-True ([int]$resolved.fileCount -eq 1) "command-menu follow-up search did not replace held rows with the authoritative result"
  Assert-True ($resolved.focused -eq $true) "command-menu authoritative refresh moved focus away from the input"
  Assert-True ($resolved.activeRowConnected -eq $true -and $resolved.activeRowIsFile -eq $true) "command-menu authoritative refresh lost the active file row"
  Write-Step ("command-menu type-ahead continuity -> " + (@{
    initialRows = [int]$settled.fileCount
    heldRows = [int]$held.fileCount
    resolvedRows = [int]$resolved.fileCount
    loadingPanelCount = [int]$held.loadingPanelCount
    focusRetained = $true
  } | ConvertTo-Json -Compress))
}

function Invoke-ComposerDictationProbe {
  param([string]$Session)

  Invoke-AgentBrowser -Arguments @(
    '--session',
    $Session,
    'eval',
    "document.querySelector('.composer-regression-fixture .composer-regression-dictation-insert')?.click()"
  ) | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "200") | Out-Null
}

function Read-ComposerDictationMetrics {
  param([string]$Session)

  $script = @'
JSON.stringify({
  inputValue: document.querySelector('.composer-regression-fixture .thread-composer-input')?.value || '',
  submitCount: Number.parseInt(document.querySelector('.composer-regression-submit-count')?.textContent || '0', 10),
  dictationHelperText: document.querySelector('.thread-composer-dictation-statusbar-text')?.textContent?.trim() || ''
})
'@
  return Invoke-BrowserEvalJson -Session $Session -Script $script
}

function Assert-ComposerDictationDraft {
  param(
    [object]$Metrics,
    [string]$ViewportName
  )

  Assert-True ($Metrics.inputValue -like "*语音转文字回归测试*") "$ViewportName composer dictation text was not inserted into the input"
  Assert-True ([int]$Metrics.submitCount -eq 0) "$ViewportName composer dictation auto-submitted unexpectedly"
  Assert-True ($Metrics.dictationHelperText -eq "已转成文字，可编辑后发送。") "$ViewportName composer dictation success text drifted: $($Metrics.dictationHelperText)"
  Write-Step "composer dictation draft ($ViewportName) -> inserted, submitCount=0"
}

function Assert-ComposerImeMentionSafety {
  param([string]$Session)

  $result = Invoke-BrowserEvalJson -Session $Session -Script @'
(async () => {
  const input = document.querySelector('.composer-regression-fixture .thread-composer-input');
  const submitCount = document.querySelector('.composer-regression-submit-count');
  if (!(input instanceof HTMLTextAreaElement)) return JSON.stringify({ inputFound: false });
  input.focus();
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  valueSetter?.call(input, '@Th');
  input.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    inputType: 'insertText',
    data: '@Th',
  }));
  const waitStartedAt = performance.now();
  while (
    document.querySelectorAll('.thread-composer-file-mention-row').length === 0
    && performance.now() - waitStartedAt < 2000
  ) {
    await new Promise((resolve) => window.setTimeout(resolve, 25));
  }

  const composingEnter = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: 'Enter',
    code: 'Enter',
    isComposing: true,
  });
  input.dispatchEvent(composingEnter);
  await new Promise((resolve) => window.setTimeout(resolve, 80));

  const processEnter = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: 'Enter',
    code: 'Enter',
    keyCode: 229,
    which: 229,
  });
  input.dispatchEvent(processEnter);
  await new Promise((resolve) => window.setTimeout(resolve, 80));

  const result = {
    inputFound: true,
    composingEnterPrevented: composingEnter.defaultPrevented,
    composingEnterIsComposing: composingEnter.isComposing,
    processEnterPrevented: processEnter.defaultPrevented,
    processEnterKeyCode: processEnter.keyCode,
    value: input.value,
    suggestionCount: document.querySelectorAll('.thread-composer-file-mention-row').length,
    attachmentCount: document.querySelectorAll('.thread-composer-file-chip').length,
    submitCount: Number.parseInt(submitCount?.textContent || '0', 10),
  };
  valueSetter?.call(input, '');
  input.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    inputType: 'deleteContentBackward',
    data: null,
  }));
  await new Promise((resolve) => window.setTimeout(resolve, 20));
  return JSON.stringify(result);
})()
'@

  Assert-True ($result.inputFound -eq $true) "composer IME mention probe could not find its input"
  Assert-True ($result.composingEnterIsComposing -eq $true) "composer IME mention probe did not create a composition event"
  Assert-True ([int]$result.processEnterKeyCode -eq 229) "composer IME mention probe did not create a process-key event"
  Assert-True ($result.composingEnterPrevented -eq $false -and $result.processEnterPrevented -eq $false) "composer intercepted an IME-owned Enter event"
  Assert-True ([string]$result.value -eq "@Th") "composer IME confirmation changed the active mention query: $($result.value)"
  Assert-True ([int]$result.suggestionCount -gt 0) "composer IME confirmation closed the file-mention suggestions"
  Assert-True ([int]$result.attachmentCount -eq 0) "composer IME confirmation selected a file attachment"
  Assert-True ([int]$result.submitCount -eq 0) "composer IME confirmation submitted the draft"
  Write-Step ("composer IME mention safety -> " + (@{
    valueRetained = $result.value
    suggestionCount = [int]$result.suggestionCount
    attachmentCount = [int]$result.attachmentCount
    submitCount = [int]$result.submitCount
  } | ConvertTo-Json -Compress))
}

function Read-ThreadPageLoadMetrics {
  param(
    [string]$Session,
    [string]$ThreadId
  )

  $script = @'
JSON.stringify((() => {
  const threadId = '__THREAD_ID__';
  const resources = performance.getEntriesByType('resource')
    .filter((entry) => entry.name.includes('/codex-api/'))
    .map((entry) => ({
      name: entry.name.replace(location.origin, ''),
      duration: Math.round(entry.duration),
      startTime: Math.round(entry.startTime),
      transferSize: entry.transferSize || 0,
      encodedBodySize: entry.encodedBodySize || 0,
    }));
  const statePath = `/codex-api/state/thread/${encodeURIComponent(threadId)}`;
  const runtimePath = `/codex-api/runtime/thread/${encodeURIComponent(threadId)}`;
  const tokenPath = `/codex-api/thread-token-usage?threadId=${encodeURIComponent(threadId)}`;
  const countByPath = (path) => resources.filter((entry) => entry.name === path).length;
  const summarizePath = (predicate) => {
    const matches = resources.filter(predicate);
    return {
      count: matches.length,
      firstStartMs: matches.length ? Math.min(...matches.map((entry) => entry.startTime)) : null,
      maxDurationMs: matches.length ? Math.max(...matches.map((entry) => entry.duration)) : 0,
      totalDurationMs: matches.reduce((sum, entry) => sum + entry.duration, 0),
      transferSize: matches.reduce((sum, entry) => sum + entry.transferSize, 0),
    };
  };
  const earlyRpcRequestCount = resources
    .filter((entry) => entry.startTime <= 650 && entry.name === '/codex-api/rpc')
    .length;
  const firstScreenProjectRootSuggestionCounts = resources
    .filter((entry) => entry.startTime <= 1500 && entry.name.startsWith('/codex-api/project-root-suggestion?'))
    .reduce((counts, entry) => {
      counts[entry.name] = (counts[entry.name] || 0) + 1;
      return counts;
    }, {});
  const firstScreenProjectRootSuggestionMaxDuplicateCount = Object.values(firstScreenProjectRootSuggestionCounts)
    .reduce((max, count) => Math.max(max, count), 0);
  const firstScreenWorkspaceRootsStateCount = resources
    .filter((entry) => entry.startTime <= 1500 && entry.name === '/codex-api/workspace-roots-state')
    .length;
  const firstScreenDesktopAppStatusCount = resources
    .filter((entry) => entry.startTime <= 1500 && entry.name === '/codex-api/desktop-app/status')
    .length;
  const visibleConversationItems = Array.from(document.querySelectorAll('.conversation-item[data-role]'));
  const conversationList = document.querySelector('.conversation-list');
  const messageCards = Array.from(document.querySelectorAll('.message-card'));
  const codeBlocks = Array.from(document.querySelectorAll('.message-code-block'));
  const codeLines = Array.from(document.querySelectorAll('.message-code-line'));
  const commandOutputWraps = Array.from(document.querySelectorAll('.cmd-output-wrap'));
  const mountedCommandOutputs = Array.from(document.querySelectorAll('.cmd-output-wrap .cmd-output'));
  const expandedRawPayloads = Array.from(document.querySelectorAll('.raw-payload-card[open], .message-raw-payload[open]'));
  const visibleUserMessageCount = visibleConversationItems
    .filter((node) => node.getAttribute('data-role') === 'user')
    .length;
  const visibleAssistantMessageCount = visibleConversationItems
    .filter((node) => node.getAttribute('data-role') === 'assistant')
    .length;
  const firstScreenReadyMetric = window.__cxCodexThreadFirstScreenReady?.[threadId] ?? null;
  const composerInput = document.querySelector('.thread-composer-input');
  const composerSubmit = document.querySelector('.thread-composer-submit');
  return {
    apiCount: resources.length,
    earlyRpcRequestCount,
    stateThreadRequestCount: countByPath(statePath),
    runtimeThreadRequestCount: countByPath(runtimePath),
    tokenUsageRequestCount: countByPath(tokenPath),
    firstScreenProjectRootSuggestionMaxDuplicateCount,
    firstScreenWorkspaceRootsStateCount,
    firstScreenDesktopAppStatusCount,
    visibleConversationItemCount: visibleConversationItems.length,
    visibleUserMessageCount,
    visibleAssistantMessageCount,
    routeMatchesThread: location.hash === `#/thread/${encodeURIComponent(threadId)}`,
    composerReady: composerInput instanceof HTMLTextAreaElement && !composerInput.disabled && composerSubmit instanceof HTMLButtonElement,
    emptyStateVisible: !!document.querySelector('.conversation-empty-state'),
    loadingIndicatorCount: document.querySelectorAll('.conversation-loading,[aria-busy="true"]').length,
    firstScreenReadyMs: firstScreenReadyMetric?.readyAtMs ?? null,
    firstScreenReadyItemCount: firstScreenReadyMetric?.itemCount ?? 0,
    firstScreenReadyUserCount: firstScreenReadyMetric?.userCount ?? 0,
    firstScreenReadyAssistantCount: firstScreenReadyMetric?.assistantCount ?? 0,
    messageCardCount: messageCards.length,
    codeBlockCount: codeBlocks.length,
    codeLineCount: codeLines.length,
    expandedCommandOutputCount: commandOutputWraps.filter((node) => node.classList.contains('cmd-output-visible')).length,
    mountedCommandOutputCount: mountedCommandOutputs.length,
    expandedRawPayloadCount: expandedRawPayloads.length,
    conversationDomNodeCount: conversationList ? conversationList.querySelectorAll('*').length : 0,
    bodyDomNodeCount: document.body.querySelectorAll('*').length,
    endpointTiming: {
      rpc: summarizePath((entry) => entry.name === '/codex-api/rpc'),
      stateThread: summarizePath((entry) => entry.name === statePath),
      runtimeThread: summarizePath((entry) => entry.name === runtimePath),
      tokenUsage: summarizePath((entry) => entry.name === tokenPath),
      workspaceRootsState: summarizePath((entry) => entry.name === '/codex-api/workspace-roots-state'),
      projectRootSuggestion: summarizePath((entry) => entry.name.startsWith('/codex-api/project-root-suggestion?')),
    },
    stateThreadEntries: resources
      .filter((entry) => entry.name === statePath)
      .map((entry) => ({
        startTime: entry.startTime,
        duration: entry.duration,
        transferSize: entry.transferSize,
      })),
    totalTransferSize: resources.reduce((sum, entry) => sum + entry.transferSize, 0),
    slowRequestCount: resources.filter((entry) => entry.duration >= 1500).length,
  };
})())
'@
  $script = $script.Replace('__THREAD_ID__', $ThreadId.Replace('\', '\\').Replace("'", "\'"))
  return Invoke-BrowserEvalJson -Session $Session -Script $script
}

function Assert-ThreadPageLoadMetrics {
  param(
    [object]$Metrics,
    [string]$ThreadId,
    [switch]$AllowAuthoritativeEmptyThread
  )

  if ($null -ne $Metrics.firstUsableMs) {
    Assert-True ([int]$Metrics.firstUsableMs -le 12000) "thread page first usable content took $($Metrics.firstUsableMs)ms for $ThreadId; expected <= 12000ms"
  }
  Assert-True ([int]$Metrics.earlyRpcRequestCount -le 1) "thread page issued $($Metrics.earlyRpcRequestCount) early RPC requests for $ThreadId; expected cache-first first screen to avoid duplicate RPC within 650ms"
  Assert-True ([int]$Metrics.stateThreadRequestCount -le 1) "thread page loaded $($Metrics.stateThreadRequestCount) state snapshots for $ThreadId; expected short snapshot reuse to avoid duplicate full state reads during initial settle"
  Assert-True ([int]$Metrics.runtimeThreadRequestCount -le 8) "thread page loaded $($Metrics.runtimeThreadRequestCount) runtime snapshots for $ThreadId; expected no more than 8 during initial settle"
  Assert-True ([int]$Metrics.tokenUsageRequestCount -eq 0) "thread page loaded $($Metrics.tokenUsageRequestCount) token usage snapshots for $ThreadId during initial settle; expected non-core token usage reads to wait until after first-screen regression"
  Assert-True ([int]$Metrics.firstScreenProjectRootSuggestionMaxDuplicateCount -le 1) "thread page repeated the same project-root-suggestion request $($Metrics.firstScreenProjectRootSuggestionMaxDuplicateCount) times during first-screen load for $ThreadId"
  Assert-True ([int]$Metrics.firstScreenWorkspaceRootsStateCount -le 1) "thread page loaded workspace-roots-state $($Metrics.firstScreenWorkspaceRootsStateCount) times during first-screen load for $ThreadId"
  Assert-True ([int]$Metrics.firstScreenDesktopAppStatusCount -eq 0) "thread page loaded desktop-app/status during first-screen load for $ThreadId"
  if (-not $AllowAuthoritativeEmptyThread) {
    Assert-True ([int]$Metrics.visibleUserMessageCount -ge 1) "thread page first visible window has no user context for $ThreadId"
    Assert-True ([int]$Metrics.visibleAssistantMessageCount -ge 1) "thread page first visible window has no assistant response for $ThreadId"
  }
  Assert-True ([int]$Metrics.visibleConversationItemCount -le 80) "thread page mounted $($Metrics.visibleConversationItemCount) visible conversation items for $ThreadId; expected long threads to keep first-screen DOM window <= 80"
  Assert-True ([int]$Metrics.messageCardCount -le 90) "thread page mounted $($Metrics.messageCardCount) message cards for $ThreadId; expected compact first-screen render <= 90"
  Assert-True ([int]$Metrics.codeLineCount -le 1200) "thread page mounted $($Metrics.codeLineCount) code lines for $ThreadId; expected folded code preview <= 1200 lines"
  Assert-True ([int]$Metrics.mountedCommandOutputCount -le 4) "thread page mounted $($Metrics.mountedCommandOutputCount) command outputs for $ThreadId; expected command output to stay collapsed/lazy"
  Assert-True ([int]$Metrics.expandedCommandOutputCount -le 1) "thread page expanded $($Metrics.expandedCommandOutputCount) command outputs for $ThreadId; expected at most one visible output on first screen"
  Assert-True ([int]$Metrics.expandedRawPayloadCount -eq 0) "thread page expanded raw payload cards during first-screen load for $ThreadId"
  Assert-True ([int]$Metrics.conversationDomNodeCount -le 5000) "thread page mounted $($Metrics.conversationDomNodeCount) conversation DOM nodes for $ThreadId; expected <= 5000"
  Assert-True ($null -ne $Metrics.endpointTiming.rpc) "thread page metrics are missing rpc endpoint timing breakdown for $ThreadId"
}

function Read-AppServerRecentRpcMetrics {
  param([string]$BaseUrl)

  $health = Test-HttpJson -Name "post-thread health rpc diagnostics" -Url "$($BaseUrl)/codex-api/health"
  $recentRpc = @($health.data.appServer.rpcDiagnostics.recentRpc)
  $threadReads = @($recentRpc | Where-Object { $_.method -eq "thread/read" })
  $heavyThreadReads = @($threadReads | Where-Object { $_.includeTurns -eq $true })
  $lightThreadReads = @($threadReads | Where-Object { $_.includeTurns -ne $true })
  $maxDuration = 0
  foreach ($record in $recentRpc) {
    $maxDuration = [Math]::Max($maxDuration, [int]$record.durationMs)
  }
  return [pscustomobject]@{
    recentRpcCount = $recentRpc.Count
    threadReadCount = $threadReads.Count
    heavyThreadReadCount = $heavyThreadReads.Count
    lightThreadReadCount = $lightThreadReads.Count
    maxDurationMs = $maxDuration
    recentRpc = @($recentRpc | Select-Object -First 8 method, includeTurns, durationMs, outcome)
  }
}

function Read-ThreadMessageCacheMetrics {
  param(
    [string]$Session,
    [string]$ThreadId
  )

  $script = @'
JSON.stringify((() => {
  const threadId = '__THREAD_ID__';
  const raw = window.localStorage.getItem('codex-web-local.thread-message-cache.v1') || '';
  let entry = null;
  try {
    entry = JSON.parse(raw).threads?.[threadId] || null;
  } catch {}
  const messages = Array.isArray(entry?.messages) ? entry.messages : [];
  const maxTextLength = messages.reduce((max, row) => Math.max(max, String(row?.text || '').length), 0);
  const maxCommandOutputLength = messages.reduce((max, row) => Math.max(max, String(row?.commandExecution?.aggregatedOutput || '').length), 0);
  return {
    hasEntry: !!entry,
    messageCount: messages.length,
    entryJsonLength: entry ? JSON.stringify(entry).length : 0,
    maxTextLength,
    maxCommandOutputLength,
  };
})())
'@
  $script = $script.Replace('__THREAD_ID__', $ThreadId.Replace('\', '\\').Replace("'", "\'"))
  return Invoke-BrowserEvalJson -Session $Session -Script $script
}

function Assert-ThreadMessageCacheMetrics {
  param(
    [object]$Metrics,
    [string]$ThreadId,
    [switch]$AllowMissingEmptyEntry
  )

  if (-not ($AllowMissingEmptyEntry -and [int]$Metrics.messageCount -eq 0)) {
    Assert-True ($Metrics.hasEntry -eq $true) "thread message cache has no entry for $ThreadId"
  }
  Assert-True ([int]$Metrics.messageCount -le 24) "thread message cache kept $($Metrics.messageCount) messages for $ThreadId; expected <= 24"
  Assert-True ([int]$Metrics.maxTextLength -le 6100) "thread message cache text is too large for $ThreadId; maxTextLength=$($Metrics.maxTextLength)"
  Assert-True ([int]$Metrics.maxCommandOutputLength -le 3100) "thread message cache command output is too large for $ThreadId; maxCommandOutputLength=$($Metrics.maxCommandOutputLength)"
  Assert-True ([int]$Metrics.entryJsonLength -le 280000) "thread message cache entry is too large for $ThreadId; entryJsonLength=$($Metrics.entryJsonLength)"
}

function Wait-ThreadUsableMetrics {
  param(
    [string]$Session,
    [string]$ThreadId,
    [Diagnostics.Stopwatch]$Stopwatch,
    [int]$TimeoutMs = 12000,
    [switch]$AllowAuthoritativeEmptyThread
  )

  $lastMetrics = $null
  while ($Stopwatch.ElapsedMilliseconds -le $TimeoutMs) {
    $lastMetrics = Read-ThreadPageLoadMetrics -Session $Session -ThreadId $ThreadId
    $hasConversation = [int]$lastMetrics.visibleUserMessageCount -ge 1 -and [int]$lastMetrics.visibleAssistantMessageCount -ge 1
    $hasLoadedEmptyThread = $AllowAuthoritativeEmptyThread `
      -and $lastMetrics.routeMatchesThread -eq $true `
      -and $lastMetrics.composerReady -eq $true `
      -and $lastMetrics.emptyStateVisible -eq $true `
      -and [int]$lastMetrics.loadingIndicatorCount -eq 0 `
      -and [int]$lastMetrics.visibleConversationItemCount -eq 0
    if ($hasConversation -or $hasLoadedEmptyThread) {
      $firstScreenReadyMs = if ($null -ne $lastMetrics.firstScreenReadyMs -and [int]$lastMetrics.firstScreenReadyMs -gt 0) {
        [int]$lastMetrics.firstScreenReadyMs
      } else {
        [int]$Stopwatch.ElapsedMilliseconds
      }
      $lastMetrics | Add-Member -NotePropertyName "firstUsableMs" -NotePropertyValue $firstScreenReadyMs -Force
      $lastMetrics | Add-Member -NotePropertyName "browserObservedUsableMs" -NotePropertyValue ([int]$Stopwatch.ElapsedMilliseconds) -Force
      $lastMetrics | Add-Member -NotePropertyName "authoritativeEmptyThread" -NotePropertyValue $hasLoadedEmptyThread -Force
      return $lastMetrics
    }
    Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "250") | Out-Null
  }

  $lastUserCount = if ($null -ne $lastMetrics) { [int]$lastMetrics.visibleUserMessageCount } else { 0 }
  $lastAssistantCount = if ($null -ne $lastMetrics) { [int]$lastMetrics.visibleAssistantMessageCount } else { 0 }
  throw "thread page did not become usable within ${TimeoutMs}ms for $ThreadId; userCount=$lastUserCount assistantCount=$lastAssistantCount"
}

function Read-ThreadWindowMetrics {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const resources = performance.getEntriesByType('resource')
    .filter((entry) => entry.name.includes('/codex-api/rpc'));
  const list = document.querySelector('.conversation-list');
  const items = Array.from(document.querySelectorAll('.conversation-item[data-role]'));
  const roleCount = (role) => items.filter((node) => node.getAttribute('data-role') === role).length;
  const loadButton = document.querySelector('.conversation-load-more-button');
  const loadText = loadButton?.textContent?.replace(/\s+/g, ' ').trim() || '';
  const remainingMatch = loadText.match(/剩余\s+(\d+)\s+条/);
  const earliestTurnIndexAttribute = list?.getAttribute('data-earliest-turn-index') || '';
  const earliestTurnIndexValue = Number(earliestTurnIndexAttribute);
  return {
    hasLoadMore: !!loadButton,
    loadText,
    hiddenRemaining: remainingMatch ? Number(remainingMatch[1]) : null,
    messageCount: Number(list?.getAttribute('data-message-count') || '0'),
    earliestTurnIndex: earliestTurnIndexAttribute && Number.isFinite(earliestTurnIndexValue) ? earliestTurnIndexValue : null,
    itemCount: items.length,
    userCount: roleCount('user'),
    assistantCount: roleCount('assistant'),
    scrollTop: list?.scrollTop ?? 0,
    scrollHeight: list?.scrollHeight ?? 0,
    clientHeight: list?.clientHeight ?? 0,
    rpcCount: resources.length,
    hasInternalCodexContext: /<codex_internal_context\s+source=/i.test(document.body.innerText),
  };
})())
'@
  return Invoke-BrowserEvalJson -Session $Session -Script $script
}

function Click-ThreadLoadMore {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const button = document.querySelector('.conversation-load-more-button');
  if (!button || button.disabled) return { clicked: false };
  button.click();
  return { clicked: true };
})())
'@
  return Invoke-BrowserEvalJson -Session $Session -Script $script
}

function Assert-ThreadLoadMoreWindow {
  param(
    [string]$Session,
    [string]$ThreadId,
    [int]$Iterations = 2,
    [switch]$AllowUnavailable
  )

  $totalItemDelta = 0
  for ($step = 1; $step -le $Iterations; $step++) {
    $before = Read-ThreadWindowMetrics -Session $Session
    if ($before.hasLoadMore -ne $true) {
      if ($step -eq 1 -and $AllowUnavailable) {
        Write-Step "thread load-more -> skipped for short thread $ThreadId (no older history)"
        return
      }
      Assert-True ($step -gt 1 -and $totalItemDelta -ge 1) "thread page has no load-more affordance before step $step for $ThreadId"
      break
    }
    $clickResult = Click-ThreadLoadMore -Session $Session
    Assert-True ($clickResult.clicked -eq $true) "thread page load-more click did not execute at step $step for $ThreadId"
    $after = $null
    for ($waitAttempt = 0; $waitAttempt -lt 40; $waitAttempt++) {
      Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "250") | Out-Null
      $after = Read-ThreadWindowMetrics -Session $Session
      $itemProgress = [int]$after.itemCount - [int]$before.itemCount
      $remainingProgress = 0
      if ($null -ne $before.hiddenRemaining) {
        $afterHiddenRemaining = if ($null -ne $after.hiddenRemaining) { [int]$after.hiddenRemaining } else { 0 }
        $remainingProgress = [int]$before.hiddenRemaining - $afterHiddenRemaining
      }
      $turnProgress = 0
      if ($null -ne $before.earliestTurnIndex -and $null -ne $after.earliestTurnIndex) {
        $turnProgress = [int]$before.earliestTurnIndex - [int]$after.earliestTurnIndex
      }
      if ([Math]::Max([Math]::Max($itemProgress, $remainingProgress), $turnProgress) -ge 1) {
        break
      }
    }
    Assert-True ($null -ne $after) "thread page load-more produced no readable state at step $step for $ThreadId"

    $itemDelta = [int]$after.itemCount - [int]$before.itemCount
    $remainingDelta = 0
    if ($null -ne $before.hiddenRemaining) {
      $afterHiddenRemaining = if ($null -ne $after.hiddenRemaining) { [int]$after.hiddenRemaining } else { 0 }
      $remainingDelta = [int]$before.hiddenRemaining - $afterHiddenRemaining
    }
    $turnDelta = 0
    if ($null -ne $before.earliestTurnIndex -and $null -ne $after.earliestTurnIndex) {
      $turnDelta = [int]$before.earliestTurnIndex - [int]$after.earliestTurnIndex
    }
    $progressDelta = [Math]::Max([Math]::Max($itemDelta, $remainingDelta), $turnDelta)
    $heightDelta = [int]$after.scrollHeight - [int]$before.scrollHeight
    $scrollDelta = [int]$after.scrollTop - [int]$before.scrollTop
    $anchorDrift = [Math]::Abs($scrollDelta - $heightDelta)
    $totalItemDelta += $progressDelta

    Assert-True ($after.hasInternalCodexContext -ne $true) "thread page exposed internal codex context after load-more step $step for $ThreadId"
    Assert-True ([int]$after.userCount -ge 1) "thread page has no user context after load-more step $step for $ThreadId"
    Assert-True ([int]$after.assistantCount -ge 1) "thread page has no assistant response after load-more step $step for $ThreadId"
    Assert-True ($progressDelta -ge 1) "thread page load-more step $step did not advance visible history for $ThreadId; beforeItems=$($before.itemCount), afterItems=$($after.itemCount), beforeTurn=$($before.earliestTurnIndex), afterTurn=$($after.earliestTurnIndex), beforeRpc=$($before.rpcCount), afterRpc=$($after.rpcCount), beforeLoad='$($before.loadText)', afterLoad='$($after.loadText)'"
    Assert-True ($progressDelta -le 16) "thread page load-more step $step advanced too much history for $ThreadId; delta=$progressDelta"
    Assert-True ($anchorDrift -le 180) "thread page load-more step $step shifted reading anchor too much for $ThreadId; drift=$anchorDrift"
  }
  Assert-True ($totalItemDelta -ge 1) "thread page load-more did not reveal any older history for $ThreadId"
  Assert-True ($totalItemDelta -le ($Iterations * 16)) "thread page repeated load-more revealed too many items for $ThreadId; totalDelta=$totalItemDelta"
}

function Add-RegressionResult {
  param(
    [string]$Name,
    [object]$Page
  )

  $screenshotPath = $null
  if ($script:captureScreenshots -and -not [string]::IsNullOrWhiteSpace($script:activeSession)) {
    $screenshotPath = Save-RegressionScreenshot -Session $script:activeSession -Name $Name
  }

  $script:results += [PSCustomObject]@{
    name = $Name
    url = [string]$Page.url
    overflow = [bool]$Page.hasHorizontalOverflow
    screenshot = $screenshotPath
  }
}

if (-not (Get-Command agent-browser -ErrorAction SilentlyContinue)) {
  throw "agent-browser is not available in PATH"
}

$BaseUrl = $BaseUrl.TrimEnd("/")
$session = "cx-codex-frontend-regression"
$script:activeSession = $session
$script:captureScreenshots = [bool]$CaptureScreenshots
$script:screenshotOutputDir = Initialize-ScreenshotOutputDir
$results = @()

try {
  Assert-ImmediateAsyncRouteFallbackSource
  Assert-CompleteThreadExportSource
  Assert-CompleteThreadCopySource
Assert-NestedMobileBackOwnershipSource
Assert-MobileDrawerEnvironmentOwnershipSource
Assert-MobileThreadActionDiscoverySource
Assert-ConciseThreadOpenLabelsSource
Assert-IndependentProjectControlsSource
Assert-BulkProjectCollapseSource
Assert-SimpleRecentSidebarSource
Assert-ExplicitSidebarSearchStatesSource
Assert-ActiveThreadSidebarRevealSource
Assert-MessageActionHitTestingSource
Assert-StableHandsetViewportSource
Assert-ReversibleThreadArchiveSource
Assert-ForegroundResumeScrollIntentSource
Assert-ThreadAttentionChromeSource
  Assert-AndroidResumeThreadListRecoverySource
  Assert-CrossClientThreadStartedRefreshSource
  Assert-PendingStartOutboxRecoverySource
  Assert-RuntimeSnapshotOrderingSource
  Assert-ManualUnreadAndComposerAttachmentSource
  Assert-CurrentReasoningEffortCoverageSource
  Assert-CollisionAwareThreadMenuSource
  Assert-CollisionAwareProjectMenuSource
  Assert-SidebarProjectScrollAnchorSource
  Assert-HiddenPageQuiescenceSource
  Assert-ReliableClipboardSource
  Assert-TaskAttentionAndFileQuickOpenSource
  Assert-MobileLatestReplyRecoverySource
  Assert-BoundedRuntimeSendRecoverySource

  $health = Test-HttpJson -Name "health" -Url "$($BaseUrl)/health"
  Assert-True ($health.status -eq "ok") "health status is not ok"

  $codexHealth = Wait-CodexHealthIdle -Url "$($BaseUrl)/codex-api/health"
  Assert-CodexHealthReadyForFrontendRegression -Health $codexHealth

  $diagnostics = Test-HttpJson -Name "diagnostics api" -Url "$($BaseUrl)/codex-api/diagnostics"
  Assert-True ($diagnostics.status -eq "ok") "diagnostics status is not ok"
  Assert-True ($null -ne $diagnostics.data.runtimeStore) "diagnostics is missing runtimeStore"
  $workspaceRootsState = Test-HttpJson -Name "workspace roots state" -Url "$($BaseUrl)/codex-api/workspace-roots-state"
  $requiredSidebarThread = Resolve-RequiredSidebarThread -BaseUrl $BaseUrl -Title $RequireThreadTitle

  $homePage = Open-And-ReadPage -Session $session -Url "$($BaseUrl)/#/" -Width $DesktopWidth -Height $DesktopHeight
  Reset-AppShellLayoutPreferences -Session $session
  $homeWorkspaceNavigationStartedAtMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $homePage = Open-And-ReadPage -Session $session -Url "$($BaseUrl)/#/" -Width $DesktopWidth -Height $DesktopHeight
  Assert-Page -Page $homePage -Name "home desktop" -RequireComposer
  $homeWorkspaceProjectMetrics = Wait-HomeWorkspaceProjectMetrics `
    -Session $session `
    -RootsState $workspaceRootsState `
    -NavigationStartedAtMs $homeWorkspaceNavigationStartedAtMs
  Assert-WorkspaceRootProjectParity -RootsState $workspaceRootsState -Metrics $homeWorkspaceProjectMetrics
  Assert-RequiredSidebarThreadDom `
    -Thread $requiredSidebarThread `
    -Metrics (Read-RequiredSidebarThreadMetrics -Session $session -Thread $requiredSidebarThread) `
    -Context "home desktop"
  Add-RegressionResult -Name "home-desktop" -Page $homePage
  Invoke-AgentBrowser -Arguments @("--session", $session, "click", ".sidebar-settings-button[aria-expanded]") | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $session, "wait", "200") | Out-Null
  Assert-SettingsPanel -Metrics (Read-SettingsPanelMetrics -Session $session)
  Close-SettingsPanelIfOpen -Session $session
  Reset-AppShellLayoutPreferences -Session $session

  $homeFoldable = Open-And-ReadPage -Session $session -Url "$($BaseUrl)/#/" -Width $FoldableWidth -Height $FoldableHeight
  Assert-Page -Page $homeFoldable -Name "home foldable" -RequireComposer
  Assert-FoldableShell -Metrics (Read-FoldableShellMetrics -Session $session)
  Add-RegressionResult -Name "home-foldable" -Page $homeFoldable

  Set-SidebarCollapsedPreference -Session $session -Collapsed $false
  $homePhone = Open-And-ReadPage -Session $session -Url "$($BaseUrl)/#/" -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $homePhone -Name "home phone" -RequireComposer
  Assert-MobileDrawerSidebar -Metrics (Open-MobileDrawerSidebar -Session $session)
  Assert-RequiredSidebarThreadDom `
    -Thread $requiredSidebarThread `
    -Metrics (Read-RequiredSidebarThreadMetrics -Session $session -Thread $requiredSidebarThread -RootSelector ".mobile-drawer") `
    -Context "home mobile drawer"
  Assert-MobileDrawerEnvironmentOwnership -Session $session
  Assert-MobileSettingsEnvironmentOwnership -Session $session
  Assert-MobileDrawerProjectBulkCollapse -Session $session
  Add-RegressionResult -Name "home-mobile-drawer" -Page $homePhone
  Assert-MobileBackDismissesSidebarDialog -Session $session
  Assert-MobileDrawerThreadNavigationStability -Session $session
  Assert-MobileBackDismissesComposerSurface -Session $session
  Assert-MobileBackDismissesFavoritesModal -Session $session

  $blockingDialogFixtureUrl = $BaseUrl + "/#/?regression=frontend&blockingDialogs=1"
  $blockingDialogFixture = Open-And-ReadPage -Session $session -Url $blockingDialogFixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $blockingDialogFixture -Name "blocking dialog fixture phone" -RequireComposer
  Assert-BlockingDialogEnvironment -Session $session
  Assert-ArchiveUndoToast -Session $session

  Set-SidebarCollapsedPreference -Session $session -Collapsed $false
  $homePhoneLandscape = Open-And-ReadPage -Session $session -Url "$($BaseUrl)/#/" -Width $PhoneLandscapeWidth -Height $PhoneLandscapeHeight
  Assert-Page -Page $homePhoneLandscape -Name "home phone landscape" -RequireComposer
  Assert-MobileDrawerSidebar -Metrics (Open-MobileDrawerSidebar -Session $session)
  Add-RegressionResult -Name "home-mobile-drawer-landscape" -Page $homePhoneLandscape
  Assert-MobileDrawerThreadNavigationStability -Session $session

  if ($MeasureNewThreadFeedback) {
    $newThreadFeedbackPage = Open-And-ReadPage -Session $session -Url "$($BaseUrl)/#/" -Width $PhoneWidth -Height $PhoneHeight
    Assert-Page -Page $newThreadFeedbackPage -Name "new thread feedback phone" -RequireComposer
    Measure-NewThreadSendFeedbackBudget -Session $session
    Measure-NewThreadAuthoritativeHandoff -Session $session -BaseUrl $BaseUrl
  }

  Seed-PersistentOutboxDraftRecoveryProbe -Session $session
  $outboxRecoveryPage = Open-And-ReadPage -Session $session -Url "$($BaseUrl)/#/" -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $outboxRecoveryPage -Name "persistent outbox recovery phone" -RequireComposer
  Assert-PersistentOutboxDraftRecovery -Session $session
  Add-RegressionResult -Name "persistent-outbox-recovery-phone" -Page $outboxRecoveryPage
  Clear-PersistentOutboxDraftRecoveryProbe -Session $session
  Dispatch-MobileResumeOutboxRecoveryProbe -Session $session
  Assert-MobileResumeOutboxRecovery -Session $session
  Clear-PersistentOutboxDraftRecoveryProbe -Session $session

  $skills = Open-And-ReadPage -Session $session -Url "$($BaseUrl)/skills?regression=frontend" -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $skills -Name "skills phone" -RequireSkillsHub
  Assert-MobileBackDismissesSkillDetail -Session $session
  Add-RegressionResult -Name "skills-phone" -Page $skills

  $skillDetailFixtureUrl = $BaseUrl + "/#/__regression/docs-showcase?regression=frontend&view=skill-detail"
  $skillDetailFixture = Open-And-ReadPage -Session $session -Url $skillDetailFixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $skillDetailFixture -Name "skill detail recovery fixture phone"
  Assert-SkillDetailReadmeRecovery -Session $session
  Add-RegressionResult -Name "skill-detail-recovery-fixture-phone" -Page $skillDetailFixture

  $trending = Open-And-ReadPage -Session $session -Url "$($BaseUrl)/github-trending?regression=frontend" -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $trending -Name "github trending phone" -RequireTrendingHub
  Add-RegressionResult -Name "github-trending-phone" -Page $trending

  $trendingFixtureUrl = $BaseUrl + "/#/__regression/docs-showcase?regression=frontend&view=github"
  $trendingFixture = Open-And-ReadPage -Session $session -Url $trendingFixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $trendingFixture -Name "github trending compact fixture phone" -RequireTrendingHub
  Assert-GithubTrendingCompactLayout -Session $session
  Add-RegressionResult -Name "github-trending-compact-fixture-phone" -Page $trendingFixture

  $diagnosticsPage = Open-And-ReadPage -Session $session -Url "$($BaseUrl)/diagnostics?regression=frontend" -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $diagnosticsPage -Name "diagnostics phone" -RequiredText "Runtime Store" -RequireDiagnostics
  Add-RegressionResult -Name "diagnostics-phone" -Page $diagnosticsPage

  $repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
  $readmePath = (Join-Path $repoRoot "README.md").Replace('\', '/')
  $encodedReadmePath = [System.Uri]::EscapeDataString($readmePath)
  $previewUrl = $BaseUrl + "/local-preview.html?path=" + $encodedReadmePath + '&regression=frontend'
  $preview = Open-And-ReadPage -Session $session -Url $previewUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $preview -Name "local preview phone" -RequireMarkdown
  Add-RegressionResult -Name "local-preview-phone" -Page $preview

  $sidebarFixtureUrl = $BaseUrl + "/#/__regression/sidebar-rows?regression=frontend"
  $sidebarFixture = Open-And-ReadPage -Session $session -Url $sidebarFixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $sidebarFixture -Name "sidebar rows fixture phone"
  Assert-SidebarFixture -Metrics (Read-SidebarFixtureMetrics -Session $session)
  Assert-SidebarFixtureNewThreadMenu -Session $session
  Assert-SidebarFixtureThreadMenuCollisionHandling -Session $session
  Add-RegressionResult -Name "sidebar-rows-fixture-phone" -Page $sidebarFixture

  $sidebarStaleSearchFixtureUrl = $BaseUrl + "/#/__regression/sidebar-rows?regression=frontend&staleSearch=1"
  $sidebarStaleSearchFixture = Open-And-ReadPage -Session $session -Url $sidebarStaleSearchFixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $sidebarStaleSearchFixture -Name "sidebar stale-search fixture phone"
  Assert-SidebarFixtureStaleSearchMerge -Session $session
  Add-RegressionResult -Name "sidebar-stale-search-fixture-phone" -Page $sidebarStaleSearchFixture

  $sidebarSearchContinuityFixtureUrl = $BaseUrl + "/#/__regression/sidebar-rows?regression=frontend&searchContinuity=1"
  $sidebarSearchContinuityFixture = Open-And-ReadPage -Session $session -Url $sidebarSearchContinuityFixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $sidebarSearchContinuityFixture -Name "sidebar search-continuity fixture phone"
  Assert-SidebarFixtureSearchContinuity -Session $session
  Add-RegressionResult -Name "sidebar-search-continuity-fixture-phone" -Page $sidebarSearchContinuityFixture

  $sidebarScrollAnchorFixtureUrl = $BaseUrl + "/#/__regression/sidebar-rows?regression=frontend&scrollAnchor=1"
  $sidebarScrollAnchorFixture = Open-And-ReadPage -Session $session -Url $sidebarScrollAnchorFixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $sidebarScrollAnchorFixture -Name "sidebar scroll-anchor fixture phone"
  Assert-SidebarFixtureProjectScrollAnchor -Session $session
  Add-RegressionResult -Name "sidebar-scroll-anchor-fixture-phone" -Page $sidebarScrollAnchorFixture

  $sidebarCurrentRevealFixtureUrl = $BaseUrl + "/#/__regression/sidebar-rows?regression=frontend&revealCurrent=1"
  $sidebarCurrentRevealFixture = Open-And-ReadPage -Session $session -Url $sidebarCurrentRevealFixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $sidebarCurrentRevealFixture -Name "sidebar current-thread reveal fixture phone"
  Assert-SidebarFixtureCurrentThreadReveal -Session $session
  Add-RegressionResult -Name "sidebar-current-thread-reveal-fixture-phone" -Page $sidebarCurrentRevealFixture

  $commandMenuFocusFixtureUrl = $BaseUrl + "/#/__regression/command-menu?regression=frontend&focusOwnership=1"
  $commandMenuFocusFixture = Open-And-ReadPage -Session $session -Url $commandMenuFocusFixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $commandMenuFocusFixture -Name "command-menu focus-ownership fixture phone"
  Assert-CommandMenuModalFocusOwnership -Session $session
  Save-RegressionScreenshot -Session $session -Name 'command-menu-focus-ownership-phone' | Out-Null
  Add-RegressionResult -Name "command-menu-focus-ownership-fixture-phone" -Page $commandMenuFocusFixture

  $commandMenuTypeAheadFixtureUrl = $BaseUrl + "/#/__regression/command-menu?regression=frontend&typeAhead=1"
  $commandMenuTypeAheadFixture = Open-And-ReadPage -Session $session -Url $commandMenuTypeAheadFixtureUrl -Width $DesktopWidth -Height $DesktopHeight
  Assert-Page -Page $commandMenuTypeAheadFixture -Name "command-menu type-ahead fixture desktop"
  Assert-CommandMenuTypeAheadContinuity -Session $session
  Add-RegressionResult -Name "command-menu-type-ahead-fixture-desktop" -Page $commandMenuTypeAheadFixture

  $composerFixtureUrl = $BaseUrl + "/#/__regression/composer-shell?regression=frontend"
  $composerFixture = Open-And-ReadPage -Session $session -Url $composerFixtureUrl -Width $DesktopWidth -Height $DesktopHeight
  Assert-Page -Page $composerFixture -Name "composer shell fixture desktop" -RequireComposer
  Assert-ComposerFixture -Metrics (Read-ComposerFixtureMetrics -Session $session) -ViewportName "desktop"
  Assert-ComposerAutoGrow -Session $session -ViewportName "desktop"
  Assert-ComposerSheetEnvironmentOwnership -Session $session -ExpectModal $false -ViewportName "desktop"
  Assert-ComposerImeMentionSafety -Session $session
  Invoke-ComposerDictationProbe -Session $session
  Assert-ComposerDictationDraft -Metrics (Read-ComposerDictationMetrics -Session $session) -ViewportName "desktop"
  Assert-ComposerEnterDefault -Session $session -ExpectEnterSubmit $true -ViewportName "desktop"
  Add-RegressionResult -Name "composer-shell-fixture-desktop" -Page $composerFixture

  $composerFixturePhone = Open-And-ReadPage -Session $session -Url $composerFixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $composerFixturePhone -Name "composer shell fixture phone" -RequireComposer
  Assert-ComposerFixture -Metrics (Read-ComposerFixtureMetrics -Session $session) -ViewportName "phone"
  Assert-ComposerAutoGrow -Session $session -ViewportName "phone"
  Assert-ComposerSheetEnvironmentOwnership -Session $session -ExpectModal $true -ViewportName "phone"
  Invoke-ComposerDictationProbe -Session $session
  Assert-ComposerDictationDraft -Metrics (Read-ComposerDictationMetrics -Session $session) -ViewportName "phone"
  Assert-ComposerEnterDefault -Session $session -ExpectEnterSubmit $false -ViewportName "phone"
  Add-RegressionResult -Name "composer-shell-fixture-phone" -Page $composerFixturePhone

  $composerFixtureFoldable = Open-And-ReadPage -Session $session -Url $composerFixtureUrl -Width $FoldableWidth -Height $FoldableHeight
  Assert-Page -Page $composerFixtureFoldable -Name "composer shell fixture foldable" -RequireComposer
  Assert-ComposerFixture -Metrics (Read-ComposerFixtureMetrics -Session $session) -ViewportName "foldable"
  Invoke-ComposerDictationProbe -Session $session
  Assert-ComposerDictationDraft -Metrics (Read-ComposerDictationMetrics -Session $session) -ViewportName "foldable"
  Add-RegressionResult -Name "composer-shell-fixture-foldable" -Page $composerFixtureFoldable

  $fixtureUrl = $BaseUrl + "/#/__regression/conversation-blocks?regression=frontend"
  $fixture = Open-And-ReadPage -Session $session -Url $fixtureUrl -Width $DesktopWidth -Height $DesktopHeight
  Assert-Page -Page $fixture -Name "conversation blocks fixture desktop"
  Reveal-ConversationFixtureLocalHistory -Session $session
  Assert-ConversationRawPayloadLazy -Session $session
  Expand-ConversationFixturePendingRequests -Session $session
  Assert-ConversationCommandOutputLazy -Session $session
  Assert-ConversationFixture -Metrics (Read-ConversationFixtureMetrics -Session $session) -ViewportName "desktop"
  Assert-ConversationOlderHistoryAffordance -Session $session
  Assert-ConversationViewportControls -Session $session
  Assert-ConversationFixtureCopyInteraction -Session $session
  Add-RegressionResult -Name "conversation-blocks-fixture" -Page $fixture

  $fixturePhone = Open-And-ReadPage -Session $session -Url $fixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $fixturePhone -Name "conversation blocks fixture phone"
  Reveal-ConversationFixtureLocalHistory -Session $session
  Assert-ConversationRawPayloadLazy -Session $session
  Expand-ConversationFixturePendingRequests -Session $session
  Assert-ConversationCommandOutputLazy -Session $session
  Assert-ConversationFixture -Metrics (Read-ConversationFixtureMetrics -Session $session) -ViewportName "phone"
  Add-RegressionResult -Name "conversation-blocks-fixture-phone" -Page $fixturePhone

  $streamingStressFixtureUrl = $BaseUrl + "/#/__regression/conversation-blocks?regression=frontend&streamStress=1"
  $streamingStressFixture = Open-And-ReadPage -Session $session -Url $streamingStressFixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $streamingStressFixture -Name "conversation streaming stress fixture phone"
  Assert-ConversationStreamingResponsiveness -Session $session
  Add-RegressionResult -Name "conversation-streaming-stress-phone" -Page $streamingStressFixture

  $imagePreviewFixtureUrl = $BaseUrl + "/#/__regression/conversation-blocks?regression=frontend&imagePreview=1"
  $imagePreviewFixture = Open-And-ReadPage -Session $session -Url $imagePreviewFixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $imagePreviewFixture -Name "conversation image preview gestures fixture phone"
  Assert-ConversationImagePreviewGestures -Session $session
  Add-RegressionResult -Name "conversation-image-preview-gestures-phone" -Page $imagePreviewFixture

  $markdownImageFixtureUrl = $BaseUrl + "/#/__regression/conversation-blocks?regression=frontend&markdownImage=1"
  $markdownImageFixture = Open-And-ReadPage -Session $session -Url $markdownImageFixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $markdownImageFixture -Name "conversation markdown-image recovery fixture phone"
  Assert-ConversationMarkdownImageRecovery -Session $session
  Add-RegressionResult -Name "conversation-markdown-image-recovery-phone" -Page $markdownImageFixture

  $scrollSwitchFixtureUrl = $BaseUrl + "/#/__regression/conversation-blocks?regression=frontend&scrollSwitchRace=1&messageActionHit=1"
  $scrollSwitchFixture = Open-And-ReadPage -Session $session -Url $scrollSwitchFixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $scrollSwitchFixture -Name "conversation thread-switch scroll fixture phone"
  Assert-ConversationMessageActionHitTesting -Session $session
  Assert-ConversationMessageReadingAnchor -Session $session
  Assert-ConversationThreadSwitchScrollIsolation -Session $session
  Add-RegressionResult -Name "conversation-thread-switch-scroll-fixture-phone" -Page $scrollSwitchFixture

  $foregroundResumeScrollFixtureUrl = $BaseUrl + "/#/__regression/conversation-blocks?regression=frontend&scrollSwitchRace=1&foregroundResumeScroll=1"
  $foregroundResumeBottomFixture = Open-And-ReadPage -Session $session -Url $foregroundResumeScrollFixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $foregroundResumeBottomFixture -Name "conversation foreground resume bottom fixture phone"
  Assert-ConversationForegroundResumeScrollIntent -Session $session -Mode 'bottom'
  Add-RegressionResult -Name "conversation-foreground-resume-bottom-phone" -Page $foregroundResumeBottomFixture

  $foregroundResumeReadingFixture = Open-And-ReadPage -Session $session -Url $foregroundResumeScrollFixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $foregroundResumeReadingFixture -Name "conversation foreground resume reading fixture phone"
  Assert-ConversationForegroundResumeScrollIntent -Session $session -Mode 'reading'
  Add-RegressionResult -Name "conversation-foreground-resume-reading-phone" -Page $foregroundResumeReadingFixture

  $foregroundResumeUserFixture = Open-And-ReadPage -Session $session -Url $foregroundResumeScrollFixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $foregroundResumeUserFixture -Name "conversation foreground resume user-intent fixture phone"
  Assert-ConversationForegroundResumeScrollIntent -Session $session -Mode 'user'
  Add-RegressionResult -Name "conversation-foreground-resume-user-intent-phone" -Page $foregroundResumeUserFixture

  $loadFailureFixtureUrl = $BaseUrl + "/#/__regression/conversation-blocks?regression=frontend&loadFailure=1"
  $loadFailureFixture = Open-And-ReadPage -Session $session -Url $loadFailureFixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $loadFailureFixture -Name "conversation load failure fixture phone"
  Assert-ConversationLoadFailureFixture -Session $session
  Add-RegressionResult -Name "conversation-load-failure-fixture-phone" -Page $loadFailureFixture

  $tailStatusFixtureUrl = $BaseUrl + "/#/__regression/conversation-blocks?regression=frontend&tailStatus=1&tailGap=1"
  $tailStatusFixture = Open-And-ReadPage -Session $session -Url $tailStatusFixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $tailStatusFixture -Name "conversation tail status fixture phone"
  Assert-ConversationTailStatusFixture -Session $session
  Add-RegressionResult -Name "conversation-tail-status-fixture-phone" -Page $tailStatusFixture

  $nextActivityFixtureUrl = $BaseUrl + "/#/__regression/conversation-blocks?regression=frontend&tailStatus=1&tailNextActivity=1"
  $nextActivityFixture = Open-And-ReadPage -Session $session -Url $nextActivityFixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $nextActivityFixture -Name "conversation new activity timer fixture phone"
  Assert-ConversationNewActivityTimerFixture -Session $session
  Add-RegressionResult -Name "conversation-new-activity-timer-fixture-phone" -Page $nextActivityFixture

  $resumeRecoveryFixtureUrl = $BaseUrl + "/#/__regression/conversation-blocks?regression=frontend&tailStatus=1&resumeRecovery=1"
  $resumeRecoveryFixture = Open-And-ReadPage -Session $session -Url $resumeRecoveryFixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $resumeRecoveryFixture -Name "conversation resume recovery fixture phone"
  Assert-ConversationResumeRecoveryFixture -Session $session
  Add-RegressionResult -Name "conversation-resume-recovery-fixture-phone" -Page $resumeRecoveryFixture

  $fixtureFoldable = Open-And-ReadPage -Session $session -Url $fixtureUrl -Width $FoldableWidth -Height $FoldableHeight
  Assert-Page -Page $fixtureFoldable -Name "conversation blocks fixture foldable"
  Reveal-ConversationFixtureLocalHistory -Session $session
  Assert-ConversationRawPayloadLazy -Session $session
  Expand-ConversationFixturePendingRequests -Session $session
  Assert-ConversationCommandOutputLazy -Session $session
  Assert-ConversationFixture -Metrics (Read-ConversationFixtureMetrics -Session $session) -ViewportName "foldable"
  Add-RegressionResult -Name "conversation-blocks-fixture-foldable" -Page $fixtureFoldable

  $notificationRecoveryFixtureUrl = $BaseUrl + "/#/__regression/task-pet?regression=frontend&channelBlocked=1"
  $notificationRecoveryFixture = Open-And-ReadPage -Session $session -Url $notificationRecoveryFixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $notificationRecoveryFixture -Name "completion notification recovery fixture phone"
  Assert-True ($notificationRecoveryFixture.hasCompletionNotificationRecovery -eq $true) "completion notification recovery fixture phone is missing the blocked-channel state or recovery action"
  Add-RegressionResult -Name "completion-notification-recovery-phone" -Page $notificationRecoveryFixture

  $taskPetWakeFixtureUrl = $BaseUrl + "/#/__regression/task-pet?regression=frontend"
  $taskPetWakeFixture = Open-And-ReadPage -Session $session -Url $taskPetWakeFixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $taskPetWakeFixture -Name "task-pet idle wake fixture phone"
  Invoke-AgentBrowser -Arguments @("--session", $session, "click", '[data-testid="toggle-task-state"]') | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $session, "wait", "100") | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $session, "click", '[data-testid="toggle-task-state"]') | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $session, "wait", "100") | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $session, "click", '[data-testid="simulate-latest-reply"]') | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $session, "wait", "200") | Out-Null
  $taskPetWakeMetrics = Invoke-BrowserEvalJson -Session $session -Script @'
JSON.stringify((() => {
  const root = document.querySelector('[aria-label="任务宠物预览"]');
  const badge = root?.querySelector('.task-pet-preview-badge');
  return {
    minimized: Boolean(root?.querySelector('[aria-label="恢复任务宠物"]')),
    compactCount: root?.querySelectorAll('.task-pet-preview-compact').length || 0,
    compactText: root?.querySelector('.task-pet-preview-compact')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    attentionCount: Number(badge?.textContent?.trim() || 0)
  };
})())
'@
  Assert-True ($taskPetWakeMetrics.minimized -eq $false) "a task arriving after idle must restore the task pet instead of leaving it minimized"
  Assert-True ([int]$taskPetWakeMetrics.compactCount -eq 1) "a new assistant reply after idle must show exactly one transient reply preview"
  Assert-True ([string]$taskPetWakeMetrics.compactText -match '浮窗已实时同步最新回复') "the reply preview after idle did not show the new assistant reply"
  Assert-True ([int]$taskPetWakeMetrics.attentionCount -eq 2) "one waiting task plus one unread running reply must show attention count 2"
  Invoke-AgentBrowser -Arguments @("--session", $session, "click", ".task-pet-preview-mascot") | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $session, "click", '[data-testid="toggle-task-state"]') | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $session, "wait", "8250") | Out-Null
  $taskPetIdleCollapseMetrics = Invoke-BrowserEvalJson -Session $session -Script @'
JSON.stringify({
  expanded: Boolean(document.querySelector('.task-pet-preview-panel')),
  minimized: Boolean(document.querySelector('[aria-label="恢复任务宠物"]'))
})
'@
  Assert-True ($taskPetIdleCollapseMetrics.expanded -eq $false) "an empty task stack must auto-collapse after its visibility timeout"
  Assert-True ($taskPetIdleCollapseMetrics.minimized -eq $true) "an empty task stack must return to the minimized pet after auto-collapse"
  Invoke-AgentBrowser -Arguments @("--session", $session, "click", '[data-testid="toggle-task-state"]') | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $session, "click", ".task-pet-preview-mascot") | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $session, "click", '[aria-label="关闭浮窗"]') | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $session, "wait", "8250") | Out-Null
  $taskPetCloseConfirmationMetrics = Invoke-BrowserEvalJson -Session $session -Script @'
JSON.stringify({
  dialog: Boolean(document.querySelector('[aria-label="确认关闭浮窗"]')),
  expanded: Boolean(document.querySelector('.task-pet-preview-panel'))
})
'@
  Assert-True ($taskPetCloseConfirmationMetrics.dialog -eq $true) "task-pet close confirmation must pause auto-collapse while awaiting a decision"
  Assert-True ($taskPetCloseConfirmationMetrics.expanded -eq $true) "task-pet close confirmation must keep its panel expanded"
  Invoke-AgentBrowser -Arguments @("--session", $session, "click", '.task-pet-preview-close-confirm button:not([data-tone="danger"])') | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $session, "wait", "100") | Out-Null
  Add-RegressionResult -Name "task-pet-idle-wake-phone" -Page $taskPetWakeFixture

  $latestReplyFixtureUrl = $BaseUrl + "/#/__regression/task-pet?regression=frontend&latestReplyBurst=1"
  $latestReplyFixture = Open-And-ReadPage -Session $session -Url $latestReplyFixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $latestReplyFixture -Name "latest reply promoted fixture phone"
  $latestReplyDockedMetrics = Invoke-BrowserEvalJson -Session $session -Script @'
JSON.stringify({
  visibleRowCount: document.querySelectorAll('.task-pet-preview-row').length,
  compactCount: document.querySelectorAll('.task-pet-preview-compact').length
})
'@
  Assert-True ([int]$latestReplyDockedMetrics.visibleRowCount -eq 0) "task pet must start quietly docked until the user expands it"
  Assert-True ([int]$latestReplyDockedMetrics.compactCount -eq 0) "quietly docked task pet must not expose a stale reply preview"
  $expandLatestReplyPreview = Invoke-BrowserEvalJson -Session $session -Script @'
JSON.stringify((() => {
  const mascot = document.querySelector('.task-pet-preview-mascot');
  mascot?.click();
  return { expanded: Boolean(mascot) };
})())
'@
  Assert-True ($expandLatestReplyPreview.expanded -eq $true) "task-pet latest-reply fixture could not expand its task stack"
  Invoke-AgentBrowser -Arguments @("--session", $session, "wait", "250") | Out-Null
  $latestReplyFixtureMetrics = Invoke-BrowserEvalJson -Session $session -Script @'
JSON.stringify((() => {
  const rows = Array.from(document.querySelectorAll('.task-pet-preview-row'));
  return {
    visibleRowCount: rows.length,
    firstRowText: rows[0]?.textContent?.replace(/\s+/g, ' ').trim() || '',
    allRowsText: rows.map((row) => row.textContent || '').join(' '),
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth
  };
})())
'@
  Assert-True ([int]$latestReplyFixtureMetrics.visibleRowCount -eq 3) "task-pet latest-reply fixture must keep exactly three visible rows"
  Assert-True ([string]$latestReplyFixtureMetrics.firstRowText -match '最新回复已提升到浮窗可见首行') "the newest reply task is not the first visible overlay row"
  Assert-True ([string]$latestReplyFixtureMetrics.allRowsText -notmatch '这条较早回复应留在前三条之外') "the fourth older task leaked into the visible overlay rows"
  Assert-True ([int]$latestReplyFixtureMetrics.documentWidth -eq [int]$latestReplyFixtureMetrics.viewportWidth) "latest-reply task-pet fixture has horizontal overflow"
  $collapseLatestReplyPreview = Invoke-BrowserEvalJson -Session $session -Script @'
JSON.stringify((() => {
  const mascot = document.querySelector('.task-pet-preview-mascot');
  mascot?.click();
  return { collapsed: Boolean(mascot) };
})())
'@
  Assert-True ($collapseLatestReplyPreview.collapsed -eq $true) "task-pet latest-reply fixture could not collapse into the compact preview"
  Invoke-AgentBrowser -Arguments @("--session", $session, "wait", "250") | Out-Null
  $compactLatestReplyBefore = Invoke-BrowserEvalJson -Session $session -Script @'
JSON.stringify((() => {
  const compact = document.querySelector('.task-pet-preview-compact');
  return {
    compactCount: document.querySelectorAll('.task-pet-preview-compact').length,
    text: compact?.textContent?.replace(/\s+/g, ' ').trim() || '',
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth
  };
})())
'@
  Assert-True ([int]$compactLatestReplyBefore.compactCount -eq 0) "collapsed task pet must remain quiet until a new reply arrives"
  Assert-True ([int]$compactLatestReplyBefore.documentWidth -eq [int]$compactLatestReplyBefore.viewportWidth) "collapsed latest-reply preview has horizontal overflow"
  Invoke-AgentBrowser -Arguments @("--session", $session, "click", '[data-testid="simulate-latest-reply"]') | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $session, "wait", "200") | Out-Null
  $compactLatestReplyAfter = Invoke-BrowserEvalJson -Session $session -Script @'
JSON.stringify((() => {
  const compact = document.querySelector('.task-pet-preview-compact');
  return {
    compactCount: document.querySelectorAll('.task-pet-preview-compact').length,
    text: compact?.textContent?.replace(/\s+/g, ' ').trim() || ''
  };
})())
'@
  Assert-True ([int]$compactLatestReplyAfter.compactCount -eq 1) "task-pet fixture lost its compact preview after a simulated realtime reply"
  Assert-True ([string]$compactLatestReplyAfter.text -match '浮窗已实时同步最新回复') "compact task pet did not update its visible reply in realtime"
  Invoke-AgentBrowser -Arguments @("--session", $session, "click", ".task-pet-preview-compact") | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $session, "wait", "100") | Out-Null
  $compactLatestReplyAction = Invoke-BrowserEvalJson -Session $session -Script @'
JSON.stringify({
  action: document.querySelector('[data-testid="task-pet-action"]')?.textContent || ''
})
'@
  Assert-True ([string]$compactLatestReplyAction.action -match '打开会话：fixture-latest-reply') "compact latest-reply click did not preserve the exact conversation id"
  Add-RegressionResult -Name "latest-reply-promoted-phone" -Page $latestReplyFixture

  if (-not [string]::IsNullOrWhiteSpace($ThreadId)) {
    $threadLoadStopwatch = [Diagnostics.Stopwatch]::StartNew()
    $thread = Open-And-ReadPage -Session $session -Url "$($BaseUrl)/#/thread/$ThreadId" -Width $PhoneWidth -Height $PhoneHeight
    Assert-Page -Page $thread -Name "thread phone" -RequireComposer
    $threadUsableMetrics = Wait-ThreadUsableMetrics -Session $session -ThreadId $ThreadId -Stopwatch $threadLoadStopwatch -AllowAuthoritativeEmptyThread:$MeasureResponseFeedback
    $remainingSettleMs = [Math]::Max(0, 9000 - [int]$threadLoadStopwatch.ElapsedMilliseconds)
    if ($remainingSettleMs -gt 0) {
      Invoke-AgentBrowser -Arguments @("--session", $session, "wait", ([string]$remainingSettleMs)) | Out-Null
    }
    $threadPageLoadMetrics = Read-ThreadPageLoadMetrics -Session $session -ThreadId $ThreadId
    $threadPageLoadMetrics | Add-Member -NotePropertyName "firstUsableMs" -NotePropertyValue ([int]$threadUsableMetrics.firstUsableMs) -Force
    $threadPageLoadMetrics | Add-Member -NotePropertyName "browserObservedUsableMs" -NotePropertyValue ([int]$threadUsableMetrics.browserObservedUsableMs) -Force
    Write-Step ("thread DOM pressure -> " + (@{
      firstUsableMs = [int]$threadPageLoadMetrics.firstUsableMs
      browserObservedUsableMs = [int]$threadPageLoadMetrics.browserObservedUsableMs
      items = [int]$threadPageLoadMetrics.visibleConversationItemCount
      cards = [int]$threadPageLoadMetrics.messageCardCount
      codeLines = [int]$threadPageLoadMetrics.codeLineCount
      commandOutputs = [int]$threadPageLoadMetrics.mountedCommandOutputCount
      conversationDomNodes = [int]$threadPageLoadMetrics.conversationDomNodeCount
    } | ConvertTo-Json -Compress))
    Write-Step ("thread endpoint timing -> " + ($threadPageLoadMetrics.endpointTiming | ConvertTo-Json -Compress))
    Write-Step ("thread state entries -> " + ($threadPageLoadMetrics.stateThreadEntries | ConvertTo-Json -Compress))
    Write-Step ("app-server recent rpc -> " + ((Read-AppServerRecentRpcMetrics -BaseUrl $BaseUrl) | ConvertTo-Json -Depth 4 -Compress))
    Assert-ThreadPageLoadMetrics -Metrics $threadPageLoadMetrics -ThreadId $ThreadId -AllowAuthoritativeEmptyThread:($threadUsableMetrics.authoritativeEmptyThread -eq $true)
    $threadMessageCacheMetrics = Read-ThreadMessageCacheMetrics -Session $session -ThreadId $ThreadId
    Assert-ThreadMessageCacheMetrics -Metrics $threadMessageCacheMetrics -ThreadId $ThreadId -AllowMissingEmptyEntry:($threadUsableMetrics.authoritativeEmptyThread -eq $true)
    $allowUnavailableLoadMore = [int]$threadMessageCacheMetrics.messageCount -le $ThreadInitialMessageWindowSize
    Assert-ThreadLoadMoreWindow -Session $session -ThreadId $ThreadId -AllowUnavailable:$allowUnavailableLoadMore
    if ($MeasureSendFeedback) {
      Measure-ThreadSendFeedbackBudget -Session $session -ThreadId $ThreadId
    }
    if ($MeasureResponseFeedback) {
      Measure-ThreadResponseFeedbackBudget -Session $session -ThreadId $ThreadId
    }
    Add-RegressionResult -Name "thread-phone" -Page $thread
  } else {
    if ($MeasureSendFeedback) {
      throw "-MeasureSendFeedback requires -ThreadId"
    }
    if ($MeasureResponseFeedback) {
      throw "-MeasureResponseFeedback requires -ThreadId"
    }
    Write-Step "thread page check skipped; pass -ThreadId to enable it"
  }

  $results | Format-Table -AutoSize
  Write-Step "all frontend checks passed"
} finally {
  try {
    Invoke-AgentBrowser -Arguments @("--session", $session, "close", "--all") | Out-Null
  } catch {}
}
