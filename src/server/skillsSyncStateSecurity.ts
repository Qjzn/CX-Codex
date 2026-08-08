import {
  protectWindowsCurrentUserText,
  unprotectWindowsCurrentUserText,
} from './windowsDataProtection.js'

export const WINDOWS_SKILLS_TOKEN_PROTECTION = 'windows-dpapi-current-user-v1'

type SkillsSyncStateSecurityOptions = {
  platform?: NodeJS.Platform
  protectText?: (value: string) => Promise<string>
  unprotectText?: (value: string) => Promise<string>
}

export type DecodedSkillsSyncState = {
  state: Record<string, unknown>
  needsMigration: boolean
}

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function encodeSkillsSyncStateForStorage(
  state: Record<string, unknown>,
  options: SkillsSyncStateSecurityOptions = {},
): Promise<Record<string, unknown>> {
  const platform = options.platform ?? process.platform
  const stored = { ...state }
  const token = readNonEmptyString(stored.githubToken)
  delete stored.githubTokenProtected
  delete stored.githubTokenProtection
  if (platform !== 'win32' || !token) return stored

  const protectText = options.protectText ?? protectWindowsCurrentUserText
  stored.githubTokenProtected = await protectText(token)
  stored.githubTokenProtection = WINDOWS_SKILLS_TOKEN_PROTECTION
  delete stored.githubToken
  return stored
}

export async function decodeSkillsSyncStateFromStorage(
  storedState: Record<string, unknown>,
  options: SkillsSyncStateSecurityOptions = {},
): Promise<DecodedSkillsSyncState> {
  const platform = options.platform ?? process.platform
  const state = { ...storedState }
  const plainToken = readNonEmptyString(state.githubToken)
  const protectedToken = readNonEmptyString(state.githubTokenProtected)
  const protection = readNonEmptyString(state.githubTokenProtection)
  delete state.githubTokenProtected
  delete state.githubTokenProtection

  if (!protectedToken && !protection) {
    return {
      state,
      needsMigration: platform === 'win32' && Boolean(plainToken),
    }
  }
  if (protection !== WINDOWS_SKILLS_TOKEN_PROTECTION || !protectedToken) {
    throw new Error('Skills sync token uses an unsupported protection format')
  }
  if (platform !== 'win32') {
    throw new Error('Windows-protected Skills sync token cannot be read on this platform')
  }

  const unprotectText = options.unprotectText ?? unprotectWindowsCurrentUserText
  state.githubToken = await unprotectText(protectedToken)
  return {
    state,
    needsMigration: Boolean(plainToken),
  }
}
