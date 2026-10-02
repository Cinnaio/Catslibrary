import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../../test/db'
import { deleteGeneration, listGenerationDetails, saveGeneration } from './generations'
import { createAiTask } from './tasks'

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb()
  await testDb.applyMigrations()
  await testDb.db.query("INSERT INTO novels (id, title, created_at, updated_at) VALUES ('search-book', '雨夜的书', 1, 1)")
  await testDb.db.query("INSERT INTO chapters (id, novel_id, title, created_at) VALUES ('search-chapter', 'search-book', '断剑重逢', 1)")
  for (let index = 0; index < 12; index++) {
    await saveGeneration(testDb.db, {
      novelId: 'search-book',
      chapterId: 'search-chapter',
      kind: 'continue',
      model: 'test',
      paramsJson: '{}',
      prompt: '',
      result: `BODY ${index} 100%_literal`,
      status: 'draft',
      createdBy: '',
    })
  }
  await saveGeneration(testDb.db, {
    novelId: '',
    chapterId: '',
    kind: 'summary',
    model: 'test',
    paramsJson: '{}',
    prompt: '',
    result: '另一条已发布摘要',
    status: 'published',
    createdBy: '',
  })
})
afterAll(async () => {
  await testDb.close()
})

describe('generation directory search', () => {
  it('searches associated titles before pagination and keeps count and status consistent', async () => {
    const first = await listGenerationDetails(testDb.db, { q: '雨夜', status: 'draft', kinds: ['continue'], limit: 10 })
    const second = await listGenerationDetails(testDb.db, { q: '雨夜', status: 'draft', kinds: ['continue'], limit: 10, offset: 10 })
    expect(first.total).toBe(12)
    expect(first.items).toHaveLength(10)
    expect(second.total).toBe(12)
    expect(second.items).toHaveLength(2)
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(12)
    expect((await listGenerationDetails(testDb.db, { q: '断剑', status: 'published' })).total).toBe(0)
    expect((await listGenerationDetails(testDb.db, { q: '断剑', status: 'draft' })).total).toBe(12)
  })
  it('treats user punctuation literally, searches body without case sensitivity and excludes soft deletes', async () => {
    expect((await listGenerationDetails(testDb.db, { q: ' body ' })).total).toBe(12)
    expect((await listGenerationDetails(testDb.db, { q: '%_literal' })).total).toBe(12)
    expect((await listGenerationDetails(testDb.db, { q: "' OR 1=1 --" })).total).toBe(0)
    const match = await listGenerationDetails(testDb.db, { q: 'BODY 11' })
    await deleteGeneration(testDb.db, match.items[0]!.id)
    expect((await listGenerationDetails(testDb.db, { q: 'BODY 11' })).total).toBe(0)
    expect((await listGenerationDetails(testDb.db, { q: '   ', status: 'published' })).total).toBe(1)
  })
})

