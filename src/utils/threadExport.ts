import type { UiMessage } from '../types/codex'

export type ThreadMarkdownExportInput = {
  title: string
  threadId: string
  exportedAtIso: string
  messages: readonly UiMessage[]
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

  for (const message of input.messages) {
    const roleLabel = message.role === 'user'
      ? '用户'
      : message.role === 'assistant'
        ? 'Codex'
        : message.role === 'system'
          ? '系统'
          : '消息'
    lines.push(`## ${roleLabel}`)
    lines.push('')

    const normalizedText = message.text.trim()
    if (normalizedText) {
      lines.push(normalizedText)
      lines.push('')
    }

    if (message.commandExecution) {
      lines.push('```text')
      lines.push(`命令：${message.commandExecution.command}`)
      lines.push(`状态：${message.commandExecution.status}`)
      if (message.commandExecution.cwd) {
        lines.push(`目录：${message.commandExecution.cwd}`)
      }
      if (message.commandExecution.exitCode !== null) {
        lines.push(`退出码：${message.commandExecution.exitCode}`)
      }
      lines.push(message.commandExecution.aggregatedOutput || '（无输出）')
      lines.push('```')
      lines.push('')
    }

    if (message.fileAttachments && message.fileAttachments.length > 0) {
      lines.push('附件：')
      for (const attachment of message.fileAttachments) {
        lines.push(`- ${attachment.path}`)
      }
      lines.push('')
    }

    if (message.images && message.images.length > 0) {
      lines.push('图片：')
      for (const imageUrl of message.images) {
        lines.push(`- ${imageUrl}`)
      }
      lines.push('')
    }
  }

  return `${lines.join('\n').trimEnd()}\n`
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
