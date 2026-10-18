import MarkdownIt from 'markdown-it'
import { normalizeCodeLanguage } from './conversationCodeHighlight'
import { installConversationMath, mathPlaceholder, type ConversationMathEnvironment } from './conversationMath'
import { renderConversationMath } from './conversationMathRendering'

export type ConversationRichTextBlock = {
  key: string
  kind: string
  html: string
  code: readonly string[]
}

/** Protect only the displayed selection; incoming message data is never paused. */
export function retainSelectedRichTextBlocks(
  incoming: readonly ConversationRichTextBlock[],
  displayed: readonly ConversationRichTextBlock[],
  selectedKeys: ReadonlySet<string>,
): readonly ConversationRichTextBlock[] {
  const selected = new Map(displayed.filter((block) => selectedKeys.has(block.key)).map((block) => [block.key, block]))
  if (selected.size === 0) return incoming
  const incomingKeys = new Set(incoming.map((block) => block.key))
  // An unfinished Markdown block can change kind/key (e.g. a setext heading).
  // Keep this mounted message's last display only until the selection clears.
  if ([...selected.keys()].some((key) => !incomingKeys.has(key))) return displayed
  return incoming.map((block) => selected.get(block.key) ?? block)
}

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true })
installConversationMath(markdown)
type MarkdownToken = ReturnType<(typeof markdown)['parse']>[number]
type RenderEnvironment = ConversationMathEnvironment & { code: string[]; [key: string]: unknown }

/** Convert a Markdown destination, never a relative path or a filesystem read. */
export function toConversationLocalFileLink(destination: string): { href: string; title: string } | null {
  if (/^\/(?:codex-local-browse\/|local-preview\.html\?)/u.test(destination)) return null
  if (destination.startsWith('/codex-local-file?')) {
    const params = new URLSearchParams(destination.slice('/codex-local-file?'.length).split('#', 1)[0])
    // Match the server's unambiguous attachment mode. An inline=1 override or
    // duplicate download parameter must not turn an HTML read into navigation.
    const downloads = params.getAll('download')
    if (downloads.length === 1 && downloads[0] === '1' && !params.getAll('inline').includes('1')) return null
    const paths = params.getAll('path')
    return paths.length === 1 ? previewLinkForAbsolutePath(paths[0]!) : null
  }
  try {
    return previewLinkForAbsolutePath(decodeURIComponent(destination))
  } catch {
    return null
  }
}

function previewLinkForAbsolutePath(decoded: string): { href: string; title: string } | null {
  if (/[\u0000-\u001f\u007f]/u.test(decoded)) return null
  const title = decoded
  const normalized = decoded.replace(/\\/gu, '/')
  if (!/^[a-z]:\//iu.test(normalized) && !/^\/(?!\/)/u.test(normalized)) return null
  if (normalized.startsWith('//') || /(?:^|\/)\.\.(?:\/|$)/u.test(normalized)) return null
  // Existing file routes have no line-jump contract. Keep the complete location
  // in the title, but do not send a line/column suffix as part of the filename.
  const path = normalized.replace(/:[1-9]\d*(?::[1-9]\d*)?$/u, '')
  try {
    // The preview fetches through the existing authorized file route. Linking
    // directly to that route would execute HTML/SVG as a same-origin document.
    return { href: `/local-preview.html?path=${encodeURIComponent(path)}`, title }
  } catch {
    return null
  }
}

const defaultValidateLink = markdown.validateLink.bind(markdown)
markdown.validateLink = (url) => {
  if (toConversationLocalFileLink(url)) return true
  const scheme = /^([a-z][a-z\d+.-]*):/iu.exec(url)?.[1]?.toLowerCase()
  return (!scheme || scheme === 'http' || scheme === 'https' || scheme === 'mailto') && defaultValidateLink(url)
}

const defaultLinkOpen = markdown.renderer.rules.link_open
  ?? ((tokens, index, options, _env, renderer) => renderer.renderToken(tokens, index, options))

markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  const token = tokens[index]
  const local = toConversationLocalFileLink(String(token?.attrGet('href') ?? ''))
  if (local) {
    token?.attrSet('href', local.href)
    const suppliedTitle = String(token?.attrGet('title') ?? '')
    token?.attrSet('title', suppliedTitle && suppliedTitle !== local.title ? `${suppliedTitle}\n${local.title}` : local.title)
  }
  token?.attrSet('target', '_blank')
  token?.attrSet('rel', 'noopener noreferrer')
  return defaultLinkOpen(tokens, index, options, env, renderer)
}

markdown.core.ruler.after('inline', 'conversation_task_items', (state) => {
  for (let index = 0; index < state.tokens.length; index += 1) {
    const item = state.tokens[index]
    if (item?.type !== 'list_item_open' || state.tokens[index + 1]?.type !== 'paragraph_open') continue
    const inline = state.tokens[index + 2]
    const first = inline?.type === 'inline' ? inline.children?.[0] : undefined
    if (first?.type !== 'text') continue
    const marker = /^\[([ xX])\][\t ]+/u.exec(first.content)
    if (!marker) continue
    item.attrJoin('class', 'rich-text-task-item')
    first.content = first.content.slice(marker[0].length)
    first.meta = { ...first.meta, conversationTaskChecked: marker[1]?.toLowerCase() === 'x' }
  }
})

