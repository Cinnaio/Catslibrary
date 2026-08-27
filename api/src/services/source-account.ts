/**
 * 原作者源站账号 —— 目前只为 PO18.tw 提供登录会话。
 * 密码和 Cookie 使用 AES-256-GCM 加密保存；请求日志和 API 响应均不返回敏感值。
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { first } from '../db/query'
import type { Db } from '../db/pool'
import { newId } from './auth'
import { readRuntimeConfig, writeRuntimeConfig } from '../runtime-config'
import { decodeBytes, FETCH_HEADERS } from './scraper/fetch'
import { po18ResponseProblem } from './scraper/enrich'
import { outboundFetch } from './outbound-fetch'

const PO18_SITE = 'po18tw'
const PO18_LOGIN_URL = 'https://members.po18.tw/apps/login.php'
const PO18_SOURCE_HOSTS = ['po18.tw']
// PO18 与 POPO 共用城邦原创会员体系；登录成功后可能短暂跳转到 popo.tw
// 再回到 PO18。抓取正文时仍只允许 po18.tw，避免把会话 Cookie 带到其他站点。
const PO18_AUTH_HOSTS = ['po18.tw', 'popo.tw']
const CHALLENGE_TTL = 5 * 60_000

type AccountStatus = 'not_configured' | 'credentials_saved' | 'session_saved' | 'authenticated' | 'invalid' | 'needs_captcha' | 'error'

interface SourceAccountRow {
  id: string
  site: string
  username: string
  password_ciphertext: string
  password_iv: string
  password_tag: string
  session_ciphertext: string
  session_iv: string
  session_tag: string
  status: AccountStatus
  last_login_at: number
  last_checked_at: number
  last_error: string
  created_at: number
  updated_at: number
}

export interface Po18AccountStatus {
  site: typeof PO18_SITE
  username: string
  configured: boolean
  hasPassword: boolean
  hasSession: boolean
  status: AccountStatus
  lastLoginAt: number
  lastCheckedAt: number
  lastError: string
}

export interface Po18CaptchaResponse {
  challengeId: string
  imageDataUrl: string
  expiresAt: number
  captchaRequired: boolean
}

export interface Po18LoginResponse extends Po18AccountStatus {
  message: string
}

interface EncryptedValue {
  ciphertext: string
  iv: string
  tag: string
}

interface LoginForm {
  action: string
  hidden: Record<string, string>
  usernameField: string
  passwordField: string
  captchaField: string
  captchaUrl: string
  cookie: string
}

interface LoginChallenge extends LoginForm {
  id: string
  createdAt: number
}

interface Po18HttpResponse {
  status: number
  url: string
  headers: Headers
  bytes: Uint8Array
  cookie: string
}

const challenges = new Map<string, LoginChallenge>()
let cachedSession: { accountId: string; cookie: string; checkedAt: number } | null = null

function encryptionKey(): Buffer {
  let raw = process.env.SOURCE_ACCOUNT_ENCRYPTION_KEY?.trim() || readRuntimeConfig().SOURCE_ACCOUNT_ENCRYPTION_KEY || ''
  if (!raw) {
    raw = randomBytes(32).toString('hex')
    process.env.SOURCE_ACCOUNT_ENCRYPTION_KEY = raw
    writeRuntimeConfig({ SOURCE_ACCOUNT_ENCRYPTION_KEY: raw })
  }
  return createHash('sha256').update(raw).digest()
}

function encrypt(value: string): EncryptedValue {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') }
}

function decrypt(value: { ciphertext: string; iv: string; tag: string }): string {
  if (!value.ciphertext || !value.iv || !value.tag) return ''
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(value.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()]).toString('utf8')
}

function statusFromRow(row: SourceAccountRow | null): Po18AccountStatus {
  const hasPassword = Boolean(row?.password_ciphertext)
  const hasSession = Boolean(row?.session_ciphertext)
  return {
    site: PO18_SITE,
    username: row?.username || '',
    configured: Boolean(row && (hasPassword || hasSession)),
    hasPassword,
    hasSession,
    status: row?.status || 'not_configured',
    lastLoginAt: Number(row?.last_login_at || 0),
    lastCheckedAt: Number(row?.last_checked_at || 0),
    lastError: row?.last_error || '',
  }
}

async function loadAccount(db: Db): Promise<SourceAccountRow | null> {
  return (await first<SourceAccountRow>(db, 'SELECT * FROM source_accounts WHERE site = $1', [PO18_SITE])) ?? null
}

export async function getPo18AccountStatus(db: Db): Promise<Po18AccountStatus> {
  return statusFromRow(await loadAccount(db))
}

export async function savePo18Account(
  db: Db,
  input: { username?: string; password?: string; sessionCookie?: string; clearSession?: boolean },
): Promise<Po18AccountStatus> {
  const existing = await loadAccount(db)
  const username = String(input.username ?? existing?.username ?? '').trim()
  const password = input.password === undefined ? '' : String(input.password || '').trim()
  const sessionCookie = input.sessionCookie === undefined ? '' : normalizeCookie(input.sessionCookie)
  if (!username) throw new Error('PO18.tw 账号不能为空')
  if (!existing && !password && !sessionCookie) throw new Error('请填写 PO18.tw 密码或已登录会话 Cookie')

  const now = Date.now()
  const passwordValue = password
    ? encrypt(password)
    : existing
      ? { ciphertext: existing.password_ciphertext, iv: existing.password_iv, tag: existing.password_tag }
      : { ciphertext: '', iv: '', tag: '' }
  const shouldClearSession = Boolean(input.clearSession || (password && !sessionCookie))
  const sessionValue = sessionCookie
    ? encrypt(sessionCookie)
    : shouldClearSession || !existing
      ? { ciphertext: '', iv: '', tag: '' }
      : { ciphertext: existing.session_ciphertext, iv: existing.session_iv, tag: existing.session_tag }
  const status: AccountStatus = sessionCookie ? 'session_saved' : password ? 'credentials_saved' : existing?.status || 'not_configured'
  const id = existing?.id || newId('acct')
  await db.query(
    `INSERT INTO source_accounts
      (id, site, username, password_ciphertext, password_iv, password_tag, session_ciphertext, session_iv, session_tag,
       status, last_login_at, last_checked_at, last_error, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, '', $13, $13)
     ON CONFLICT (site) DO UPDATE SET
       username = EXCLUDED.username,
       password_ciphertext = EXCLUDED.password_ciphertext,
       password_iv = EXCLUDED.password_iv,
       password_tag = EXCLUDED.password_tag,
       session_ciphertext = EXCLUDED.session_ciphertext,
       session_iv = EXCLUDED.session_iv,
       session_tag = EXCLUDED.session_tag,
       status = EXCLUDED.status,
       last_error = '',
       updated_at = EXCLUDED.updated_at`,
    [
      id,
      PO18_SITE,
      username,
      passwordValue.ciphertext,
      passwordValue.iv,
      passwordValue.tag,
      sessionValue.ciphertext,
      sessionValue.iv,
      sessionValue.tag,
      status,
      sessionCookie ? now : existing?.last_login_at || 0,
      existing?.last_checked_at || 0,
      existing?.created_at || now,
    ],
  )
  cachedSession = sessionCookie ? { accountId: id, cookie: sessionCookie, checkedAt: now } : null
  return statusFromRow(await loadAccount(db))
}

export async function clearPo18Account(db: Db): Promise<void> {
  await db.query('DELETE FROM source_accounts WHERE site = $1', [PO18_SITE])
  cachedSession = null
  challenges.clear()
}

function normalizeCookie(value: string): string {
  return String(value || '')
    .replace(/^\s*cookie\s*:\s*/i, '')
    .replace(/[\r\n]+/g, ';')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => /^[^=;\s]+=[^;\s]*$/.test(part))
    .join('; ')
}

