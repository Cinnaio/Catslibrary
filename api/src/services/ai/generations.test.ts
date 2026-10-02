import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../../test/db'
import { deleteGeneration, listGenerationDetails, saveGeneration } from './generations'

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
