[CmdletBinding()]
param(
  [string]$BaseUrl = 'http://127.0.0.1:7420',
  [string]$FixtureBaseUrl = '',
  [string]$OutputDirectory = '',
  [string]$Session = 'cx-quiet-workbench-ux00',
  [ValidateSet('all', 'home', 'fixtures', 'thread', 'sidebar', 'composer')]
  [string]$Scope = 'all',
  [ValidateSet('agent-browser', 'playwright')]
  [string]$BrowserMode = 'agent-browser',
  [ValidateSet('light', 'dark', 'forced')]
  [string]$Theme = 'light',
  [ValidateSet('normal', 'reduced')]
  [string]$Motion = 'normal',
  [string]$ThreadTitle = '',
  [string]$ChromePath = ''
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $repoRoot 'output\quiet-workbench\ux00-baseline'
}
$resolvedOutput = [IO.Path]::GetFullPath($OutputDirectory)

if ($BrowserMode -eq 'playwright') {
  $playwrightPackage = @(
    'D:\nvm\node_cache\node_modules\@playwright\cli\node_modules\playwright',
    'D:\nvm\node_cache\node_modules\@playwright\mcp\node_modules\playwright'
  ) | Where-Object { Test-Path -LiteralPath (Join-Path $_ 'package.json') } | Select-Object -First 1
  if ([string]::IsNullOrWhiteSpace($playwrightPackage)) {
    throw 'Playwright is not available in the installed Codex workspace dependencies.'
  }
  $previousPlaywrightModule = $env:CX_CODEX_PLAYWRIGHT_MODULE
  try {
    $env:CX_CODEX_PLAYWRIGHT_MODULE = $playwrightPackage
    $nodeScript = Join-Path $PSScriptRoot 'capture-quiet-workbench-baseline.mjs'
    & 'C:\Program Files\nodejs\node.exe' $nodeScript `
      --base-url $BaseUrl `
      --fixture-base-url $(if ([string]::IsNullOrWhiteSpace($FixtureBaseUrl)) { $BaseUrl } else { $FixtureBaseUrl }) `
      --output-directory $resolvedOutput `
      --scope $Scope `
      --theme $Theme `
      --motion $Motion `
      --thread-title $ThreadTitle `
      --chrome-path $(if ([string]::IsNullOrWhiteSpace($ChromePath)) { 'C:\Program Files\Google\Chrome\Application\chrome.exe' } else { $ChromePath })
    if ($LASTEXITCODE -ne 0) {
      throw "Playwright baseline capture failed with exit code $LASTEXITCODE."
    }
    return
  } finally {
    if ($null -eq $previousPlaywrightModule) {
      Remove-Item Env:CX_CODEX_PLAYWRIGHT_MODULE -ErrorAction SilentlyContinue
    } else {
      $env:CX_CODEX_PLAYWRIGHT_MODULE = $previousPlaywrightModule
    }
  }
}

if ($Scope -eq 'thread' -or $Scope -eq 'sidebar' -or $Scope -eq 'composer') {
  throw 'Thread, sidebar, and composer capture currently require -BrowserMode playwright.'
}

if ($Theme -ne 'light' -or $Motion -ne 'normal') {
  throw 'Dark, forced-colors, and reduced-motion capture currently require -BrowserMode playwright.'
}

if ($BrowserMode -eq 'agent-browser' -and -not (Get-Command agent-browser -ErrorAction SilentlyContinue)) {
  throw 'agent-browser is required to capture the Quiet Workbench baseline.'
}

New-Item -ItemType Directory -Force -Path $resolvedOutput | Out-Null

$normalizedBaseUrl = $BaseUrl.TrimEnd('/')
$normalizedFixtureBaseUrl = if ([string]::IsNullOrWhiteSpace($FixtureBaseUrl)) {
  $normalizedBaseUrl
} else {
  $FixtureBaseUrl.TrimEnd('/')
}
$health = Invoke-RestMethod -Method Get -Uri "$normalizedBaseUrl/health" -TimeoutSec 10
if ($health.status -ne 'ok') {
  throw "CX-Codex health is not ok at $normalizedBaseUrl."
}

