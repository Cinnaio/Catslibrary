import { getPendingChapterCounts } from './novel-update-summary'
import type { Db } from '../db/pool'
import { all, first, withTx } from '../db/query'
import { newId } from './auth'

interface FollowupRow {
  novel_id: string
  enabled: boolean
  interval_hours: number
  next_check_at: number
  checked_at: number
  last_job_id: string
  result: string
  message: string
  added_count: number
  empty_checks: number
  failures: number
}
const terminal = ['completed', 'partial', 'failed', 'cancelled']

export async function getFollowup(db: Db, novelId: string) {
  const novel = await first<{ status: string; chapter_count: number; remote_chapter_count: number }>(
    db,
    'SELECT status,chapter_count,remote_chapter_count FROM novels WHERE id=$1',
    [novelId],
  )
  if (!novel) return null
  const row = await first<FollowupRow>(db, 'SELECT * FROM novel_followups WHERE novel_id=$1', [novelId])
  const config = await first(db, 'SELECT novel_id FROM scrape_configs WHERE novel_id=$1', [novelId])
  const active = await first<{ id: string; step: string }>(
    db,
    `SELECT id,step FROM scrape_jobs WHERE novel_id=$1
    AND status NOT IN ('completed','partial','failed','cancelled') LIMIT 1`,
    [novelId],
  )
  return {
    chapterCount: novel.chapter_count,
    remoteChapterCount: novel.remote_chapter_count,
    enabled: row?.enabled || false,
    intervalHours: row?.interval_hours || 6,
    nextCheckAt: novel.status === 'ongoing' && row?.enabled ? Number(row.next_check_at) : 0,
    checkedAt: Number(row?.checked_at || 0),
    result: active ? 'running' : row?.result || 'idle',
    message: active ? active.step || '正在检查目录并抓取新章节…' : row?.message || '',
    addedCount: row?.added_count || 0,
    jobId: active?.id || row?.last_job_id || '',
    hasConfig: Boolean(config),
    ...(await getPendingChapterCounts(db, [novelId])).get(novelId),
    ongoing: novel.status === 'ongoing',
  }
}

export async function saveFollowup(db: Db, novelId: string, enabled: boolean, hours: number) {
  if (![1, 3, 6, 12, 24].includes(hours)) throw new Error('检查频率无效')
  const state = await getFollowup(db, novelId)
  if (!state) throw new Error('小说不存在')
  if (enabled && (!state.hasConfig || !state.ongoing)) throw new Error('只有已配置爬虫的连载小说可以开启自动追更')
  await db.query(
    `INSERT INTO novel_followups (novel_id,enabled,interval_hours,next_check_at) VALUES ($1,$2,$3,$4)
    ON CONFLICT (novel_id) DO UPDATE SET enabled=$2,interval_hours=$3,next_check_at=$4`,
    [novelId, enabled, hours, enabled ? Date.now() + hours * 3600000 : 0],
  )
}

/** 小说行锁序列化手动和定时更新，任务创建与下次调度在同一事务提交。 */
export async function enqueueFollowup(db: Db, novelId: string, dueOnly = false) {
  return withTx(db, async (q) => {
    const novel = (await q<{ status: string }>('SELECT status FROM novels WHERE id=$1 FOR UPDATE', [novelId])).rows[0]
    if (!novel) throw new Error('小说不存在')
    const now = Date.now()
    if (dueOnly) {
      const follow = (await q<FollowupRow>('SELECT * FROM novel_followups WHERE novel_id=$1', [novelId])).rows[0]
      if (!follow?.enabled || novel.status !== 'ongoing' || Number(follow.next_check_at) > now) return { jobId: '', started: false }
    }
    const active = (
      await q<{ id: string }>(`SELECT id FROM scrape_jobs WHERE novel_id=$1 AND status NOT IN ('completed','partial','failed','cancelled') LIMIT 1`, [novelId])
    ).rows[0]
    if (active) return { jobId: active.id, started: false }
    const cfg = (await q<{ selectors: string }>('SELECT selectors FROM scrape_configs WHERE novel_id=$1', [novelId])).rows[0]
    if (!cfg) throw new Error('未找到该小说的爬虫配置，请先配置爬虫')
    const selectors = JSON.parse(cfg.selectors)
    if (!selectors.chapterList || !selectors.chapterContent) throw new Error('爬虫配置缺少目录或正文选择器')
    const jobId = newId('upd')
    await q(`INSERT INTO scrape_jobs (id,novel_id,status,update_mode,started_at,updated_at) VALUES ($1,$2,'starting',1,$3,$3)`, [jobId, novelId, now])
    await q(
      `INSERT INTO novel_followups (novel_id,last_job_id,result,message,next_check_at)
      VALUES ($1,$2,'running','正在检查目录并抓取新章节…',$3)
      ON CONFLICT (novel_id) DO UPDATE SET last_job_id=$2,result='running',message='正在检查目录并抓取新章节…',
      next_check_at=CASE WHEN novel_followups.enabled THEN $3::bigint + novel_followups.interval_hours * 3600000::bigint ELSE 0 END`,
      [novelId, jobId, now],
    )
    return { jobId, started: true }
  })
}

