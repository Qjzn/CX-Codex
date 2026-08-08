[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Resolve-RepoPath {
  param([string]$RelativePath)
  return (Join-Path $repoRoot $RelativePath)
}

function Assert-FileExists {
  param([string]$RelativePath)

  $path = Resolve-RepoPath $RelativePath
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Missing required governance file: $RelativePath"
  }
}

function Assert-ContentIncludes {
  param(
    [string]$RelativePath,
    [string[]]$Needles
  )

  $path = Resolve-RepoPath $RelativePath
  $content = Get-Content -Raw -Encoding UTF8 -LiteralPath $path
  foreach ($needle in $Needles) {
    if (-not $content.Contains($needle)) {
      throw "$RelativePath is missing required text: $needle"
    }
  }
}

function Assert-ContentExcludes {
  param(
    [string]$RelativePath,
    [string[]]$Needles
  )

  $path = Resolve-RepoPath $RelativePath
  $content = Get-Content -Raw -Encoding UTF8 -LiteralPath $path
  foreach ($needle in $Needles) {
    if ($content.Contains($needle)) {
      throw "$RelativePath contains unfinished placeholder text: $needle"
    }
  }
}

function Assert-IssueTemplate {
  param([string]$RelativePath)

  Assert-FileExists $RelativePath
  Assert-ContentIncludes $RelativePath @(
    "name:",
    "description:",
    "title:",
    "labels:",
    "body:"
  )
}

function Get-JsonPropertyNames {
  param([object]$Value)

  if ($null -eq $Value) {
    return @()
  }
  return @($Value.PSObject.Properties | ForEach-Object { $_.Name })
}

function Assert-JsonPropertyMissing {
  param(
    [object]$Value,
    [string]$PropertyName,
    [string]$Context
  )

  if ((Get-JsonPropertyNames $Value) -contains $PropertyName) {
    throw "$Context must not include raw audit property '$PropertyName'."
  }
}

function Assert-RelativeRepoPath {
  param(
    [string]$Value,
    [string]$Context
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    throw "$Context must be a non-empty relative repository path."
  }
  if ([System.IO.Path]::IsPathRooted($Value) -or $Value -match "^[A-Za-z]:") {
    throw "$Context must not contain an absolute local path: $Value"
  }
}

function Assert-RepresentativeList {
  param(
    [object]$Value,
    [string]$Context
  )

  if ($null -eq $Value) {
    throw "$Context is missing."
  }
  if ($Value -is [string]) {
    $items = @($Value)
  } else {
    $items = @($Value)
  }
  if ($items.Count -gt 3) {
    throw "$Context must contain at most 3 representative items."
  }
  foreach ($item in $items) {
    if (-not ($item -is [string]) -or [string]::IsNullOrWhiteSpace($item)) {
      throw "$Context must contain only non-empty strings."
    }
  }
}

$requiredFiles = @(
  "README.md",
  "README.zh-CN.md",
  "PRODUCT_GOAL.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "SUPPORT.md",
  "RELEASE.md",
  "release-capabilities.json",
  "tests.md",
  "docs/app-server-schema-audit-summary.json",
  "docs/security-hardening.zh-CN.md",
  "docs/github-security-baseline-20260808.zh-CN.md",
  "docs/protocol-compatibility.zh-CN.md",
  "docs/app-server-protocol-matrix.zh-CN.md",
  "docs/openai-docs-review.zh-CN.md",
  "docs/release-readiness-audit.zh-CN.md",
  "docs/candidate-release-review.zh-CN.md",
  "docs/candidate-pr-review-pack.zh-CN.md",
  "docs/local-regression-checklist.zh-CN.md",
  "docs/local-regression-execution-20260705.zh-CN.md",
  "docs/changelog.zh-CN.md",
  "docs/roadmap.zh-CN.md",
  "docs/operations-plan.zh-CN.md",
  "docs/dependency-maintenance.zh-CN.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/dependabot.yml",
  ".github/FUNDING.yml",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/release.yml",
  ".github/release-body.md",
  "scripts/run-powershell-script.mjs",
  "scripts/uninstall-windows.ps1",
  "scripts/update-app-server-schema-audit-summary.mjs",
  "scripts/verify-release-artifacts.ps1",
  "scripts/verify-windows-productization.ps1"
  "src/cli/accessPolicy.ts"
  "src/server/diagnosticsRedaction.ts"
  "src/server/githubGitAuth.ts"
  "src/server/localFileAccessPolicy.ts"
  "src/server/privateFile.ts"
  "src/server/skillsSyncStateSecurity.ts"
  "src/server/windowsDataProtection.ts"
)

foreach ($file in $requiredFiles) {
  Assert-FileExists $file
}

