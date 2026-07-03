import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { getSkillsSyncStatePath } from './codexPaths.js'

export type SkillHubEntry = {
  name: string
  owner: string
  description: string
  displayName: string
  publishedAt: number
  avatarUrl: string
  url: string
  installed: boolean
  sourcePath?: string
  repoSlug?: string
  repoRef?: string
  sourceLabel?: string
  stars?: number
  path?: string
  enabled?: boolean
}

export type SkillsTreeEntry = {
  name: string
  owner: string
  url: string
  sourcePath: string
  metaPath?: string
}

export type InstalledSkillInfo = {
  name: string
  path: string
  enabled: boolean
}

type SkillsTreeCache = {
  entries: SkillsTreeEntry[]
  fetchedAt: number
}

type GithubRepoSearchItem = {
  full_name: string
  description?: string | null
  default_branch?: string
  stargazers_count?: number
  pushed_at?: string
  updated_at?: string
  html_url: string
  owner?: {
    login?: string
    avatar_url?: string
  }
}

type GithubSkillSearchCache = {
  entries: SkillHubEntry[]
  total: number
  fetchedAt: number
}

type MetaJson = {
  displayName?: string
  description?: string
  owner?: string
  slug?: string
  latest?: { publishedAt?: number }
}

type SkillsSyncState = {
  githubToken?: string
}

export type SkillsHubSource = {
  owner: string
  repo: string
  ref: string
}

const DEFAULT_HUB_SKILLS_OWNER = 'OpenClawAndroid'
const DEFAULT_HUB_SKILLS_REPO = 'skills'
const DEFAULT_HUB_SKILLS_REF = 'main'
const HOT_GITHUB_SKILL_REPOS = [
  'ComposioHQ/awesome-codex-skills',
  'OpenClawAndroid/skills',
]

const TREE_CACHE_TTL_MS = 5 * 60 * 1000
const GITHUB_SKILL_SEARCH_CACHE_TTL_MS = 10 * 60 * 1000
let skillsTreeCache: SkillsTreeCache | null = null
const metaCache = new Map<string, { description: string; displayName: string; publishedAt: number }>()
const githubSkillSearchCache = new Map<string, GithubSkillSearchCache>()

function getEnvValue(name: string): string {
  return process.env[name]?.trim() ?? ''
}

export function getSkillsHubSource(): SkillsHubSource {
  return {
    owner: getEnvValue('CX_CODEX_SKILLS_HUB_OWNER') || DEFAULT_HUB_SKILLS_OWNER,
    repo: getEnvValue('CX_CODEX_SKILLS_HUB_REPO') || DEFAULT_HUB_SKILLS_REPO,
    ref: getEnvValue('CX_CODEX_SKILLS_HUB_REF') || DEFAULT_HUB_SKILLS_REF,
  }
}

export function getSkillsHubRepoSlug(): string {
  const source = getSkillsHubSource()
  return `${source.owner}/${source.repo}`
}

export function getSkillsHubSkillPath(owner: string, name: string): string {
  return `skills/${owner}/${name}`
}

export function getSkillsHubRawPathUrl(sourcePath: string, fileName: string): string {
  const source = getSkillsHubSource()
  return `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${source.ref}/${sourcePath}/${fileName}`
}

export function getSkillsHubRawFileUrl(owner: string, name: string, fileName: string): string {
  return getSkillsHubRawPathUrl(getSkillsHubSkillPath(owner, name), fileName)
}

async function getSkillsSyncToken(): Promise<string | null> {
  try {
    const raw = await readFile(getSkillsSyncStatePath(), 'utf8')
    const parsed = JSON.parse(raw) as SkillsSyncState
    const token = typeof parsed.githubToken === 'string' ? parsed.githubToken.trim() : ''
    return token || null
  } catch {
    return null
  }
}

function getEnvGithubToken(): string | null {
  return getEnvValue('CX_CODEX_GITHUB_TOKEN') || getEnvValue('GITHUB_TOKEN') || getEnvValue('GH_TOKEN') || null
}

