import { createHash } from 'node:crypto'
import type { BookImportPreview } from '@shared/types'
import type { SupplementaryFile, SupplementaryUpdateMode, SupplementaryUpdateResult } from '@shared/supplementary-source'
import type { Db, DbClient } from '../db/pool'
import { all, first, withTx } from '../db/query'
import {
  applyImport, createPreview, parseUploadedBookDetailed, planSupplementaryAppend, supplementaryChapterNeedsReview,
  SupplementaryAppendNeedsReview, type StoredImportRun,
} from './book-import'
import { storeImportPreview } from './book-import-state'
import { downloadLanzouFile, identityKey, LanzouError } from './lanzou'
import { bindingCandidates, sourceFiles } from './supplementary-source'

type UpdateOutcome = Omit<SupplementaryUpdateResult, 'checkedAt'> & { fileVersion?: string }
interface ClaimedBinding {
  id: string
  novel_id: string
  alias_title: string
  alias_author: string
  update_mode: SupplementaryUpdateMode
  update_lease_until: number
  update_result: (UpdateOutcome & { checkedAt: number }) | null
  scan_at: number
  files_json: string
}
interface PriorImport {
  id: string
  status: string
  supplementary_auto_pending: boolean
  rolled_back_at: number
  added_count: number
}

const eligibleScan = `b.update_mode<>'manual' AND s.enabled AND s.status='ok'
  AND s.checked_at>b.update_scan_at AND s.checking_until<=$1 AND b.update_lease_until<=$1`
const leaseDuration = 5 * 60_000

function fileVersion(file: SupplementaryFile) {
  return createHash('sha256').update(JSON.stringify([file.key, file.url, file.name, file.size, file.revision])).digest('hex')
}

async function priorImport(db: DbClient, binding: ClaimedBinding, version: string, hash = '') {
  return first<PriorImport>(db,
    `SELECT id,status,supplementary_auto_pending,rolled_back_at,(history_summary::jsonb->>'created')::integer AS added_count
     FROM book_import_runs WHERE target_novel_id=$1 AND supplementary_auto_hash<>''
       AND ((supplementary_binding_id=$2 AND supplementary_auto_file_version=$3) OR supplementary_auto_hash=$4)
       AND (status IN ('applied','partial','rolled_back') OR (supplementary_binding_id=$2 AND status='preview' AND source_expires_at>$5))
     ORDER BY (rolled_back_at>0) DESC,(status<>'preview') DESC,created_at DESC,id LIMIT 1`,
    [binding.novel_id, binding.id, version, hash, Date.now()],
  )
}

async function settleImport(db: Db, binding: ClaimedBinding, prior: PriorImport, file: SupplementaryFile): Promise<UpdateOutcome> {
  if (Number(prior.rolled_back_at) > 0) return { status: 'rolled-back', fileName: file.name }
  if (prior.status !== 'preview') {
    const addedCount = Number(prior.added_count) || 0
    return { status: addedCount ? 'added' : 'unchanged', addedCount, fileName: file.name, runId: prior.id }
  }
  const review = {
    status: 'review', fileName: file.name, runId: prior.id,
    ...(binding.update_result?.runId === prior.id ? { message: binding.update_result.message } : {}),
  } as const
  if (!prior.supplementary_auto_pending || binding.update_mode !== 'append') return review
  const run = await first<StoredImportRun>(db, 'SELECT * FROM book_import_runs WHERE id=$1', [prior.id])
  if (!run || run.status !== 'preview') return review
  const preview = JSON.parse(run.preview_json) as BookImportPreview
  const ids = planSupplementaryAppend(preview)
  try {
    if (!ids.length || Number(run.revision) !== 0) throw new SupplementaryAppendNeedsReview('预览需要核对后导入')
    const result = await applyImport(db, {
      run, targetNovelId: binding.novel_id, selectedChapterIds: ids, metadataFields: [], metadataMode: 'missing', actorUserId: 'system',
      supplementaryAppend: { scanAt: Number(binding.scan_at), leaseUntil: Number(binding.update_lease_until) },
    })
    return { status: 'added', addedCount: result.created, fileName: file.name, runId: run.id }
  } catch (error) {
    if (!(error instanceof SupplementaryAppendNeedsReview)) {
      const current = await priorImport(db, binding, fileVersion(file))
      if (current && current.status !== 'preview') return settleImport(db, binding, current, file)
      throw error
    }
    await db.query("UPDATE book_import_runs SET supplementary_auto_pending=FALSE WHERE id=$1 AND status='preview'", [run.id])
    return { ...review, message: error.message }
  }
}

