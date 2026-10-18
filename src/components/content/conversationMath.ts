import type { MarkdownIt, StateInline } from 'markdown-it'
import { renderConversationMath } from './conversationMathRendering'

const MAX_MATH_CHARACTERS = 8_000
export type ConversationMathEnvironment = { math: string[]; mathRender?: (source: string, display: boolean) => string | null }
export const mathPlaceholder = /<span data-rich-text-math="(\d+)"><\/span>/gu

type MathDelimiter = '$' | '$$' | '\\)' | '\\]'
type MathDelimiterIndex = { source: string; delimiters: Record<MathDelimiter, number[]>; code: number[]; newlines: number[] }
const delimiterIndexes = new WeakMap<object, MathDelimiterIndex>()

/** Each Markdown state scans its source once, including unfinished streamed text. */
function delimiterIndex(state: object, source: string): MathDelimiterIndex {
  const previous = delimiterIndexes.get(state)
  if (previous?.source === source) return previous
  const index: MathDelimiterIndex = { source, delimiters: { '$': [], '$$': [], '\\)': [], '\\]': [] }, code: [], newlines: [] }
  let slashes = 0
  let fencePrefix = true
  for (let position = 0; position < source.length; position += 1) {
    const character = source[position]
    const escaped = slashes % 2 === 1
    if (!escaped) {
      if (character === '$') {
        index.delimiters.$.push(position)
        if (source[position + 1] === '$') index.delimiters.$$.push(position)
      } else if (character === '\\') {
        if (source[position + 1] === ')') index.delimiters['\\)'].push(position)
        if (source[position + 1] === ']') index.delimiters['\\]'].push(position)
      } else if (character === '`' || character === '~' && fencePrefix && source.startsWith('~~~', position)) {
        index.code.push(position)
      }
    }
    if (character === '\n') index.newlines.push(position)
    fencePrefix = character === '\n' || fencePrefix && (character === ' ' || character === '\t' || character === '>')
    slashes = character === '\\' ? slashes + 1 : 0
  }
  delimiterIndexes.set(state, index)
  return index
}

function atOrAfter(positions: readonly number[], start: number): number {
  let lower = 0
  let upper = positions.length
  while (lower < upper) {
    const middle = (lower + upper) >>> 1
    if (positions[middle]! < start) lower = middle + 1
    else upper = middle
  }
  return positions[lower] ?? -1
}

function beforeOrAt(position: number, end: number): boolean {
  return position >= 0 && position <= end
}

function startsWithPrice(source: string): boolean {
  const amount = /^\d+(?:[.,]\d+)?/u.exec(source)?.[0]
  if (!amount) return false
  const remainder = source.slice(amount.length)
  // A plain amount followed by prose/Markdown is currency. Mathematical
  // numbers, variables and operators ($10$, $2 x$, $2 + 2$) remain valid.
  return /^[\t ]*(?:\p{Script=Han}|\*\*|__|~~)/u.test(remainder)
    || /^[\t ]*[,.;:!?，。；：！？、]+[\t ]*(?:\p{Script=Han}|[A-Za-z]{2,}\b|\*\*|__|~~)/u.test(remainder)
    || /^[\t ]+[A-Za-z]{2,}(?:[\t ]+[A-Za-z]{2,}\b|[\t ]*[,.;:!?])/u.test(remainder)
}

