export function compactLatestReplyTail(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= limit ? normalized : normalized.slice(normalized.length - limit)
}
