import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { RequestHandler, Request, Response, NextFunction } from 'express'
import {
  WEB_AUTH_EXPIRED_MESSAGE,
  WEB_AUTH_EXPIRED_STATUS,
  WEB_AUTH_STATUS_STORAGE_KEY,
  WEB_AUTH_REQUIRED_ERROR_CODE,
  WEB_AUTH_REQUIRED_HEADER,
  WEB_AUTH_REQUIRED_VALUE,
} from '../shared/webAuth.js'

const TOKEN_COOKIE = 'codex_web_local_token'
const TOKEN_MAX_AGE_SECONDS = 31536000
const TOKEN_MAX_AGE_MS = TOKEN_MAX_AGE_SECONDS * 1000
const TOKEN_STORE_MAX_ENTRIES = 24

type StoredAuthToken = {
  hash: string
  createdAt: number
  lastSeenAt: number
}

type StoredAuthState = {
  version: 1
  passwordFingerprint?: string
  tokens: StoredAuthToken[]
}

function constantTimeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {}
  if (!header) return cookies
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=')
    if (idx === -1) continue
    const key = pair.slice(0, idx).trim()
    const value = pair.slice(idx + 1).trim()
    cookies[key] = value
  }
  return cookies
}

function getAuthTokenStorePath(): string {
  return join(homedir(), '.cx-codex', 'web-auth-tokens.json')
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function hashPasswordFingerprint(password: string): string {
  return createHash('sha256').update(`cx-codex-auth-password-v1:${password}`, 'utf8').digest('hex')
}

function normalizeStoredAuthToken(value: unknown, now = Date.now()): StoredAuthToken | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const hash = typeof record.hash === 'string' ? record.hash.trim() : ''
  if (!/^[a-f0-9]{64}$/iu.test(hash)) return null
  const createdAt = typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
    ? Math.trunc(record.createdAt)
    : now
  const lastSeenAt = typeof record.lastSeenAt === 'number' && Number.isFinite(record.lastSeenAt)
    ? Math.trunc(record.lastSeenAt)
    : createdAt
  if (now - Math.max(createdAt, lastSeenAt) > TOKEN_MAX_AGE_MS) return null
  return { hash, createdAt, lastSeenAt }
}

function loadStoredAuthTokens(passwordFingerprint: string): StoredAuthToken[] {
  try {
    const storePath = getAuthTokenStorePath()
    if (!existsSync(storePath)) return []
    const parsed = JSON.parse(readFileSync(storePath, 'utf8')) as Partial<StoredAuthState>
    if (parsed.passwordFingerprint !== passwordFingerprint) return []
    const now = Date.now()
    return (Array.isArray(parsed.tokens) ? parsed.tokens : [])
      .map((token) => normalizeStoredAuthToken(token, now))
      .filter((token): token is StoredAuthToken => token !== null)
      .sort((first, second) => second.lastSeenAt - first.lastSeenAt)
      .slice(0, TOKEN_STORE_MAX_ENTRIES)
  } catch {
    return []
  }
}

function persistStoredAuthTokens(tokens: StoredAuthToken[], passwordFingerprint: string): void {
  try {
    const now = Date.now()
    const normalized = tokens
      .map((token) => normalizeStoredAuthToken(token, now))
      .filter((token): token is StoredAuthToken => token !== null)
      .sort((first, second) => second.lastSeenAt - first.lastSeenAt)
      .slice(0, TOKEN_STORE_MAX_ENTRIES)
    const storePath = getAuthTokenStorePath()
    mkdirSync(dirname(storePath), { recursive: true })
    writeFileSync(storePath, JSON.stringify({ version: 1, passwordFingerprint, tokens: normalized }, null, 2), 'utf8')
  } catch {
    // Authentication should keep working in memory even if persistence is unavailable.
  }
}

function isLocalhostRemote(remote: string): boolean {
  return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
}

function isLocalhostHost(host: string): boolean {
  const normalized = host.toLowerCase()
  return normalized.startsWith('localhost:') || normalized === 'localhost' || normalized.startsWith('127.0.0.1:')
}

function isCodexApiPath(path: string): boolean {
  return path === '/codex-api' || path.startsWith('/codex-api/')
}

function clearTokenCookie(res: Response): void {
  res.setHeader('Set-Cookie', `${TOKEN_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`)
}

