/**
 * 爬虫引擎 —— 由 Novel-KV _scrape-engine.js 平移。
 * 签名改为 runScrapeJob(jobId, deps)，通过 deps.store/fetchHtml/log 解耦
 * DB、网络与日志，不再依赖 env / Response / context.waitUntil。
 */
import { sleep } from './utils'
import type { FetchHtmlOptions, FetchResult } from './fetch'
import { cleanHtml, cleanText, cleanTitle, extractContent, extractLinkHref, extractLinks, extractText } from './parse'
import type { JobData, ScrapeLink, ScrapeStore } from './store'
import { simplifyChapterForSource } from '../zh-convert'
import { PO18TW_SELECTORS } from './presets'
import {
  isPo18twLoginPage,
  parsePo18twChapterContent,
  parsePo18twChapterLinks,
  po18ResponseProblem,
  po18ChapterContentUrl,
  po18ChapterListUrl,
  po18ChapterPageUrl,
} from './enrich'

export interface ScrapeDeps {
  store: ScrapeStore
  fetchHtml: (url: string, opts?: FetchHtmlOptions) => Promise<FetchResult>
  log: (job: JobData, message: string, level?: 'log' | 'warn' | 'error') => void
}

// ---------- 运行参数（可配置化；默认与自托管 Node 场景一致） ----------
export const SCRAPE_CONCURRENCY = Number(process.env.SCRAPE_CONCURRENCY || 3)
export const SCRAPE_MAX_RETRIES = Number(process.env.SCRAPE_MAX_RETRIES || 3)
export const SCRAPE_FETCH_TIMEOUT = Number(process.env.SCRAPE_FETCH_TIMEOUT || 12000)
export const SCRAPE_CHAPTER_DELAY = Number(process.env.SCRAPE_CHAPTER_DELAY || 300)
export const SCRAPE_MAX_CONSECUTIVE_FAILURES = 10
/** 选择器测试 / 章节预览时目录翻页上限，避免长目录书（数百页）串行抓爆耗时。 */
export const SCRAPE_MAX_LIST_PAGES = Number(process.env.SCRAPE_MAX_LIST_PAGES || 5)
/** POPO 目录没有可依赖的 nextPage 链接，正式抓取最多按页号探测。 */
export const SCRAPE_PO18_MAX_LIST_PAGES = Number(process.env.SCRAPE_PO18_MAX_LIST_PAGES || 200)
export const BATCH_SIZE = 10

function newChapterId(index: number): string {
  return 'ch_' + Date.now().toString(36) + '_' + index
}

function isPo18twSelectors(selectors: Record<string, string> | undefined): boolean {
  return selectors?.chapterList === PO18TW_SELECTORS.chapterList
}

async function collectPo18twLinks(
  firstHtml: string,
  chapterListUrl: string,
  encoding: string,
  deps: ScrapeDeps,
  maxPages: number,
): Promise<{ links: ScrapeLink[]; pages: number }> {
  if (isPo18twLoginPage(firstHtml)) throw new Error('POPO 目录需要登录，请先配置 POPO 账号或 Cookie')

  const first = parsePo18twChapterLinks(firstHtml, chapterListUrl)
  const links: ScrapeLink[] = [...first.links]
  const seen = new Set(links.map((link) => link.href))
  let pages = 0

  for (let page = 2; page <= Math.max(1, maxPages); page++) {
    const pageUrl = po18ChapterPageUrl(chapterListUrl, page)
    const next = await deps.fetchHtml(pageUrl, { forceEncoding: encoding })
    if (isPo18twLoginPage(next.html)) throw new Error('POPO 目录需要登录，请先配置 POPO 账号或 Cookie')
    const parsed = parsePo18twChapterLinks(next.html, pageUrl)
    if (parsed.rowCount === 0) break

    let added = 0
    for (const link of parsed.links) {
      if (seen.has(link.href)) continue
      seen.add(link.href)
      links.push(link)
      added++
    }
    pages++
    // 源站在超出最后一页时偶尔会重复返回最后一页，避免无限探测。
    if (added === 0) break
  }

  return { links, pages }
}

