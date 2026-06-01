[CmdletBinding()]
param(
  [string]$BaseUrl = "http://127.0.0.1:7420",
  [string]$ThreadId = "",
  [int]$DesktopWidth = 1440,
  [int]$DesktopHeight = 900,
  [int]$PhoneWidth = 393,
  [int]$PhoneHeight = 852
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

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & agent-browser @Arguments 2>&1
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
      throw "agent-browser $($Arguments -join ' ') failed with exit code $exitCode`n$($output -join "`n")"
    }
    return @($output)
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
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
  $jsonLine = $output |
    ForEach-Object { [string]$_ } |
    Where-Object {
      $line = $_.Trim()
      $line.StartsWith("{") -or $line.StartsWith('"')
    } |
    Select-Object -First 1

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
    text: text.slice(0, 800),
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
