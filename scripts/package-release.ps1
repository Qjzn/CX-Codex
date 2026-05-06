[CmdletBinding()]
param(
  [string]$Version = "dev",
  [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"

function Copy-ReleaseItem {
  param(
    [string]$SourcePath,
    [string]$DestinationPath
  )

  $parent = Split-Path -Parent $DestinationPath
  if (-not [string]::IsNullOrWhiteSpace($parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }

  $item = Get-Item -LiteralPath $SourcePath
  if ($item.PSIsContainer) {
    Copy-Item -LiteralPath $SourcePath -Destination $DestinationPath -Recurse -Force
  } else {
    Copy-Item -LiteralPath $SourcePath -Destination $DestinationPath -Force
  }
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

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
  $OutputDir = Join-Path $repoRoot "artifacts"
}

$bundleName = "CX-Codex-$Version"
$stagingRoot = Join-Path $OutputDir $bundleName
$zipPath = Join-Path $OutputDir "$bundleName.zip"
$checksumPath = Join-Path $OutputDir "$bundleName.sha256"

if (Test-Path -LiteralPath $stagingRoot) {
  Remove-Item -LiteralPath $stagingRoot -Recurse -Force
}
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}
if (Test-Path -LiteralPath $checksumPath) {
  Remove-Item -LiteralPath $checksumPath -Force
}

New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null

$releaseItems = @(
  ".github\workflows\ci.yml",
  "LICENSE",
  "README.md",
  "RELEASE.md",
  "cx-codex.config.example.json",
  "docs",
  "index.html",
  "package-lock.json",
  "package.json",
  "scripts",
  "setup.ps1",
  "src",
  "tsconfig.json",
  "tsup.config.ts",
  "vite.config.ts",
  "dist",
  "dist-cli"
)

$optionalReleaseItems = @(
  "components.d.ts",
  "documentation",
  "PROJECT_SPEC.md",
  "public",
  "publish.sh",
  "tests.md",
  "tsconfig.node.json",
  "tsconfig.server.json",
  "vite.config.https.ts"
)

foreach ($relativePath in $releaseItems) {
  $sourcePath = Join-Path $repoRoot $relativePath
  if (-not (Test-Path -LiteralPath $sourcePath)) {
    throw "Missing release asset: $relativePath"
  }
  $destinationPath = Join-Path $stagingRoot $relativePath
  Copy-ReleaseItem -SourcePath $sourcePath -DestinationPath $destinationPath
}

foreach ($relativePath in $optionalReleaseItems) {
  $sourcePath = Join-Path $repoRoot $relativePath
  if (-not (Test-Path -LiteralPath $sourcePath)) {
    continue
  }
  $destinationPath = Join-Path $stagingRoot $relativePath
  Copy-ReleaseItem -SourcePath $sourcePath -DestinationPath $destinationPath
}

Compress-Archive -Path (Join-Path $stagingRoot "*") -DestinationPath $zipPath -Force

$hash = Get-Sha256Hex -Path $zipPath
"$hash  $([System.IO.Path]::GetFileName($zipPath))" | Set-Content -LiteralPath $checksumPath -Encoding ASCII

Write-Host "Release bundle: $zipPath"
Write-Host "Checksum file:  $checksumPath"