$packageVersion = [string](Get-Content -LiteralPath (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json).version
$releaseNotesPath = "docs/release-notes-$packageVersion.zh-CN.md"
Assert-FileExists $releaseNotesPath

Assert-ContentIncludes "src/style.css" @(
  '@import "tailwindcss" source("./");'
)

Assert-ContentIncludes "vite.config.ts" @(
  "const buildSource =",
  '"import.meta.env.VITE_WORKTREE_NAME": JSON.stringify(buildSource)'
)

Assert-ContentExcludes "vite.config.ts" @(
  'spawnSync(',
  'function getWorktreeName'
)

Assert-ContentExcludes "tests.md" @(
  "待本轮验证后补充",
  "待验证后补充",
  "待补充验证"
)

$privacyFixtureFiles = @(
  "tests.md",
  "scripts/regression-7420-frontend.ps1",
  "scripts/verify-frontend-normalizers.mjs",
  "src/components/sidebar/SidebarRegressionFixture.vue",
  "src/components/content/ComposerRegressionFixture.vue",
  "src/components/content/CommandMenuRegressionFixture.vue",
  "src/components/content/ConversationRegressionFixture.vue"
)
foreach ($file in $privacyFixtureFiles) {
  Assert-ContentExcludes $file @(
    "C:/Users/"
  )
}

Assert-ContentIncludes "src/components/content/ConversationRegressionFixture.vue" @(
  "E:/workspace/",
  "C:/ExampleUser/",
  "示例用户"
)

Assert-ContentIncludes "scripts/verify-frontend-normalizers.mjs" @(
  "E:/workspace/",
  "示例用户"
)

Assert-ContentExcludes ".github/release-body.md" @(
  "2.2.7",
  "2.2.4",
  "这版适合谁升级",
  "本次版本重点",
  "./scripts/verify-release.ps1 -RequireCleanGit -SchemaAudit skip",
  "./scripts/package-release.ps1",
  "./scripts/verify-release-artifacts.ps1"
)

Assert-ContentExcludes ".github/workflows/release.yml" @(
  "./scripts/verify-release.ps1 -RequireCleanGit -SchemaAudit skip",
  "./scripts/package-release.ps1",
  "./scripts/verify-release-artifacts.ps1"
)

Assert-ContentExcludes ".github/FUNDING.yml" @(
  "These are supported funding model platforms",
  "Replace with"
)

$issueTemplates = @(
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/feature_request.yml",
  ".github/ISSUE_TEMPLATE/install_help.yml",
  ".github/ISSUE_TEMPLATE/protocol_compatibility.yml"
)

foreach ($template in $issueTemplates) {
  Assert-IssueTemplate $template
}

Assert-ContentIncludes "README.md" @(
  "Self-hosted OpenAI Codex Web UI and Android client bridge",
  "PRODUCT_GOAL.md",
  "docs/security-hardening.zh-CN.md",
  "docs/app-server-protocol-matrix.zh-CN.md",
  "docs/openai-docs-review.zh-CN.md",
  "docs/candidate-release-review.zh-CN.md",
  "docs/candidate-pr-review-pack.zh-CN.md",
  "docs/local-regression-checklist.zh-CN.md",
  "drift-recorded",
  "docs/dependency-maintenance.zh-CN.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "SUPPORT.md"
)

Assert-ContentIncludes "AGENTS.md" @(
  "PRODUCT_GOAL.md",
  "Do not mark the product goal complete"
)

Assert-ContentIncludes "PRODUCT_GOAL.md" @(
  "# CX-Codex 稳态产品化目标",
  "## 决策优先级",
  "## 当前剩余门槛",
  "## 不做什么",
  "## 完成门槛",
  "## 自主推进协议",
  "## 阻塞处理"
)

Assert-ContentIncludes "docs/github-security-baseline-20260808.zh-CN.md" @(
  "Branch protection",
  "Dependabot alerts",
  "Private vulnerability reporting",
  "Secret scanning alert #1",
  "build",
  "windows-bootstrap-smoke"
)

Assert-ContentIncludes "src/server/localFileAccessPolicy.ts" @(
  "resolveWorkspaceLocalPath",
  "outside-workspace",
  "realpath",
  "readWorkspaceRootsState"
)

Assert-ContentIncludes "src/server/httpServer.ts" @(
  "resolveAuthorizedLocalPath",
  "该路径不在已登记的工作区目录内。"
)

Assert-ContentIncludes "src/cli/accessPolicy.ts" @(
  "assertPasswordProtectedBind",
  "Password protection is required when binding outside localhost",
  "127"
)

Assert-ContentIncludes "src/server/diagnosticsRedaction.ts" @(
  "redactDiagnosticsValue",
  "redactSensitiveLogString",
  "[REDACTED]"
)

Assert-ContentIncludes "src/server/githubGitAuth.ts" @(
  "GIT_TERMINAL_PROMPT",
  "core.hooksPath=/dev/null",
  "credential.helper=",
  "CX_CODEX_GITHUB_GIT_TOKEN"
)

Assert-ContentIncludes "src/server/privateFile.ts" @(
  "mode: 0o600",
  "chmod(path, 0o600)"
)

Assert-ContentIncludes "src/server/skillsSyncStateSecurity.ts" @(
  "windows-dpapi-current-user-v1",
  "delete stored.githubToken",
  "needsMigration"
)

Assert-ContentIncludes "src/server/windowsDataProtection.ts" @(
  "System.Security.Cryptography.ProtectedData",
  "DataProtectionScope]::CurrentUser",
  "System32",
  "WindowsPowerShell",
  "-NoProfile"
)

Assert-ContentIncludes "src/commandResolution.ts" @(
  "resolveGitCommand",
  "resolveRipgrepCommand",
  "getAbsolutePathCommandCandidates",
  "isAbsolute(directory)"
)

Assert-ContentIncludes "src/server/appServerRollbackGit.ts" @(
  "resolveGitCommand",
  "getRollbackGitCommand"
)

Assert-ContentExcludes "src/server/appServerRollbackGit.ts" @(
  "runCommand('git'",
  "runCommandCapture('git'",
  "runCommandWithOutput('git'"
)

Assert-ContentIncludes "src/server/worktreeRoutes.ts" @(
  "resolveGitCommand",
  "gitCommand?: string",
  "!isAbsolute(gitCommand)"
)

Assert-ContentExcludes "src/server/worktreeRoutes.ts" @(
  "captureGitCommand('git'",
  "runGitCommand('git'"
)

Assert-ContentIncludes "src/server/skillsRoutes.ts" @(
  "resolveGitCommand",
  "decodeSkillsSyncStateFromStorage",
  "encodeSkillsSyncStateForStorage"
)

Assert-ContentExcludes "src/server/skillsRoutes.ts" @(
  "https://x-access-token:",
  "encodeURIComponent(token)}@github.com",
  "runCommand('git'",
  "runCommandWithOutput('git'"
)

Assert-ContentIncludes "CODE_OF_CONDUCT.md" @(
  "行为准则",
  "SECURITY.md",
  "SUPPORT.md",
  "Codex sandbox / approval",
  "脱敏"
)

Assert-ContentIncludes "CONTRIBUTING.md" @(
  "CODE_OF_CONDUCT.md",
  "docs/openai-docs-review.zh-CN.md",
  ".github/dependabot.yml",
  "docs/dependency-maintenance.zh-CN.md",
  "Pull Request 要求"
)

Assert-ContentIncludes "docs/openai-docs-review.zh-CN.md" @(
  "最近审查时间：",
  "node %USERPROFILE%\.codex\skills\.system\openai-docs\scripts\fetch-codex-manual.mjs",
  "## 官方来源清单",
  "## 当前审查结论",
  "https://developers.openai.com/codex/app-server",
  "https://developers.openai.com/codex/agent-approvals-security",
  "https://developers.openai.com/codex/remote-connections",
  "https://developers.openai.com/codex/open-source",
  "https://developers.openai.com/codex/enterprise/access-tokens",
  "https://developers.openai.com/api/docs/guides/speech-to-text",
  "experimentalApi",
  "npm.cmd run audit:app-server-schemas",
  "docs/app-server-schema-audit-summary.json",
  "docs/app-server-protocol-matrix.zh-CN.md",
  "App Server transport",
  "auto-review",
  "不能被宣传为默认稳定能力",
  "不能展示原始非法 URL",
  "不能直接声明已经对齐最新 App Server 协议",
  "OpenAI Docs MCP",
  "不适用于 Realtime API",
  "gpt-4o-transcribe-diarize",
  "diarized_json",
  "chunking_strategy=auto",
  "25 MB"
)

Assert-ContentIncludes "docs/dependency-maintenance.zh-CN.md" @(
  ".github/dependabot.yml",
  "npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip",
  "npm.cmd run audit:app-server-schemas",
  "frontend normalizer smoke",
  "Codex App Server",
  "OpenAI API",
  "major 更新不自动合并"
)

Assert-ContentIncludes "README.md" @(
  "CX_CODEX_APP_SERVER_APPROVAL_POLICY",
  "CODEXUI_APP_SERVER_APPROVAL_POLICY",
  "CX_CODEX_APP_SERVER_SANDBOX_MODE",
  "CODEXUI_APP_SERVER_SANDBOX_MODE",
  '默认 `on-request`',
  '默认 `workspace-write`',
  "CX_CODEX_APP_SERVER_APPROVAL_POLICY=never",
  "CX_CODEX_APP_SERVER_SANDBOX_MODE=danger-full-access",
  "CODEXUI_OPENAI_API_KEY",
  "CODEXUI_OPENAI_TRANSCRIBE_MODEL",
  "CODEXUI_OPENAI_TRANSCRIBE_MAX_BYTES",
  "CX_CODEX_OPENAI_TRANSCRIBE_URL",
  "CODEXUI_OPENAI_TRANSCRIBE_URL",
  "OPENAI_TRANSCRIBE_URL",
  "chunking_strategy=auto",
  "25000000",
  "endpoint 配置/有效性布尔值",
  "原始非法 URL"
)

Assert-ContentIncludes "SECURITY.md" @(
  "docs/security-hardening.zh-CN.md",
  "App Server transport",
  "experimental / unsupported",
  "sandbox / approval"
)

Assert-ContentIncludes "RELEASE.md" @(
  "npm.cmd run verify:release",
  "自动选择可用的 PowerShell",
  "SchemaAudit warn",
  "frontend normalizer smoke",
  "CLI CJS launcher smoke",
  "Release package smoke",
  "NPM package smoke",
  "npm pack --dry-run --json",
  "PRODUCT_GOAL.md",
  "docs/app-server-protocol-matrix.zh-CN.md",
  "docs/app-server-schema-audit-summary.json",
  "docs/candidate-release-review.zh-CN.md",
  "历史审查材料只用于追溯",
  "candidate-reviewed",
  "verify:release-artifacts",
  'zip / APK 与 `.sha256`',
  "docs/security-hardening.zh-CN.md",
  "docs/release-template.zh-CN.md"
)

Assert-ContentExcludes "RELEASE.md" @(
  "正式宣传前必须对照 [docs/candidate-release-review.zh-CN.md]",
  "对照 [docs/candidate-release-review.zh-CN.md] 检查 README"
)

Assert-ContentIncludes "scripts/verify-release.ps1" @(
  "CX_CODEX_POWERSHELL_COMMAND",
  "CLI CJS launcher smoke",
  "cli cjs launcher smoke ok",
  "spawnSync(process.execPath",
  "Release package smoke",
  "release package smoke ok",
  "Frontend normalizer smoke",
  "scripts/verify-frontend-normalizers.mjs",
  "scripts/verify-server-modules.mjs",
  "Initialize-NpmVerificationEnvironment",
  "output/npm-cache",
  "npm_config_update_notifier",
  "Resolve-ReleasePackageSmokeDir",
  "Join-Path `$repoRoot `"output`"",
  "release-package-smoke",
  "GetFullPath",
  "StartsWith(`$outputPrefix",
  "Release package smoke output escaped repository output directory",
  "Remove-Item -LiteralPath `$packageSmokeDir -Recurse -Force",
  "Release artifact checksum smoke",
  "Release artifact checksum smoke skipped",
  "Assert-ChecksumMatches",
  "checksum hash does not match zip",
  "package:release",
  "verify:release-artifacts",
  "Assert-ZipContains",
  "PRODUCT_GOAL.md",
  "NPM package smoke",
  "npm package smoke ok",
  "Assert-NpmPackDryRun",
  "npm pack dry-run",
  "docs\app-server-protocol-matrix.zh-CN.md",
  "docs\changelog.zh-CN.md",
  "docs\dependency-maintenance.zh-CN.md",
  "docs\openai-docs-review.zh-CN.md",
  "docs\operations-plan.zh-CN.md",
  "docs\protocol-compatibility.zh-CN.md",
  "docs\release-readiness-audit.zh-CN.md",
  "docs\candidate-release-review.zh-CN.md",
  "docs\candidate-pr-review-pack.zh-CN.md",
  "docs\local-regression-checklist.zh-CN.md",
  "docs\local-regression-execution-20260705.zh-CN.md",
  "docs\roadmap.zh-CN.md",
  "docs\security-hardening.zh-CN.md",
  "scripts\package-release.ps1",
  "scripts\verify-frontend-normalizers.mjs",
  "scripts\verify-governance.ps1",
  "scripts\verify-release.ps1",
  "tests.md",
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
  "src\server\appServerThreadReadParams.ts",
  "src\server\appServerThreadRuntimeSnapshot.ts",
  "src\server\appServerProcess.ts",
  "src\server\appServerProcessServerRequests.ts",
  "src\server\codexBridgeRequestError.ts",
  "src\server\codexBridgeMiddlewareDispose.ts",
  "src\server\codexBridgeMiddlewareState.ts",
  "src\server\codexBridgeNotificationRuntime.ts",
  "src\server\codexBridgeRuntimeOperations.ts",
  "src\server\codexBridgeRouteHandlers.ts",
  "src\server\codexBridgeRouteDispatch.ts",
  "src\server\codexBridgeSharedState.ts",
  "src\server\codexAppServerBridge.ts",
  "src\server\composerFileSearchRoutes.ts",
  "src\server\diagnosticsRoutes.ts",
  "src\server\fileUploadRoute.ts",
  "src\server\githubTrendingRoutes.ts",
  "src\server\localStateRoutes.ts",
  "src\server\appServerJsonRpcWriter.ts",
  "src\server\appServerLineDispatcher.ts",
  "src\server\notificationReplayRoute.ts",
  "src\server\notificationSseRoute.ts",
  "src\server\appServerPendingRpcStore.ts",
  "src\server\appServerProcessCleanup.ts",
  "src\server\appServerProcessHandlers.ts",
  "src\server\appServerSessionCleanup.ts",
  "src\server\appServerServerRequestHandler.ts",
  "src\server\appServerProcessTermination.ts",
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

Assert-ContentIncludes "scripts/soak-7420.ps1" @(
  '[int]$MaxQueuedRpc = 0',
  '[int]$MaxPendingRpc = 0',
  '[int]$MaxConsecutiveFailures = 0',
  'appServerReady',
  'runtimeUncertainRequestCount',
  'appServerPidChangeCount',
  'runtimeStreamChangeCount',
  'runtimeReplayStreamMismatchCount',
  'publicHealthChecked',
  'publicAuthChecked',
  'new slow thread/list RPC detected'
)

Assert-ContentIncludes "scripts/verify-frontend-normalizers.mjs" @(
  "import * as esbuild from 'esbuild'",
  "mkdtempSync(join(outputBase, 'run-'))",
  "CX_CODEX_KEEP_FRONTEND_NORMALIZER_SMOKE_OUTPUT",
  "frontend normalizer smoke ok"
)

Assert-ContentIncludes "scripts/verify-server-modules.mjs" @(
  "mkdtempSync(join(outputBase, 'run-'))",
  "CX_CODEX_KEEP_SERVER_MODULE_SMOKE_OUTPUT",
  "join(repoRoot, 'scripts', 'server-module-smoke.ts')"
)

$verifyServerModules = Get-Content -Raw -Encoding UTF8 -LiteralPath (Resolve-RepoPath "scripts/verify-server-modules.mjs")
$manualServerModuleIncludeCount = ([regex]::Matches($verifyServerModules, "join\(repoRoot, 'src', 'server'")).Count
if ($manualServerModuleIncludeCount -ne 0) {
  throw "scripts/verify-server-modules.mjs should compile from scripts/server-module-smoke.ts and follow its import graph, not maintain a manual src/server include list."
}

Assert-ContentIncludes "scripts/server-module-smoke.ts" @(
  "handleComposerFileSearchRoutes",
  "smokeComposerFileSearchRoutes",
  "handleFileUploadRoute",
  "smokeFileUploadRoute",
  "writeCodexBridgeRequestError",
  "smokeCodexBridgeRequestError",
  "disposeCodexBridgeMiddlewareResources",
  "smokeCodexBridgeMiddlewareDispose",
  "runCodexBridgeRouteHandlers",
  "smokeCodexBridgeRouteDispatch",
  "handleWorkspaceMetaRoutes",
  "smokeWorkspaceMetaRoutes",
  "handleProjectRootRoutes",
  "smokeProjectRootRoutes",
  "handleRpcProxyRoute",
  "smokeRpcProxyRoute",
  "handleThreadRoutes",
  "smokeThreadRoutes",
  "handleStatusRoutes",
  "smokeStatusRoutes",
  "handleGithubTrendingRoutes",
  "smokeGithubTrendingRoutes",
  "handleDiagnosticsRoutes",
  "smokeDiagnosticsRoutes",
  "smokeGithubGitAuth",
  "synthetic-github-token-value-1234567890",
  "protectWindowsCurrentUserText",
  "Object.prototype.hasOwnProperty.call(storedWindowsState, 'githubToken')",
  "resolveRipgrepCommand",
  "commandCalls.every((call) => isAbsolute(call.command))",
  "handleNotificationSseRoute",
  "smokeNotificationSseRoute",
  "handleRuntimeActionRoutes",
  "smokeRuntimeActionRoutes",
  "concurrentStore.search('concurrent', 10)",
  "clearDuringBuildStore.clear()",
  "startRuntimeTurnWithAppServer",
  "smokeAppServerRuntimeStart",
  "interruptRuntimeTurnWithAppServer",
  "smokeAppServerRuntimeInterrupt",
  "persistAppServerRuntimeSnapshot",
  "smokeAppServerRuntimeSnapshotPersistence",
  "handleRuntimeStateRoutes",
  "smokeRuntimeStateRoutes",
  "runRuntimeReconcileBatch",
  "smokeAppServerRuntimeReconcileScheduler",
  "readAppServerThreadRuntimeSnapshot",
  "smokeAppServerThreadRuntimeSnapshot",
  "readAppServerLocalRuntimeSnapshot",
  "smokeAppServerLocalRuntimeSnapshot",
  "captureAppServerNotificationState",
  "smokeAppServerNotificationState",
  "syncBridgeNotificationRuntimeState",
  "smokeAppServerNotificationRuntimeSync",
  "handleTranscriptionRoutes",
  "smokeTranscriptionRoutes",
  "handleServerRequestRoutes",
  "smokeServerRequestRoutes",
  "createServerRequestResolvedNotification",
  "isImmediateServerRequestPolicyDecision",
  "sendAppServerJsonRpcLine",
  "smokeAppServerJsonRpcWriter",
  "readAppServerJsonRpcLineEvent",
  "handleWorktreeRoutes",
  "smokeWorktreeRoutes",
  "handleLocalStateRoutes",
  "smokeLocalStateRoutes",
  "readNotificationReplayQuery",
  "handleNotificationReplayRoute",
  "smokeNotificationReplayRoute",
  "createAppServerRpcTimeoutRecoveryDecision",
  "smokeAppServerRpcTimeoutRecovery",
  "readThreadReadIncludeTurnsForMethod",
  "smokeAppServerThreadReadParams",
  "AppServerPendingRpcStore",
  "smokeAppServerPendingRpcStore",
  "AppServerProcess",
  "smokeAppServerProcess",
  "AppServerProcessServerRequests",
  "smokeAppServerProcessServerRequests",
  "cleanupAppServerProcessRuntime",
  "smokeAppServerProcessCleanup",
  "attachAppServerProcessHandlers",
  "smokeAppServerProcessHandlers",
  "clearAppServerSessionStores",
  "smokeAppServerSessionCleanup",
  "terminateAppServerProcess",
  "smokeAppServerProcessTermination",
  "createCodexBridgeMiddlewareState",
  "smokeCodexBridgeMiddlewareState",
  "createCodexBridgeNotificationRuntime",
  "smokeCodexBridgeNotificationRuntime",
  "createCodexBridgeRuntimeOperations",
  "smokeCodexBridgeRuntimeOperations",
  "createCodexBridgeRouteHandlers",
  "smokeCodexBridgeRouteHandlers",
  "getCodexBridgeSharedState",
  "smokeCodexBridgeSharedState"
)

Assert-ContentIncludes "scripts/verify-governance.ps1" @(
  "Assert-ContentExcludes `"tests.md`"",
  "unfinished placeholder text",
  "待本轮验证后补充"
)

Assert-ContentIncludes "scripts/verify-release-artifacts.ps1" @(
  "Release artifact checksum verification passed.",
  "No release .zip or .apk artifacts found",
  "Release artifact is missing checksum",
  "No .sha256 files found",
  "Checksum hash does not match artifact",
  "Checksum file must reference an artifact file name only"
)

Assert-ContentIncludes "package.json" @(
  '"package:release": "node ./scripts/run-powershell-script.mjs ./scripts/package-release.ps1"',
  '"setup:windows": "node ./scripts/run-powershell-script.mjs ./setup.ps1"',
  '"test:7420": "node ./scripts/run-powershell-script.mjs ./scripts/regression-7420.ps1"',
  '"test:7420:frontend": "node ./scripts/run-powershell-script.mjs ./scripts/regression-7420-frontend.ps1"',
  '"test:7420:soak": "node ./scripts/run-powershell-script.mjs ./scripts/soak-7420.ps1"',
  '"audit:app-server-schemas": "node ./scripts/run-powershell-script.mjs ./scripts/audit-app-server-schemas.ps1"',
  '"audit:app-server-schemas:update-summary": "node ./scripts/update-app-server-schema-audit-summary.mjs"',
  '"verify:governance": "node ./scripts/run-powershell-script.mjs ./scripts/verify-governance.ps1"',
  '"verify:dependency-security": "node ./scripts/verify-dependency-security.mjs"',
  '"verify:windows-productization": "node ./scripts/run-powershell-script.mjs ./scripts/verify-windows-productization.ps1"',
  '"verify:release": "node ./scripts/run-powershell-script.mjs ./scripts/verify-release.ps1"',
  '"verify:release-artifacts": "node ./scripts/run-powershell-script.mjs ./scripts/verify-release-artifacts.ps1"',
  '"esbuild":'
)

Assert-ContentIncludes "scripts/verify-dependency-security.mjs" @(
  "registry.npmjs.org",
  "requires npm 9 or newer for lockfile v3",
  "--audit-level=low",
  "0 vulnerabilities"
)

Assert-ContentIncludes "local-preview.html" @(
  'http-equiv="Content-Security-Policy"',
  "script-src 'self'",
  "object-src 'none'"
)

Assert-ContentExcludes "src/localPreview.ts" @(
  "pdf_viewer",
  "PDFScriptingManager",
  "AnnotationLayer"
)

Assert-ContentIncludes "scripts/regression-7420-frontend.ps1" @(
  "Assert-LiveModelSelector",
  "model/list",
  "defaultMarkerCount",
  "live model selector"
)

Assert-ContentIncludes "scripts/update-app-server-schema-audit-summary.mjs" @(
  "OFFICIAL_DOCS_URL",
  "representativeAdded",
  "drift-recorded",
  "baseline-matched",
  "Do not copy generated output directories"
)

Assert-ContentIncludes "scripts/run-powershell-script.mjs" @(
  "PROBE_TIMEOUT_MS",
  "CX_CODEX_POWERSHELL_COMMAND",
  "Using PowerShell:"
)

Assert-ContentIncludes "scripts/package-release.ps1" @(
  ".github\ISSUE_TEMPLATE\protocol_compatibility.yml",
  ".github\PULL_REQUEST_TEMPLATE.md",
  ".github\dependabot.yml",
  ".github\FUNDING.yml",
  ".github\release-body.md",
  ".github\workflows\release.yml",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "SUPPORT.md",
  "tests.md",
  "release-capabilities.json",
  "vite.config.ts",
  "vite.local-preview.config.ts"
)

$releaseCapabilities = Get-Content -LiteralPath (Join-Path $repoRoot "release-capabilities.json") -Raw | ConvertFrom-Json
if (
  $releaseCapabilities.schemaVersion -ne 1 -or
  $releaseCapabilities.installerContractVersion -lt 1 -or
  -not $releaseCapabilities.features.remoteQuick -or
  -not $releaseCapabilities.features.jsonOutput -or
  -not $releaseCapabilities.features.stableJsonContract -or
  -not $releaseCapabilities.features.windowsUninstall
) {
  throw "release-capabilities.json does not declare the required Windows productization contract."
}

Assert-ContentIncludes ".github/dependabot.yml" @(
  "version: 2",
  'package-ecosystem: "npm"',
  'package-ecosystem: "github-actions"',
  'timezone: "Asia/Shanghai"',
  "open-pull-requests-limit:",
  "groups:"
)

Assert-ContentIncludes ".github/FUNDING.yml" @(
  "Funding is intentionally not configured",
  "custom: []"
)

Assert-ContentIncludes ".github/PULL_REQUEST_TEMPLATE.md" @(
  "npm run verify:release",
  "docs/security-hardening.zh-CN.md",
  "隐私与安全"
)

Assert-ContentIncludes ".github/release-body.md" @(
  "CX-Codex Release",
  "docs/changelog.zh-CN.md",
  "docs/security-hardening.zh-CN.md",
  "PRODUCT_GOAL.md",
  "docs/openai-docs-review.zh-CN.md",
  "docs/app-server-protocol-matrix.zh-CN.md",
  "docs/app-server-schema-audit-summary.json",
  "docs/candidate-release-review.zh-CN.md",
  "historical traceability only",
  "CX-Codex-<tag>.zip",
  "cx-codex-android-<tag>.apk",
  "stable official release certificate",
  "npm run verify:release -- -RequireCleanGit -SchemaAudit skip",
  "npm run package:release -- -Version <tag> -OutputDir <release-dir>",
  "npm run verify:release-artifacts -- -OutputDir <release-dir>",
  "npm.cmd run verify:release -- -RequireCleanGit -SchemaAudit warn",
  "candidate-reviewed rather than fully aligned",
  "must not include private accounts"
)

Assert-ContentExcludes ".github/release-body.md" @(
  "Review [docs/candidate-release-review.zh-CN.md]"
)

Assert-ContentIncludes ".github/workflows/release.yml" @(
  "Verify release metadata",
  "Require stable tag from main",
  "git merge-base --is-ancestor `$env:GITHUB_SHA origin/main",
  "Official release tag `$env:GITHUB_REF_NAME must point to a commit on main.",
  "Release tag `$env:GITHUB_REF_NAME does not match package version `$packageVersion.",
  "docs/release-notes-`$tagVersion.zh-CN.md",
  "Require Android release signing secrets",
  "keystorePath.Replace('\', '/')",
  "Verify Android release signature",
  "ANDROID_RELEASE_CERT_SHA256",
  'body_path: ${{ steps.release-metadata.outputs.release_notes_path }}'
)

Assert-ContentExcludes ".github/workflows/release.yml" @(
  "assembleDebug",
  "android-debug",
  "debug APK fallback"
)

Assert-ContentExcludes ".github/release-body.md" @(
  "cx-codex-android-debug-<tag>.apk",
  "debug APK fallback"
)

Assert-ContentIncludes $releaseNotesPath @(
  "CX-Codex $packageVersion",
  "RemoteQuick",
  "JsonOutput",
  "SHA-256",
  "uninstall-windows.ps1",
  "候选"
)

Assert-ContentIncludes ".github/ISSUE_TEMPLATE/protocol_compatibility.yml" @(
  "Codex CLI / App Server 版本",
  "App Server transport",
  "最小脱敏 payload"
)

Assert-ContentIncludes "docs/security-hardening.zh-CN.md" @(
  "https://developers.openai.com/codex/app-server",
  "https://developers.openai.com/codex/agent-approvals-security",
  "https://developers.openai.com/codex/remote-connections",
  "App Server transport",
  "sandbox / approval"
)

Assert-ContentIncludes "docs/security-hardening.zh-CN.md" @(
  "src/server/appServerLaunch.ts",
  "legacy high-trust",
  '默认使用 `on-request` 与 `workspace-write`',
  "CX_CODEX_APP_SERVER_APPROVAL_POLICY=never",
  "CX_CODEX_APP_SERVER_SANDBOX_MODE=danger-full-access",
  "不展示原始环境变量值"
)

Assert-ContentIncludes "docs/changelog.zh-CN.md" @(
  "appServerLaunch.ts",
  "legacy high-trust approval/sandbox 策略",
  "on-request + workspace-write",
  "CODEXUI_OPENAI_API_KEY",
  "chunking_strategy=auto",
  "25 MB",
  "原始非法 URL",
  "item/autoApprovalReview/started",
  "脱敏权限请求标记",
  "脱敏后的有效策略快照"
)

Assert-ContentIncludes "scripts/server-module-smoke.ts" @(
  "item/autoApprovalReview/started",
  "item/autoApprovalReview/completed",
  "networkAccess",
  "applyPatch",
  "permissionNetworkRequested: true",
  "permissionFileSystemRequested: true",
  "actionFileCount: 2",
  "api.secret.example",
  "serializedGuardianSnapshot.includes('api.secret.example')"
)

Assert-ContentIncludes "docs/protocol-compatibility.zh-CN.md" @(
  "Codex rich clients",
  "wire 上省略",
  "`"jsonrpc`":`"2.0`"",
  "stdio",
  "JSONL",
  "experimental and unsupported",
  "GET /readyz",
  "GET /healthz",
  "--ws-token-file",
  "-32001",
  "initialize",
  "initialized",
  "当前运行的 Codex 版本精确对应",
  "diarize-only 的",
  "chunking_strategy",
  "chunking_strategy=auto",
  "25000000",
  "endpoint 配置/有效性布尔值",
  "原始非法 URL"
)

Assert-ContentIncludes "docs/app-server-protocol-matrix.zh-CN.md" @(
  "Codex App Server",
  "schema audit",
  "docs/app-server-schema-audit-summary.json",
  "共享一次生成结果",
  "thread",
  "MCP",
  "item/autoApprovalReview/started",
  "脱敏权限请求标记",
  "network target",
  "permission profile 主动管理"
)

Assert-ContentIncludes "docs/release-readiness-audit.zh-CN.md" @(
  "Release Readiness",
  "main...origin/main [ahead",
  "paused",
  "19 小时 20 分钟",
  "output/app-server-schema-audit/20260705-093004",
  "drift-recorded",
  "不能声明完全对齐最新官方协议",
  "P0 稳定性保护",
  "P1 协议能力补齐",
  "P2 安全敏感能力",
  "P3 实验能力",
  "不建议继续让当前长目标连续自动运行"
)

Assert-ContentIncludes "docs/candidate-release-review.zh-CN.md" @(
  "Candidate Release Review",
  "历史快照",
  "不代表 2026-08-08 当前状态",
  "docs/candidate-pr-review-pack.zh-CN.md",
  "npm.cmd run verify:release -- -RequireCleanGit -SchemaAudit warn",
  "output/app-server-schema-audit/20260705-102346",
  "drift-recorded",
  "P0：候选发布前必须保持的稳定性保护",
  "P1：下一轮应补齐的协议能力",
  "P2：安全敏感能力，不能作为默认稳定入口",
  "可以公开宣传",
  "必须标注实验、只读诊断或未完成",
  "不能直接宣布为最终公开稳定版",
  "WebSocket transport 仍是 experimental and unsupported",
  "gpt-4o-transcribe-diarize"
)

Assert-ContentIncludes "docs/candidate-pr-review-pack.zh-CN.md" @(
  "Candidate Branch / PR Review Pack",
  "历史快照",
  "均不代表当前状态",
  "codex/candidate-release-review",
  "Prepare CX-Codex candidate release review and App Server governance",
  "npm.cmd run verify:release -- -RequireCleanGit -SchemaAudit warn",
  "output/app-server-schema-audit/20260705-103138",
  "P0: Preserve App Server drift tolerance",
  "P1: Design controlled support",
  "P2: Define security design",
  "candidate-reviewed rather than fully aligned",
  "git push -u origin codex/candidate-release-review",
  "gh pr create --base main --head codex/candidate-release-review",
  "git merge --no-ff codex/candidate-release-review",
  "不要把 `output/app-server-schema-audit/` 原始生成目录提交进 PR"
)

Assert-ContentIncludes "README.md" @(
  "历史 Candidate release 审查（2026-07-05）",
  "历史 Candidate PR review pack（2026-07-05）"
)

Assert-ContentIncludes "docs/local-regression-checklist.zh-CN.md" @(
  "当前发布事实源",
  "历史 Candidate 追溯",
  "不能作为当前发布验收依据"
)

Assert-ContentIncludes "docs/local-regression-checklist.zh-CN.md" @(
  "本地完整回归测试清单",
  "P0 自动化门禁",
  "P0 本地 7420 服务验证",
  "P1 协议和发布治理",
  "P1 7420 前端自动化",
  "P2 手工功能回归",
  "P2 长时稳定性",
  "npm.cmd run verify:release -- -RequireCleanGit -SchemaAudit warn",
  "npm.cmd run test:7420 -- -SkipBrowser",
  "npm.cmd run test:7420:soak -- -DurationSeconds 60",
  "不能宣称已完成视觉/真机回归"
)

Assert-ContentIncludes "docs/local-regression-execution-20260705.zh-CN.md" @(
  "本地回归执行记录 2026-07-05",
  "codex/candidate-release-review",
  "C:\src\CX-Codex\dist-cli\index.js",
  "P0-13 事件回放端点",
  "P0-14 短时浸泡",
  "P1-7 至 P1-10 浏览器自动化",
  "Android 真机回归、语音转写实测和 2 小时长浸泡尚未执行"
)

Assert-ContentIncludes "src/server/appServerMethodCatalog.ts" @(
  "catalogCache",
  "catalogPromise",
  "Promise.all",
  "ClientRequest.json",
  "ServerNotification.json"
)

$schemaAuditSummaryPath = Resolve-RepoPath "docs/app-server-schema-audit-summary.json"
$schemaAuditSummary = Get-Content -Raw -Encoding UTF8 -LiteralPath $schemaAuditSummaryPath | ConvertFrom-Json
if ($schemaAuditSummary.officialDocsUrl -ne "https://developers.openai.com/codex/app-server") {
  throw "docs/app-server-schema-audit-summary.json has an unexpected officialDocsUrl."
}
if ($schemaAuditSummary.reviewStatus -ne "drift-recorded") {
  throw "docs/app-server-schema-audit-summary.json reviewStatus must be drift-recorded until the schema baseline is intentionally updated."
}
if ($schemaAuditSummary.auditCommand -ne "npm.cmd run audit:app-server-schemas") {
  throw "docs/app-server-schema-audit-summary.json auditCommand must document the canonical audit command."
}
Assert-JsonPropertyMissing $schemaAuditSummary "repository" "docs/app-server-schema-audit-summary.json"
Assert-JsonPropertyMissing $schemaAuditSummary "generated" "docs/app-server-schema-audit-summary.json"
Assert-RelativeRepoPath $schemaAuditSummary.auditOutput "docs/app-server-schema-audit-summary.json auditOutput"
Assert-RelativeRepoPath $schemaAuditSummary.baseline.typescript "docs/app-server-schema-audit-summary.json baseline.typescript"
Assert-RelativeRepoPath $schemaAuditSummary.baseline.json "docs/app-server-schema-audit-summary.json baseline.json"
foreach ($key in @("typescriptRoot", "typescriptV2", "jsonRoot", "jsonV2")) {
  $row = $schemaAuditSummary.comparison.$key
  if (-not $row) {
    throw "docs/app-server-schema-audit-summary.json missing comparison.$key."
  }
  Assert-JsonPropertyMissing $row "added" "docs/app-server-schema-audit-summary.json comparison.$key"
  Assert-JsonPropertyMissing $row "removed" "docs/app-server-schema-audit-summary.json comparison.$key"
  Assert-RepresentativeList $row.representativeAdded "docs/app-server-schema-audit-summary.json comparison.$key.representativeAdded"
  Assert-RepresentativeList $row.representativeRemoved "docs/app-server-schema-audit-summary.json comparison.$key.representativeRemoved"
  foreach ($field in @("baselineCount", "generatedCount", "addedCount", "removedCount")) {
    if ($null -eq $row.$field) {
      throw "docs/app-server-schema-audit-summary.json missing comparison.$key.$field."
    }
  }
}

Assert-ContentIncludes ".github/workflows/ci.yml" @(
  "- beta",
  "npm run verify:dependency-security",
  "npm run verify:release -- -SchemaAudit skip",
  "npm run verify:windows-productization",
  "./scripts/uninstall-windows.ps1"
)

Assert-ContentIncludes ".github/workflows/release.yml" @(
  "npm run verify:dependency-security",
  "npm run verify:release -- -RequireCleanGit -SchemaAudit skip",
  "npm run package:release -- -Version",
  "npm run verify:release-artifacts -- -OutputDir"
)

Write-Host "Governance docs check passed."
