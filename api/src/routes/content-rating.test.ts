/**
 * 方案 B：小说内容分级字段（content_rating）的端到端契约。
 *
 * 这些断言覆盖设计稿里点名的三个失败模式：
 *   1. PUT 响应体漏字段 → 改完分级接口仍返回旧值（静默，最难查）
 *   2. 列表筛选在未传参时被归一成 unknown → 变成强制筛选
 *   3. 规则预填把未命中的书写成 general → 把漏网作品「认证为安全」
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'

let t: TestDb

beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  process.env.DATABASE_URL = 'postgres://test/test'
  process.env.COVER_FETCH_ENABLED = '0'
})

afterAll(async () => {
  setDbForTests(null)
  delete process.env.DATABASE_URL
  delete process.env.COVER_FETCH_ENABLED
  await t.close()
})

interface Novel {
  id: string
  title: string
  author: string
  contentRating: string
  updatedAt: number
}

function json(method: string, body?: unknown, token?: string): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }
}

const req = (path: string, init?: RequestInit) => app.request(path, init)
const jsonOf = async <T>(res: Response): Promise<T> => (await res.json()) as T

interface RatingCounts {
  general: number
  restricted: number
  unknown: number
}

/** 读全库标注进度。计数用增量断言而非绝对值，避免被 fixture 变动误伤。 */
async function counts(): Promise<RatingCounts> {
  const data = await jsonOf<{ ratingCounts: RatingCounts }>(await req('/api/novels'))
  return data.ratingCounts
}

