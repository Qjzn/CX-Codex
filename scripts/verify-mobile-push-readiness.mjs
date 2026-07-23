import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ANDROID_PACKAGE_NAME = 'com.cxcodex.bridge'
const DEFAULT_BASE_URL = 'http://127.0.0.1:7420'
const PRIVATE_KEY_PATTERN = /-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]*-----END (?:RSA )?PRIVATE KEY-----/
const SAFE_LIVE_ERROR_CODES = new Set([
  'service_account_missing_required_fields',
  'service_account_unreadable',
  'awaiting_device_ack',
  'delivery_failed',
  'fcm_auth_missing_access_token',
])

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function inspectAndroidFirebaseConfig(value) {
  const root = asObject(value)
  const projectInfo = asObject(root?.project_info)
  const projectId = cleanString(projectInfo?.project_id)
  const projectNumber = cleanString(projectInfo?.project_number)
  const clients = Array.isArray(root?.client) ? root.client : []
  const matchingClient = clients.find((candidate) => {
    const client = asObject(candidate)
    const clientInfo = asObject(client?.client_info)
    const androidInfo = asObject(clientInfo?.android_client_info)
    return cleanString(androidInfo?.package_name) === ANDROID_PACKAGE_NAME
  })
  const matchingClientInfo = asObject(asObject(matchingClient)?.client_info)
  const appId = cleanString(matchingClientInfo?.mobilesdk_app_id)
  if (!projectId || !projectNumber) {
    return { state: 'invalid', reason: 'android_project_info_missing', projectId: '' }
  }
  if (!matchingClient) {
    return { state: 'invalid', reason: 'android_package_mismatch', projectId }
  }
  if (!appId) {
    return { state: 'invalid', reason: 'android_app_id_missing', projectId }
  }
  return { state: 'configured', reason: null, projectId }
}

export function inspectFirebaseServiceAccount(value, projectOverride = '') {
  const root = asObject(value)
  const clientEmail = cleanString(root?.client_email)
  const privateKey = cleanString(root?.private_key)
  const storedProjectId = cleanString(root?.project_id)
  const overrideProjectId = cleanString(projectOverride)
  const projectId = overrideProjectId || storedProjectId
  if (!clientEmail || !clientEmail.includes('@')) {
    return {
      state: 'invalid',
      reason: 'service_account_client_email_missing',
      projectId,
      projectOverrideUsed: Boolean(overrideProjectId),
    }
  }
  if (!PRIVATE_KEY_PATTERN.test(privateKey)) {
    return {
      state: 'invalid',
      reason: 'service_account_private_key_invalid',
      projectId,
      projectOverrideUsed: Boolean(overrideProjectId),
    }
  }
  if (!projectId) {
    return {
      state: 'invalid',
      reason: 'service_account_project_id_missing',
      projectId: '',
      projectOverrideUsed: Boolean(overrideProjectId),
    }
  }
  return {
    state: 'configured',
    reason: null,
    projectId,
    projectOverrideUsed: Boolean(overrideProjectId),
  }
}

function sanitizedLiveError(value) {
  const normalized = cleanString(value)
  if (!normalized) return null
  if (SAFE_LIVE_ERROR_CODES.has(normalized)) return normalized
  return /^fcm(?:_auth)?_http_[1-5]\d{2}$/u.test(normalized) ? normalized : 'provider_error'
}

