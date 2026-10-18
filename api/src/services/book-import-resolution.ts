import type { BookImportChapterResolution, BookImportPayload, BookImportPreview } from '@shared/types'
import type { Db } from '../db/pool'
import { withTx } from '../db/query'
import { buildChapterDiff, importResolutionSnapshot, resolvedChapterDiffs, type ChapterRow, type StoredImportRun } from './book-import'
import { checkImportRevision, importHistorySummary, IMPORT_REVIEW_LEASE_MS } from './book-import-state'

/** 人工确认只改预览，所有章节写入仍走提交事务。 */
export async function resolveImportChapter(
  db: Db,
  opts: { runId: string; actorUserId: string; revision: unknown; chapterId: unknown; action: unknown; localChapterId?: unknown; afterChapterId?: unknown },
): Promise<BookImportPreview> {
  return withTx(db, async (q) => {
    const run = (
      await q<StoredImportRun & { review_token?: string; review_started_at?: number }>(
        'SELECT * FROM book_import_runs WHERE id=$1 AND actor_user_id=$2 FOR UPDATE',
        [opts.runId, opts.actorUserId],
      )
    ).rows[0]
    if (!run) throw new Error('导入预览不存在')
    if (run.status !== 'preview') throw new Error('这次导入已经提交，不能修改确认结果')
    checkImportRevision(run, opts.revision)
    if (run.review_token && Date.now() - Number(run.review_started_at) < IMPORT_REVIEW_LEASE_MS) throw new Error('章节正在处理中，请完成复核后再确认对应关系')
    if (!run.target_novel_id) throw new Error('请先选择已有作品，再核对章节对应关系')
    if (!(await q('SELECT id FROM novels WHERE id=$1 FOR UPDATE', [run.target_novel_id])).rows.length) throw new Error('导入目标不存在')
    const local = (
      await q<ChapterRow>('SELECT id,title,sort_order,content,source_url FROM chapters WHERE novel_id=$1 ORDER BY sort_order,id FOR UPDATE', [
        run.target_novel_id,
      ])
    ).rows
    const previous = JSON.parse(run.preview_json) as BookImportPreview
    const snapshot = importResolutionSnapshot(local)
    if (previous.resolutionSnapshot && previous.resolutionSnapshot !== snapshot) throw new Error('本地章节已变化，请重新生成预览后核对')
    const book = JSON.parse(run.payload_json) as BookImportPayload
    const base = buildChapterDiff(book, local, { preserveLocalOrder: !!run.supplementary_binding_id })
    if (
      typeof opts.chapterId !== 'string' ||
      !base.some((c) => c.id === opts.chapterId && (c.status === 'conflict' || previous.chapterResolutions?.some((r) => r.chapterId === c.id)))
    )
      throw new Error('请选择有效的需确认章节')
    const resolutions = (previous.chapterResolutions || []).filter((item) => item.chapterId !== opts.chapterId)
    let resolution: BookImportChapterResolution | undefined
    if (opts.action === 'match' && typeof opts.localChapterId === 'string')
      resolution = { chapterId: opts.chapterId, action: 'match', localChapterId: opts.localChapterId }
    else if (opts.action === 'insert' && (opts.afterChapterId === null || typeof opts.afterChapterId === 'string'))
      resolution = { chapterId: opts.chapterId, action: 'insert', afterChapterId: opts.afterChapterId }
    else if (opts.action !== 'clear') throw new Error('请选择有效的章节处理方式及位置')
    if (resolution) resolutions.push(resolution)
    const chapters = resolvedChapterDiffs(base, local, resolutions)
    const next: BookImportPreview = {
      ...previous,
      chapters,
      chapterResolutions: resolutions,
      resolutionSnapshot: resolutions.length ? snapshot : undefined,
      localChapters: local.map((c) => ({ id: c.id, title: c.title, order: c.sort_order })),
      revision: Number(run.revision || 0) + 1,
      summary: {
        newCount: chapters.filter((c) => c.status === 'new').length,
        changedCount: chapters.filter((c) => c.status === 'changed').length,
        unchangedCount: chapters.filter((c) => c.status === 'unchanged').length,
        conflictCount: chapters.filter((c) => c.status === 'conflict').length,
      },
    }
    next.warnings = next.warnings.filter((message) => !/^有 \d+ 个章节存在对应关系冲突/.test(message))
    if (next.summary.conflictCount) next.warnings.push(`有 ${next.summary.conflictCount} 个章节存在对应关系冲突，默认不会导入。`)
    await q('UPDATE book_import_runs SET preview_json=$1,revision=revision+1,history_summary=$2 WHERE id=$3', [
      JSON.stringify(next),
      importHistorySummary(next),
      run.id,
    ])
    return next
  })
}
