export const CODEX_FILE_CITATION_PREFIX = ':codex-file-citation{'

export type CodexFileCitation = {
  raw: string
  start: number
  end: number
  path: string
  purpose: string
  attributes: Record<string, string>
}

export type CodexFileCitationPart =
  | { kind: 'text'; value: string }
  | { kind: 'citation'; citation: CodexFileCitation }

type AttributeValue = {
  value: string
  end: number
}

function readQuotedAttributeValue(text: string, start: number, quote: string): AttributeValue | null {
  let cursor = start + 1
  let value = ''

  while (cursor < text.length) {
    const character = text[cursor]
    if (character === quote) {
      return { value, end: cursor + 1 }
    }
    if (character === '\\' && cursor + 1 < text.length) {
      const escaped = text[cursor + 1]
      if (escaped === quote || escaped === '\\') {
        value += escaped
        cursor += 2
        continue
      }
    }
    value += character
    cursor += 1
  }

  return null
}

function readAttributeValue(text: string, start: number): AttributeValue | null {
  const firstCharacter = text[start]
  if (firstCharacter === '"' || firstCharacter === "'") {
    return readQuotedAttributeValue(text, start, firstCharacter)
  }

  let cursor = start
  while (cursor < text.length && !/[\s,}]/u.test(text[cursor] ?? '')) {
    cursor += 1
  }
  if (cursor === start) return null
  return { value: text.slice(start, cursor), end: cursor }
}

function decodeCitationPath(pathValue: string): string {
  try {
    return decodeURI(pathValue)
  } catch {
    return pathValue
  }
}

export function readCodexFileCitationAt(text: string, start: number): CodexFileCitation | null {
  if (start < 0 || !text.startsWith(CODEX_FILE_CITATION_PREFIX, start)) return null

  const attributes: Record<string, string> = {}
  let cursor = start + CODEX_FILE_CITATION_PREFIX.length

  while (cursor < text.length) {
    while (cursor < text.length && /[\s,]/u.test(text[cursor] ?? '')) cursor += 1

    if (text[cursor] === '}') {
      const end = cursor + 1
      return {
        raw: text.slice(start, end),
        start,
        end,
        path: decodeCitationPath((attributes.path ?? '').trim()),
        purpose: (attributes.purpose ?? '').trim(),
        attributes,
      }
    }

    const keyMatch = text.slice(cursor).match(/^([A-Za-z_][A-Za-z0-9_-]*)/u)
    if (!keyMatch) return null
    const key = keyMatch[1]
    cursor += key.length

    while (cursor < text.length && /\s/u.test(text[cursor] ?? '')) cursor += 1
    if (text[cursor] !== '=') return null
    cursor += 1
    while (cursor < text.length && /\s/u.test(text[cursor] ?? '')) cursor += 1

    const parsedValue = readAttributeValue(text, cursor)
    if (!parsedValue) return null
    attributes[key] = parsedValue.value
    cursor = parsedValue.end
  }

  return null
}

export function findCodexFileCitation(text: string, fromIndex = 0): CodexFileCitation | null {
  let searchFrom = Math.max(0, fromIndex)

  while (searchFrom < text.length) {
    const start = text.indexOf(CODEX_FILE_CITATION_PREFIX, searchFrom)
    if (start < 0) return null
    const citation = readCodexFileCitationAt(text, start)
    if (citation) return citation
    searchFrom = start + CODEX_FILE_CITATION_PREFIX.length
  }

  return null
}

export function splitCodexFileCitations(text: string): CodexFileCitationPart[] {
  const parts: CodexFileCitationPart[] = []
  let cursor = 0

  while (cursor < text.length) {
    const citation = findCodexFileCitation(text, cursor)
    if (!citation) break
    if (citation.start > cursor) {
      parts.push({ kind: 'text', value: text.slice(cursor, citation.start) })
    }
    parts.push({ kind: 'citation', citation })
    cursor = citation.end
  }

  if (cursor < text.length) {
    parts.push({ kind: 'text', value: text.slice(cursor) })
  }

  return parts
}
