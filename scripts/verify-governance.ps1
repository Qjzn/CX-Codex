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
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "SUPPORT.md",
  "RELEASE.md",
  "tests.md",
  "docs/app-server-schema-audit-summary.json",
  "docs/security-hardening.zh-CN.md",
  "docs/protocol-compatibility.zh-CN.md",
  "docs/app-server-protocol-matrix.zh-CN.md",
  "docs/openai-docs-review.zh-CN.md",
  "docs/changelog.zh-CN.md",
  "docs/roadmap.zh-CN.md",
  "docs/operations-plan.zh-CN.md",
  "docs/dependency-maintenance.zh-CN.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/dependabot.yml",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/release.yml",
  ".github/release-body.md",
  "scripts/run-powershell-script.mjs",
  "scripts/update-app-server-schema-audit-summary.mjs",
  "scripts/verify-release-artifacts.ps1"
)

foreach ($file in $requiredFiles) {
  Assert-FileExists $file
}

Assert-ContentExcludes "tests.md" @(
  "待本轮验证后补充",
  "待验证后补充",
  "待补充验证"
)

Assert-ContentExcludes ".github/release-body.md" @(
  "2.2.7",
  "2.2.4",
  "这版适合谁升级",
  "本次版本重点"
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
  "docs/security-hardening.zh-CN.md",
  "docs/app-server-protocol-matrix.zh-CN.md",
  "docs/openai-docs-review.zh-CN.md",
  "docs/dependency-maintenance.zh-CN.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "SUPPORT.md"
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
  "gpt-4o-transcribe-diarize",
  "diarized_json",
  "chunking_strategy=auto",
  "25 MB"
)

Assert-ContentIncludes "docs/dependency-maintenance.zh-CN.md" @(
  ".github/dependabot.yml",
  "npm.cmd run verify:release -- -AllowDirty -SchemaAudit skip",
  "npm.cmd run audit:app-server-schemas",
  "Codex App Server",
  "OpenAI API",
  "major 更新不自动合并"
)

Assert-ContentIncludes "README.md" @(
  "CX_CODEX_APP_SERVER_APPROVAL_POLICY",
  "CODEXUI_APP_SERVER_APPROVAL_POLICY",
  "CX_CODEX_APP_SERVER_SANDBOX_MODE",
  "CODEXUI_APP_SERVER_SANDBOX_MODE",
  "CX_CODEX_APP_SERVER_APPROVAL_POLICY=on-request",
  "CX_CODEX_APP_SERVER_SANDBOX_MODE=workspace-write",
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
  "sandbox / approval"
)

Assert-ContentIncludes "RELEASE.md" @(
  "npm.cmd run verify:release",
  "自动选择可用的 PowerShell",
  "SchemaAudit warn",
  "CLI CJS launcher smoke",
  "Release package smoke",
  "NPM package smoke",
  "npm pack --dry-run --json",
  "verify:release-artifacts",
  'zip / APK 与 `.sha256`',
  "docs/security-hardening.zh-CN.md",
  "docs/release-template.zh-CN.md"
)

Assert-ContentIncludes "scripts/verify-release.ps1" @(
  "CX_CODEX_POWERSHELL_COMMAND",
  "CLI CJS launcher smoke",
  "cli cjs launcher smoke ok",
  "spawnSync(process.execPath",
  "Release package smoke",
  "release package smoke ok",
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
  "Assert-ZipContains",
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
  "docs\roadmap.zh-CN.md",
  "docs\security-hardening.zh-CN.md",
  "scripts\package-release.ps1",
  "scripts\verify-governance.ps1",
  "scripts\verify-release.ps1",
  "tests.md",
  "dist\index.html",
  "dist-cli\index.js",
  "src\server\codexAppServerBridge.ts",
  "src\server\composerFileSearchRoutes.ts",
  "src\server\diagnosticsRoutes.ts",
  "src\server\fileUploadRoute.ts",
  "src\server\githubTrendingRoutes.ts",
  "src\server\localStateRoutes.ts",
  "src\server\notificationReplayRoute.ts",
  "src\server\notificationSseRoute.ts",
  "src\server\projectRootRoutes.ts",
  "src\server\runtimeActionRoutes.ts",
  "src\server\runtimeStateRoutes.ts",
  "src\server\serverRequestRoutes.ts",
  "src\server\statusRoutes.ts",
  "src\server\threadRoutes.ts",
  "src\server\transcriptionRoute.ts",
  "src\server\worktreeRoutes.ts",
  "src\server\workspaceMetaRoutes.ts"
)

