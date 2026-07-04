[CmdletBinding()]
param(
  [ValidateSet("skip", "warn", "strict")]
  [string]$SchemaAudit = "warn",
  [switch]$SkipBuild,
  [switch]$SkipCliSmoke,
  [switch]$SkipPackageSmoke,
  [switch]$SkipGovernance,
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

function Initialize-NpmVerificationEnvironment {
  $npmCacheDir = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "output/npm-cache"))
  $outputRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "output"))
  $outputPrefix = $outputRoot.TrimEnd([char[]]@(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
  )) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $npmCacheDir.StartsWith($outputPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "NPM verification cache escaped repository output directory: $npmCacheDir"
  }
  New-Item -ItemType Directory -Path $npmCacheDir -Force | Out-Null
  $env:npm_config_cache = $npmCacheDir
  $env:npm_config_update_notifier = "false"
  $env:npm_config_fund = "false"
  $env:npm_config_audit = "false"
}

function Get-PowerShellCommand {
  $preferred = $env:CX_CODEX_POWERSHELL_COMMAND
  if (-not [string]::IsNullOrWhiteSpace($preferred)) {
    $preferredCommand = Get-Command $preferred -ErrorAction SilentlyContinue
    if ($preferredCommand) {
      return $preferredCommand.Source
    }
  }

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

function Get-Sha256Hex {
  param(
    [string]$Path
  )

  $fileHashCommand = Get-Command Get-FileHash -ErrorAction SilentlyContinue
  if ($null -ne $fileHashCommand) {
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
  }

  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
      $bytes = $sha256.ComputeHash($stream)
      return ([BitConverter]::ToString($bytes) -replace "-", "").ToLowerInvariant()
    } finally {
      $sha256.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

function Resolve-ReleasePackageSmokeDir {
  $outputRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "output"))
  $smokeDir = [System.IO.Path]::GetFullPath((Join-Path $outputRoot "release-package-smoke"))
  $outputPrefix = $outputRoot.TrimEnd([char[]]@(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
  )) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $smokeDir.StartsWith($outputPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Release package smoke output escaped repository output directory: $smokeDir"
  }
  return $smokeDir
}

function Assert-ChecksumMatches {
  param(
    [string]$ZipPath,
    [string]$ChecksumPath
  )

  if (-not (Test-Path -LiteralPath $ChecksumPath -PathType Leaf)) {
    throw "Release package smoke failed: missing $ChecksumPath"
  }

  $expectedFileName = [System.IO.Path]::GetFileName($ZipPath)
  $checksumLine = (Get-Content -LiteralPath $ChecksumPath -TotalCount 1)
  if ([string]::IsNullOrWhiteSpace($checksumLine)) {
    throw "Release package smoke failed: checksum file is empty"
  }

  $match = [regex]::Match($checksumLine.Trim(), "^(?<hash>[0-9a-fA-F]{64})\s+\*?(?<file>.+)$")
  if (-not $match.Success) {
    throw "Release package smoke failed: checksum file has unexpected format"
  }

  $actualHash = Get-Sha256Hex -Path $ZipPath
  $checksumHash = $match.Groups["hash"].Value.ToLowerInvariant()
  $checksumFileName = $match.Groups["file"].Value.Trim()
  if ($checksumHash -ne $actualHash) {
    throw "Release package smoke failed: checksum hash does not match zip"
  }
  if ($checksumFileName -ne $expectedFileName) {
    throw "Release package smoke failed: checksum file name '$checksumFileName' does not match '$expectedFileName'"
  }
}

