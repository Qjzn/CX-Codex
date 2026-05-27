import { dirname, extname, join } from 'node:path'
import { open, readFile, readdir, stat } from 'node:fs/promises'

type DirectoryItem = {
  name: string
  path: string
  isDirectory: boolean
  editable: boolean
  mtimeMs: number
}

const TEXT_EDITABLE_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.js', '.ts', '.tsx', '.jsx', '.css', '.scss',
  '.html', '.htm', '.xml', '.yml', '.yaml', '.log', '.csv', '.env', '.py',
  '.sh', '.toml', '.ini', '.conf', '.sql', '.bat', '.cmd', '.ps1',
])

const PREVIEWABLE_EXTENSIONS = new Set([
  '.pdf',
  '.md', '.markdown', '.txt', '.log', '.json', '.csv', '.xml', '.yaml', '.yml',
  '.docx',
  '.avif', '.bmp', '.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp',
])

function languageForPath(pathValue: string): string {
  const extension = extname(pathValue).toLowerCase()
  switch (extension) {
    case '.js': return 'javascript'
    case '.ts': return 'typescript'
    case '.jsx': return 'javascript'
    case '.tsx': return 'typescript'
    case '.py': return 'python'
    case '.sh': return 'sh'
    case '.css':
    case '.scss': return 'css'
    case '.html':
    case '.htm': return 'html'
    case '.json': return 'json'
    case '.md': return 'markdown'
    case '.yaml':
    case '.yml': return 'yaml'
    case '.xml': return 'xml'
    case '.sql': return 'sql'
    case '.toml': return 'ini'
    case '.ini':
    case '.conf': return 'ini'
    default: return 'plaintext'
  }
}