async function getGhCliToken(): Promise<string | null> {
  try {
    const proc = spawn('gh', ['auth', 'token'], { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
    return new Promise((resolve) => {
      proc.on('close', (code) => resolve(code === 0 ? out.trim() : null))
      proc.on('error', () => resolve(null))
    })
  } catch {
    return null
  }
}

async function getGithubToken(): Promise<string | null> {
  return await getSkillsSyncToken() || getEnvGithubToken() || await getGhCliToken()
}

async function ghFetch(url: string): Promise<Response> {
  const token = await getGithubToken()
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'codex-web-local',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  return fetch(url, { headers })
}

export async function fetchSkillsTree(): Promise<SkillsTreeEntry[]> {
  if (skillsTreeCache && Date.now() - skillsTreeCache.fetchedAt < TREE_CACHE_TTL_MS) {
    return skillsTreeCache.entries
  }

  const source = getSkillsHubSource()
  const resp = await ghFetch(`https://api.github.com/repos/${source.owner}/${source.repo}/git/trees/${source.ref}?recursive=1`)
  if (!resp.ok) throw new Error(`GitHub tree API returned ${resp.status}`)
  const data = (await resp.json()) as { tree?: Array<{ path: string; type: string }> }

  const metaPattern = /^skills\/([^/]+)\/([^/]+)\/_meta\.json$/
  const directSkillPattern = /^([^/.][^/]*)\/SKILL\.md$/
  const seen = new Set<string>()
  const entries: SkillsTreeEntry[] = []

  for (const node of data.tree ?? []) {
    const match = metaPattern.exec(node.path)
    if (match) {
      const [, owner, skillName] = match
      const sourcePath = getSkillsHubSkillPath(owner, skillName)
      const key = `${owner}/${skillName}`
      if (seen.has(key)) continue
      seen.add(key)
      entries.push({
        name: skillName,
        owner,
        sourcePath,
        metaPath: node.path,
        url: `https://github.com/${source.owner}/${source.repo}/tree/${source.ref}/${sourcePath}`,
      })
      continue
    }

    const directMatch = directSkillPattern.exec(node.path)
    if (!directMatch) continue
    const [, skillName] = directMatch
    const sourcePath = skillName
    const key = `${source.owner}/${skillName}`
    if (seen.has(key)) continue
    seen.add(key)
    entries.push({
      name: skillName,
      owner: source.owner,
      sourcePath,
      url: `https://github.com/${source.owner}/${source.repo}/tree/${source.ref}/${sourcePath}`,
    })
  }

  skillsTreeCache = { entries, fetchedAt: Date.now() }
  return entries
}

async function fetchMetaBatch(entries: SkillsTreeEntry[]): Promise<void> {
  const toFetch = entries.filter((e) => !metaCache.has(`${e.owner}/${e.name}`))
  if (toFetch.length === 0) return
  const batch = toFetch.slice(0, 50)
  await Promise.allSettled(
    batch.map(async (entry) => {
      const rawUrl = entry.metaPath
        ? getSkillsHubRawPathUrl(entry.sourcePath, '_meta.json')
        : getSkillsHubRawPathUrl(entry.sourcePath, 'SKILL.md')
      const resp = await fetch(rawUrl)
      if (!resp.ok) return
      const text = await resp.text()
      const meta = entry.metaPath ? JSON.parse(text) as MetaJson : extractSkillFrontmatter(text)
      metaCache.set(`${entry.owner}/${entry.name}`, {
        displayName: typeof meta.displayName === 'string' ? meta.displayName : '',
        description: typeof meta.description === 'string' ? meta.description : '',
        publishedAt: meta.latest?.publishedAt ?? 0,
      })
    }),
  )
}

function buildHubEntry(entry: SkillsTreeEntry): SkillHubEntry {
  const cached = metaCache.get(`${entry.owner}/${entry.name}`)
  return {
    name: entry.name,
    owner: entry.owner,
    description: cached?.description ?? '',
    displayName: cached?.displayName ?? '',
    publishedAt: cached?.publishedAt ?? 0,
    avatarUrl: `https://github.com/${entry.owner}.png?size=40`,
    url: entry.url,
    installed: false,
    sourcePath: entry.sourcePath,
  }
}

function getSkillNameFromPath(path: string): string {
  const parts = path.split('/').filter(Boolean)
  if (parts.length >= 2 && parts.at(-1)?.toLowerCase() === 'skill.md') {
    return parts.at(-2) ?? 'skill'
  }
  return 'skill'
}

function getSkillDirFromSkillFile(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/u, '')
  if (normalized.toLowerCase() === 'skill.md') return '.'
  return normalized.replace(/\/?SKILL\.md$/iu, '') || '.'
}

function extractSkillNameFromMarkdown(markdown: string, fallback: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)
  if (!match) return fallback
  for (const rawLine of match[1].split(/\r?\n/)) {
    const separatorIndex = rawLine.indexOf(':')
    if (separatorIndex <= 0) continue
    const key = rawLine.slice(0, separatorIndex).trim()
    const value = rawLine.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '')
    if (key === 'name' && value) return value
    if (key === 'displayName' && value) return value
  }
  return fallback
}

