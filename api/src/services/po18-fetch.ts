import type { Db } from '../db/pool'
import type { FetchHtmlOptions, FetchResult } from './scraper/fetch'
import { assertPo18SessionPage, getPo18Session, mergeCookies, po18SessionResponseGuard, type Po18Session } from './source-account'
import { isPo18twUrl } from './po18-session-policy'

type HtmlFetcher = (url: string, opts?: FetchHtmlOptions) => Promise<FetchResult>

/** 搜索表单会合并响应 Cookie；保留这组 Cookie，并用起始会话版本保护失效写入。 */
export function guardPo18SessionFetch(db: Db, session: Po18Session, baseFetchHtml: HtmlFetcher): HtmlFetcher {
  return async (url, opts = {}) => {
    if (!isPo18twUrl(url)) throw new Error('PO18 会话只能用于 PO18 官方站点')
    const headers = new Headers(opts.headers)
    if (!headers.has('Cookie')) headers.set('Cookie', `po18Limit=1; ${session.cookie}`)
    const guard = po18SessionResponseGuard(db, { ...session, cookie: headers.get('Cookie') || '' })
    const result = await baseFetchHtml(url, {
      ...opts, headers, scope: opts.scope || 'source-auth', allowedRedirectHosts: ['po18.tw'],
      onResponse: async (response, currentUrl) => {
        await guard(response, currentUrl)
        await opts.onResponse?.(response, currentUrl)
      },
    })
    await assertPo18SessionPage(db, session, result.finalUrl || url, result.html)
    return result
  }
}

/** 导入、目录探测与正式抓取共用会话失效处理。每次读取数据库，旧进程缓存不复活失效令牌。 */
export function withPo18Session(db: Db, baseFetchHtml: HtmlFetcher): HtmlFetcher {
  return async (url, opts = {}) => {
    if (!isPo18twUrl(url)) return baseFetchHtml(url, opts)
    const session = await getPo18Session(db)
    const headers = new Headers(opts.headers)
    headers.set('Cookie', mergeCookies(headers.get('Cookie') || '', ['po18Limit=1', ...session.cookie.split(';').map(part => part.trim())]))
    return guardPo18SessionFetch(db, session, baseFetchHtml)(url, { ...opts, headers })
  }
}