export function followupDelay(hours: number, emptyChecks: number, failures: number) {
  // 连续无更新后逐步降频，最长七天；错误重试从十五分钟开始退避。
  return failures > 0
    ? Math.min(hours * 3600000, 900000 * 2 ** Math.min(failures - 1, 6))
    : Math.min(7 * 86400000, hours * 3600000 * 2 ** Math.min(Math.floor(emptyChecks / 7), 5))
}

export async function finishFollowup(db: Db, jobId: string) {
  const job = await first<{ status: string; chapter_count: number; error: string; step: string }>(
    db,
    'SELECT status,chapter_count,error,step FROM scrape_jobs WHERE id=$1',
    [jobId],
  )
  if (!job || !terminal.includes(job.status)) return
  await withTx(db, async (q) => {
    const row = (await q<FollowupRow>("SELECT * FROM novel_followups WHERE last_job_id=$1 AND result='running' FOR UPDATE", [jobId])).rows[0]
    if (!row) return
    const added = Number(job.chapter_count || 0)
    const failed = job.status === 'failed' || job.status === 'partial'
    const cancelled = job.status === 'cancelled'
    const failures = failed ? row.failures + 1 : 0
    const empty = failed || cancelled ? row.empty_checks : added ? 0 : row.empty_checks + 1
    const pending = (await getPendingChapterCounts({ query: q }, [row.novel_id])).get(row.novel_id)
    const protectedCount = pending?.pendingProtectedChapterCount || 0
    const protectionOnly = protectedCount > 0 && protectedCount === pending?.pendingChapterCount
    const unresolved = !failed && !cancelled && !added && (pending?.pendingChapterCount || 0) > 0
    const result =
      unresolved && !protectionOnly
        ? 'pending'
        : !failed && !cancelled && !added && protectionOnly
          ? 'protected'
          : failed
            ? job.status
            : cancelled
              ? 'cancelled'
              : added
                ? 'updated'
                : 'no_change'
    const message =
      unresolved && !protectionOnly
        ? `仍有 ${pending?.pendingChapterCount} 章待更新，保护状态待检查`
        : !failed && !cancelled && !added && protectionOnly
          ? `仍有 ${protectedCount} 章受保护，请确认账号或购买权限`
          : failed
            ? job.error || job.step || '更新失败'
            : cancelled
              ? '更新已取消'
              : added
                ? `已新增 ${added} 章`
                : '暂无新章'
    const now = Date.now()
    await q(
      `UPDATE novel_followups SET result=$2,message=$3,added_count=$4,checked_at=$5,empty_checks=$6,failures=$7,
      next_check_at=CASE WHEN enabled THEN $8::bigint ELSE 0 END WHERE novel_id=$1`,
      [row.novel_id, result, message, added, now, empty, failures, now + followupDelay(row.interval_hours, empty, failures)],
    )
  })
}

export async function runFollowupTick(db: Db, startJob: (jobId: string) => void) {
  // 进程中断后只回收长期没有心跳的追更任务；未完成抓取下次按章节链接补齐。
  await db.query(
    `UPDATE scrape_jobs SET status='failed',error='更新任务长时间无进度，稍后自动重试',updated_at=$1
    WHERE status NOT IN ('completed','partial','failed','cancelled') AND updated_at<$2
    AND id IN (SELECT last_job_id FROM novel_followups WHERE result='running')`,
    [Date.now(), Date.now() - 30 * 60000],
  )
  await db.query(
    `UPDATE novel_followups SET result='failed',message='更新任务记录已清理，请重新检查',checked_at=$1,
    next_check_at=CASE WHEN enabled THEN $1::bigint + 3600000 ELSE 0 END
    WHERE result='running' AND NOT EXISTS (SELECT 1 FROM scrape_jobs WHERE id=last_job_id)`,
    [Date.now()],
  )
  const unfinished = await all<{ last_job_id: string }>(db, "SELECT last_job_id FROM novel_followups WHERE result='running'")
  for (const row of unfinished) await finishFollowup(db, row.last_job_id)
  const active = await first<{ count: number }>(
    db,
    `SELECT COUNT(*)::integer AS count FROM scrape_jobs
    WHERE status NOT IN ('completed','partial','failed','cancelled') AND local_mode=0`,
  )
  const capacity = Math.max(0, 3 - Number(active?.count || 0))
  if (!capacity) return
  const due = await all<{ novel_id: string }>(
    db,
    `SELECT f.novel_id FROM novel_followups f JOIN novels n ON n.id=f.novel_id
    WHERE f.enabled AND n.status='ongoing' AND f.next_check_at<=$1
    AND NOT EXISTS (SELECT 1 FROM scrape_jobs j WHERE j.novel_id=f.novel_id AND j.status NOT IN ('completed','partial','failed','cancelled'))
    ORDER BY f.next_check_at LIMIT $2`,
    [Date.now(), capacity],
  )
  for (const row of due) {
    try {
      const result = await enqueueFollowup(db, row.novel_id, true)
      if (result.started) startJob(result.jobId)
    } catch (err) {
      await db.query(`UPDATE novel_followups SET result='failed',message=$2,checked_at=$3,next_check_at=$4 WHERE novel_id=$1`, [
        row.novel_id,
        (err as Error).message,
        Date.now(),
        Date.now() + 3600000,
      ])
    }
  }
}
