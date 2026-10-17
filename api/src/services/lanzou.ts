import { createHash } from 'node:crypto'
import type { SupplementaryFile } from '@shared/supplementary-source'
import { outboundFetch } from './outbound-fetch'

const SHARE_DOMAINS = [
  'lanzov.com',
  'lanzou.com',
  'lanzoui.com',
  'lanzoux.com',
  'lanzous.com',
  'lanzouw.com',
  'lanzouj.com',
  'lanzouq.com',
  'lanzoue.com',
  'lanzout.com',
  'lanzoul.com',
  'lanzoub.com',
  'lanzouy.com',
  'lanzouo.com',
]
const DOWNLOAD_DOMAINS = [...SHARE_DOMAINS, 'woozooo.com', 'lanrar.com', 'lanzouc.com']
const MAX_FILE_BYTES = 25 * 1024 * 1024
const MAX_PAGE_BYTES = 2 * 1024 * 1024

export class LanzouError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid' | 'manual' | 'failed' = 'failed',
  ) {
    super(message)
  }
}
function hostIn(host: string, domains: string[]) {
  return domains.some((d) => host === d || host.endsWith(`.${d}`))
}
function checkedUrl(raw: string, domains: string[]): URL {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new LanzouError('请输入有效的蓝奏分享链接', 'invalid')
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !hostIn(u.hostname, domains))
    throw new LanzouError('仅支持 HTTPS 蓝奏分享链接', 'invalid')
  return u
}
export function normalizeLanzouFolderUrl(raw: string): string {
  const u = checkedUrl(raw.trim(), SHARE_DOMAINS)
  if (!/^\/b[a-zA-Z0-9]+\/?$/.test(u.pathname)) throw new LanzouError('请填写蓝奏文件夹分享链接（不是单个文件）', 'invalid')
  return `${u.origin}${u.pathname.replace(/\/$/, '')}`
}
export function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n: string) => (Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : ''))
}
export function fileIdentity(name: string): { title: string; author: string; revision: number | null } {
  const base = name
    .normalize('NFKC')
    .replace(/\.(txt|text|epub)$/i, '')
    .trim()
  const revision = base.match(/^[\[【](?:更|更新至?)(\d+)/)
  const clean = base.replace(/^[\[【][^\]】]*[\]】]\s*/, '')
  const parts = clean.split(/\s*作者\s*[:：]\s*/)
  return {
    title: (parts[0] || '').replace(/^[《「]|[》」]$/g, '').trim(),
    author: (parts.slice(1).filter(Boolean).at(-1) || '').trim(),
    revision: revision ? Number(revision[1]) : null,
  }
}
export function identityKey(s: string) {
  return s
    .normalize('NFKC')
    .replace(/[\s《》「」]/g, '')
    .toLocaleLowerCase()
}

