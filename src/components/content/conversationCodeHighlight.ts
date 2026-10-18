/** Explicit languages only: prose and unknown fences must never be guessed. */
export const MAX_HIGHLIGHT_CHARACTERS = 20_000

const languages: Record<string, string> = {
  javascript: 'javascript', js: 'javascript', jsx: 'javascript',
  typescript: 'typescript', ts: 'typescript', tsx: 'typescript',
  json: 'json', bash: 'bash', sh: 'bash', shell: 'bash',
  powershell: 'powershell', ps1: 'powershell', ps: 'powershell', pwsh: 'powershell',
  python: 'python', py: 'python', xml: 'xml', html: 'xml', vue: 'xml',
  css: 'css', sql: 'sql', diff: 'diff', patch: 'diff', yaml: 'yaml', yml: 'yaml',
}

export function normalizeCodeLanguage(value: string): string | null {
  const key = value.trim().toLowerCase()
  return Object.hasOwn(languages, key) ? languages[key]! : null
}
