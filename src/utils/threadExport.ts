import type {
  ConversationActivity,
  ConversationProjection,
  ConversationTurn,
} from '../conversation-transcript/index.js'

export type ThreadMarkdownExportInput = {
  title: string
  threadId: string
  exportedAtIso: string
  projection: ConversationProjection
}

export function buildThreadMarkdown(input: ThreadMarkdownExportInput): string {
  const lines: string[] = []
  lines.push(`# ${escapeMarkdownText(input.title.trim() || '未命名会话')}`)
  lines.push('')
  lines.push(`- 导出时间：${input.exportedAtIso}`)
  lines.push(`- 会话 ID：${input.threadId}`)
  lines.push('')
  lines.push('---')
  lines.push('')

  for (const turn of input.projection.turns) {
    appendTurn(lines, turn)
  }

  return `${lines.join('\n').trimEnd()}\n`
}

function appendTurn(lines: string[], turn: ConversationTurn): void {
  lines.push(`## 第 ${String(turn.index + 1)} 轮`)
  lines.push('')
  if (turn.opener) {
    lines.push('### 用户')
    lines.push('')
    appendText(lines, turn.opener.text)
    if (turn.opener.images.length > 0) appendList(lines, '图片', turn.opener.images)
    const attachments = turn.opener.mentions.map((entry) => entry.path || entry.name).filter(Boolean)
    if (attachments.length > 0) appendList(lines, '附件', attachments)
  }

  if (turn.commentary.length > 0 || turn.activities.length > 0) {
    lines.push('### 执行过程')
    lines.push('')
    for (const commentary of turn.commentary) appendText(lines, commentary.text)
    for (const activity of turn.activities) appendActivity(lines, activity)
  }

  if (turn.fileChanges.length > 0) {
    lines.push('### 文件变更')
    lines.push('')
    for (const file of turn.fileChanges) {
      lines.push(`- ${file.path}（${file.kind}，+${String(file.additions)} / -${String(file.removals)}）`)
    }
    lines.push('')
  }

  const pendingInteractions = turn.interactions.filter((entry) => entry.status === 'pending')
  if (pendingInteractions.length > 0) {
    lines.push('### 待处理交互')
    lines.push('')
    for (const interaction of pendingInteractions) lines.push(`- ${interaction.label}${interaction.detail ? `：${interaction.detail}` : ''}`)
    lines.push('')
  }

  lines.push('### Codex 最终回复')
  lines.push('')
  if (turn.final) appendText(lines, turn.final.text)
  else appendText(lines, finalStatusText(turn))
}

function appendActivity(lines: string[], activity: ConversationActivity): void {
  const duration = activity.durationMs === null ? '' : `，${formatDuration(activity.durationMs)}`
  lines.push(`- ${activity.label}（${activity.status}${duration}）`)
  if (activity.activityType === 'command') {
    lines.push('')
    lines.push('```text')
    if (activity.command) lines.push(`命令：${activity.command}`)
    if (activity.cwd) lines.push(`目录：${activity.cwd}`)
    if (activity.exitCode !== null) lines.push(`退出码：${String(activity.exitCode)}`)
    if (activity.output) lines.push(activity.output)
    lines.push('```')
  } else if (activity.activityType === 'mcp') {
    const target = [activity.server, activity.tool].filter(Boolean).join(' / ')
    if (target) lines.push(`  - 目标：${target}`)
  } else if (activity.activityType === 'web-search' && activity.query) {
    lines.push(`  - 查询：${activity.query}`)
  }
  lines.push('')
}

function finalStatusText(turn: ConversationTurn): string {
  if (turn.finalStatus === 'failed') return `本轮执行失败${turn.error ? `：${turn.error}` : '。'}`
  if (turn.finalStatus === 'interrupted') return '本轮已中断，未产生明确最终回复。'
  if (turn.finalStatus === 'stopped') return '本轮已停止，未产生明确最终回复。'
  if (turn.finalStatus === 'pending') return '本轮仍在执行，尚未产生明确最终回复。'
  return '本轮未产生明确标记为 final_answer 的最终回复。'
}

function appendText(lines: string[], text: string): void {
  const normalized = text.trim()
  if (!normalized) return
  lines.push(normalized)
  lines.push('')
}

function appendList(lines: string[], label: string, values: readonly string[]): void {
  lines.push(`${label}：`)
  for (const value of values) lines.push(`- ${value}`)
  lines.push('')
}

function formatDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1000))
  if (seconds < 60) return `${String(seconds)} 秒`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return remainingSeconds > 0 ? `${String(minutes)} 分 ${String(remainingSeconds)} 秒` : `${String(minutes)} 分钟`
}

export function downloadThreadMarkdown(input: ThreadMarkdownExportInput): void {
  if (typeof document === 'undefined') {
    throw new Error('Thread export requires a browser document')
  }

  const markdown = buildThreadMarkdown(input)
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = buildExportFileName(input.title, input.exportedAtIso)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}

function buildExportFileName(title: string, exportedAtIso: string): string {
  const sanitized = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const stamp = exportedAtIso.replace(/[:.]/g, '-')
  return `${sanitized || 'chat'}-${stamp}.md`
}

function escapeMarkdownText(value: string): string {
  return value.replace(/([\\`*_{}\[\]()#+\-.!])/g, '\\$1')
}