function cookieParts(headers: Headers): string[] {
  const typed = headers as Headers & { getSetCookie?: () => string[] }
  const values = typed.getSetCookie?.()
  if (values?.length) return values
  const raw = headers.get('set-cookie') || ''
  return raw ? raw.split(/,(?=\s*[^;,=\s]+=[^;,]*)/) : []
}

function mergeCookies(current: string, setCookies: string[]): string {
  const jar = new Map<string, string>()
  for (const part of normalizeCookie(current).split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name && rest.length) jar.set(name, `${name}=${rest.join('=')}`)
  }
  for (const cookie of setCookies) {
    const pair = cookie.split(';', 1)[0]?.trim() || ''
    const [name, ...rest] = pair.split('=')
    if (name && rest.length) jar.set(name, `${name}=${rest.join('=')}`)
  }
  return [...jar.values()].join('; ')
}

function hostAllowed(hostname: string, allowlist: string[]): boolean {
  const host = hostname.toLowerCase().replace(/^\.|\.$/g, '')
  return allowlist.some((item) => {
    const rule = item
      .toLowerCase()
      .trim()
      .replace(/^\.|\.$/g, '')
    return rule && (host === rule || host.endsWith(`.${rule}`))
  })
}

function assertPo18Url(rawUrl: string, allowlist = PO18_AUTH_HOSTS): URL {
  const url = new URL(rawUrl)
  if (!['http:', 'https:'].includes(url.protocol) || !hostAllowed(url.hostname, allowlist)) {
    throw new Error(`PO18 会话只能访问官方登录域名（实际跳转到：${url.hostname}）`)
  }
  return url
}

