import type { Db } from '../../db/pool'
import { first, run, withTx } from '../../db/query'
import { AiError, isTextAiConfigured } from './client'
import { extractPlotState } from './plot-state'
import { extractRelationshipProfile } from './relationship-profile'
import { pauseStoryMemory, type StoryMemoryOptions } from './story-memory'
import { cancelAiTask, createAiTask, getAiTask, isAiTaskActive, startAiTaskHeartbeat, updateAiTask } from './tasks'
import { parseAiTextProgress } from '@shared/ai-text-progress'
import { getAiSettings } from './settings'

export type MemoryKind = 'plot' | 'relationship'
export const MEMORY_TASK_KINDS = { plot: 'plot_state', relationship: 'relationship_profile' } as const

/** Admin-only metadata with bounded, explicitly unfinished previews; excludes raw prompts and parameters. */
export async function getStoryMemoryTask(db: Db, novelId: string, kind: MemoryKind) {
  const shared = (await getAiSettings(db)).storyMemoryEngine === 'incremental'
  const row = await first<{ id: string; status: string; current: number; total: number; step: string; error: string; updatedAt: number; result: string }>(db,
    `SELECT id, status, current, total, step, error, result, updated_at AS "updatedAt" FROM ai_tasks
     WHERE novel_id = $1 AND (kind = $2 OR ($3 AND kind IN ('plot_state','relationship_profile'))) ORDER BY created_at DESC, id DESC LIMIT 1`, [novelId, MEMORY_TASK_KINDS[kind], shared])
  if (!row) return row
  const { result, ...task } = row
  return { ...task, livePreview: row.status === 'running' ? parseAiTextProgress(result) : null }
}

/** Serialize submissions per novel; a lost response or a second tab reuses the active task. */
export async function createStoryMemoryTask(db: Db, kind: MemoryKind, opts: StoryMemoryOptions) {
  if (!isTextAiConfigured()) throw new AiError('disabled', 'AI 文本服务未配置', 503)
  const memoryEngine = opts.memoryEngine || (await getAiSettings(db)).storyMemoryEngine || 'legacy'
  return withTx(db, async (query) => {
    const client = { query }
    const novel = await first(client, 'SELECT id FROM novels WHERE id = $1 FOR UPDATE', [opts.novelId])
    if (!novel) throw new AiError('invalid', '小说不存在', 404)
    const existing = await first<{ id: string }>(client,
      "SELECT id FROM ai_tasks WHERE novel_id = $1 AND (kind = $2 OR ($3 AND kind IN ('plot_state','relationship_profile'))) AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1",
      [opts.novelId, MEMORY_TASK_KINDS[kind], memoryEngine === 'incremental'])
    if (existing) return { taskId: existing.id, created: false }
    const anchor = opts.afterChapterId
      ? await first<{ id: string }>(client, 'SELECT id FROM chapters WHERE novel_id = $1 AND id = $2', [opts.novelId, opts.afterChapterId])
      : await first<{ id: string }>(client, 'SELECT id FROM chapters WHERE novel_id = $1 ORDER BY sort_order DESC, id DESC LIMIT 1', [opts.novelId])
    if (!anchor) throw new AiError('invalid', opts.afterChapterId ? '起点章节不存在或不属于该小说' : '小说尚无可分析的正文', 422)
    const params: StoryMemoryOptions = { ...opts, memoryEngine, afterChapterId: anchor.id }
    const task = await createAiTask(client, {
      userId: opts.userId, novelId: opts.novelId, kind: MEMORY_TASK_KINDS[kind],
      params: JSON.stringify(params), prompt: `${kind === 'plot' ? '情节状态' : '关系画像'}：分析至章节 ${anchor.id}`,
    })
    return { taskId: task.id, created: true }
  })
}

/** Explicit setting only. Publication never fails merely because preparation failed.
 * No catch-up is silently appended to a task whose target is already frozen. */
