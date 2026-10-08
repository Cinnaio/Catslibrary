import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'
import { saveAiSettings } from '../services/ai/settings'
import { cancelAiTask, getAiTask } from '../services/ai/tasks'
import * as tasks from '../services/ai/tasks'
import type { AiImageResult } from '../services/ai/image'
import { hashParagraphText } from '@shared/thought-anchor'
import { checkQuota, recordUsage } from '../services/ai/usage'

const image = vi.hoisted(() => ({ generate: vi.fn(), configured: true }))
vi.mock('../services/ai/image', () => ({ generateImage: image.generate, isImageAiConfigured: () => image.configured,
  imageProvider: () => ({ baseUrl: 'https://image.test/v1' }), imageProviderLabel: () => 'image.test' }))

let t: TestDb
let admin = ''
let reader = ''
let input: Record<string, unknown>
let result: AiImageResult
const content = '雨落在青石板上，少年攥紧了断剑。\n巷口的灯笼被风吹得摇晃。'
const json = (body: unknown, token = admin, key = ''): RequestInit => ({ method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(body) })
// Hono 的通用响应将 JSON 视为 unknown；测试夹具在断言中校验动态载荷。
type TestResponse = Omit<Response, 'json'> & { json(): Promise<any> }
const request = async (path: string, init?: RequestInit): Promise<TestResponse> => await app.request(path, init) as TestResponse
const get = (path: string, token = '') => request(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
const generate = (body = input, token = admin, key = '') => request('/api/thoughts/image', json(body, token, key))
async function settled(id: string) {
  await vi.waitFor(async () => expect(['completed', 'failed', 'cancelled']).toContain((await getAiTask(t.db, id))?.status), { timeout: 5000, interval: 10 })
  return (await getAiTask(t.db, id))!
}
function deferredImage() {
  let resolve!: (value: AiImageResult) => void
  image.generate.mockImplementationOnce(() => new Promise<AiImageResult>((done) => { resolve = done }))
  return async () => { await vi.waitFor(() => expect(resolve).toBeTypeOf('function')); resolve(result) }
}

beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  process.env.DATABASE_URL = 'postgres://test/test'
  vi.stubEnv('COVER_FETCH_ENABLED', '0')
  const boot = await (await request('/api/auth/bootstrap-admin', json({ username: 'imageadmin', password: 'adminpass123' }, ''))).json()
  admin = boot.token
  await t.db.query('INSERT INTO invites (code, created_at) VALUES ($1, $2)', ['IMAGE-INVITE', Date.now()])
  const registration = await (await request('/api/auth/register', json({ username: 'imagereader', password: 'readerpass123', invite: 'IMAGE-INVITE' }, ''))).json()
  reader = registration.token
  const novel = await (await request('/api/novels', json({ title: '划选测试', author: '测试', contentRating: 'general' }))).json()
  const chapter = await (await request('/api/chapters', json({ novelId: novel.novel.id, title: '雨夜', content }))).json()
  input = { novelId: novel.novel.id, chapterId: chapter.chapter.id, paragraphIndex: 0, paragraphHash: hashParagraphText(content.split('\n')[0]!), selectedText: '雨落在青石板上', thoughtText: '我想象中的雨夜' }
  result = { data: await sharp({ create: { width: 2, height: 2, channels: 3, background: '#8899aa' } }).png().toBuffer(), contentType: 'image/png', model: 'image-model', cost: 0.02, promptTokens: 10, completionTokens: 0 }
})
beforeEach(async () => {
  image.generate.mockReset().mockResolvedValue(result)
  image.configured = true
  await t.db.query('DELETE FROM thoughts')
  await t.db.query('DELETE FROM ai_tasks')
  await t.db.query('DELETE FROM ai_usage')
  await t.db.query('DELETE FROM api_idempotency')
  await t.db.query('UPDATE chapters SET content = $1 WHERE id = $2', [content, input.chapterId])
  await t.db.query("UPDATE novels SET content_rating = 'general' WHERE id = $1", [input.novelId])
  await saveAiSettings(t.db, { selectionImageRoles: ['admin'], selectionImageDailyQuota: 10 })
})
afterAll(async () => { setDbForTests(null); delete process.env.DATABASE_URL; vi.unstubAllEnvs(); await t.close() })

