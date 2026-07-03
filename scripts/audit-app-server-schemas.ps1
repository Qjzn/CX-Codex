param(
  [string]$OutputRoot = "output/app-server-schema-audit",
  [switch]$FullDiff,
  [switch]$SkipGenerate
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

$baselineTs = Join-Path $repoRoot "documentation/app-server-schemas/typescript"
$baselineJson = Join-Path $repoRoot "documentation/app-server-schemas/json"

if (-not (Test-Path -LiteralPath $baselineTs)) {
  throw "Missing baseline TypeScript schema directory: $baselineTs"
}

if (-not (Test-Path -LiteralPath $baselineJson)) {
  throw "Missing baseline JSON schema directory: $baselineJson"
}

$outputBase = Join-Path $repoRoot $OutputRoot
New-Item -ItemType Directory -Force -Path $outputBase | Out-Null

$auditRoot = Join-Path $outputBase (Get-Date -Format "yyyyMMdd-HHmmss")
$auditTs = Join-Path $auditRoot "typescript"
$auditJson = Join-Path $auditRoot "json"
New-Item -ItemType Directory -Force -Path $auditTs, $auditJson | Out-Null

$codexCommand = if ($env:CX_CODEX_CODEX_COMMAND) {
  $env:CX_CODEX_CODEX_COMMAND
} elseif ($env:CODEXUI_CODEX_COMMAND) {
  $env:CODEXUI_CODEX_COMMAND
} else {
  "codex"
}

Write-Host "App Server schema audit"
Write-Host "Repository: $repoRoot"
Write-Host "Output:     $auditRoot"
Write-Host "Codex CLI:  $codexCommand"

if (-not $SkipGenerate) {
  Write-Host ""
  Write-Host "Generating TypeScript schema..."
  & $codexCommand app-server generate-ts --out $auditTs
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }

  Write-Host "Generating JSON schema..."
  & $codexCommand app-server generate-json-schema --out $auditJson
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
} else {
  Write-Host ""
  Write-Host "SkipGenerate enabled. Empty audit directories were created for command validation only."
  Write-Host "To perform a real audit, rerun without -SkipGenerate."
  exit 0
}

function Get-FileBaseNames {
  param(
    [string]$Path
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return @()
  }

  return @(
    Get-ChildItem -LiteralPath $Path -File |
      ForEach-Object { $_.BaseName } |
      Sort-Object -Unique
  )
}

function Compare-NameSets {
  param(
    [string[]]$Baseline,
    [string[]]$Generated
  )

  $baselineSet = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
  foreach ($name in $Baseline) {
    [void]$baselineSet.Add($name)
  }

  $generatedSet = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
  foreach ($name in $Generated) {
    [void]$generatedSet.Add($name)
  }

  $added = @(
    foreach ($name in $Generated) {
      if (-not $baselineSet.Contains($name)) { $name }
    }
  )
  $removed = @(
    foreach ($name in $Baseline) {
      if (-not $generatedSet.Contains($name)) { $name }
    }
  )

  return [ordered]@{
    baselineCount = $Baseline.Count
    generatedCount = $Generated.Count
    addedCount = $added.Count
    removedCount = $removed.Count
    added = $added
    removed = $removed
  }
}

function Write-AuditSummary {
  $baselineTsRootNames = Get-FileBaseNames -Path $baselineTs
  $generatedTsRootNames = Get-FileBaseNames -Path $auditTs
  $baselineTsV2Names = Get-FileBaseNames -Path (Join-Path $baselineTs "v2")
  $generatedTsV2Names = Get-FileBaseNames -Path (Join-Path $auditTs "v2")
  $baselineJsonRootNames = Get-FileBaseNames -Path $baselineJson
  $generatedJsonRootNames = Get-FileBaseNames -Path $auditJson
  $baselineJsonV2Names = Get-FileBaseNames -Path (Join-Path $baselineJson "v2")
  $generatedJsonV2Names = Get-FileBaseNames -Path (Join-Path $auditJson "v2")

  $summary = [ordered]@{
    generatedAtIso = (Get-Date).ToUniversalTime().ToString("o")
    codexCommand = $codexCommand
    repository = $repoRoot
    auditRoot = $auditRoot
    baseline = [ordered]@{
      typescript = $baselineTs
      json = $baselineJson
    }
    generated = [ordered]@{
      typescript = $auditTs
      json = $auditJson
    }
    comparison = [ordered]@{
      typescriptRoot = Compare-NameSets -Baseline $baselineTsRootNames -Generated $generatedTsRootNames
      typescriptV2 = Compare-NameSets -Baseline $baselineTsV2Names -Generated $generatedTsV2Names
      jsonRoot = Compare-NameSets -Baseline $baselineJsonRootNames -Generated $generatedJsonRootNames
      jsonV2 = Compare-NameSets -Baseline $baselineJsonV2Names -Generated $generatedJsonV2Names
    }
  }

  $summaryPath = Join-Path $auditRoot "audit-summary.json"
  $summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $summaryPath -Encoding UTF8
  Write-Host ""
  Write-Host "Audit summary: $summaryPath"
}

Write-AuditSummary

$hasDiff = $false

function Compare-SchemaDirectory {
  param(
    [string]$Label,
    [string]$Baseline,
    [string]$Generated
  )

  Write-Host ""
  Write-Host "Comparing $Label..."

  if ($FullDiff) {
    $diffOutput = & git diff --no-index -- $Baseline $Generated 2>&1
  } else {
    $diffOutput = & git diff --no-index --stat -- $Baseline $Generated 2>&1
  }

  $diffExit = $LASTEXITCODE
  if ($diffOutput) {
    $diffOutput | ForEach-Object { Write-Host $_ }
  }

  if ($diffExit -eq 0) {
    Write-Host "$Label matches baseline."
    return $false
  }

  if ($diffExit -eq 1) {
    Write-Warning "$Label differs from baseline. Review the generated audit output before release."
    return $true
  }

  throw "git diff failed for $Label with exit code $diffExit"
}

$hasDiff = (Compare-SchemaDirectory -Label "TypeScript schemas" -Baseline $baselineTs -Generated $auditTs) -or $hasDiff
$hasDiff = (Compare-SchemaDirectory -Label "JSON schemas" -Baseline $baselineJson -Generated $auditJson) -or $hasDiff

Write-Host ""
Write-Host "Audit output: $auditRoot"

if ($hasDiff) {
  Write-Warning "Schema differences found. Exit code 1 means review is required, not that generation failed."
  exit 1
}

Write-Host "No schema differences found."
exit 0
