import { getDb } from '../../db/pool'
import { fetchHtml as fetchHtmlImpl, type FetchHtmlOptions } from './fetch'
import { runScrapeJob, type ScrapeDeps } from './engine'
import { PgScrapeStore } from './store'
import { withPo18Session } from '../po18-fetch'
import { finishFollowup } from '../novel-followup'

export { withPo18Session } from '../po18-fetch'

export function makeDeps(db: ReturnType<typeof getDb>): ScrapeDeps {
  const store = new PgScrapeStore(db)
  return {
    store,
    fetchHtml: (url: string, opts?: FetchHtmlOptions) => fetchHtmlImpl(url, opts),
    log: (job, message, level) => {
      const id = job?.id || 'unknown'
      const novel = job?.novelId ? ` ${job.novelId}` : ''
      if (level === 'error') console.error(`[scrape] ${id}${novel} ${message}`)
      else if (level === 'warn') console.warn(`[scrape] ${id}${novel} ${message}`)
      else console.log(`[scrape] ${id}${novel} ${message}`)
    },
  }
}

export function fireJob(jobId: string, deps: ScrapeDeps, db: ReturnType<typeof getDb>): void {
  // 异步执行，完成后持久化追更结果；中断任务由定时调度回收。
  const jobDeps = { ...deps, fetchHtml: withPo18Session(db, deps.fetchHtml) }
  void runScrapeJob(jobId, jobDeps)
    .catch(async (err) => {
      const store = deps.store
      const j = await store.loadJob(jobId)
      if (j) {
        j.status = 'failed'
        j.error = (err as Error).message
        await store.saveJob(j, true)
      }
    })
    .finally(() => finishFollowup(db, jobId))
    .catch((err) => console.error('[followup] result persistence failed:', err))
}