describe('划选图片想法', () => {
  it('默认仅管理员可用；未登录、未授权、关闭及未配置均在调用模型前拒绝', async () => {
    expect((await (await get('/api/thoughts/image-capabilities', admin)).json()).allowed).toBe(true)
    expect((await (await get('/api/thoughts/image-capabilities', reader)).json()).allowed).toBe(false)
    expect((await generate(input, '')).status).toBe(401)
    expect((await generate(input, reader)).status).toBe(403)
    await saveAiSettings(t.db, { selectionImageRoles: [] })
    expect((await generate()).status).toBe(403)
    await saveAiSettings(t.db, { selectionImageRoles: ['reader'] })
    expect((await generate()).status).toBe(403)
    await saveAiSettings(t.db, { selectionImageRoles: ['admin'], selectionImageDailyQuota: 0 })
    expect((await generate()).status).toBe(403)
    await saveAiSettings(t.db, { selectionImageDailyQuota: 10 })
    image.configured = false
    expect((await generate()).status).toBe(503)
    expect(image.generate).not.toHaveBeenCalled()
  })

  it('生成、计费与发布图片想法，幂等重试复用任务，多窗口不能重复出图', async () => {
    const resolve = deferredImage()
    const first = await generate(input, admin, 'same-operation')
    expect(first.status).toBe(202)
    const { taskId } = await first.json()
    const replay = await generate(input, admin, 'same-operation')
    expect((await replay.json()).taskId).toBe(taskId)
    expect(replay.headers.get('X-Idempotent-Replay')).toBe('true')
    expect((await generate(input, admin, 'another-operation')).status).toBe(409)
    expect((await generate({ ...input, thoughtText: '不同参数' }, admin, 'same-operation')).status).toBe(409)
    await resolve()
    expect((await settled(taskId)).status).toBe('completed')
    expect(image.generate).toHaveBeenCalledTimes(1)
    const list = await (await get(`/api/thoughts?chapterId=${input.chapterId}`)).json()
    expect(list.thoughts).toHaveLength(1)
    expect(list.thoughts[0]).toMatchObject({ paragraphIndex: 0, paragraphHash: input.paragraphHash, selectedText: input.selectedText, thoughtText: input.thoughtText })
    const picture = await get(list.thoughts[0].imageUrl)
    expect(picture.status).toBe(200)
    expect(picture.headers.get('Content-Type')).toBe('image/webp')
    const usage = await t.db.query('SELECT image_count, cost_millicents::float8 AS cost_millicents, generation_type FROM ai_usage')
    expect(usage.rows).toEqual([{ image_count: 1, cost_millicents: 2000, generation_type: 'selection_image' }])
    const own = await (await get(`/api/thoughts/image-task?chapterId=${input.chapterId}`, admin)).json()
    expect(own.task.thought.id).toBe(list.thoughts[0].id)
    expect((await (await get(`/api/thoughts/image-task?taskId=${taskId}`, reader)).json()).task).toBeNull()
  })

  it('后台可授权读者；空配文生成默认想法，独立图片配额限制后续调用', async () => {
    const patch = { selectionImageRoles: ['reader'], selectionImageDailyQuota: 1 }
    expect((await request('/api/ai/settings', { ...json(patch, reader), method: 'PUT' })).status).toBe(403)
    const saved = await request('/api/ai/settings', { ...json(patch), method: 'PUT' })
    expect((await saved.json()).settings).toMatchObject(patch)
    expect((await (await get('/api/thoughts/image-capabilities', reader)).json()).allowed).toBe(true)
    const { taskId } = await (await generate({ ...input, thoughtText: '' }, reader)).json()
    expect((await settled(taskId)).status).toBe('completed')
    const list = await (await get(`/api/thoughts?chapterId=${input.chapterId}`)).json()
    expect(list.thoughts[0].thoughtText).toBe('根据这段文字生成的插画')
    const userId = (await getAiTask(t.db, taskId))!.userId
    expect(await checkQuota(t.db, userId, 1)).toMatchObject({ used: 0, ok: true })
    await recordUsage(t.db, { userId, model: 'text', provider: 'text.test', generationType: 'summary', promptTokens: 10, completionTokens: 5 })
    expect(await checkQuota(t.db, userId, 1)).toMatchObject({ used: 1, ok: false })
    expect((await generate(input, reader)).status).toBe(429)
    expect(image.generate).toHaveBeenCalledTimes(1)
  })

  it('拒绝不属于章节的文本、空选区及越界段落', async () => {
    expect((await generate({ ...input, selectedText: '并不存在的场景' })).status).toBe(409)
    expect((await generate({ ...input, selectedText: '' })).status).toBe(400)
    expect((await generate({ ...input, selectedText: '字'.repeat(201) })).status).toBe(400)
    expect((await generate({ ...input, paragraphIndex: -1 })).status).toBe(400)
    expect((await generate({ ...input, paragraphIndex: 1 })).status).toBe(409)
    expect((await generate({ ...input, paragraphHash: 'wrong' })).status).toBe(409)
    expect(image.generate).not.toHaveBeenCalled()
  })

  it('生成期间修改章节会失败，保留真实调用账单且不发布错误锚点', async () => {
    const resolve = deferredImage()
    const { taskId } = await (await generate()).json()
    await t.db.query('UPDATE chapters SET content = $1 WHERE id = $2', ['已修改的正文', input.chapterId])
    await resolve()
    expect((await settled(taskId)).error).toContain('章节已变更')
    expect((await t.db.query('SELECT id FROM thoughts')).rows).toHaveLength(0)
    expect((await t.db.query('SELECT id FROM ai_usage')).rows).toHaveLength(1)
  })

  it('生成期间撤销角色权限后不发布', async () => {
    const resolve = deferredImage()
    const { taskId } = await (await generate()).json()
    await saveAiSettings(t.db, { selectionImageRoles: [] })
    await resolve()
    expect((await settled(taskId)).error).toContain('权限已变更')
    expect((await t.db.query('SELECT id FROM thoughts')).rows).toHaveLength(0)
  })

  it('取消任务后迟到的上游结果不会重新发布', async () => {
    const update = vi.spyOn(tasks, 'updateAiTask')
    const resolve = deferredImage()
    const { taskId } = await (await generate()).json()
    await cancelAiTask(t.db, taskId)
    await resolve()
    await vi.waitFor(() => expect(update).toHaveBeenCalledWith(t.db, taskId, expect.objectContaining({ status: 'failed', error: '图片任务已结束或取消' })))
    expect((await getAiTask(t.db, taskId))?.status).toBe('cancelled')
    expect((await t.db.query('SELECT id FROM thoughts')).rows).toHaveLength(0)
    update.mockRestore()
  })

  it('上游失败记录失败任务，不生成空想法', async () => {
    image.generate.mockRejectedValueOnce(new Error('上游拒绝'))
    const { taskId } = await (await generate()).json()
    expect((await settled(taskId)).error).toBe('上游拒绝')
    expect((await t.db.query('SELECT id FROM thoughts')).rows).toHaveLength(0)
  })

  it('隐藏图片想法后禁止公开读取，管理员可审核，硬删除同时删除二进制', async () => {
    const { taskId } = await (await generate()).json()
    const task = await settled(taskId)
    const id = JSON.parse(task.result).thoughtId
    await request(`/api/thoughts?id=${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${admin}` } })
    expect((await get(`/api/thoughts/image/${id}`)).status).toBe(404)
    expect((await get(`/api/thoughts/image/${id}`, admin)).status).toBe(200)
    await request(`/api/thoughts?id=${id}&hard=1`, { method: 'DELETE', headers: { Authorization: `Bearer ${admin}` } })
    expect((await t.db.query('SELECT thought_id FROM thought_images')).rows).toHaveLength(0)
  })

  it('受限小说的生成和图片读取都要求内容访问权限', async () => {
    const { taskId } = await (await generate()).json()
    const id = JSON.parse((await settled(taskId)).result).thoughtId
    await saveAiSettings(t.db, { selectionImageRoles: ['admin', 'reader'] })
    await t.db.query("UPDATE novels SET content_rating = 'restricted' WHERE id = $1", [input.novelId])
    expect((await generate(input, reader)).status).toBe(403)
    expect((await get(`/api/thoughts/image/${id}`)).status).toBe(403)
    expect((await get(`/api/thoughts/image/${id}`, reader)).status).toBe(403)
    expect((await get(`/api/thoughts/image/${id}`, admin)).status).toBe(200)
  })

  it('受限章节在客户端读完 202 响应后仍能完成后台发布', async () => {
    await t.db.query("UPDATE novels SET content_rating = 'restricted' WHERE id = $1", [input.novelId])
    const resolve = deferredImage()
    const response = await generate()
    expect(response.status).toBe(202)
    const originalCookie = response.headers.get('Set-Cookie')
    const { taskId } = await response.json()
    await resolve()
    const task = await settled(taskId)
    expect(task.error).toBe('')
    expect(task.status).toBe('completed')
    expect(response.headers.get('Set-Cookie')).toBe(originalCookie)
    expect((await t.db.query('SELECT id FROM thoughts')).rows).toHaveLength(1)
  })
})
