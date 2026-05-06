param(
  [Parameter(Mandatory = $true)]
  [string]$Version,

  [string]$ServerUrl = '',

  [string]$OutputDir,

  [Nullable[int]]$VersionCode
)

$ErrorActionPreference = 'Stop'

if ($null -eq $ServerUrl) {
  $ServerUrl = ''
}
if (-not $OutputDir) {
  $OutputDir = Join-Path $PSScriptRoot '..\artifacts'
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$androidRoot = Join-Path $repoRoot 'android'
$keystoreProperties = Join-Path $androidRoot 'keystore.properties'

if (-not (Test-Path $keystoreProperties)) {
  throw "Android signing config was not found: $keystoreProperties"
}

$defaultJavaHome = 'C:\Program Files\Java\jdk-24'
$resolvedJavaHome = $env:JAVA_HOME
if (Test-Path $defaultJavaHome) {
  $resolvedJavaHome = $defaultJavaHome
}
if (-not $resolvedJavaHome -or -not (Test-Path $resolvedJavaHome)) {
  throw 'JAVA_HOME was not found. Install JDK 24 or set JAVA_HOME explicitly.'
}

$resolvedAndroidSdk = $env:ANDROID_SDK_ROOT
if (-not $resolvedAndroidSdk) {
  $androidBaseDir = Join-Path $env:LOCALAPPDATA 'Android'
  $defaultAndroidSdk = Join-Path $androidBaseDir 'Sdk'
  if (Test-Path $defaultAndroidSdk) {
    $resolvedAndroidSdk = $defaultAndroidSdk
  }
}
if (-not $resolvedAndroidSdk -or -not (Test-Path $resolvedAndroidSdk)) {
  throw 'ANDROID_SDK_ROOT was not found. Install Android SDK or set ANDROID_SDK_ROOT explicitly.'
}

$env:JAVA_HOME = $resolvedJavaHome
$env:ANDROID_SDK_ROOT = $resolvedAndroidSdk
$env:ANDROID_HOME = $resolvedAndroidSdk
$env:APP_VERSION_NAME = $Version
if ($null -ne $VersionCode) {
  $env:APP_VERSION_CODE = [string]$VersionCode
} else {
  Remove-Item Env:APP_VERSION_CODE -ErrorAction SilentlyContinue
}

Push-Location $repoRoot
try {
  if ($ServerUrl.Trim()) {
    $env:CAP_SERVER_URL = $ServerUrl.Trim()
  } else {
    Remove-Item Env:CAP_SERVER_URL -ErrorAction SilentlyContinue
  }

  npm.cmd run mobile:android:sync
  if ($LASTEXITCODE -ne 0) {
    throw "mobile:android:sync failed with exit code $LASTEXITCODE"
  }

  Push-Location $androidRoot
  try {
    .\gradlew.bat assembleRelease
    if ($LASTEXITCODE -ne 0) {
      throw "assembleRelease failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }

  $resolvedOutputPath = Resolve-Path $OutputDir -ErrorAction SilentlyContinue
  $resolvedOutputDir = $null
  if ($resolvedOutputPath) {
    $resolvedOutputDir = $resolvedOutputPath.Path
  }
  if (-not $resolvedOutputDir) {
    $resolvedOutputDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDir)
    New-Item -ItemType Directory -Force -Path $resolvedOutputDir | Out-Null
  }

  $sourceApk = Join-Path $androidRoot 'app\build\outputs\apk\release\app-release.apk'
  if (-not (Test-Path $sourceApk)) {
    throw "Build artifact was not found: $sourceApk"
  }

  $apkName = "cx-codex-android-$Version.apk"
  $targetApk = Join-Path $resolvedOutputDir $apkName
  Copy-Item $sourceApk $targetApk -Force

  $hash = (Get-FileHash -Algorithm SHA256 $targetApk).Hash.ToLowerInvariant()
  $hashPath = "$targetApk.sha256"
  Set-Content -Path $hashPath -Value "$hash  $apkName" -Encoding ASCII

  Write-Host "APK: $targetApk"
  Write-Host "SHA256: $hash"
} finally {
  Pop-Location
}
