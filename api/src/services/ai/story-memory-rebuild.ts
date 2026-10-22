import { createHash, randomUUID } from 'node:crypto'
import type { Db, DbClient } from '../../db/pool'
import { all, first, run, withTx } from '../../db/query'
import type { MemoryRebuildPlan, MemoryRebuildRequest } from '@shared/story-memory-rebuild'
import { AiError, isTextAiConfigured } from './client'
import { cleanStoryText, reusablePrefix } from './story-memory'
import { loadProfileSample, parseProfileSource } from './profile-source'
import { getMemoryRebuild, saveMemorySnapshot, type MemoryKind, type MemorySnapshot } from './story-memory-history'
import { createAiTask } from './tasks'

const taskKinds = { plot: 'plot_state', relationship: 'relationship_profile' }
const tables = { plot: ['novel_plot_states', 'state'], relationship: ['novel_relationship_profiles', 'profile'] } as const
function validate(request: MemoryRebuildRequest) {
  if (!request || typeof request !== 'object') throw new AiError('invalid', '重新分析参数无效', 422)
  if (
    !Array.isArray(request.kinds) ||
    !request.kinds.length ||
    request.kinds.length > 2 ||
    new Set(request.kinds).size !== request.kinds.length ||
    request.kinds.some((kind) => kind !== 'plot' && kind !== 'relationship')
  )
    throw new AiError('invalid', '请选择有效且不重复的档案类型', 422)
  if (!['single', 'range', 'all'].includes(request.range) || typeof request.followThrough !== 'boolean') throw new AiError('invalid', '重新分析范围无效', 422)
  if (request.sampleChapters !== undefined && (!Number.isInteger(request.sampleChapters) || request.sampleChapters < 1 || request.sampleChapters > 30))
    throw new AiError('invalid', '每批章数应为 1–30 的整数', 422)
}

