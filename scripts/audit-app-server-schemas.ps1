param(
  [string]$OutputRoot = "output/app-server-schema-audit",
  [switch]$FullDiff,
  [switch]$SkipGenerate,
  [string]$CodexCommand = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

$baselineTs = Join-Path $repoRoot "documentation/app-server-schemas/typescript"
$baselineJson = Join-Path $repoRoot "documentation/app-server-schemas/json"

# Output directories are created before any check or child process so that every later failure
# (missing baseline, unresolved target, hash or spawn error, generation failure) can still write its
# raw summary where the output directory exists.
$outputBase = Join-Path $repoRoot $OutputRoot
New-Item -ItemType Directory -Force -Path $outputBase | Out-Null

$auditRoot = Join-Path $outputBase (Get-Date -Format "yyyyMMdd-HHmmss")
$auditTs = Join-Path $auditRoot "typescript"
$auditJson = Join-Path $auditRoot "json"
New-Item -ItemType Directory -Force -Path $auditTs, $auditJson | Out-Null

$summaryPath = Join-Path $auditRoot "audit-summary.json"

# --- raw provenance state, filled in as the audit progresses ----------------

$targetCommand = "codex"
$selectionSource = "path"
$targetPath = $null
$identityKind = "unknown"
$versionRaw = $null
$fingerprintAnchor = $null
$sha256Before = $null
$sha256After = $null
$verificationStatus = "unverified"
$verificationReason = ""
$generationStatus = "incomplete"
$failedPhase = $null
$firstFailureExitCode = $null
$currentPhase = "init"
$versionTimeoutMs = 15000
$generationTimeoutMs = 300000
$comparison = $null
$contentDiffStatus = "incomplete"
$contentDiffTs = [ordered]@{ status = "unknown"; exitCode = $null; error = $null }
$contentDiffJson = [ordered]@{ status = "unknown"; exitCode = $null; error = $null }

# Raw per-stage child records. `null` means the stage never ran. An executed child always carries its
# real integer exit code, or `null` plus an explanatory error when spawn/timeout produced no exit.
$stages = [ordered]@{
  version = $null
  typescript = $null
  json = $null
}

# --- helpers ---------------------------------------------------------------

function Select-CodexTarget {
  param([string]$Explicit)

  if ($Explicit -and $Explicit.Trim().Length -gt 0) {
    return [pscustomobject]@{ Command = $Explicit.Trim(); Source = "explicit" }
  }
  if ($env:CX_CODEX_CODEX_COMMAND -and $env:CX_CODEX_CODEX_COMMAND.Trim().Length -gt 0) {
    return [pscustomobject]@{ Command = $env:CX_CODEX_CODEX_COMMAND.Trim(); Source = "env" }
  }
  if ($env:CODEXUI_CODEX_COMMAND -and $env:CODEXUI_CODEX_COMMAND.Trim().Length -gt 0) {
    return [pscustomobject]@{ Command = $env:CODEXUI_CODEX_COMMAND.Trim(); Source = "env" }
  }
  return [pscustomobject]@{ Command = "codex"; Source = "path" }
}

# Turns the chosen command into one frozen absolute target. A relative or absolute path is made
# absolute in place; a bare name resolves to the first real PATH hit. It never falls back to a
# "latest installed" guess: an unresolvable target returns $null and the audit stops.
function Resolve-AbsoluteTarget {
  param([string]$Command)

  $trimmed = $Command.Trim()
  if ([string]::IsNullOrWhiteSpace($trimmed)) {
    return $null
  }

  if ([System.IO.Path]::IsPathRooted($trimmed)) {
    try { return [System.IO.Path]::GetFullPath($trimmed) } catch { return $null }
  }

  if ($trimmed -match "[\\/]") {
    try { return [System.IO.Path]::GetFullPath((Join-Path $repoRoot $trimmed)) } catch { return $null }
  }

  $found = Get-Command -Name $trimmed -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found -and $found.Source) {
    try { return [System.IO.Path]::GetFullPath($found.Source) } catch { return $null }
  }
  return $null
}

