import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import { renderAsync } from 'docx-preview'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'

declare global {
  interface Window {
    Capacitor?: {
      getPlatform?: () => string
      Plugins?: Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>
      nativePromise?: (pluginName: string, methodName: string, options?: Record<string, unknown>) => Promise<unknown>
    }
  }
}

type PreviewKind = 'pdf' | 'markdown' | 'text' | 'docx' | 'image' | 'unsupported'

type MobileShellResult = {
  status?: string
}

const NATIVE_ACTION_TIMEOUT_MS = 12_000

const root = document.getElementById('local-preview-root')
if (!root) {
  throw new Error('Missing local preview root element.')
}
const previewRoot = root

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
})

const state = {
  localPath: new URLSearchParams(window.location.search).get('path')?.trim() ?? '',
  zoom: 1,
  pdfData: null as Uint8Array | null,
  renderGeneration: 0,
  mimeType: '',
  fileName: '',
  nativeFileActionsUnavailable: false,
}

function basename(pathValue: string): string {
  const parts = pathValue.split(/[\\/]/u).filter(Boolean)
  return parts[parts.length - 1] ?? pathValue
}

function dirname(pathValue: string): string {
  const normalized = pathValue.replace(/\\/gu, '/')
  const index = normalized.lastIndexOf('/')
  if (index <= 0) return pathValue
  return normalized.slice(0, index)
}

function extensionOf(pathValue: string): string {
  const name = basename(pathValue)
  const index = name.lastIndexOf('.')
  return index >= 0 ? name.slice(index).toLowerCase() : ''
}

function getPreviewKind(pathValue: string): PreviewKind {
  switch (extensionOf(pathValue)) {
    case '.pdf':
      return 'pdf'
    case '.md':
    case '.markdown':
      return 'markdown'
    case '.txt':
    case '.log':
    case '.json':
    case '.csv':
    case '.xml':
    case '.yaml':
    case '.yml':
      return 'text'
    case '.docx':
      return 'docx'
    case '.avif':
    case '.bmp':
    case '.gif':
    case '.jpeg':
    case '.jpg':
    case '.png':
    case '.svg':
    case '.webp':
      return 'image'
    default:
      return 'unsupported'
  }
}

function fileTypeLabel(kind: PreviewKind, pathValue: string): string {
  if (kind === 'pdf') return 'PDF 文档'
  if (kind === 'markdown') return 'Markdown 文档'
  if (kind === 'docx') return 'Word 文档'
  if (kind === 'image') return '图片'
  if (kind === 'text') return '文本文件'
  const ext = extensionOf(pathValue)
  return ext ? `${ext.slice(1).toUpperCase()} 文件` : '文件'
}

function fileUrl(mode: 'inline' | 'download' = 'inline'): string {
  const params = new URLSearchParams({ path: state.localPath })
  if (mode === 'download') params.set('download', '1')
  else params.set('inline', '1')
  return `/codex-local-file?${params.toString()}`
}

function absoluteFileUrl(mode: 'inline' | 'download' = 'inline'): string {
  return new URL(fileUrl(mode), window.location.href).toString()
}

function browseHref(pathValue: string): string {
  const normalized = pathValue.replace(/\\/gu, '/')
  const routePath = normalized.startsWith('/') ? normalized : `/${normalized}`
  return `/codex-local-browse${encodeURI(routePath)}`
}

function setStatus(message: string, tone: 'neutral' | 'error' = 'neutral'): void {
  const status = document.querySelector<HTMLElement>('[data-preview-status]')
  if (!status) return
  status.textContent = message
  status.dataset.tone = tone
}

function setFileActionsDisabled(disabled: boolean): void {
  document.querySelectorAll<HTMLButtonElement>('[data-action="open"], [data-action="download"]').forEach((button) => {
    button.disabled = disabled
  })
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: number | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) {
      window.clearTimeout(timer)
    }
  })
}

function isMissingNativeMethodError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /not implemented|unavailable|undefined|missing|no such method|plugin|不可用/iu.test(message)
}

function isNativeTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /timeout|超时|没有返回确认/iu.test(message)
}

