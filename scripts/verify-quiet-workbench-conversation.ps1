[CmdletBinding()]
param(
  [string]$BaseUrl = 'http://127.0.0.1:7420',
  [string]$OutputDirectory = '',
  [string]$ChromePath = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $repoRoot 'output\quiet-workbench\conversation-contract'
}
$playwrightPackage = @(
  'D:\nvm\node_cache\node_modules\@playwright\cli\node_modules\playwright',
  'D:\nvm\node_cache\node_modules\@playwright\mcp\node_modules\playwright'
) | Where-Object { Test-Path -LiteralPath (Join-Path $_ 'package.json') } | Select-Object -First 1
if ([string]::IsNullOrWhiteSpace($playwrightPackage)) {
  throw 'Playwright is not available in the installed Codex workspace dependencies.'
}

$previousPlaywrightModule = $env:CX_CODEX_PLAYWRIGHT_MODULE
try {
  $env:CX_CODEX_PLAYWRIGHT_MODULE = $playwrightPackage
  & 'C:\Program Files\nodejs\node.exe' (Join-Path $PSScriptRoot 'verify-quiet-workbench-conversation.mjs') `
    --base-url $BaseUrl `
    --output-directory ([IO.Path]::GetFullPath($OutputDirectory)) `
    --chrome-path $ChromePath
  if ($LASTEXITCODE -ne 0) {
    throw "Quiet Workbench conversation verification failed with exit code $LASTEXITCODE."
  }
} finally {
  if ($null -eq $previousPlaywrightModule) {
    Remove-Item Env:CX_CODEX_PLAYWRIGHT_MODULE -ErrorAction SilentlyContinue
  } else {
    $env:CX_CODEX_PLAYWRIGHT_MODULE = $previousPlaywrightModule
  }
}
