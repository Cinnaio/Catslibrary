import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from '../../test/db'
import { chat } from './client'
import { recordUsage } from './usage'
import { extractRelationshipProfile } from './relationship-profile'
import { getEffectiveProfileForAnchor, saveProfileOverride } from './profile-overrides'
import { generateStoryGraph, getStoryGraph, validateStoryGraph } from './story-graph'

vi.mock('./client', async (original) => ({
  ...(await original<typeof import('./client')>()),
  chat: vi.fn(),
  isTextAiConfigured: () => true,
  textProvider: () => ({ baseUrl: 'https://example.test/v1' }),
}))
vi.mock('./settings', () => ({ getAiSettings: async () => ({ relationshipProfileMaxTokens: 4000 }) }))
vi.mock('./usage', () => ({ recordUsage: vi.fn() }))

const archive = '已确认事实：林舟与沈砚合作查案，彼此仍有隐瞒。[章节ID:c1]'
const evidence = [{ kind: 'relationship', quote: archive, chapterIds: ['c1'] }]
const graph = {
  people: [
    { id: 'p1', name: '林舟', aliases: [], summary: '调查案件', evidence },
    { id: 'p2', name: '沈砚', aliases: [], summary: '合作查案', evidence },
  ],
  relationships: [{ id: 'r1', from: 'p1', to: 'p2', label: '合作', summary: '合作但保留秘密', directed: false, certainty: 'fact', evidence }],
  threads: [],
}
const reply = (text: string) => ({ text, model: 'test', promptTokens: 20, completionTokens: 30, cost: 0.1, finishReason: 'stop' })
const opts = { novelId: 'book', userId: 'admin' }
let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
}, 30000)
afterAll(async () => {
  await t.close()
})
beforeEach(async () => {
  await t.db.query('DELETE FROM novels')
  await t.db.query("INSERT INTO novels (id, title, created_at, updated_at) VALUES ('book', '图谱隔离测试', 1, 1)")
  await t.db.query("INSERT INTO chapters (id, novel_id, title, content, sort_order, created_at) VALUES ('c1', 'book', '初遇', '林舟与沈砚合作调查。', 1, 1)")
  vi.mocked(chat).mockReset().mockResolvedValue(reply(archive))
  vi.mocked(recordUsage).mockReset().mockResolvedValue(undefined)
})
async function prepare() {
  await extractRelationshipProfile(t.db, opts)
  vi.mocked(chat).mockResolvedValue(reply(JSON.stringify(graph)))
}

