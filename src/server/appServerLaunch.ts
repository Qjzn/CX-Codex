export const APP_SERVER_APPROVAL_POLICIES = ['untrusted', 'on-request', 'never'] as const
export const APP_SERVER_SANDBOX_MODES = ['read-only', 'workspace-write', 'danger-full-access'] as const

export type AppServerApprovalPolicy = typeof APP_SERVER_APPROVAL_POLICIES[number]
export type AppServerSandboxMode = typeof APP_SERVER_SANDBOX_MODES[number]

export type AppServerLaunchPolicy = {
  approvalPolicy: AppServerApprovalPolicy
  sandboxMode: AppServerSandboxMode
}

export const DEFAULT_APP_SERVER_LAUNCH_POLICY: AppServerLaunchPolicy = {
  approvalPolicy: 'never',
  sandboxMode: 'danger-full-access',
}

export function resolveAppServerLaunchPolicy(env: NodeJS.ProcessEnv = process.env): AppServerLaunchPolicy {
  return {
    approvalPolicy: normalizeApprovalPolicy(
      env.CX_CODEX_APP_SERVER_APPROVAL_POLICY || env.CODEXUI_APP_SERVER_APPROVAL_POLICY,
    ),
    sandboxMode: normalizeSandboxMode(
      env.CX_CODEX_APP_SERVER_SANDBOX_MODE || env.CODEXUI_APP_SERVER_SANDBOX_MODE,
    ),
  }
}

export function createAppServerArgs(policy: AppServerLaunchPolicy = DEFAULT_APP_SERVER_LAUNCH_POLICY): string[] {
  return [
    'app-server',
    '-c',
    `approval_policy="${policy.approvalPolicy}"`,
    '-c',
    `sandbox_mode="${policy.sandboxMode}"`,
  ]
}

function normalizeApprovalPolicy(value: unknown): AppServerApprovalPolicy {
  if (typeof value !== 'string') return DEFAULT_APP_SERVER_LAUNCH_POLICY.approvalPolicy
  const normalized = value.trim()
  return isAppServerApprovalPolicy(normalized) ? normalized : DEFAULT_APP_SERVER_LAUNCH_POLICY.approvalPolicy
}

function normalizeSandboxMode(value: unknown): AppServerSandboxMode {
  if (typeof value !== 'string') return DEFAULT_APP_SERVER_LAUNCH_POLICY.sandboxMode
  const normalized = value.trim()
  return isAppServerSandboxMode(normalized) ? normalized : DEFAULT_APP_SERVER_LAUNCH_POLICY.sandboxMode
}

function isAppServerApprovalPolicy(value: string): value is AppServerApprovalPolicy {
  return APP_SERVER_APPROVAL_POLICIES.includes(value as AppServerApprovalPolicy)
}

function isAppServerSandboxMode(value: string): value is AppServerSandboxMode {
  return APP_SERVER_SANDBOX_MODES.includes(value as AppServerSandboxMode)
}