describe('generation directory batch pagination', () => {
  beforeAll(async () => {
    for (let index = 0; index < 38; index++) {
      const batchId = index < 17 ? 'paging-large' : index < 20 ? 'paging-small' : ''
      const batchIndex = index < 17 ? index + 1 : index - 16
      const generation = await saveGeneration(testDb.db, {
        novelId: 'search-book',
        chapterId: '',
        kind: 'continue',
        model: 'test',
        paramsJson: batchId ? JSON.stringify({ batchId, batchIndex }) : '{}',
        prompt: '',
        result: `GROUP-PAGING chapter-${index}`,
        status: index < 2 ? 'published' : 'draft',
        createdBy: '',
      })
      await testDb.db.query('UPDATE ai_generations SET created_at = $1 WHERE id = $2', [10000 - index, generation.id])
    }
  })

  it('counts each batch once and returns all its chapters without splitting it at the page boundary', async () => {
    const options = { q: 'GROUP-PAGING', groupBatches: true, limit: 10 }
    const first = await listGenerationDetails(testDb.db, options)
    const second = await listGenerationDetails(testDb.db, { ...options, offset: 10 })
    expect(first.total).toBe(20)
    expect(second.total).toBe(20)
    expect(first.items).toHaveLength(28) // 17 + 3 chapters and 8 standalone entries
    expect(second.items).toHaveLength(10)
    expect(first.items.filter((item) => item.batchId === 'paging-large')).toHaveLength(17)
    expect(first.items.filter((item) => item.batchId === 'paging-small')).toHaveLength(3)
    expect(second.items.every((item) => !item.batchId)).toBe(true)
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(38)
    expect((await listGenerationDetails(testDb.db, { ...options, offset: 20 })).items).toHaveLength(0)
  })

  it('applies status and search filters before counting directory entries', async () => {
    const published = await listGenerationDetails(testDb.db, { q: 'GROUP-PAGING', groupBatches: true, status: 'published' })
    expect(published.total).toBe(1)
    expect(published.items).toHaveLength(2)
    expect(published.items.every((item) => item.status === 'published')).toBe(true)
    const draft = await listGenerationDetails(testDb.db, { q: 'GROUP-PAGING', groupBatches: true, status: 'draft' })
    expect(draft.total).toBe(20)
    expect(draft.items.filter((item) => item.batchId === 'paging-large')).toHaveLength(15)
    const search = await listGenerationDetails(testDb.db, { q: 'GROUP-PAGING chapter-16', groupBatches: true })
    expect(search.total).toBe(1)
    expect(search.items).toHaveLength(1)
  })

  it('keeps legacy chapter pagination when grouping is not requested', async () => {
    const legacy = await listGenerationDetails(testDb.db, { q: 'GROUP-PAGING', limit: 10 })
    expect(legacy.total).toBe(38)
    expect(legacy.items).toHaveLength(10)
  })

  it('excludes deleted batches and tolerates invalid legacy metadata', async () => {
    const small = await listGenerationDetails(testDb.db, { q: 'GROUP-PAGING', groupBatches: true })
    for (const item of small.items.filter((item) => item.batchId === 'paging-small')) {
      await deleteGeneration(testDb.db, item.id)
    }
    const single = small.items.find((item) => !item.batchId)!
    await testDb.db.query('UPDATE ai_generations SET params_json = $1 WHERE id = $2', ['invalid json', single.id])
    const remaining = await listGenerationDetails(testDb.db, { q: 'GROUP-PAGING', groupBatches: true })
    expect(remaining.total).toBe(19)
    expect(remaining.items.some((item) => item.batchId === 'paging-small')).toBe(false)
    expect(remaining.items.find((item) => item.id === single.id)?.batchId).toBe('')
  })
})

describe('continuation plot preview', () => {
  it('prefers the saved direction and recovers legacy directions through exact task or batch associations', async () => {
    const original = await createAiTask(testDb.db, { userId: '', novelId: 'search-book', kind: 'continue', batchId: 'plot-legacy', prompt: 'CREATIVE_TASK_PIPELINE 完整提示词', params: JSON.stringify({ instruction: '原始选定情节' }) })
    const resumed = await createAiTask(testDb.db, { userId: '', novelId: 'search-book', kind: 'continue', batchId: 'plot-legacy', prompt: 'CREATIVE_TASK_PIPELINE 完整提示词', params: JSON.stringify({ instruction: '恢复任务的情节' }) })
    await testDb.db.query('UPDATE ai_tasks SET created_at = $1 WHERE id = $2', [1, original.id])
    await testDb.db.query('UPDATE ai_tasks SET created_at = $1 WHERE id = $2', [2, resumed.id])
    const metadata = [
      { batchId: 'plot-snapshot', taskId: original.id, plotDirection: '  情节快照  ' },
      { batchId: 'plot-legacy', taskId: resumed.id },
      { batchId: 'plot-legacy' },
      { batchId: 'plot-legacy', taskId: 'missing-task' },
      { batchId: 'plot-no-task' },
    ]
    const ids: string[] = []
    for (const params of metadata) {
      const saved = await saveGeneration(testDb.db, {
        novelId: 'search-book',
        chapterId: '',
        kind: 'continue',
        model: 'test',
        paramsJson: JSON.stringify(params),
        prompt: '完整模型提示词，不能作为情节预览',
        result: 'PLOT-PREVIEW 正文保持不变',
        status: 'draft',
        createdBy: '',
      })
      ids.push(saved.id)
    }
    const result = await listGenerationDetails(testDb.db, { q: 'PLOT-PREVIEW', groupBatches: true })
    expect(ids.map((id) => result.items.find((item) => item.id === id)?.plotDirection)).toEqual(['情节快照', '恢复任务的情节', '原始选定情节', '', ''])
    expect(result.items.every((item) => item.result === 'PLOT-PREVIEW 正文保持不变')).toBe(true)
  })
})