describe('小说内容分级字段（方案 B）', () => {
  let adminToken = ''
  let plainId = ''
  let adultId = ''

  it('准备：bootstrap 管理员并建两本书', async () => {
    const boot = await req('/api/auth/bootstrap-admin', json('POST', { username: 'admin', password: 'adminpass123', displayName: '站长' }))
    adminToken = (await jsonOf<{ token: string }>(boot)).token

    const plain = await req('/api/novels', json('POST', { title: '雾城来信', author: '某作者', categories: ['悬疑'] }, adminToken))
    expect(plain.status).toBe(201)
    plainId = (await jsonOf<{ novel: Novel }>(plain)).novel.id

    const adult = await req(
      '/api/novels',
      json('POST', { title: '暗涌', author: '某作者', categories: ['言情'], contentRating: 'restricted' }, adminToken),
    )
    expect(adult.status).toBe(201)
    adultId = (await jsonOf<{ novel: Novel }>(adult)).novel.id
  })

  it('未指定分级时默认 unknown，显式指定时原样持久化', async () => {
    const plain = await jsonOf<{ novel: Novel }>(await req(`/api/novels/${plainId}`))
    expect(plain.novel.contentRating).toBe('unknown')

    const adult = await jsonOf<{ novel: Novel }>(await req(`/api/novels/${adultId}`))
    expect(adult.novel.contentRating).toBe('restricted')
  })

  it('非法分级值一律归一为 unknown，而不是当成安全', async () => {
    const bad = await req('/api/novels', json('POST', { title: '脏数据', author: 'x', contentRating: 'safe' }, adminToken))
    expect(bad.status).toBe(201)
    expect((await jsonOf<{ novel: Novel }>(bad)).novel.contentRating).toBe('unknown')
    const tagged = await req('/api/novels', json('POST', { title: '脏数据但有成人标签', author: 'x', categories: ['h'], contentRating: 'safe' }, adminToken))
    expect((await jsonOf<{ novel: Novel }>(tagged)).novel.contentRating).toBe('restricted')
  })

  it('PUT 更新后响应体与读回值都是新分级（防止 ...existing 静默返回旧值）', async () => {
    const before = await jsonOf<{ novel: Novel }>(await req(`/api/novels/${plainId}`))
    const prevUpdatedAt = before.novel.updatedAt

    const put = await req(`/api/novels/${plainId}`, json('PUT', { contentRating: 'restricted' }, adminToken))
    expect(put.status).toBe(200)
    // 关键断言：响应体必须是新值。漏加该字段时这里是 'unknown'，而界面表现为「点了没反应」。
    expect((await jsonOf<{ novel: Novel }>(put)).novel.contentRating).toBe('restricted')

    const after = await jsonOf<{ novel: Novel }>(await req(`/api/novels/${plainId}`))
    expect(after.novel.contentRating).toBe('restricted')

    // 只改分级不改内容：其余字段不受影响
    expect(after.novel.title).toBe('雾城来信')
    expect(after.novel.updatedAt).toBeGreaterThanOrEqual(prevUpdatedAt)
  })

  it('PUT 不带 contentRating 时保持原值，不会被重置为 unknown', async () => {
    const put = await req(`/api/novels/${plainId}`, json('PUT', { title: '雾城来信（修订）' }, adminToken))
    expect(put.status).toBe(200)
    expect((await jsonOf<{ novel: Novel }>(put)).novel.contentRating).toBe('restricted')
  })

  it('未传 contentRating 时不施加筛选；显式传值时按值筛选', async () => {
    const all = await jsonOf<{ total: number }>(await req('/api/novels'))
    const base = await counts()
    // 未传参 → 全量，且进度统计覆盖全部书
    expect(base.general + base.restricted + base.unknown).toBe(all.total)
    expect(base.general).toBe(0)
    expect(base.restricted).toBe(3)

    const unknownOnly = await jsonOf<{ novels: Novel[]; total: number }>(await req('/api/novels?contentRating=unknown'))
    expect(unknownOnly.total).toBe(base.unknown)
    expect(unknownOnly.novels.every((n) => n.contentRating === 'unknown')).toBe(true)

    const restrictedOnly = await jsonOf<{ novels: Novel[]; total: number }>(await req('/api/novels?contentRating=restricted'))
    expect(restrictedOnly.total).toBe(base.restricted)
    expect(restrictedOnly.novels.every((n) => n.contentRating === 'restricted')).toBe(true)

    // 非法筛选值不构成筛选条件，也不报错
    const bogus = await jsonOf<{ total: number }>(await req('/api/novels?contentRating=bogus'))
    expect(bogus.total).toBe(all.total)
  })

  it('概览接口返回标注进度', async () => {
    const stats = await jsonOf<{ contentRating: RatingCounts }>(await req('/api/admin/stats', json('GET', undefined, adminToken)))
    expect(stats.contentRating).toEqual(await counts())
  })

  describe('分类标签与文本规则预填', () => {
    it('dryRun 只扫描不写入', async () => {
      const before = await counts()
      const res = await req('/api/novels', json('POST', { action: 'prefill-content-rating', dryRun: true }, adminToken))
      expect(res.status).toBe(200)
      const data = await jsonOf<{ applied: number; dryRun: boolean; unknown: number }>(res)
      expect(data.dryRun).toBe(true)
      expect(data.applied).toBe(0)
      expect(data.unknown).toBe(before.unknown)
      expect(await counts()).toEqual(before)
    })

    it('命中项写 restricted（由创建期漏判的书补判），未命中项保持 unknown', async () => {
      // 创建时会自动判级，所以这里必须绕过创建路径才能造出「带成人特征但仍是 unknown」的书。
      // 做法：先建成普通书，再直接改库把字段重置为 unknown，模拟历史遗留数据。
      const a = await req('/api/novels', json('POST', { title: '成人向未删减作品', author: 'x' }, adminToken))
      const b = await req('/api/novels', json('POST', { title: '普通书名', author: 'x', description: '18禁，高H' }, adminToken))
      const aId = (await jsonOf<{ novel: Novel }>(a)).novel.id
      const bId = (await jsonOf<{ novel: Novel }>(b)).novel.id
      // 创建期已判为 restricted（这本身是新建行为，见「创建时自动判级」用例）
      expect((await jsonOf<{ novel: Novel }>(await req(`/api/novels/${aId}`))).novel.contentRating).toBe('restricted')

      // 还原为 unknown，模拟预填上线前的存量数据
      await t.db.query(`UPDATE novels SET content_rating = 'unknown' WHERE id IN ($1, $2)`, [aId, bId])

      const before = await counts()
      const updatedAtBefore = Object.fromEntries((await jsonOf<{ novels: Novel[] }>(await req('/api/novels?limit=100'))).novels.map((n) => [n.id, n.updatedAt]))

      const res = await req('/api/novels', json('POST', { action: 'prefill-content-rating' }, adminToken))
      const data = await jsonOf<{ scanned: number; matched: number; applied: number; ids: string[]; unknown: number }>(res)
      expect(data.matched).toBe(2)
      expect(data.applied).toBe(2)

      // 红线：预填不产生任何 general
      const after = await counts()
      expect(after.general).toBe(0)
      expect(after.restricted).toBe(before.restricted + 2)
      expect(after.unknown).toBe(before.unknown - 2)

      // 分级是治理属性而非内容更新：不得刷新 updated_at（否则存量书会被顶到首页最前）
      const touched = await jsonOf<{ novels: Novel[] }>(await req('/api/novels?contentRating=restricted&limit=100'))
      for (const n of touched.novels) {
        if (n.id in updatedAtBefore) expect(n.updatedAt).toBe(updatedAtBefore[n.id])
      }

      // 回滚：把这次预填的 id 退回 unknown
      const undo = await req('/api/novels', json('POST', { action: 'undo-prefill-content-rating', ids: data.ids }, adminToken))
      expect(undo.status).toBe(200)
      expect((await jsonOf<{ restored: number }>(undo)).restored).toBe(2)
      expect(await counts()).toEqual(before)
    })

    it('创建时自动判级：成人标签或限制级文本命中即落 restricted，绝不落 general', async () => {
      // 成人标签（精确匹配，不靠子串）
      const byTag = await req('/api/novels', json('POST', { title: '某文', author: 'x', categories: ['h'] }, adminToken))
      expect((await jsonOf<{ novel: Novel }>(byTag)).novel.contentRating).toBe('restricted')

      // Both admin creation forms send unknown as their default. It must not
      // suppress automatic rating when the metadata contains an adult tag.
      const defaultForm = await req('/api/novels', json('POST', { title: '表单新书', author: 'x', categories: ['h'], contentRating: 'unknown' }, adminToken))
      expect((await jsonOf<{ novel: Novel }>(defaultForm)).novel.contentRating).toBe('restricted')

      // 标签 `np` + 清水题材混搭
      const byTag2 = await req('/api/novels', json('POST', { title: '另一文', author: 'x', categories: ['np', '校园'] }, adminToken))
      expect((await jsonOf<{ novel: Novel }>(byTag2)).novel.contentRating).toBe('restricted')

      // 全角标签经归一化后同样命中
      const byFullWidth = await req('/api/novels', json('POST', { title: '全角标签', author: 'x', categories: ['高Ｈ'] }, adminToken))
      expect((await jsonOf<{ novel: Novel }>(byFullWidth)).novel.contentRating).toBe('restricted')

      // 文本特征命中
      const byText = await req('/api/novels', json('POST', { title: '标题正常', author: 'x', description: '18禁，高H' }, adminToken))
      expect((await jsonOf<{ novel: Novel }>(byText)).novel.contentRating).toBe('restricted')

      // 都不命中 → unknown（而不是 general：系统不替运营做「安全」的承诺）
      const clean = await req('/api/novels', json('POST', { title: '雾城来信', author: 'x', categories: ['玄幻'] }, adminToken))
      expect((await jsonOf<{ novel: Novel }>(clean)).novel.contentRating).toBe('unknown')

      // 显式指定优先于规则
      const explicit = await req('/api/novels', json('POST', { title: '成人向', author: 'x', categories: ['h'], contentRating: 'general' }, adminToken))
      expect((await jsonOf<{ novel: Novel }>(explicit)).novel.contentRating).toBe('general')
    })

    it('预填不覆盖已人工判定的书', async () => {
      // 人工把一本文本命中的书判成 general
      const target = await req('/api/novels', json('POST', { title: '成人向但已复核为一般', author: 'x', contentRating: 'general' }, adminToken))
      const targetId = (await jsonOf<{ novel: Novel }>(target)).novel.id
      const generalBefore = (await counts()).general

      await req('/api/novels', json('POST', { action: 'prefill-content-rating' }, adminToken))

      const after = await jsonOf<{ novel: Novel }>(await req(`/api/novels/${targetId}`))
      expect(after.novel.contentRating).toBe('general')
      // general 只会增不减，且预填不得把它改成 restricted
      expect((await counts()).general).toBe(generalBefore)
    })

    it('更新未判定书的元数据会补判，人工 general 仍优先', async () => {
      const pending = await req('/api/novels', json('POST', { title: '待判作品', author: 'x', contentRating: 'unknown' }, adminToken))
      const id = (await jsonOf<{ novel: Novel }>(pending)).novel.id
      const updated = await req(`/api/novels/${id}`, json('PUT', { categories: ['h'], contentRating: 'unknown' }, adminToken))
      expect((await jsonOf<{ novel: Novel }>(updated)).novel.contentRating).toBe('restricted')

      const reviewed = await req(`/api/novels/${id}`, json('PUT', { contentRating: 'general' }, adminToken))
      expect((await jsonOf<{ novel: Novel }>(reviewed)).novel.contentRating).toBe('general')
      const afterMetadataUpdate = await req(`/api/novels/${id}`, json('PUT', { description: '18禁，高H' }, adminToken))
      expect((await jsonOf<{ novel: Novel }>(afterMetadataUpdate)).novel.contentRating).toBe('general')
    })
  })
})
