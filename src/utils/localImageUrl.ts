export function resolveAppRelativeUrl(path: string): string {
  const normalizedPath = path.replace(/^\/+/, '')
  if (typeof window === 'undefined') return `/${normalizedPath}`

  // The web UI is also served below /codex/. Build the endpoint relative to
  // the current app directory instead of assuming the site is mounted at /.
  const pathname = window.location.pathname
  const appDirectory = pathname.endsWith('/') ? pathname : `${pathname}/`
  return new URL(normalizedPath, `${window.location.origin}${appDirectory}`).toString()
}

export function resolveAppRouteUrl(path: string): string {
  return resolveAppRelativeUrl(path)
}

export function toRenderableLocalImageUrl(value: string): string {
  const normalized = value.trim()
  if (!normalized) return ''
  if (
    normalized.startsWith('data:') ||
    normalized.startsWith('blob:') ||
    normalized.startsWith('http://') ||
    normalized.startsWith('https://')
  ) {
    return normalized
  }

  if (normalized.startsWith('/codex-local-image?')) {
    return resolveAppRouteUrl(normalized)
  }

  if (normalized.startsWith('file://')) {
    return resolveAppRouteUrl(`/codex-local-image?path=${encodeURIComponent(normalized)}`)
  }

  const looksLikeUnixAbsolute = normalized.startsWith('/')
  const looksLikeWindowsAbsolute = /^[A-Za-z]:[\\/]/u.test(normalized)
  if (looksLikeUnixAbsolute || looksLikeWindowsAbsolute) {
    return resolveAppRouteUrl(`/codex-local-image?path=${encodeURIComponent(normalized)}`)
  }

  return normalized
}