function Assert-ZipContains {
  param(
    [string]$ZipPath,
    [string[]]$RequiredEntries
  )

  if (-not (Test-Path -LiteralPath $ZipPath -PathType Leaf)) {
    throw "Release package smoke failed: missing $ZipPath"
  }

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
  try {
    $entries = $archive.Entries | ForEach-Object { $_.FullName -replace '/', '\' }
    foreach ($entry in $RequiredEntries) {
      if ($entries -notcontains $entry) {
        throw "Release package smoke failed: zip is missing $entry"
      }
    }
  } finally {
    $archive.Dispose()
  }
}

function Assert-NpmPackDryRun {
  param(
    [string]$NpmCommand,
    [string[]]$RequiredEntries,
    [string[]]$ForbiddenEntries = @()
  )

  $packOutput = & $NpmCommand @("pack", "--dry-run", "--json")
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    throw "NPM package smoke failed: npm pack dry-run exited with code $exitCode"
  }

  $packOutputLines = @($packOutput | ForEach-Object { "$_" })
  $jsonStartIndex = -1
  for ($i = 0; $i -lt $packOutputLines.Count; $i++) {
    $line = $packOutputLines[$i].TrimStart()
    if ($line.StartsWith("[") -or $line.StartsWith("{")) {
      $jsonStartIndex = $i
      break
    }
  }
  if ($jsonStartIndex -lt 0) {
    throw "NPM package smoke failed: npm pack dry-run returned no JSON payload"
  }

  $packJson = ($packOutputLines[$jsonStartIndex..($packOutputLines.Count - 1)] -join "`n").Trim()
  if ([string]::IsNullOrWhiteSpace($packJson)) {
    throw "NPM package smoke failed: npm pack dry-run returned no JSON"
  }

  $packEntries = @($packJson | ConvertFrom-Json)
  if ($packEntries.Count -lt 1 -or -not $packEntries[0].files) {
    throw "NPM package smoke failed: npm pack dry-run JSON has no files list"
  }

  $files = @($packEntries[0].files | ForEach-Object { $_.path -replace '/', '\' })
  foreach ($entry in $RequiredEntries) {
    if ($files -notcontains $entry) {
      throw "NPM package smoke failed: package is missing $entry"
    }
  }
  foreach ($entry in $ForbiddenEntries) {
    if ($files -contains $entry) {
      throw "NPM package smoke failed: package must not include $entry"
    }
  }
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

if (-not $SkipGovernance) {
  $powerShellCommand = Get-PowerShellCommand
  Invoke-CheckedCommand -Label "Governance docs check" -Command $powerShellCommand -Arguments @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $repoRoot "scripts/verify-governance.ps1"))
} else {
  Write-Host ""
  Write-Host "==> Governance docs check skipped"
}

$npmCommand = Get-NpmCommand
Initialize-NpmVerificationEnvironment

if (-not $SkipBuild) {
  Invoke-CheckedCommand -Label "Build frontend and CLI" -Command $npmCommand -Arguments @("run", "build")
} else {
  Write-Host ""
  Write-Host "==> Build skipped"
}

Invoke-CheckedCommand -Label "Server module smoke" -Command "node" -Arguments @((Join-Path $repoRoot "scripts/verify-server-modules.mjs"))

if (-not $SkipCliSmoke) {
  $cliEntry = Join-Path $repoRoot "dist-cli/index.js"
  if (-not (Test-Path -LiteralPath $cliEntry)) {
    throw "CLI smoke failed: missing $cliEntry. Run without -SkipBuild or build first."
  }
  Invoke-CheckedCommand -Label "CLI smoke" -Command "node" -Arguments @($cliEntry, "--help")

  $cliCjsLauncherSmoke = @"
const { spawnSync } = require('node:child_process');
const cliEntry = process.argv[1];
const result = spawnSync(process.execPath, [cliEntry, '--help'], { encoding: 'utf8' });
if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  throw new Error(result.stderr || result.stdout || 'CLI CJS launcher smoke failed');
}
if (!result.stdout.includes('CX-Codex Web bridge for Codex app-server')) {
  throw new Error('Unexpected CLI help output');
}
console.log('cli cjs launcher smoke ok');
"@
  Invoke-CheckedCommand -Label "CLI CJS launcher smoke" -Command "node" -Arguments @("-e", $cliCjsLauncherSmoke, $cliEntry)
} else {
  Write-Host ""
  Write-Host "==> CLI smoke skipped"
}

