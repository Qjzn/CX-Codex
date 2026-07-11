import { Capacitor, registerPlugin } from '@capacitor/core'

export type MobileShellServerConfig = {
  serverUrl: string
  defaultServerUrl: string
  usingDefault: boolean
  restartScheduled?: boolean
}

export type MobileShellAuthConfig = {
  authKey: string
  hasAuthKey: boolean
}

export type MobileShellAppInfo = {
  appName: string
  packageName: string
  versionName: string
  versionCode: number
  canRequestPackageInstalls: boolean
}

export type MobileShellRuntimeInfo = {
  connected: boolean
  validated: boolean
  metered: boolean
  transport: string
  powerSaveMode: boolean
  sdkInt: number
  manufacturer: string
  model: string
  webViewPackage: string
  webViewVersion: string
}

export type MobileShellKeepAwakeResult = {
  enabled: boolean
}

export type MobileShellHapticStyle = 'light' | 'medium' | 'heavy' | 'success' | 'warning'

export type MobileShellHapticResult = {
  performed: boolean
  style: MobileShellHapticStyle
}

export type MobileShellNotificationPermissionStatus = {
  granted: boolean
  requested: boolean
  requiresRuntimePermission: boolean
  notificationsEnabled: boolean
}

export type MobileShellNotificationType = 'status' | 'success' | 'request' | 'error'

export type MobileShellNotificationResult = {
  shown: boolean
  reason: string
  notificationId: number
}

export type MobileShellInstallResult = {
  status: 'started' | 'permission_required'
  fileName?: string
  savedPath?: string
}

export type MobileShellOpenUrlResult = {
  opened: boolean
}

export type MobileShellOpenFileResult = {
  status: 'opened' | 'started'
  fileName?: string
  savedPath?: string
  mimeType?: string
}

export type MobileShellDownloadFileResult = {
  status: 'queued' | 'saved' | 'started'
  downloadId?: number
  fileName?: string
  mimeType?: string
  savedPath?: string
  uri?: string
  bytes?: number
}

export type MobileShellDictationResult = {
  text: string
  audioBase64?: string
  mimeType?: string
  fileName?: string
}

export type MobileShellDictationStatus = {
  available: boolean
  permissionGranted: boolean
  onDeviceAvailable: boolean
  speechServiceAvailable?: boolean
}

export type MobileShellDictationStopResult = {
  stopping: boolean
}

type MobileShellPlugin = {
  getServerConfig(): Promise<MobileShellServerConfig>
  setServerUrl(options: { serverUrl: string }): Promise<MobileShellServerConfig>
  resetServerUrl(): Promise<MobileShellServerConfig>
  getAuthConfig(): Promise<MobileShellAuthConfig>
  setAuthKey(options: { authKey: string }): Promise<{ hasAuthKey: boolean }>
  clearAuthKey(): Promise<{ hasAuthKey: boolean }>
  getAppInfo(): Promise<MobileShellAppInfo>
  getRuntimeInfo(): Promise<MobileShellRuntimeInfo>
  setKeepAwake(options: { enabled: boolean }): Promise<MobileShellKeepAwakeResult>
  performHapticFeedback(options: { style: MobileShellHapticStyle }): Promise<MobileShellHapticResult>
  getNotificationPermissionStatus(): Promise<MobileShellNotificationPermissionStatus>
  requestNotificationPermission(): Promise<MobileShellNotificationPermissionStatus>
  showNotification(options: {
    title: string
    body: string
    type?: MobileShellNotificationType
    notificationId?: number
  }): Promise<MobileShellNotificationResult>
  installApkFromUrl(options: { url: string; fileName?: string }): Promise<MobileShellInstallResult>
  openUrl(options: { url: string }): Promise<MobileShellOpenUrlResult>
  openFileFromUrl(options: { url: string; fileName?: string; mimeType?: string }): Promise<MobileShellOpenFileResult>
  downloadFileFromUrl(options: { url: string; fileName?: string; mimeType?: string }): Promise<MobileShellDownloadFileResult>
  getDictationStatus(): Promise<MobileShellDictationStatus>
  startDictation(options: { language?: string }): Promise<MobileShellDictationResult>
  stopDictation(): Promise<MobileShellDictationStopResult>
  cancelDictation(): Promise<void>
}

