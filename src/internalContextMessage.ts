const INTERNAL_CONTEXT_PREFIXES = [
  '<codex_internal_context',
  '<environment_context',
  '<developer_context',
  '<system_context',
  '<recommended_plugins',
  '<permissions',
  '<app-context',
  '<collaboration_mode',
  '<skills_instructions',
  '<apps_instructions',
  '<plugins_instructions',
  '<multi_agent_mode',
  '<instructions>',
] as const

export function isInternalContextMessageText(value: string): boolean {
  const text = value.trimStart()
  const lowerText = text.toLowerCase()
  if (INTERNAL_CONTEXT_PREFIXES.some((prefix) => lowerText.startsWith(prefix))) return true
  return (
    /^#\s*AGENTS\.md instructions(?:\s+for\b|\s*$)/iu.test(text)
    || /^These AGENTS\.md instructions replace\b/iu.test(text)
  )
}
