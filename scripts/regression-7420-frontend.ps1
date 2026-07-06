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
  [switch]$CaptureScreenshots,
  [string]$ScreenshotTaskName = "frontend-ui-regression",
  [string]$ScreenshotOutputDir = "",
  [string]$RequireThreadTitle = "",
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

function Convert-ToSafeFileName {
  param([string]$Name)

  $safe = $Name -replace '[^A-Za-z0-9_.-]+', '-'
  $safe = $safe.Trim('-')
  if ([string]::IsNullOrWhiteSpace($safe)) {
    return "screenshot"
  }
  return $safe
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

function Close-SettingsPanelIfOpen {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const panel = document.querySelector('.sidebar-settings-panel');
  if (!panel) return { hadPanel: false, closed: false };
  const button = document.querySelector('.sidebar-settings-button');
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

  $parts = $normalized -split '[\\/]+' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
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
  return { groupCount: groups.length, groups };
})())
'@
  return Invoke-BrowserEvalJson -Session $Session -Script $script
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

  $workspaceRoots = @()
  $pinnedRootSet = @{}
  foreach ($rootPath in @($RootsState.data.pinnedProjectIds)) {
    $normalizedPinnedRootPath = [string]$rootPath
    if (-not [string]::IsNullOrWhiteSpace($normalizedPinnedRootPath)) {
      $pinnedRootSet[$normalizedPinnedRootPath] = $true
    }
  }

  foreach ($rootPath in @($RootsState.data.pinnedProjectIds) + @($RootsState.data.projectOrder) + @($RootsState.data.order)) {
    $normalizedRootPath = [string]$rootPath
    if ([string]::IsNullOrWhiteSpace($normalizedRootPath)) {
      continue
    }
    if ($workspaceRoots -notcontains $normalizedRootPath) {
      $workspaceRoots += $normalizedRootPath
    }
  }
  if ($workspaceRoots.Count -eq 0) {
    return
  }

  $labelsByRoot = @{}
  foreach ($property in @($RootsState.data.labels.PSObject.Properties)) {
    $labelsByRoot[[string]$property.Name] = [string]$property.Value
  }

  $expectedRoots = @($workspaceRoots | Select-Object -First ([Math]::Min(3, $workspaceRoots.Count)))
  Assert-True ($Metrics.groupCount -ge $expectedRoots.Count) "home sidebar project group count is below workspace root count sample"

  for ($index = 0; $index -lt $expectedRoots.Count; $index++) {
    $rootPath = [string]$expectedRoots[$index]
    $expectedProjectName = Get-WorkspaceProjectName -Path $rootPath
    $expectedLabel = if ($labelsByRoot.ContainsKey($rootPath)) { $labelsByRoot[$rootPath] } else { $expectedProjectName }
    $group = $Metrics.groups[$index]

    Assert-True ([string]$group.projectName -eq $expectedProjectName) "home sidebar project order drifted at index $index; expected $expectedProjectName from workspace root $rootPath, got $($group.projectName)"
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
  return {
    url: location.href,
    text: text.includes('Runtime Store') ? 'Runtime Store' : '',
    textLength: text.length,
    hasInternalThreadReadError: /thread-store internal error|failed to read thread\s+[A-Za-z]:\\/i.test(text),
    hasBlankBody: text.length < 5 && !hasComposer && !hasSkillsHub && !hasTrendingHub && !hasRuntimeBar && !hasDiagnosticsPanel && !hasMarkdownBody,
    hasComposer,
    hasSkillsHub,
    hasTrendingHub,
    hasRuntimeBar,
    hasDiagnosticsPanel,
    hasMarkdownBody,
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
  Assert-True ($Metrics.actionTileCount -ge 5) "foldable sidebar action grid is missing entries"
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
    isLoading: !!loading,
    hasEmptyText: !!emptyText,
    drawerWidth: drawerRect ? Math.round(drawerRect.width) : 0,
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
  Assert-True ($Metrics.hasEmptyText -eq $false) "mobile drawer sidebar rendered empty/error text despite available threads"
  Assert-True ($Metrics.drawerWidth -le $Metrics.clientWidth) "mobile drawer is wider than viewport: $($Metrics.drawerWidth) > $($Metrics.clientWidth)"
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
    hasFixtureCodeText: textContent.includes('fixture-code-block'),
    hasFixtureRawText: textContent.includes('fixture-raw-payload'),
    hasHiddenFileChangeNoise: textContent.includes('fixture-hidden-file-change-noise') || textContent.includes('Unhandled App Server item: fileChange') || textContent.includes('unhandled.fileChange'),
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
  param(
    [object]$Metrics,
    [string]$ViewportName = ""
  )

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
  if ([int]$Metrics.viewportWidth -lt 768) {
    Assert-True ([int]$Metrics.tableScrollCount -eq 0) "conversation fixture phone viewport mounted desktop table DOM: $($Metrics.tableScrollCount)"
    Assert-True ([int]$Metrics.tableCardGroupCount -ge 1) "conversation fixture phone viewport is missing mobile table card group"
    Assert-True ([int]$Metrics.tableCardCount -ge 1) "conversation fixture phone viewport is missing mobile table cards"
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
  Assert-True ($Metrics.hasHiddenFileChangeNoise -eq $false) "conversation fixture rendered low-value unhandled.fileChange system noise"
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
  const projectGroups = Array.from(document.querySelectorAll('.sidebar-regression-fixture .project-group'));
  const firstProjectRows = Array.from(projectGroups[0]?.querySelectorAll('.thread-row') || []);
  const firstProjectThreadIds = firstProjectRows.map((node) => node.getAttribute('data-thread-id') || '');
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
    projectOrder: projectGroups.map((node) => node.getAttribute('data-project-name') || ''),
    pinnedProjectCount: pinnedProjectGroups.length,
    firstProjectPinned: projectGroups[0]?.getAttribute('data-pinned-project') === 'true',
    hasEmptyWorkspaceProject: !!emptyProjectGroup,
    emptyWorkspaceProjectText: emptyProjectGroup?.textContent?.trim() || '',
    emptyWorkspaceNewThreadButtonCount: emptyProjectGroup?.querySelectorAll('.thread-start-button').length || 0,
    firstProjectThreadRowCount: firstProjectRows.length,
    firstProjectThreadIds,
    showMoreButtonCount: showMoreButtons.length,
    firstShowMoreText: showMoreButtons[0]?.textContent?.trim() || '',
    pinnedSectionThreadIds,
    runningSectionThreadIds,
    runningThreadRowCount: countRowsByThreadId('fixture-thread-running'),
    runningThreadProjectRowCount: countProjectRowsByThreadId('fixture-thread-running'),
    pinnedThreadRowCount: countRowsByThreadId('fixture-thread-unread'),
    pinnedThreadProjectRowCount: countProjectRowsByThreadId('fixture-thread-unread'),
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
  Assert-True ($Metrics.projectOrder.Count -ge 3) "sidebar fixture is missing project groups"
  Assert-True ([string]$Metrics.projectOrder[0] -eq "E:/javaword/CXCodex/codexui") "sidebar fixture project order no longer follows input/app-server order"
  Assert-True ([int]$Metrics.pinnedProjectCount -eq 1) "sidebar fixture pinned project marker count is unexpected: $($Metrics.pinnedProjectCount)"
  Assert-True ($Metrics.firstProjectPinned -eq $true) "sidebar fixture first project is missing pinned project marker"
  Assert-True ($Metrics.hasEmptyWorkspaceProject -eq $true) "sidebar fixture filtered out empty workspace-root project"
  Assert-True ([string]$Metrics.emptyWorkspaceProjectText -like "*暂无会话*") "sidebar fixture empty workspace-root project does not show empty state"
  Assert-True ([int]$Metrics.emptyWorkspaceNewThreadButtonCount -eq 1) "sidebar fixture empty workspace-root project is missing new-thread action"
  Assert-True ([int]$Metrics.firstProjectThreadRowCount -eq 5) "sidebar fixture first expanded project should show exactly 5 threads by default, got $($Metrics.firstProjectThreadRowCount)"
  $expectedFirstProjectThreadIds = @(
    "fixture-thread-running",
    "fixture-thread-unread",
    "fixture-thread-idle",
    "fixture-thread-four",
    "fixture-thread-five"
  )
  for ($index = 0; $index -lt $expectedFirstProjectThreadIds.Count; $index++) {
    Assert-True ([string]$Metrics.firstProjectThreadIds[$index] -eq $expectedFirstProjectThreadIds[$index]) "sidebar fixture project thread order drifted at index $index; expected $($expectedFirstProjectThreadIds[$index]), got $($Metrics.firstProjectThreadIds[$index])"
  }
  Assert-True ([int]$Metrics.showMoreButtonCount -ge 1) "sidebar fixture is missing show more control for long project thread list"
  Assert-True ([string]$Metrics.firstShowMoreText -eq "显示更多 3 条") "sidebar fixture show more label is unexpected: $($Metrics.firstShowMoreText)"
  Assert-True ([int]$Metrics.pinnedSectionThreadIds.Count -eq 2) "sidebar fixture pinned section should show exactly 2 pinned threads, got $($Metrics.pinnedSectionThreadIds.Count)"
  Assert-True ([string]$Metrics.pinnedSectionThreadIds[0] -eq "fixture-thread-unread") "sidebar fixture pinned section order drifted at index 0"
  Assert-True ([string]$Metrics.pinnedSectionThreadIds[1] -eq "fixture-thread-running") "sidebar fixture pinned section order drifted at index 1"
  Assert-True ([int]$Metrics.runningSectionThreadIds.Count -eq 0) "sidebar fixture running section should not duplicate a pinned running thread"
  Assert-True ([int]$Metrics.runningThreadRowCount -eq 2) "sidebar fixture pinned running thread should appear only in pinned section and project list"
  Assert-True ([int]$Metrics.runningThreadProjectRowCount -eq 1) "sidebar fixture running thread is not retained exactly once in project list"
  Assert-True ([int]$Metrics.pinnedThreadRowCount -eq 2) "sidebar fixture pinned thread should appear only in pinned section and project list"
  Assert-True ([int]$Metrics.pinnedThreadProjectRowCount -eq 1) "sidebar fixture pinned thread is not retained exactly once in project list"
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
  const dictationHelper = document.querySelector('.composer-regression-fixture .thread-composer-dictation-helper');
  const dictationProbe = document.querySelector('.composer-regression-fixture .composer-regression-dictation-insert');
  const submitCount = document.querySelector('.composer-regression-fixture .composer-regression-submit-count');
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
    hasDictationHelper: !!dictationHelper,
    hasDictationProbe: !!dictationProbe,
    inputValue: input?.value || '',
    submitCount: Number.parseInt(submitCount?.textContent || '0', 10),
    dictationHelperText: dictationHelper?.textContent?.trim() || '',
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
  Assert-True ($Metrics.hasDictationHelper -eq $false) "$ViewportName composer fixture shows idle dictation helper text"
  Assert-True ($Metrics.hasDictationProbe -eq $true) "$ViewportName composer fixture is missing dictation regression probe"
  Assert-True ($Metrics.shellHeight -ge 82) "$ViewportName composer shell is too short: $($Metrics.shellHeight)"
  Assert-True ($Metrics.shellHeight -le 112) "$ViewportName composer shell is too tall: $($Metrics.shellHeight)"
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

function Invoke-ComposerDictationProbe {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const button = document.querySelector('.composer-regression-fixture .composer-regression-dictation-insert');
  if (button instanceof HTMLElement) {
    button.click();
    return { clicked: true };
  }
  return { clicked: false };
})())
'@
  $result = Invoke-BrowserEvalJson -Session $Session -Script $script
  Assert-True ($result.clicked -eq $true) "composer dictation regression probe could not be clicked"
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "200") | Out-Null
}

