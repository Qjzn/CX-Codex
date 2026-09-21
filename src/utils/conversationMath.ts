import katex from 'katex'
import DOMPurify from 'dompurify'

export type ConversationInlineMathPart =
  | { kind: 'text'; value: string }
  | { kind: 'math'; value: string; html: string }

export type ConversationDisplayMathPart =
  | { kind: 'text'; value: string }
  | { kind: 'math'; value: string }

function isEscapedAt(text: string, index: number): boolean {
  let slashCount = 0
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    slashCount += 1
  }
  return slashCount % 2 === 1
}

function renderMath(value: string, displayMode: boolean): string | null {
  const source = value.trim()
  if (!source) return null

  try {
    const rendered = katex.renderToString(source, {
      displayMode,
      output: 'htmlAndMathml',
      throwOnError: true,
      strict: 'ignore',
      trust: false,
    })
    return DOMPurify.sanitize(rendered, {
      USE_PROFILES: { html: true, mathMl: true, svg: false },
    })
  } catch {
    // Keep malformed or unsupported formulas as readable source text rather
    // than letting one assistant message break the whole conversation render.
    return null
  }
}

export function renderConversationMath(value: string, displayMode: boolean): string | null {
  return renderMath(value, displayMode)
}

function readInlineMathAt(text: string, startIndex: number): { end: number; value: string } | null {
  if (isEscapedAt(text, startIndex)) return null

  const isDollar =
    text[startIndex] === '$'
    && text[startIndex - 1] !== '$'
    && text[startIndex + 1] !== '$'
  const isParen = text.startsWith('\\(', startIndex)
  if (!isDollar && !isParen) return null

  const openingLength = isDollar ? 1 : 2
  const closingDelimiter = isDollar ? '$' : '\\)'
  let cursor = startIndex + openingLength

  while (cursor < text.length) {
    if (text[cursor] === '\n') return null
    if (
      text.startsWith(closingDelimiter, cursor)
      && !isEscapedAt(text, cursor)
      && (isDollar ? text[cursor - 1] !== '$' && text[cursor + 1] !== '$' : true)
    ) {
      const value = text.slice(startIndex + openingLength, cursor)
      if (!value.trim()) return null
      return { end: cursor + closingDelimiter.length, value: value.trim() }
    }
    cursor += 1
  }

  return null
}

function appendTextPart(parts: ConversationInlineMathPart[], value: string): void {
  if (!value) return
  const previous = parts[parts.length - 1]
  if (previous?.kind === 'text') previous.value += value
  else parts.push({ kind: 'text', value })
}

export function splitInlineConversationMath(text: string): ConversationInlineMathPart[] {
  if (!text || (!text.includes('$') && !text.includes('\\('))) {
    return text ? [{ kind: 'text', value: text }] : []
  }

  const parts: ConversationInlineMathPart[] = []
  let textStart = 0
  let cursor = 0

  while (cursor < text.length) {
    const candidate = text[cursor] === '$' || text.startsWith('\\(', cursor)
      ? readInlineMathAt(text, cursor)
      : null
    if (!candidate) {
      cursor += 1
      continue
    }

    appendTextPart(parts, text.slice(textStart, cursor))
    const rendered = renderMath(candidate.value, false)
    if (!rendered) {
      appendTextPart(parts, text.slice(cursor, candidate.end))
    } else {
      parts.push({ kind: 'math', value: candidate.value, html: rendered })
    }
    cursor = candidate.end
    textStart = cursor
  }

  appendTextPart(parts, text.slice(textStart))
  return parts.length > 0 ? parts : [{ kind: 'text', value: text }]
}

function pushDisplayText(parts: ConversationDisplayMathPart[], lines: string[]): void {
  if (lines.length === 0) return
  const value = lines.join('\n')
  if (value) parts.push({ kind: 'text', value })
}

function readSingleLineDisplayMath(line: string): string | null {
  const dollarMatch = line.match(/^\s*\$\$([\s\S]*?)\$\$\s*$/u)
  if (dollarMatch) return dollarMatch[1]?.trim() || null

  const bracketMatch = line.match(/^\s*\\\[([\s\S]*?)\\\]\s*$/u)
  if (bracketMatch) return bracketMatch[1]?.trim() || null

  return null
}

export function splitDisplayConversationMath(text: string): ConversationDisplayMathPart[] {
  if (!text || (!text.includes('$$') && !text.includes('\\['))) {
    return text ? [{ kind: 'text', value: text }] : []
  }

  const lines = text.split('\n')
  const parts: ConversationDisplayMathPart[] = []
  const pendingTextLines: string[] = []

  const flushText = (): void => {
    pushDisplayText(parts, pendingTextLines.splice(0))
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const singleLineValue = readSingleLineDisplayMath(line)
    if (singleLineValue) {
      flushText()
      parts.push({ kind: 'math', value: singleLineValue })
      continue
    }

    const trimmed = line.trim()
    const closingDelimiter = trimmed === '$$' ? '$$' : trimmed === '\\[' ? '\\]' : ''
    if (closingDelimiter) {
      const body: string[] = []
      let cursor = index + 1
      while (cursor < lines.length && (lines[cursor] ?? '').trim() !== closingDelimiter) {
        body.push(lines[cursor] ?? '')
        cursor += 1
      }

      if (cursor < lines.length && body.some((bodyLine) => bodyLine.trim())) {
        flushText()
        parts.push({ kind: 'math', value: body.join('\n').trim() })
        index = cursor
        continue
      }
    }

    pendingTextLines.push(line)
  }

  flushText()
  return parts.length > 0 ? parts : [{ kind: 'text', value: text }]
}