function getMobileShellMethod(method: string): ((options: Record<string, unknown>) => Promise<unknown>) | null {
  const mobileShell = window.Capacitor?.Plugins?.MobileShell
  const directMethod = mobileShell?.[method]
  if (typeof directMethod === 'function') {
    return (options) => directMethod.call(mobileShell, options)
  }
  if (typeof window.Capacitor?.nativePromise === 'function') {
    return (options) => window.Capacitor?.nativePromise?.('MobileShell', method, options) ?? Promise.reject(new Error('MobileShell 不可用。'))
  }
  return null
}

function isAndroidShell(): boolean {
  return window.Capacitor?.getPlatform?.() === 'android'
}

function requestBrowserDownload(): void {
  const anchor = document.createElement('a')
  anchor.href = fileUrl('download')
  anchor.download = state.fileName
  anchor.rel = 'noopener noreferrer'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

function returnToApp(): void {
  try {
    if (document.referrer) {
      const referrer = new URL(document.referrer)
      if (referrer.origin === window.location.origin && !referrer.pathname.endsWith('/local-preview.html')) {
        window.history.back()
        return
      }
    }
  } catch {
    // Ignore malformed referrer and use the app home fallback.
  }
  window.location.assign('/#/')
}

async function copyTextToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(value)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  textarea.setSelectionRange(0, value.length)
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) {
    throw new Error('当前浏览器不允许复制。')
  }
}

async function openWithSystem(): Promise<void> {
  setFileActionsDisabled(true)
  try {
    const openFile = state.nativeFileActionsUnavailable ? null : getMobileShellMethod('openFileFromUrl')
    if (openFile) {
      setStatus('正在交给系统应用打开...')
      const result = await withTimeout(
        openFile({
          url: absoluteFileUrl('download'),
          fileName: state.fileName,
          mimeType: state.mimeType,
        }) as Promise<MobileShellResult>,
        NATIVE_ACTION_TIMEOUT_MS,
        '原生打开没有返回确认。'
      )
      setStatus(result.status === 'started' ? '已开始后台打开，完成后会自动唤起系统应用。' : '已交给系统应用打开。')
      return
    }
    const opened = window.open(fileUrl('inline'), '_blank', 'noopener,noreferrer')
    if (!opened) {
      requestBrowserDownload()
      setStatus('浏览器阻止了新窗口，已改为下载文件。')
    } else {
      setStatus('已在新窗口打开文件。')
    }
  } catch (error) {
    if (isAndroidShell() && (isMissingNativeMethodError(error) || isNativeTimeoutError(error))) {
      state.nativeFileActionsUnavailable = true
      requestBrowserDownload()
      setStatus('系统打开未确认，已切换为兼容模式；如果没有下载提示，请再次点击下载或复制路径。', 'error')
      return
    }
    throw error
  } finally {
    setFileActionsDisabled(false)
  }
}

async function downloadWithSystem(): Promise<void> {
  setFileActionsDisabled(true)
  try {
    const downloadFile = state.nativeFileActionsUnavailable ? null : getMobileShellMethod('downloadFileFromUrl')
    if (downloadFile) {
      setStatus('正在请求系统下载...')
      const result = await withTimeout(
        downloadFile({
          url: absoluteFileUrl('download'),
          fileName: state.fileName,
          mimeType: state.mimeType,
        }) as Promise<MobileShellResult>,
        NATIVE_ACTION_TIMEOUT_MS,
        '原生下载没有返回确认。'
      )
      setStatus(result.status === 'started' ? '已开始后台下载，完成后会保存到系统下载目录。' : '已保存到系统下载目录。')
      return
    }
    requestBrowserDownload()
    if (isAndroidShell()) {
      setStatus(state.nativeFileActionsUnavailable
        ? '已请求兼容下载；如果没有系统提示，请复制路径后用文件管理器打开。'
        : '已请求下载；如果没有系统提示，请更新 Android 客户端。')
    } else {
      setStatus('已请求浏览器下载。')
    }
  } catch (error) {
    if (isAndroidShell() && (isMissingNativeMethodError(error) || isNativeTimeoutError(error))) {
      state.nativeFileActionsUnavailable = true
      requestBrowserDownload()
      setStatus('原生下载未确认，已切换为兼容模式；如果没有下载提示，请再次点击下载或复制路径。', 'error')
      return
    }
    throw error
  } finally {
    setFileActionsDisabled(false)
  }
}