# Only `.exe`/`.com` are native and only `.cmd`/`.bat` are launched through cmd.exe. Everything else
# - including `.ps1`, `.js`, `.sh` and extensionless files - is `unknown`, and the audit fails closed
# instead of pretending it is native or feeding a script to cmd.
function Get-LaunchIdentityKind {
  param([string]$Path)

  $extension = [System.IO.Path]::GetExtension($Path)
  if (-not [string]::IsNullOrEmpty($extension)) {
    $extension = $extension.ToLowerInvariant()
  }

  if ($extension -eq ".exe" -or $extension -eq ".com") { return "native" }
  if ($extension -eq ".cmd" -or $extension -eq ".bat") { return "launcher" }
  return "unknown"
}

function Test-IsHex64 {
  param([string]$Value)

  if ([string]::IsNullOrEmpty($Value)) { return $false }
  return ($Value -match '^[0-9a-fA-F]{64}$')
}

# Case-insensitive comparison of two legal 64-hex SHA256 fingerprints. Anything that is not a legal
# 64-hex string (missing, truncated, non-hex) can never count as "unchanged".
function Test-SameFingerprint {
  param([string]$Left, [string]$Right)

  if (-not (Test-IsHex64 $Left) -or -not (Test-IsHex64 $Right)) { return $false }
  return [string]::Equals($Left, $Right, [System.StringComparison]::OrdinalIgnoreCase)
}

function Get-TargetFingerprint {
  param([string]$Path)

  try {
    $hash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
  } catch {
    return $null
  }
  if (-not (Test-IsHex64 $hash)) { return $null }
  return $hash
}

function Format-NativeArgument {
  param([string]$Value)

  if ([string]::IsNullOrEmpty($Value)) { return '""' }
  if ($Value -match '[ \t"]') {
    return '"' + ($Value -replace '"', '\"') + '"'
  }
  return $Value
}

# Builds the launch pair for one phase from the frozen absolute target. `launcher` is the only kind
# that goes through cmd.exe; a native target is spawned directly.
function Get-LaunchSpec {
  param(
    [string]$TargetPath,
    [string]$IdentityKind,
    [string[]]$Arguments
  )

  $argumentText = (@($Arguments) | ForEach-Object { Format-NativeArgument $_ }) -join " "

  if ($IdentityKind -eq "launcher") {
    $comSpec = $env:ComSpec
    if ([string]::IsNullOrWhiteSpace($comSpec)) { $comSpec = "cmd.exe" }
    $inner = Format-NativeArgument $TargetPath
    if ($argumentText.Length -gt 0) { $inner = $inner + " " + $argumentText }
    return [pscustomobject]@{ FilePath = $comSpec; Arguments = '/d /s /c "' + $inner + '"' }
  }

  return [pscustomobject]@{ FilePath = $TargetPath; Arguments = $argumentText }
}