function missingAction(code) {
  const actions = {
    android_google_services_missing: '把 Firebase Android 配置放到 android/app/google-services.json 并重新构建 APK',
    android_google_services_unreadable: '重新下载有效的 google-services.json',
    android_project_info_missing: '重新下载包含 project_info 的 Android Firebase 配置',
    android_package_mismatch: `Firebase Android 应用包名必须为 ${ANDROID_PACKAGE_NAME}`,
    android_app_id_missing: '重新下载包含 mobilesdk_app_id 的 Android Firebase 配置',
    server_credentials_missing: '在 7420 启动环境设置 GOOGLE_APPLICATION_CREDENTIALS',
    server_credentials_unreadable: '确认服务账号 JSON 路径存在且当前进程可读取',
    service_account_client_email_missing: '使用包含 client_email 的 Firebase 服务账号 JSON',
    service_account_private_key_invalid: '使用包含有效 private_key 的 Firebase 服务账号 JSON',
    service_account_project_id_missing: '在服务账号中提供 project_id 或设置 CX_CODEX_FIREBASE_PROJECT_ID',
    firebase_project_mismatch: 'Android 配置与 7420 服务账号必须属于同一 Firebase 项目',
    live_server_unreachable: '先启动 7420，再重新运行预检',
    live_server_not_configured: '让 7420 在带 Firebase 服务账号环境变量的进程中重新启动',
    live_server_invalid: '根据 7420 移动推送状态修复服务账号格式或读取权限',
    device_registration_missing: '安装重新构建的 APK 并打开一次，让设备注册 FCM token',
    active_subscription_missing: '在 Android 上发送一个仍在执行的任务，确认活跃会话订阅已注册',
  }
  return actions[code] ?? code
}

export function buildMobilePushReadinessReport({ android, server, live }) {
  const androidConfigured = android?.state === 'configured'
  const serverConfigured = server?.state === 'configured'
  const firebaseProjectMatch = androidConfigured && serverConfigured
    ? android.projectId === server.projectId
    : null
  const liveConfigured = live?.reachable === true && live.configurationState === 'configured'
  const configurationReady = androidConfigured
    && serverConfigured
    && firebaseProjectMatch === true
    && liveConfigured
  const deviceRegistrationReady = liveConfigured && Number(live.registrationCount) > 0
  const activeSubscriptionReady = liveConfigured && Number(live.subscribedRegistrationCount) > 0
  const missing = []

  if (android?.state === 'missing') missing.push('android_google_services_missing')
  else if (android?.state === 'unreadable') missing.push('android_google_services_unreadable')
  else if (!androidConfigured) missing.push(android?.reason || 'android_google_services_unreadable')

  if (server?.state === 'missing') missing.push('server_credentials_missing')
  else if (server?.state === 'unreadable') missing.push('server_credentials_unreadable')
  else if (!serverConfigured) missing.push(server?.reason || 'server_credentials_unreadable')

  if (firebaseProjectMatch === false) missing.push('firebase_project_mismatch')
  if (live?.reachable !== true) missing.push('live_server_unreachable')
  else if (live.configurationState === 'not_configured') missing.push('live_server_not_configured')
  else if (live.configurationState !== 'configured') missing.push('live_server_invalid')
  if (!deviceRegistrationReady) missing.push('device_registration_missing')
  if (!activeSubscriptionReady) missing.push('active_subscription_missing')

  return {
    schemaVersion: 1,
    provider: 'fcm',
    configurationReady,
    deviceRegistrationReady,
    activeSubscriptionReady,
    ready: configurationReady && deviceRegistrationReady && activeSubscriptionReady,
    android: {
      state: android?.state || 'unreadable',
      reason: android?.reason || null,
      packageName: ANDROID_PACKAGE_NAME,
    },
    serverCredentials: {
      state: server?.state || 'unreadable',
      reason: server?.reason || null,
      projectOverrideUsed: server?.projectOverrideUsed === true,
    },
    firebaseProjectMatch,
    liveServer: {
      reachable: live?.reachable === true,
      configurationState: live?.configurationState || 'unknown',
      registrationCount: Math.max(0, Number(live?.registrationCount) || 0),
      subscribedRegistrationCount: Math.max(0, Number(live?.subscribedRegistrationCount) || 0),
      lastErrorCode: sanitizedLiveError(live?.lastError),
    },
    missing,
    nextActions: missing.map(missingAction),
  }
}

function readJsonInspection(path, inspect, projectOverride = '') {
  if (!path) return { state: 'missing', reason: null, projectId: '' }
  if (!existsSync(path)) return { state: 'missing', reason: null, projectId: '' }
  try {
    return inspect(JSON.parse(readFileSync(path, 'utf8')), projectOverride)
  } catch {
    return { state: 'unreadable', reason: null, projectId: '' }
  }
}

