import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from '../../test/db'
import { AiError, chat } from './client'
import { planMemoryRebuild, startMemoryRebuild, memoryArchiveHistory } from './story-memory-rebuild'
import { extractRelationshipProfile } from './relationship-profile'
import { extractPlotState } from './plot-state'
import { getEffectiveProfileForAnchor, saveProfileOverride } from './profile-overrides'
import { runStoryMemoryTask } from './story-memory-tasks'
import { getMemoryRebuild, saveMemorySnapshot } from './story-memory-history'
import { getStoryMemoryProgress } from './story-memory'
import type { MemoryRebuildRequest } from '@shared/story-memory-rebuild'

vi.mock('./client', async (original) => ({
  ...(await original<typeof import('./client')>()),
  chat: vi.fn(),
  isTextAiConfigured: () => true,
  textProvider: () => ({ baseUrl: 'https://fixture.example' }),
}))
vi.mock('./usage', () => ({ recordUsage: vi.fn() }))
vi.mock('./settings', async (original) => {
  const real = await original<typeof import('./settings')>()
  return { ...real, getAiSettings: async () => real.DEFAULT_AI_SETTINGS }
})
let t: TestDb
const response = { text: '累计档案 [章节ID:c1]', model: 'fixture', promptTokens: 10, completionTokens: 20, cost: 0, finishReason: 'stop' }
const request: MemoryRebuildRequest = {
  kinds: ['relationship'],
  range: 'range',
  startChapterId: 'c3',
  endChapterId: 'c4',
  followThrough: true,
  sampleChapters: 2,
}
beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
})
afterAll(async () => {
  await t.close()
})
beforeEach(async () => {
  await t.db.query('DELETE FROM novels')
  await t.db.query('DELETE FROM ai_tasks')
  await t.db.query("INSERT INTO novels(id,title,created_at,updated_at) VALUES('book','测试',1,1),('other','其他',1,1)")
  for (let i = 1; i <= 6; i++)
    await t.db.query('INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES($1,$2,$3,$4,$5,1)', [
      `c${i}`,
      'book',
      `第${i}章`,
      `正文${i}`,
      i,
    ])
  vi.mocked(chat).mockReset().mockResolvedValue(response)
})
async function archived() {
  for (const afterChapterId of ['c2', 'c4', 'c6'])
    await extractRelationshipProfile(t.db, { userId: 'test', novelId: 'book', afterChapterId, sampleChapters: 2 })
  vi.mocked(chat).mockClear()
}
describe('range rebuilds', () => {
  it('reuses the valid pre-migration build checkpoint even without stored snapshots', async () => {
    await extractRelationshipProfile(t.db, { userId: 'test', novelId: 'book', afterChapterId: 'c6', sampleChapters: 2 })
    await t.db.query('DELETE FROM novel_story_memory_snapshots')
    const plan = await planMemoryRebuild(t.db, 'book', request)
    expect(plan.items[0]).toMatchObject({ actualStart: 3, seedSnapshotId: 'build', targetOrdinal: 6 })
    const result = await startMemoryRebuild(t.db, 'book', request, plan.revision, 'test')
    expect(result.tasks).toHaveLength(1)
    expect(await getStoryMemoryProgress(t.db, 'book', 'relationship')).toMatchObject({ processedChapters: 2 })
  })
  it('previews a valid prior snapshot, excludes old effective content, and rebuilds all dependent chapters', async () => {
    await archived()
    const before = await getEffectiveProfileForAnchor(t.db, { novelId: 'book', kind: 'relationship' })
    await saveProfileOverride(t.db, {
      novelId: 'book',
      kind: 'relationship',
      content: '人工校正保留',
      expectedRevision: 0,
      baseProfileRevision: before.baseProfileRevision,
      updatedBy: 'test',
    })
    await t.db.query("INSERT INTO novel_story_graphs VALUES('book','old','{}',1)")
    const plan = await planMemoryRebuild(t.db, 'book', request)
    expect(plan.items[0]).toMatchObject({ selectedStart: 3, selectedEnd: 4, actualStart: 3, targetOrdinal: 6, hasManualOverride: true })
    const result = await startMemoryRebuild(t.db, 'book', request, plan.revision, 'test')
    expect(await getEffectiveProfileForAnchor(t.db, { novelId: 'book', kind: 'relationship' })).toMatchObject({
      eligibility: 'rebuilding',
      effectiveContent: '',
      profile: response.text,
      manualOverride: { content: '人工校正保留' },
    })
    expect(await getStoryMemoryProgress(t.db, 'book', 'relationship')).toMatchObject({ complete: false, processedChapters: 2, totalChapters: 6 })
    expect((await t.db.query("SELECT * FROM novel_story_graphs WHERE novel_id='book'")).rows).toHaveLength(0)
    await runStoryMemoryTask(t.db, result.tasks[0]!.taskId, 'relationship')
    expect(chat).toHaveBeenCalledTimes(2)
    const prompts = vi.mocked(chat).mock.calls.map((call) => call[0].messages.map((m) => m.content).join('\n'))
    expect(prompts[0]).toContain('正文3')
    expect(prompts[0]).not.toContain('正文1')
    expect(prompts[1]).toContain('正文6')
    const after = await getEffectiveProfileForAnchor(t.db, { novelId: 'book', kind: 'relationship' })
    expect(after).toMatchObject({
      eligibility: 'usable',
      effectiveOrigin: 'automatic',
      exclusionReason: 'base_changed',
      manualOverride: { content: '人工校正保留' },
    })
    expect(after.baseProfileRevision).not.toBe(before.baseProfileRevision)
    expect(await getMemoryRebuild(t.db, 'book', 'relationship')).toMatchObject({ pending: false })
    expect(await memoryArchiveHistory(t.db, 'book', 'relationship')).not.toHaveLength(0)
    const invalid = await t.db.query<{ reusable: boolean }>(
      "SELECT reusable FROM novel_story_memory_snapshots WHERE novel_id='book' AND role='archive' AND source_json=$1",
      [JSON.stringify(before.source)],
    )
    expect(invalid.rows.every((row) => row.reusable === false)).toBe(true)
  })
  it('falls back to chapter one without a prefix snapshot, and may stop at the selected endpoint', async () => {
    await extractRelationshipProfile(t.db, { userId: 'test', novelId: 'book', afterChapterId: 'c6', sampleChapters: 6 })
    const shorter = { ...request, followThrough: false }
    const plan = await planMemoryRebuild(t.db, 'book', shorter)
    expect(plan.items[0]).toMatchObject({ actualStart: 1, targetOrdinal: 4, seedSnapshotId: null })
    const result = await startMemoryRebuild(t.db, 'book', shorter, plan.revision, 'test')
    await runStoryMemoryTask(t.db, result.tasks[0]!.taskId, 'relationship')
    expect(await getEffectiveProfileForAnchor(t.db, { novelId: 'book', kind: 'relationship', afterChapterId: 'c4' })).toMatchObject({
      eligibility: 'usable',
      source: { chapterId: 'c4' },
    })
    expect(await getEffectiveProfileForAnchor(t.db, { novelId: 'book', kind: 'relationship' })).toMatchObject({ eligibility: 'stale' })
  })
  it('fails without deleting the old archive or reviving its stale checkpoint', async () => {
    await archived()
    const plan = await planMemoryRebuild(t.db, 'book', request)
    const result = await startMemoryRebuild(t.db, 'book', request, plan.revision, 'test')
    vi.mocked(chat).mockRejectedValueOnce(new AiError('timeout', 'fixture timeout'))
    await runStoryMemoryTask(t.db, result.tasks[0]!.taskId, 'relationship')
    expect(await getEffectiveProfileForAnchor(t.db, { novelId: 'book', kind: 'relationship' })).toMatchObject({
      eligibility: 'rebuilding',
      profile: response.text,
      effectiveContent: '',
    })
    expect(await getStoryMemoryProgress(t.db, 'book', 'relationship')).toMatchObject({ complete: false, processedChapters: 2 })
    expect((await t.db.query<{ status: string }>('SELECT status FROM ai_tasks WHERE id=$1', [result.tasks[0]!.taskId])).rows[0]?.status).toBe('failed')
    // A new attempt resumes the pending target, even if the caller names an earlier anchor.
    await extractRelationshipProfile(t.db, { userId: 'test', novelId: 'book', afterChapterId: 'c3', sampleChapters: 30 })
    expect(await getMemoryRebuild(t.db, 'book', 'relationship')).toMatchObject({ pending: false, target_chapter_id: 'c6' })
  })
  it('rejects a stale preview atomically after a chapter edit', async () => {
    await archived()
    const plan = await planMemoryRebuild(t.db, 'book', request)
    await t.db.query("UPDATE chapters SET content='修改正文' WHERE id='c1'")
    await expect(startMemoryRebuild(t.db, 'book', request, plan.revision, 'test')).rejects.toMatchObject({ code: 'conflict' })
    expect(await getMemoryRebuild(t.db, 'book', 'relationship')).toBeUndefined()
    expect((await t.db.query('SELECT * FROM ai_tasks')).rows).toHaveLength(0)
  })
  it('rejects active jobs and live leases before resetting anything', async () => {
    await archived()
    const plan = await planMemoryRebuild(t.db, 'book', request)
    await t.db.query("UPDATE novel_story_memory_builds SET lease_until=$1 WHERE novel_id='book'", [Date.now() + 10000])
    await expect(startMemoryRebuild(t.db, 'book', request, plan.revision, 'test')).rejects.toMatchObject({ code: 'conflict' })
    expect(await getMemoryRebuild(t.db, 'book', 'relationship')).toBeUndefined()
  })
  it('queues both kinds atomically and leaves unselected kinds alone', async () => {
    await archived()
    await extractPlotState(t.db, { userId: 'test', novelId: 'book', afterChapterId: 'c6', sampleChapters: 6 })
    const both = { ...request, kinds: ['relationship', 'plot'] as MemoryRebuildRequest['kinds'] }
    const plan = await planMemoryRebuild(t.db, 'book', both)
    expect(plan.items).toHaveLength(2)
    const started = await startMemoryRebuild(t.db, 'book', both, plan.revision, 'test')
    expect(started.tasks).toHaveLength(2)
    expect(await getMemoryRebuild(t.db, 'book', 'plot')).toMatchObject({ pending: true })
  })
  it.each([
    { ...request, startChapterId: 'missing' },
    { ...request, startChapterId: 'c5', endChapterId: 'c2' },
    { ...request, kinds: ['style'] },
    { ...request, kinds: ['plot', 'plot'] },
    { ...request, sampleChapters: 0 },
  ])('rejects malformed, foreign or reversed range %j', async (invalid) => {
    await expect(planMemoryRebuild(t.db, 'book', invalid as MemoryRebuildRequest)).rejects.toMatchObject({ code: 'invalid' })
    expect(chat).not.toHaveBeenCalled()
  })
  it('bounds snapshot history and never promotes a known-invalid backup', async () => {
    for (let i = 0; i < 20; i++) await saveMemorySnapshot(t.db, 'book', 'plot', 'checkpoint', { content: `历史${i}`, source_json: '{}', model: 'fixture' })
    expect((await t.db.query('SELECT * FROM novel_story_memory_snapshots')).rows).toHaveLength(16)
    await saveMemorySnapshot(t.db, 'book', 'plot', 'archive', { content: '旧错误', source_json: '{}', model: 'fixture' })
    await t.db.query("UPDATE novel_story_memory_snapshots SET reusable=FALSE WHERE role='archive'")
    await saveMemorySnapshot(t.db, 'book', 'plot', 'archive', { content: '旧错误', source_json: '{}', model: 'fixture' })
    expect(await memoryArchiveHistory(t.db, 'book', 'plot')).toHaveLength(1)
    expect((await memoryArchiveHistory(t.db, 'book', 'plot'))[0]?.reusable).toBe(false)
  })
})
