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
  $content = Get-Content -Raw -LiteralPath $path
  foreach ($needle in $Needles) {
    if (-not $content.Contains($needle)) {
      throw "$RelativePath is missing required text: $needle"
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

$requiredFiles = @(
  "README.md",
  "README.zh-CN.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "SUPPORT.md",
  "RELEASE.md",
  "tests.md",
  "docs/app-server-schema-audit-summary.json",
  "docs/security-hardening.zh-CN.md",
  "docs/protocol-compatibility.zh-CN.md",
  "docs/app-server-protocol-matrix.zh-CN.md",
  "docs/changelog.zh-CN.md",
  "docs/roadmap.zh-CN.md",
  "docs/operations-plan.zh-CN.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/release.yml",
  ".github/release-body.md"
)

foreach ($file in $requiredFiles) {
  Assert-FileExists $file
}

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
  "SECURITY.md",
  "CONTRIBUTING.md",
  "SUPPORT.md"
)

Assert-ContentIncludes "README.md" @(
  "CX_CODEX_APP_SERVER_APPROVAL_POLICY",
  "CODEXUI_APP_SERVER_APPROVAL_POLICY",
  "CX_CODEX_APP_SERVER_SANDBOX_MODE",
  "CODEXUI_APP_SERVER_SANDBOX_MODE",
  "CX_CODEX_APP_SERVER_APPROVAL_POLICY=on-request",
  "CX_CODEX_APP_SERVER_SANDBOX_MODE=workspace-write"
)

Assert-ContentIncludes "SECURITY.md" @(
  "docs/security-hardening.zh-CN.md",
  "App Server transport",
  "sandbox / approval"
)

Assert-ContentIncludes "RELEASE.md" @(
  "npm.cmd run verify:release",
  "SchemaAudit warn",
  "docs/security-hardening.zh-CN.md",
  "docs/release-template.zh-CN.md"
)

Assert-ContentIncludes ".github/PULL_REQUEST_TEMPLATE.md" @(
  "npm run verify:release",
  "docs/security-hardening.zh-CN.md",
  "隐私与安全"
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
  "脱敏后的有效策略快照"
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
  "当前运行的 Codex 版本精确对应"
)

Assert-ContentIncludes "docs/app-server-protocol-matrix.zh-CN.md" @(
  "Codex App Server",
  "schema audit",
  "docs/app-server-schema-audit-summary.json",
  "thread",
  "MCP"
)

$schemaAuditSummaryPath = Resolve-RepoPath "docs/app-server-schema-audit-summary.json"
$schemaAuditSummary = Get-Content -Raw -LiteralPath $schemaAuditSummaryPath | ConvertFrom-Json
if ($schemaAuditSummary.officialDocsUrl -ne "https://developers.openai.com/codex/app-server") {
  throw "docs/app-server-schema-audit-summary.json has an unexpected officialDocsUrl."
}
if ($schemaAuditSummary.reviewStatus -ne "drift-recorded") {
  throw "docs/app-server-schema-audit-summary.json reviewStatus must be drift-recorded until the schema baseline is intentionally updated."
}
if ($schemaAuditSummary.auditCommand -ne "npm.cmd run audit:app-server-schemas") {
  throw "docs/app-server-schema-audit-summary.json auditCommand must document the canonical audit command."
}
foreach ($key in @("typescriptRoot", "typescriptV2", "jsonRoot", "jsonV2")) {
  $row = $schemaAuditSummary.comparison.$key
  if (-not $row) {
    throw "docs/app-server-schema-audit-summary.json missing comparison.$key."
  }
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
  "./scripts/verify-release.ps1 -RequireCleanGit -SchemaAudit skip"
)

Write-Host "Governance docs check passed."
