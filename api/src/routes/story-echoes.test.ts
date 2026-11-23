import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { hashParagraphText } from '@shared/thought-anchor'
import type { CharacterCardResponse } from '@shared/character-cards'
import type { StoryEchoInput, StoryEchoResponse } from '@shared/story-echoes'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'
import { saveAiSettings } from '../services/ai/settings'
import { parseStoryEchoInput, resolveEchoAnchor } from '../services/ai/story-echoes'

let t: TestDb, token = '', sequence = 0, novelId = '', previousId = '', anchorId = '', otherId = ''
let input: StoryEchoInput
const selected = '他把那枚银铃重新系在伞柄上。'
const prior = '她把那枚银铃系在伞柄，约好雨天相见。'
const prefix = '雨声里，他握着银铃。'
const paragraph = prefix + selected + '未来秘密甲：银铃的主人将会离世。'
let generated: (prompt: { candidates: { candidateId: string; text: string }[] }) => unknown
const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
  const messages = JSON.parse(String(init?.body)).messages
  const prompt = JSON.parse(messages[messages.length - 1].content)
  const result = generated(prompt)
  return new Response(JSON.stringify({ model: 'echo-test-model', choices: [{ message: { content: JSON.stringify(result) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 120, completion_tokens: 30 } }), { headers: { 'Content-Type': 'application/json' } })
})
const json = (body: unknown, auth = token) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body) })
const request = (body: unknown = input, auth = token) => app.request('/api/ai/story-echoes', json(body, auth))
const usageCount = async () => Number((await t.db.query<{ count: number }>('SELECT count(*)::int AS count FROM ai_usage')).rows[0]!.count)

beforeAll(async () => {
  t = await createTestDb(); await t.applyMigrations(); setDbForTests(t.db)
  vi.stubEnv('DATABASE_URL', 'postgres://test/test'); vi.stubEnv('COVER_FETCH_ENABLED', '0')
  vi.stubEnv('AI_TEXT_BASE_URL', 'https://ai.test/v1'); vi.stubEnv('AI_TEXT_API_KEY', 'test-key'); vi.stubEnv('AI_TEXT_MODEL', 'echo-test-model')
  vi.stubGlobal('fetch', fetchMock)
  await app.request('/api/auth/bootstrap-admin', json({ username: 'echo-admin', password: 'adminpass123' }, ''))
  await t.db.query('INSERT INTO invites(code,created_at) VALUES($1,$2)', ['echo-invite', Date.now()])
  const registered = await app.request('/api/auth/register', json({ username: 'echo-reader', password: 'readerpass123', invite: 'echo-invite' }, ''))
  expect(registered.status).toBe(201)
  token = (await registered.json() as { token: string }).token
})
afterAll(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); setDbForTests(null); await t.close() })
beforeEach(async () => {
  fetchMock.mockClear()
  await t.db.query('DELETE FROM ai_usage'); await t.db.query('DELETE FROM ai_quota_reservations')
  await saveAiSettings(t.db, { dailyQuota: 30, recapEnabled: true })
  novelId = `echo-novel-${++sequence}`; previousId = `${novelId}-a`; anchorId = `${novelId}-m`; otherId = `${novelId}-b`
  await t.db.query('INSERT INTO novels(id,title,created_at,updated_at) VALUES($1,$2,0,0)', [novelId, '未来书名秘密'])
  for (const [id, order, content] of [[previousId, 1, prior], [otherId, 1, '清晨众人登上山顶。'], [anchorId, 2, paragraph], [`${novelId}-z`, 2, '同序后文秘密：银铃的真相。'], [`${novelId}-last`, 3, '后章秘密：银铃的真相。']] as const) {
    await t.db.query('INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at) VALUES($1,$2,$3,$4,$5,0)', [id, novelId, '标题不送入模型', content, order])
  }
  input = { chapterId: anchorId, paragraphIndex: 0, paragraphHash: hashParagraphText(paragraph), selectedText: selected }
  generated = prompt => ({ echoes: [{ candidateId: prompt.candidates.find(c => c.text.includes(prior))!.candidateId, quote: prior, explanation: '这枚银铃可能呼应两人先前在雨天相见的约定。' }] })
})

it('只发送选句之前的正文，并返回经过逐字核验的引文与定位', async () => {
  const response = await request(); expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  const result = await response.json() as StoryEchoResponse
  expect(result.items[0]!.source).toMatchObject({ chapterId: previousId, paragraphHash: hashParagraphText(prior), quote: prior })
  expect(result.generated).toBe(true); expect(result.cached).toBe(false)
  const body = String(fetchMock.mock.calls[0]![1]?.body)
  expect(body).toContain(prior); expect(body).toContain(prefix)
  for (const secret of ['未来秘密甲', '同序后文秘密', '后章秘密', '未来书名秘密', '标题不送入模型']) expect(body).not.toContain(secret)
  expect(await usageCount()).toBe(1)
})