const defaultText = markdown.renderer.rules.text
markdown.renderer.rules.text = (tokens, index, options, env, renderer) => {
  const token = tokens[index]!
  const text = defaultText ? defaultText(tokens, index, options, env, renderer) : markdown.utils.escapeHtml(token.content)
  const checked: unknown = token.meta?.conversationTaskChecked
  if (typeof checked !== 'boolean') return text
  return `<input class="rich-text-task-checkbox" type="checkbox" disabled${checked ? ' checked' : ''} aria-label="${checked ? '已完成' : '未完成'}">${text}`
}

function renderCode(token: MarkdownToken, env: RenderEnvironment): string {
  const index = env.code.push(token.content) - 1
  const language = token.type === 'fence' ? token.info.trim().split(/\s+/u)[0] || '' : ''
  const label = markdown.utils.escapeHtml(language || '代码')
  const content = markdown.utils.escapeHtml(token.content)
  const highlightLanguage = normalizeCodeLanguage(language)
  const codeAttributes = highlightLanguage ? ` data-code-language="${highlightLanguage}"` : ''
  return `<div class="rich-text-code"><div class="rich-text-code-toolbar"><span>${label}</span><button type="button" class="rich-text-code-copy" data-rich-text-copy="${String(index)}" aria-label="复制代码">复制</button></div><pre tabindex="0" aria-label="代码内容"><code${codeAttributes}>${content}</code></pre></div>\n`
}

markdown.renderer.rules.fence = (tokens, index, _options, env) => renderCode(tokens[index]!, env as RenderEnvironment)
markdown.renderer.rules.code_block = (tokens, index, _options, env) => renderCode(tokens[index]!, env as RenderEnvironment)
markdown.renderer.rules.table_open = () => '<div class="rich-text-table" role="region" aria-label="表格，可横向滚动" tabindex="0"><table>\n'
markdown.renderer.rules.table_close = () => '</table></div>\n'

function groupTopLevelTokens(tokens: MarkdownToken[]): MarkdownToken[][] {
  const groups: MarkdownToken[][] = []
  let current: MarkdownToken[] = []
  let depth = 0
  for (const token of tokens) {
    current.push(token)
    depth += token.nesting
    if (depth === 0) {
      groups.push(current)
      current = []
    }
  }
  if (current.length > 0) groups.push(current)
  return groups
}

const MAX_CACHED_MATH_ENTRIES = 128
const MAX_CACHED_MATH_CHARACTERS = 512 * 1_024
type CachedMath = { html: string | null; characters: number }

/** A mounted message owns only its latest render; no cross-thread text cache. */
export function createConversationRichTextRenderer(
  sanitizeHtml: (html: string) => string,
  sanitizeMathHtml: (html: string) => string = sanitizeHtml,
): (text: string) => readonly ConversationRichTextBlock[] {
  let previousText: string | undefined
  let previousBlocks: readonly ConversationRichTextBlock[] = []
  let previousRawHtml = new Map<string, string>()
  let previousMath = new Map<string, CachedMath>()

  return (text) => {
    if (text === previousText) return previousBlocks

    // Parse the complete document so later reference definitions and incomplete
    // fences/lists can correctly change earlier blocks. Only unchanged rendered
    // blocks are retained; no paragraph is permanently frozen by a heuristic.
    // Reuse KaTeX work before HTML/block comparison. Retain only formulas used
    // by this render, bounded independently of message length and history.
    const nextMath = new Map<string, CachedMath>()
    let nextMathCharacters = 0
    const mathRender: typeof renderConversationMath = (source, display) => {
      const key = `${display ? 'display' : 'inline'}:${source}`
      const cached = nextMath.get(key) ?? previousMath.get(key)
      const html = cached ? cached.html : renderConversationMath(source, display)
      if (!nextMath.has(key) && nextMath.size < MAX_CACHED_MATH_ENTRIES) {
        const characters = cached?.characters ?? key.length + (html?.length ?? 0)
        if (nextMathCharacters + characters <= MAX_CACHED_MATH_CHARACTERS) {
          nextMath.set(key, cached ?? { html, characters })
          nextMathCharacters += characters
        }
      }
      // Results beyond either budget still render normally; they are not
      // retained. A null result caches a safe source fallback when it fits.
      return html
    }
    const env: RenderEnvironment = { code: [], math: [], mathRender }
    const groups = groupTopLevelTokens(markdown.parse(text, env))
    const previousByKey = new Map(previousBlocks.map((block) => [block.key, block]))
    const nextRawHtml = new Map<string, string>()
    const nextBlocks = groups.map((tokens, index): ConversationRichTextBlock => {
      const first = tokens[0]!
      const key = `${String(first.map?.[0] ?? index)}:${first.type}`
      const blockEnv: RenderEnvironment = { ...env, code: [], math: [] }
      const rawHtml = markdown.renderer.render(tokens, markdown.options, blockEnv)
      const expandedHtml = rawHtml.replace(mathPlaceholder, (_placeholder, position: string) => blockEnv.math[Number(position)] ?? '')
      nextRawHtml.set(key, expandedHtml)
      const previous = previousByKey.get(key)
      if (previous && previousRawHtml.get(key) === expandedHtml) return previous
      return {
        key,
        kind: first.tag || first.type,
        // Keep the ordinary HTML sanitizer unchanged; only generated KaTeX
        // receives the separate MathML/SVG sanitizer before insertion.
        html: sanitizeHtml(rawHtml).replace(mathPlaceholder, (_placeholder, position: string) => sanitizeMathHtml(blockEnv.math[Number(position)] ?? '')),
        code: blockEnv.code,
      }
    })

    previousText = text
    previousBlocks = nextBlocks
    previousRawHtml = nextRawHtml
    previousMath = nextMath
    return nextBlocks
  }
}