/** 仅访问固定的 PO18 域名，并手动跟随重定向，以便保留登录响应中的 Set-Cookie。 */
async function po18Request(rawUrl: string, init: RequestInit = {}, initialCookie = '', allowlist = PO18_AUTH_HOSTS): Promise<Po18HttpResponse> {
  let url = assertPo18Url(rawUrl, allowlist)
  let method = (init.method || 'GET').toUpperCase()
  let body = init.body
  let cookie = normalizeCookie(initialCookie || String(new Headers(init.headers).get('Cookie') || ''))
  const headers = new Headers(FETCH_HEADERS)
  new Headers(init.headers).forEach((value, key) => headers.set(key, value))

  for (let hop = 0; hop <= 5; hop++) {
    if (cookie) headers.set('Cookie', cookie)
    const response = await outboundFetch(
      url.href,
      { ...init, method, body, headers, redirect: 'manual' },
      // URL 已由 assertPo18Url 限定为 PO18 官方域名；这里需要手动处理重定向 Cookie。
      { scope: 'source-auth', safe: false },
    )
    cookie = mergeCookies(cookie, cookieParts(response.headers))
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      url = assertPo18Url(new URL(response.headers.get('location')!, url.href).href, allowlist)
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
        method = 'GET'
        body = undefined
      }
      headers.set('Referer', response.url || url.href)
      continue
    }
    return { status: response.status, url: response.url || url.href, headers: response.headers, bytes, cookie }
  }
  throw new Error('PO18 登录重定向次数过多')
}

function decodeHtml(response: Po18HttpResponse): string {
  const charset = response.headers.get('content-type')?.match(/charset=([^;\s]+)/i)?.[1] || 'big5'
  try {
    return decodeBytes(response.bytes, charset)
  } catch {
    return decodeBytes(response.bytes, 'utf-8')
  }
}

function decodeHtmlEntity(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

function attribute(tag: string, name: string): string {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'))
  return decodeHtmlEntity(match?.[1] || '')
}

function parseLoginForm(html: string, cookie: string): LoginForm {
  const forms = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)]
  const candidate = forms.find((match) => /<input\b[^>]*type\s*=\s*["']?password/i.test(match[2]!)) || forms[0]
  if (!candidate) throw new Error('无法识别 PO18 登录表单')
  const formTag = candidate[1] || ''
  const formHtml = candidate[2] || ''
  const inputs = [...formHtml.matchAll(/<input\b[^>]*>/gi)].map((match) => match[0]!)
  const inputInfo = inputs.map((tag) => ({
    tag,
    name: attribute(tag, 'name'),
    id: attribute(tag, 'id'),
    type: (attribute(tag, 'type') || 'text').toLowerCase(),
    value: attribute(tag, 'value'),
  }))
  const password = inputInfo.find((input) => input.type === 'password' || /pass|密碼|密码/i.test(`${input.name} ${input.id}`))
  const username =
    inputInfo.find(
      (input) => input.type !== 'hidden' && input !== password && /user|account|login|mail|會員|会员|帳號|账号/i.test(`${input.name} ${input.id}`),
    ) || inputInfo.find((input) => input.type === 'text')
  const captcha = inputInfo.find(
    (input) => input.type !== 'hidden' && /captcha|verify|check|code|驗證|验证码/i.test(`${input.name} ${input.id}`) && input !== username,
  )
  if (!username?.name || !password?.name) throw new Error('无法识别 PO18 账号或密码字段')
  const hidden: Record<string, string> = {}
  for (const input of inputInfo) if (input.type === 'hidden' && input.name) hidden[input.name] = input.value
  const images = [...formHtml.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]!)
  const captchaImage =
    images.find((tag) => /captcha|verify|check|code|驗證|验证码/i.test(`${attribute(tag, 'src')} ${attribute(tag, 'id')} ${attribute(tag, 'class')}`)) ||
    images.find((tag) => attribute(tag, 'src'))
  const action = new URL(attribute(formTag, 'action') || PO18_LOGIN_URL, PO18_LOGIN_URL).href
  return {
    action,
    hidden,
    usernameField: username.name,
    passwordField: password.name,
    captchaField: captcha?.name || '',
    captchaUrl: captchaImage ? new URL(attribute(captchaImage, 'src'), PO18_LOGIN_URL).href : '',
    cookie,
  }
}