$viewports = @(
  [PSCustomObject]@{ Name = 'desktop'; Width = 1440; Height = 900 },
  [PSCustomObject]@{ Name = 'tablet'; Width = 884; Height = 1104 },
  [PSCustomObject]@{ Name = 'compact'; Width = 768; Height = 1024 },
  [PSCustomObject]@{ Name = 'phone'; Width = 393; Height = 852 },
  [PSCustomObject]@{ Name = 'phone-landscape'; Width = 852; Height = 393 }
)

$states = @(
  [PSCustomObject]@{ Name = 'home'; Path = '/#/' },
  [PSCustomObject]@{ Name = 'running'; Path = '/#/__regression/conversation-blocks?regression=frontend&uxState=running' },
  [PSCustomObject]@{ Name = 'completed'; Path = '/#/__regression/conversation-blocks?regression=frontend&uxState=completed' },
  [PSCustomObject]@{ Name = 'waiting-input'; Path = '/#/__regression/conversation-blocks?regression=frontend&uxState=waiting' }
)
if ($Scope -eq 'home') {
  $states = @($states | Where-Object { $_.Name -eq 'home' })
} elseif ($Scope -eq 'fixtures') {
  $states = @($states | Where-Object { $_.Name -ne 'home' })
}

function Invoke-AgentBrowser {
  param(
    [Parameter(Mandatory)][string[]]$Arguments,
    [Parameter(Mandatory)][string]$SessionName
  )

  & agent-browser --session $SessionName @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "agent-browser failed: $($Arguments -join ' ')"
  }
}

function Start-AgentBrowserSession {
  param([Parameter(Mandatory)][string]$SessionName)

  foreach ($attempt in 1..3) {
    & agent-browser --session $SessionName open about:blank
    if ($LASTEXITCODE -eq 0) {
      return
    }
    if ($attempt -lt 3) {
      Start-Sleep -Milliseconds 1200
    }
  }
  throw "agent-browser could not start baseline session $SessionName after 3 attempts."
}

# Starting the daemon while its first command is piped can keep inherited Windows
# handles open. Warm it once as a foreground command before collecting output.
$activeSession = if ($states[0].Name -eq 'home') { "$Session-home" } else { "$Session-fixture" }
if ($BrowserMode -eq 'agent-browser') {
  Start-AgentBrowserSession -SessionName $activeSession
}