/** A read-only preview bound to chapter text, archive revision, checkpoints and both selected kinds. */
export async function planMemoryRebuild(db: DbClient, novelId: string, request: MemoryRebuildRequest): Promise<MemoryRebuildPlan> {
  validate(request)
  if (!(await first(db, 'SELECT id FROM novels WHERE id=$1', [novelId]))) throw new AiError('invalid', '小说不存在', 404)
  const sample = await loadProfileSample(db as Db, { novelId, sampleCount: 1, fullHistory: true, clean: cleanStoryText })
  if (!sample?.rows.length) throw new AiError('invalid', '小说尚无可分析的正文', 422)
  const rows = sample.rows
  const ordinal = (id: string | undefined) => rows.findIndex((row) => row.id === id) + 1
  const selectedStart = request.range === 'all' ? 1 : ordinal(request.startChapterId)
  const requestedEnd = request.range === 'single' ? selectedStart : request.range === 'all' ? 0 : ordinal(request.endChapterId)
  if (!selectedStart || (request.range !== 'all' && (!requestedEnd || requestedEnd < selectedStart)))
    throw new AiError('invalid', '请选择本书中顺序有效的起止章节', 422)
  const items: MemoryRebuildPlan['items'] = []
  const revisionParts: unknown[] = [
    novelId,
    {
      kinds: [...request.kinds].sort(),
      range: request.range,
      startChapterId: request.startChapterId || '',
      endChapterId: request.range === 'single' ? request.startChapterId || '' : request.endChapterId || '',
      followThrough: request.followThrough,
      sampleChapters: request.sampleChapters || 0,
    },
    sample.source.fingerprint,
  ]
  for (const kind of [...request.kinds].sort()) {
    const build = await first<{ lease_until: number; source_json: string; target_chapter_id: string; content: string; model: string }>(
      db,
      'SELECT lease_until,source_json,target_chapter_id,content,model FROM novel_story_memory_builds WHERE novel_id=$1 AND kind=$2',
      [novelId, kind],
    )
    const active = await first(db, "SELECT id FROM ai_tasks WHERE novel_id=$1 AND kind=$2 AND status IN ('queued','running') LIMIT 1", [
      novelId,
      taskKinds[kind],
    ])
    if (active || Number(build?.lease_until) > Date.now()) throw new AiError('conflict', '请先暂停所选档案的分析，等待当前请求结束后再重新分析', 409)
    const [table, column] = tables[kind]
    const saved = await first<{ content: string; source_json: string; model: string }>(
      db,
      `SELECT ${column} AS content,source_json,model FROM ${table} WHERE novel_id=$1`,
      [novelId],
    )
    const old = parseProfileSource(saved?.source_json)
    const checkpoint = parseProfileSource(build?.source_json)
    const previousThrough = Math.max(ordinal(old?.chapterId), ordinal(checkpoint?.chapterId), ordinal(build?.target_chapter_id))
    const selectedEnd = request.range === 'all' ? previousThrough || rows.length : requestedEnd
    const targetOrdinal = request.followThrough ? Math.max(selectedEnd, previousThrough) : selectedEnd
    const snapshots = await all<MemorySnapshot>(
      db,
      'SELECT * FROM novel_story_memory_snapshots WHERE novel_id=$1 AND kind=$2 AND reusable=TRUE ORDER BY created_at DESC,id DESC',
      [novelId, kind],
    )
    const pending = await getMemoryRebuild(db, novelId, kind)
    const candidates = [...snapshots, ...(saved && !pending?.pending ? [{ ...saved, id: 'current' }] : []), ...(build ? [{ ...build, id: 'build' }] : [])]
    let seedSnapshotId: string | null = null,
      seedCount = 0
    for (const candidate of candidates) {
      const count = reusablePrefix(rows, candidate.content, parseProfileSource(candidate.source_json))
      if (count > seedCount && count < selectedStart) {
        seedCount = count
        seedSnapshotId = candidate.id
      }
    }
    const manual = await first<{ revision: number }>(db, 'SELECT revision FROM novel_ai_profile_overrides WHERE novel_id=$1 AND kind=$2', [novelId, kind])
    items.push({
      kind,
      selectedStart,
      selectedEnd,
      actualStart: seedCount + 1,
      targetOrdinal,
      targetChapterId: rows[targetOrdinal - 1]!.id,
      previousThrough,
      seedSnapshotId,
      hasManualOverride: !!manual,
    })
    revisionParts.push([
      kind,
      saved,
      build?.source_json || '',
      build?.content || '',
      build?.model || '',
      build?.target_chapter_id || '',
      pending,
      manual?.revision,
      seedSnapshotId,
      snapshots.map((s) => [s.id, s.source_json]),
    ])
  }
  return { items, revision: createHash('sha256').update(JSON.stringify(revisionParts)).digest('hex') }
}