function po18ChapterFetchRequest(link: ScrapeLink, encoding: string, timeoutMs: number): { url: string; options: FetchHtmlOptions } {
  return {
    url: po18ChapterContentUrl(link.href),
    options: {
      forceEncoding: encoding,
      timeoutMs,
      headers: {
        Referer: link.href,
        'X-Requested-With': 'XMLHttpRequest',
      },
    },
  }
}

// ============================================================
// 选择器测试
// ============================================================
export async function testSelectors(
  sourceUrl: string,
  selectors: Record<string, string>,
  forceEncoding: string | undefined,
  deps: ScrapeDeps,
): Promise<Record<string, unknown>> {
  if (!sourceUrl || !selectors?.chapterList) {
    throw new Error('sourceUrl and selectors.chapterList are required')
  }

  const _t = { t0: Date.now(), fetchList: 0, pages: 0, total: 0 }
  const isPo18tw = isPo18twSelectors(selectors)
  const chapterListUrl = isPo18tw ? po18ChapterListUrl(sourceUrl) : sourceUrl
  const { html, encoding } = await deps.fetchHtml(chapterListUrl, { forceEncoding })
  _t.fetchList = Date.now() - _t.t0

  let allLinks: ScrapeLink[]
  if (isPo18tw) {
    const collected = await collectPo18twLinks(html, chapterListUrl, encoding, deps, SCRAPE_MAX_LIST_PAGES)
    allLinks = collected.links
    _t.pages = collected.pages
  } else {
    allLinks = extractLinks(html, selectors.chapterList, sourceUrl)
    if (selectors.nextPage && allLinks.length > 0) {
      let nextUrl = extractLinkHref(html, selectors.nextPage, sourceUrl)
      const seenPages = new Set([sourceUrl])
      while (nextUrl && nextUrl !== sourceUrl && !seenPages.has(nextUrl) && _t.pages < SCRAPE_MAX_LIST_PAGES) {
        seenPages.add(nextUrl)
        _t.pages++
        try {
          const next = await deps.fetchHtml(nextUrl, { forceEncoding: encoding })
          const moreLinks = extractLinks(next.html, selectors.chapterList, nextUrl)
          if (moreLinks.length === 0) break
          allLinks = allLinks.concat(moreLinks)
          nextUrl = extractLinkHref(next.html, selectors.nextPage, nextUrl)
        } catch {
          break
        }
      }
    }
  }
  _t.total = Date.now() - _t.t0

  const hrefSeen = new Set<string>()
  let duplicateCount = 0
  let emptyTitleCount = 0
  const uniqueLinks: ScrapeLink[] = []
  for (const link of allLinks) {
    if (hrefSeen.has(link.href)) {
      duplicateCount++
      continue
    }
    hrefSeen.add(link.href)
    if (!String(link.text || '').trim()) emptyTitleCount++
    uniqueLinks.push(link)
  }

  const sampleChapters: unknown[] = []
  const chapterTitleSel = selectors.chapterTitle
  const chapterContentSel = selectors.chapterContent
  if (chapterTitleSel && chapterContentSel) {
    const samples = await Promise.all(
      uniqueLinks.slice(0, 3).map(async (link) => {
        try {
          const request = isPo18tw ? po18ChapterFetchRequest(link, encoding, 8000) : { url: link.href, options: { forceEncoding: encoding, timeoutMs: 8000 } }
          const chapter = await deps.fetchHtml(request.url, request.options)
          const parsed = isPo18tw ? parsePo18twChapterContent(chapter.html, link.text || '') : null
          const title = parsed?.title || extractText(chapter.html, chapterTitleSel) || link.text || ''
          const rawContent = parsed?.content || extractContent(chapter.html, chapterContentSel)
          const cleanContent = cleanText(cleanHtml(rawContent || '').trim())
          return {
            title,
            url: link.href,
            rawLength: rawContent ? rawContent.length : 0,
            cleanLength: cleanContent ? cleanContent.length : 0,
            ok: cleanContent.replace(/\s/g, '').length >= 20,
          }
        } catch (err) {
          return { title: link.text || '', url: link.href, error: (err as Error).message, ok: false }
        }
      }),
    )
    sampleChapters.push(...samples)
  }

  return {
    timing: _t,
    links: uniqueLinks,
    totalLinks: uniqueLinks.length,
    encoding,
    diagnostics: {
      duplicateCount,
      emptyTitleCount,
      sampleLinks: uniqueLinks.slice(0, 20),
      htmlLength: html.length,
      nextPageCount: _t.pages,
    },
    sampleChapters,
  }
}