async function readLiveStatus(baseUrl) {
  const normalizedBaseUrl = cleanString(baseUrl).replace(/\/+$/u, '')
  try {
    const response = await fetch(`${normalizedBaseUrl}/codex-api/mobile-push/status`, {
      signal: AbortSignal.timeout(5_000),
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) {
      return {
        reachable: false,
        configurationState: 'http_error',
        registrationCount: 0,
        subscribedRegistrationCount: 0,
        lastError: `http_${response.status}`,
      }
    }
    const payload = await response.json()
    const data = asObject(payload)?.data
    return {
      reachable: true,
      configurationState: cleanString(data?.configurationState) || 'unknown',
      registrationCount: Number(data?.registrationCount) || 0,
      subscribedRegistrationCount: Number(data?.subscribedRegistrationCount) || 0,
      lastError: data?.lastError,
    }
  } catch {
    return {
      reachable: false,
      configurationState: 'unreachable',
      registrationCount: 0,
      subscribedRegistrationCount: 0,
      lastError: null,
    }
  }
}

function parseArguments(argv) {
  const options = {
    androidConfig: '',
    serviceAccount: '',
    projectId: '',
    baseUrl: DEFAULT_BASE_URL,
    requireConfiguration: false,
    requireReady: false,
    help: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--require-configuration') options.requireConfiguration = true
    else if (argument === '--require-ready') options.requireReady = true
    else if (argument === '--help' || argument === '-h') options.help = true
    else if (argument === '--android-config') options.androidConfig = argv[++index] || ''
    else if (argument === '--service-account') options.serviceAccount = argv[++index] || ''
    else if (argument === '--project-id') options.projectId = argv[++index] || ''
    else if (argument === '--base-url') options.baseUrl = argv[++index] || ''
    else throw new Error(`Unknown argument: ${argument}`)
  }
  return options
}

function printHelp() {
  console.log(`Usage: npm run verify:mobile-push-readiness -- [options]

Options:
  --android-config <path>       Override android/app/google-services.json
  --service-account <path>      Override GOOGLE_APPLICATION_CREDENTIALS
  --project-id <id>             Override CX_CODEX_FIREBASE_PROJECT_ID
  --base-url <url>              Override live 7420 URL
  --require-configuration       Exit 1 unless both Firebase sides and live 7420 match
  --require-ready               Exit 1 unless a device and active task subscription are also ready
  --help                        Show this help

Output never includes a private key, service-account email, device token, or Firebase project id.`)
}

async function main() {
  let options
  try {
    options = parseArguments(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 2
    return
  }
  if (options.help) {
    printHelp()
    return
  }
  const scriptDirectory = dirname(fileURLToPath(import.meta.url))
  const repositoryRoot = resolve(scriptDirectory, '..')
  const androidConfigPath = options.androidConfig
    ? resolve(options.androidConfig)
    : join(repositoryRoot, 'android', 'app', 'google-services.json')
  const serviceAccountPath = options.serviceAccount
    ? resolve(options.serviceAccount)
    : cleanString(process.env.GOOGLE_APPLICATION_CREDENTIALS)
  const projectOverride = options.projectId || cleanString(process.env.CX_CODEX_FIREBASE_PROJECT_ID)
  const android = readJsonInspection(androidConfigPath, inspectAndroidFirebaseConfig)
  const server = readJsonInspection(serviceAccountPath, inspectFirebaseServiceAccount, projectOverride)
  const live = await readLiveStatus(options.baseUrl)
  const report = buildMobilePushReadinessReport({ android, server, live })
  console.log(JSON.stringify(report, null, 2))
  if (options.requireReady && !report.ready) process.exitCode = 1
  else if (options.requireConfiguration && !report.configurationReady) process.exitCode = 1
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (invokedPath === import.meta.url) await main()
