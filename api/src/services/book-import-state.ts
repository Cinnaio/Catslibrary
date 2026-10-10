import type { BookImportBoundaryImpact, BookImportBoundaryOverride, BookImportPreview } from '@shared/types'
import type { Db } from '../db/pool'
import { parseTextImportDetailed, type StoredImportRun, type TextImportResult } from './book-import'

export const IMPORT_PREVIEW_RETENTION_MS = 7 * 86400000
export const IMPORT_REVIEW_LEASE_MS = 10 * 60000

export function checkImportRevision(run: StoredImportRun, revision: unknown): void {
  if (Number(run.source_expires_at) > 0 && Number(run.source_expires_at) <= Date.now()) throw new Error('预览已过期，请重新上传生成预览')
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision !== Number(run.revision || 0)) {
    throw new Error('预览版本已变化或未提供版本，请重新预览后操作')
  }
}

export function mergeBoundaryOverrides(existing: BookImportBoundaryOverride[], changes: BookImportBoundaryOverride[]): BookImportBoundaryOverride[] {
  const merged = new Map(existing.map((item) => [item.line, item]))
  for (const item of changes) merged.set(item.line, item)
  return [...merged.values()].sort((a, b) => a.line - b.line)
}

export function resplitImport(run: StoredImportRun, overrides: BookImportBoundaryOverride[], reviewedLines: number[] = []): TextImportResult {
  if (!run.source_text || (Number(run.source_expires_at) > 0 && Number(run.source_expires_at) <= Date.now())) {
    throw new Error('原文快照已过期或不可用，请重新上传生成预览')
  }
  return parseTextImportDetailed(run.source_text, run.source_label, {
    forceHeadings: overrides.filter((item) => item.verdict === 'heading').map((item) => item.line),
    denyHeadings: overrides.filter((item) => item.verdict === 'prose').map((item) => item.line),
    reviewedLines,
  })
}

export function boundaryImpacts(
  run: StoredImportRun,
  existing: BookImportBoundaryOverride[],
  changes: BookImportBoundaryOverride[],
): BookImportBoundaryImpact[] {
  const before = resplitImport(run, existing)
  const after = resplitImport(run, mergeBoundaryOverrides(existing, changes))
  const lines = run.source_text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
  const chapterAt = (result: TextImportResult, line: number) => {
    const index = result.chapterRanges?.findIndex((range) => range.startLine <= line && range.endLine >= line) ?? -1
    const chapter = result.payload.chapters[index]
    const content = chapter?.content || (index < 0 ? result.frontMatterContent || '' : '')
    const position = content.indexOf((lines[line - 1] || '').trim())
    const start = position >= 0 ? Math.max(0, position - 60) : 0
    return { title: chapter?.title || '前置信息', chars: content.replace(/\s/g, '').length, excerpt: content.slice(start, start + 160).trim() }
  }
  return changes.map((item) => ({
    line: item.line,
    raw: (lines[item.line - 1] || '').slice(0, 200),
    before: chapterAt(before, item.line),
    after: chapterAt(after, item.line),
  }))
}

export function importHistorySummary(preview: BookImportPreview): string {
  return JSON.stringify({ title: preview.book.title, conflicts: preview.summary.conflictCount, created: 0, updated: 0 })
}

/** 仅清理解析快照，回滚所需 changes_json 永远保留。未提交预览过期后不可继续提交。 */
export async function pruneImportSnapshots(db: Db, now = Date.now()): Promise<number> {
  const result = await db.query(
    `UPDATE book_import_runs
    SET source_text='', payload_json='{}', preview_json='{}', source_expires_at=0,
        status=CASE WHEN status='preview' THEN 'expired' ELSE status END,
        revision=revision+1, review_token='', review_started_at=0
    WHERE source_expires_at > 0 AND source_expires_at <= $1
      AND (review_token='' OR review_started_at < $2)`,
    [now, now - IMPORT_REVIEW_LEASE_MS],
  )
  await db.query("UPDATE book_import_review_attempts SET status='failed', error='复核中断或租约已到期，请重新复核', completed_at=$1 WHERE status='running' AND created_at < $2", [now, now - IMPORT_REVIEW_LEASE_MS])
  await db.query('DELETE FROM book_import_review_attempts WHERE created_at < $1', [now - 90 * 86400000])
  return result.rowCount || 0
}
