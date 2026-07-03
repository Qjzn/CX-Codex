import { readFile, writeFile } from 'node:fs/promises'
import {
  type PermissionDecision,
  type WebBridgeSettings,
} from './serverRequestPolicy.js'

export const DEFAULT_WEB_BRIDGE_SETTINGS: WebBridgeSettings = {
  permissions: {
    allowAllPermissionRequests: false,
    commandExecution: 'allowForSession',
    fileChange: 'allowForSession',
    mcpTools: 'ask',
  },
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function normalizePermissionDecision(value: unknown, fallback: PermissionDecision): PermissionDecision {
  return value === 'ask' || value === 'allowForSession' ? value : fallback
}

export function normalizeWebBridgeSettings(value: unknown): WebBridgeSettings {
  const record = asRecord(value)
  const permissions = asRecord(record?.permissions)
  const defaultPermissions = DEFAULT_WEB_BRIDGE_SETTINGS.permissions
  return {
    permissions: {
      allowAllPermissionRequests: permissions?.allowAllPermissionRequests === true,
      commandExecution: normalizePermissionDecision(permissions?.commandExecution, defaultPermissions.commandExecution),
      fileChange: normalizePermissionDecision(permissions?.fileChange, defaultPermissions.fileChange),
      mcpTools: normalizePermissionDecision(permissions?.mcpTools, defaultPermissions.mcpTools),
    },
  }
}

export async function readWebBridgeSettings(settingsPath: string): Promise<WebBridgeSettings> {
  try {
    const raw = await readFile(settingsPath, 'utf8')
    return normalizeWebBridgeSettings(JSON.parse(raw) as unknown)
  } catch {
    return DEFAULT_WEB_BRIDGE_SETTINGS
  }
}

export async function writeWebBridgeSettings(
  settingsPath: string,
  settings: unknown,
): Promise<WebBridgeSettings> {
  const normalized = normalizeWebBridgeSettings(settings)
  await writeFile(settingsPath, JSON.stringify(normalized, null, 2), 'utf8')
  return normalized
}
