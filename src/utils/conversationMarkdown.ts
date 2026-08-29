import MarkdownIt from 'markdown-it'

export type ConversationMarkdownBlock =
  | { kind: 'text'; value: string }
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; value: string }
  | { kind: 'list'; ordered: boolean; start: number; items: string[] }
  | { kind: 'blockquote'; value: string }
  | { kind: 'thematicBreak' }

const markdownParser = new MarkdownIt({
  html: false,
  breaks: false,
  linkify: false,
  typographer: false,
})

type MarkdownToken = ReturnType<(typeof markdownParser)['parse']>[number]

const STRUCTURAL_MARKDOWN_PATTERN = /(?:^|\n) {0,3}(?:#{1,6}[\t ]+|[-+*][\t ]+|\d+[.)][\t ]+|>[\t ]?|(?:[-*_][\t ]*){3,}(?:\n|$))/u
const FENCE_LINE_PATTERN = /(?:^|\n) {0,3}(?:```|~~~)/u

function inlineValue(tokens: MarkdownToken[], index: number): string {
  const token = tokens[index]
  return token?.type === 'inline' ? token.content : ''
}

function readList(
  tokens: MarkdownToken[],
  startIndex: number,
): { block: Extract<ConversationMarkdownBlock, { kind: 'list' }>; endIndex: number } {
  const opening = tokens[startIndex]
  const ordered = opening?.type === 'ordered_list_open'
  const closingType = ordered ? 'ordered_list_close' : 'bullet_list_close'
  const directItemLevel = (opening?.level ?? 0) + 1
  const items: string[] = []
  let currentParts: string[] | null = null
  let index = startIndex + 1

  for (; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token) continue
    if (token.type === closingType && token.level === opening?.level) break

    if (token.type === 'list_item_open' && token.level === directItemLevel) {
      currentParts = []
      continue
    }
    if (token.type === 'list_item_close' && token.level === directItemLevel) {
      items.push((currentParts ?? []).join('\n').trim())
      currentParts = null
      continue
    }
    if (currentParts && token.type === 'inline' && token.content.trim()) {
      currentParts.push(token.content)
    }
  }

  const start = Number.parseInt(opening?.attrGet('start') ?? '1', 10)
  return {
    block: {
      kind: 'list',
      ordered,
      start: Number.isFinite(start) && start > 0 ? start : 1,
      items,
    },
    endIndex: index,
  }
}

function readBlockquote(
  tokens: MarkdownToken[],
  startIndex: number,
): { block: Extract<ConversationMarkdownBlock, { kind: 'blockquote' }>; endIndex: number } {
  const openingLevel = tokens[startIndex]?.level ?? 0
  const parts: string[] = []
  let index = startIndex + 1

  for (; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token) continue
    if (token.type === 'blockquote_close' && token.level === openingLevel) break
    if (token.type === 'inline' && token.content.trim()) parts.push(token.content)
  }

  return {
    block: { kind: 'blockquote', value: parts.join('\n') },
    endIndex: index,
  }
}

export function hasConversationMarkdownStructure(text: string): boolean {
  if (!STRUCTURAL_MARKDOWN_PATTERN.test(text)) return false
  // An unfinished fence is common during streaming. Keep it literal until the
  // existing fenced-code renderer can own the complete block.
  return !FENCE_LINE_PATTERN.test(text)
}

export function parseConversationMarkdownBlocks(text: string): ConversationMarkdownBlock[] {
  if (!hasConversationMarkdownStructure(text)) return [{ kind: 'text', value: text }]

  const tokens = markdownParser.parse(text, {})
  const blocks: ConversationMarkdownBlock[] = []

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token) continue

    if (token.type === 'heading_open') {
      const parsedLevel = Number.parseInt(token.tag.slice(1), 10)
      const level = Math.min(6, Math.max(1, Number.isFinite(parsedLevel) ? parsedLevel : 2)) as 1 | 2 | 3 | 4 | 5 | 6
      blocks.push({ kind: 'heading', level, value: inlineValue(tokens, index + 1) })
      index += 2
      continue
    }

    if (token.type === 'paragraph_open') {
      blocks.push({ kind: 'text', value: inlineValue(tokens, index + 1) })
      index += 2
      continue
    }

    if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
      const list = readList(tokens, index)
      blocks.push(list.block)
      index = list.endIndex
      continue
    }

    if (token.type === 'blockquote_open') {
      const quote = readBlockquote(tokens, index)
      blocks.push(quote.block)
      index = quote.endIndex
      continue
    }

    if (token.type === 'hr') blocks.push({ kind: 'thematicBreak' })
  }

  return blocks.length > 0 ? blocks : [{ kind: 'text', value: text }]
}