it('模型补写、未知来源和重复条目不作为引文展示', async () => {
  generated = prompt => {
    const candidateId = prompt.candidates[0]!.candidateId
    return { echoes: [{ candidateId, quote: '这句原文其实从来没有出现过', explanation: '可能相关' },
      { candidateId: 'invented', quote: prior, explanation: '可能相关' },
      { candidateId, quote: prompt.candidates[0]!.text, explanation: '可能呼应' },
      { candidateId, quote: prompt.candidates[0]!.text, explanation: '重复' }] }
  }
  const result = await (await request()).json() as StoryEchoResponse
  expect(result.items).toHaveLength(1); expect(result.omitted).toBe(3)
})

it('错误锚点、跨段落和非法参数在调用 AI 前拒绝', async () => {
  expect((await request({ ...input, paragraphHash: 'wrong' })).status).toBe(409)
  expect((await request({ ...input, selectedText: '其他段落的不存在句子' })).status).toBe(409)
  expect((await request({ ...input, selectedText: '短' })).status).toBe(422)
  expect((await request({ ...input, sourceFormat: 'all' })).status).toBe(422)
  expect(fetchMock).not.toHaveBeenCalled(); expect(await usageCount()).toBe(0)
})

it('没有候选时不调用模型、不占额度', async () => {
  const text = '紫檀匣悄然合拢。'
  await t.db.query('UPDATE chapters SET content=$1 WHERE id=$2', [text, anchorId])
  await saveAiSettings(t.db, { dailyQuota: 0 })
  const response = await request({ ...input, selectedText: text, paragraphHash: hashParagraphText(text) })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ items: [], generated: false, candidateCount: 0 })
  expect(fetchMock).not.toHaveBeenCalled(); expect(await usageCount()).toBe(0)
})

it('缓存可在额度用完后复用；此前未命中的前文章节改动也使缓存失效', async () => {
  expect((await request()).status).toBe(200)
  await saveAiSettings(t.db, { dailyQuota: 1 })
  expect(await (await request()).json()).toMatchObject({ cached: true })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  await t.db.query('UPDATE chapters SET content=$1 WHERE id=$2', ['银铃在山顶响起。', otherId])
  expect((await request()).status).toBe(429)
  await saveAiSettings(t.db, { dailyQuota: 30 })
  expect(await (await request()).json()).toMatchObject({ cached: false })
  expect(fetchMock).toHaveBeenCalledTimes(2); expect(await usageCount()).toBe(2)
})

