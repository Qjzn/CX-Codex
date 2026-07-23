import { Capacitor, registerPlugin } from '@capacitor/core'
import type { UiTaskPetRecentThread } from '../types/codex'

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
  ignoringBatteryOptimizations: boolean
  sdkInt: number
  manufacturer: string
  model: string
  webViewPackage: string
  webViewVersion: string
}

export type MobileShellKeepAwakeResult = {
  enabled: boolean
}

export type MobileShellBatteryOptimizationResult = {
  opened: boolean
  ignoringBatteryOptimizations: boolean
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
  completionChannelEnabled?: boolean
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

export type MobileShellTaskPetItem = {
  threadId: string
  clientMessageId?: string
  activityId?: string
  startedAtMs?: number
  lastEventSeq?: number
  title: string
  projectName: string
  detail: string
  latestActivity: string
  latestReply: string
  latestReplyEventSeq?: number
  state: 'running' | 'waiting'
  updatedAtIso: string
}

export type MobileShellTaskPetRecentThread = UiTaskPetRecentThread

export type MobileShellTaskPetMonitorDiagnostics = {
  version: number
  monitorStartedAtMs: number
  serviceCreateCount: number
  stickyRestartCount: number
  taskRemovedCount: number
  lastStartCommandAtMs: number
  lastStartReason: 'none' | 'update' | 'mobile_push' | 'mark_read' | 'sticky_restart'
  lastTaskRemovedAtMs: number
  activeTaskCount: number
  eventStreamState: 'starting' | 'connecting' | 'connected' | 'retrying' | 'idle' | 'stopped'
  eventStreamReconnectCount: number
  lastEventStreamStatusCode: number
  lastEventStreamConnectedAtMs: number
  lastEventStreamDisconnectedAtMs: number
  relevantEventCount: number
  lastRelevantEventAtMs: number
  lastEventDrivenPollAtMs: number
  replyEventCount: number
  lastReplyEventAtMs: number
  lastReplyEventSeq: number
  replySnapshotApplyCount: number
  lastReplyAppliedAtMs: number
  lastReplyAppliedEventSeq: number
  replyRenderCount: number
  lastReplyRenderedAtMs: number
  lastReplyRenderedEventSeq: number
  snapshotSuccessCount: number
  snapshotFailureCount: number
  lastSnapshotSuccessAtMs: number
  lastSnapshotFailureAtMs: number
  consecutivePollFailures: number
  lastTerminalAtMs: number
  lastCompletionNotificationAttemptAtMs: number
  lastCompletionNotificationResult:
    | 'none'
    | 'posted'
    | 'blocked'
    | 'channel_blocked'
    | 'reply_retry_posted'
    | 'reply_retry_blocked'
    | 'reply_retry_channel_blocked'
  lastCompletionNotificationBodySource: 'none' | 'latest_reply' | 'detail' | 'reply_retry'
  connectivityCallbackRegistered: boolean
  networkRecoveryCount: number
  lastDefaultNetworkAvailableAtMs: number
  lastDefaultNetworkLostAtMs: number
  updatedAtMs: number
}

export type MobileShellMobilePushDiagnostics = {
  version: number
  state: 'not_configured' | 'token_failed' | 'registration_failed' | 'server_not_configured' | 'registered' | 'wake_started' | 'wake_restarted' | 'wake_failed' | 'ack_retry' | 'duplicate_ignored' | 'ignored'
  configurationState: 'not_configured' | 'invalid' | 'configured' | 'unknown'
  subscriptionCount: number
  lastRegistrationAtMs: number
  lastPushHighPriority: boolean
  lastPushEventSeq: number
  lastPushAtMs: number
  lastAcknowledgementState: 'acknowledged' | 'registration_missing' | 'network_error' | `http_${number}`
  lastAcknowledgementEventSeq: number
  lastAcknowledgementAtMs: number
  lastError: string
  updatedAtMs: number
}

export type MobileShellTaskPetStatus = {
  enabled: boolean
  showing: boolean
  canDrawOverlays: boolean
  permissionRequired: boolean
  monitorRunning?: boolean
  monitorDiagnostics?: Partial<MobileShellTaskPetMonitorDiagnostics>
  pushDiagnostics?: Partial<MobileShellMobilePushDiagnostics>
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
  openBatteryOptimizationSettings(): Promise<MobileShellBatteryOptimizationResult>
  setKeepAwake(options: { enabled: boolean }): Promise<MobileShellKeepAwakeResult>
  performHapticFeedback(options: { style: MobileShellHapticStyle }): Promise<MobileShellHapticResult>
  getNotificationPermissionStatus(): Promise<MobileShellNotificationPermissionStatus>
  requestNotificationPermission(options?: { automatic?: boolean }): Promise<MobileShellNotificationPermissionStatus>
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
  getTaskPetStatus(): Promise<MobileShellTaskPetStatus>
  setTaskPetEnabled(options: {
    enabled: boolean
    serverUrl?: string
    tasksJson?: string
    recentThreadsJson?: string
  }): Promise<MobileShellTaskPetStatus>
  updateTaskPet(options: {
    serverUrl: string
    tasksJson: string
    recentThreadsJson: string
  }): Promise<MobileShellTaskPetStatus>
  acknowledgeTaskPetThreadOpen(options: { threadId: string }): Promise<void>
  markTaskPetThreadRead(options: { threadId: string }): Promise<void>
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

export async function openMobileShellBatteryOptimizationSettings(): Promise<MobileShellBatteryOptimizationResult> {
  return await MobileShell.openBatteryOptimizationSettings()
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

export async function requestMobileShellNotificationPermission(
  options: { automatic?: boolean } = {},
): Promise<MobileShellNotificationPermissionStatus> {
  return await MobileShell.requestNotificationPermission(options)
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

export async function getMobileShellTaskPetStatus(): Promise<MobileShellTaskPetStatus> {
  return await MobileShell.getTaskPetStatus()
}

export async function setMobileShellTaskPetEnabled(
  enabled: boolean,
  serverUrl = '',
  tasks: MobileShellTaskPetItem[] = [],
  recentThreads: MobileShellTaskPetRecentThread[] = [],
): Promise<MobileShellTaskPetStatus> {
  return await MobileShell.setTaskPetEnabled({
    enabled,
    serverUrl,
    tasksJson: JSON.stringify(tasks),
    recentThreadsJson: JSON.stringify(recentThreads),
  })
}

export async function updateMobileShellTaskPet(
  serverUrl: string,
  tasks: MobileShellTaskPetItem[],
  recentThreads: MobileShellTaskPetRecentThread[],
): Promise<MobileShellTaskPetStatus> {
  return await MobileShell.updateTaskPet({
    serverUrl,
    tasksJson: JSON.stringify(tasks),
    recentThreadsJson: JSON.stringify(recentThreads),
  })
}

export async function markMobileShellTaskPetThreadRead(threadId: string): Promise<void> {
  const normalizedThreadId = threadId.trim()
  if (!normalizedThreadId || !isNativeAndroidShell()) return
  await MobileShell.markTaskPetThreadRead({ threadId: normalizedThreadId })
}

export async function acknowledgeMobileShellTaskPetThreadOpen(threadId: string): Promise<void> {
  const normalizedThreadId = threadId.trim()
  if (!normalizedThreadId || !isNativeAndroidShell()) return
  await MobileShell.acknowledgeTaskPetThreadOpen({ threadId: normalizedThreadId })
}