function renderShell(kind: PreviewKind): void {
  state.fileName = basename(state.localPath)
  const parentPath = dirname(state.localPath)
  previewRoot.innerHTML = `
    <main class="preview-page">
      <header class="preview-toolbar">
        <div class="preview-title-block">
          <p class="preview-kicker">本地文件预览</p>
          <h1>${escapeHtml(state.fileName)}</h1>
          <div class="preview-meta">
            <span>${escapeHtml(fileTypeLabel(kind, state.localPath))}</span>
            <span data-preview-size>读取中</span>
          </div>
        </div>
        <div class="preview-actions">
          <button type="button" data-action="back">返回会话</button>
          <button type="button" data-action="zoom-out" ${kind === 'pdf' ? '' : 'hidden'}>缩小</button>
          <button type="button" data-action="zoom-in" ${kind === 'pdf' ? '' : 'hidden'}>放大</button>
          <button type="button" data-action="open">打开</button>
          <button type="button" data-action="download">下载</button>
          <a href="${escapeHtml(browseHref(parentPath))}">目录</a>
          <button type="button" data-action="copy">复制路径</button>
        </div>
      </header>
      <p class="preview-path">${escapeHtml(state.localPath)}</p>
      <p class="preview-status" data-preview-status>正在读取文件...</p>
      <section class="preview-content" data-preview-content></section>
    </main>
  `

  previewRoot.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action
    if (!action) return
    if (action === 'open') {
      void openWithSystem().catch((error: unknown) => setStatus(errorMessage(error, '打开失败，请尝试下载。'), 'error'))
    } else if (action === 'download') {
      void downloadWithSystem().catch((error: unknown) => setStatus(errorMessage(error, '下载失败，请稍后重试。'), 'error'))
    } else if (action === 'copy') {
      void copyTextToClipboard(state.localPath)
        .then(() => setStatus('路径已复制。'))
        .catch(() => setStatus('复制失败，请手动选择路径。', 'error'))
    } else if (action === 'back') {
      returnToApp()
    } else if (action === 'zoom-in') {
      state.zoom = Math.min(2.5, state.zoom + 0.15)
      void rerenderPdf()
    } else if (action === 'zoom-out') {
      state.zoom = Math.max(0.65, state.zoom - 0.15)
      void rerenderPdf()
    }
  })
}

window.addEventListener('pageshow', () => {
  const status = document.querySelector<HTMLElement>('[data-preview-status]')
  if (/^正在/u.test(status?.textContent ?? '')) {
    setStatus('已回到预览页，可重新打开或下载文件。')
    setFileActionsDisabled(false)
  }
})

async function fetchBlob(): Promise<Blob> {
  const response = await fetch(fileUrl('inline'), { cache: 'no-store' })
  if (!response.ok) throw new Error('文件读取失败。')
  state.mimeType = response.headers.get('content-type') ?? ''
  const blob = await response.blob()
  const size = document.querySelector<HTMLElement>('[data-preview-size]')
  if (size) size.textContent = formatFileSize(blob.size)
  return blob
}

async function renderMarkdownOrText(kind: PreviewKind): Promise<void> {
  const blob = await fetchBlob()
  const content = await blob.text()
  const container = getContentContainer()
  if (kind === 'markdown') {
    container.className = 'preview-content markdown-body'
    container.innerHTML = DOMPurify.sanitize(markdown.render(content), { USE_PROFILES: { html: true } })
  } else {
    container.className = 'preview-content text-body'
    const pre = document.createElement('pre')
    pre.textContent = extensionOf(state.localPath) === '.json' ? formatJson(content) : content
    container.replaceChildren(pre)
  }
  setStatus('预览已就绪。')
}

async function renderDocx(): Promise<void> {
  const blob = await fetchBlob()
  const container = getContentContainer()
  container.className = 'preview-content docx-body'
  container.replaceChildren()
  try {
    await renderAsync(await blob.arrayBuffer(), container, undefined, {
      className: 'docx',
      inWrapper: true,
      ignoreWidth: false,
      ignoreHeight: false,
      ignoreFonts: false,
      breakPages: true,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
      useBase64URL: false,
    })
    setStatus('Word 预览已就绪；复杂排版如有偏差，请使用系统应用打开。')
  } catch (error) {
    renderUnsupported(`Word 预览失败：${errorMessage(error, '无法解析该文档。')}`)
  }
}

