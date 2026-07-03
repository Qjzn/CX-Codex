[CmdletBinding()]
param(
  [ValidateSet("skip", "warn", "strict")]
  [string]$SchemaAudit = "warn",
  [switch]$SkipBuild,
  [switch]$SkipCliSmoke,
  [switch]$RequireCleanGit,
  [switch]$AllowDirty
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

function Invoke-CheckedCommand {
  param(
    [string]$Label,
    [string]$Command,
    [string[]]$Arguments = @()
  )

  Write-Host ""
  Write-Host "==> $Label"
  & $Command @Arguments
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    throw "$Label failed with exit code $exitCode"
  }
}

function Invoke-NodeInline {
  param(
    [string]$Label,
    [string]$Script
  )

  Invoke-CheckedCommand -Label $Label -Command "node" -Arguments @("-e", $Script)
}

function Get-LatestSchemaAuditSummaryPath {
  $auditRoot = Join-Path $repoRoot "output/app-server-schema-audit"
  if (-not (Test-Path -LiteralPath $auditRoot)) {
    return ""
  }

  $latest = Get-ChildItem -LiteralPath $auditRoot -Directory |
    Sort-Object Name -Descending |
    Select-Object -First 1
  if (-not $latest) {
    return ""
  }

  $summaryPath = Join-Path $latest.FullName "audit-summary.json"
  if (Test-Path -LiteralPath $summaryPath) {
    return $summaryPath
  }

  return ""
}

function Get-NpmCommand {
  if ([System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::Windows)) {
    return "npm.cmd"
  }
  return "npm"
}

function Get-PowerShellCommand {
  $pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
  if ($pwsh) {
    return $pwsh.Source
  }

  $windowsPowerShell = Get-Command powershell -ErrorAction SilentlyContinue
  if ($windowsPowerShell) {
    return $windowsPowerShell.Source
  }

  throw "PowerShell executable not found"
}

Write-Host "CX-Codex release verification"
Write-Host "Repository:  $repoRoot"
Write-Host "SchemaAudit: $SchemaAudit"

if ($RequireCleanGit -and -not $AllowDirty) {
  Write-Host ""
  Write-Host "==> Check clean Git status"
  $gitStatus = (& git status --porcelain)
  if ($LASTEXITCODE -ne 0) {
    throw "git status failed with exit code $LASTEXITCODE"
  }
  if ($gitStatus) {
    $gitStatus | ForEach-Object { Write-Host $_ }
    throw "Git status is not clean. Commit, stash, or remove changes before release verification."
  }
}

Invoke-CheckedCommand -Label "Whitespace check" -Command "git" -Arguments @("diff", "--check")
Invoke-NodeInline -Label "package.json parse check" -Script "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json ok')"

$npmCommand = Get-NpmCommand

if (-not $SkipBuild) {
  Invoke-CheckedCommand -Label "Build frontend and CLI" -Command $npmCommand -Arguments @("run", "build")
} else {
  Write-Host ""
  Write-Host "==> Build skipped"
}

if (-not $SkipCliSmoke) {
  $cliEntry = Join-Path $repoRoot "dist-cli/index.js"
  if (-not (Test-Path -LiteralPath $cliEntry)) {
    throw "CLI smoke failed: missing $cliEntry. Run without -SkipBuild or build first."
  }
  Invoke-CheckedCommand -Label "CLI smoke" -Command "node" -Arguments @($cliEntry, "--help")
} else {
  Write-Host ""
  Write-Host "==> CLI smoke skipped"
}

if ($SchemaAudit -ne "skip") {
  Write-Host ""
  Write-Host "==> App Server schema audit ($SchemaAudit)"
  $powerShellCommand = Get-PowerShellCommand
  & $powerShellCommand -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repoRoot "scripts/audit-app-server-schemas.ps1")
  $auditExitCode = $LASTEXITCODE
  $summaryPath = Get-LatestSchemaAuditSummaryPath
  if ($summaryPath) {
    Write-Host "Schema audit summary: $summaryPath"
  }

  if ($auditExitCode -eq 0) {
    Write-Host "Schema audit matched the committed baseline."
  } elseif ($auditExitCode -eq 1 -and $SchemaAudit -eq "warn") {
    Write-Warning "Schema audit found drift. This is allowed in warn mode, but must be reviewed before release."
  } else {
    throw "Schema audit failed with exit code $auditExitCode"
  }
} else {
  Write-Host ""
  Write-Host "==> App Server schema audit skipped"
}

Write-Host ""
Write-Host "Release verification completed."
