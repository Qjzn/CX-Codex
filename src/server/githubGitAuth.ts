export const GITHUB_GIT_TOKEN_ENV_NAME = 'CX_CODEX_GITHUB_GIT_TOKEN'

export type GithubGitAuth = {
  argsPrefix: string[]
  env: NodeJS.ProcessEnv
}

export function buildGithubGitRemoteUrl(repoOwner: string, repoName: string): string {
  return `https://github.com/${repoOwner}/${repoName}.git`
}

export function createGithubGitAuth(
  token: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
): GithubGitAuth {
  const helper = `!f() { test "$1" = get || exit 0; printf '%s\\n' 'username=x-access-token' "password=$${GITHUB_GIT_TOKEN_ENV_NAME}"; }; f`
  return {
    argsPrefix: [
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'credential.helper=',
      '-c',
      `credential.helper=${helper}`,
    ],
    env: {
      ...baseEnv,
      GIT_TERMINAL_PROMPT: '0',
      [GITHUB_GIT_TOKEN_ENV_NAME]: token,
    },
  }
}