async function processBinding(db: Db, binding: ClaimedBinding): Promise<UpdateOutcome> {
  const candidates = bindingCandidates(sourceFiles(binding), binding.alias_title, binding.alias_author)
    .filter(file => !file.stale && !file.incomplete)
  const file = candidates[0]
  if (!file) return { status: 'no-file' }
  if (candidates[1]?.folder === file.folder && candidates[1].revision === file.revision) {
    return { status: 'review', message: '最新目录里有多个同进度文件，请在候选版本中选择。' }
  }
  const version = fileVersion(file)
  const prior = await priorImport(db, binding, version)
  if (prior) return settleImport(db, binding, prior, file)
  if (binding.update_result?.fileVersion === version && binding.update_result.status === 'unchanged' && !binding.update_result.runId) {
    return { status: 'unchanged', fileName: file.name, fileVersion: version }
  }

  const data = await downloadLanzouFile(file)
  const hash = createHash('sha256').update(data).digest('hex')
  const duplicate = await priorImport(db, binding, version, hash)
  if (duplicate) return settleImport(db, binding, duplicate, file)
  const { payload, diagnostics } = await parseUploadedBookDetailed(file.name, data)
  if (payload.author && binding.alias_author && identityKey(payload.author) !== identityKey(binding.alias_author)) {
    return { status: 'review', fileName: file.name, message: '正文作者与绑定来源不一致，请核对文件。' }
  }
  payload.chapters = payload.chapters.map(chapter => ({ ...chapter, sourceUrl: `${file.url}#chapter=${chapter.order}` }))
  const preview = await createPreview(db, {
    sourceType: 'file', sourceLabel: file.name, sourceUrl: file.url, payload,
    targetNovelId: binding.novel_id, diagnostics, preserveLocalOrder: true,
  })
  if (!preview.summary.newCount && !preview.chapters.some(supplementaryChapterNeedsReview)) {
    return { status: 'unchanged', fileName: file.name, fileVersion: version }
  }

  preview.supplementary = { bindingId: binding.id, fileKey: file.key }
  const append = binding.update_mode === 'append' && planSupplementaryAppend(preview).length > 0
  preview.warnings.push('这份预览由附加源生成。确认导入只更新所选章节。')
  const stored = await withTx(db, async q => {
    const live = (await q(
      `SELECT b.id FROM supplementary_bindings b JOIN supplementary_sources s ON s.id=b.source_id
       WHERE b.id=$1 AND b.update_lease_until=$2 AND $2>$4
         AND s.enabled AND s.status='ok' AND s.checked_at=$3 AND s.checking_until<=$4 FOR SHARE OF b,s`,
      [binding.id, binding.update_lease_until, binding.scan_at, Date.now()],
    )).rows.length
    if (!live) return false
    await storeImportPreview({ query: q }, preview, payload, diagnostics.stats.parser === 'text' ? new TextDecoder().decode(data) : '', 'system', { hash, version, append })
    return true
  })
  if (!stored) return { status: 'failed', fileName: file.name, message: '来源状态已变化，等待下一次目录检查。' }
  if (!append) return {
    status: 'review', fileName: file.name, runId: preview.runId,
    ...(binding.update_mode === 'append' ? { message: '新章需要人工核对，或文件无法与本地末章连续对应。' } : {}),
  }
  return settleImport(db, binding, { id: preview.runId, status: 'preview', supplementary_auto_pending: true, rolled_back_at: 0, added_count: 0 }, file)
}

/** 目录共享，下载及解析按绑定限流。租约到期后可接续未完成的预览。 */
export async function runSupplementaryUpdateTick(db: Db) {
  const due = await all<{ id: string }>(db,
    `SELECT b.id FROM supplementary_bindings b JOIN supplementary_sources s ON s.id=b.source_id
     WHERE ${eligibleScan} ORDER BY b.update_scan_at,b.id LIMIT 3`, [Date.now()],
  )
  for (const item of due) {
    const now = Date.now()
    const binding = await first<ClaimedBinding>(db,
      `UPDATE supplementary_bindings b SET update_lease_until=$2 FROM supplementary_sources s
       WHERE b.id=$3 AND s.id=b.source_id AND ${eligibleScan}
       RETURNING b.*,s.checked_at AS scan_at,s.files_json`, [now, now + leaseDuration, item.id],
    )
    if (!binding) continue
    let result: UpdateOutcome
    try {
      result = await processBinding(db, binding)
    } catch (error) {
      result = error instanceof LanzouError
        ? { status: error.code === 'manual' ? 'manual-download' : 'failed', message: error.message }
        : { status: 'failed', message: '文件下载或章节比对失败，可检查目录后重试。' }
    }
    await db.query(
      `UPDATE supplementary_bindings SET update_result=$2,update_scan_at=$3,update_lease_until=0
       WHERE id=$1 AND update_lease_until=$4`,
      [binding.id, JSON.stringify({ ...result, checkedAt: Date.now() }), binding.scan_at, binding.update_lease_until],
    )
  }
}
