import { createRequire } from 'node:module'

type QrCodeInstance = {
  addData: (value: string) => void
  getModuleCount: () => number
  isDark: (row: number, column: number) => boolean
  make: () => void
}

type QrCodeConstructor = new (typeNumber: number, errorCorrectLevel: number) => QrCodeInstance

const require = createRequire(import.meta.url)
const QrCode = require('qrcode-terminal/vendor/QRCode') as QrCodeConstructor
const qrErrorCorrectLevel = require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel') as {
  M: number
}
const QR_QUIET_ZONE_MODULES = 4

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;')
}

export function renderPairingQrSvg(value: string): string {
  const normalizedValue = value.trim()
  if (!normalizedValue) return ''

  const qrCode = new QrCode(-1, qrErrorCorrectLevel.M)
  qrCode.addData(normalizedValue)
  qrCode.make()

  const moduleCount = qrCode.getModuleCount()
  const viewBoxSize = moduleCount + QR_QUIET_ZONE_MODULES * 2
  const darkModules: string[] = []
  for (let row = 0; row < moduleCount; row += 1) {
    for (let column = 0; column < moduleCount; column += 1) {
      if (!qrCode.isDark(row, column)) continue
      darkModules.push(
        `M${String(column + QR_QUIET_ZONE_MODULES)} ${String(row + QR_QUIET_ZONE_MODULES)}h1v1h-1z`,
      )
    }
  }

  return [
    `<svg class="pairing-qr" viewBox="0 0 ${String(viewBoxSize)} ${String(viewBoxSize)}"`,
    ' role="img" aria-label="手机访问地址二维码" shape-rendering="crispEdges"',
    ' xmlns="http://www.w3.org/2000/svg">',
    '<title>手机访问地址二维码</title>',
    `<rect width="${String(viewBoxSize)}" height="${String(viewBoxSize)}" fill="#fff"/>`,
    `<path d="${darkModules.join('')}" fill="#111827"/>`,
    '</svg>',
  ].join('')
}

export function renderLocalSetupHtml(options: {
  password: string
  publicUrl: string
}): string {
  const publicUrl = options.publicUrl.trim()
  const qrCode = renderPairingQrSvg(publicUrl)
  const pairingGuide = publicUrl
    ? [
        '<div class="pairing">',
        `<div class="qr-shell">${qrCode}</div>`,
        '<div>',
        '<p class="step-label">手机连接</p>',
        '<h2>扫描二维码打开地址</h2>',
        '<ol>',
        '<li>用手机相机扫描二维码。</li>',
        '<li>在打开的页面输入下方访问密码。</li>',
        '<li>看到聊天界面后即可开始使用。</li>',
        '</ol>',
        '</div>',
        '</div>',
      ].join('')
    : '<p class="muted empty">临时地址尚未生成，可在 CX-Codex 设置的“手机访问”中开启。</p>'
  const publicLink = publicUrl
    ? `<a class="primary" href="${escapeHtml(publicUrl)}" target="_blank" rel="noreferrer">在电脑上测试手机地址</a>`
    : ''

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>CX-Codex 本机配对</title>
<style>
body{margin:0;background:#f4f7f6;color:#17201e;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:620px;margin:0 auto;padding:40px 20px}
.card{border:1px solid #dbe5e2;border-radius:18px;background:#fff;padding:26px;box-shadow:0 16px 42px rgba(20,55,47,.08)}
.kicker,.step-label{margin:0;color:#0f766e;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}
h1{margin:8px 0 10px;font-size:24px}h2{margin:6px 0 10px;font-size:18px}
.muted{color:#62706d;line-height:1.6}.empty{margin:22px 0}
.pairing{display:grid;grid-template-columns:184px minmax(0,1fr);align-items:center;gap:24px;margin:24px 0}
.qr-shell{border:1px solid #dbe5e2;border-radius:16px;background:#fff;padding:10px}
.pairing-qr{display:block;width:100%;height:auto}
ol{margin:0;padding-left:20px;color:#52615e;font-size:14px;line-height:1.8}
dl{display:grid;gap:12px;margin:22px 0}dt{color:#77837f;font-size:12px}dd{margin:4px 0 0}
code{display:block;overflow-wrap:anywhere;border:1px solid #dbe5e2;border-radius:10px;background:#f7faf9;padding:12px;font-size:14px}
.primary{display:inline-flex;border-radius:10px;background:#0f766e;color:#fff;padding:11px 15px;text-decoration:none;font-weight:650}
.warning{margin-top:18px;border-left:3px solid #d97706;padding-left:12px;color:#79511d;font-size:13px;line-height:1.55}
@media(max-width:520px){main{padding:18px 12px}.card{padding:20px}.pairing{grid-template-columns:1fr}.qr-shell{width:min(220px,calc(100% - 22px));margin:0 auto}}
</style>
</head>
<body>
<main><section class="card">
<p class="kicker">仅限本机</p>
<h1>CX-Codex 手机配对</h1>
<p class="muted">二维码只包含手机访问地址，不包含访问密码，也不会发送到第三方二维码服务。</p>
${pairingGuide}
<dl>
<div><dt>手机访问地址</dt><dd><code>${escapeHtml(publicUrl || '尚未生成')}</code></dd></div>
<div><dt>访问密码</dt><dd><code>${escapeHtml(options.password || '当前未启用密码')}</code></dd></div>
</dl>
${publicLink}
<p class="warning">只在你自己的电脑上打开本页，不要截图或转发访问密码。临时地址停止后会失效。</p>
</section></main>
</body>
</html>`
}
