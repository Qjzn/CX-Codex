const LATEST_RELEASE_API_URL = 'https://api.github.com/repos/Qjzn/CX-Codex/releases/latest'
const RELEASES_PAGE_URL = 'https://github.com/Qjzn/CX-Codex/releases'
const LATEST_RELEASE_TIMEOUT_MS = 12_000

export type MobileReleaseAsset = {
  name: string
  downloadUrl: string
  size: number
  updatedAtIso: string
  contentType: string
}

export type MobileLatestRelease = {
  tagName: string
  releaseName: string
  publishedAtIso: string
  htmlUrl: string
  bodyMarkdown: string
  asset: MobileReleaseAsset | null
}

type GithubReleaseAsset = {
  name?: string
  browser_download_url?: string
  size?: number
  updated_at?: string
  content_type?: string
}

type GithubLatestReleaseResponse = {
  tag_name?: string
  name?: string
  published_at?: string
  html_url?: string
  body?: string
  assets?: GithubReleaseAsset[]
}

const APK_ASSET_PATTERNS = [
  /^cx-codex-android-.*\.apk$/iu,
  /^cx-codex.*\.apk$/iu,
  /^cxcodex-android-.*\.apk$/iu,
  /^codexui-android-.*\.apk$/iu,
  /android.*release.*\.apk$/iu,
  /\.apk$/iu,
]

function normalizeText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeReleaseVersion(value: string): string {
  const normalized = normalizeText(value).toLowerCase()
  return normalized.startsWith('v') ? normalized.slice(1) : normalized
}

function tokenizeReleaseVersion(value: string): Array<number | string> {
  const normalized = normalizeReleaseVersion(value)
  const matches = normalized.match(/[a-z]+|\d+/giu) ?? []
  return matches.map((token) => (/^\d+$/u.test(token) ? Number(token) : token))
}

export function compareMobileReleaseVersions(leftValue: string, rightValue: string): number {
  const left = tokenizeReleaseVersion(leftValue)
  const right = tokenizeReleaseVersion(rightValue)
  const maxLength = Math.max(left.length, right.length)
  for (let index = 0; index < maxLength; index += 1) {
    const leftToken = left[index]
    const rightToken = right[index]
    if (leftToken === undefined && rightToken === undefined) return 0
    if (leftToken === undefined) return -1
    if (rightToken === undefined) return 1
    if (typeof leftToken === 'number' && typeof rightToken === 'number') {
      if (leftToken !== rightToken) return leftToken > rightToken ? 1 : -1
      continue
    }
    const leftString = String(leftToken)
    const rightString = String(rightToken)
    if (leftString !== rightString) {
      return leftString.localeCompare(rightString, 'en', { sensitivity: 'base' })
    }
  }
  return 0
}

function resolveApkAsset(assets: GithubReleaseAsset[]): MobileReleaseAsset | null {
  const normalizedAssets = assets
    .map((asset) => ({
      name: normalizeText(asset.name),
      downloadUrl: normalizeText(asset.browser_download_url),
      size: Number.isFinite(asset.size) ? Number(asset.size) : 0,
      updatedAtIso: normalizeText(asset.updated_at),
      contentType: normalizeText(asset.content_type),
    }))
    .filter((asset) => asset.name && asset.downloadUrl)

  for (const pattern of APK_ASSET_PATTERNS) {
    const match = normalizedAssets.find((asset) => pattern.test(asset.name))
    if (match) return match
  }

  return null
}

export function isMobileReleaseUpdateAvailable(currentVersionName: string, latestTagName: string): boolean {
  const currentVersion = normalizeReleaseVersion(currentVersionName)
  const latestVersion = normalizeReleaseVersion(latestTagName)
  if (!latestVersion) return false
  if (!currentVersion) return true
  return compareMobileReleaseVersions(latestVersion, currentVersion) > 0
}

export function getMobileReleasesPageUrl(): string {
  return RELEASES_PAGE_URL
}

export async function fetchLatestMobileRelease(): Promise<MobileLatestRelease> {
  const controller = typeof AbortController === 'undefined' ? null : new AbortController()
  const timeoutId =
    controller
      ? window.setTimeout(() => controller.abort(), LATEST_RELEASE_TIMEOUT_MS)
      : null

  let response: Response
  try {
    response = await fetch(LATEST_RELEASE_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
      },
      cache: 'no-store',
      signal: controller?.signal,
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('读取 GitHub 发布信息超时，请稍后再试')
      }
      throw error
    })
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId)
    }
  }

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error('GitHub 发布接口暂时不可用，稍后再试')
    }
    throw new Error(`读取 GitHub 发布信息失败（HTTP ${response.status}）`)
  }

  const payload = (await response.json()) as GithubLatestReleaseResponse
  const assets = Array.isArray(payload.assets) ? payload.assets : []

  return {
    tagName: normalizeText(payload.tag_name),
    releaseName: normalizeText(payload.name),
    publishedAtIso: normalizeText(payload.published_at),
    htmlUrl: normalizeText(payload.html_url) || RELEASES_PAGE_URL,
    bodyMarkdown: normalizeText(payload.body),
    asset: resolveApkAsset(assets),
  }
}