function Assert-ComposerDictationDraft {
  param(
    [object]$Metrics,
    [string]$ViewportName
  )

  Assert-True ($Metrics.inputValue -like "*语音转文字回归测试*") "$ViewportName composer dictation text was not inserted into the input"
  Assert-True ([int]$Metrics.submitCount -eq 0) "$ViewportName composer dictation auto-submitted unexpectedly"
  Assert-True ($Metrics.dictationHelperText -eq "已转成文字，可编辑后发送。") "$ViewportName composer dictation success text drifted: $($Metrics.dictationHelperText)"
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
  return {
    apiCount: resources.length,
    stateThreadRequestCount: countByPath(statePath),
    runtimeThreadRequestCount: countByPath(runtimePath),
    tokenUsageRequestCount: countByPath(tokenPath),
    firstScreenProjectRootSuggestionMaxDuplicateCount,
    firstScreenWorkspaceRootsStateCount,
    firstScreenDesktopAppStatusCount,
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
    [string]$ThreadId
  )

  Assert-True ([int]$Metrics.stateThreadRequestCount -le 8) "thread page loaded $($Metrics.stateThreadRequestCount) state snapshots for $ThreadId; expected no more than 8 during initial settle"
  Assert-True ([int]$Metrics.runtimeThreadRequestCount -le 8) "thread page loaded $($Metrics.runtimeThreadRequestCount) runtime snapshots for $ThreadId; expected no more than 8 during initial settle"
  Assert-True ([int]$Metrics.tokenUsageRequestCount -le 1) "thread page loaded $($Metrics.tokenUsageRequestCount) token usage snapshots for $ThreadId; expected at most 1 throttled background read during initial settle"
  Assert-True ([int]$Metrics.firstScreenProjectRootSuggestionMaxDuplicateCount -le 1) "thread page repeated the same project-root-suggestion request $($Metrics.firstScreenProjectRootSuggestionMaxDuplicateCount) times during first-screen load for $ThreadId"
  Assert-True ([int]$Metrics.firstScreenWorkspaceRootsStateCount -le 1) "thread page loaded workspace-roots-state $($Metrics.firstScreenWorkspaceRootsStateCount) times during first-screen load for $ThreadId"
  Assert-True ([int]$Metrics.firstScreenDesktopAppStatusCount -eq 0) "thread page loaded desktop-app/status during first-screen load for $ThreadId"
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
  $homePage = Open-And-ReadPage -Session $session -Url "$($BaseUrl)/#/" -Width $DesktopWidth -Height $DesktopHeight
  Assert-Page -Page $homePage -Name "home desktop" -RequireComposer
  Assert-WorkspaceRootProjectParity -RootsState $workspaceRootsState -Metrics (Read-HomeWorkspaceProjectMetrics -Session $session)
  Assert-RequiredSidebarThreadDom `
    -Thread $requiredSidebarThread `
    -Metrics (Read-RequiredSidebarThreadMetrics -Session $session -Thread $requiredSidebarThread) `
    -Context "home desktop"
  Add-RegressionResult -Name "home-desktop" -Page $homePage
  Invoke-AgentBrowser -Arguments @("--session", $session, "click", ".sidebar-settings-button") | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $session, "wait", "200") | Out-Null
  Assert-SettingsPanel -Metrics (Read-SettingsPanelMetrics -Session $session)
  Close-SettingsPanelIfOpen -Session $session
  Reset-AppShellLayoutPreferences -Session $session

  $homeFoldable = Open-And-ReadPage -Session $session -Url "$($BaseUrl)/#/" -Width $FoldableWidth -Height $FoldableHeight
  Assert-Page -Page $homeFoldable -Name "home foldable" -RequireComposer
  Assert-FoldableShell -Metrics (Read-FoldableShellMetrics -Session $session)
  Add-RegressionResult -Name "home-foldable" -Page $homeFoldable

  Set-SidebarCollapsedPreference -Session $session -Collapsed $true
  $homePhone = Open-And-ReadPage -Session $session -Url "$($BaseUrl)/#/" -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $homePhone -Name "home phone" -RequireComposer
  Assert-MobileDrawerSidebar -Metrics (Open-MobileDrawerSidebar -Session $session)
  Assert-RequiredSidebarThreadDom `
    -Thread $requiredSidebarThread `
    -Metrics (Read-RequiredSidebarThreadMetrics -Session $session -Thread $requiredSidebarThread -RootSelector ".mobile-drawer") `
    -Context "home mobile drawer"
  Add-RegressionResult -Name "home-mobile-drawer" -Page $homePhone

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
  Invoke-ComposerDictationProbe -Session $session
  Assert-ComposerDictationDraft -Metrics (Read-ComposerFixtureMetrics -Session $session) -ViewportName "desktop"
  Add-RegressionResult -Name "composer-shell-fixture-desktop" -Page $composerFixture

  $composerFixturePhone = Open-And-ReadPage -Session $session -Url $composerFixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $composerFixturePhone -Name "composer shell fixture phone" -RequireComposer
  Assert-ComposerFixture -Metrics (Read-ComposerFixtureMetrics -Session $session) -ViewportName "phone"
  Invoke-ComposerDictationProbe -Session $session
  Assert-ComposerDictationDraft -Metrics (Read-ComposerFixtureMetrics -Session $session) -ViewportName "phone"
  Add-RegressionResult -Name "composer-shell-fixture-phone" -Page $composerFixturePhone

  $composerFixtureFoldable = Open-And-ReadPage -Session $session -Url $composerFixtureUrl -Width $FoldableWidth -Height $FoldableHeight
  Assert-Page -Page $composerFixtureFoldable -Name "composer shell fixture foldable" -RequireComposer
  Assert-ComposerFixture -Metrics (Read-ComposerFixtureMetrics -Session $session) -ViewportName "foldable"
  Invoke-ComposerDictationProbe -Session $session
  Assert-ComposerDictationDraft -Metrics (Read-ComposerFixtureMetrics -Session $session) -ViewportName "foldable"
  Add-RegressionResult -Name "composer-shell-fixture-foldable" -Page $composerFixtureFoldable

  $fixtureUrl = $BaseUrl + "/#/__regression/conversation-blocks?regression=frontend"
  $fixture = Open-And-ReadPage -Session $session -Url $fixtureUrl -Width $DesktopWidth -Height $DesktopHeight
  Assert-Page -Page $fixture -Name "conversation blocks fixture desktop"
  Assert-ConversationRawPayloadLazy -Session $session
  Expand-ConversationFixturePendingRequests -Session $session
  Assert-ConversationCommandOutputLazy -Session $session
  Assert-ConversationFixture -Metrics (Read-ConversationFixtureMetrics -Session $session) -ViewportName "desktop"
  Assert-ConversationFixtureCopyInteraction -Session $session
  Add-RegressionResult -Name "conversation-blocks-fixture" -Page $fixture

  $fixturePhone = Open-And-ReadPage -Session $session -Url $fixtureUrl -Width $PhoneWidth -Height $PhoneHeight
  Assert-Page -Page $fixturePhone -Name "conversation blocks fixture phone"
  Assert-ConversationRawPayloadLazy -Session $session
  Expand-ConversationFixturePendingRequests -Session $session
  Assert-ConversationCommandOutputLazy -Session $session
  Assert-ConversationFixture -Metrics (Read-ConversationFixtureMetrics -Session $session) -ViewportName "phone"
  Add-RegressionResult -Name "conversation-blocks-fixture-phone" -Page $fixturePhone

  $fixtureFoldable = Open-And-ReadPage -Session $session -Url $fixtureUrl -Width $FoldableWidth -Height $FoldableHeight
  Assert-Page -Page $fixtureFoldable -Name "conversation blocks fixture foldable"
  Assert-ConversationRawPayloadLazy -Session $session
  Expand-ConversationFixturePendingRequests -Session $session
  Assert-ConversationCommandOutputLazy -Session $session
  Assert-ConversationFixture -Metrics (Read-ConversationFixtureMetrics -Session $session) -ViewportName "foldable"
  Add-RegressionResult -Name "conversation-blocks-fixture-foldable" -Page $fixtureFoldable

  if (-not [string]::IsNullOrWhiteSpace($ThreadId)) {
    $thread = Open-And-ReadPage -Session $session -Url "$($BaseUrl)/#/thread/$ThreadId" -Width $PhoneWidth -Height $PhoneHeight
    Assert-Page -Page $thread -Name "thread phone" -RequireComposer
    Invoke-AgentBrowser -Arguments @("--session", $session, "wait", "9000") | Out-Null
    $threadPageLoadMetrics = Read-ThreadPageLoadMetrics -Session $session -ThreadId $ThreadId
    Assert-ThreadPageLoadMetrics -Metrics $threadPageLoadMetrics -ThreadId $ThreadId
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
