import { homedir } from 'node:os'
import { join } from 'node:path'

export function getCodexHomeDir(): string {
  const codexHome = process.env.CODEX_HOME?.trim()
  return codexHome && codexHome.length > 0 ? codexHome : join(homedir(), '.codex')
}

export function getCodexAuthPath(): string {
  return join(getCodexHomeDir(), 'auth.json')
}

export function getCodexGlobalStatePath(): string {
  return join(getCodexHomeDir(), '.codex-global-state.json')
}

export function getCodexSessionIndexPath(): string {
  return join(getCodexHomeDir(), 'session_index.jsonl')
}

export function getWebBridgeSettingsPath(): string {
  return join(getCodexHomeDir(), 'web-bridge-settings.json')
}

export function getWebUiStatePath(): string {
  return join(getCodexHomeDir(), 'web-ui-state.json')
}

export function getWebFavoritesPath(): string {
  return join(getCodexHomeDir(), 'web-favorites.json')
}

export function getWebPinnedThreadIdsPath(): string {
  return join(getCodexHomeDir(), 'web-pinned-thread-ids.json')
}

export function getWebThreadListCachePath(): string {
  return join(getCodexHomeDir(), 'web-thread-list-cache.json')
}

export function getSkillsInstallDir(): string {
  return join(getCodexHomeDir(), 'skills')
}

export function getSkillsSyncStatePath(): string {
  return join(getCodexHomeDir(), 'skills-sync.json')
}

export function getCodexWorktreesDir(): string {
  return join(getCodexHomeDir(), 'worktrees')
}