function inlineMath(state: StateInline, silent: boolean): boolean {
  const start = state.pos
  const source = state.src
  const opening = source.startsWith('$$', start) ? '$$'
    : source[start] === '$' ? '$'
      : source.startsWith('\\(', start) ? '\\('
        : source.startsWith('\\[', start) ? '\\[' : ''
  if (!opening) return false
  const closing: MathDelimiter = opening === '\\(' ? '\\)' : opening === '\\[' ? '\\]' : opening
  const contentStart = start + opening.length
  // A partial $$ delimiter must not be reinterpreted using its second dollar.
  const index = delimiterIndex(state, source)
  if (opening === '$' && source[start - 1] === '$' && atOrAfter(index.delimiters.$, start - 1) === start - 1) return false
  if (opening === '$' && (/\s/u.test(source[contentStart] ?? '') || /[\da-z]/iu.test(source[start - 1] ?? '') && /\d/u.test(source[contentStart] ?? ''))) return false
  let end = atOrAfter(index.delimiters[closing], contentStart)
  if (beforeOrAt(atOrAfter(index.code, contentStart), end)) end = -1
  // Never cross a line for inline math, or pair a currency amount with a later formula.
  if (opening === '$' && (end < 0 || source[end + 1] === '$' || /\s/u.test(source[end - 1] ?? '') || /\d/u.test(source[end + 1] ?? '') || beforeOrAt(atOrAfter(index.newlines, contentStart), end) || startsWithPrice(source.slice(contentStart, end)))) return false
  if (end < 0 || end >= state.posMax) {
    // Markdown normally consumes the slash in an unfinished \( or \[.
    if (opening[0] !== '\\') return false
    if (!silent) state.pending += opening
    state.pos = contentStart
    return true
  }
  if (!silent) {
    const token = state.push('conversation_math', '', 0)
    token.content = source.slice(contentStart, end)
    token.markup = source.slice(start, end + closing.length)
    token.meta = { display: opening === '$$' || opening === '\\[' }
  }
  state.pos = end + closing.length
  return true
}

/** Math tokens are recognized before escapes, never inside Markdown code tokens. */
export function installConversationMath(markdown: MarkdownIt): void {
  markdown.inline.ruler.before('escape', 'conversation_math', inlineMath)
  markdown.block.ruler.before('fence', 'conversation_math_block', (state, startLine, endLine, silent) => {
    if (state.sCount[startLine]! - state.blkIndent >= 4) return false
    const first = state.src.slice(state.bMarks[startLine]! + state.tShift[startLine]!, state.eMarks[startLine])
    const opening = first.startsWith('$$') ? '$$' : first.startsWith('\\[') ? '\\[' : ''
    if (!opening) return false
    const closing = opening === '$$' ? '$$' : '\\]'
    const contentStart = state.bMarks[startLine]! + state.tShift[startLine]! + opening.length
    const index = delimiterIndex(state, state.src)
    const ending = atOrAfter(index.delimiters[closing], contentStart)
    // Reject unfinished blocks before walking their lines. Multiple openers in
    // a long paragraph must not repeatedly search the rest of the document.
    if (ending < 0 || ending > state.eMarks[endLine - 1]! || ending - contentStart > MAX_MATH_CHARACTERS || beforeOrAt(atOrAfter(index.code, contentStart), ending)) return false
    let line = startLine
    let part = first.slice(opening.length)
    let content = ''
    for (; line < endLine; line += 1) {
      if (line > startLine) {
        if (state.sCount[line]! < state.blkIndent && !state.isEmpty(line)) return false
        part = state.getLines(line, line + 1, state.blkIndent, false)
      }
      const close = ending <= state.eMarks[line]! ? part.length - (state.eMarks[line]! - ending) : -1
      if (close >= 0) {
        // Trailing prose belongs to the inline parser, not a consumed block.
        if (part.slice(close + closing.length).trim()) return false
        if (silent) return true
        const token = state.push('conversation_math', '', 0)
        token.block = true
        token.content = content + part.slice(0, close)
        token.markup = `${opening}${token.content}${closing}`
        token.meta = { display: true }
        token.map = [startLine, line + 1]
        state.line = line + 1
        return true
      }
      content += `${part}\n`
      if (content.length > MAX_MATH_CHARACTERS) return false
    }
    return false
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })

  markdown.renderer.rules.conversation_math = (tokens, index, _options, environment) => {
    const token = tokens[index]!
    const fallback = () => `<span class="rich-text-math-source">${markdown.utils.escapeHtml(token.markup)}</span>`
    if (!token.content.trim() || token.content.length > MAX_MATH_CHARACTERS) return fallback()
    const env = environment as ConversationMathEnvironment
    const display = token.meta?.display === true
    const html = (env.mathRender ?? renderConversationMath)(token.content, display)
    if (html === null) return fallback()
    const wrapped = `<span class="rich-text-math${display ? ' rich-text-math-display' : ''}"${display ? ' tabindex="0" role="region" aria-label="数学公式，可横向滚动"' : ''}>${html}</span>`
    const position = env.math.push(wrapped) - 1
    // Raw Markdown HTML is disabled. Only this token creates a real placeholder;
    // user-authored lookalikes remain escaped text and cannot be substituted.
    return `<span data-rich-text-math="${String(position)}"></span>`
  }
}