async function renderImage(): Promise<void> {
  const blob = await fetchBlob()
  const url = URL.createObjectURL(blob)
  const container = getContentContainer()
  container.className = 'preview-content image-body'
  const image = document.createElement('img')
  image.src = url
  image.alt = state.fileName
  image.onload = () => URL.revokeObjectURL(url)
  container.replaceChildren(image)
  setStatus('预览已就绪。')
}

async function renderPdf(): Promise<void> {
  const blob = await fetchBlob()
  state.pdfData = new Uint8Array(await blob.arrayBuffer())
  await rerenderPdf()
}

async function rerenderPdf(): Promise<void> {
  if (!state.pdfData) return
  const generation = ++state.renderGeneration
  const container = getContentContainer()
  container.className = 'preview-content pdf-body'
  container.replaceChildren()
  setStatus(`正在渲染 PDF，缩放 ${Math.round(state.zoom * 100)}%...`)

  const doc = await pdfjsLib.getDocument({ data: state.pdfData.slice() }).promise
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    if (generation !== state.renderGeneration) return
    const page = await doc.getPage(pageNumber)
    const baseViewport = page.getViewport({ scale: 1 })
    const availableWidth = Math.max(280, Math.min(container.clientWidth - 16, 1100))
    const fitScale = availableWidth / baseViewport.width
    const viewport = page.getViewport({ scale: fitScale * state.zoom })
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const pageShell = document.createElement('article')
    pageShell.className = 'pdf-page'
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width * dpr)
    canvas.height = Math.floor(viewport.height * dpr)
    canvas.style.width = `${viewport.width}px`
    canvas.style.height = `${viewport.height}px`
    const label = document.createElement('p')
    label.textContent = `${pageNumber} / ${doc.numPages}`
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前浏览器不支持 Canvas。')
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    pageShell.append(canvas, label)
    container.append(pageShell)
    await page.render({ canvas, canvasContext: context, viewport }).promise
  }
  if (generation === state.renderGeneration) {
    setStatus(`PDF 预览已就绪，共 ${doc.numPages} 页。`)
  }
}

function renderUnsupported(message = '当前文件暂不支持内嵌预览，请使用系统应用打开或下载。'): void {
  const container = getContentContainer()
  container.className = 'preview-content unsupported-body'
  container.innerHTML = `
    <div class="unsupported-card">
      <h2>无法预览</h2>
      <p>${escapeHtml(message)}</p>
      <p>文件内容不会上传到第三方服务。你可以继续使用打开或下载。</p>
    </div>
  `
  setStatus('已切换到操作模式。')
}

function getContentContainer(): HTMLElement {
  const container = document.querySelector<HTMLElement>('[data-preview-content]')
  if (!container) throw new Error('预览容器不存在。')
  return container
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;')
}

function formatJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[unitIndex]}`
}

function injectStyles(): void {
  const style = document.createElement('style')
  style.textContent = `
    :root { color-scheme: light; background: #f7f4ed; color: #1f2937; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    html, body, #local-preview-root { min-height: 100%; margin: 0; }
    body { background: #f7f4ed; }
    .preview-page { min-height: 100vh; display: flex; flex-direction: column; gap: 12px; padding: 14px; }
    .preview-toolbar { position: sticky; top: 0; z-index: 10; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; border: 1px solid #dfd6ca; border-radius: 16px; background: rgba(255, 253, 248, 0.96); box-shadow: 0 12px 32px rgba(49, 39, 27, 0.08); backdrop-filter: blur(16px); padding: 12px; }
    .preview-kicker { margin: 0 0 4px; color: #766b5e; font-size: 13px; }
    h1 { margin: 0; color: #111827; font-size: 20px; line-height: 1.25; overflow-wrap: anywhere; }
    .preview-meta { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; color: #766b5e; font-size: 13px; }
    .preview-meta span { border: 1px solid #e2d8ca; background: #faf6ee; border-radius: 999px; padding: 4px 9px; }
    .preview-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    button, a { min-height: 38px; border: 1px solid #d7cdbf; border-radius: 11px; background: #fffaf1; color: #25211b; font: inherit; font-weight: 650; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; padding: 0 12px; cursor: pointer; }
    button:hover, a:hover { filter: brightness(0.98); }
    button:disabled { cursor: wait; opacity: 0.62; }
    .preview-path { margin: 0; border: 1px solid #e2dacf; border-radius: 12px; background: #fffdf8; color: #665d51; padding: 10px 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; overflow-wrap: anywhere; }
    .preview-status { margin: 0; min-height: 22px; color: #0f766e; font-size: 14px; }
    .preview-status[data-tone="error"] { color: #b42318; }
    .preview-content { flex: 1 1 auto; min-height: 0; border: 1px solid #e4dbcf; border-radius: 16px; background: #fffdf8; padding: 16px; overflow: auto; }
    .markdown-body { line-height: 1.72; font-size: 16px; }
    .markdown-body h1, .markdown-body h2, .markdown-body h3 { margin: 1.1em 0 0.55em; }
    .markdown-body h1 { font-size: 1.7rem; }
    .markdown-body h2 { font-size: 1.35rem; }
    .markdown-body pre, .text-body pre { overflow: auto; border: 1px solid #e5dccf; border-radius: 12px; background: #f7f1e8; padding: 12px; line-height: 1.55; }
    .markdown-body code { border: 1px solid #e5dccf; border-radius: 7px; background: #f7f1e8; padding: 1px 5px; }
    .markdown-body pre code { border: 0; padding: 0; background: transparent; }
    .text-body pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
    .docx-body { background: #ede8df; padding: 18px 8px; }
    .docx-body .docx-wrapper { background: transparent; padding: 0; }
    .docx-body .docx { box-shadow: 0 10px 30px rgba(45, 37, 28, 0.12); margin: 0 auto 14px; max-width: 100%; }
    .pdf-body { display: flex; flex-direction: column; align-items: center; gap: 14px; background: #ede8df; }
    .pdf-page { width: min-content; max-width: 100%; margin: 0; }
    .pdf-page canvas { display: block; max-width: 100%; height: auto !important; border-radius: 4px; background: #fff; box-shadow: 0 8px 24px rgba(45, 37, 28, 0.16); }
    .pdf-page p { margin: 6px 0 0; text-align: center; color: #6b6258; font-size: 12px; }
    .image-body { display: flex; justify-content: center; align-items: flex-start; background: #ede8df; }
    .image-body img { max-width: 100%; height: auto; border-radius: 10px; box-shadow: 0 8px 24px rgba(45, 37, 28, 0.16); }
    .unsupported-card { max-width: 560px; margin: 10vh auto; border: 1px solid #e0d7ca; border-radius: 16px; background: #fffaf2; padding: 18px; }
    .unsupported-card h2 { margin: 0 0 8px; }
    .unsupported-card p { margin: 8px 0 0; color: #62594f; line-height: 1.6; }
    @media (max-width: 720px) {
      .preview-page { padding: 10px; gap: 10px; }
      .preview-toolbar { position: static; grid-template-columns: 1fr; border-radius: 14px; }
      .preview-actions { justify-content: stretch; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
      button, a { min-width: 0; padding: 0 8px; }
      h1 { font-size: 18px; }
      .preview-content { padding: 10px; border-radius: 14px; }
      .markdown-body { font-size: 15px; }
      .docx-body { padding: 10px 0; }
    }
  `
  document.head.append(style)
}

async function main(): Promise<void> {
  injectStyles()
  if (!state.localPath) {
    renderShell('unsupported')
    renderUnsupported('缺少文件路径。')
    return
  }
  const kind = getPreviewKind(state.localPath)
  renderShell(kind)
  try {
    if (kind === 'pdf') await renderPdf()
    else if (kind === 'markdown' || kind === 'text') await renderMarkdownOrText(kind)
    else if (kind === 'docx') await renderDocx()
    else if (kind === 'image') await renderImage()
    else renderUnsupported()
  } catch (error) {
    renderUnsupported(errorMessage(error, '文件预览失败。'))
  }
}

void main()