describe('story graph archive boundary and cache', () => {
  it('does not call the model on reads and saves a reusable, billed graph', async () => {
    expect((await getStoryGraph(t.db, 'book')).status).toBe('unavailable')
    expect(chat).not.toHaveBeenCalled()
    await prepare()
    const result = await generateStoryGraph(t.db, opts)
    expect(result.status).toBe('ready')
    expect(result.graph?.relationships[0]).toMatchObject({ from: 'p1', to: 'p2', directed: false })
    expect(recordUsage).toHaveBeenLastCalledWith(t.db, expect.objectContaining({ generationType: 'story_graph', costMillicents: 10000 }))
    await generateStoryGraph(t.db, opts)
    expect(chat).toHaveBeenCalledTimes(2)
    expect((await getStoryGraph(t.db, 'book')).graph?.people).toHaveLength(2)
  })
  it('binds the graph to the anchor and never exposes later chapters at an earlier anchor', async () => {
    await prepare()
    await generateStoryGraph(t.db, opts)
    await t.db.query("INSERT INTO chapters (id, novel_id, title, content, sort_order, created_at) VALUES ('c2', 'book', '秘密', '后续剧情。', 2, 1)")
    expect(await getStoryGraph(t.db, 'book')).toMatchObject({ graph: null, status: 'unavailable' })
    expect((await getStoryGraph(t.db, 'book', 'c1')).status).toBe('ready')
    await expect(getStoryGraph(t.db, 'book', 'other-book-chapter')).rejects.toMatchObject({ status: 404 })
  })
  it('invalidates after manual correction and sends the effective manual content to the model', async () => {
    await prepare()
    await generateStoryGraph(t.db, opts)
    const current = await getEffectiveProfileForAnchor(t.db, { novelId: 'book', kind: 'relationship' })
    const corrected = archive + '\n分析推断：双方尚未建立信任。'
    await saveProfileOverride(t.db, {
      ...opts,
      kind: 'relationship',
      content: corrected,
      updatedBy: 'admin',
      expectedRevision: 0,
      baseProfileRevision: current.baseProfileRevision,
    })
    expect(await getStoryGraph(t.db, 'book')).toMatchObject({ graph: null, status: 'outdated' })
    await generateStoryGraph(t.db, opts)
    expect(vi.mocked(chat).mock.calls.at(-1)?.[0].messages[1]?.content).toContain('双方尚未建立信任')
  })
  it('records billed malformed/truncated results and preserves the original archive', async () => {
    await prepare()
    vi.mocked(chat).mockResolvedValueOnce({ ...reply('{'), finishReason: 'length' })
    await expect(generateStoryGraph(t.db, opts)).rejects.toMatchObject({ code: 'truncated' })
    expect(recordUsage).toHaveBeenCalledTimes(2)
    expect((await getStoryGraph(t.db, 'book')).status).toBe('missing')
    vi.mocked(chat).mockResolvedValueOnce(reply('not json'))
    await expect(generateStoryGraph(t.db, opts)).rejects.toMatchObject({ code: 'invalid' })
    expect(recordUsage).toHaveBeenCalledTimes(3)
    expect((await getEffectiveProfileForAnchor(t.db, { novelId: 'book', kind: 'relationship' })).effectiveContent).toBe(archive)
  })
  it('refuses to save when source changes during generation', async () => {
    await prepare()
    vi.mocked(chat).mockImplementationOnce(async () => {
      await t.db.query("UPDATE chapters SET content = '正文已经被编辑' WHERE id = 'c1'")
      return reply(JSON.stringify(graph))
    })
    await expect(generateStoryGraph(t.db, opts)).rejects.toMatchObject({ code: 'conflict' })
    expect((await t.db.query('SELECT * FROM novel_story_graphs')).rows).toHaveLength(0)
  })
  it('rejects a graph generated against an older archive revision even when text is identical', async () => {
    await prepare()
    vi.mocked(chat).mockImplementationOnce(async () => {
      const row = (await t.db.query<{ source_json: string }>("SELECT source_json FROM novel_relationship_profiles WHERE novel_id='book'")).rows[0]!
      await t.db.query("UPDATE novel_relationship_profiles SET source_json=$1 WHERE novel_id='book'", [JSON.stringify({ ...JSON.parse(row.source_json), rebuildRevision: 'new-rebuild' })])
      return reply(JSON.stringify(graph))
    })
    await expect(generateStoryGraph(t.db, opts)).rejects.toMatchObject({ code: 'conflict' })
    expect((await t.db.query('SELECT * FROM novel_story_graphs')).rows).toHaveLength(0)
  })
  it('rejects invented evidence, chapter links, dangling endpoints and duplicate people', () => {
    const input = {
      archives: [{ kind: 'relationship' as const, content: archive, chaptersThrough: 1, eligibility: 'usable', origin: 'automatic' }],
      chapters: [{ id: 'c1', title: '初遇', ordinal: 1 }],
    }
    expect(validateStoryGraph(graph, input).people).toHaveLength(2)
    for (const bad of [
      { ...graph, people: [{ ...graph.people[0], evidence: [{ kind: 'relationship', quote: '伪造的正文', chapterIds: [] }] }] },
      { ...graph, people: [{ ...graph.people[0], evidence: [{ ...evidence[0], chapterIds: ['c2'] }] }] },
      { ...graph, relationships: [{ ...graph.relationships[0], to: 'missing' }] },
      { ...graph, people: [graph.people[0], { ...graph.people[0], id: 'p3' }] },
      { ...graph, people: [{ ...graph.people[0], name: '凭空出现的人' }] },
    ])
      expect(() => validateStoryGraph(bad, input)).toThrow()
  })
})
