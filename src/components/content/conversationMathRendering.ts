import katex from 'katex'

const MAX_RENDER_CHARACTERS = 4_000
const MAX_CONTROL_SEQUENCES = 128
const MAX_GROUPS = 32
const unsupportedCommands = new Set([
  'def', 'gdef', 'edef', 'xdef', 'let', 'futurelet',
  'newcommand', 'renewcommand', 'providecommand',
  'global', 'long', 'outer', 'expandafter', 'noexpand',
  'csname', 'endcsname', 'catcode', 'scantokens',
  'uppercase', 'lowercase', 'string', 'meaning', 'the',
  'verb', 'message', 'errmessage', 'show',
])

function withinRenderBudget(source: string): boolean {
  if (!source.trim() || source.length > MAX_RENDER_CHARACTERS) return false
  let controls = 0
  let groups = 0
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '{' && ++groups > MAX_GROUPS) return false
    if (source[index] !== '\\') continue
    if (++controls > MAX_CONTROL_SEQUENCES) return false
    const start = ++index
    while (/[a-zA-Z@]/u.test(source[index] ?? '')) index += 1
    const command = source.slice(start, index)
    // Private helpers can define macros indirectly (e.g. tag/df@tag), and
    // verb changes token boundaries. Neither belongs to this bounded surface.
    if (command.includes('@') || unsupportedCommands.has(command)) return false
    if (command) index -= 1
    // A control symbol consumes its next character, so \\ is a matrix row,
    // not the start of a definition. Comment contents are checked as well:
    // conservative source fallback avoids having a second TeX interpreter.
  }
  return true
}

/** Null tells the Markdown renderer to retain the original math source. */
export function renderConversationMath(source: string, display: boolean): string | null {
  // maxExpand counts expansions, not copied tokens. Reject user-programmable
  // expansion and excessive work before entering synchronous KaTeX rendering.
  if (!withinRenderBudget(source)) return null
  try {
    return katex.renderToString(source, {
      displayMode: display,
      output: 'htmlAndMathml',
      throwOnError: true,
      strict: 'error',
      trust: false,
      maxExpand: 1_000,
      maxSize: 20,
      macros: {},
    })
  } catch {
    return null
  }
}