# Runs one child with both pipes drained concurrently and a hard time bound. On timeout only this
# child (our own process handle) is killed - never a process we did not start. A child that never
# produced a real exit keeps `ExitCode = $null` and explains itself through `Error`.
function Invoke-BoundedChild {
  param(
    [string]$FilePath,
    [string]$Arguments,
    [int]$TimeoutMs
  )

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $FilePath
  $psi.Arguments = $Arguments
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $psi

  $clock = [System.Diagnostics.Stopwatch]::StartNew()
  $started = $false
  $exitCode = $null
  $timedOut = $false
  $stdout = ""
  $stderr = ""
  $errorText = $null
  try {
    if ($TimeoutMs -le 0) { throw "Child timeout must be a positive integer" }
    $started = $process.Start()
    if (-not $started) { throw "Process.Start returned false" }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $remaining = [Math]::Max(0, $TimeoutMs - [int]$clock.ElapsedMilliseconds)
    if (-not $process.WaitForExit($remaining)) {
      $timedOut = $true
      throw "timeout: child exceeded ${TimeoutMs}ms"
    }
    # Only an exit observed before cleanup is an actual child result.
    $exitCode = [int]$process.ExitCode
    $remaining = [Math]::Max(0, $TimeoutMs - [int]$clock.ElapsedMilliseconds)
    $capture = [System.Threading.Tasks.Task]::WhenAll([System.Threading.Tasks.Task[]]@($stdoutTask, $stderrTask))
    if (-not $capture.Wait($remaining)) {
      $timedOut = $true
      throw "timeout: redirected pipes exceeded ${TimeoutMs}ms"
    }
    # Both tasks completed; these reads cannot wait for an inherited open pipe.
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
  } catch {
    $errorText = $_.Exception.Message
  } finally {
    if ($started) {
      try {
        if (-not $process.HasExited) {
          try { $process.Kill($true) } catch { if (-not $process.HasExited) { $process.Kill() } }
          [void]$process.WaitForExit(1000)
        }
      } catch { $errorText = "$errorText; cleanup-error: $($_.Exception.Message)" }
      # Closing our pipe handles is bounded; never wait on an incomplete read task.
      try { $process.StandardOutput.BaseStream.Dispose() } catch { }
      try { $process.StandardError.BaseStream.Dispose() } catch { }
    }
    try { $process.Dispose() } catch { }
    $clock.Stop()
  }

  return [pscustomobject]@{
    ExitCode = $exitCode
    TimedOut = $timedOut
    Stdout = $stdout
    Stderr = $stderr
    Error = $errorText
  }
}

