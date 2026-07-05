[CmdletBinding()]
param(
  [string]$BaseUrl = "http://127.0.0.1:7420",
  [string]$ThreadId = "",
  [int]$DesktopWidth = 1440,
  [int]$DesktopHeight = 900,
  [int]$PhoneWidth = 393,
  [int]$PhoneHeight = 852,
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

function Read-ConversationFixtureMetrics {
  param([string]$Session)

  $script = @'
JSON.stringify((() => {
  const codeBlocks = Array.from(document.querySelectorAll('.message-code-block'));
  const copyButtons = Array.from(document.querySelectorAll('.message-code-copy'));
  const fileCards = Array.from(document.querySelectorAll('.message-file-card'));
  const rawCards = Array.from(document.querySelectorAll('.message-structured-card'));
  const requestCards = Array.from(document.querySelectorAll('.request-card'));
  const permissionPanels = Array.from(document.querySelectorAll('.request-permission-panel'));
  const requestButtons = Array.from(document.querySelectorAll('.request-button'));
  const firstCopyButton = copyButtons[0];
  const firstRequestCard = requestCards[0];
  const firstPermissionPanel = permissionPanels[0];
  const requestCardRadius = firstRequestCard ? Number.parseFloat(window.getComputedStyle(firstRequestCard).borderTopLeftRadius || '0') : 0;
  const permissionPanelRadius = firstPermissionPanel ? Number.parseFloat(window.getComputedStyle(firstPermissionPanel).borderTopLeftRadius || '0') : 0;
  const textContent = document.body.textContent || '';
  return {
    codeBlockCount: codeBlocks.length,
    diffBlockCount: codeBlocks.filter((node) => node.getAttribute('data-diff') === 'true').length,
    copyButtonCount: copyButtons.length,
    fileCardCount: fileCards.length,
    rawPayloadCardCount: rawCards.length,
    requestCardCount: requestCards.length,
    permissionPanelCount: permissionPanels.length,
    requestButtonCount: requestButtons.length,
    requestCardRadius,
    permissionPanelRadius,
    hasAddLine: !!document.querySelector('.message-code-line[data-kind="add"]'),
    hasDeleteLine: !!document.querySelector('.message-code-line[data-kind="delete"]'),
    hasMetaLine: !!document.querySelector('.message-code-line[data-kind="meta"]'),
    hasFixtureCodeText: textContent.includes('fixture-code-block'),
    hasFixtureRawText: textContent.includes('fixture-raw-payload'),
    hasFixturePermissionText: textContent.includes('fixture-permission-workbench'),
    hasPermissionServerText: textContent.includes('chrome'),
    hasPermissionToolText: textContent.includes('browser_click'),
    hasPermissionActionText: textContent.includes('允许并继续') && textContent.includes('拒绝') && textContent.includes('稍后处理'),
    firstCopyButtonText: firstCopyButton ? firstCopyButton.textContent.trim() : '',
    hasEmojiFileIcon: document.body.innerText.includes('📄'),
    hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
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
  Assert-True ($Metrics.requestCardCount -ge 1) "conversation fixture is missing pending request card"
  Assert-True ($Metrics.permissionPanelCount -ge 1) "conversation fixture is missing MCP permission panel"
  Assert-True ($Metrics.requestButtonCount -ge 3) "conversation fixture is missing permission action buttons"
  Assert-True ($Metrics.requestCardRadius -le 10) "conversation fixture request card radius is too large: $($Metrics.requestCardRadius)"
  Assert-True ($Metrics.permissionPanelRadius -le 10) "conversation fixture permission panel radius is too large: $($Metrics.permissionPanelRadius)"
  Assert-True ($Metrics.hasAddLine -eq $true) "conversation fixture is missing diff add line styling"
  Assert-True ($Metrics.hasDeleteLine -eq $true) "conversation fixture is missing diff delete line styling"
  Assert-True ($Metrics.hasMetaLine -eq $true) "conversation fixture is missing diff metadata line styling"
  Assert-True ($Metrics.hasFixtureCodeText -eq $true) "conversation fixture is missing fixture code text"
  Assert-True ($Metrics.hasFixtureRawText -eq $true) "conversation fixture is missing raw payload marker"
  Assert-True ($Metrics.hasFixturePermissionText -eq $true) "conversation fixture is missing permission workbench marker"
  Assert-True ($Metrics.hasPermissionServerText -eq $true) "conversation fixture is missing MCP server label"
  Assert-True ($Metrics.hasPermissionToolText -eq $true) "conversation fixture is missing MCP tool label"
  Assert-True ($Metrics.hasPermissionActionText -eq $true) "conversation fixture is missing permission action labels"
  Assert-True ([string]$Metrics.firstCopyButtonText -like "*复制*") "conversation fixture first code block copy button is not visible"
  Assert-True ($Metrics.hasEmojiFileIcon -eq $false) "conversation fixture still renders emoji file icons"
  Assert-True ($Metrics.hasHorizontalOverflow -eq $false) "conversation fixture has horizontal overflow: $($Metrics.scrollWidth) > $($Metrics.clientWidth)"
}

function Expand-ConversationFixturePendingRequests {
  param([string]$Session)

  Invoke-AgentBrowser -Arguments @("--session", $Session, "click", ".conversation-process-toggle") | Out-Null
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

  $codexHealth = Test-HttpJson -Name "codex health" -Url "$($BaseUrl)/codex-api/health"
  Assert-True ($codexHealth.status -eq "ok") "codex health status is not ok"
  Assert-True ($codexHealth.data.appServer.pendingRpcCount -eq 0) "pendingRpcCount is not zero"
  Assert-True ($codexHealth.data.appServer.queuedRpcCount -eq 0) "queuedRpcCount is not zero"
  Assert-True ($codexHealth.data.runtimeStore.uncertainRequestCount -eq 0) "uncertainRequestCount is not zero"

  $diagnostics = Test-HttpJson -Name "diagnostics api" -Url "$($BaseUrl)/codex-api/diagnostics"
  Assert-True ($diagnostics.status -eq "ok") "diagnostics status is not ok"
  Assert-True ($null -ne $diagnostics.data.runtimeStore) "diagnostics is missing runtimeStore"

  $homePage = Open-And-ReadPage -Session $session -Url "$($BaseUrl)/#/" -Width $DesktopWidth -Height $DesktopHeight
  Assert-Page -Page $homePage -Name "home desktop" -RequireComposer
  Add-RegressionResult -Name "home-desktop" -Page $homePage

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

  $fixtureUrl = $BaseUrl + "/#/__regression/conversation-blocks?regression=frontend"
  $fixture = Open-And-ReadPage -Session $session -Url $fixtureUrl -Width $DesktopWidth -Height $DesktopHeight
  Assert-Page -Page $fixture -Name "conversation blocks fixture desktop"
  Expand-ConversationFixturePendingRequests -Session $session
  Assert-ConversationFixture -Metrics (Read-ConversationFixtureMetrics -Session $session)
  Assert-ConversationFixtureCopyInteraction -Session $session
  Add-RegressionResult -Name "conversation-blocks-fixture" -Page $fixture

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