export type LanzouRequest = (url: string, init?: RequestInit, maxBytes?: number) => Promise<Uint8Array>
/** 只读取受限大小的响应，超时覆盖响应正文；Cookie 不落库。每一跳使用既有 SSRF 防护。 */
export function createLanzouRequest(): LanzouRequest {
  const cookies = new Map<string, Map<string, string>>()
  return async (url, init = {}, maxBytes = MAX_PAGE_BYTES) => {
    const u = checkedUrl(url, DOWNLOAD_DOMAINS)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 18000)
    try {
      const headers = new Headers({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
        Accept: '*/*',
      })
      new Headers(init.headers).forEach((v, k) => headers.set(k, v))
      if (cookies.has(u.hostname)) headers.set('Cookie', [...cookies.get(u.hostname)!.entries()].map(([k, v]) => `${k}=${v}`).join('; '))
      const res = await outboundFetch(
        url,
        { ...init, headers, signal: controller.signal },
        { scope: 'supplementary-source', safe: true, allowedRedirectHosts: DOWNLOAD_DOMAINS },
      )
      if (!res.ok)
        throw new LanzouError(
          res.status === 400 ? '蓝奏下载地址超时，请重新检查或手动下载后上传' : `蓝奏请求失败（HTTP ${res.status}）`,
          res.status === 400 ? 'manual' : 'failed',
        )
      const setCookies = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() || []
      if (setCookies.length) {
        const jar = cookies.get(u.hostname) || new Map<string, string>()
        for (const cookie of setCookies) {
          const pair = cookie.split(';')[0] || ''
          const i = pair.indexOf('=')
          if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1))
        }
        cookies.set(u.hostname, jar)
      }
      if (Number(res.headers.get('content-length')) > maxBytes) {
        await res.body?.cancel()
        throw new LanzouError('蓝奏响应超过大小限制')
      }
      const chunks: Uint8Array[] = []
      let size = 0
      const reader = res.body?.getReader()
      if (reader) {
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            size += value.length
            if (size > maxBytes) {
              await reader.cancel()
              throw new LanzouError('蓝奏响应超过大小限制')
            }
            chunks.push(value)
          }
        } finally {
          reader.releaseLock()
        }
      }
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const c of chunks) {
        bytes.set(c, offset)
        offset += c.length
      }
      return bytes
    } catch (err) {
      if (err instanceof LanzouError) throw err
      throw new LanzouError('蓝奏连接失败或超时，请稍后重试')
    } finally {
      clearTimeout(timer)
    }
  }
}
function variable(html: string, name: string): string {
  return html.match(new RegExp(`var\\s+${name}\\s*=\\s*['"]([^'"]*)['"]`))?.[1] || ''
}
function field(html: string, name: string): string {
  return (
    html
      .match(new RegExp(`['"]${name}['"]\\s*:\\s*(?:['"]([^'"]*)['"]|(\\d+))`))
      ?.slice(1)
      .find(Boolean) || ''
  )
}
function json(bytes: Uint8Array): Record<string, unknown> {
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes))
    if (!value || typeof value !== 'object') throw new Error()
    return value
  } catch {
    throw new LanzouError('蓝奏返回了验证页或无法识别的响应，请手动下载后上传', 'manual')
  }
}
async function post(request: LanzouRequest, url: string, body: Record<string, string>, referer: string) {
  return json(
    await request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: referer },
      body: new URLSearchParams(body).toString(),
    }),
  )
}

