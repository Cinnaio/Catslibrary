import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { hashParagraphText } from '@shared/thought-anchor'
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
