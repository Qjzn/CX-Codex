// 会话展示层的纯格式化函数。
//
// 从 ThreadConversation.vue 抽出来：这些函数不依赖组件状态，只做字符串拼装，
// 放在这里可以单测、可以复用，也让巨型单文件组件少一块与渲染无关的逻辑。
// 架构重构第一批只搬"纯函数"，不碰状态与模板，保证行为零变化。

export type FileChangeSummaryInput = {
  fileChanges: Array<{ additions: number; removals: number }>
}

export function formatDuration(durationMs: number | null): string {
  if (durationMs === null || !Number.isFinite(durationMs)) return '耗时未知'
  const seconds = Math.max(0, Math.round(durationMs / 1000))
  if (seconds < 60) return `${String(seconds)} 秒`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) {
    return remainingSeconds > 0
      ? `${String(minutes)} 分 ${String(remainingSeconds)} 秒`
      : `${String(minutes)} 分钟`
  }
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0
    ? `${String(hours)} 小时 ${String(remainingMinutes)} 分`
    : `${String(hours)} 小时`
}

export function fileSummaryLabel(turn: FileChangeSummaryInput): string {
  const additions = turn.fileChanges.reduce((total, file) => total + file.additions, 0)
  const removals = turn.fileChanges.reduce((total, file) => total + file.removals, 0)
  return `${String(turn.fileChanges.length)} 个文件 · +${String(additions)} −${String(removals)}`
}

export function fileKindLabel(kind: 'add' | 'delete' | 'update'): string {
  if (kind === 'add') return '新增'
  if (kind === 'delete') return '删除'
  return '修改'
}