export function normalizeLocalPath(rawPath: string): string {
  const trimmed = rawPath.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('file://')) {
    try {
      return decodeURIComponent(trimmed.replace(/^file:\/\//u, ''))
    } catch {
      return trimmed.replace(/^file:\/\//u, '')
    }
  }
  return trimmed
}

export function decodeBrowsePath(rawPath: string): string {
  if (!rawPath) return ''
  const stripWindowsDriveLeadingSlash = (value: string): string => (
    value.replace(/^\/([A-Za-z]:[\\/])/u, '$1')
  )
  try {
    return stripWindowsDriveLeadingSlash(decodeURIComponent(rawPath))
  } catch {
    return stripWindowsDriveLeadingSlash(rawPath)
  }
}

export function isTextEditablePath(pathValue: string): boolean {
  return TEXT_EDITABLE_EXTENSIONS.has(extname(pathValue).toLowerCase())
}

export function isPreviewableLocalPath(pathValue: string): boolean {
  return PREVIEWABLE_EXTENSIONS.has(extname(pathValue).toLowerCase())
}

function looksLikeTextBuffer(buffer: Buffer): boolean {
  if (buffer.length === 0) return true
  for (const byte of buffer) {
    if (byte === 0) return false
  }
  const decoded = buffer.toString('utf8')
  const replacementCount = (decoded.match(/\uFFFD/gu) ?? []).length
  return replacementCount / decoded.length < 0.05
}

async function probeFileIsText(localPath: string): Promise<boolean> {
  const handle = await open(localPath, 'r')
  try {
    const sample = Buffer.allocUnsafe(4096)
    const { bytesRead } = await handle.read(sample, 0, sample.length, 0)
    return looksLikeTextBuffer(sample.subarray(0, bytesRead))
  } finally {
    await handle.close()
  }
}

export async function isTextEditableFile(localPath: string): Promise<boolean> {
  if (isTextEditablePath(localPath)) return true
  try {
    const fileStat = await stat(localPath)
    if (!fileStat.isFile()) return false
    return await probeFileIsText(localPath)
  } catch {
    return false
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;')
}

function toBrowseHref(pathValue: string): string {
  const normalized = pathValue.replace(/\\/gu, '/')
  const routePath = normalized.startsWith('/') ? normalized : `/${normalized}`
  return `/codex-local-browse${encodeURI(routePath)}`
}

function toEditHref(pathValue: string): string {
  const normalized = pathValue.replace(/\\/gu, '/')
  const routePath = normalized.startsWith('/') ? normalized : `/${normalized}`
  return `/codex-local-edit${encodeURI(routePath)}`
}

function toFileHref(pathValue: string): string {
  return `/codex-local-file?path=${encodeURIComponent(pathValue)}&download=1`
}

export function toLocalFilePreviewHref(pathValue: string): string {
  return `/local-preview.html?path=${encodeURIComponent(pathValue)}`
}

function escapeForInlineScriptString(value: string): string {
  // Prevent breaking out of inline <script> blocks when file content contains HTML/script tokens.
  return JSON.stringify(value)
    .replace(/<\//gu, '<\\/')
    .replace(/<!--/gu, '<\\!--')
    .replace(/\u2028/gu, '\\u2028')
    .replace(/\u2029/gu, '\\u2029')
}

async function getDirectoryItems(localPath: string): Promise<DirectoryItem[]> {
  const entries = await readdir(localPath, { withFileTypes: true })
  const withMeta = await Promise.all(entries.map(async (entry) => {
    const entryPath = join(localPath, entry.name)
    const entryStat = await stat(entryPath)
    const editable = !entry.isDirectory() && await isTextEditableFile(entryPath)
    return {
      name: entry.name,
      path: entryPath,
      isDirectory: entry.isDirectory(),
      editable,
      mtimeMs: entryStat.mtimeMs,
    }
  }))
  return withMeta.sort((a, b) => {
    if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs
    if (a.isDirectory && !b.isDirectory) return -1
    if (!a.isDirectory && b.isDirectory) return 1
    return a.name.localeCompare(b.name)
  })
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${String(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[unitIndex]}`
}

function fileTypeLabel(localPath: string): string {
  const extension = extname(localPath).toLowerCase()
  switch (extension) {
    case '.md':
    case '.markdown': return 'Markdown 文档'
    case '.txt':
    case '.log': return '文本文件'
    case '.doc':
    case '.docx': return 'Word 文档'
    case '.xls':
    case '.xlsx': return 'Excel 表格'
    case '.ppt':
    case '.pptx': return 'PowerPoint 演示文稿'
    case '.pdf': return 'PDF 文档'
    case '.rtf': return 'RTF 文档'
    case '.odt': return 'OpenDocument 文档'
    case '.ods': return 'OpenDocument 表格'
    case '.odp': return 'OpenDocument 演示文稿'
    case '.zip':
    case '.rar':
    case '.7z':
    case '.tar':
    case '.gz':
    case '.bz2':
    case '.xz': return '压缩包'
    default: return extension ? `${extension.slice(1).toUpperCase()} 文件` : '文件'
  }
}

export function createLocalFileActionHtml(
  localPath: string,
  options: { sizeBytes: number; contentType: string },
): string {
  const parentPath = dirname(localPath)
  const fileName = localPath.split(/[\\/]/u).pop() || localPath
  const downloadHref = toFileHref(localPath)
  const sizeLabel = formatFileSize(options.sizeBytes)
  const typeLabel = fileTypeLabel(localPath)

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(fileName)}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f7f4ed;
      color: #211f1b;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 18px;
    }
    main {
      width: min(680px, 100%);
      border: 1px solid #ded5c8;
      border-radius: 18px;
      background: #fffdf8;
      box-shadow: 0 18px 44px rgba(48, 38, 26, 0.10);
      padding: 22px;
    }
    .kicker { margin: 0 0 8px; color: #6f665b; font-size: 14px; }
    h1 { margin: 0; font-size: 24px; line-height: 1.25; word-break: break-word; }
    .meta { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0 18px; color: #70665b; }
    .pill { border: 1px solid #ded5c8; border-radius: 999px; padding: 5px 10px; background: #faf6ed; }
    .path {
      border: 1px solid #e2dacf;
      border-radius: 12px;
      background: #f6f1e9;
      color: #4f463d;
      padding: 12px;
      line-height: 1.5;
      word-break: break-all;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 13px;
    }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
    button, a.action {
      min-height: 44px;
      padding: 0 16px;
      border-radius: 12px;
      border: 1px solid #d7cebf;
      background: #fffaf0;
      color: #28231d;
      font: inherit;
      font-weight: 650;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .primary { border-color: #0f8f83; background: #0f8f83; color: #ffffff; }
    button:disabled { opacity: 0.65; cursor: default; }
    a.action[aria-disabled="true"] { opacity: 0.65; pointer-events: none; cursor: default; }
    .status { min-height: 1.4em; margin: 14px 0 0; color: #0f766e; font-size: 14px; }
    .hint { margin: 12px 0 0; color: #7a7165; font-size: 13px; line-height: 1.5; }
    @media (max-width: 640px) {
      body { align-items: flex-start; padding: 12px; }
      main { padding: 18px; border-radius: 14px; }
      h1 { font-size: 20px; }
      .actions { flex-direction: column; }
      button, a.action { width: 100%; }
    }
  </style>
</head>
<body>
  <main>
    <p class="kicker">本地文件</p>
    <h1>${escapeHtml(fileName)}</h1>
    <div class="meta">
      <span class="pill">${escapeHtml(typeLabel)}</span>
      ${sizeLabel ? `<span class="pill">${escapeHtml(sizeLabel)}</span>` : ''}
    </div>
    <div class="path">${escapeHtml(localPath)}</div>
    <div class="actions">
      <button id="openBtn" class="primary" type="button">打开文件</button>
      <a id="downloadBtn" class="action" href="${escapeHtml(downloadHref)}">下载文件</a>
      <a class="action" href="${escapeHtml(toBrowseHref(parentPath))}">返回目录</a>
      <button id="copyBtn" type="button">复制路径</button>
    </div>
    <p id="status" class="status"></p>
    <p class="hint">Word、Excel、PPT 等文件会交给系统应用打开；如果没有安装对应应用，请先下载后用文件管理器打开。</p>
  </main>
  <script>
    const fileName = ${escapeForInlineScriptString(fileName)};
    const downloadHref = ${escapeForInlineScriptString(downloadHref)};
    const contentType = ${escapeForInlineScriptString(options.contentType)};
    const localPath = ${escapeForInlineScriptString(localPath)};
    const status = document.getElementById('status');
    const openBtn = document.getElementById('openBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    const copyBtn = document.getElementById('copyBtn');
    const ACTION_TIMEOUT_MS = 30000;

    function getMobileShell() {
      return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.MobileShell;
    }

    function isAndroidShellPage() {
      return Boolean(window.Capacitor && typeof window.Capacitor.getPlatform === 'function' && window.Capacitor.getPlatform() === 'android');
    }

    function callMobileShell(method, options) {
      const mobileShell = getMobileShell();
      if (mobileShell && typeof mobileShell[method] === 'function') {
        return mobileShell[method](options || {});
      }
      if (window.Capacitor && typeof window.Capacitor.nativePromise === 'function') {
        return window.Capacitor.nativePromise('MobileShell', method, options || {});
      }
      return null;
    }

    function setBusy(button, busy) {
      if (button) button.disabled = busy;
      if (downloadBtn) downloadBtn.setAttribute('aria-disabled', busy ? 'true' : 'false');
    }

    function withTimeout(promise, message) {
      let timer = 0;
      const timeout = new Promise((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(message)), ACTION_TIMEOUT_MS);
      });
      return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer));
    }

    async function describeAndroidShellVersion() {
      const mobileShell = getMobileShell();
      if (!mobileShell && !(window.Capacitor && typeof window.Capacitor.nativePromise === 'function')) {
        return '';
      }
      try {
        const infoPromise = callMobileShell('getAppInfo', {});
        if (!infoPromise) return '';
        const info = await withTimeout(infoPromise, '客户端版本检测超时。');
        return info && info.versionName ? '当前客户端版本：' + info.versionName + '。' : '';
      } catch {
        return '';
      }
    }

    async function explainMissingNativeDownload() {
      const version = await describeAndroidShellVersion();
      if (isAndroidShellPage()) {
        status.textContent = (version ? version + ' ' : '') + '当前 Android 客户端不支持原生文件下载，请在设置里检查更新并安装 2.2.3 或以上版本；临时可复制路径后用文件管理器打开。';
        return;
      }
      status.textContent = '当前页面不在 CX Codex Android 客户端内，无法调用原生下载；已尝试交给浏览器下载，若无提示请复制路径后在文件管理器中打开。';
    }

    function isMissingNativeMethodError(error) {
      const message = error && error.message ? String(error.message) : String(error || '');
      return /not implemented|not found|not available|not registered|no such method|method.*missing|plugin.*missing/iu.test(message);
    }

    function requestBrowserDownload(message) {
      status.textContent = message;
      const anchor = document.createElement('a');
      anchor.href = downloadHref;
      anchor.download = fileName;
      anchor.rel = 'noopener noreferrer';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => {
        setBusy(openBtn, false);
        if (status.textContent === message) {
          void explainMissingNativeDownload();
        }
      }, 1200);
    }

    async function downloadWithMobileShell(absoluteUrl) {
      const downloadPromise = callMobileShell('downloadFileFromUrl', { url: absoluteUrl, fileName, mimeType: contentType });
      if (!downloadPromise) {
        return false;
      }
      const result = await withTimeout(
        downloadPromise,
        '下载请求超时，请检查网络或稍后重试。'
      );
      if (result && result.status === 'started') {
        status.textContent = '已开始后台下载，完成后会保存到系统下载目录。';
      } else if (result && result.status === 'saved') {
        status.textContent = '已保存到系统下载目录。';
      } else {
        status.textContent = '已加入系统下载，请在通知栏或下载目录查看。';
      }
      return true;
    }

    openBtn.addEventListener('click', async () => {
      const absoluteUrl = new URL(downloadHref, window.location.href).toString();
      setBusy(openBtn, true);
      status.textContent = '正在打开文件...';
      try {
        const openPromise = callMobileShell('openFileFromUrl', { url: absoluteUrl, fileName, mimeType: contentType });
        if (openPromise) {
          await withTimeout(
            openPromise,
            '打开请求超时，已停止等待。'
          );
          status.textContent = '已开始后台打开，下载完成后会自动交给系统应用。';
          setBusy(openBtn, false);
          return;
        }

        if (await downloadWithMobileShell(absoluteUrl)) {
          setBusy(openBtn, false);
          return;
        }

        requestBrowserDownload('当前 App 版本不支持直接打开，正在改为下载文件...');
      } catch (error) {
        if (isMissingNativeMethodError(error)) {
          await explainMissingNativeDownload();
        } else {
          status.textContent = error && error.message ? error.message : '打开失败，请尝试下载文件。';
        }
        setBusy(openBtn, false);
      }
    });

    downloadBtn.addEventListener('click', async (event) => {
      event.preventDefault();
      if (downloadBtn.getAttribute('aria-disabled') === 'true') return;
      const absoluteUrl = new URL(downloadHref, window.location.href).toString();
      setBusy(openBtn, true);
      status.textContent = '正在请求下载...';
      try {
        if (await downloadWithMobileShell(absoluteUrl)) {
          setBusy(openBtn, false);
          return;
        }
        requestBrowserDownload('正在请求系统下载...');
      } catch (error) {
        if (isMissingNativeMethodError(error)) {
          await explainMissingNativeDownload();
        } else {
          status.textContent = error && error.message ? error.message : '下载失败，请稍后重试。';
        }
        setBusy(openBtn, false);
      }
    });

    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(localPath);
        status.textContent = '路径已复制。';
      } catch {
        status.textContent = '复制失败，请手动选择路径。';
      }
    });
  </script>
</body>
</html>`
}

export async function createDirectoryListingHtml(localPath: string): Promise<string> {
  const items = await getDirectoryItems(localPath)
  const parentPath = dirname(localPath)
  const rows = items
    .map((item) => {
      const suffix = item.isDirectory ? '/' : ''
      const editAction = item.editable
        ? ` <a class="icon-btn" aria-label="编辑 ${escapeHtml(item.name)}" href="${escapeHtml(toEditHref(item.path))}" title="编辑">✏️</a>`
        : ''
      return `<li class="file-row"><a class="file-link" href="${escapeHtml(toBrowseHref(item.path))}">${escapeHtml(item.name)}${suffix}</a><span class="row-actions">${editAction}</span></li>`
    })
    .join('\n')

  const parentLink = localPath !== parentPath
    ? `<a href="${escapeHtml(toBrowseHref(parentPath))}">..</a>`
    : ''

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(localPath)} 的目录</title>
  <style>
    body { font-family: ui-monospace, Menlo, Monaco, monospace; margin: 16px; background: #0b1020; color: #dbe6ff; }
    a { color: #8cc2ff; text-decoration: none; }
    a:hover { text-decoration: underline; }
    ul { list-style: none; padding: 0; margin: 12px 0 0; display: flex; flex-direction: column; gap: 8px; }
    .file-row { display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: center; gap: 10px; }
    .file-link { display: block; padding: 10px 12px; border: 1px solid #28405f; border-radius: 10px; background: #0f1b33; overflow-wrap: anywhere; }
    .header-actions { display: flex; align-items: center; gap: 10px; margin-top: 10px; flex-wrap: wrap; }
    .header-parent-link { color: #9ec8ff; font-size: 14px; padding: 8px 10px; border: 1px solid #2a4569; border-radius: 10px; background: #101f3a; }
    .header-parent-link:hover { text-decoration: none; filter: brightness(1.08); }
    .header-open-btn {
      height: 42px;
      padding: 0 14px;
      border: 1px solid #4f8de0;
      border-radius: 10px;
      background: linear-gradient(135deg, #2e6ee6 0%, #3d8cff 100%);
      color: #eef6ff;
      font-weight: 700;
      letter-spacing: 0.01em;
      cursor: pointer;
      box-shadow: 0 6px 18px rgba(33, 90, 199, 0.35);
    }
    .header-open-btn:hover { filter: brightness(1.08); }
    .header-open-btn:disabled { opacity: 0.6; cursor: default; }
    .row-actions { display: inline-flex; align-items: center; gap: 8px; min-width: 42px; justify-content: flex-end; }
    .icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 42px; height: 42px; border: 1px solid #36557a; border-radius: 10px; background: #162643; color: #dbe6ff; text-decoration: none; cursor: pointer; }
    .icon-btn:hover { filter: brightness(1.08); text-decoration: none; }
    .status { margin: 10px 0 0; color: #8cc2ff; min-height: 1.25em; }
    h1 { font-size: 18px; margin: 0; word-break: break-all; }
    @media (max-width: 640px) {
      body { margin: 12px; }
      .file-row { gap: 8px; }
      .file-link { font-size: 15px; padding: 12px; }
      .icon-btn { width: 44px; height: 44px; }
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(localPath)} 的目录</h1>
  <div class="header-actions">
    ${parentLink ? `<a class="header-parent-link" href="${escapeHtml(toBrowseHref(parentPath))}">..</a>` : ''}
    <button class="header-open-btn open-folder-btn" type="button" aria-label="在 Codex 中打开当前文件夹" title="在 Codex 中打开当前文件夹" data-path="${escapeHtml(localPath)}">在 Codex 中打开</button>
  </div>
  <p id="status" class="status"></p>
  <ul>${rows}</ul>
  <script>
    const status = document.getElementById('status');
    document.addEventListener('click', async (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest('.open-folder-btn');
      if (!(button instanceof HTMLButtonElement)) return;

      const path = button.getAttribute('data-path') || '';
      if (!path) return;
      button.disabled = true;
      status.textContent = '正在用 Codex 打开文件夹...';
      try {
        const response = await fetch('/codex-api/project-root', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path,
            createIfMissing: false,
            label: '',
          }),
        });
        if (!response.ok) {
          status.textContent = '打开文件夹失败。';
          button.disabled = false;
          return;
        }
        window.location.assign('/#/');
      } catch {
        status.textContent = '打开文件夹失败。';
        button.disabled = false;
      }
    });
  </script>
</body>
</html>`
}

export async function createTextEditorHtml(localPath: string): Promise<string> {
  const content = await readFile(localPath, 'utf8')
  const parentPath = dirname(localPath)
  const language = languageForPath(localPath)
  const safeContentLiteral = escapeForInlineScriptString(content)
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>编辑 ${escapeHtml(localPath)}</title>
  <style>
    html, body { width: 100%; height: 100%; margin: 0; }
    body { font-family: ui-monospace, Menlo, Monaco, monospace; background: #0b1020; color: #dbe6ff; display: flex; flex-direction: column; overflow: hidden; }
    .toolbar { position: sticky; top: 0; z-index: 10; display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; background: #0b1020; border-bottom: 1px solid #243a5a; }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    button, a { background: #1b2a4a; color: #dbe6ff; border: 1px solid #345; padding: 6px 10px; border-radius: 6px; text-decoration: none; cursor: pointer; }
    button:hover, a:hover { filter: brightness(1.08); }
    #editor { flex: 1 1 auto; min-height: 0; width: 100%; border: none; overflow: hidden; }
    #status { margin-left: 8px; color: #8cc2ff; }
    .ace_editor { background: #07101f !important; color: #dbe6ff !important; width: 100% !important; height: 100% !important; }
    .ace_gutter { background: #07101f !important; color: #6f8eb5 !important; }
    .ace_marker-layer .ace_active-line { background: #10213c !important; }
    .ace_marker-layer .ace_selection { background: rgba(140, 194, 255, 0.3) !important; }
    .meta { opacity: 0.9; font-size: 12px; overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="row">
      <a href="${escapeHtml(toBrowseHref(parentPath))}">返回</a>
      <button id="saveBtn" type="button">保存</button>
      <span id="status"></span>
    </div>
    <div class="meta">${escapeHtml(localPath)} · ${escapeHtml(language)}</div>
  </div>
  <div id="editor"></div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.36.2/ace.js"></script>
  <script>
    const saveBtn = document.getElementById('saveBtn');
    const status = document.getElementById('status');
    const editor = ace.edit('editor');
    editor.setTheme('ace/theme/tomorrow_night');
    editor.session.setMode('ace/mode/${escapeHtml(language)}');
    editor.setValue(${safeContentLiteral}, -1);
    editor.setOptions({
      fontSize: '13px',
      wrap: true,
      showPrintMargin: false,
      useSoftTabs: true,
      tabSize: 2,
      behavioursEnabled: true,
    });
    editor.resize();

    saveBtn.addEventListener('click', async () => {
      status.textContent = '正在保存...';
      const response = await fetch(location.pathname, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: editor.getValue(),
      });
      status.textContent = response.ok ? '已保存' : '保存失败';
    });
  </script>
</body>
</html>`
}
