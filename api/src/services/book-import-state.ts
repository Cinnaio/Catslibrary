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
  const parsed = parseTextImportDetailed(run.source_text, run.source_label, {
    forceHeadings: overrides.filter((item) => item.verdict === 'heading').map((item) => item.line),
    denyHeadings: overrides.filter((item) => item.verdict === 'prose').map((item) => item.line),
    reviewedLines,
  })
  const payload = JSON.parse(run.payload_json || '{}')
  if (payload.coverImage) parsed.payload.coverImage = payload.coverImage
  return parsed
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
  const chars = (content: string) => content.replace(/\s/g, '').length
  const relatedRange = (result: TextImportResult, line: number) => {
    const ranges = result.chapterRanges || []
    const index = ranges.findIndex((range) => range.startLine <= line && range.endLine >= line)
    const range = ranges[index]
    return {
      start: range?.startLine === line ? ranges[index - 1]?.startLine || 1 : range?.startLine || 1,
      end: range?.endLine || Math.max(1, (ranges[0]?.startLine || lines.length + 1) - 1),
    }
  }
  const chaptersIn = (result: TextImportResult, start: number, end: number) =>
    (result.chapterRanges || []).flatMap((range, index) => {
      const chapter = result.payload.chapters[index]
      return chapter && range.startLine <= end && range.endLine >= start
        ? [{ title: chapter.title, chars: chars(chapter.content), content: chapter.content, startLine: range.startLine }]
        : []
    })
  return changes.map((item) => {
    const left = relatedRange(before, item.line),
      right = relatedRange(after, item.line)
    const start = Math.min(left.start, right.start),
      end = Math.max(left.end, right.end)
    const oldChapters = chaptersIn(before, start, end),
      newChapters = chaptersIn(after, start, end)
    const change: NonNullable<BookImportBoundaryImpact['change']> = {
      beforeRole: before.boundaryLines?.includes(item.line) ? 'heading' : 'prose',
      afterRole: after.boundaryLines?.includes(item.line) ? 'heading' : 'prose',
    }
    // 同一章才比较正文；拆分与合并通过相关章节列表解释，避免跨章比较误导。
    if (oldChapters.length === 1 && newChapters.length === 1 && oldChapters[0]!.startLine === newChapters[0]!.startLine) {
      const oldText = oldChapters[0]!.content,
        newText = newChapters[0]!.content
      let prefix = 0,
        suffix = 0
      while (prefix < oldText.length && prefix < newText.length && oldText[prefix] === newText[prefix]) prefix++
      while (
        suffix < oldText.length - prefix &&
        suffix < newText.length - prefix &&
        oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
      )
        suffix++
      const added = newText.slice(prefix, newText.length - suffix).trim(),
        removed = oldText.slice(prefix, oldText.length - suffix).trim()
      Object.assign(change, {
        addedText: added.slice(0, 400),
        removedText: removed.slice(0, 400),
        addedChars: chars(added),
        removedChars: chars(removed),
        textTruncated: added.length > 400 || removed.length > 400,
      })
    }
    return {
      line: item.line,
      raw: (lines[item.line - 1] || '').slice(0, 200),
      before: { ...chapterAt(before, item.line), chapters: oldChapters.map(({ title, chars }) => ({ title, chars })) },
      after: { ...chapterAt(after, item.line), chapters: newChapters.map(({ title, chars }) => ({ title, chars })) },
      context: lines
        .slice(Math.max(0, item.line - 3), item.line + 2)
        .map((raw, index) => ({ line: Math.max(1, item.line - 2) + index, raw: raw.slice(0, 240) })),
      change,
    }
  })
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
  await db.query(
    "UPDATE book_import_review_attempts SET status='failed', error='复核中断或租约已到期，请重新复核', completed_at=$1 WHERE status='running' AND created_at < $2",
    [now, now - IMPORT_REVIEW_LEASE_MS],
  )
  await db.query('DELETE FROM book_import_review_attempts WHERE created_at < $1', [now - 90 * 86400000])
  return result.rowCount || 0
}
