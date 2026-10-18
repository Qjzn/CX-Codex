// Only imported by the Worker (and tests), never by the main-thread renderer.
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import powershell from 'highlight.js/lib/languages/powershell'
import python from 'highlight.js/lib/languages/python'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import sql from 'highlight.js/lib/languages/sql'
import diff from 'highlight.js/lib/languages/diff'
import yaml from 'highlight.js/lib/languages/yaml'
import { MAX_HIGHLIGHT_CHARACTERS, normalizeCodeLanguage } from './conversationCodeHighlight'

for (const [name, grammar] of Object.entries({ javascript, typescript, json, bash, powershell, python, xml, css, sql, diff, yaml })) {
  hljs.registerLanguage(name, grammar)
}

export function highlightConversationCode(code: string, language: string): string | null {
  const normalized = normalizeCodeLanguage(language)
  if (!normalized || !code || code.length > MAX_HIGHLIGHT_CHARACTERS) return null
  try {
    return hljs.highlight(code, { language: normalized, ignoreIllegals: true }).value
  } catch {
    return null
  }
}