/** No upstream calls here. Invalidation, backup, seed and queued jobs commit together. */
export async function startMemoryRebuild(
  db: Db,
  novelId: string,
  request: MemoryRebuildRequest,
  expectedRevision: string,
  userId: string,
  audit: { ipAddress?: string; userAgent?: string } = {},
) {
  if (!isTextAiConfigured()) throw new AiError('disabled', 'AI 文本服务未配置', 503)
  validate(request)
  return withTx(db, async (query) => {
    const tx = { query }
    if (!(await first(tx, 'SELECT id FROM novels WHERE id=$1 FOR UPDATE', [novelId]))) throw new AiError('invalid', '小说不存在', 404)
    // Serialize against an executor claiming or completing a lease in another process.
    for (const kind of [...request.kinds].sort()) {
      await run(tx, 'INSERT INTO novel_story_memory_builds (novel_id,kind) VALUES ($1,$2) ON CONFLICT DO NOTHING', [novelId, kind])
      await first(tx, 'SELECT novel_id FROM novel_story_memory_builds WHERE novel_id=$1 AND kind=$2 FOR UPDATE', [novelId, kind])
    }
    const plan = await planMemoryRebuild(tx, novelId, request)
    if (!expectedRevision || plan.revision !== expectedRevision) throw new AiError('conflict', '正文或档案已变化，请重新预览重建范围后提交', 409)
    const tasks: { taskId: string; kind: MemoryKind }[] = []
    for (const item of plan.items) {
      const [table, column] = tables[item.kind]
      const saved = await first<{ content: string; source_json: string; model: string }>(
        tx,
        `SELECT ${column} AS content,source_json,model FROM ${table} WHERE novel_id=$1`,
        [novelId],
      )
      const seed =
        item.seedSnapshotId === 'build'
          ? await first<{ content: string; source_json: string; model: string }>(tx, 'SELECT content,source_json,model FROM novel_story_memory_builds WHERE novel_id=$1 AND kind=$2', [novelId, item.kind])
          : item.seedSnapshotId === 'current'
          ? saved
          : item.seedSnapshotId
            ? await first<MemorySnapshot>(tx, 'SELECT * FROM novel_story_memory_snapshots WHERE id=$1 AND novel_id=$2 AND kind=$3 AND reusable=TRUE', [
                item.seedSnapshotId,
                novelId,
                item.kind,
              ])
            : undefined
      if (saved) await saveMemorySnapshot(tx, novelId, item.kind, 'archive', saved)
      // Keep invalidated versions readable, but never use them as future seeds.
      const snapshots = await all<MemorySnapshot>(tx, 'SELECT * FROM novel_story_memory_snapshots WHERE novel_id=$1 AND kind=$2 AND reusable=TRUE', [
        novelId,
        item.kind,
      ])
      for (const snapshot of snapshots) {
        const through = parseProfileSource(snapshot.source_json)?.chapterOrdinal || 0
        if (through >= item.selectedStart) await run(tx, 'UPDATE novel_story_memory_snapshots SET reusable=FALSE WHERE id=$1', [snapshot.id])
      }
      const revision = randomUUID()
      await run(
        tx,
        `INSERT INTO novel_story_memory_rebuilds (novel_id,kind,revision,pending,from_chapter_id,target_chapter_id,created_at)
        VALUES ($1,$2,$3,TRUE,$4,$5,$6) ON CONFLICT(novel_id,kind) DO UPDATE SET revision=EXCLUDED.revision,pending=TRUE,from_chapter_id=EXCLUDED.from_chapter_id,target_chapter_id=EXCLUDED.target_chapter_id,created_at=EXCLUDED.created_at`,
        [
          novelId,
          item.kind,
          revision,
          request.range === 'all'
            ? (await first<{ id: string }>(tx, 'SELECT id FROM chapters WHERE novel_id=$1 ORDER BY sort_order,id LIMIT 1', [novelId]))!.id
            : request.startChapterId,
          item.targetChapterId,
          Date.now(),
        ],
      )
      await run(
        tx,
        "UPDATE novel_story_memory_builds SET content=$1,source_json=$2,model=$3,target_chapter_id=$4,pause_requested=FALSE,last_attempt_json='',lease_token='',lease_until=0,updated_at=$5 WHERE novel_id=$6 AND kind=$7",
        [seed?.content || '', seed?.source_json || '', seed?.model || '', item.targetChapterId, Date.now(), novelId, item.kind],
      )
      const task = await createAiTask(tx, {
        userId,
        novelId,
        kind: taskKinds[item.kind],
        total: item.targetOrdinal,
        params: JSON.stringify({ userId, novelId, afterChapterId: item.targetChapterId, sampleChapters: request.sampleChapters, ...audit }),
        prompt: `重新分析第 ${item.selectedStart}–${item.selectedEnd} 章；实际重建第 ${item.actualStart}–${item.targetOrdinal} 章`,
      })
      tasks.push({ taskId: task.id, kind: item.kind })
    }
    // Existing graph is a derived cache, not an authoritative archive.
    await run(tx, 'DELETE FROM novel_story_graphs WHERE novel_id=$1', [novelId])
    return { plan, tasks }
  })
}

export async function memoryArchiveHistory(db: DbClient, novelId: string, kind: MemoryKind) {
  return all<MemorySnapshot>(
    db,
    "SELECT * FROM novel_story_memory_snapshots WHERE novel_id=$1 AND kind=$2 AND role='archive' ORDER BY created_at DESC,id DESC LIMIT 8",
    [novelId, kind],
  )
}