it('缓存不能绕过登录、内容权限和功能开关', async () => {
  expect((await request(input, '')).status).toBe(401)
  expect((await request()).status).toBe(200)
  await saveAiSettings(t.db, { recapEnabled: false })
  expect((await request()).status).toBe(403)
  await saveAiSettings(t.db, { recapEnabled: true })
  await t.db.query("UPDATE novels SET content_rating='restricted' WHERE id=$1", [novelId])
  expect((await request()).status).toBe(403)
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it('相同选段合并正在进行的请求，只占一次额度', async () => {
  let release!: () => void
  const barrier = new Promise<void>(resolve => { release = resolve })
  const original = fetchMock.getMockImplementation()!
  fetchMock.mockImplementationOnce(async (...args) => { await barrier; return original(...args) })
  const first = request()
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  const duplicate = request()
  const other = await request({ ...input, selectedText: '他把那枚银铃' })
  expect(other.status).toBe(409)
  release()
  const responses = await Promise.all([first, duplicate])
  expect(responses.map(r => r.status)).toEqual([200, 200])
  const results = await Promise.all(responses.map(r => r.json() as Promise<StoryEchoResponse>))
  expect(results.filter(r => r.cached)).toHaveLength(1)
  expect(fetchMock).toHaveBeenCalledTimes(1); expect(await usageCount()).toBe(1)
})

it('生成中目录移动会丢弃结果，仍如实记录已完成的调用', async () => {
  const original = fetchMock.getMockImplementation()!
  fetchMock.mockImplementationOnce(async (...args) => {
    await t.db.query('UPDATE chapters SET sort_order=9 WHERE id=$1', [previousId])
    return original(...args)
  })
  expect((await request()).status).toBe(409)
  expect(await usageCount()).toBe(1)
})

it('生成期间访问权限变化时不会返回已生成结果', async () => {
  const original = fetchMock.getMockImplementation()!
  fetchMock.mockImplementationOnce(async (...args) => {
    await t.db.query("UPDATE novels SET content_rating='restricted' WHERE id=$1", [novelId])
    return original(...args)
  })
  expect((await request()).status).toBe(403)
  expect(await usageCount()).toBe(1)
})

it('HTML、CR 历史段落和重复选句都以最早有效锚点限定上文', () => {
  const chapter = { id: 'c', novel_id: 'n', title: '章', sort_order: 1, content: `<p>银铃&amp;伞柄</p><p>${selected}后面的秘密${selected}</p>` }
  const anchor = resolveEchoAnchor(chapter, parseStoryEchoInput({ chapterId: 'c', paragraphIndex: 1,
    paragraphHash: hashParagraphText(selected + '后面的秘密' + selected), selectedText: selected }))
  expect(anchor.context).toBe('银铃&伞柄\n')
  expect(anchor.context).not.toContain('秘密')
  const raw = `银铃响起。\r${selected}后面的秘密`
  const cr = resolveEchoAnchor({ ...chapter, content: raw }, { chapterId: 'c', paragraphIndex: 0, paragraphHash: hashParagraphText(raw), selectedText: selected })
  expect(cr.context).toBe('银铃响起。 ')
})

it('原生端按纯文本段落返回 HTML 引文，Web 按源段落返回', async () => {
  const html = `<p>雨声响起<br>${prior}</p>`
  await t.db.query('UPDATE chapters SET content=$1 WHERE id=$2', [html, previousId])
  const web = await (await request()).json() as StoryEchoResponse
  expect(web.items[0]!.source).toMatchObject({ paragraphIndex: 0, paragraphHash: hashParagraphText('雨声响起' + prior) })
  const native = await (await request({ ...input, sourceFormat: 'text' })).json() as StoryEchoResponse
  expect(native.items[0]!.source).toMatchObject({ paragraphIndex: 1, paragraphHash: hashParagraphText(prior) })
})
it('无法解析的模型回复仍计入额度，并且不会被缓存成正常结果', async () => {
  await saveAiSettings(t.db, { dailyQuota: 1 })
  generated = () => '格式错误'
  expect((await request()).status).toBe(502)
  expect(await usageCount()).toBe(1)
  expect((await request()).status).toBe(429)
  expect(fetchMock).toHaveBeenCalledTimes(1)
})


const characterRequest = (body: unknown = input, auth = token) => app.request('/api/ai/character-card', json(body, auth))
async function prepareCharacter(name = '林舟') {
  const earlier = `${name}是许宁的同窗，那天两人一起抵达渡口。`
  const current = `渡口已经安静下来。${name}抬起头。后文秘密：他其实是另一人。`
  await t.db.query('UPDATE chapters SET content=$1 WHERE id=$2', [earlier, previousId])
  await t.db.query('UPDATE chapters SET content=$1 WHERE id=$2', [current, anchorId])
  input = { chapterId: anchorId, paragraphIndex: 0, paragraphHash: hashParagraphText(current), selectedText: name }
  generated = prompt => ({ clues: [{ candidateId: prompt.candidates.find(c => c.text.includes(earlier))!.candidateId,
    quote: earlier, explanation: '原文提到两人是同窗，一起抵达渡口。', kind: 'relationship', certainty: 'supported' }] })
  return earlier
}

it('人物小卡支持两字名字，只发送当前位置之前的文字并附上原文定位', async () => {
  const earlier = await prepareCharacter()
  const response = await characterRequest(); expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  const result = await response.json() as CharacterCardResponse
  expect(result.items[0]).toMatchObject({ kind: 'relationship', certainty: 'supported', source: { chapterId: previousId, quote: earlier, paragraphHash: hashParagraphText(earlier) } })
  const body = String(fetchMock.mock.calls[0]![1]?.body)
  expect(body).toContain(earlier)
  for (const forbidden of ['抬起头', '后文秘密', '未来书名秘密', '标题不送入模型', '同序后文秘密']) expect(body).not.toContain(forbidden)
  expect((await t.db.query<{ generation_type: string }>('SELECT generation_type FROM ai_usage')).rows[0]?.generation_type).toBe('character_card')
})

it('人物小卡剔除虚构引文、无完整名字和无效分类，保留身份未确认标记', async () => {
  const earlier = await prepareCharacter()
  generated = prompt => {
    const item = { candidateId: prompt.candidates[0]!.candidateId, quote: earlier, explanation: '同名是否指当前人物，尚不能确定。', kind: 'appearance', certainty: 'uncertain' }
    return { clues: [{ ...item, quote: '林舟从未说过的句子' }, { ...item, quote: '那天两人一起抵达渡口。' },
      { ...item, kind: 'ending' }, { ...item, certainty: 'certain' }, null, item] }
  }
  const result = await (await characterRequest()).json() as CharacterCardResponse
  expect(result.items).toHaveLength(1); expect(result.omitted).toBe(5)
  expect(result.items[0]?.certainty).toBe('uncertain')
})

it('人物小卡没有同名候选时不生成、不拆名字凑出其他人物', async () => {
  await prepareCharacter('南宫林舟')
  await t.db.query('UPDATE chapters SET content=$1 WHERE id=$2', ['林舟在河边，南宫家在山上。', previousId])
  const result = await (await characterRequest()).json() as CharacterCardResponse
  expect(result.items).toEqual([]); expect(result.generated).toBe(false)
  expect(fetchMock).not.toHaveBeenCalled(); expect(await usageCount()).toBe(0)
})

it('人物小卡同时保留较早和较近的候选，并报告检索截断', async () => {
  const earlier = await prepareCharacter()
  await t.db.query('UPDATE chapters SET sort_order=100 WHERE id=$1', [anchorId])
  await t.db.query(`INSERT INTO chapters(id,novel_id,title,content,sort_order,created_at)
    SELECT $1 || '-' || i, $1, '标题不送入模型', '林舟在第' || i || '处留下记录。', i, 0 FROM generate_series(3,67) i`, [novelId])
  const result = await (await characterRequest()).json() as CharacterCardResponse
  expect(result.limited).toBe(true); expect(result.candidateCount).toBeLessThanOrEqual(20)
  expect(result.searchedChapters).toBeLessThanOrEqual(60)
  const body = String(fetchMock.mock.calls[0]![1]?.body)
  expect(body).toContain(earlier); expect(body).toContain('林舟在第67处留下记录。')
})

it('人物小卡与回声分别缓存，复用小卡不重复计费且仍重验内容权限', async () => {
  const earlier = await prepareCharacter('南宫林舟')
  generated = prompt => { const entry = { candidateId: prompt.candidates[0]!.candidateId, quote: earlier, explanation: '原文中的人物线索。' }
    return { echoes: [entry], clues: [{ ...entry, kind: 'appearance', certainty: 'supported' }] } }
  expect((await request()).status).toBe(200)
  expect((await characterRequest()).status).toBe(200)
  const cached = await (await characterRequest()).json() as CharacterCardResponse
  expect(cached.cached).toBe(true); expect(cached.items[0]?.kind).toBe('appearance')
  expect(fetchMock).toHaveBeenCalledTimes(2); expect(await usageCount()).toBe(2)
  await t.db.query("UPDATE novels SET content_rating='restricted' WHERE id=$1", [novelId])
  expect((await characterRequest()).status).toBe(403)
})

it('人物小卡对未登录、关闭能力和非法名字拒绝生成', async () => {
  await prepareCharacter()
  expect((await characterRequest(input, '')).status).toBe(401)
  for (const name of ['', '人'.repeat(41)]) expect((await characterRequest({ ...input, selectedText: name })).status).toBe(422)
  await saveAiSettings(t.db, { recapEnabled: false })
  expect((await characterRequest()).status).toBe(403)
  const status = await (await app.request('/api/ai/status', { headers: { Authorization: `Bearer ${token}` } })).json() as { features: { characterCards: boolean } }
  expect(status.features.characterCards).toBe(false); expect(fetchMock).not.toHaveBeenCalled()
})

it('人物小卡生成期间正文变化时丢弃结果，并记录已发生的调用', async () => {
  await prepareCharacter()
  const original = fetchMock.getMockImplementation()!
  fetchMock.mockImplementationOnce(async (...args) => {
    await t.db.query('UPDATE chapters SET content=content || $1 WHERE id=$2', ['正文发生变化。', previousId])
    return original(...args)
  })
  expect((await characterRequest()).status).toBe(409)
  expect(await usageCount()).toBe(1)
})

it('人物小卡原生格式返回可在纯文本段落中定位的引用', async () => {
  const earlier = await prepareCharacter()
  await t.db.query('UPDATE chapters SET content=$1 WHERE id=$2', [`<p>雨停了<br>${earlier}</p>`, previousId])
  const result = await (await characterRequest({ ...input, sourceFormat: 'text' })).json() as CharacterCardResponse
  expect(result.items[0]?.source).toMatchObject({ paragraphIndex: 1, paragraphHash: hashParagraphText(earlier), quote: earlier })
})

it('人物小卡重复名字保守采用最早位置，不让同段较后文字进入模型', async () => {
  await prepareCharacter()
  const current = '林舟离开了。秘密乙：林舟换了身份。'
  await t.db.query('UPDATE chapters SET content=$1 WHERE id=$2', [current, anchorId])
  input.paragraphHash = hashParagraphText(current)
  expect((await characterRequest()).status).toBe(200)
  expect(String(fetchMock.mock.calls[0]![1]?.body)).not.toContain('秘密乙')
})
