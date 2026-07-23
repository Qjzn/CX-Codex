import type {
  ComposerPluginSource,
  ComposerTurnOptions,
} from '../types/codex'

export function normalizeComposerTurnOptions(value: unknown): ComposerTurnOptions | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  const plugins = Array.isArray(row.plugins)
    ? row.plugins
      .filter((item): item is { id: string; name: string; path?: string; source?: ComposerPluginSource } => (
        Boolean(item)
        && typeof item === 'object'
        && typeof (item as Record<string, unknown>).id === 'string'
        && typeof (item as Record<string, unknown>).name === 'string'
      ))
      .map((item) => {
        const id = item.id.trim()
        const name = item.name.trim()
        const source: ComposerPluginSource = item.source === 'app'
          ? 'app'
          : item.source === 'plugin'
            ? 'plugin'
            : 'mcp'
        const path = typeof item.path === 'string' && item.path.trim()
          ? item.path.trim()
          : (source === 'app' ? `app://${id}` : `plugin://${id}`)
        return { id, name, path, source }
      })
      .filter((item) => item.id.length > 0 && item.name.length > 0)
    : []
  const rawGoal = row.goal
  const goal = rawGoal && typeof rawGoal === 'object' && !Array.isArray(rawGoal)
    ? {
        enabled: (rawGoal as Record<string, unknown>).enabled === true,
        text: typeof (rawGoal as Record<string, unknown>).text === 'string'
          ? ((rawGoal as Record<string, unknown>).text as string).trim()
          : '',
      }
    : undefined
  const normalizedGoal = goal?.enabled === true ? goal : undefined
  if (plugins.length === 0 && !normalizedGoal) return undefined
  return {
    ...(plugins.length > 0 ? { plugins } : {}),
    ...(normalizedGoal ? { goal: normalizedGoal } : {}),
  }
}

export function cloneComposerTurnOptions(
  options?: ComposerTurnOptions,
): ComposerTurnOptions | undefined {
  return normalizeComposerTurnOptions(options)
}
