[CmdletBinding()]
param(
  [string]$BaseUrl = "http://127.0.0.1:7420",
  [string]$ThreadId = "",
  [int]$DesktopWidth = 1440,
  [int]$DesktopHeight = 900,
  [int]$PhoneWidth = 393,
  [int]$PhoneHeight = 852,
  [int]$FoldableWidth = 884,
  [int]$FoldableHeight = 1104,
  [int]$AgentBrowserTimeoutSec = 25
)

$ErrorActionPreference = "Stop"

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

function Reset-AppShellLayoutPreferences {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  window.localStorage.setItem('codex-web-local.sidebar-collapsed.v1', '0');
  window.localStorage.removeItem('codex-web-local.sidebar-width.v1');
  return { reset: true };
})())
'@
  Invoke-BrowserEvalJson -Session $Session -Script $script | Out-Null
}

function Test-HttpJson {
  param(
    [string]$Name,
    [string]$Url
  )

  Write-Step "checking $Name -> $Url"
  $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 12
  Assert-True ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) "$Name returned HTTP $($response.StatusCode)"
  return ($response.Content | ConvertFrom-Json)
}

function Wait-CodexHealthIdle {
  param([string]$Url)

  $lastHealth = $null
  for ($attempt = 1; $attempt -le 8; $attempt++) {
    $lastHealth = Test-HttpJson -Name "codex health" -Url $Url
    if (
      $lastHealth.status -eq "ok" `
      -and $lastHealth.data.appServer.pendingRpcCount -le 1 `
      -and $lastHealth.data.appServer.queuedRpcCount -eq 0 `
      -and $lastHealth.data.runtimeStore.uncertainRequestCount -eq 0
    ) {
      return $lastHealth
    }

    Write-Step "codex health not idle yet (attempt $attempt/8): pending=$($lastHealth.data.appServer.pendingRpcCount), queued=$($lastHealth.data.appServer.queuedRpcCount), uncertain=$($lastHealth.data.runtimeStore.uncertainRequestCount)"
    Start-Sleep -Milliseconds 900
  }

  return $lastHealth
}

function Assert-CodexHealthReadyForFrontendRegression {
  param([object]$Health)

  Assert-True ($Health.status -eq "ok") "codex health status is not ok"
  Assert-True ($Health.data.appServer.queuedRpcCount -eq 0) "queuedRpcCount is not zero"
  Assert-True ($Health.data.appServer.pendingRpcCount -le 1) "pendingRpcCount is above the tolerated single background call: $($Health.data.appServer.pendingRpcCount)"
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
  Invoke-AgentBrowser -Arguments @("--session", $Session, "open", $Url) | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "set", "viewport", "$Width", "$Height") | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "open", $Url) | Out-Null
  Start-Sleep -Seconds 2

  $script = @'
JSON.stringify((() => {
  const text = document.body.innerText.replace(/\s+/g, ' ').trim();
  return {
    url: location.href,
    text: text.includes('Runtime Store') ? 'Runtime Store' : '',
    textLength: text.length,
    hasBlankBody: text.length < 20,
    hasComposer: !!document.querySelector('textarea,[contenteditable=true],input[type=text],.thread-composer'),
    hasSkillsHub: !!document.querySelector('.skills-hub'),
    hasTrendingHub: !!document.querySelector('.trending-hub'),
    hasRuntimeBar: !!document.querySelector('.runtime-status-bar'),
    hasDiagnosticsPanel: !!document.querySelector('.diagnostics-panel'),
    hasMarkdownBody: !!document.querySelector('.markdown-body'),
    hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    viewport: { width: window.innerWidth, height: window.innerHeight }
  };
})())
'@
  return Invoke-BrowserEvalJson -Session $Session -Script $script
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

function Read-SettingsPanelMetrics {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const panel = document.querySelector('.sidebar-settings-panel');
  const brandCard = document.querySelector('.sidebar-settings-brand-card');
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
  Assert-True ($Metrics.sidebarWidth -ge 260) "foldable sidebar is too narrow: $($Metrics.sidebarWidth)"
  Assert-True ($Metrics.sidebarWidth -le 370) "foldable sidebar is too wide: $($Metrics.sidebarWidth)"
  Assert-True ($Metrics.sidebarRatio -le 0.42) "foldable sidebar takes too much width: $($Metrics.sidebarRatio)"
  Assert-True ($Metrics.mainWidth -ge 500) "foldable main content is too narrow: $($Metrics.mainWidth)"
  Assert-True ($Metrics.contentGridWidth -ge 430) "foldable content grid is too narrow: $($Metrics.contentGridWidth)"
  Assert-True ($Metrics.composerWidth -ge 430) "foldable composer is too narrow: $($Metrics.composerWidth)"
  Assert-True ($Metrics.fitFailureCount -eq 0) "foldable shell elements overflow viewport: $($Metrics.fitFailures | ConvertTo-Json -Compress)"
  Assert-True ($Metrics.hasHorizontalOverflow -eq $false) "foldable shell has horizontal overflow: $($Metrics.scrollWidth) > $($Metrics.clientWidth)"
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
  const runtimeStatusBars = Array.from(document.querySelectorAll('.conversation-regression-fixture .runtime-status-bar'));
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
    runtimeStatusBarCount: runtimeStatusBars.length,
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
    hasFixtureCodeText: textContent.includes('fixture-code-block'),
    hasFixtureRawText: textContent.includes('fixture-raw-payload'),
    hasFixtureCommandText: textContent.includes('fixture-command-output: ok'),
    hasFixtureCommandLabel: textContent.includes('npm.cmd run test:7420:frontend'),
    hasFixturePermissionText: textContent.includes('fixture-permission-workbench'),
    hasFixtureToolCallText: textContent.includes('fixture-tool-call-workbench') || textContent.includes('Browser tool call cannot be executed directly'),
    hasPermissionServerText: textContent.includes('chrome'),
    hasPermissionToolText: textContent.includes('browser_click'),
    hasToolCallActionText: textContent.includes('让 Codex 改用文字继续'),
    hasPermissionActionText: textContent.includes('允许并继续') && textContent.includes('拒绝') && textContent.includes('稍后处理'),
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

function Assert-ConversationFixture {
  param([object]$Metrics)

  Assert-True ($Metrics.codeBlockCount -ge 2) "conversation fixture is missing code/diff blocks"
  Assert-True ($Metrics.diffBlockCount -ge 1) "conversation fixture is missing diff block"
  Assert-True ($Metrics.copyButtonCount -ge 2) "conversation fixture is missing code copy buttons"
  Assert-True ($Metrics.fileCardCount -ge 2) "conversation fixture is missing file cards"
  Assert-True ($Metrics.rawPayloadCardCount -ge 1) "conversation fixture is missing raw payload card"
  Assert-True ($Metrics.commandRowCount -ge 1) "conversation fixture is missing command row"
  Assert-True ($Metrics.commandOutputWrapCount -ge 1) "conversation fixture is missing command output wrapper"
  Assert-True ($Metrics.expandedCommandOutputCount -ge 1) "conversation fixture command output did not expand"
  Assert-True ($Metrics.commandRowRadius -le 10) "conversation fixture command row radius is too large: $($Metrics.commandRowRadius)"
  Assert-True ($Metrics.requestCardCount -ge 1) "conversation fixture is missing pending request card"
  Assert-True ($Metrics.permissionPanelCount -ge 1) "conversation fixture is missing MCP permission panel"
  Assert-True ($Metrics.toolPanelCount -ge 1) "conversation fixture is missing tool call panel"
  Assert-True ($Metrics.requestButtonCount -ge 3) "conversation fixture is missing permission action buttons"
  Assert-True ($Metrics.runtimeStatusBarCount -ge 1) "conversation fixture is missing runtime status bar"
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
  Assert-True ($Metrics.hasFixtureCommandText -eq $true) "conversation fixture is missing command output marker"
  Assert-True ($Metrics.hasFixtureCommandLabel -eq $true) "conversation fixture is missing command label"
  Assert-True ($Metrics.hasFixturePermissionText -eq $true) "conversation fixture is missing permission workbench marker"
  Assert-True ($Metrics.hasFixtureToolCallText -eq $true) "conversation fixture is missing tool call workbench marker"
  Assert-True ($Metrics.hasPermissionServerText -eq $true) "conversation fixture is missing MCP server label"
  Assert-True ($Metrics.hasPermissionToolText -eq $true) "conversation fixture is missing MCP tool label"
  Assert-True ($Metrics.hasToolCallActionText -eq $true) "conversation fixture is missing tool call action label"
  Assert-True ($Metrics.hasPermissionActionText -eq $true) "conversation fixture is missing permission action labels"
  Assert-True ([string]$Metrics.firstCopyButtonText -like "*复制*") "conversation fixture first code block copy button is not visible"
  Assert-True ($Metrics.hasEmojiFileIcon -eq $false) "conversation fixture still renders emoji file icons"
  Assert-True ($Metrics.hasHorizontalOverflow -eq $false) "conversation fixture has horizontal overflow: $($Metrics.scrollWidth) > $($Metrics.clientWidth)"
  Assert-True ($Metrics.structuredViewportFitFailureCount -eq 0) "conversation fixture structured blocks overflow viewport: $($Metrics.structuredViewportFitFailures | ConvertTo-Json -Compress)"
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
  if (!document.querySelector('.cmd-output-wrap.cmd-output-visible')) {
    document.querySelector('.cmd-row')?.click();
  }
  return { expanded: Boolean(document.querySelector('.cmd-output-wrap.cmd-output-visible')) };
})())
'@
  Invoke-BrowserEvalJson -Session $Session -Script $script | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "150") | Out-Null
}

function Assert-ConversationFixtureCopyInteraction {
  param([string]$Session)

  $stubScript = @'
JSON.stringify((() => {
  window.__cxCodexCopiedText = '';
  const originalSetTimeout = window.setTimeout.bind(window);
  window.setTimeout = (handler, timeout, ...args) => originalSetTimeout(handler, timeout === 1600 ? 10000 : timeout, ...args);
  const existingClipboard = navigator.clipboard || {};
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      ...existingClipboard,
      writeText: async (text) => {
        window.__cxCodexCopiedText = String(text);
      },
    },
  });
  return { stubbed: true };
})())
'@
  Invoke-BrowserEvalJson -Session $Session -Script $stubScript | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "click", ".message-code-copy") | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "300") | Out-Null

  $stateScript = @'
JSON.stringify({
  copiedText: window.__cxCodexCopiedText || '',
  copiedButtonCount: Array.from(document.querySelectorAll('.message-code-copy')).filter((button) => button.textContent.includes('已复制')).length
})
'@
  $state = Invoke-BrowserEvalJson -Session $Session -Script $stateScript
  $copiedText = [string]$state.copiedText
  Assert-True ($copiedText -like '*fixture-code-block*') "conversation fixture copy did not capture the code block body"
  Assert-True ($copiedText -notlike '*```*') "conversation fixture copy included markdown fence markers"
  Assert-True ([int]$state.copiedButtonCount -ge 1) "conversation fixture copy button did not show copied feedback"
}

function Read-SidebarFixtureMetrics {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const rows = Array.from(document.querySelectorAll('.sidebar-regression-fixture .thread-row'));
  const sources = Array.from(document.querySelectorAll('.sidebar-regression-fixture .thread-row-source'));
  const indicators = Array.from(document.querySelectorAll('.sidebar-regression-fixture .thread-status-indicator'));
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
  return {
    rowCount: rows.length,
    sourceCount: sources.length,
    indicatorCount: indicators.length,
    maxRowHeight: rowRects.length ? Math.max(...rowRects.map((rect) => rect.height)) : 0,
    minRowHeight: rowRects.length ? Math.min(...rowRects.map((rect) => rect.height)) : 0,
    maxRowRadius: rowRects.length ? Math.max(...rowRects.map((rect) => rect.radius)) : 0,
    hasPillSourceStyle,
    workingIndicator,
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
  Assert-True ($Metrics.sourceCount -ge 4) "sidebar fixture is missing source/status metadata"
  Assert-True ($Metrics.indicatorCount -ge 2) "sidebar fixture is missing unread/running indicators"
  Assert-True ($Metrics.minRowHeight -ge 40) "sidebar fixture row height is too small: $($Metrics.minRowHeight)"
  Assert-True ($Metrics.maxRowHeight -le 52) "sidebar fixture row height is too large: $($Metrics.maxRowHeight)"
  Assert-True ($Metrics.maxRowRadius -le 10) "sidebar fixture row radius is too large: $($Metrics.maxRowRadius)"
  Assert-True ($Metrics.hasPillSourceStyle -eq $false) "sidebar fixture still renders source/status as pill chips"
  Assert-True ($Metrics.workingIndicator.animationName -notlike "*spin*") "sidebar fixture running indicator still uses spinner animation"
  Assert-True ($Metrics.rowFitFailureCount -eq 0) "sidebar fixture rows overflow viewport"
  Assert-True ($Metrics.hasHorizontalOverflow -eq $false) "sidebar fixture has horizontal overflow: $($Metrics.scrollWidth) > $($Metrics.clientWidth)"
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
  const submit = document.querySelector('.composer-regression-fixture .thread-composer-submit');
  const shellRect = shell?.getBoundingClientRect();
  const formRect = form?.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth;
  const fitTargets = [form, shell, input, controls, attach, runtime, mic, submit].filter(Boolean);
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
    hasSubmit: !!submit,
    shellWidth: shellRect ? Math.round(shellRect.width) : 0,
    formWidth: formRect ? Math.round(formRect.width) : 0,
    shellHeight: shellRect ? Math.round(shellRect.height) : 0,
    shellRadius: style ? Number.parseFloat(style.borderTopLeftRadius || '0') : 0,
    shellBorderWidth: style ? Number.parseFloat(style.borderTopWidth || '0') : 0,
    shellBackground: bg,
    shellShadow: style?.boxShadow || '',
    usesWarmShell: bg === 'rgb(255, 253, 248)' || bg === 'rgb(255, 250, 243)',
    attachSize: attach ? Math.round(attach.getBoundingClientRect().width) : 0,
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
  Assert-True ($Metrics.hasAttach -eq $true) "$ViewportName composer fixture is missing attach trigger"
  Assert-True ($Metrics.hasRuntime -eq $true) "$ViewportName composer fixture is missing runtime trigger"
  Assert-True ($Metrics.hasMic -eq $true) "$ViewportName composer fixture is missing dictation button"
  Assert-True ($Metrics.hasSubmit -eq $true) "$ViewportName composer fixture is missing submit button"
  Assert-True ($Metrics.shellHeight -ge 88) "$ViewportName composer shell is too short: $($Metrics.shellHeight)"
  Assert-True ($Metrics.shellHeight -le 132) "$ViewportName composer shell is too tall: $($Metrics.shellHeight)"
  Assert-True ($Metrics.shellRadius -le 22) "$ViewportName composer shell radius is too large: $($Metrics.shellRadius)"
  Assert-True ($Metrics.shellBorderWidth -le 1) "$ViewportName composer shell border is too heavy: $($Metrics.shellBorderWidth)"
  Assert-True ($Metrics.usesWarmShell -eq $false) "$ViewportName composer shell still uses warm beige background: $($Metrics.shellBackground)"
  Assert-True ($Metrics.attachSize -ge 34) "$ViewportName composer attach button is too small: $($Metrics.attachSize)"
  Assert-True ($Metrics.micSize -ge 34) "$ViewportName composer mic button is too small: $($Metrics.micSize)"
  Assert-True ($Metrics.submitSize -ge 34) "$ViewportName composer submit button is too small: $($Metrics.submitSize)"
  Assert-True ($Metrics.runtimeWidth -ge 112) "$ViewportName composer runtime trigger is too narrow: $($Metrics.runtimeWidth)"
  Assert-True ($Metrics.fitFailureCount -eq 0) "$ViewportName composer controls overflow viewport: $($Metrics.fitFailures | ConvertTo-Json -Compress)"
  Assert-True ($Metrics.hasHorizontalOverflow -eq $false) "$ViewportName composer fixture has horizontal overflow: $($Metrics.scrollWidth) > $($Metrics.clientWidth)"
}

function Add-RegressionResult {
  param(
    [string]$Name,
    [object]$Page
  )

  $script:results += [PSCustomObject]@{
    name = $Name
    url = [string]$Page.url
    overflow = [bool]$Page.hasHorizontalOverflow
  }
}

if (-not (Get-Command agent-browser -ErrorAction SilentlyContinue)) {
  throw "agent-browser is not available in PATH"
}

$BaseUrl = $BaseUrl.TrimEnd("/")
$session = "cx-codex-frontend-regression"
$results = @()

try {
  $health = Test-HttpJson -Name "health" -Url "$($BaseUrl)/health"
  Assert-True ($health.status -eq "ok") "health status is not ok"

  $codexHealth = Wait-CodexHealthIdle -Url "$($BaseUrl)/codex-api/health"
  Assert-CodexHealthReadyForFrontendRegression -Health $codexHealth

  $diagnostics = Test-HttpJson -Name "diagnostics api" -Url "$($BaseUrl)/codex-api/diagnostics"
  Assert-True ($diagnostics.status -eq "ok") "diagnostics status is not ok"
  Assert-True ($null -ne $diagnostics.data.runtimeStore) "diagnostics is missing runtimeStore"

  $homePage = Open-And-ReadPage -Session $session -Url "$($BaseUrl)/#/" -Width $DesktopWidth -Height $DesktopHeight
  Assert-Page -Page $homePage -Name "home desktop" -RequireComposer
  Invoke-AgentBrowser -Arguments @("--session", $session, "click", ".sidebar-settings-button") | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $session, "wait", "200") | Out-Null
  Assert-SettingsPanel -Metrics (Read-SettingsPanelMetrics -Session $session)
  Add-RegressionResult -Name "home-desktop" -Page $homePage
  Reset-AppShellLayoutPreferences -Session $session

  $homeFoldable = Open-And-ReadPage -Session $session -Url "$($BaseUrl)/#/" -Width $FoldableWidth -Height $FoldableHeight
  Assert-Page -Page $homeFoldable -Name "home foldable" -RequireComposer
  Assert-FoldableShell -Metrics (Read-FoldableShellMetrics -Session $session)
  Add-RegressionResult -Name "home-foldable" -Page $homeFoldable

  $skills = Open-And-ReadPage -Session $session -Url "$($BaseUrl)/skills?regression=frontend" -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $skills -Name "skills phone" -RequireSkillsHub
  Add-RegressionResult -Name "skills-phone" -Page $skills

  $trending = Open-And-ReadPage -Session $session -Url "$($BaseUrl)/github-trending?regression=frontend" -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $trending -Name "github trending phone" -RequireTrendingHub
  Add-RegressionResult -Name "github-trending-phone" -Page $trending

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
  Add-RegressionResult -Name "sidebar-rows-fixture-phone" -Page $sidebarFixture

  $composerFixtureUrl = $BaseUrl + "/#/__regression/composer-shell?regression=frontend"
  $composerFixture = Open-And-ReadPage -Session $session -Url $composerFixtureUrl -Width $DesktopWidth -Height $DesktopHeight
  Assert-Page -Page $composerFixture -Name "composer shell fixture desktop" -RequireComposer
  Assert-ComposerFixture -Metrics (Read-ComposerFixtureMetrics -Session $session) -ViewportName "desktop"
  Add-RegressionResult -Name "composer-shell-fixture-desktop" -Page $composerFixture

  $composerFixturePhone = Open-And-ReadPage -Session $session -Url $composerFixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $composerFixturePhone -Name "composer shell fixture phone" -RequireComposer
  Assert-ComposerFixture -Metrics (Read-ComposerFixtureMetrics -Session $session) -ViewportName "phone"
  Add-RegressionResult -Name "composer-shell-fixture-phone" -Page $composerFixturePhone

  $composerFixtureFoldable = Open-And-ReadPage -Session $session -Url $composerFixtureUrl -Width $FoldableWidth -Height $FoldableHeight
  Assert-Page -Page $composerFixtureFoldable -Name "composer shell fixture foldable" -RequireComposer
  Assert-ComposerFixture -Metrics (Read-ComposerFixtureMetrics -Session $session) -ViewportName "foldable"
  Add-RegressionResult -Name "composer-shell-fixture-foldable" -Page $composerFixtureFoldable

  $fixtureUrl = $BaseUrl + "/#/__regression/conversation-blocks?regression=frontend"
  $fixture = Open-And-ReadPage -Session $session -Url $fixtureUrl -Width $DesktopWidth -Height $DesktopHeight
  Assert-Page -Page $fixture -Name "conversation blocks fixture desktop"
  Expand-ConversationFixturePendingRequests -Session $session
  Expand-ConversationFixtureCommandOutput -Session $session
  Assert-ConversationFixture -Metrics (Read-ConversationFixtureMetrics -Session $session)
  Assert-ConversationFixtureCopyInteraction -Session $session
  Add-RegressionResult -Name "conversation-blocks-fixture" -Page $fixture

  $fixturePhone = Open-And-ReadPage -Session $session -Url $fixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $fixturePhone -Name "conversation blocks fixture phone"
  Expand-ConversationFixturePendingRequests -Session $session
  Expand-ConversationFixtureCommandOutput -Session $session
  Assert-ConversationFixture -Metrics (Read-ConversationFixtureMetrics -Session $session)
  Add-RegressionResult -Name "conversation-blocks-fixture-phone" -Page $fixturePhone

  $fixtureFoldable = Open-And-ReadPage -Session $session -Url $fixtureUrl -Width $FoldableWidth -Height $FoldableHeight
  Assert-Page -Page $fixtureFoldable -Name "conversation blocks fixture foldable"
  Expand-ConversationFixturePendingRequests -Session $session
  Expand-ConversationFixtureCommandOutput -Session $session
  Assert-ConversationFixture -Metrics (Read-ConversationFixtureMetrics -Session $session)
  Add-RegressionResult -Name "conversation-blocks-fixture-foldable" -Page $fixtureFoldable

  if (-not [string]::IsNullOrWhiteSpace($ThreadId)) {
    $thread = Open-And-ReadPage -Session $session -Url "$($BaseUrl)/#/thread/$ThreadId" -Width $PhoneWidth -Height $PhoneHeight
    Assert-Page -Page $thread -Name "thread phone" -RequireComposer -RequireRuntimeBar
    Add-RegressionResult -Name "thread-phone" -Page $thread
  } else {
    Write-Step "thread page check skipped; pass -ThreadId to enable it"
  }

  $results | Format-Table -AutoSize
  Write-Step "all frontend checks passed"
} finally {
  try {
    Invoke-AgentBrowser -Arguments @("--session", $session, "close", "--all") | Out-Null
  } catch {}
}
