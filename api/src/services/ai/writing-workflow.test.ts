import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from '../../test/db'
import { retrieveWritingHistory, writingMaterialRevision } from './writing-history'
import { reviewWritingDraft, reviewSourcesCurrent, parseReview } from './writing-review'
import { chat } from './client'
import { recordUsage } from './usage'
import { generationContentRevision, type GenerationRow } from './generations'
import { validateWritingBrief, type ContinuationSnapshotV1 } from './writing'

vi.mock('./client', async (original) => ({
  ...(await original<typeof import('./client')>()),
  chat: vi.fn(),
  textProvider: () => ({ baseUrl: 'https://test.example/v1' }),
}))
vi.mock('./usage', () => ({ recordUsage: vi.fn() }))
let t: TestDb
const brief = {
  version: 1 as const,
  viewpoint: '',
  pace: '',
  objective: '查清钥匙去向',
  requiredFacts: '',
  forbiddenEvents: '',
  characters: ['林舟'],
  chapterGoals: [],
}
const snapshot: ContinuationSnapshotV1 = {
  version: 1,
  contextPolicyVersion: 1,
  anchor: { chapterId: 'c5', title: '第五章', sortOrder: 5 },
  context: '',
  profiles: { plot: '', relationship: '', style: '' },
  profileSources: {},
  profileRevisions: {},
  profileBaseRevisions: {},
  excludedProfiles: [],
}
const findings = [
  {
    category: 'consistency',
    severity: 'warning',
    description: '钥匙归属可能不一致',
    draftQuote: '钥匙在林舟手里',
    evidence: [{ sourceId: 'chapter:c1', quote: '钥匙交给沈月' }],
  },
]
const response = { text: JSON.stringify({ findings }), model: 'test', promptTokens: 10, completionTokens: 15, cost: 0.1, finishReason: 'stop' }
async function draft() {
  return (await t.db.query<GenerationRow>("SELECT * FROM ai_generations WHERE id = 'd1'")).rows[0]!
}
beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  // Full migrations may swap on small hosts; functional test deadlines stay unchanged.
}, 120_000)
afterAll(async () => {
  await t.close()
})
beforeEach(async () => {
  await t.db.query('DELETE FROM ai_generations')
  await t.db.query('DELETE FROM novels')
  await t.db.query("INSERT INTO novels (id, title, created_at, updated_at) VALUES ('book', '本书', 1, 1), ('other', '别书', 1, 1)")
  for (const [id, book, content, order] of [
    ['c1', 'book', '林舟把钥匙交给沈月，约定三日后重逢。', 1],
    ['c5', 'book', '第五章的最近进展。', 5],
    ['c6', 'book', '林舟的未来秘密。', 6],
    ['other', 'other', '林舟在别书的秘密。', 1],
  ] as const)
    await t.db.query('INSERT INTO chapters (id, novel_id, title, content, sort_order, created_at) VALUES ($1,$2,$1,$3,$4,1)', [id, book, content, order])
  await t.db.query(
    "INSERT INTO ai_generations (id,novel_id,kind,result,status,created_at) VALUES ('d1','book','continue','钥匙在林舟手里，他并不知道来人身份。','draft',1)",
  )
  vi.mocked(chat).mockReset().mockResolvedValue(response)
  vi.mocked(recordUsage).mockReset().mockResolvedValue(undefined)
})

