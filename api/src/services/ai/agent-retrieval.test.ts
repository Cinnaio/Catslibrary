import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../../test/db'
import { createAgentSession } from './agent-store'
import { executeAgentTool, validateAgentCall } from './agent-tools'
import { readAgentChapter, readAgentProfiles, searchAgentStory } from './agent-retrieval'
import { loadProfileSample } from './profile-source'
import { cleanStoryText } from './story-memory'
import { getEffectiveProfileForAnchor, saveProfileOverride } from './profile-overrides'
import type { AgentSession } from '@shared/ai-agent'

let t: TestDb
let session: AgentSession
async function chapter(id: string, content: string, order = 1, novel = 'book', title = id) {
  await t.db.query('INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES($1,$2,$3,$4,$5,1)', [id, novel, title, content, order])
}
async function archive(kind: 'plot' | 'relationship', content: string, anchor = 'anchor') {
  const sample = await loadProfileSample(t.db, { novelId: 'book', afterChapterId: anchor, sampleCount: 1, fullHistory: true, clean: cleanStoryText })
  const table = kind === 'plot' ? 'novel_plot_states' : 'novel_relationship_profiles'
  const column = kind === 'plot' ? 'state' : 'profile'
  await t.db.query(`INSERT INTO ${table}(novel_id,${column},source_json,created_at,updated_at) VALUES('book',$1,$2,1,1)`, [
    content,
    JSON.stringify(sample!.source),
  ])
}
beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  await t.db.query("INSERT INTO users(id,username,role,password_hash,password_salt,created_at,updated_at) VALUES('author','author','admin','test','test',1,1)")
})
beforeEach(async () => {
  await t.db.query('DELETE FROM ai_agent_sessions')
  await t.db.query('DELETE FROM novels')
  for (const id of ['book', 'other', 'empty']) await t.db.query('INSERT INTO novels(id,title,created_at,updated_at) VALUES($1,$1,1,1)', [id])
  await chapter('early', '林岚在灯塔找到铜钥匙。沈舟尚未和她和解。', 1, 'book', '第一章 灯塔')
  await chapter('anchor', '林岚回到雨港，仍保管着铜钥匙。', 2, 'book', '第二章 雨港')
  await chapter('z-tied-future', '林岚在灯塔销毁铜钥匙。', 2)
  await chapter('future', '林岚和沈舟已和解。', 3)
  await chapter('foreign', '林岚交出铜钥匙。', 1, 'other')
  session = await createAgentSession(t.db, 'author', { novelId: 'book', afterChapterId: 'anchor' })
})
afterAll(async () => {
  await t.close()
})