function isValidStoredTokenHash(hash: string, storedHash: string): boolean {
  if (hash.length !== storedHash.length) return false
  return timingSafeEqual(Buffer.from(hash), Buffer.from(storedHash))
}

function isAuthorizedByRequestLike(
  remoteAddress: string | undefined,
  hostHeader: string | undefined,
  cookieHeader: string | undefined,
  validTokenHashes: Map<string, StoredAuthToken>,
  passwordFingerprint: string,
): boolean {
  const remote = remoteAddress ?? ''
  if (isLocalhostRemote(remote) || isLocalhostHost(hostHeader ?? '')) {
    return true
  }

  const cookies = parseCookies(cookieHeader)
  const token = cookies[TOKEN_COOKIE]
  if (!token) return false
  const incomingHash = hashToken(token)
  for (const [storedHash, stored] of validTokenHashes.entries()) {
    if (!isValidStoredTokenHash(incomingHash, storedHash)) continue
    const now = Date.now()
    if (now - Math.max(stored.createdAt, stored.lastSeenAt) > TOKEN_MAX_AGE_MS) {
      validTokenHashes.delete(storedHash)
      persistStoredAuthTokens([...validTokenHashes.values()], passwordFingerprint)
      return false
    }
    if (now - stored.lastSeenAt > 60_000) {
      stored.lastSeenAt = now
      validTokenHashes.set(storedHash, stored)
      persistStoredAuthTokens([...validTokenHashes.values()], passwordFingerprint)
    }
    return true
  }
  return false
}