function New-StageRecord {
  param(
    $ExitCode,
    $TimedOut,
    $Error,
    $Stdout,
    $Stderr,
    [int]$TimeoutMs
  )

  return [ordered]@{
    exitCode = $ExitCode
    timedOut = [bool]$TimedOut
    timeoutMs = $TimeoutMs
    error = $Error
    stdoutRaw = $Stdout
    stderrRaw = $Stderr
  }
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

# Writes the raw audit summary from the current provenance state. It is called from every stop path
# so a failure records the real per-stage exit codes, the explicit failing phase and the incomplete/
# failed/changed generation state. Its own failure is reported but never allowed to escape: a raw
# write problem must not mask the first actual child error code.
function Write-RawSummary {
  if (-not $summaryPath) { return }
  $summaryDirectory = Split-Path -Parent $summaryPath
  if (-not $summaryDirectory -or -not (Test-Path -LiteralPath $summaryDirectory)) { return }

  $recordedCommand = if ($targetPath) { $targetPath } else { $targetCommand }
  $generationArgs = @(
    "app-server", "generate-ts", "--out", $auditTs,
    "app-server", "generate-json-schema", "--out", $auditJson
  )

  $summary = [ordered]@{
    generatedAtIso = (Get-Date).ToUniversalTime().ToString("o")
    codexCommand = $recordedCommand
    repository = $repoRoot
    auditRoot = $auditRoot
    failedPhase = $failedPhase
    firstFailureExitCode = $firstFailureExitCode
    stages = [ordered]@{
      version = $stages.version
      typescript = $stages.typescript
      json = $stages.json
    }
    baseline = [ordered]@{
      typescript = $baselineTs
      json = $baselineJson
    }
    generated = [ordered]@{
      typescript = $auditTs
      json = $auditJson
    }
    generatedBy = [ordered]@{
      launchPath = if ($targetPath) { $targetPath } else { "" }
      versionRaw = $versionRaw
      sha256 = $sha256Before
      identityKind = $identityKind
      selectionSource = $selectionSource
      verification = [ordered]@{
        status = $verificationStatus
        reason = $verificationReason
      }
      generation = [ordered]@{
        status = $generationStatus
        mode = "app-server generate-ts + app-server generate-json-schema"
        args = $generationArgs
      }
      baseline = [ordered]@{
        typescript = $baselineTs
        json = $baselineJson
      }
      generated = [ordered]@{
        typescript = $auditTs
        json = $auditJson
      }
    }
    comparison = $comparison
    contentDiff = [ordered]@{
      status = $contentDiffStatus
      typescript = $contentDiffTs
      json = $contentDiffJson
    }
  }

  try {
    $summary | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $summaryPath -Encoding UTF8
    Write-Host ""
    Write-Host "Audit summary: $summaryPath"
  } catch {
    Write-Warning "Raw audit summary could not be written: $($_.Exception.Message)"
  }
}

# Records the failure state and exits with the first actual child exit code, writing the raw summary
# best-effort on the way out.
function Stop-AuditWithFailure {
  param(
    [int]$ExitCode,
    [string]$GenerationStatus
  )

  $script:generationStatus = $GenerationStatus
  try { Write-RawSummary } catch { Write-Warning "Raw audit summary failed: $($_.Exception.Message)" }
  exit $ExitCode
}

# Real full-directory content diff, independent of the identity comparison and of the filename
# statistics. Exit 0 is `matched`, exit 1 is `drift` and any other real exit is `error`; a git that
# cannot run at all produces no exit code at all (null), never a fabricated one.
function Compare-SchemaDirectoryDiff {
  param(
    [string]$Label,
    [string]$Baseline,
    [string]$Generated
  )

  Write-Host ""
  Write-Host "Comparing $Label..."

  $diffText = @()
  $diffExit = $null
  $diffError = $null
  $invoked = $false
  $previousPreference = $ErrorActionPreference
  try {
    # Native stderr merged into the output stream would only be fatal because of the caller's Stop
    # preference; a non-zero diff exit is a normal result here, not an exception.
    $ErrorActionPreference = "Continue"
    $global:LASTEXITCODE = $null
    if ($FullDiff) {
      $diffText = @(& git diff --no-index -- $Baseline $Generated 2>&1)
    } else {
      $diffText = @(& git diff --no-index --stat -- $Baseline $Generated 2>&1)
    }
    $invoked = $true
    if ($null -ne $global:LASTEXITCODE) { $diffExit = [int]$global:LASTEXITCODE }
  } catch {
    $diffError = $_.Exception.Message
    $diffExit = $null
  } finally {
    $ErrorActionPreference = $previousPreference
  }

  if (-not $invoked) {
    $diffExit = $null
  }

  if ($diffText.Count -gt 0) {
    $diffText | ForEach-Object { Write-Host $_ }
  }

  if ($null -eq $diffExit) {
    Write-Warning "$Label diff produced no exit code."
    return [pscustomobject]@{ Status = "error"; ExitCode = $null; Error = $diffError }
  }

  if ($diffExit -eq 0) {
    Write-Host "$Label matches baseline."
    return [pscustomobject]@{ Status = "matched"; ExitCode = 0; Error = $null }
  }

  if ($diffExit -eq 1) {
    Write-Warning "$Label differs from baseline. Review the generated audit output before release."
    return [pscustomobject]@{ Status = "drift"; ExitCode = 1; Error = $null }
  }

  Write-Warning "$Label diff failed with exit code $diffExit."
  return [pscustomobject]@{ Status = "error"; ExitCode = $diffExit; Error = $null }
}

# --- flow ------------------------------------------------------------------

Write-Host "App Server schema audit"
Write-Host "Repository: $repoRoot"
Write-Host "Output:     $auditRoot"

try {
  $currentPhase = "baseline"
  if (-not (Test-Path -LiteralPath $baselineTs)) {
    $failedPhase = "baseline"
    Write-Warning "Missing baseline TypeScript schema directory: $baselineTs"
    Stop-AuditWithFailure -ExitCode 1 -GenerationStatus "failed"
  }
  if (-not (Test-Path -LiteralPath $baselineJson)) {
    $failedPhase = "baseline"
    Write-Warning "Missing baseline JSON schema directory: $baselineJson"
    Stop-AuditWithFailure -ExitCode 1 -GenerationStatus "failed"
  }

  $currentPhase = "selection"
  $target = Select-CodexTarget -Explicit $CodexCommand
  $targetCommand = $target.Command
  $selectionSource = $target.Source

  Write-Host "Codex CLI:  $targetCommand"

  if ($SkipGenerate) {
    Write-Host ""
    Write-Host "SkipGenerate enabled. Empty audit directories were created for command validation only."
    Write-Host "To perform a real audit, rerun without -SkipGenerate."
    exit 0
  }

  # The target is frozen once here and the same absolute path is used for every later phase; nothing
  # below ever re-resolves it, so a later PATH change cannot swap the audited binary.
  $currentPhase = "resolve"
  $targetPath = Resolve-AbsoluteTarget -Command $targetCommand
  if (-not $targetPath) {
    $failedPhase = "resolve"
    $verificationStatus = "unverified"
    $verificationReason = "unresolved-launch-path"
    $identityKind = "unknown"
    Write-Warning "Could not resolve a Codex CLI target from '$targetCommand'."
    Stop-AuditWithFailure -ExitCode 1 -GenerationStatus "failed"
  }

  $currentPhase = "identity"
  $identityKind = Get-LaunchIdentityKind -Path $targetPath
  if ($identityKind -eq "unknown") {
    $failedPhase = "identity"
    $verificationStatus = "unverified"
    $verificationReason = "unsupported-launch-extension"
    $identityKind = "unknown"
    Write-Warning "Unsupported launch target extension for '$targetPath'; refusing to guess native or launcher semantics."
    Stop-AuditWithFailure -ExitCode 1 -GenerationStatus "failed"
  }

  $currentPhase = "fingerprint-before-version"
  $fingerprintAnchor = Get-TargetFingerprint -Path $targetPath
  if (-not $fingerprintAnchor) {
    $failedPhase = "fingerprint"
    $verificationStatus = "unverified"
    $verificationReason = "hash-failed"
    $identityKind = "unknown"
    Write-Warning "Could not compute a SHA256 fingerprint for '$targetPath'."
    Stop-AuditWithFailure -ExitCode 1 -GenerationStatus "failed"
  }
  $sha256Before = $fingerprintAnchor

  $currentPhase = "version"
  $versionSpec = Get-LaunchSpec -TargetPath $targetPath -IdentityKind $identityKind -Arguments @("--version")
  $versionChild = Invoke-BoundedChild -FilePath $versionSpec.FilePath -Arguments $versionSpec.Arguments -TimeoutMs $versionTimeoutMs
  # The raw stdout is kept exactly as produced (CRLF and trailing newline included); trim is only ever
  # used to test whether the probe actually said something.
  $versionRaw = $versionChild.Stdout
  $stages.version = New-StageRecord -ExitCode $versionChild.ExitCode -TimedOut $versionChild.TimedOut -Error $versionChild.Error -Stdout $versionChild.Stdout -Stderr $versionChild.Stderr -TimeoutMs $versionTimeoutMs

  $hasVersion = (-not $versionChild.Error) -and (-not $versionChild.TimedOut) -and ($versionChild.ExitCode -eq 0) -and ($versionChild.Stdout) -and ($versionChild.Stdout.Trim().Length -gt 0)
  if (-not $hasVersion) {
    $failedPhase = "version"
    $verificationStatus = "unverified"
    if ($versionChild.TimedOut) {
      $verificationReason = "version-probe-timeout"
    } elseif ($null -eq $versionChild.ExitCode) {
      $verificationReason = "version-probe-spawn-failed"
    } else {
      $verificationReason = "version-probe-failed"
    }
    $identityKind = "unknown"
    $sha256Before = $null
    $sha256After = $null
    $versionExit = 1
    if ($null -ne $versionChild.ExitCode) { $versionExit = [int]$versionChild.ExitCode }
    if ($versionExit -eq 0) { $versionExit = 1 }
    if ($null -ne $versionChild.ExitCode -and $versionChild.ExitCode -ne 0) {
      $firstFailureExitCode = [int]$versionChild.ExitCode
    }
    Stop-AuditWithFailure -ExitCode $versionExit -GenerationStatus "failed"
  }

  $currentPhase = "fingerprint-after-version"
  $afterVersion = Get-TargetFingerprint -Path $targetPath
  $sha256After = $afterVersion
  if (-not (Test-SameFingerprint -Left $fingerprintAnchor -Right $afterVersion)) {
    $failedPhase = "version"
    $verificationStatus = "untrusted"
    $verificationReason = "target-fingerprint-changed-after-version"
    Stop-AuditWithFailure -ExitCode 1 -GenerationStatus "changed"
  }

  # --- generate-ts ---------------------------------------------------------

  Write-Host ""
  Write-Host "Generating TypeScript schema..."

  $currentPhase = "fingerprint-before-generate-ts"
  $beforeTs = Get-TargetFingerprint -Path $targetPath
  if (-not (Test-SameFingerprint -Left $fingerprintAnchor -Right $beforeTs)) {
    $failedPhase = "typescript"
    $sha256After = $beforeTs
    $verificationStatus = "untrusted"
    $verificationReason = "target-fingerprint-changed-before-generate-ts"
    Stop-AuditWithFailure -ExitCode 1 -GenerationStatus "changed"
  }

  $currentPhase = "generate-ts"
  $tsSpec = Get-LaunchSpec -TargetPath $targetPath -IdentityKind $identityKind -Arguments @("app-server", "generate-ts", "--out", $auditTs)
  $tsChild = Invoke-BoundedChild -FilePath $tsSpec.FilePath -Arguments $tsSpec.Arguments -TimeoutMs $generationTimeoutMs
  $stages.typescript = New-StageRecord -ExitCode $tsChild.ExitCode -TimedOut $tsChild.TimedOut -Error $tsChild.Error -Stdout $tsChild.Stdout -Stderr $tsChild.Stderr -TimeoutMs $generationTimeoutMs

  if ($null -eq $tsChild.ExitCode -or $tsChild.Error -or $tsChild.TimedOut) {
    # No real exit: timeout or spawn failure. The stage keeps exitCode null and explains itself; the
    # audit exits 1 without inventing a success or a child code.
    $failedPhase = "typescript"
    $firstFailureExitCode = $null
    if ($null -ne $tsChild.ExitCode -and $tsChild.ExitCode -ne 0) { $firstFailureExitCode = [int]$tsChild.ExitCode }
    if ($tsChild.TimedOut) {
      $verificationReason = "generate-ts-timeout"
    } else {
      $verificationReason = "generate-ts-spawn-failed"
    }
    $failureExit = if ($null -ne $firstFailureExitCode) { $firstFailureExitCode } else { 1 }
    Stop-AuditWithFailure -ExitCode $failureExit -GenerationStatus "failed"
  }

  if ($tsChild.ExitCode -ne 0) {
    # First failing generation stage: stop here, keep the real code and leave the JSON stage null.
    $failedPhase = "typescript"
    $firstFailureExitCode = [int]$tsChild.ExitCode
    $verificationReason = "generate-ts-failed"
    Stop-AuditWithFailure -ExitCode $firstFailureExitCode -GenerationStatus "failed"
  }

  $currentPhase = "fingerprint-after-generate-ts"
  $afterTs = Get-TargetFingerprint -Path $targetPath
  $sha256After = $afterTs
  if (-not (Test-SameFingerprint -Left $fingerprintAnchor -Right $afterTs)) {
    # The TypeScript leg replaced or edited the frozen target: stop before the JSON leg can run
    # against a different binary.
    $failedPhase = "typescript"
    $verificationStatus = "untrusted"
    $verificationReason = "target-fingerprint-changed-after-generate-ts"
    Stop-AuditWithFailure -ExitCode 1 -GenerationStatus "changed"
  }

  # --- generate-json-schema ------------------------------------------------

  Write-Host ""
  Write-Host "Generating JSON schema..."

  $currentPhase = "fingerprint-before-generate-json-schema"
  $beforeJson = Get-TargetFingerprint -Path $targetPath
  if (-not (Test-SameFingerprint -Left $fingerprintAnchor -Right $beforeJson)) {
    $failedPhase = "json"
    $sha256After = $beforeJson
    $verificationStatus = "untrusted"
    $verificationReason = "target-fingerprint-changed-before-generate-json-schema"
    Stop-AuditWithFailure -ExitCode 1 -GenerationStatus "changed"
  }

  $currentPhase = "generate-json-schema"
  $jsonSpec = Get-LaunchSpec -TargetPath $targetPath -IdentityKind $identityKind -Arguments @("app-server", "generate-json-schema", "--out", $auditJson)
  $jsonChild = Invoke-BoundedChild -FilePath $jsonSpec.FilePath -Arguments $jsonSpec.Arguments -TimeoutMs $generationTimeoutMs
  $stages.json = New-StageRecord -ExitCode $jsonChild.ExitCode -TimedOut $jsonChild.TimedOut -Error $jsonChild.Error -Stdout $jsonChild.Stdout -Stderr $jsonChild.Stderr -TimeoutMs $generationTimeoutMs

  if ($null -eq $jsonChild.ExitCode -or $jsonChild.Error -or $jsonChild.TimedOut) {
    $failedPhase = "json"
    $firstFailureExitCode = $null
    if ($null -ne $jsonChild.ExitCode -and $jsonChild.ExitCode -ne 0) { $firstFailureExitCode = [int]$jsonChild.ExitCode }
    if ($jsonChild.TimedOut) {
      $verificationReason = "generate-json-schema-timeout"
    } else {
      $verificationReason = "generate-json-schema-spawn-failed"
    }
    $failureExit = if ($null -ne $firstFailureExitCode) { $firstFailureExitCode } else { 1 }
    Stop-AuditWithFailure -ExitCode $failureExit -GenerationStatus "failed"
  }

  if ($jsonChild.ExitCode -ne 0) {
    $failedPhase = "json"
    $firstFailureExitCode = [int]$jsonChild.ExitCode
    $verificationReason = "generate-json-schema-failed"
    Stop-AuditWithFailure -ExitCode $firstFailureExitCode -GenerationStatus "failed"
  }

  $currentPhase = "fingerprint-after-generate-json-schema"
  $afterJson = Get-TargetFingerprint -Path $targetPath
  $sha256After = $afterJson
  if (-not (Test-SameFingerprint -Left $fingerprintAnchor -Right $afterJson)) {
    $failedPhase = "json"
    $verificationStatus = "untrusted"
    $verificationReason = "target-fingerprint-changed-after-generate-json-schema"
    Stop-AuditWithFailure -ExitCode 1 -GenerationStatus "changed"
  }

  # Generation completed with a valid raw version and a fingerprint that never moved. Only now may a
  # native target be published as `verified`; a launcher stays launcher-only evidence.
  $generationStatus = "complete"
  $verificationStatus = if ($identityKind -eq "native") { "verified" } else { "launcher-only" }
  $verificationReason = ""

  # --- name statistics + real content diff ---------------------------------

  # Name-set counts are statistics only; the real content diff below is what may back a matched/drift
  # verdict.
  $currentPhase = "comparison"
  $comparison = [ordered]@{
    typescriptRoot = Compare-NameSets -Baseline (Get-FileBaseNames -Path $baselineTs) -Generated (Get-FileBaseNames -Path $auditTs)
    typescriptV2 = Compare-NameSets -Baseline (Get-FileBaseNames -Path (Join-Path $baselineTs "v2")) -Generated (Get-FileBaseNames -Path (Join-Path $auditTs "v2"))
    jsonRoot = Compare-NameSets -Baseline (Get-FileBaseNames -Path $baselineJson) -Generated (Get-FileBaseNames -Path $auditJson)
    jsonV2 = Compare-NameSets -Baseline (Get-FileBaseNames -Path (Join-Path $baselineJson "v2")) -Generated (Get-FileBaseNames -Path (Join-Path $auditJson "v2"))
  }

  $currentPhase = "content-diff"
  $tsDiff = Compare-SchemaDirectoryDiff -Label "TypeScript schemas" -Baseline $baselineTs -Generated $auditTs
  if ($tsDiff.Status -eq "error") {
    $failedPhase = "content-diff-typescript"
    if ($null -ne $tsDiff.ExitCode) { $firstFailureExitCode = [int]$tsDiff.ExitCode }
  }
  $jsonDiff = Compare-SchemaDirectoryDiff -Label "JSON schemas" -Baseline $baselineJson -Generated $auditJson
  if ($jsonDiff.Status -eq "error" -and -not $failedPhase) {
    $failedPhase = "content-diff-json"
    if ($null -ne $jsonDiff.ExitCode) { $firstFailureExitCode = [int]$jsonDiff.ExitCode }
  } elseif ($jsonDiff.Status -eq "error" -and $null -eq $firstFailureExitCode -and $null -ne $jsonDiff.ExitCode) {
    $firstFailureExitCode = [int]$jsonDiff.ExitCode
  }

  $contentDiffTs = [ordered]@{ status = $tsDiff.Status; exitCode = $tsDiff.ExitCode; error = $tsDiff.Error }
  $contentDiffJson = [ordered]@{ status = $jsonDiff.Status; exitCode = $jsonDiff.ExitCode; error = $jsonDiff.Error }
  $contentDiffStatus = if ($tsDiff.Status -eq "error" -or $jsonDiff.Status -eq "error") { "failed" } else { "complete" }

  # The raw summary is written before the exit decision, so a real diff error is recorded with its
  # own exit code and the script can then exit that code directly instead of throwing it away.
  Write-RawSummary

  Write-Host ""
  Write-Host "Audit output: $auditRoot"

  # A real diff failure is not a generation failure: generation stays `complete` and the actual diff
  # exit (TypeScript first when both failed) is the script exit code.
  if ($tsDiff.Status -eq "error") {
    Write-Warning "TypeScript schema diff failed with exit code $($tsDiff.ExitCode)."
    if ($null -ne $firstFailureExitCode) { exit $firstFailureExitCode }
    exit 1
  }

  if ($jsonDiff.Status -eq "error") {
    Write-Warning "JSON schema diff failed with exit code $($jsonDiff.ExitCode)."
    if ($null -ne $jsonDiff.ExitCode) { exit ([int]$jsonDiff.ExitCode) }
    exit 1
  }

  if ($tsDiff.Status -eq "drift" -or $jsonDiff.Status -eq "drift") {
    Write-Warning "Schema differences found. Exit code 1 means review is required, not that generation failed."
    exit 1
  }

  Write-Host "No schema differences found."
  exit 0
} catch {
  # Any unexpected exception (resolution, hashing, spawning, generation, comparison) still records
  # raw state where the output directory exists, then exits the first actual child code if one was
  # observed.
  $message = $_.Exception.Message
  Write-Warning "Audit aborted in phase '$currentPhase': $message"
  if (-not $failedPhase) { $failedPhase = $currentPhase }
  if ($generationStatus -ne "changed" -and $generationStatus -ne "complete") {
    $anyStage = ($null -ne $stages.version) -or ($null -ne $stages.typescript) -or ($null -ne $stages.json)
    if ($anyStage -or $failedPhase) {
      $generationStatus = "failed"
    } else {
      $generationStatus = "incomplete"
    }
  }
  $finalExit = 1
  if ($null -ne $firstFailureExitCode) { $finalExit = [int]$firstFailureExitCode }
  try { Write-RawSummary } catch { Write-Warning "Raw audit summary failed: $($_.Exception.Message)" }
  exit $finalExit
}