/** 全量建立有限目录索引；任一页失败或达到上限均不冒充完整结果。 */
export async function scanLanzouFolder(rawUrl: string, password = '', request = createLanzouRequest(), failedFolders?: string[]): Promise<SupplementaryFile[]> {
  const root = normalizeLanzouFolderUrl(rawUrl)
  const queue = [{ url: root, folder: '', depth: 0 }]
  const visited = new Set<string>()
  const files = new Map<string, SupplementaryFile>()
  const deadline = Date.now() + 110000
  while (queue.length) {
    if (Date.now() > deadline || visited.size >= 40) throw new LanzouError('目录过大或检查超时，请绑定更具体的月份目录')
    const current = queue.shift()!
    if (visited.has(current.url)) continue
    visited.add(current.url)
    const folderFiles = new Map<string, SupplementaryFile>()
    try {
      const html = new TextDecoder().decode(await request(current.url))
      if (/arg1=|验证码|访问频繁/.test(html)) throw new LanzouError('蓝奏需要浏览器验证，请稍后重新检查', 'manual')
      const links = [...html.matchAll(/<a\b[^>]*href=["'](\/b[a-zA-Z0-9]+)["'][^>]*>[\s\S]*?<div\s+class=["']filename["']>([^<]+)/g)]
      if (links.length && current.depth >= 2) throw new LanzouError('目录层级超过限制，请绑定更具体的目录')
      for (const link of links.sort((a, b) => (b[2] || '').localeCompare(a[2] || '', 'zh-CN', { numeric: true })))
        queue.push({
          url: new URL(link[1]!, current.url).href,
          folder: [current.folder, decodeHtml(link[2]!).trim()].filter(Boolean).join('/'),
          depth: current.depth + 1,
        })
      const endpoint = html.match(/url\s*:\s*['"]([^'"]*filemoreajax\.php[^'"]*)['"]/)?.[1]
      if (!endpoint) throw new LanzouError('无法识别蓝奏文件夹，请检查链接、提取码或页面是否变化')
      const timeName = html.match(/['"]t['"]\s*:\s*([a-zA-Z_\d]+)/)?.[1]
      const keyName = html.match(/['"]k['"]\s*:\s*([a-zA-Z_\d]+)/)?.[1]
      const body: Record<string, string> = { pg: '1', pwd: password }
      for (const k of ['lx', 'fid', 'uid', 'puid', 'rep', 'up', 'vip', 'webfoldersign']) body[k] = field(html, k)
      body.t = timeName ? variable(html, timeName) : field(html, 't')
      body.k = keyName ? variable(html, keyName) : field(html, 'k')
      if (!body.fid || !body.t || !body.k) throw new LanzouError('蓝奏目录参数缺失，暂时无法检查')
      let finished = false
      for (let page = 1; page <= 20; page++) {
        if (Date.now() > deadline) throw new LanzouError('目录检查超时，请稍后重试')
        body.pg = String(page)
        const result = await post(request, new URL(decodeHtml(endpoint), current.url).href, body, current.url)
        if (Number(result.zt) === 2) {
          finished = true
          break
        }
        if (Number(result.zt) !== 1 || !Array.isArray(result.text))
          throw new LanzouError(password ? '蓝奏目录读取失败，请核对提取码或稍后重试' : '蓝奏目录读取失败；如有提取码，请填写后重试')
        for (const item of result.text as Record<string, unknown>[]) {
          if (Number(item.t) === 1 || !/^i[a-zA-Z0-9]+$/.test(String(item.id))) continue
          const name = decodeHtml(String(item.name_all || '')).trim()
          if (!/\.(txt|text|epub)$/i.test(name)) continue
          const url = new URL(`/${item.id}`, current.url).href
          const key = createHash('sha256').update(url).digest('hex').slice(0, 24)
          folderFiles.set(key, {
            key,
            url,
            name,
            folder: current.folder || decodeHtml(html.match(/<title>([^<]*)/)?.[1] || ''),
            size: String(item.size || ''),
            ...fileIdentity(name),
          })
          if (files.size + folderFiles.size > 5000) throw new LanzouError('目录文件过多，请绑定更具体的目录')
        }
        if (result.text.length < 50) {
          finished = true
          break
        }
      }
      if (!finished) throw new LanzouError('目录分页超过限制，本次结果未保存')
      for (const [key, file] of folderFiles) files.set(key, file)
    } catch (error) {
      if (!failedFolders || current.depth === 0) throw error
      failedFolders.push(current.folder)
    }
  }
  return [...files.values()]
}

export function assertBookBytes(bytes: Uint8Array, name: string) {
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new LanzouError('文件为空或超过 25 MB', 'invalid')
  const head = new TextDecoder().decode(bytes.slice(0, 2048)).trimStart()
  if (/^(?:<!doctype\s+html|<html|<script|<head|<body)/i.test(head) || /var arg1=|系统发现您的网络异常/.test(head))
    throw new LanzouError('蓝奏返回了浏览器验证页，请在原文件页面下载后上传', 'manual')
  if (/\.epub$/i.test(name) && !(bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new LanzouError('下载内容不是有效的 EPUB 文件', 'manual')
  if (/\.(txt|text)$/i.test(name)) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      throw new LanzouError('TXT 不是有效的 UTF-8 编码，请转换编码后上传，避免导入乱码', 'invalid')
    }
  }
}
export async function downloadLanzouFile(file: SupplementaryFile, request = createLanzouRequest()): Promise<Uint8Array> {
  const pageUrl = checkedUrl(file.url, SHARE_DOMAINS).href
  const html = new TextDecoder().decode(await request(pageUrl))
  const frame = html.match(/<iframe\b[^>]*src=["']([^"']+)["']/)?.[1]
  if (!frame) throw new LanzouError('文件需要验证、已失效或暂不支持自动下载，请打开原文件手动下载', 'manual')
  const frameUrl = new URL(decodeHtml(frame), pageUrl).href
  const frameHtml = new TextDecoder().decode(await request(frameUrl))
  const api = variable(frameHtml, 'domain1') || frameHtml.match(/url\s*:\s*['"]([^'"]*ajaxm?\.php[^'"]*)['"]/)?.[1]
  if (!api) throw new LanzouError('暂时无法解析下载页面，请手动下载后上传', 'manual')
  const reply = await post(
    request,
    new URL(api, frameUrl).href,
    {
      action: 'downprocess',
      websignkey: variable(frameHtml, 'ajaxdata'),
      signs: variable(frameHtml, 'ajaxdata'),
      sign: variable(frameHtml, 'wp_sign'),
      websign: '',
      kd: '1',
      ves: '1',
    },
    frameUrl,
  )
  if (Number(reply.zt) !== 1 || typeof reply.dom !== 'string' || typeof reply.url !== 'string')
    throw new LanzouError('下载地址获取失败，请打开原文件手动下载', 'manual')
  const finalUrl = `${reply.dom}/file/${reply.url}`
  const bytes = await request(finalUrl, {}, MAX_FILE_BYTES)
  assertBookBytes(bytes, file.name)
  return bytes
}