function buildGithubSkillSearchQueries(query: string): string[] {
  const normalized = query.trim()
  if (normalized) {
    return [
      `${normalized} codex skills in:name,description,readme`,
      `${normalized} agent skills in:name,description,readme`,
    ]
  }
  return [
    'codex skills in:name,description,readme',
    'agent skills in:name,description,readme',
  ]
}

async function fetchGithubRepoSkillEntries(repo: GithubRepoSearchItem, maxEntries: number): Promise<SkillHubEntry[]> {
  const repoSlug = repo.full_name
  const branch = repo.default_branch || 'main'
  const treeResp = await ghFetch(`https://api.github.com/repos/${repoSlug}/git/trees/${encodeURIComponent(branch)}?recursive=1`)
  if (!treeResp.ok) return []
  const treeData = await treeResp.json() as { tree?: Array<{ path?: string; type?: string }> }
  const skillFiles = (treeData.tree ?? [])
    .filter((node) => node.type === 'blob' && typeof node.path === 'string' && /(^|\/)SKILL\.md$/iu.test(node.path))
    .map((node) => node.path as string)
    .slice(0, maxEntries)

  const entries: SkillHubEntry[] = []
  for (const skillFile of skillFiles) {
    const sourcePath = getSkillDirFromSkillFile(skillFile)
    const fallbackName = getSkillNameFromPath(skillFile)
    let skillName = fallbackName
    let description = repo.description ?? ''
    try {
      const rawUrl = `https://raw.githubusercontent.com/${repoSlug}/${encodeURIComponent(branch)}/${skillFile.split('/').map(encodeURIComponent).join('/')}`
      const rawResp = await fetch(rawUrl)
      if (rawResp.ok) {
        const markdown = await rawResp.text()
        skillName = extractSkillNameFromMarkdown(markdown, fallbackName)
        description = extractSkillDescriptionFromMarkdown(markdown) || description
      }
    } catch {}

    entries.push({
      name: skillName,
      owner: repo.owner?.login || repoSlug.split('/')[0] || 'github',
      description: description || 'GitHub 上发现的 Codex 技能',
      displayName: skillName,
      publishedAt: Date.parse(repo.pushed_at || repo.updated_at || '') || 0,
      avatarUrl: repo.owner?.avatar_url || `https://github.com/${repoSlug.split('/')[0]}.png?size=40`,
      url: `${repo.html_url}/tree/${encodeURIComponent(branch)}/${sourcePath === '.' ? '' : sourcePath}`,
      installed: false,
      sourcePath,
      repoSlug,
      repoRef: branch,
      sourceLabel: repoSlug,
      stars: repo.stargazers_count ?? 0,
    })
  }
  return entries
}

async function fetchGithubRepoBySlug(repoSlug: string): Promise<GithubRepoSearchItem | null> {
  const resp = await ghFetch(`https://api.github.com/repos/${repoSlug}`)
  if (!resp.ok) return null
  return await resp.json() as GithubRepoSearchItem
}

