export function copyTextViaCopyEvent(text: string, targetDocument: Document): boolean {
  if (
    typeof targetDocument.execCommand !== 'function'
    || typeof targetDocument.addEventListener !== 'function'
  ) return false

  let clipboardDataWasSet = false
  const onCopy = (event: ClipboardEvent): void => {
    if (!event.clipboardData) return
    event.clipboardData.setData('text/plain', text)
    event.stopImmediatePropagation()
    event.preventDefault()
    clipboardDataWasSet = true
  }

  targetDocument.addEventListener('copy', onCopy)
  try {
    return targetDocument.execCommand('copy') === true && clipboardDataWasSet
  } catch {
    return false
  } finally {
    targetDocument.removeEventListener('copy', onCopy)
  }
}

export async function copyTextToClipboard(text: string): Promise<void> {
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
  if (typeof clipboard?.writeText === 'function') {
    try {
      await clipboard.writeText(text)
      return
    } catch (error) {
      if (typeof document !== 'undefined' && copyTextViaCopyEvent(text, document)) return
      throw error
    }
  }

  if (typeof document === 'undefined' || !copyTextViaCopyEvent(text, document)) {
    throw new Error('当前浏览器无法写入剪贴板')
  }
}
