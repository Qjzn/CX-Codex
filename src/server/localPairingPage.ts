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

function renderAddressRow(label: string, value: string, copyable = true): string {
  const escapedValue = escapeHtml(value)
  return [
    '<div class="address-row">',
    `<div><dt>${escapeHtml(label)}</dt><dd><code>${escapedValue}</code></dd></div>`,
    copyable && value ? `<button class="ghost compact" type="button" data-copy="${escapedValue}">复制</button>` : '',
    '</div>',
  ].join('')
}

export function renderLocalSetupHtml(options: {
  password: string
  publicUrl: string
  localUrl?: string
  lanUrls?: string[]
  managementToken?: string
  canChangePassword?: boolean
}): string {
  const publicUrl = options.publicUrl.trim()
  const localUrl = options.localUrl?.trim() ?? ''
  const lanUrls = (options.lanUrls ?? []).map((url) => url.trim()).filter(Boolean)
  const qrCode = renderPairingQrSvg(publicUrl)
  const pairingGuide = publicUrl
    ? [
        '<div class="pairing">',
        `<div class="qr-shell">${qrCode}</div>`,
        '<div>',
        '<p class="step-label">手机连接</p>',
        '<h2>扫描二维码打开外网地址</h2>',
        '<ol>',
        '<li>用手机相机扫描二维码。</li>',
        '<li>在打开的页面输入下方访问密码。</li>',
        '<li>看到聊天界面后即可开始使用。</li>',
        '</ol>',
        '</div>',
        '</div>',
      ].join('')
    : '<div class="empty"><strong>外网地址正在准备或尚未开启</strong><span>保持服务运行，稍后刷新；也可在聊天设置的“手机访问”中重新开启。</span></div>'
  const publicLink = publicUrl
    ? `<a class="primary" href="${escapeHtml(publicUrl)}" target="_blank" rel="noreferrer">测试外网地址</a>`
    : ''
  const lanRows = lanUrls.length > 0
    ? lanUrls.map((url, index) => renderAddressRow(index === 0 ? '局域网地址' : '备用局域网地址', url)).join('')
    : renderAddressRow('局域网地址', '未开启（当前为本机安全模式）', false)
  const passwordText = options.password || '当前未启用密码'
  const passwordControls = options.password
    ? [
        '<div class="password-line">',
        `<input id="current-password" type="password" readonly value="${escapeHtml(passwordText)}" aria-label="当前访问密码">`,
        '<button class="ghost compact" id="reveal-password" type="button">显示</button>',
        `<button class="ghost compact" type="button" data-copy="${escapeHtml(passwordText)}">复制</button>`,
        '</div>',
      ].join('')
    : `<code>${escapeHtml(passwordText)}</code>`
  const passwordForm = options.canChangePassword && options.password
    ? [
        '<section class="sub-card">',
        '<p class="step-label">安全设置</p>',
        '<h2>修改访问密码</h2>',
        '<p class="muted small">只能在本机修改。保存后，其他设备需要使用新密码重新登录。</p>',
        '<label for="new-password">新密码（8–128 个字符）</label>',
        '<input id="new-password" type="password" minlength="8" maxlength="128" autocomplete="new-password" placeholder="输入一个容易保存、难以猜测的密码">',
        '<div class="actions">',
        '<button class="primary" id="save-password" type="button">保存新密码</button>',
        '<button class="ghost" id="generate-password" type="button">生成安全密码</button>',
        '</div>',
        '<p class="status" id="password-status" role="status" aria-live="polite"></p>',
        '</section>',
      ].join('')
    : ''
  const managementToken = JSON.stringify(options.managementToken ?? '')

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>CX-Codex 管理中心</title>
<style>
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:#f4f7f6;color:#17201e;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
button,input{font:inherit}
main{max-width:720px;margin:0 auto;padding:32px 18px 48px}
.card,.sub-card{border:1px solid #dbe5e2;border-radius:18px;background:#fff;box-shadow:0 16px 42px rgba(20,55,47,.07)}
.card{padding:26px}.sub-card{margin-top:20px;padding:20px;box-shadow:none}
.kicker,.step-label{margin:0;color:#0f766e;font-size:12px;font-weight:750;letter-spacing:.1em;text-transform:uppercase}
h1{margin:8px 0 8px;font-size:26px;letter-spacing:-.02em}h2{margin:6px 0 10px;font-size:18px}
.muted{color:#62706d;line-height:1.6}.small{font-size:13px}
.pairing{display:grid;grid-template-columns:184px minmax(0,1fr);align-items:center;gap:24px;margin:24px 0}
.qr-shell{border:1px solid #dbe5e2;border-radius:16px;background:#fff;padding:10px}.pairing-qr{display:block;width:100%;height:auto}
ol{margin:0;padding-left:20px;color:#52615e;font-size:14px;line-height:1.8}
.empty{display:grid;gap:6px;margin:22px 0;padding:16px;border-radius:12px;background:#f7faf9;color:#52615e}.empty strong{color:#263632}.empty span{font-size:13px;line-height:1.55}
dl{display:grid;gap:10px;margin:20px 0}.address-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:10px}
dt,label{display:block;color:#77837f;font-size:12px;margin-bottom:5px}dd{margin:0}
code,input{width:100%;display:block;overflow-wrap:anywhere;border:1px solid #dbe5e2;border-radius:10px;background:#f7faf9;color:#17201e;padding:11px 12px;font-size:14px}
input:focus{outline:2px solid rgba(15,118,110,.2);border-color:#0f766e}
.password-line{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}
.primary,.ghost{display:inline-flex;align-items:center;justify-content:center;min-height:42px;border-radius:10px;padding:0 15px;text-decoration:none;font-weight:680;cursor:pointer}
.primary{border:1px solid #0f766e;background:#0f766e;color:#fff}.primary:hover{background:#0b625c}
.ghost{border:1px solid #cddad6;background:#fff;color:#27443e}.ghost:hover{background:#f3f8f6}
.compact{min-height:40px;padding:0 12px;font-size:13px}
.status{min-height:20px;margin:10px 0 0;color:#0f766e;font-size:13px;line-height:1.5}.status.error{color:#b42318}
.warning{margin:18px 0 0;border-left:3px solid #d97706;padding-left:12px;color:#79511d;font-size:13px;line-height:1.55}
button:disabled{cursor:wait;opacity:.6}
@media(max-width:560px){main{padding:14px 10px 32px}.card{padding:20px}.pairing{grid-template-columns:1fr}.qr-shell{width:min(220px,calc(100% - 22px));margin:0 auto}.address-row{grid-template-columns:1fr}.password-line{grid-template-columns:minmax(0,1fr) auto}.password-line [data-copy]{grid-column:1/-1}.actions>*{width:100%}}
</style>
</head>
<body>
<main><section class="card">
<p class="kicker">仅限本机</p>
<h1>CX-Codex 管理中心</h1>
<p class="muted">这里集中保存连接入口和访问密码。二维码只包含外网地址，不包含密码。</p>
${pairingGuide}
<dl>
${renderAddressRow('本机访问地址', localUrl || 'http://127.0.0.1:7420', Boolean(localUrl))}
${lanRows}
${renderAddressRow('外网访问地址', publicUrl || '尚未生成', Boolean(publicUrl))}
<div><dt>当前访问密码</dt><dd>${passwordControls}</dd></div>
</dl>
<div class="actions">${publicLink}<button class="ghost" type="button" onclick="window.location.reload()">刷新状态</button></div>
${passwordForm}
<p class="warning">不要截图或转发访问密码。外网临时地址会在服务重启后变化，请始终以本页显示为准。</p>
</section></main>
<script>
const managementToken=${managementToken};
const currentPassword=document.getElementById('current-password');
const revealButton=document.getElementById('reveal-password');
if(revealButton&&currentPassword)revealButton.addEventListener('click',()=>{
  const reveal=currentPassword.type==='password';
  currentPassword.type=reveal?'text':'password';
  revealButton.textContent=reveal?'隐藏':'显示';
});
document.querySelectorAll('[data-copy]').forEach(button=>button.addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(button.dataset.copy||'');const previous=button.textContent;button.textContent='已复制';setTimeout(()=>button.textContent=previous,1200)}catch{button.textContent='复制失败'}
}));
const saveButton=document.getElementById('save-password');
const generateButton=document.getElementById('generate-password');
const newPassword=document.getElementById('new-password');
const status=document.getElementById('password-status');
async function changePassword(generate){
  const password=generate?'':(newPassword?.value||'').trim();
  if(!generate&&(password.length<8||password.length>128)){status.textContent='请输入 8–128 个字符。';status.className='status error';return}
  saveButton.disabled=true;generateButton.disabled=true;status.textContent=generate?'正在生成并保存…':'正在保存…';status.className='status';
  try{
    const response=await fetch('/local-setup/password',{method:'POST',headers:{'Content-Type':'application/json','X-CX-Codex-Local-Setup':managementToken},body:JSON.stringify(generate?{generate:true}:{password})});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||'保存失败');
    currentPassword.value=result.password;currentPassword.type='text';revealButton.textContent='隐藏';
    document.querySelectorAll('[data-copy]').forEach(button=>{if(button.closest('.password-line'))button.dataset.copy=result.password});
    newPassword.value='';
    status.textContent='密码已更新，其他设备需要用新密码重新登录。';
  }catch(error){status.textContent=error instanceof Error?error.message:'保存失败';status.className='status error'}
  finally{saveButton.disabled=false;generateButton.disabled=false}
}
if(saveButton)saveButton.addEventListener('click',()=>changePassword(false));
if(generateButton)generateButton.addEventListener('click',()=>changePassword(true));
</script>
</body>
</html>`
}