describe('writing history and quality workflow', () => {
  it('retrieves older matching evidence without future chapters, other books or drafts', async () => {
    const passages = await retrieveWritingHistory(t.db, 'book', snapshot.anchor, brief)
    expect(passages.map((p) => p.chapterId)).toEqual(['c1'])
    expect(passages[0]?.text).toContain('三日后重逢')
    expect(passages[0]?.matchedTerms).toContain('林舟')
    expect(await retrieveWritingHistory(t.db, 'book', snapshot.anchor)).toEqual([])
    const before = writingMaterialRevision({ ...snapshot, historicalPassages: passages }, brief)
    await t.db.query("UPDATE chapters SET content = '林舟改变了承诺' WHERE id = 'c1'")
    expect(writingMaterialRevision({ ...snapshot, historicalPassages: await retrieveWritingHistory(t.db, 'book', snapshot.anchor, brief) }, brief)).not.toBe(
      before,
    )
  })
  it('validates character names without changing legacy briefs', () => {
    expect(validateWritingBrief(brief).brief?.characters).toEqual(['林舟'])
    expect(validateWritingBrief({ ...brief, characters: [1] }).error).toBeTruthy()
    expect(validateWritingBrief({ ...brief, characters: Array(21).fill('林舟') }).error).toBeTruthy()
  })
  it('returns evidence-backed findings and reuses the same version without extra billing', async () => {
    const row = await draft()
    const snap = { ...snapshot, historicalPassages: await retrieveWritingHistory(t.db, 'book', snapshot.anchor, brief) }
    const opts = { userId: 'test', expectedRevision: generationContentRevision(row.result) }
    const result = await reviewWritingDraft(t.db, row, snap, opts)
    expect(result.findings).toEqual(findings)
    expect(await reviewWritingDraft(t.db, row, snap, opts)).toEqual(result)
    expect(chat).toHaveBeenCalledTimes(1)
    expect(recordUsage).toHaveBeenCalledTimes(1)
    expect((await draft()).result).toBe(row.result)
    await t.db.query("UPDATE chapters SET content = '来源已修改' WHERE id = 'c1'")
    expect(await reviewSourcesCurrent(t.db, 'book', result.sources, result.anchorId)).toBe(false)
  })
  it('rejects fabricated evidence and draft quotations, accounts for invalid replies', async () => {
    const row = await draft()
    vi.mocked(chat).mockResolvedValueOnce({
      ...response,
      text: JSON.stringify({ findings: [{ ...findings[0], evidence: [{ sourceId: 'chapter:other', quote: '别书的秘密' }] }] }),
    })
    await expect(reviewWritingDraft(t.db, row, snapshot, { userId: 'test', expectedRevision: generationContentRevision(row.result) })).rejects.toThrow(
      '来源无法核对',
    )
    expect(recordUsage).toHaveBeenCalledTimes(1)
    expect(() => parseReview(JSON.stringify({ findings: [{ ...findings[0], draftQuote: '草稿没有这句话' }] }), row.result, [])).toThrow('草稿片段不存在')
  })
  it('does not accept results after edits while a paid check is running', async () => {
    const row = await draft()
    vi.mocked(chat).mockImplementationOnce(async () => {
      await t.db.query("UPDATE ai_generations SET result = '改写了' WHERE id = 'd1'")
      return response
    })
    await expect(reviewWritingDraft(t.db, row, snapshot, { userId: 'test', expectedRevision: generationContentRevision(row.result) })).rejects.toThrow(
      '检查期间已变化',
    )
    expect((await t.db.query("SELECT * FROM ai_writing_reviews WHERE status = 'completed'")).rows).toHaveLength(0)
    expect(recordUsage).toHaveBeenCalledTimes(1)
  })
  it('keeps foreshadow findings as reminders rather than publication blockers', () => {
    const source = { id: 'plot', title: '情节档案', text: '三日后重逢的约定尚未兑现', fingerprint: 'test' }
    const parsed = parseReview(
      JSON.stringify({
        findings: [
          { category: 'foreshadow', severity: 'warning', description: '留意约定', draftQuote: '', evidence: [{ sourceId: 'plot', quote: '三日后重逢的约定' }] },
        ],
      }),
      '本章没有涉及约定',
      [source],
    )
    expect(parsed[0]?.severity).toBe('info')
  })

  it('coalesces concurrent checks through the lease and accounts truncated responses', async () => {
    const row = await draft()
    let finish!: (value: typeof response) => void
    vi.mocked(chat).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const opts = { userId: 'test', expectedRevision: generationContentRevision(row.result) }
    const pending = reviewWritingDraft(t.db, row, snapshot, opts)
    await vi.waitFor(() => expect(chat).toHaveBeenCalledTimes(1))
    await expect(reviewWritingDraft(t.db, row, snapshot, opts)).rejects.toThrow('正在检查')
    finish({ ...response, finishReason: 'length' })
    await expect(pending).rejects.toThrow('未完整返回')
    expect(recordUsage).toHaveBeenCalledTimes(1)
    expect((await t.db.query("SELECT * FROM ai_writing_reviews WHERE status = 'completed'")).rows).toHaveLength(0)
    await reviewWritingDraft(t.db, row, snapshot, opts)
    expect(chat).toHaveBeenCalledTimes(2)
  })
})