const MobileShell = registerPlugin<MobileShellPlugin>('MobileShell')

export function isNativeAndroidShell(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export async function getMobileShellServerConfig(): Promise<MobileShellServerConfig> {
  return await MobileShell.getServerConfig()
}

export async function setMobileShellServerUrl(serverUrl: string): Promise<MobileShellServerConfig> {
  return await MobileShell.setServerUrl({ serverUrl })
}

export async function resetMobileShellServerUrl(): Promise<MobileShellServerConfig> {
  return await MobileShell.resetServerUrl()
}

export async function getMobileShellAuthConfig(): Promise<MobileShellAuthConfig> {
  return await MobileShell.getAuthConfig()
}

export async function setMobileShellAuthKey(authKey: string): Promise<{ hasAuthKey: boolean }> {
  return await MobileShell.setAuthKey({ authKey })
}

export async function clearMobileShellAuthKey(): Promise<{ hasAuthKey: boolean }> {
  return await MobileShell.clearAuthKey()
}

export async function getMobileShellAppInfo(): Promise<MobileShellAppInfo> {
  return await MobileShell.getAppInfo()
}

export async function getMobileShellRuntimeInfo(): Promise<MobileShellRuntimeInfo> {
  return await MobileShell.getRuntimeInfo()
}

export async function setMobileShellKeepAwake(enabled: boolean): Promise<MobileShellKeepAwakeResult> {
  return await MobileShell.setKeepAwake({ enabled })
}

export async function performMobileShellHapticFeedback(
  style: MobileShellHapticStyle = 'light',
): Promise<MobileShellHapticResult> {
  return await MobileShell.performHapticFeedback({ style })
}

export async function getMobileShellNotificationPermissionStatus(): Promise<MobileShellNotificationPermissionStatus> {
  return await MobileShell.getNotificationPermissionStatus()
}

export async function requestMobileShellNotificationPermission(): Promise<MobileShellNotificationPermissionStatus> {
  return await MobileShell.requestNotificationPermission()
}

export async function showMobileShellNotification(
  title: string,
  body: string,
  type: MobileShellNotificationType = 'status',
  notificationId?: number,
): Promise<MobileShellNotificationResult> {
  return await MobileShell.showNotification({ title, body, type, notificationId })
}

export async function installMobileShellApk(url: string, fileName = ''): Promise<MobileShellInstallResult> {
  return await MobileShell.installApkFromUrl({ url, fileName })
}

export async function openMobileShellUrl(url: string): Promise<MobileShellOpenUrlResult> {
  return await MobileShell.openUrl({ url })
}

export async function openMobileShellFileFromUrl(
  url: string,
  fileName = '',
  mimeType = '',
): Promise<MobileShellOpenFileResult> {
  return await MobileShell.openFileFromUrl({ url, fileName, mimeType })
}

export async function downloadMobileShellFileFromUrl(
  url: string,
  fileName = '',
  mimeType = '',
): Promise<MobileShellDownloadFileResult> {
  return await MobileShell.downloadFileFromUrl({ url, fileName, mimeType })
}

export async function startMobileShellDictation(language = ''): Promise<MobileShellDictationResult> {
  return await MobileShell.startDictation({ language })
}

export async function getMobileShellDictationStatus(): Promise<MobileShellDictationStatus> {
  return await MobileShell.getDictationStatus()
}

export async function stopMobileShellDictation(): Promise<MobileShellDictationStopResult> {
  return await MobileShell.stopDictation()
}

export async function cancelMobileShellDictation(): Promise<void> {
  await MobileShell.cancelDictation()
}