$results = @()
foreach ($state in $states) {
  if ($BrowserMode -eq 'agent-browser' -and $state.Name -eq 'running' -and $activeSession.EndsWith('-home')) {
    & agent-browser --session $activeSession close
    if ($LASTEXITCODE -ne 0) {
      throw "agent-browser could not close baseline session $activeSession."
    }
    Start-Sleep -Milliseconds 1200
    $activeSession = "$Session-fixture"
    Start-AgentBrowserSession -SessionName $activeSession
  }

  foreach ($viewport in $viewports) {
    if ($BrowserMode -eq 'agent-browser') {
      Invoke-AgentBrowser -SessionName $activeSession -Arguments @('set', 'viewport', [string]$viewport.Width, [string]$viewport.Height) | Out-Null
    }
    $stateBaseUrl = if ($state.Name -eq 'home') { $normalizedBaseUrl } else { $normalizedFixtureBaseUrl }
    $url = $stateBaseUrl + $state.Path
    $fileName = "baseline-$($state.Name)-$($viewport.Width)x$($viewport.Height).png"
    $screenshotPath = Join-Path $resolvedOutput $fileName

    $metricsScript = @'
JSON.stringify({
  url: location.href,
  title: document.title,
  viewportWidth: innerWidth,
  viewportHeight: innerHeight,
  documentWidth: document.documentElement.scrollWidth,
  hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
  alertCount: document.querySelectorAll('[role="alert"]').length,
  dialogCount: document.querySelectorAll('[role="dialog"]').length,
  composerCount: document.querySelectorAll('.thread-composer-shell').length,
  conversationCount: document.querySelectorAll('.conversation-list').length,
  baselineState: document.querySelector('[data-ux-baseline-state]')?.getAttribute('data-ux-baseline-state') || '',
  liveOverlayCount: document.querySelectorAll('.live-overlay-inline').length,
  requestPanelCount: document.querySelectorAll('.conversation-process-section').length
})
'@
    Invoke-AgentBrowser -SessionName $activeSession -Arguments @('open', $url) | Out-Null
    Invoke-AgentBrowser -SessionName $activeSession -Arguments @('reload') | Out-Null
    Invoke-AgentBrowser -SessionName $activeSession -Arguments @('wait', '750') | Out-Null
    Invoke-AgentBrowser -SessionName $activeSession -Arguments @('screenshot', $screenshotPath) | Out-Null

    $metricsJson = Invoke-AgentBrowser -SessionName $activeSession -Arguments @('eval', $metricsScript)
    $metricsText = ($metricsJson | Out-String).Trim()
    $metrics = $metricsText | ConvertFrom-Json
    if ($metrics -is [string]) {
      $metrics = $metrics | ConvertFrom-Json
    }
    if ($metrics.hasHorizontalOverflow -eq $true) {
      throw "$($state.Name) at $($viewport.Width)x$($viewport.Height) has horizontal overflow."
    }
    if ($state.Name -ne 'home') {
      $expectedBaselineState = if ($state.Name -eq 'waiting-input') { 'waiting' } else { $state.Name }
      if ($metrics.baselineState -ne $expectedBaselineState) {
        throw "$($state.Name) at $($viewport.Width)x$($viewport.Height) rendered state '$($metrics.baselineState)' instead of '$expectedBaselineState'."
      }
      if ($state.Name -eq 'running' -and ([int]$metrics.liveOverlayCount -lt 1 -or [int]$metrics.requestPanelCount -ne 0)) {
        throw "running at $($viewport.Width)x$($viewport.Height) did not render one running owner without a request panel."
      }
      if ($state.Name -eq 'completed' -and ([int]$metrics.liveOverlayCount -ne 0 -or [int]$metrics.requestPanelCount -ne 0)) {
        throw "completed at $($viewport.Width)x$($viewport.Height) retained a live or waiting owner."
      }
      if ($state.Name -eq 'waiting-input' -and ([int]$metrics.liveOverlayCount -ne 0 -or [int]$metrics.requestPanelCount -lt 1)) {
        throw "waiting-input at $($viewport.Width)x$($viewport.Height) did not render a unique request owner."
      }
    }

    $results += [PSCustomObject]@{
      state = $state.Name
      viewport = "$($viewport.Width)x$($viewport.Height)"
      screenshot = $fileName
      url = $metrics.url
      title = $metrics.title
      hasHorizontalOverflow = [bool]$metrics.hasHorizontalOverflow
      alertCount = [int]$metrics.alertCount
      dialogCount = [int]$metrics.dialogCount
      composerCount = [int]$metrics.composerCount
      conversationCount = [int]$metrics.conversationCount
      baselineState = [string]$metrics.baselineState
      liveOverlayCount = [int]$metrics.liveOverlayCount
      requestPanelCount = [int]$metrics.requestPanelCount
    }
  }
}

$manifestName = if ($Scope -eq 'all') { 'manifest.json' } else { "manifest-$Scope.json" }
$manifestPath = Join-Path $resolvedOutput $manifestName
$results | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
$results | Format-Table state, viewport, hasHorizontalOverflow, screenshot -AutoSize
Write-Host "Quiet Workbench baseline captured: $manifestPath"
