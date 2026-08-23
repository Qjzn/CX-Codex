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

function Get-ArtifactChecksumCandidates {
  param(
    [System.IO.FileInfo]$Artifact
  )

  return @(
    "$($Artifact.FullName).sha256",
    (Join-Path $Artifact.DirectoryName "$($Artifact.BaseName).sha256")
  ) | Select-Object -Unique
}

function Assert-ArtifactHasChecksum {
  param(
    [System.IO.FileInfo]$Artifact
  )

  $candidatePaths = @(Get-ArtifactChecksumCandidates -Artifact $Artifact)
  foreach ($candidatePath in $candidatePaths) {
    if (Test-Path -LiteralPath $candidatePath -PathType Leaf) {
      return
    }
  }

  throw "Release artifact is missing checksum: $($Artifact.Name)"
}

function Assert-ZipContainsRuntimeContract {
  param(
    [System.IO.FileInfo]$Artifact
  )

  $archive = [System.IO.Compression.ZipFile]::OpenRead($Artifact.FullName)
  try {
    $entryNames = [System.Collections.Generic.HashSet[string]]::new(
      [System.StringComparer]::Ordinal
    )
    foreach ($entry in $archive.Entries) {
      $normalizedName = $entry.FullName.Replace("\", "/").TrimStart([char]"/")
      [void]$entryNames.Add($normalizedName)
    }

    $requiredEntries = @(
      "package.json",
      "vite.config.ts",
      "vite.local-preview.config.ts"
    )
    foreach ($requiredEntry in $requiredEntries) {
      if (-not $entryNames.Contains($requiredEntry)) {
        throw "Release zip is missing required entry: $requiredEntry ($($Artifact.Name))"
      }
    }

    $packageEntry = $archive.GetEntry("package.json")
    $packageStream = $packageEntry.Open()
    try {
      $reader = [System.IO.StreamReader]::new(
        $packageStream,
        [System.Text.UTF8Encoding]::new($false, $true),
        $true
      )
      try {
        $packageManifest = $reader.ReadToEnd() | ConvertFrom-Json
      } finally {
        $reader.Dispose()
      }
    } finally {
      $packageStream.Dispose()
    }

    foreach ($packageFile in @($packageManifest.files)) {
      $normalizedPackageFile = ([string]$packageFile).Replace("\", "/").TrimStart([char]"/")
      if ([string]::IsNullOrWhiteSpace($normalizedPackageFile)) {
        throw "Release zip package.json contains an empty files entry: $($Artifact.Name)"
      }
      if ($normalizedPackageFile.EndsWith("/", [System.StringComparison]::Ordinal)) {
        $hasDirectoryContent = $false
        foreach ($entryName in $entryNames) {
          if ($entryName.StartsWith($normalizedPackageFile, [System.StringComparison]::Ordinal)) {
            $hasDirectoryContent = $true
            break
          }
        }
        if (-not $hasDirectoryContent) {
          throw "Release zip is missing npm package directory: $normalizedPackageFile ($($Artifact.Name))"
        }
      } elseif (-not $entryNames.Contains($normalizedPackageFile)) {
        throw "Release zip is missing npm package entry: $normalizedPackageFile ($($Artifact.Name))"
      }
    }
  } finally {
    $archive.Dispose()
  }

  Write-Host "zip runtime contract ok: $($Artifact.Name)"
}

$resolvedOutputDir = (Resolve-Path -LiteralPath $OutputDir).Path
$releaseArtifacts = @(Get-ChildItem -LiteralPath $resolvedOutputDir -File | Where-Object {
  $_.Extension -in @(".zip", ".apk")
})
if ($releaseArtifacts.Count -eq 0) {
  throw "No release .zip or .apk artifacts found in $resolvedOutputDir"
}

Add-Type -AssemblyName System.IO.Compression.FileSystem

foreach ($artifact in $releaseArtifacts) {
  Assert-ArtifactHasChecksum -Artifact $artifact
  if ($artifact.Extension -eq ".zip") {
    Assert-ZipContainsRuntimeContract -Artifact $artifact
  }
}

$checksumFiles = @(Get-ChildItem -LiteralPath $resolvedOutputDir -Filter "*.sha256" -File)
if ($checksumFiles.Count -eq 0) {
  throw "No .sha256 files found in $resolvedOutputDir"
}

foreach ($checksumFile in $checksumFiles) {
  Assert-ChecksumFile -ChecksumPath $checksumFile.FullName
}

Write-Host "Release artifact checksum verification passed."