export async function preparePublishedMemory(db: Db, opts: StoryMemoryOptions): Promise<void> {
  const settings = await getAiSettings(db)
  if (settings.storyMemoryEngine !== 'incremental' || !settings.storyMemoryAutoUpdate || !isTextAiConfigured()) return
  await run(db, `INSERT INTO novel_story_memory_preparations(novel_id,chapter_id,user_id,updated_at)
    SELECT $1,id,$2,$3 FROM chapters WHERE novel_id=$1 ORDER BY sort_order DESC,id DESC LIMIT 1
    ON CONFLICT(novel_id) DO UPDATE SET chapter_id=EXCLUDED.chapter_id,user_id=EXCLUDED.user_id,updated_at=EXCLUDED.updated_at`,
  [opts.novelId, opts.userId, Date.now()])
  await drainPreparedMemory(db, opts.novelId)
}

async function drainPreparedMemory(db: Db, novelId: string) {
  const settings = await getAiSettings(db)
  if (settings.storyMemoryEngine !== 'incremental' || !settings.storyMemoryAutoUpdate) return
  const pending = await first<{ chapter_id: string; user_id: string; updated_at: number }>(db, 'SELECT chapter_id,user_id,updated_at FROM novel_story_memory_preparations WHERE novel_id=$1', [novelId])
  if (!pending) return
  const result = await createStoryMemoryTask(db, 'plot', { novelId, userId: pending.user_id, afterChapterId: pending.chapter_id, memoryEngine: 'incremental' })
  if (!result.created) return
  await run(db, 'DELETE FROM novel_story_memory_preparations WHERE novel_id=$1 AND chapter_id=$2 AND updated_at=$3', [novelId, pending.chapter_id, pending.updated_at])
  await runStoryMemoryTask(db, result.taskId, 'plot')
}

export async function pauseStoryMemoryTask(db: Db, novelId: string, kind: MemoryKind) {
  const task = await getStoryMemoryTask(db, novelId, kind)
  if (task && (task.status === 'queued' || task.status === 'running')) {
    await cancelAiTask(db, task.id)
    await updateAiTask(db, task.id, { status: 'cancelled', step: '已暂停，检查点已保留' })
  }
  await pauseStoryMemory(db, novelId, kind)
}

/** Runs independently of the HTTP request; failures remain queryable and never auto-retry paid work. */
export async function runStoryMemoryTask(db: Db, taskId: string, kind: MemoryKind): Promise<void> {
  if (!(await isAiTaskActive(db, taskId))) return
  const task = await getAiTask(db, taskId)
  if (!task) return
  const stopHeartbeat = startAiTaskHeartbeat(db, taskId)
  try {
    const opts = JSON.parse(task.params) as StoryMemoryOptions
    if (!opts.novelId || !opts.afterChapterId || opts.novelId !== task.novelId || opts.userId !== task.userId) throw new Error('档案任务参数无效')
    await updateAiTask(db, taskId, { status: 'running', step: '正在校验正文并分析章节' })
    const extract = kind === 'plot' ? extractPlotState : extractRelationshipProfile
    while (await isAiTaskActive(db, taskId)) {
      const result = await extract(db, { ...opts, taskId })
      if (!(await isAiTaskActive(db, taskId))) return
      await updateAiTask(db, taskId, {
        current: result.processedChapters, total: result.totalChapters,
        step: `已保存 ${result.processedChapters} / ${result.totalChapters} 章`,
        ...(result.complete ? { status: 'completed' as const } : result.paused ? { status: 'cancelled' as const, step: '已暂停，检查点已保留' } : {}),
      })
      if (result.complete) { await drainPreparedMemory(db, opts.novelId); return }
      if (result.paused) return
    }
  } catch (err) {
    await updateAiTask(db, taskId, { status: 'failed', step: '分析未完成，检查点已保留', error: err instanceof Error ? err.message : '故事档案分析失败' })
  } finally {
    stopHeartbeat()
  }
}