const LOGIN_PAGE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Codex Web Local &mdash; 登录</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0a0a;color:#e5e5e5;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:1rem}
.card{background:#171717;border:1px solid #262626;border-radius:12px;padding:2rem;width:100%;max-width:380px}
h1{font-size:1.25rem;font-weight:600;margin-bottom:1.5rem;text-align:center;color:#fafafa}
label{display:block;font-size:.875rem;color:#a3a3a3;margin-bottom:.5rem}
input{width:100%;padding:.625rem .75rem;background:#0a0a0a;border:1px solid #404040;border-radius:8px;color:#fafafa;font-size:1rem;outline:none;transition:border-color .15s}
input:focus{border-color:#3b82f6}
button{width:100%;padding:.625rem;margin-top:1rem;background:#3b82f6;color:#fff;border:none;border-radius:8px;font-size:.9375rem;font-weight:500;cursor:pointer;transition:background .15s}
button:hover{background:#2563eb}
.notice{display:none;margin-bottom:1rem;padding:.75rem .875rem;border-radius:10px;border:1px solid rgba(250,204,21,.24);background:rgba(250,204,21,.08);color:#fde68a;font-size:.875rem;line-height:1.55}
.notice-title{display:block;font-size:.9375rem;font-weight:600;color:#fef3c7;margin-bottom:.25rem}
.error{color:#ef4444;font-size:.8125rem;margin-top:.75rem;text-align:center;display:none}
</style>
</head>
<body>
<div class="card">
<h1>Codex Web Local</h1>
<div class="notice" id="notice" role="status" aria-live="polite">
<span class="notice-title">登录状态已失效</span>
<span id="notice-text"></span>
</div>
<form id="f">
<label for="pw">密码</label>
<input id="pw" name="password" type="password" autocomplete="current-password" autofocus required>
<button type="submit">登录</button>
<p class="error" id="err">密码错误</p>
</form>
</div>
<script>
const form=document.getElementById('f');
const errEl=document.getElementById('err');
const noticeEl=document.getElementById('notice');
const noticeTextEl=document.getElementById('notice-text');
const pwEl=document.getElementById('pw');
const buttonEl=form.querySelector('button');
function mobileShell(){
  try{return window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.MobileShell}catch{return null}
}
async function getStoredMobileAuthKey(){
  const shell=mobileShell();
  if(!shell||!shell.getAuthConfig)return '';
  try{
    const config=await shell.getAuthConfig();
    return config&&typeof config.authKey==='string'?config.authKey.trim():'';
  }catch{return ''}
}
async function persistMobileAuthKey(password){
  const shell=mobileShell();
  if(!shell||!shell.setAuthKey)return;
  try{await shell.setAuthKey({authKey:password})}catch{}
}
function setBusy(message){
  if(buttonEl)buttonEl.textContent=message;
  if(buttonEl)buttonEl.disabled=true;
}
function clearBusy(){
  if(buttonEl)buttonEl.textContent='登录';
  if(buttonEl)buttonEl.disabled=false;
}
async function loginWithPassword(password,options){
  const normalized=typeof password==='string'?password.trim():'';
  if(!normalized)return false;
  const res=await fetch('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:normalized})});
  if(res.ok){
    if(options&&options.persist)await persistMobileAuthKey(normalized);
    try{window.sessionStorage.removeItem('${WEB_AUTH_STATUS_STORAGE_KEY}')}catch{}
    window.location.reload();
    return true;
  }
  return false;
}
try{
  const raw=window.sessionStorage.getItem('${WEB_AUTH_STATUS_STORAGE_KEY}');
  if(raw){
    const parsed=JSON.parse(raw);
    if(parsed && parsed.status==='${WEB_AUTH_EXPIRED_STATUS}'){
      const message=typeof parsed.message==='string' && parsed.message.trim() ? parsed.message.trim() : '${WEB_AUTH_EXPIRED_MESSAGE}';
      noticeTextEl.textContent=message;
      noticeEl.style.display='block';
    }
    window.sessionStorage.removeItem('${WEB_AUTH_STATUS_STORAGE_KEY}');
  }
}catch{}
setTimeout(async()=>{
  const storedKey=await getStoredMobileAuthKey();
  if(!storedKey)return;
  errEl.style.display='none';
  setBusy('自动登录中...');
  const ok=await loginWithPassword(storedKey,{persist:false});
  if(!ok)clearBusy();
},80);
form.addEventListener('submit',async e=>{
  e.preventDefault();
  errEl.style.display='none';
  setBusy('登录中...');
  const ok=await loginWithPassword(pwEl.value,{persist:true});
  if(!ok){
    clearBusy();
    errEl.style.display='block';pwEl.value='';pwEl.focus()
  }
});
</script>
</body>
</html>`

export function createAuthMiddleware(password: string): RequestHandler {
  return createAuthSession(password).middleware
}

export type AuthSession = {
  middleware: RequestHandler
  isRequestAuthorized: (req: IncomingMessage) => boolean
}

export function createAuthSession(password: string): AuthSession {
  const validTokenHashes = new Map<string, StoredAuthToken>()
  const passwordFingerprint = hashPasswordFingerprint(password)
  for (const token of loadStoredAuthTokens(passwordFingerprint)) {
    validTokenHashes.set(token.hash, token)
  }

  const middleware: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
    if (isAuthorizedByRequestLike(req.socket.remoteAddress, req.headers.host, req.headers.cookie, validTokenHashes, passwordFingerprint)) {
      next()
      return
    }

    // Handle login POST
    if (req.method === 'POST' && req.path === '/auth/login') {
      let body = ''
      req.setEncoding('utf8')
      req.on('data', (chunk: string) => { body += chunk })
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body) as { password?: string }
          const provided = typeof parsed.password === 'string' ? parsed.password : ''

          if (!constantTimeCompare(provided, password)) {
            res.status(401).json({ error: '密码错误' })
            return
          }

          const token = randomBytes(32).toString('hex')
          const tokenHash = hashToken(token)
          const now = Date.now()
          validTokenHashes.set(tokenHash, {
            hash: tokenHash,
            createdAt: now,
            lastSeenAt: now,
          })
          persistStoredAuthTokens([...validTokenHashes.values()], passwordFingerprint)

          res.setHeader('Set-Cookie', `${TOKEN_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${TOKEN_MAX_AGE_SECONDS}`)
          res.json({ ok: true })
        } catch {
          res.status(400).json({ error: '请求体格式无效' })
        }
      })
      return
    }

    if (isCodexApiPath(req.path)) {
      clearTokenCookie(res)
      res.setHeader(WEB_AUTH_REQUIRED_HEADER, WEB_AUTH_REQUIRED_VALUE)
      res.status(401).json({
        error: WEB_AUTH_EXPIRED_MESSAGE,
        code: WEB_AUTH_REQUIRED_ERROR_CODE,
      })
      return
    }

    // No valid session — serve login page
    clearTokenCookie(res)
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.status(200).send(LOGIN_PAGE_HTML)
  }

  return {
    middleware,
    isRequestAuthorized: (req: IncomingMessage) => (
      isAuthorizedByRequestLike(req.socket.remoteAddress, req.headers.host, req.headers.cookie, validTokenHashes, passwordFingerprint)
    ),
  }
}