if (-not $SkipPackageSmoke) {
  $powerShellCommand = Get-PowerShellCommand
  $packageSmokeDir = Resolve-ReleasePackageSmokeDir
  $packageVersion = "verify-smoke"
  if (Test-Path -LiteralPath $packageSmokeDir) {
    Remove-Item -LiteralPath $packageSmokeDir -Recurse -Force
  }
  New-Item -ItemType Directory -Path $packageSmokeDir -Force | Out-Null

  Invoke-CheckedCommand -Label "Release package smoke" -Command $powerShellCommand -Arguments @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    (Join-Path $repoRoot "scripts/package-release.ps1"),
    "-Version",
    $packageVersion,
    "-OutputDir",
    $packageSmokeDir
  )

  $bundleName = "CX-Codex-$packageVersion"
  $zipPath = Join-Path $packageSmokeDir "$bundleName.zip"
  $checksumPath = Join-Path $packageSmokeDir "$bundleName.sha256"
  Assert-ChecksumMatches -ZipPath $zipPath -ChecksumPath $checksumPath
  Invoke-CheckedCommand -Label "Release artifact checksum smoke" -Command $powerShellCommand -Arguments @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    (Join-Path $repoRoot "scripts/verify-release-artifacts.ps1"),
    "-OutputDir",
    $packageSmokeDir
  )

  Assert-ZipContains -ZipPath $zipPath -RequiredEntries @(
    "README.md",
    "RELEASE.md",
    "CODE_OF_CONDUCT.md",
    "SECURITY.md",
    "SUPPORT.md",
    "CONTRIBUTING.md",
    "tests.md",
    "docs\app-server-schema-audit-summary.json",
    "docs\app-server-protocol-matrix.zh-CN.md",
    "docs\changelog.zh-CN.md",
    "docs\dependency-maintenance.zh-CN.md",
    "docs\openai-docs-review.zh-CN.md",
    "docs\operations-plan.zh-CN.md",
    "docs\protocol-compatibility.zh-CN.md",
    "docs\roadmap.zh-CN.md",
    "docs\security-hardening.zh-CN.md",
    "scripts\package-release.ps1",
    "scripts\verify-governance.ps1",
    "scripts\verify-release.ps1",
    ".github\dependabot.yml",
    ".github\release-body.md",
    ".github\PULL_REQUEST_TEMPLATE.md",
    ".github\ISSUE_TEMPLATE\protocol_compatibility.yml",
    ".github\workflows\release.yml",
    "dist\index.html",
    "dist-cli\index.js",
    "src\server\appServerLocalRuntimeSnapshot.ts",
    "src\server\appServerRpcTimeoutRecovery.ts",
    "src\server\appServerRuntimeInterrupt.ts",
    "src\server\appServerRuntimeStart.ts",
    "src\server\appServerNotificationRuntimeSync.ts",
    "src\server\appServerRuntimeSnapshotPersistence.ts",
    "src\server\appServerNotificationState.ts",
    "src\server\appServerRuntimeReconcileScheduler.ts",
    "src\server\appServerThreadRuntimeSnapshot.ts",
    "src\server\codexAppServerBridge.ts",
    "src\server\composerFileSearchRoutes.ts",
    "src\server\diagnosticsRoutes.ts",
    "src\server\fileUploadRoute.ts",
    "src\server\githubTrendingRoutes.ts",
    "src\server\localStateRoutes.ts",
    "src\server\notificationReplayRoute.ts",
    "src\server\notificationSseRoute.ts",
    "src\server\projectRootRoutes.ts",
    "src\server\rpcProxyRoute.ts",
    "src\server\runtimeActionRoutes.ts",
    "src\server\runtimeStateRoutes.ts",
    "src\server\serverRequestRoutes.ts",
    "src\server\statusRoutes.ts",
    "src\server\threadRoutes.ts",
    "src\server\transcriptionRoute.ts",
    "src\server\worktreeRoutes.ts",
    "src\server\workspaceMetaRoutes.ts"
  )
  Write-Host "release package smoke ok"

  Write-Host ""
  Write-Host "==> NPM package smoke"
  Assert-NpmPackDryRun -NpmCommand $npmCommand -RequiredEntries @(
    "package.json",
    "README.md",
    "LICENSE",
    "dist\index.html",
    "dist-cli\index.js",
    "docs\app-server-schema-audit-summary.json"
  ) -ForbiddenEntries @(
    "src\server\codexAppServerBridge.ts",
    "scripts\verify-release.ps1",
    "tests.md"
  )
  Write-Host "npm package smoke ok"
} else {
  Write-Host ""
  Write-Host "==> Release package smoke skipped"
  Write-Host "==> Release artifact checksum smoke skipped"
  Write-Host "==> NPM package smoke skipped"
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