Assert-ContentIncludes "scripts/verify-server-modules.mjs" @(
  "src', 'server', 'composerFileSearchRoutes.ts'",
  "src', 'server', 'diagnosticsRoutes.ts'",
  "src', 'server', 'fileUploadRoute.ts'",
  "src', 'server', 'githubTrendingRoutes.ts'",
  "src', 'server', 'localStateRoutes.ts'",
  "src', 'server', 'notificationReplayRoute.ts'",
  "src', 'server', 'notificationSseRoute.ts'",
  "src', 'server', 'projectRootRoutes.ts'",
  "src', 'server', 'runtimeActionRoutes.ts'",
  "src', 'server', 'runtimeStateRoutes.ts'",
  "src', 'server', 'serverRequestRoutes.ts'",
  "src', 'server', 'statusRoutes.ts'",
  "src', 'server', 'threadRoutes.ts'",
  "src', 'server', 'transcriptionProxy.ts'",
  "src', 'server', 'transcriptionRoute.ts'",
  "src', 'server', 'worktreeRoutes.ts'",
  "src', 'server', 'workspaceMetaRoutes.ts'"
)

Assert-ContentIncludes "scripts/server-module-smoke.ts" @(
  "handleComposerFileSearchRoutes",
  "smokeComposerFileSearchRoutes",
  "handleFileUploadRoute",
  "smokeFileUploadRoute",
  "handleWorkspaceMetaRoutes",
  "smokeWorkspaceMetaRoutes",
  "handleProjectRootRoutes",
  "smokeProjectRootRoutes",
  "handleThreadRoutes",
  "smokeThreadRoutes",
  "handleStatusRoutes",
  "smokeStatusRoutes",
  "handleGithubTrendingRoutes",
  "smokeGithubTrendingRoutes",
  "handleDiagnosticsRoutes",
  "smokeDiagnosticsRoutes",
  "handleNotificationSseRoute",
  "smokeNotificationSseRoute",
  "handleRuntimeActionRoutes",
  "smokeRuntimeActionRoutes",
  "handleRuntimeStateRoutes",
  "smokeRuntimeStateRoutes",
  "handleServerRequestRoutes",
  "smokeServerRequestRoutes",
  "handleWorktreeRoutes",
  "smokeWorktreeRoutes",
  "handleLocalStateRoutes",
  "smokeLocalStateRoutes",
  "readNotificationReplayQuery",
  "handleNotificationReplayRoute",
  "smokeNotificationReplayRoute"
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
  '"verify:release": "node ./scripts/run-powershell-script.mjs ./scripts/verify-release.ps1"',
  '"verify:release-artifacts": "node ./scripts/run-powershell-script.mjs ./scripts/verify-release-artifacts.ps1"'
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
  ".github\release-body.md",
  ".github\workflows\release.yml",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "SUPPORT.md",
  "tests.md"
)

Assert-ContentIncludes ".github/dependabot.yml" @(
  "version: 2",
  'package-ecosystem: "npm"',
  'package-ecosystem: "github-actions"',
  'timezone: "Asia/Shanghai"',
  "open-pull-requests-limit:",
  "groups:"
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
  "docs/openai-docs-review.zh-CN.md",
  "docs/app-server-protocol-matrix.zh-CN.md",
  "CX-Codex-<tag>.zip",
  "cx-codex-android-<tag>.apk",
  "cx-codex-android-debug-<tag>.apk",
  "./scripts/verify-release.ps1 -RequireCleanGit -SchemaAudit skip",
  "./scripts/verify-release-artifacts.ps1",
  "npm.cmd run verify:release -- -RequireCleanGit -SchemaAudit warn",
  "must not include private accounts"
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
  "CX_CODEX_APP_SERVER_APPROVAL_POLICY=on-request",
  "CX_CODEX_APP_SERVER_SANDBOX_MODE=workspace-write",
  "不展示原始环境变量值"
)

Assert-ContentIncludes "docs/changelog.zh-CN.md" @(
  "appServerLaunch.ts",
  "legacy high-trust approval/sandbox 策略",
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
  "thread",
  "MCP",
  "item/autoApprovalReview/started",
  "脱敏权限请求标记",
  "network target",
  "permission profile 主动管理"
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
  "./scripts/verify-release.ps1 -SchemaAudit skip"
)

Assert-ContentIncludes ".github/workflows/release.yml" @(
  "./scripts/verify-release.ps1 -RequireCleanGit -SchemaAudit skip",
  "./scripts/verify-release-artifacts.ps1"
)

Write-Host "Governance docs check passed."