function loginMarker(html: string): boolean {
  const hasPasswordField = /<input\b[^>]*(?:type\s*=\s*["']?password|name\s*=\s*["'][^"']*(?:pass|密碼|密码))/i.test(html)
  const hasAccountField = /<input\b[^>]*(?:name|id)\s*=\s*["'][^"']*(?:user|account|login|mail|會員|会员|帳號|账号)/i.test(html)
  return hasPasswordField && hasAccountField && /會員登入|会员登录|登入|登录/i.test(html)
}

function loginFailureMarker(html: string): boolean {
  return /驗證碼錯誤|验证码错误|帳號或密碼錯誤|账号或密码错误|登入失敗|登录失败|驗證碼不正確|验证码不正确/i.test(html)
}

function cleanupChallenges(): void {
  const cutoff = Date.now() - CHALLENGE_TTL
  for (const [id, challenge] of challenges) if (challenge.createdAt < cutoff) challenges.delete(id)
}

export async function createPo18Captcha(): Promise<Po18CaptchaResponse> {
  cleanupChallenges()
  const page = await po18Request(PO18_LOGIN_URL)
  const form = parseLoginForm(decodeHtml(page), page.cookie)
  let imageDataUrl = ''
  if (form.captchaUrl) {
    const image = await po18Request(form.captchaUrl, { headers: { Cookie: form.cookie, Referer: PO18_LOGIN_URL } }, form.cookie)
    const mime = image.headers.get('content-type')?.split(';')[0] || 'image/png'
    imageDataUrl = `data:${mime};base64,${Buffer.from(image.bytes).toString('base64')}`
    form.cookie = image.cookie
  }
  const id = newId('challenge')
  challenges.set(id, { ...form, id, createdAt: Date.now() })
  return { challengeId: id, imageDataUrl, expiresAt: Date.now() + CHALLENGE_TTL, captchaRequired: Boolean(form.captchaField || form.captchaUrl) }
}

export async function loginPo18Account(db: Db, input: { challengeId: string; captcha?: string }): Promise<Po18LoginResponse> {
  cleanupChallenges()
  const challenge = challenges.get(input.challengeId)
  if (!challenge || Date.now() - challenge.createdAt > CHALLENGE_TTL) throw new Error('PO18 登录验证码已过期，请重新获取')
  const account = await loadAccount(db)
  if (!account?.username || !account.password_ciphertext) throw new Error('请先保存 PO18.tw 账号和密码')
  let password: string
  try {
    password = decrypt({ ciphertext: account.password_ciphertext, iv: account.password_iv, tag: account.password_tag })
  } catch {
    throw new Error('PO18.tw 账号凭证无法解密，请重新保存账号')
  }
  const form = new URLSearchParams(challenge.hidden)
  form.set(challenge.usernameField, account.username)
  form.set(challenge.passwordField, password)
  if (challenge.captchaField) form.set(challenge.captchaField, String(input.captcha || '').trim())
  const response = await po18Request(
    challenge.action,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: PO18_LOGIN_URL },
      body: form.toString(),
    },
    challenge.cookie,
  )
  challenges.delete(input.challengeId)
  const html = decodeHtml(response)
  if (loginFailureMarker(html) || loginMarker(html)) {
    const status: AccountStatus = challenge.captchaField ? 'needs_captcha' : 'invalid'
    await db.query('UPDATE source_accounts SET status = $1, last_error = $2, updated_at = $3 WHERE id = $4', [
      status,
      'PO18 登录失败，请检查账号、密码或验证码',
      Date.now(),
      account.id,
    ])
    throw new Error('PO18 登录失败，请检查账号、密码或验证码')
  }
  if (!response.cookie) throw new Error('PO18 登录未返回有效会话，请改用浏览器登录后粘贴 Cookie')
  const encrypted = encrypt(response.cookie)
  const now = Date.now()
  await db.query(
    `UPDATE source_accounts SET session_ciphertext = $1, session_iv = $2, session_tag = $3,
      status = 'authenticated', last_login_at = $4, last_checked_at = $4, last_error = '', updated_at = $4 WHERE id = $5`,
    [encrypted.ciphertext, encrypted.iv, encrypted.tag, now, account.id],
  )
  cachedSession = { accountId: account.id, cookie: response.cookie, checkedAt: now }
  return { ...statusFromRow(await loadAccount(db)), message: 'PO18 登录成功' }
}

