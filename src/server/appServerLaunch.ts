export type AppServerLaunchPolicy = {
  approvalPolicy: string
  sandboxMode: string
}

export const DEFAULT_APP_SERVER_LAUNCH_POLICY: AppServerLaunchPolicy = {
  approvalPolicy: 'never',
  sandboxMode: 'danger-full-access',
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
