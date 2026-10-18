/** Present local images through the existing authenticated, path-authorized route. */
export function toRenderableImageUrl(raw: string): string {
  const value = raw.trim()
  if (!value || /[\u0000-\u001f\u007f]/u.test(value)) return ''
  if (/^data:image\/[a-z0-9.+-]+[;,]/iu.test(value) || /^blob:https?:\/\//iu.test(value)) return value
  if (/^https?:\/\//iu.test(value)) return value
  if (value.startsWith('/codex-local-image?')) return value
  if (/^file:\/\//iu.test(value)) return `/codex-local-image?path=${encodeURIComponent(`file:${value.slice(5)}`)}`
  if (
    /^[a-z]:[\\/]/iu.test(value)
    || (value.startsWith('/') && !value.startsWith('//'))
    || value.startsWith('\\\\')
  ) return `/codex-local-image?path=${encodeURIComponent(value)}`
  return ''
}