// ============================================================
// 抓取主流程
// ============================================================
export async function runScrapeJob(jobId: string, deps: ScrapeDeps): Promise<void> {
  const { store, log } = deps
  const job = await store.loadJob(jobId)
  if (!job) {
    try {
      await store.saveJob({
        id: jobId,
        status: 'failed',
        step: '无法加载任务数据',
        updatedAt: Date.now(),
      })
    } catch {
      /* ignore */
    }
    return
  }

  if (!job.updateMode && job.id.startsWith('upd_')) {
    job.updateMode = true
  }

  // 从 scrape_configs 补充 sourceUrl/selectors/encoding
  if (job.novelId) {
    const cfg = await store.getScrapeConfig(job.novelId)
    if (cfg) {
      job.sourceUrl = cfg.sourceUrl
      job.selectors = cfg.selectors
      job.encoding = cfg.encoding
    }
  }

  if (!job.sourceUrl) {
    log(job, '失败: 未找到源站 URL', 'warn')
    await updateStatus('failed', { step: '未找到源站 URL，请重新配置爬虫' })
    return
  }

  async function updateStatus(status: string, extra: Record<string, unknown> = {}): Promise<void> {
    Object.assign(job!, extra, { status, updatedAt: Date.now() })
    await store.saveJob(job!)
  }

  try {
    const isPo18tw = isPo18twSelectors(job.selectors)
    const chapterListUrl = isPo18tw ? po18ChapterListUrl(job.sourceUrl) : job.sourceUrl
    log(job, `开始${job.updateMode ? '增量更新' : '抓取'}: ${job.sourceUrl}`)
    await updateStatus('fetching_list', {
      step: '正在连接源站获取章节目录…',
      _debug: `请求: ${chapterListUrl}\n编码预设: ${job.encoding || '自动检测'}`,
    })

    let html: string
    let encoding: string
    let finalUrl = chapterListUrl
    try {
      const result = await deps.fetchHtml(chapterListUrl, { forceEncoding: job.encoding })
      html = result.html
      encoding = result.encoding
      finalUrl = result.finalUrl || chapterListUrl
      job.encoding = encoding
    } catch (err) {
      log(job, `连接源站失败: ${(err as Error).message}`, 'warn')
      await updateStatus('failed', {
        step: `无法连接源站: ${(err as Error).message}`,
        _debug: `请求: ${chapterListUrl}\n错误: ${(err as Error).message}`,
      })
      return
    }

    if (isPo18tw) {
      const problem = po18ResponseProblem(finalUrl, html)
      if (problem) {
        log(job, problem, 'warn')
        await store.appendJobLog(jobId, 'error', problem)
        await updateStatus('failed', {
          step: problem,
          _debug: `请求: ${chapterListUrl}\n最终 URL: ${finalUrl}\n页面长度: ${html.length} 字符`,
        })
        return
      }
    }

    log(job, `目录获取成功: 编码=${encoding} 页面=${html.length}字符`)
    await updateStatus('extracting_links', {
      step: '正在解析章节链接…',
      _debug: `获取成功\n编码: ${encoding}\n页面长度: ${html.length} 字符\n选择器: "${job.selectors?.chapterList}"`,
    })

    let links: ScrapeLink[]
    let extractMs = 0
    const extractStart = Date.now()
    if (job.retryLinks && Array.isArray(job.retryLinks) && job.retryLinks.length) {
      links = job.retryLinks.map((item) => ({ href: item.href || item.chapterUrl || '', text: item.text || item.chapterTitle || '' }))
      await store.appendJobLog(jobId, 'info', '重试失败章节模式：' + links.length + ' 章')
    } else if (isPo18tw) {
      const collected = await collectPo18twLinks(html, chapterListUrl, encoding, deps, SCRAPE_PO18_MAX_LIST_PAGES)
      links = collected.links
      extractMs = Date.now() - extractStart
      if (collected.pages > 0) log(job, `POPO 目录分页完成: 额外读取 ${collected.pages} 页`)
    } else {
      links = extractLinks(html, job.selectors?.chapterList || '', job.sourceUrl)
      extractMs = Date.now() - extractStart

      let pageCount = 0
      if (job.selectors?.nextPage && links.length > 0) {
        let nextUrl = extractLinkHref(html, job.selectors.nextPage, job.sourceUrl)
        const seenPages = new Set([job.sourceUrl])
        while (nextUrl && nextUrl !== job.sourceUrl && !seenPages.has(nextUrl)) {
          seenPages.add(nextUrl)
          pageCount++
          try {
            log(job, `读取目录分页 ${pageCount}: ${nextUrl}`)
            await sleep(800)
            const next = await deps.fetchHtml(nextUrl, { forceEncoding: encoding })
            const moreLinks = extractLinks(next.html, job.selectors.chapterList || '', nextUrl)
            if (moreLinks.length === 0) break
            links = links.concat(moreLinks)
            nextUrl = extractLinkHref(next.html, job.selectors.nextPage, nextUrl)
          } catch (e) {
            log(job, `目录分页 ${pageCount} 读取失败: ${(e as Error).message}`, 'warn')
            break
          }
        }
        if (pageCount) log(job, `目录分页完成: 额外读取 ${pageCount} 页`)
      }
    }

    if (links.length === 0) {
      const message = isPo18tw ? '未找到可抓取的 POPO 章节，可能需要先购买章节或重新配置账号' : '未找到任何章节链接，请检查章节列表选择器是否正确'
      log(job, `${message}: selector="${job.selectors?.chapterList}" (${extractMs}ms)`, 'warn')
      await updateStatus('failed', {
        step: message,
        hint: `选择器: "${job.selectors?.chapterList}" | 页面: ${html.length}字符 | 解析耗时: ${extractMs}ms`,
        _debug: `选择器: ${job.selectors?.chapterList}\n页面长度: ${html.length}\n解析耗时: ${extractMs}ms\n\n页面预览(前500字):\n${html.slice(0, 500)}`,
      })
      return
    }

    const originalLinkCount = links.length
    const seen = new Set<string>()
    links = links.filter((l) => {
      if (seen.has(l.href)) return false
      seen.add(l.href)
      return true
    })
    const duplicateCount = originalLinkCount - links.length

    if (job.retryLinks && Array.isArray(job.retryLinks) && job.retryLinks.length) {
      await store.appendJobLog(jobId, 'info', '重试章节去重完成：' + links.length + ' 章')
    } else {
      await store.appendJobLog(jobId, 'info', '目录解析完成：发现 ' + originalLinkCount + ' 条，去重 ' + duplicateCount + ' 条')
    }

    let newLinks = links
    if (!(job.retryLinks && Array.isArray(job.retryLinks) && job.retryLinks.length) && job.updateMode && job.novelId) {
      const existing = await store.getExistingChapterKeys(job.novelId)
      newLinks = links.filter((l) => {
        if (existing.urls.has(l.href)) return false
        if (existing.titles.has(l.text.trim())) return false
        return true
      })
      job.skippedCount = links.length - newLinks.length
    }

    job.total = newLinks.length
    await store.replaceJobItems(job.id, newLinks)
    const label = job.updateMode ? `发现 ${links.length} 章，其中 ${newLinks.length} 章为新章节 (${extractMs}ms)` : `共发现 ${links.length} 章 (${extractMs}ms)`
    log(job, label)
    await updateStatus('preflight', {
      step: '抓取前检查完成，准备抓取章节…',
      total: newLinks.length,
      current: 0,
      progress: 0.01,
      skippedCount: job.skippedCount || 0,
    })
    await store.appendJobLog(jobId, 'success', label)

    await updateStatus('scraping_chapters', {
      step: label,
      total: newLinks.length,
      current: 0,
      progress: 0.01,
      skippedCount: job.skippedCount || 0,
    })

    let count = 0
    const MAX_DEBUG = 50

    function addDebug(msg: string): void {
      const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`
      const prev = job!._debug ? job!._debug.split('\n') : []
      const next = prev.length >= MAX_DEBUG ? [...prev.slice(1 - MAX_DEBUG), line] : [...prev, line]
      job!._debug = next.join('\n')
    }

    let baseOrder = 0
    if (job.updateMode && job.novelId) {
      baseOrder = await store.getMaxChapterOrder(job.novelId)
    }

    const chapterBatch: Array<{ id: string; title: string; content: string; order: number; wordCount: number; sourceUrl: string; createdAt: number }> = []

    async function flushBatch(): Promise<void> {
      if (chapterBatch.length === 0) return
      const batch = chapterBatch.splice(0)
      try {
        await store.batchInsertChapters(job!.novelId!, batch)
        addDebug(`批量保存 ${batch.length} 章`)
        log(job!, `批量保存 ${batch.length} 章，累计成功 ${count} 章`)
      } catch (err) {
        addDebug(`批量保存失败: ${(err as Error).message}`)
        log(job!, `批量保存失败: ${(err as Error).message}`, 'warn')
      }
    }

    const scrapeLinks = newLinks
    const displayTotal = scrapeLinks.length
    const isCF = !job.localMode
    const queue = scrapeLinks.map((link, i) => ({ link, i }))
    let completedCount = 0
    let cancelled = false
    let consecutiveFailures = 0
    let firstFailureReason = ''

    async function chapterWorker(): Promise<void> {
      while (queue.length > 0 && !cancelled) {
        if (!isCF || (completedCount > 0 && completedCount % 10 === 0)) {
          try {
            const current = await store.loadJob(jobId)
            if (current && current.status === 'cancelled') {
              cancelled = true
              break
            }
          } catch {
            /* ignore */
          }
        }

        if (cancelled) break

        const { link, i } = queue.shift()!

        await store.updateJobItem(jobId, link.href, { status: 'running', startedAt: Date.now(), retryCount: 0 })
        addDebug(`Ch${i + 1}: 请求 ${link.href}`)

        let chHtml = ''
        let fetchEncoding = ''
        let chFinalUrl = ''
        const maxAttempts = isCF ? SCRAPE_MAX_RETRIES : 1
        let lastErr: Error | null = null

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          try {
            const timeout = isCF ? SCRAPE_FETCH_TIMEOUT : 28000
            const request = isPo18tw
              ? po18ChapterFetchRequest(link, encoding, timeout)
              : { url: link.href, options: { forceEncoding: encoding, timeoutMs: timeout } }
            const result = await deps.fetchHtml(request.url, request.options)
            chHtml = result.html
            fetchEncoding = result.encoding
            chFinalUrl = result.finalUrl || request.url
            lastErr = null
            break
          } catch (ferr) {
            lastErr = ferr as Error
            if (attempt < maxAttempts - 1) {
              const backoff = Math.pow(2, attempt) * 1000
              const errMsg = (ferr as Error).message
              await store.updateJobItem(jobId, link.href, { retryCount: attempt + 1, error: errMsg })
              await store.appendJobLog(jobId, 'warn', `Ch${i + 1}: 第${attempt + 1}次失败，${backoff / 1000}s 后重试`, errMsg)
              addDebug(`Ch${i + 1}: 第${attempt + 1}次失败，${backoff / 1000}s 后重试`)
              log(job!, `Ch${i + 1} 第${attempt + 1}次失败，${backoff / 1000}s 后重试: ${errMsg}`, 'warn')
              await sleep(backoff)
            }
          }
        }

        if (lastErr) {
          if (!firstFailureReason) firstFailureReason = lastErr.message
          await store.updateJobItem(jobId, link.href, { status: 'failed', error: lastErr.message, finishedAt: Date.now(), retryCount: maxAttempts })
          await store.appendJobLog(jobId, 'error', `Ch${i + 1}: 获取失败`, lastErr.message)
          addDebug(`Ch${i + 1}: 获取失败 (${SCRAPE_MAX_RETRIES}次重试后) - ${lastErr.message}`)
          log(job!, `Ch${i + 1} 获取失败: ${lastErr.message}`, 'warn')
          consecutiveFailures++
          if (isCF && consecutiveFailures >= SCRAPE_MAX_CONSECUTIVE_FAILURES) {
            addDebug(`连续 ${SCRAPE_MAX_CONSECUTIVE_FAILURES} 章失败，终止抓取（源站可能已限流或离线）`)
            log(job!, `连续 ${SCRAPE_MAX_CONSECUTIVE_FAILURES} 章失败，终止抓取`, 'error')
            cancelled = true
            break
          }
          completedCount++
          continue
        }
        consecutiveFailures = 0

        try {
          if (isPo18tw) {
            const problem = po18ResponseProblem(chFinalUrl, chHtml)
            if (problem) throw new Error(problem)
          }
          const parsed = isPo18tw ? parsePo18twChapterContent(chHtml, link.text || '') : null
          const title = parsed?.title || extractText(chHtml, job!.selectors?.chapterTitle || '') || link.text || `第${i + 1}章`
          const rawContent = parsed?.content || extractContent(chHtml, job!.selectors?.chapterContent || '')
          const contentLen = rawContent ? rawContent.trim().length : 0

          addDebug(`Ch${i + 1}: 标题="${title.slice(0, 30)}" 内容长度=${contentLen} 编码=${fetchEncoding}`)

          if (rawContent && contentLen > 50) {
            const cleanContentResult = cleanText(cleanHtml(rawContent).trim())
            if (cleanContentResult.replace(/\s/g, '').length < 20) {
              await store.updateJobItem(jobId, link.href, {
                status: 'skipped',
                chapterTitle: cleanTitle(title).trim(),
                error: '清洗后仅剩广告文本',
                finishedAt: Date.now(),
              })
              addDebug(`Ch${i + 1}: 清洗后仅剩广告文本，跳过`)
              completedCount++
              continue
            }
            const wordCount = cleanContentResult.replace(/\s/g, '').length
            addDebug(`Ch${i + 1}: 清洗后字数=${wordCount}，加入批量队列`)

            const chapterOrder = baseOrder + i + 1
            const chapter = simplifyChapterForSource(
              {
                id: newChapterId(i),
                novelId: job!.novelId || '',
                title: cleanTitle(title).trim(),
                content: cleanContentResult,
                order: chapterOrder,
                wordCount,
                sourceUrl: link.href,
                createdAt: Date.now(),
              },
              link.href,
            ) as { id: string; title: string; content: string; order: number; wordCount: number; sourceUrl: string; createdAt: number; novelId: string }
            chapterBatch.push({
              id: chapter.id,
              title: chapter.title,
              content: chapter.content,
              order: chapter.order,
              wordCount: chapter.wordCount,
              sourceUrl: chapter.sourceUrl,
              createdAt: chapter.createdAt,
            })
            count++
            await store.updateJobItem(jobId, link.href, { status: 'saved', chapterTitle: chapter.title, wordCount, finishedAt: Date.now(), error: '' })
          } else {
            await store.updateJobItem(jobId, link.href, { status: 'failed', error: `内容太短 (${contentLen}字)`, finishedAt: Date.now() })
            addDebug(`Ch${i + 1}: 内容太短 (${contentLen}字)，跳过`)
          }
        } catch (err) {
          const errorMessage = (err as Error).message
          if (!firstFailureReason) firstFailureReason = errorMessage
          await store.updateJobItem(jobId, link.href, { status: 'failed', error: errorMessage, finishedAt: Date.now() })
          await store.appendJobLog(jobId, 'error', `Ch${i + 1}: 异常`, errorMessage)
          addDebug(`Ch${i + 1}: 异常 - ${errorMessage}`)
        }

        completedCount++

        if (chapterBatch.length >= BATCH_SIZE) {
          await flushBatch()
        }

        if (completedCount % 5 === 0 || completedCount === displayTotal) {
          job!.current = completedCount
          job!.progress = displayTotal ? completedCount / displayTotal : 1
          job!.chapterCount = count
          job!.status = 'scraping_chapters'
          log(job!, `进度 ${completedCount}/${displayTotal}，成功 ${count} 章`)
          // 条件更新（不整行 upsert）：避免冲掉外部写入的 cancelled；
          // 写入失败即任务已被取消，立即停止，比 10 章一次的轮询更快响应
          const alive = await store.updateJobProgress(jobId, {
            step: `第${completedCount}/${displayTotal}章 | 成功${count}章`,
            current: completedCount,
            chapterCount: count,
            progress: job!.progress || 0,
          })
          if (!alive) {
            cancelled = true
            break
          }
        }

        if (isCF && queue.length > 0) {
          await sleep(SCRAPE_CHAPTER_DELAY)
        }
      }
    }

    const workers = Array.from({ length: SCRAPE_CONCURRENCY }, () => chapterWorker())
    await Promise.all(workers)

    await flushBatch()

    if (cancelled) {
      log(job, `任务已终止，成功 ${count} 章`, 'warn')
      await updateStatus('cancelled', { step: '任务已终止', chapterCount: count })
      return
    }

    const summary = await store.getJobSummary(jobId)
    const finalStatus =
      summary.failedCount > 0 && summary.successCount > 0 ? 'partial' : summary.failedCount > 0 && summary.successCount === 0 ? 'failed' : 'completed'
    const failureDetail = firstFailureReason ? `；首个失败原因：${firstFailureReason}` : ''
    const finalStep =
      finalStatus === 'partial'
        ? `部分完成：成功 ${summary.successCount}，失败 ${summary.failedCount}，跳过 ${summary.skippedCount}${failureDetail}`
        : finalStatus === 'failed'
          ? `抓取失败：失败 ${summary.failedCount}，跳过 ${summary.skippedCount}${failureDetail}`
          : '抓取完成'
    const finalLog = finalStatus === 'completed' ? `抓取完成，成功 ${summary.successCount} 章` : `抓取结束：${finalStep}`
    const finalLevel = finalStatus === 'completed' ? 'log' : finalStatus === 'partial' ? 'warn' : 'error'
    log(job, finalLog, finalLevel)
    await store.appendJobLog(jobId, finalStatus === 'completed' ? 'success' : finalStatus === 'partial' ? 'warn' : 'error', finalStep)
    await updateStatus(finalStatus, { progress: 1, chapterCount: count, step: finalStep })
  } catch (err) {
    log(job, `发生错误: ${(err as Error).message}`, 'error')
    await updateStatus('failed', { error: (err as Error).message, step: `发生错误: ${(err as Error).message}` })
  }
}
