[CmdletBinding()]
param(
  [string]$BaseUrl = "http://127.0.0.1:7420",
  [string]$PublicHealthUrl = "",
  [int]$Port = 7420,
  [string]$ConfigPath = "$env:USERPROFILE\.cx-codex\config.json",
  [switch]$RestartIfUnhealthy,
  [switch]$SkipBrowser,
  [string]$ScreenshotDir = ""
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host "[7420-regression] $Message"
}

function Invoke-Health {
  param(
    [string]$Name,
    [string]$Url,
    [int]$TimeoutSec = 8
  )

  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec
    if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300) {
      throw "$Name returned HTTP $($response.StatusCode)"
    }
    return [PSCustomObject]@{
      name = $Name
      url = $Url
      ok = $true
      statusCode = $response.StatusCode
      message = "ok"
    }
  } catch {
    return [PSCustomObject]@{
      name = $Name
      url = $Url
      ok = $false
      statusCode = 0
      message = $_.Exception.Message
    }
  }
}

function Assert-Health {
  param([object]$Result)
  if (-not $Result.ok) {
    throw "$($Result.name) health failed: $($Result.message) ($($Result.url))"
  }
  Write-Step "$($Result.name) health ok -> $($Result.url)"
}

function Assert-ReplayEndpoint {
  param([string]$Url)

  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 8
    if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300) {
      throw "replay returned HTTP $($response.StatusCode)"
    }
    $payload = $response.Content | ConvertFrom-Json
    if ($null -eq $payload.data -or $null -eq $payload.data.notifications) {
      throw "replay response is missing data.notifications"
    }
    if ($null -eq $payload.data.latestSeq -or $null -eq $payload.data.oldestSeq) {
      throw "replay response is missing sequence bounds"
    }
    Write-Step "event replay ok -> $Url"
  } catch {
    throw "event replay failed: $($_.Exception.Message) ($Url)"
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

function Convert-EvalJson {
  param([object[]]$Output)

  $jsonLine = $Output |
    ForEach-Object { [string]$_ } |
    Where-Object {
      $line = $_.Trim()
      $line.StartsWith("{") -or $line.StartsWith('"')
    } |
    Select-Object -First 1

  if (-not $jsonLine) {
    throw "agent-browser eval did not return JSON. Output:`n$($Output -join "`n")"
  }

  $parsed = $jsonLine | ConvertFrom-Json
  if ($parsed -is [string]) {
    return ($parsed | ConvertFrom-Json)
  }
  return $parsed
}

function Get-PageMetrics {
  param(
    [string]$Session,
    [string]$Name,
    [int]$Width,
    [int]$Height
  )

  Invoke-AgentBrowser -Arguments @("--session", $Session, "set", "viewport", "$Width", "$Height") | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "open", $BaseUrl) | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $Session, "wait", "700") | Out-Null

  $script = @'
JSON.stringify({
  url: location.href,
  width: innerWidth,
  height: innerHeight,
  title: (document.querySelector('h1,[data-testid=thread-title],.content-header-title')?.textContent || document.title || '').trim(),
  hasComposer: !!document.querySelector('textarea,[contenteditable=true],input[type=text]'),
  hasNewThread: document.body.innerText.includes('\u65b0\u4f1a\u8bdd'),
  hasSidebar: !!document.querySelector('.sidebar-root'),
  buttonCount: document.querySelectorAll('button').length,
  overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
  textLength: document.body.innerText.length
})
'@
  $metrics = Convert-EvalJson -Output (Invoke-AgentBrowser -Arguments @("--session", $Session, "eval", $script))
  $metrics | Add-Member -NotePropertyName name -NotePropertyValue $Name

  $rawErrors = Invoke-AgentBrowser -Arguments @("--session", $Session, "errors")
  $errors = @($rawErrors | ForEach-Object { [string]$_ } | Where-Object {
    $line = $_.Trim()
    $line -and -not $line.StartsWith("WARNING:") -and -not $line.Contains("ignore-https-errors ignored")
  })
  $metrics | Add-Member -NotePropertyName pageErrors -NotePropertyValue $errors.Count

  if ($ScreenshotDir) {
    New-Item -ItemType Directory -Force -Path $ScreenshotDir | Out-Null
    $safeName = $Name -replace '[^a-zA-Z0-9_-]', '-'
    Invoke-AgentBrowser -Arguments @("--session", $Session, "screenshot", (Join-Path $ScreenshotDir "$safeName.png")) | Out-Null
  }

  return $metrics
}

function Assert-PageMetrics {
  param([object]$Metrics)

  if (-not $Metrics.hasComposer) {
    throw "$($Metrics.name) regression failed: composer is missing"
  }
  if (-not $Metrics.hasNewThread) {
    throw "$($Metrics.name) regression failed: new thread title/text is missing"
  }
  if ([string]::IsNullOrWhiteSpace([string]$Metrics.title)) {
    throw "$($Metrics.name) regression failed: title is empty"
  }
  if ($Metrics.buttonCount -lt 8) {
    throw "$($Metrics.name) regression failed: too few buttons ($($Metrics.buttonCount))"
  }
  if ($Metrics.overflowX -eq $true) {
    throw "$($Metrics.name) regression failed: document has horizontal overflow"
  }
  if ($Metrics.pageErrors -gt 0) {
    throw "$($Metrics.name) regression failed: browser reported $($Metrics.pageErrors) page error(s)"
  }
  if ($Metrics.name -eq "fold" -and -not $Metrics.hasSidebar) {
    throw "fold regression failed: sidebar is missing in dual-pane viewport"
  }
}

function Assert-ReplayCursorRecovery {
  $session = "cx-codex-reg-replay"
  $cursorKey = "codex-web-local.notification-seq.v1"
  $reloadUrl = "$BaseUrl/?regression=cursor-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
  Invoke-AgentBrowser -Arguments @("--session", $session, "set", "viewport", "390", "844") | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $session, "open", $BaseUrl) | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $session, "wait", "700") | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $session, "eval", "localStorage.setItem('$cursorKey', '999999999'); JSON.stringify({ seeded: true })") | Out-Null
  Invoke-AgentBrowser -Arguments @("--session", $session, "open", $reloadUrl) | Out-Null

  $state = $null
  for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
    Invoke-AgentBrowser -Arguments @("--session", $session, "wait", "500") | Out-Null
    $state = Convert-EvalJson -Output (Invoke-AgentBrowser -Arguments @(
      "--session",
      $session,
      "eval",
      "JSON.stringify({ cursor: localStorage.getItem('$cursorKey') || '', hasComposer: !!document.querySelector('textarea,[contenteditable=true],input[type=text]') })"
    ))
    if ([string]$state.cursor -ne "999999999") {
      break
    }
  }

  if ($state.hasComposer -ne $true) {
    throw "notification cursor recovery failed: composer is missing after reload"
  }
  if ([string]$state.cursor -eq "999999999") {
    throw "notification cursor recovery failed: stale cursor was not reset"
  }
  Write-Step "notification cursor recovery ok"
}

$BaseUrl = $BaseUrl.TrimEnd("/")
$localHealth = Invoke-Health -Name "local" -Url "$BaseUrl/health"

if (-not $localHealth.ok -and $RestartIfUnhealthy) {
  $repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
  $restartScript = Join-Path $repoRoot "scripts\restart-local-service.ps1"
  Write-Step "local health failed, restarting 7420..."
  & $restartScript -Port $Port -ConfigPath $ConfigPath | Out-Null
  Start-Sleep -Seconds 2
  $localHealth = Invoke-Health -Name "local" -Url "$BaseUrl/health"
}

Assert-Health -Result $localHealth
Assert-Health -Result (Invoke-Health -Name "codex-api" -Url "$BaseUrl/codex-api/health")
Assert-ReplayEndpoint -Url "$BaseUrl/codex-api/events/replay?after=0&limit=5"
if (-not [string]::IsNullOrWhiteSpace($PublicHealthUrl)) {
  Assert-Health -Result (Invoke-Health -Name "public" -Url $PublicHealthUrl -TimeoutSec 12)
}

if ($SkipBrowser) {
  Write-Step "browser regression skipped"
  exit 0
}

if (-not (Get-Command agent-browser -ErrorAction SilentlyContinue)) {
  throw "agent-browser is not available in PATH"
}

Assert-ReplayCursorRecovery

$viewports = @(
  [PSCustomObject]@{ name = "desktop"; width = 1440; height = 900 },
  [PSCustomObject]@{ name = "phone"; width = 390; height = 844 },
  [PSCustomObject]@{ name = "fold"; width = 884; height = 1104 }
)

$results = foreach ($viewport in $viewports) {
  Write-Step "checking $($viewport.name) viewport $($viewport.width)x$($viewport.height)"
  $metrics = Get-PageMetrics `
    -Session "cx-codex-reg-$($viewport.name)" `
    -Name $viewport.name `
    -Width $viewport.width `
    -Height $viewport.height
  Assert-PageMetrics -Metrics $metrics
  $metrics
}

$results |
  Select-Object name, width, height, title, hasComposer, hasSidebar, buttonCount, overflowX, pageErrors |
  Format-Table -AutoSize

Write-Step "all checks passed"
