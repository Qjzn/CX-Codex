[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

function Assert-True {
  param(
    [bool]$Condition,
    [string]$Message
  )

  if (-not $Condition) {
    throw $Message
  }
}

function Invoke-CapturedPowerShell {
  param(
    [string]$ScriptPath,
    [string[]]$Arguments,
    [string]$CaptureRoot,
    [string]$Label,
    [int]$TimeoutSeconds = 180
  )

  $stdoutPath = Join-Path $CaptureRoot "$Label.stdout.log"
  $stderrPath = Join-Path $CaptureRoot "$Label.stderr.log"
  $rawArguments = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $ScriptPath
  ) + $Arguments
  $argumentList = @(
    $rawArguments | ForEach-Object {
      '"' + ([string]$_).Replace('"', '\"') + '"'
    }
  )

  $process = Start-Process `
    -FilePath "powershell.exe" `
    -ArgumentList $argumentList `
    -WindowStyle Hidden `
    -PassThru `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while (-not $process.HasExited -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 100
    $process.Refresh()
  }
  if (-not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw "$Label exceeded the $TimeoutSeconds-second process timeout."
  }
  $stdout = if (Test-Path -LiteralPath $stdoutPath) { Get-Content -LiteralPath $stdoutPath -Raw } else { "" }
  $stderr = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw } else { "" }
  $exitCode = $process.ExitCode
  $process.Dispose()

  return [ordered]@{
    ExitCode = $exitCode
    Stdout = $stdout
    Stderr = $stderr
  }
}

function ConvertFrom-SingleJsonLine {
  param(
    [string]$Text,
    [string]$Label
  )

  $lines = @(
    $Text -split "\r?\n" |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  )
  Assert-True ($lines.Count -eq 1) "$Label must write exactly one non-empty stdout line; found $($lines.Count)."
  try {
    return $lines[0] | ConvertFrom-Json
  } catch {
    throw "$Label stdout is not valid JSON."
  }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$installScript = Join-Path $repoRoot "scripts\install-windows-server.ps1"
$uninstallScript = Join-Path $repoRoot "scripts\uninstall-windows.ps1"
$bootstrapScript = Join-Path $repoRoot "scripts\bootstrap-windows.ps1"
$testRoot = Join-Path $env:TEMP "cx-codex-productization-$PID"

if (Test-Path -LiteralPath $testRoot) {
  $resolvedTemp = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
  $resolvedTestRoot = [System.IO.Path]::GetFullPath($testRoot).TrimEnd('\')
  if (-not $resolvedTestRoot.StartsWith("$resolvedTemp\", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clean unexpected test root: $resolvedTestRoot"
  }
  Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$runtimeCleanupArgs = $null
$processTreeCleanupArgs = $null
$processTreeRoot = $null
$processTreeChildPid = 0
$originalCodexHome = $env:CODEX_HOME

try {
  $nodePath = (Get-Command node -ErrorAction Stop).Source
  $nodeRoot = Split-Path -Parent $nodePath
  $npmCliPath = Join-Path $nodeRoot "node_modules\npm\bin\npm-cli.js"
  $installerArgs = @(
    "-ProjectPath", (Join-Path $testRoot "workspace"),
    "-CreateProjectPath",
    "-Port", "17420",
    "-BindHost", "127.0.0.1",
    "-Password", "productization-test-password",
    "-ConfigPath", (Join-Path $testRoot "state\config.json"),
    "-LauncherPath", (Join-Path $testRoot "bin\cx-codex-start.cmd"),
    "-NodeCommand", $nodePath,
    "-SkipNpmInstall",
    "-SkipBuild",
    "-JsonOutput"
  )
  if (Test-Path -LiteralPath $npmCliPath) {
    $installerArgs += @("-NpmCliPath", $npmCliPath)
  }

  $installResult = Invoke-CapturedPowerShell `
    -ScriptPath $installScript `
    -Arguments $installerArgs `
    -CaptureRoot $testRoot `
    -Label "install"
  Assert-True ($installResult.ExitCode -eq 0) "Installer JSON smoke exited with $($installResult.ExitCode). $($installResult.Stderr)"
  $installJson = ConvertFrom-SingleJsonLine -Text $installResult.Stdout -Label "Installer JSON smoke"
  Assert-True ($installJson.schemaVersion -eq 1) "Installer JSON schemaVersion must be 1."
  Assert-True ($installJson.operation -eq "install") "Installer JSON operation must be install."
  Assert-True ([bool]$installJson.ok) "No-start installation must report ok=true after files are generated."
  Assert-True (-not [bool]$installJson.started) "No-start installation must report started=false."
  Assert-True (-not [bool]$installJson.healthReady) "No-start installation must report healthReady=false."
  Assert-True ([string]::IsNullOrWhiteSpace([string]$installJson.publicUrl)) "Local no-start installation must not report a public URL."
  Write-Host "productization: stable install JSON passed"

  $fakeInstallDir = Join-Path $testRoot "program"
  New-Item -ItemType Directory -Path $fakeInstallDir -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $fakeInstallDir "marker.txt") -Value "managed program"

  $preserveResult = Invoke-CapturedPowerShell `
    -ScriptPath $uninstallScript `
    -Arguments @(
      "-InstallDir", $fakeInstallDir,
      "-StateDir", (Join-Path $testRoot "state"),
      "-LauncherPath", (Join-Path $testRoot "bin\cx-codex-start.cmd"),
      "-ManagedBinDir", (Join-Path $testRoot "bin"),
      "-Port", "17420",
      "-JsonOutput"
    ) `
    -CaptureRoot $testRoot `
    -Label "uninstall-preserve"
  Assert-True ($preserveResult.ExitCode -eq 0) "Preserving uninstall smoke exited with $($preserveResult.ExitCode). $($preserveResult.Stderr)"
  $preserveJson = ConvertFrom-SingleJsonLine -Text $preserveResult.Stdout -Label "Preserving uninstall smoke"
  Assert-True ([bool]$preserveJson.ok) "Preserving uninstall must report ok=true."
  Assert-True (-not (Test-Path -LiteralPath $fakeInstallDir)) "Uninstaller must remove the managed program directory."
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $testRoot "bin\cx-codex-start.cmd"))) "Uninstaller must remove the managed launcher."
  Assert-True (Test-Path -LiteralPath (Join-Path $testRoot "state\config.json")) "User data must be preserved by default."
  Write-Host "productization: preserving uninstall passed"

  $secondInstallDir = Join-Path $testRoot "program-remove-data"
  $secondStateDir = Join-Path $testRoot "state-remove-data"
  $managedBinDir = Join-Path $testRoot "managed-bin"
  $managedCloudflaredPath = Join-Path $managedBinDir "cloudflared-0123456789ab.exe"
  New-Item -ItemType Directory -Path $secondInstallDir,$secondStateDir,$managedBinDir -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $secondInstallDir "marker.txt") -Value "managed program"
  Set-Content -LiteralPath $managedCloudflaredPath -Value "managed cloudflared"
  [ordered]@{
    port = 17421
    cloudflaredCommand = $managedCloudflaredPath
  } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $secondStateDir "config.json") -Encoding UTF8

  $removeDataResult = Invoke-CapturedPowerShell `
    -ScriptPath $uninstallScript `
    -Arguments @(
      "-InstallDir", $secondInstallDir,
      "-StateDir", $secondStateDir,
      "-LauncherPath", (Join-Path $managedBinDir "cx-codex-start.cmd"),
      "-ManagedBinDir", $managedBinDir,
      "-Port", "17421",
      "-RemoveUserData",
      "-RemoveCloudflared",
      "-JsonOutput"
    ) `
    -CaptureRoot $testRoot `
    -Label "uninstall-remove-data"
  Assert-True ($removeDataResult.ExitCode -eq 0) "Full uninstall smoke exited with $($removeDataResult.ExitCode). $($removeDataResult.Stderr)"
  $removeDataJson = ConvertFrom-SingleJsonLine -Text $removeDataResult.Stdout -Label "Full uninstall smoke"
  Assert-True ([bool]$removeDataJson.ok) "Full uninstall must report ok=true."
  Assert-True (-not (Test-Path -LiteralPath $secondInstallDir)) "Full uninstall must remove the managed program directory."
  Assert-True (-not (Test-Path -LiteralPath $secondStateDir)) "Full uninstall must remove CX-Codex user data when requested."
  Assert-True (-not (Test-Path -LiteralPath $managedCloudflaredPath)) "Full uninstall must remove the managed cloudflared binary when requested."
  Write-Host "productization: full uninstall passed"

  $uninstallFailureResult = Invoke-CapturedPowerShell `
    -ScriptPath $uninstallScript `
    -Arguments @(
      "-InstallDir", $env:USERPROFILE,
      "-StateDir", (Join-Path $testRoot "failure-state"),
      "-LauncherPath", (Join-Path $testRoot "failure-bin\cx-codex-start.cmd"),
      "-ManagedBinDir", (Join-Path $testRoot "failure-bin"),
      "-JsonOutput"
    ) `
    -CaptureRoot $testRoot `
    -Label "uninstall-failure"
  Assert-True ($uninstallFailureResult.ExitCode -ne 0) "Unsafe uninstall smoke must exit non-zero."
  $uninstallFailureJson = ConvertFrom-SingleJsonLine -Text $uninstallFailureResult.Stdout -Label "Unsafe uninstall smoke"
  Assert-True (-not [bool]$uninstallFailureJson.ok) "Unsafe uninstall JSON must report ok=false."
  Assert-True ($uninstallFailureJson.error.code -eq "UNINSTALL_FAILED") "Unsafe uninstall JSON must expose UNINSTALL_FAILED."
  Assert-True ($uninstallFailureJson.error.stage -eq "initialize") "Unsafe uninstall JSON must expose the failing stage."
  Write-Host "productization: uninstall failure JSON passed"

  $portProbe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $portProbe.Start()
  $runtimePort = [int]$portProbe.LocalEndpoint.Port
  $portProbe.Stop()
  $runtimeInstallDir = Join-Path $testRoot "runtime-program"
  $runtimeStateDir = Join-Path $testRoot "runtime-state"
  $runtimeBinDir = Join-Path $testRoot "runtime-bin"
  $runtimeLauncherPath = Join-Path $runtimeBinDir "cx-codex-start.cmd"
  $runtimeCodexHome = Join-Path $testRoot "runtime-codex-home"
  New-Item -ItemType Directory -Path $runtimeInstallDir -Force | Out-Null
  New-Item -ItemType Directory -Path $runtimeCodexHome -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $runtimeInstallDir "marker.txt") -Value "managed runtime program"
  Set-Content -LiteralPath (Join-Path $runtimeCodexHome "auth.json") -Value "{}"
  $env:CODEX_HOME = $runtimeCodexHome
  $runtimeInstallerArgs = @(
    "-ProjectPath", (Join-Path $testRoot "runtime-workspace"),
    "-CreateProjectPath",
    "-Port", "$runtimePort",
    "-BindHost", "127.0.0.1",
    "-Password", "productization-runtime-password",
    "-ConfigPath", (Join-Path $runtimeStateDir "config.json"),
    "-LauncherPath", $runtimeLauncherPath,
    "-NodeCommand", $nodePath,
    "-CodexCommand", $nodePath,
    "-SkipNpmInstall",
    "-SkipBuild",
    "-StartNow",
    "-JsonOutput"
  )
  if (Test-Path -LiteralPath $npmCliPath) {
    $runtimeInstallerArgs += @("-NpmCliPath", $npmCliPath)
  }
  $runtimeCleanupArgs = @(
    "-InstallDir", $runtimeInstallDir,
    "-StateDir", $runtimeStateDir,
    "-LauncherPath", $runtimeLauncherPath,
    "-ManagedBinDir", $runtimeBinDir,
    "-Port", "$runtimePort",
    "-RemoveUserData",
    "-JsonOutput"
  )

  $runtimeInstallerArgsPath = Join-Path $testRoot "install-start-now.args.clixml"
  $runtimeCaptureWrapperPath = Join-Path $testRoot "install-start-now-capture-wrapper.ps1"
  $runtimeInstallerArgs | Export-Clixml -LiteralPath $runtimeInstallerArgsPath
  Set-Content `
    -LiteralPath $runtimeCaptureWrapperPath `
    -Encoding UTF8 `
    -Value @'
[CmdletBinding()]
param(
  [string]$InstallScript,
  [string]$ArgumentsPath
)
$capturedArguments = @(Import-Clixml -LiteralPath $ArgumentsPath)
$captured = & powershell.exe `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File $InstallScript `
  @capturedArguments
$installerExitCode = $LASTEXITCODE
[Console]::Out.WriteLine((@($captured) -join "`n"))
exit $installerExitCode
'@
  $runtimeInstallResult = Invoke-CapturedPowerShell `
    -ScriptPath $runtimeCaptureWrapperPath `
    -Arguments @(
      "-InstallScript", $installScript,
      "-ArgumentsPath", $runtimeInstallerArgsPath
    ) `
    -CaptureRoot $testRoot `
    -Label "install-start-now-captured" `
    -TimeoutSeconds 60
  Write-Host "productization: captured StartNow installer returned"
  Assert-True ($runtimeInstallResult.ExitCode -eq 0) "StartNow installer smoke exited with $($runtimeInstallResult.ExitCode). $($runtimeInstallResult.Stderr)"
  $runtimeInstallJson = ConvertFrom-SingleJsonLine -Text $runtimeInstallResult.Stdout -Label "StartNow installer smoke"
  Assert-True ([bool]$runtimeInstallJson.ok) "StartNow installer must report ok=true. $($runtimeInstallResult.Stderr)"
  Assert-True ([bool]$runtimeInstallJson.started) "StartNow installer must report started=true."
  Assert-True ([bool]$runtimeInstallJson.healthReady) "StartNow installer must pass the local health gate."
  Assert-True (Test-Path -LiteralPath (Join-Path $runtimeStateDir "cx-codex-$runtimePort.pid")) "StartNow installer must persist the managed server PID marker."
  $healthResponse = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$runtimePort/health" -TimeoutSec 5
  Assert-True ($healthResponse.StatusCode -eq 200) "StartNow health endpoint must return HTTP 200."
  Write-Host "productization: StartNow health passed"

  $runtimeCleanupResult = Invoke-CapturedPowerShell `
    -ScriptPath $uninstallScript `
    -Arguments $runtimeCleanupArgs `
    -CaptureRoot $testRoot `
    -Label "uninstall-start-now"
  Write-Host "productization: StartNow uninstall returned"
  Assert-True ($runtimeCleanupResult.ExitCode -eq 0) "StartNow uninstall smoke exited with $($runtimeCleanupResult.ExitCode). $($runtimeCleanupResult.Stderr)"
  $runtimeCleanupJson = ConvertFrom-SingleJsonLine -Text $runtimeCleanupResult.Stdout -Label "StartNow uninstall smoke"
  Assert-True ([bool]$runtimeCleanupJson.ok) "StartNow uninstall must report ok=true."
  $runtimeCleanupArgs = $null
  Start-Sleep -Milliseconds 500
  $stoppedHealth = $null
  try {
    $stoppedHealth = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$runtimePort/health" -TimeoutSec 2
  } catch {}
  Assert-True ($null -eq $stoppedHealth) "Official uninstall must stop the managed StartNow service."
  Write-Host "productization: StartNow cleanup passed"

  $portProbe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $portProbe.Start()
  $processTreePort = [int]$portProbe.LocalEndpoint.Port
  $portProbe.Stop()
  $processTreeInstallDir = Join-Path $testRoot "process-tree-program"
  $processTreeDistCliDir = Join-Path $processTreeInstallDir "dist-cli"
  $processTreeStateDir = Join-Path $testRoot "process-tree-state"
  $processTreeBinDir = Join-Path $testRoot "process-tree-bin"
  $processTreeChildPidPath = Join-Path $processTreeStateDir "child.pid"
  $processTreeServerEntryPoint = Join-Path $processTreeDistCliDir "index.js"
  New-Item -ItemType Directory -Path $processTreeDistCliDir,$processTreeStateDir,$processTreeBinDir -Force | Out-Null
  $childPidPathJson = $processTreeChildPidPath | ConvertTo-Json -Compress
  Set-Content `
    -LiteralPath $processTreeServerEntryPoint `
    -Value "const fs=require('node:fs');const{spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},60000)'],{stdio:'ignore'});fs.writeFileSync($childPidPathJson,String(child.pid));require('node:net').createServer(()=>{}).listen($processTreePort,'127.0.0.1');"
  $processTreeRoot = Start-Process `
    -FilePath $nodePath `
    -ArgumentList @("`"$processTreeServerEntryPoint`"") `
    -WorkingDirectory $processTreeInstallDir `
    -WindowStyle Hidden `
    -PassThru
  $processTreePidMarker = Join-Path $processTreeStateDir "cx-codex-$processTreePort.pid"
  Set-Content -LiteralPath $processTreePidMarker -Value ([string]$processTreeRoot.Id)
  $processTreeDeadline = (Get-Date).AddSeconds(10)
  do {
    $processTreeListener = Get-NetTCPConnection -LocalPort $processTreePort -State Listen -ErrorAction SilentlyContinue
    if ($processTreeListener -and (Test-Path -LiteralPath $processTreeChildPidPath)) {
      break
    }
    Start-Sleep -Milliseconds 100
  } while ((Get-Date) -lt $processTreeDeadline)
  Assert-True ($processTreeListener -and [int]$processTreeListener.OwningProcess -eq $processTreeRoot.Id) "Process-tree fixture must own its listener."
  Assert-True (Test-Path -LiteralPath $processTreeChildPidPath) "Process-tree fixture must record its child PID."
  $processTreeChildPid = [int](Get-Content -LiteralPath $processTreeChildPidPath -Raw)
  Assert-True ([bool](Get-Process -Id $processTreeChildPid -ErrorAction SilentlyContinue)) "Process-tree fixture child must be running."
  $processTreeCleanupArgs = @(
    "-InstallDir", $processTreeInstallDir,
    "-StateDir", $processTreeStateDir,
    "-LauncherPath", (Join-Path $processTreeBinDir "cx-codex-start.cmd"),
    "-ManagedBinDir", $processTreeBinDir,
    "-Port", "$processTreePort",
    "-RemoveUserData",
    "-JsonOutput"
  )
  $processTreeCleanupResult = Invoke-CapturedPowerShell `
    -ScriptPath $uninstallScript `
    -Arguments $processTreeCleanupArgs `
    -CaptureRoot $testRoot `
    -Label "uninstall-process-tree"
  Assert-True ($processTreeCleanupResult.ExitCode -eq 0) "Process-tree uninstall exited with $($processTreeCleanupResult.ExitCode). $($processTreeCleanupResult.Stderr)"
  $processTreeCleanupJson = ConvertFrom-SingleJsonLine -Text $processTreeCleanupResult.Stdout -Label "Process-tree uninstall smoke"
  Assert-True ([bool]$processTreeCleanupJson.ok) "Process-tree uninstall must report ok=true."
  Assert-True (@($processTreeCleanupJson.warnings).Count -eq 0) "Process-tree uninstall must not emit stop timeout warnings."
  $processTreeRoot.Refresh()
  Assert-True ($processTreeRoot.HasExited) "Process-tree uninstall must stop the managed root."
  Assert-True (-not (Get-Process -Id $processTreeChildPid -ErrorAction SilentlyContinue)) "Process-tree uninstall must stop managed descendants."
  Assert-True (-not (Get-NetTCPConnection -LocalPort $processTreePort -State Listen -ErrorAction SilentlyContinue)) "Process-tree uninstall must close the managed port."
  Assert-True (-not (Test-Path -LiteralPath $processTreeInstallDir)) "Process-tree uninstall must remove the installation."
  $processTreeCleanupArgs = $null
  $processTreeRoot.Dispose()
  $processTreeRoot = $null
  Write-Host "productization: process-tree uninstall passed"

  $failureResult = Invoke-CapturedPowerShell `
    -ScriptPath $bootstrapScript `
    -Arguments @(
      "-SourceRepoRoot", (Join-Path $testRoot "missing-source"),
      "-InstallDir", (Join-Path $testRoot "missing-install"),
      "-NoStart",
      "-JsonOutput"
    ) `
    -CaptureRoot $testRoot `
    -Label "bootstrap-failure"
  Assert-True ($failureResult.ExitCode -ne 0) "Bootstrap failure smoke must exit non-zero."
  $failureJson = ConvertFrom-SingleJsonLine -Text $failureResult.Stdout -Label "Bootstrap failure smoke"
  Assert-True (-not [bool]$failureJson.ok) "Bootstrap failure JSON must report ok=false."
  Assert-True ($failureJson.error.code -eq "BOOTSTRAP_FAILED") "Bootstrap failure JSON must expose BOOTSTRAP_FAILED."
  Assert-True ($failureJson.error.stage -eq "acquire_repository") "Bootstrap failure JSON must expose the failing stage."
  Write-Host "productization: bootstrap failure JSON passed"

  $incompatibleSource = Join-Path $testRoot "incompatible-source"
  New-Item -ItemType Directory -Path $incompatibleSource -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $incompatibleSource "package.json") -Value '{"name":"incompatible-source"}'
  $capabilityFailureResult = Invoke-CapturedPowerShell `
    -ScriptPath $bootstrapScript `
    -Arguments @(
      "-SourceRepoRoot", $incompatibleSource,
      "-InstallDir", (Join-Path $testRoot "incompatible-install"),
      "-NoStart",
      "-JsonOutput"
    ) `
    -CaptureRoot $testRoot `
    -Label "bootstrap-capability-failure"
  Assert-True ($capabilityFailureResult.ExitCode -ne 0) "Capability mismatch smoke must exit non-zero."
  $capabilityFailureJson = ConvertFrom-SingleJsonLine -Text $capabilityFailureResult.Stdout -Label "Capability mismatch smoke"
  Assert-True (-not [bool]$capabilityFailureJson.ok) "Capability mismatch JSON must report ok=false."
  Assert-True ($capabilityFailureJson.error.stage -eq "validate_capabilities") "Capability mismatch must fail during validate_capabilities."
  Write-Host "productization: capability mismatch passed"

  Write-Host "Windows productization smoke passed."
} finally {
  if ($runtimeCleanupArgs) {
    try {
      Invoke-CapturedPowerShell `
        -ScriptPath $uninstallScript `
        -Arguments $runtimeCleanupArgs `
        -CaptureRoot $testRoot `
        -Label "uninstall-start-now-finally" | Out-Null
    } catch {}
  }
  if ($processTreeCleanupArgs) {
    try {
      Invoke-CapturedPowerShell `
        -ScriptPath $uninstallScript `
        -Arguments $processTreeCleanupArgs `
        -CaptureRoot $testRoot `
        -Label "uninstall-process-tree-finally" | Out-Null
    } catch {}
  }
  if ($processTreeChildPid -gt 0) {
    Stop-Process -Id $processTreeChildPid -Force -ErrorAction SilentlyContinue
  }
  if ($processTreeRoot) {
    Stop-Process -Id $processTreeRoot.Id -Force -ErrorAction SilentlyContinue
    $processTreeRoot.Dispose()
  }
  if (Test-Path -LiteralPath $testRoot) {
    $resolvedTemp = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
    $resolvedTestRoot = [System.IO.Path]::GetFullPath($testRoot).TrimEnd('\')
    if ($resolvedTestRoot.StartsWith("$resolvedTemp\", [System.StringComparison]::OrdinalIgnoreCase)) {
      for ($attempt = 1; $attempt -le 10 -and (Test-Path -LiteralPath $resolvedTestRoot); $attempt++) {
        try {
          Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force -ErrorAction Stop
        } catch {
          if ($attempt -eq 10) {
            throw
          }
          Start-Sleep -Milliseconds 250
        }
      }
    }
  }
  if ([string]::IsNullOrWhiteSpace($originalCodexHome)) {
    Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue
  } else {
    $env:CODEX_HOME = $originalCodexHome
  }
}
