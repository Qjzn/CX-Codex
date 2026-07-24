[CmdletBinding()]
param(
  [string]$WorkspacePath = "$env:USERPROFILE\CodexWorkspace",
  [int]$Port = 7420,
  [string]$BindHost = "0.0.0.0",
  [string]$Password = "",
  [switch]$NoPassword,
  [switch]$SkipStartupTask,
  [switch]$SkipFirewall,
  [switch]$SkipLogin,
  [switch]$RemoteQuick,
  [switch]$JsonOutput,
  [switch]$NoStart
)

$bootstrapScript = Join-Path $PSScriptRoot "scripts\bootstrap-windows.ps1"
$arguments = @{
  SourceRepoRoot = $PSScriptRoot
  WorkspacePath = $WorkspacePath
  Port = $Port
  BindHost = $BindHost
}

if ($NoPassword) {
  $arguments.NoPassword = $true
} elseif (-not [string]::IsNullOrWhiteSpace($Password)) {
  $arguments.Password = $Password
}
if ($SkipStartupTask) {
  $arguments.SkipStartupTask = $true
}
if ($SkipFirewall) {
  $arguments.SkipFirewall = $true
}
if ($SkipLogin) {
  $arguments.SkipLogin = $true
}
if ($RemoteQuick) {
  $arguments.RemoteQuick = $true
}
if ($JsonOutput) {
  $arguments.JsonOutput = $true
}
if ($NoStart) {
  $arguments.NoStart = $true
}

& $bootstrapScript @arguments