describe('Agent evidence retrieval', () => {
  it('ranks multi-keyword passages and keeps source offsets and original text', async () => {
    const result = await searchAgentStory(t.db, session, '林岚 灯塔 铜钥匙')
    expect(result.sources[0]).toMatchObject({ chapterId: 'early', origin: 'published', excerpt: '林岚在灯塔找到铜钥匙。沈舟尚未和她和解。', offset: 0 })
    expect(result.sources.every((source) => ['early', 'anchor'].includes(source.chapterId || ''))).toBe(true)
    expect(result.readMore[0]).toMatchObject({
      tool: 'read_chapter',
      url: '/read/book/early',
      arguments: { chapterId: 'early', expectedRevision: result.sources[0]!.revision },
    })
    expect(result.matchingChapters).toBe(2)
  })
  it('rejects cross-book, later chapters and chapters after the id tie-breaker', async () => {
    for (const id of ['foreign', 'future', 'z-tied-future']) await expect(readAgentChapter(t.db, session, id)).rejects.toMatchObject({ status: 404 })
    const overview = await executeAgentTool(t.db, session, 'read_overview', {}, 'op', async () => ({}))
    expect((overview.chapters as Array<{ id: string }>).map((ch) => ch.id)).toEqual(['anchor', 'early'])
    expect(overview.sources).toEqual([expect.objectContaining({ chapterId: 'anchor' })])
  })
  it('does not turn an originally empty conversation into a latest-chapter view', async () => {
    const empty = await createAgentSession(t.db, 'author', { novelId: 'empty' })
    await chapter('later-zero', '林岚发现钥匙。', 0, 'empty')
    expect((await searchAgentStory(t.db, empty, '林岚')).sources).toEqual([])
    await expect(readAgentChapter(t.db, empty, 'later-zero')).rejects.toMatchObject({ status: 404 })
    expect((await readAgentProfiles(t.db, empty)).profiles).toEqual([])
  })
  it('finds late passages and continues reading with UTF-16 offsets', async () => {
    const content = '雨'.repeat(14000) + '🌧️林岚找到密函。' + '路'.repeat(14000)
    await t.db.query('UPDATE chapters SET content=$1 WHERE id=$2', [content, 'early'])
    const result = await searchAgentStory(t.db, session, '密函', 'chapter')
    const source = result.sources[0]!
    expect(source.offset).toBeGreaterThan(12000)
    expect(source.excerpt).toContain('林岚找到密函')
    expect(source.excerpt).toBe(content.slice(source.offset, source.endOffset))
    const read = await readAgentChapter(t.db, session, 'early', source.offset, source.revision)
    expect(read.content).toBe(content.slice(source.offset, source.offset + 12000))
    expect(read.nextOffset).toBe(source.offset + 12000)
  })
  it('escapes LIKE wildcards and rejects empty or excessive keywords', async () => {
    await t.db.query("UPDATE chapters SET content='进度 100%_done，原样保留。' WHERE id='early'")
    expect((await searchAgentStory(t.db, session, '%_', 'chapter')).sources.map((s) => s.chapterId)).toEqual(['early'])
    await expect(searchAgentStory(t.db, session, '   ')).rejects.toMatchObject({ status: 422 })
    await expect(searchAgentStory(t.db, session, '一 二 三 四 五 六 七')).rejects.toMatchObject({ status: 422 })
    expect(() =>
      validateAgentCall({ id: 'read', type: 'function', function: { name: 'search_story', arguments: '{"query":"林岚","kind":"private","novelId":"other"}' } }),
    ).toThrow()
  })
  it('detects changed chapter evidence before continuing a quoted passage', async () => {
    const read = await readAgentChapter(t.db, session, 'early')
    await t.db.query("UPDATE chapters SET content='林岚没有拿到钥匙。' WHERE id='early'")
    await expect(readAgentChapter(t.db, session, 'early', 0, read.revision)).rejects.toMatchObject({ status: 409 })
    const fresh = await searchAgentStory(t.db, session, '林岚', 'chapter')
    expect(fresh.sources.find((s) => s.chapterId === 'early')?.revision).not.toBe(read.revision)
  })
  it('includes valid plot and character archives with explicit analysis provenance', async () => {
    await archive('plot', '林岚持有铜钥匙，灯塔密函仍是未解线索。')
    await archive('relationship', '林岚与沈舟仍有误会，尚未和解。')
    const result = await searchAgentStory(t.db, session, '林岚')
    for (const kind of ['plot', 'relationship'])
      expect(result.sources).toContainEqual(expect.objectContaining({ kind, origin: 'automatic', throughChapter: { id: 'anchor', title: '第二章 雨港' } }))
    expect((await searchAgentStory(t.db, session, '沈舟', 'relationship')).sources.every((s) => s.kind === 'relationship')).toBe(true)
  })
  it.each(['edited', 'future', 'older', 'legacy'] as const)('excludes %s archives instead of exposing their stale contents', async (state) => {
    await archive('plot', '秘密档案林岚结局', state === 'future' ? 'future' : state === 'older' ? 'early' : 'anchor')
    if (state === 'edited') await t.db.query("UPDATE chapters SET content='已修订' WHERE id='early'")
    if (state === 'legacy') await t.db.query("UPDATE novel_plot_states SET source_json='' WHERE novel_id='book'")
    const result = await searchAgentStory(t.db, session, '秘密档案', 'plot')
    expect(result.sources).toEqual([])
    expect(result.archives[0]!.eligibility).not.toBe('usable')
    expect(JSON.stringify(result)).not.toContain('林岚结局')
  })
  it('respects manual corrections and detects a correction changed after retrieval', async () => {
    await archive('plot', '林岚已经丢失铜钥匙。')
    const automatic = await getEffectiveProfileForAnchor(t.db, { novelId: 'book', kind: 'plot', afterChapterId: 'anchor' })
    await saveProfileOverride(t.db, {
      novelId: 'book',
      kind: 'plot',
      content: '人工核对：林岚仍持有铜钥匙。',
      expectedRevision: 0,
      baseProfileRevision: automatic.baseProfileRevision,
      updatedBy: 'author',
      afterChapterId: 'anchor',
    })
    const found = await searchAgentStory(t.db, session, '铜钥匙', 'plot')
    expect(found.sources[0]).toMatchObject({ origin: 'manual', excerpt: '人工核对：林岚仍持有铜钥匙。' })
    await t.db.query("UPDATE novel_ai_profile_overrides SET content='再次校正',revision=revision+1 WHERE novel_id='book'")
    await expect(readAgentProfiles(t.db, session, 'plot', 0, found.sources[0]!.revision)).rejects.toMatchObject({ status: 409 })
  })
  it('keeps conflicting archive and chapter quotations distinct without reconciling them', async () => {
    await archive('plot', '林岚已经丢失铜钥匙。')
    const result = await searchAgentStory(t.db, session, '铜钥匙')
    expect(result.sources).toContainEqual(expect.objectContaining({ kind: 'plot', origin: 'automatic', excerpt: '林岚已经丢失铜钥匙。' }))
    expect(result.sources).toContainEqual(expect.objectContaining({ kind: 'chapter', chapterId: 'anchor', origin: 'published', excerpt: '林岚回到雨港，仍保管着铜钥匙。' }))
    expect(result.readMore.filter(item => item.tool === 'read_chapter').every(item => item.url?.startsWith('/read/book/'))).toBe(true)
  })
  it('returns no matches for an unmatched phrase without claiming exhaustive coverage', async () => {
    const result = await executeAgentTool(t.db, session, 'search_chapters', { query: '林岚 沈舟' }, 'phrase', async () => ({}))
    expect(result.sources).toEqual([])
    expect(result.matchingChapters).toBe(0)
    expect(result.limited).toBe(true)
    expect((await searchAgentStory(t.db, session, '林岚 沈舟')).sources.length).toBeGreaterThan(0)
  })
  it('retrieves archive content beyond the old 10k cutoff and supports explicit continuation', async () => {
    const text = '背景记录。'.repeat(2500) + '林岚的密函里有灯塔坐标。' + '后续线索。'.repeat(100)
    await archive('plot', text)
    const found = await searchAgentStory(t.db, session, '灯塔坐标', 'plot')
    expect(found.sources[0]!.offset).toBeGreaterThan(10000)
    const first = await readAgentProfiles(t.db, session, 'plot')
    expect(first.profiles[0]!.nextOffset).toBe(10000)
    const tail = await readAgentProfiles(t.db, session, 'plot', 10000, first.profiles[0]!.revision)
    expect(tail.profiles[0]!.content).toContain('灯塔坐标')
    await expect(readAgentProfiles(t.db, session, undefined, 10000)).rejects.toMatchObject({ status: 422 })
  })
  it('reports omitted passages and paginates candidate chapters without a model call', async () => {
    for (let i = 0; i < 30; i++) await chapter(`extra-${i}`, `灯塔线索 ${i}`, 0)
    const first = await searchAgentStory(t.db, session, '灯塔', 'chapter')
    expect(first.sources).toHaveLength(6)
    expect(first.nextChapterOffset).toBe(6)
    expect(first.matchingChapters).toBe(31)
    const second = await searchAgentStory(t.db, session, '灯塔', 'chapter', first.nextChapterOffset!)
    expect(second.sources).toHaveLength(6)
    expect(second.nextChapterOffset).toBe(12)
    expect(second.sources.some((s) => first.sources.some((prev) => prev.chapterId === s.chapterId))).toBe(false)
    const last = await searchAgentStory(t.db, session, '灯塔', 'chapter', 30)
    expect(last.sources).toHaveLength(1)
    expect(last.nextChapterOffset).toBeNull()
    const afterEnd = await searchAgentStory(t.db, session, '灯塔', 'chapter', 100)
    expect(afterEnd.matchingChapters).toBe(31)
    expect(afterEnd.nextChapterOffset).toBeNull()
    expect(JSON.stringify(first.sources).length).toBeLessThan(15000)
  })
  it('fails closed if the frozen anchor is deleted', async () => {
    await t.db.query("DELETE FROM chapters WHERE id='anchor'")
    await expect(searchAgentStory(t.db, session, '林岚')).rejects.toMatchObject({ status: 409 })
  })
})
