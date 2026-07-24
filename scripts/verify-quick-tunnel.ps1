[CmdletBinding()]
param(
  [int]$Port = 17421,
  [int]$TimeoutSeconds = 160
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$cliPath = Join-Path $repoRoot "dist-cli\index.js"
if (-not (Test-Path -LiteralPath $cliPath)) {
  throw "Built CLI not found. Run npm.cmd run build:cli first."
}
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
  throw "Port $Port is already in use."
}

$nodePath = (Get-Command node -ErrorAction Stop).Source
$testPassword = "smoke-$([Guid]::NewGuid().ToString('N'))"
$outLog = Join-Path $env:TEMP "cx-codex-quick-tunnel-$PID.out.log"
$errLog = Join-Path $env:TEMP "cx-codex-quick-tunnel-$PID.err.log"
$configPath = Join-Path $env:TEMP "cx-codex-quick-tunnel-$PID.config.json"
[System.IO.File]::WriteAllText(
  $configPath,
  ([ordered]@{
    host = "127.0.0.1"
    port = $Port
    password = $testPassword
    tunnel = $false
    open = $false
  } | ConvertTo-Json -Depth 3),
  (New-Object System.Text.UTF8Encoding($false))
)
$serverProcess = Start-Process `
  -FilePath $nodePath `
  -ArgumentList @(
    $cliPath,
    "--config", $configPath,
    "--no-open"
  ) `
  -WorkingDirectory $repoRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog `
  -PassThru

try {
  $deadline = (Get-Date).AddSeconds(35)
  $healthy = $false
  do {
    Start-Sleep -Milliseconds 500
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 3
      $healthy = $health.status -eq "ok"
    } catch {}
  } while (-not $healthy -and (Get-Date) -lt $deadline)
  if (-not $healthy) {
    throw "Isolated CX-Codex server did not become healthy."
  }

  $localSetupStatus = (
    Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/local-setup" -TimeoutSec 5
  ).StatusCode
  $remoteSetupStatus = 0
  try {
    Invoke-WebRequest `
      -UseBasicParsing `
      -Uri "http://127.0.0.1:$Port/local-setup" `
      -Headers @{ Host = "remote-access-check.invalid" } `
      -TimeoutSec 5 | Out-Null
  } catch {
    $remoteSetupStatus = [int]$_.Exception.Response.StatusCode
  }

  $startState = $null
  $startErrorCode = ""
  try {
    $startResponse = Invoke-RestMethod `
      -Method Post `
      -Uri "http://127.0.0.1:$Port/codex-api/tunnel-status/start" `
      -ContentType "application/json" `
      -Body "{}" `
      -TimeoutSec $TimeoutSeconds
    $startState = $startResponse.data
  } catch {
    try {
      $errorPayload = $_.ErrorDetails.Message | ConvertFrom-Json
      $startErrorCode = [string]$errorPayload.code
    } catch {
      $startErrorCode = "REQUEST_FAILED"
    }
  }

  $stopped = $true
  if ($startState -and $startState.active) {
    Invoke-RestMethod `
      -Method Delete `
      -Uri "http://127.0.0.1:$Port/codex-api/tunnel-status" `
      -TimeoutSec 20 | Out-Null
    $stopped = -not (
      Invoke-RestMethod -Uri "http://127.0.0.1:$Port/codex-api/tunnel-status" -TimeoutSec 5
    ).data.active
  }

  [ordered]@{
    health = $healthy
    localSetupStatus = $localSetupStatus
    remoteSetupStatus = $remoteSetupStatus
    tunnelActive = [bool]$startState.active
    phase = if ($startState) { [string]$startState.phase } else { "error" }
    publicUrlReturned = -not [string]::IsNullOrWhiteSpace([string]$startState.publicUrl)
    verification = if ($startState) { $startState.verification } else { $null }
    errorCode = $startErrorCode
    stopped = $stopped
  } | ConvertTo-Json -Depth 5
} finally {
  if (-not $serverProcess.HasExited) {
    Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
    $serverProcess.WaitForExit(5000) | Out-Null
  }
  Start-Sleep -Milliseconds 600
  $orphanCount = @(
    Get-CimInstance Win32_Process `
      -Filter "ParentProcessId = $($serverProcess.Id)" `
      -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -like "cloudflared*" }
  ).Count
  Write-Output "orphanCloudflared=$orphanCount"
  Remove-Item -LiteralPath $outLog -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $errLog -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $configPath -Force -ErrorAction SilentlyContinue
}
