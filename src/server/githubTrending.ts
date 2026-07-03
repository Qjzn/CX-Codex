export type GithubTrendingSince = 'daily' | 'weekly' | 'monthly'

export type GithubTrendingItem = {
  id: number
  fullName: string
  url: string
  description: string
  language: string
  stars: number
}

type TranslationCacheEntry = {
  value: string
  expiresAt: number
}

export const GITHUB_DESCRIPTION_TRANSLATION_BATCH_LIMIT = 10

const GITHUB_DESCRIPTION_TRANSLATION_CACHE_TTL_MS = 12 * 60 * 60 * 1000
const GITHUB_DESCRIPTION_TRANSLATION_CACHE_MAX_ENTRIES = 500
const githubDescriptionTranslationCache = new Map<string, TranslationCacheEntry>()

export function normalizeGithubTrendingSince(value: string | null | undefined): GithubTrendingSince {
  const normalized = (value ?? '').trim().toLowerCase()
  if (normalized === 'weekly') return 'weekly'
  if (normalized === 'monthly') return 'monthly'
  return 'daily'
}

export function normalizeGithubTrendingLimit(value: string | null | undefined): number {
  const limitRaw = Number.parseInt((value ?? '6').trim(), 10)
  return Number.isFinite(limitRaw) ? Math.max(1, Math.min(10, limitRaw)) : 6
}

export function normalizeGithubTrendingTranslationDescriptions(value: unknown): string[] {
  const incomingDescriptions = Array.isArray(value) ? value : []
  return incomingDescriptions
    .slice(0, GITHUB_DESCRIPTION_TRANSLATION_BATCH_LIMIT)
    .map((description) => (typeof description === 'string' ? description : ''))
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/gi, '/')
}

export function stripHtml(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
}

export function parseGithubTrendingHtml(html: string, limit: number): GithubTrendingItem[] {
  const rows = html.match(/<article[\s\S]*?<\/article>/g) ?? []
  const items: GithubTrendingItem[] = []
  let seq = Date.now()
  for (const row of rows) {
    const repoBlockMatch = row.match(/<h2[\s\S]*?<\/h2>/)
    const hrefMatch = repoBlockMatch?.[0]?.match(/href="\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)"/)
    if (!hrefMatch) continue
    const fullName = hrefMatch[1] ?? ''
    if (!fullName || items.some((item) => item.fullName === fullName)) continue
    const descriptionMatch =
      row.match(/<p[^>]*class="[^"]*col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/)
      ?? row.match(/<p[^>]*class="[^"]*color-fg-muted[^"]*"[^>]*>([\s\S]*?)<\/p>/)
      ?? row.match(/<p[^>]*>([\s\S]*?)<\/p>/)
    const languageMatch = row.match(/programmingLanguage[^>]*>\s*([\s\S]*?)\s*<\/span>/)
    const starsMatch = row.match(/href="\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/stargazers"[\s\S]*?>([\s\S]*?)<\/a>/)
    const starsText = stripHtml(starsMatch?.[1] ?? '').replace(/,/g, '')
    const stars = Number.parseInt(starsText, 10)
    items.push({
      id: seq,
      fullName,
      url: `https://github.com/${fullName}`,
      description: stripHtml(descriptionMatch?.[1] ?? ''),
      language: stripHtml(languageMatch?.[1] ?? ''),
      stars: Number.isFinite(stars) ? stars : 0,
    })
    seq += 1
    if (items.length >= limit) break
  }
  return items
}

export async function fetchGithubTrending(since: GithubTrendingSince, limit: number): Promise<GithubTrendingItem[]> {
  const endpoint = `https://github.com/trending?since=${since}`
  const response = await fetch(endpoint, {
    headers: {
      'User-Agent': 'codex-web-local',
      Accept: 'text/html',
    },
  })
  if (!response.ok) {
    throw new Error(`GitHub trending fetch failed (${response.status})`)
  }
  const html = await response.text()
  return parseGithubTrendingHtml(html, limit)
}

export function normalizeGithubDescriptionTranslationText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

export function hasCjkCharacters(value: string): boolean {
  return /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(value)
}

export function shouldTranslateGithubDescription(value: string): boolean {
  const normalized = normalizeGithubDescriptionTranslationText(value)
  if (!normalized) return false
  if (hasCjkCharacters(normalized)) return false
  return /[A-Za-z]/u.test(normalized)
}

function pruneGithubDescriptionTranslationCache(): void {
  const now = Date.now()
  for (const [key, entry] of githubDescriptionTranslationCache.entries()) {
    if (entry.expiresAt <= now) {
      githubDescriptionTranslationCache.delete(key)
    }
  }

  if (githubDescriptionTranslationCache.size <= GITHUB_DESCRIPTION_TRANSLATION_CACHE_MAX_ENTRIES) {
    return
  }

  const overflow = githubDescriptionTranslationCache.size - GITHUB_DESCRIPTION_TRANSLATION_CACHE_MAX_ENTRIES
  let removed = 0
  for (const key of githubDescriptionTranslationCache.keys()) {
    githubDescriptionTranslationCache.delete(key)
    removed += 1
    if (removed >= overflow) break
  }
}

export function readGoogleTranslateText(payload: unknown): string {
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) return ''

  let translated = ''
  for (const segment of payload[0]) {
    if (!Array.isArray(segment) || typeof segment[0] !== 'string') continue
    translated += segment[0]
  }

  return normalizeGithubDescriptionTranslationText(translated)
}

export async function translateGithubDescriptionToChinese(text: string): Promise<string> {
  const normalized = normalizeGithubDescriptionTranslationText(text)
  if (!shouldTranslateGithubDescription(normalized)) {
    return normalized
  }

  const cached = githubDescriptionTranslationCache.get(normalized)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }
  if (cached) {
    githubDescriptionTranslationCache.delete(normalized)
  }

  const query = new URLSearchParams({
    client: 'gtx',
    sl: 'auto',
    tl: 'zh-CN',
    dt: 't',
    q: normalized,
  })
  const response = await fetch(`https://translate.googleapis.com/translate_a/single?${query.toString()}`, {
    headers: {
      Accept: 'application/json, text/plain, */*',
      'User-Agent': 'cx-codex-server-bridge',
    },
  })
  if (!response.ok) {
    throw new Error(`GitHub description translation failed (${response.status})`)
  }

  const translated = readGoogleTranslateText(await response.json())
  const nextValue = translated || normalized
  githubDescriptionTranslationCache.set(normalized, {
    value: nextValue,
    expiresAt: Date.now() + GITHUB_DESCRIPTION_TRANSLATION_CACHE_TTL_MS,
  })
  pruneGithubDescriptionTranslationCache()
  return nextValue
}

export async function translateGithubDescriptionsToChinese(descriptions: string[]): Promise<string[]> {
  const normalizedDescriptions = descriptions.map((description) => normalizeGithubDescriptionTranslationText(description))
  const uniqueTranslations = new Map<string, Promise<string>>()

  return await Promise.all(normalizedDescriptions.map(async (description) => {
    if (!description) return ''
    if (!uniqueTranslations.has(description)) {
      uniqueTranslations.set(
        description,
        translateGithubDescriptionToChinese(description).catch(() => description),
      )
    }
    return await uniqueTranslations.get(description)!
  }))
}
