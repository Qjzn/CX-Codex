[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$OutputDir
)

$ErrorActionPreference = "Stop"

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

function Assert-ChecksumFile {
  param(
    [string]$ChecksumPath
  )

  $checksumLine = Get-Content -LiteralPath $ChecksumPath -TotalCount 1
  if ([string]::IsNullOrWhiteSpace($checksumLine)) {
    throw "Checksum file is empty: $ChecksumPath"
  }

  $match = [regex]::Match($checksumLine.Trim(), "^(?<hash>[0-9a-fA-F]{64})\s+\*?(?<file>.+)$")
  if (-not $match.Success) {
    throw "Checksum file has unexpected format: $ChecksumPath"
  }

  $checksumHash = $match.Groups["hash"].Value.ToLowerInvariant()
  $artifactFileName = $match.Groups["file"].Value.Trim()
  if ([string]::IsNullOrWhiteSpace($artifactFileName) -or
      $artifactFileName.Contains("/") -or
      $artifactFileName.Contains("\")) {
    throw "Checksum file must reference an artifact file name only: $ChecksumPath"
  }

  $artifactPath = Join-Path (Split-Path -Parent $ChecksumPath) $artifactFileName
  if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) {
    throw "Checksum target is missing: $artifactFileName"
  }

  $actualHash = Get-Sha256Hex -Path $artifactPath
  if ($checksumHash -ne $actualHash) {
    throw "Checksum hash does not match artifact: $artifactFileName"
  }

  Write-Host "checksum ok: $artifactFileName"
}

$resolvedOutputDir = (Resolve-Path -LiteralPath $OutputDir).Path
$checksumFiles = @(Get-ChildItem -LiteralPath $resolvedOutputDir -Filter "*.sha256" -File)
if ($checksumFiles.Count -eq 0) {
  throw "No .sha256 files found in $resolvedOutputDir"
}

foreach ($checksumFile in $checksumFiles) {
  Assert-ChecksumFile -ChecksumPath $checksumFile.FullName
}

Write-Host "Release artifact checksum verification passed."