export async function searchGithubPopularSkills(
  query: string,
  limit: number,
  installedMap: Map<string, InstalledSkillInfo>,
): Promise<{ data: SkillHubEntry[]; total: number }> {
  const normalizedQuery = query.trim().toLowerCase()
  const cacheKey = `${normalizedQuery}::${limit}`
  const cached = githubSkillSearchCache.get(cacheKey)
  if (cached && Date.now() - cached.fetchedAt < GITHUB_SKILL_SEARCH_CACHE_TTL_MS) {
    return { data: cached.entries, total: cached.total }
  }

  const repos = new Map<string, GithubRepoSearchItem>()
  for (const searchQuery of buildGithubSkillSearchQueries(query)) {
    const resp = await ghFetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(searchQuery)}&sort=stars&order=desc&per_page=8`)
    if (!resp.ok) continue
    const payload = await resp.json() as { total_count?: number; items?: GithubRepoSearchItem[] }
    for (const repo of payload.items ?? []) {
      if (repo.full_name && !repos.has(repo.full_name)) repos.set(repo.full_name, repo)
    }
    if (repos.size >= 10) break
  }
  for (const repoSlug of HOT_GITHUB_SKILL_REPOS) {
    if (repos.has(repoSlug)) continue
    if (normalizedQuery && !repoSlug.toLowerCase().includes(normalizedQuery)) continue
    const repo = await fetchGithubRepoBySlug(repoSlug)
    if (repo) repos.set(repoSlug, repo)
  }

  const entries: SkillHubEntry[] = []
  for (const repo of repos.values()) {
    if (entries.length >= limit) break
    const repoEntries = await fetchGithubRepoSkillEntries(repo, Math.min(12, limit - entries.length))
    entries.push(...repoEntries)
  }

  const withInstalledState = entries
    .sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0) || b.publishedAt - a.publishedAt)
    .slice(0, limit)
    .map((entry) => {
      const local = installedMap.get(entry.name)
      return local ? { ...entry, installed: true, enabled: local.enabled } : entry
    })

  githubSkillSearchCache.set(cacheKey, {
    entries: withInstalledState,
    total: withInstalledState.length,
    fetchedAt: Date.now(),
  })
  return { data: withInstalledState, total: withInstalledState.length }
}

export async function searchSkillsHub(
  allEntries: SkillsTreeEntry[],
  query: string,
  limit: number,
  sort: string,
  installedMap: Map<string, InstalledSkillInfo>,
): Promise<SkillHubEntry[]> {
  const normalizedQuery = query.toLowerCase().trim()
  const filtered = normalizedQuery
    ? allEntries.filter((entry) => {
      if (entry.name.toLowerCase().includes(normalizedQuery) || entry.owner.toLowerCase().includes(normalizedQuery)) {
        return true
      }
      const cached = metaCache.get(`${entry.owner}/${entry.name}`)
      return Boolean(
        cached?.displayName?.toLowerCase().includes(normalizedQuery)
        || cached?.description?.toLowerCase().includes(normalizedQuery),
      )
    })
    : allEntries

  const page = filtered.slice(0, Math.min(limit * 2, 200))
  await fetchMetaBatch(page)
  const results = page.map(buildHubEntry)

  if (sort === 'date') {
    results.sort((a, b) => b.publishedAt - a.publishedAt)
  } else if (normalizedQuery) {
    results.sort((a, b) => {
      const aExact = a.name.toLowerCase() === normalizedQuery ? 1 : 0
      const bExact = b.name.toLowerCase() === normalizedQuery ? 1 : 0
      if (aExact !== bExact) return bExact - aExact
      return b.publishedAt - a.publishedAt
    })
  }

  return results.slice(0, limit).map((entry) => {
    const local = installedMap.get(entry.name)
    return local ? { ...entry, installed: true, enabled: local.enabled } : entry
  })
}

export async function buildInstalledHubEntries(
  allEntries: SkillsTreeEntry[],
  installedMap: Map<string, InstalledSkillInfo>,
): Promise<SkillHubEntry[]> {
  const installedHubEntries = allEntries.filter((entry) => installedMap.has(entry.name))
  await fetchMetaBatch(installedHubEntries)

  const installed: SkillHubEntry[] = []
  for (const [, info] of installedMap) {
    const hubEntry = allEntries.find((entry) => entry.name === info.name)
    const base = hubEntry ? buildHubEntry(hubEntry) : {
      name: info.name,
      owner: 'local',
      description: '',
      displayName: '',
      publishedAt: 0,
      avatarUrl: '',
      url: '',
      installed: false,
      sourcePath: undefined,
    }
    const localMeta = await readLocalSkillMeta(info.path)
    installed.push({
      ...base,
      displayName: base.displayName || localMeta.displayName || '',
      description: base.description || localMeta.description || '',
      installed: true,
      enabled: info.enabled,
    })
  }
  return installed
}

async function readLocalSkillMeta(skillPath: string): Promise<MetaJson> {
  if (!skillPath) return {}
  try {
    const content = await readFile(skillPath, 'utf8')
    return extractSkillFrontmatter(content)
  } catch {
    return {}
  }
}

function extractSkillFrontmatter(markdown: string): MetaJson {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)
  if (!match) {
    return { description: extractSkillDescriptionFromMarkdown(markdown) }
  }
  const meta: MetaJson = {}
  for (const rawLine of match[1].split(/\r?\n/)) {
    const separatorIndex = rawLine.indexOf(':')
    if (separatorIndex <= 0) continue
    const key = rawLine.slice(0, separatorIndex).trim()
    const value = rawLine.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '')
    if (key === 'displayName') meta.displayName = value
    if (key === 'description') meta.description = value
  }
  return meta
}

export function extractSkillDescriptionFromMarkdown(markdown: string): string {
  const lines = markdown.split(/\r?\n/)
  let inCodeFence = false
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line.startsWith('```')) {
      inCodeFence = !inCodeFence
      continue
    }
    if (inCodeFence || line.length === 0) continue
    if (line.startsWith('#')) continue
    if (line.startsWith('>')) continue
    if (line.startsWith('- ') || line.startsWith('* ')) continue
    return line
  }
  return ''
}