export async function getPo18Session(db: Db): Promise<{ accountId: string; cookie: string }> {
  const account = await loadAccount(db)
  if (!account) throw new Error('尚未配置 PO18.tw 账号，请先在源站账号管理中完成登录')
  if (cachedSession?.accountId === account.id && cachedSession.cookie) return { accountId: account.id, cookie: cachedSession.cookie }
  try {
    const cookie = decrypt({ ciphertext: account.session_ciphertext, iv: account.session_iv, tag: account.session_tag })
    if (cookie) {
      cachedSession = { accountId: account.id, cookie, checkedAt: Date.now() }
      return { accountId: account.id, cookie }
    }
  } catch {
    throw new Error('PO18.tw 会话无法解密，请重新登录或粘贴 Cookie')
  }
  throw new Error('PO18.tw 尚未配置有效登录会话，请先登录或粘贴 Cookie')
}

export async function testPo18Account(db: Db, sourceUrl?: string): Promise<Po18LoginResponse> {
  const session = await getPo18Session(db)
  const requestedSourceUrl = sourceUrl?.trim() || ''
  const target = requestedSourceUrl || 'https://www.po18.tw/'
  const requestCookie = ['po18Limit=1', session.cookie].filter(Boolean).join('; ')
  const response = await po18Request(target, { headers: { Cookie: requestCookie } }, requestCookie, PO18_SOURCE_HOSTS)
  const html = decodeHtml(response)
  const targetPath = new URL(target).pathname.replace(/\/$/, '')
  const responsePath = (() => {
    try {
      return new URL(response.url).pathname.replace(/\/$/, '')
    } catch {
      return ''
    }
  })()
  const detectedProblem = po18ResponseProblem(response.url, html)
  const problem = detectedProblem && !(targetPath === '' && responsePath === '' && detectedProblem.includes('首页')) ? detectedProblem : null
  const now = Date.now()
  if (problem) {
    const status: AccountStatus = problem.includes('登录页') ? 'invalid' : 'error'
    if (status === 'invalid') cachedSession = null
    await db.query('UPDATE source_accounts SET status = $1, last_checked_at = $2, last_error = $3, updated_at = $2 WHERE id = $4', [
      status,
      now,
      problem,
      session.accountId,
    ])
    throw new Error(problem)
  }
  await db.query("UPDATE source_accounts SET status = $1, last_checked_at = $2, last_error = '', updated_at = $2 WHERE id = $3", [
    'authenticated',
    now,
    session.accountId,
  ])
  return {
    ...statusFromRow(await loadAccount(db)),
    message: requestedSourceUrl ? 'PO18 会话可用，指定书源链接访问正常' : 'PO18 站点可访问；尚未验证具体书源权限，请提供书源链接测试',
  }
}

export async function invalidatePo18Session(db: Db, error = 'PO18 会话已失效'): Promise<void> {
  cachedSession = null
  await db.query(
    "UPDATE source_accounts SET session_ciphertext = '', session_iv = '', session_tag = '', status = $1, last_error = $2, updated_at = $3 WHERE site = $4",
    ['invalid', error, Date.now(), PO18_SITE],
  )
}

export const sourceAccountTestHelpers = {
  normalizeCookie,
  mergeCookies,
  parseLoginForm,
  loginMarker,
  loginFailureMarker,
  assertPo18Url,
}
