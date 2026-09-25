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
async function counts(token = ''): Promise<RatingCounts> {
  const data = await jsonOf<{ ratingCounts: RatingCounts }>(await req('/api/novels', token ? json('GET', undefined, token) : undefined))
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

    const adult = await req('/api/novels', json('POST', { title: '暗涌', author: '某作者', categories: ['言情'], contentRating: 'restricted' }, adminToken))
    expect(adult.status).toBe(201)
    adultId = (await jsonOf<{ novel: Novel }>(adult)).novel.id
  })

  it('未指定分级时默认 unknown，显式指定时原样持久化', async () => {
    const plain = await jsonOf<{ novel: Novel }>(await req(`/api/novels/${plainId}`))
    expect(plain.novel.contentRating).toBe('unknown')

    const adult = await jsonOf<{ novel: Novel }>(await req(`/api/novels/${adultId}`, json('GET', undefined, adminToken)))
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
    const before = await jsonOf<{ novel: Novel }>(await req(`/api/novels/${plainId}`, json('GET', undefined, adminToken)))
    const prevUpdatedAt = before.novel.updatedAt

    const put = await req(`/api/novels/${plainId}`, json('PUT', { contentRating: 'restricted' }, adminToken))
    expect(put.status).toBe(200)
    // 关键断言：响应体必须是新值。漏加该字段时这里是 'unknown'，而界面表现为「点了没反应」。
    expect((await jsonOf<{ novel: Novel }>(put)).novel.contentRating).toBe('restricted')

    const after = await jsonOf<{ novel: Novel }>(await req(`/api/novels/${plainId}`, json('GET', undefined, adminToken)))
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
    const all = await jsonOf<{ total: number }>(await req('/api/novels', json('GET', undefined, adminToken)))
    const base = await counts(adminToken)
    // 未传参 → 全量，且进度统计覆盖全部书
    expect(base.general + base.restricted + base.unknown).toBe(all.total)
    expect(base.general).toBe(0)
    expect(base.restricted).toBe(3)

    const unknownOnly = await jsonOf<{ novels: Novel[]; total: number }>(await req('/api/novels?contentRating=unknown', json('GET', undefined, adminToken)))
    expect(unknownOnly.total).toBe(base.unknown)
    expect(unknownOnly.novels.every((n) => n.contentRating === 'unknown')).toBe(true)

    const restrictedOnly = await jsonOf<{ novels: Novel[]; total: number }>(
      await req('/api/novels?contentRating=restricted', json('GET', undefined, adminToken)),
    )
    expect(restrictedOnly.total).toBe(base.restricted)
    expect(restrictedOnly.novels.every((n) => n.contentRating === 'restricted')).toBe(true)

    // 非法筛选值不构成筛选条件，也不报错
    const bogus = await jsonOf<{ total: number }>(await req('/api/novels?contentRating=bogus', json('GET', undefined, adminToken)))
    expect(bogus.total).toBe(all.total)
  })

  it('概览接口返回标注进度', async () => {
    const stats = await jsonOf<{ contentRating: RatingCounts }>(await req('/api/admin/stats', json('GET', undefined, adminToken)))
    expect(stats.contentRating).toEqual(await counts(adminToken))
  })

  describe('分类标签与文本规则预填', () => {
    it('dryRun 只扫描不写入', async () => {
      const before = await counts(adminToken)
      const res = await req('/api/novels', json('POST', { action: 'prefill-content-rating', dryRun: true }, adminToken))
      expect(res.status).toBe(200)
      const data = await jsonOf<{ applied: number; dryRun: boolean; unknown: number }>(res)
      expect(data.dryRun).toBe(true)
      expect(data.applied).toBe(0)
      expect(data.unknown).toBe(before.unknown)
      expect(await counts(adminToken)).toEqual(before)
    })

    it('命中项写 restricted（由创建期漏判的书补判），未命中项保持 unknown', async () => {
      // 创建时会自动判级，所以这里必须绕过创建路径才能造出「带成人特征但仍是 unknown」的书。
      // 做法：先建成普通书，再直接改库把字段重置为 unknown，模拟历史遗留数据。
      const a = await req('/api/novels', json('POST', { title: '成人向未删减作品', author: 'x' }, adminToken))
      const b = await req('/api/novels', json('POST', { title: '普通书名', author: 'x', description: '18禁，高H' }, adminToken))
      const aId = (await jsonOf<{ novel: Novel }>(a)).novel.id
      const bId = (await jsonOf<{ novel: Novel }>(b)).novel.id
      // 创建期已判为 restricted（这本身是新建行为，见「创建时自动判级」用例）
      expect((await jsonOf<{ novel: Novel }>(await req(`/api/novels/${aId}`, json('GET', undefined, adminToken)))).novel.contentRating).toBe('restricted')

      // 还原为 unknown，模拟预填上线前的存量数据
      await t.db.query(`UPDATE novels SET content_rating = 'unknown' WHERE id IN ($1, $2)`, [aId, bId])

      const before = await counts(adminToken)
      const updatedAtBefore = Object.fromEntries(
        (await jsonOf<{ novels: Novel[] }>(await req('/api/novels?limit=100', json('GET', undefined, adminToken)))).novels.map((n) => [n.id, n.updatedAt]),
      )

      const res = await req('/api/novels', json('POST', { action: 'prefill-content-rating' }, adminToken))
      const data = await jsonOf<{ scanned: number; matched: number; applied: number; ids: string[]; unknown: number }>(res)
      expect(data.matched).toBe(2)
      expect(data.applied).toBe(2)

      // 红线：预填不产生任何 general
      const after = await counts(adminToken)
      expect(after.general).toBe(0)
      expect(after.restricted).toBe(before.restricted + 2)
      expect(after.unknown).toBe(before.unknown - 2)

      // 分级是治理属性而非内容更新：不得刷新 updated_at（否则存量书会被顶到首页最前）
      const touched = await jsonOf<{ novels: Novel[] }>(await req('/api/novels?contentRating=restricted&limit=100', json('GET', undefined, adminToken)))
      for (const n of touched.novels) {
        if (n.id in updatedAtBefore) expect(n.updatedAt).toBe(updatedAtBefore[n.id])
      }

      // 回滚：把这次预填的 id 退回 unknown
      const undo = await req('/api/novels', json('POST', { action: 'undo-prefill-content-rating', ids: data.ids }, adminToken))
      expect(undo.status).toBe(200)
      expect((await jsonOf<{ restored: number }>(undo)).restored).toBe(2)
      expect(await counts(adminToken)).toEqual(before)
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
      const generalBefore = (await counts(adminToken)).general

      await req('/api/novels', json('POST', { action: 'prefill-content-rating' }, adminToken))

      const after = await jsonOf<{ novel: Novel }>(await req(`/api/novels/${targetId}`, json('GET', undefined, adminToken)))
      expect(after.novel.contentRating).toBe('general')
      // general 只会增不减，且预填不得把它改成 restricted
      expect((await counts(adminToken)).general).toBe(generalBefore)
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

    it('分级管理接口返回来源与证据，并拒绝覆盖过期版本', async () => {
      const created = await req('/api/novels', json('POST', { title: '治理审计测试书', author: 'x', categories: ['h'] }, adminToken))
      const id = (await jsonOf<{ novel: Novel }>(created)).novel.id
      const list = await jsonOf<{ items: Array<{ id: string; contentRating: string; source: string; revision: number; evidence: Array<{ type: string }> }> }>(
        await req('/api/admin/content-ratings?search=治理审计测试书', json('GET', undefined, adminToken)),
      )
      const item = list.items.find((entry) => entry.id === id)
      expect(item?.contentRating).toBe('restricted')
      expect(item?.source).toBe('system')
      expect(item?.evidence.some((entry) => entry.type === 'category')).toBe(true)

      const manual = await req(
        `/api/admin/content-ratings/${id}`,
        json('PUT', { contentRating: 'general', reason: '人工复核后确认不属于限制级', expectedRevision: item!.revision }, adminToken),
      )
      expect(manual.status).toBe(200)
      const manualItem = (await jsonOf<{ item: { contentRating: string; source: string; revision: number } }>(manual)).item
      expect(manualItem.contentRating).toBe('general')
      expect(manualItem.source).toBe('manual')
      expect(manualItem.revision).toBe(item!.revision + 1)

      const conflict = await req(
        `/api/admin/content-ratings/${id}`,
        json('PUT', { contentRating: 'restricted', reason: '旧页面提交', expectedRevision: item!.revision }, adminToken),
      )
      expect(conflict.status).toBe(409)
      const conflictBody = await jsonOf<{ code: string; currentRevision: number }>(conflict)
      expect(conflictBody.code).toBe('content_rating_conflict')
      expect(conflictBody.currentRevision).toBe(manualItem.revision)

      const history = await jsonOf<{ history: Array<{ fromRating: string; toRating: string; source: string; reason: string }> }>(
        await req(`/api/admin/content-ratings/${id}/history`, json('GET', undefined, adminToken)),
      )
      expect(history.history[0]).toMatchObject({ fromRating: 'restricted', toRating: 'general', source: 'manual' })
      expect(history.history[0]?.reason).toContain('人工复核')
    })

    it('人工 restricted 作品可以沉淀待审核候选，但候选不会立即改变全局规则', async () => {
      const manual = await req('/api/novels', json('POST', { title: '人工候选来源书', author: 'x', contentRating: 'restricted' }, adminToken))
      const manualId = (await jsonOf<{ novel: Novel }>(manual)).novel.id

      const created = await req(
        '/api/admin/content-rating-rule-candidates',
        json(
          'POST',
          {
            novelId: manualId,
            kind: 'category',
            value: '新成人标签',
            reason: '人工复核确认该分类在本库语境下稳定指向限制级',
          },
          adminToken,
        ),
      )
      expect(created.status).toBe(201)
      const createdBody = await jsonOf<{
        created: boolean
        exampleAdded: boolean
        candidate: { kind: string; value: string; status: string; exampleCount: number }
      }>(created)
      expect(createdBody).toMatchObject({ created: true, exampleAdded: true })
      expect(createdBody.candidate).toMatchObject({ kind: 'category', value: '新成人标签', status: 'pending', exampleCount: 1 })

      const duplicate = await req(
        '/api/admin/content-rating-rule-candidates',
        json('POST', { novelId: manualId, kind: 'category', value: '新成人标签', reason: '再次补充同一本人工例证' }, adminToken),
      )
      expect(duplicate.status).toBe(200)
      const duplicateBody = await jsonOf<{ created: boolean; exampleAdded: boolean }>(duplicate)
      expect(duplicateBody.created).toBe(false)
      expect(duplicateBody.exampleAdded).toBe(false)

      const list = await req('/api/admin/content-rating-rule-candidates?status=pending', json('GET', undefined, adminToken))
      const listBody = await jsonOf<{ items: Array<{ value: string; exampleCount: number }>; counts: { pending: number } }>(list)
      expect(listBody.items.find((candidate) => candidate.value === '新成人标签')).toMatchObject({ exampleCount: 1 })
      expect(listBody.counts.pending).toBeGreaterThanOrEqual(1)

      const automatic = await req('/api/novels', json('POST', { title: '规则来源书', author: 'x', categories: ['h'] }, adminToken))
      const automaticId = (await jsonOf<{ novel: Novel }>(automatic)).novel.id
      const rejected = await req(
        '/api/admin/content-rating-rule-candidates',
        json('POST', { novelId: automaticId, kind: 'category', value: '另一个新标签', reason: '不能从自动命中直接沉淀人工候选' }, adminToken),
      )
      expect(rejected.status).toBe(422)
      expect((await jsonOf<{ code: string }>(rejected)).code).toBe('rule_candidate_source_invalid')
    })

    it('P2 会预览影响范围、保护审核并把批准规则用于 unknown 与新作品', async () => {
      const pendingBook = await req('/api/novels', json('POST', { title: '候选批准前仍待标注', author: 'x', categories: ['新成人标签'] }, adminToken))
      const pendingBookId = (await jsonOf<{ novel: Novel }>(pendingBook)).novel.id
      expect((await jsonOf<{ novel: Novel }>(await req(`/api/novels/${pendingBookId}`, json('GET', undefined, adminToken)))).novel.contentRating).toBe(
        'unknown',
      )

      const candidates = await jsonOf<{
        items: Array<{ id: string; value: string; revision: number; status: string }>
        activeRuleVersion: string
      }>(await req('/api/admin/content-rating-rule-candidates?status=pending&search=新成人标签', json('GET', undefined, adminToken)))
      const categoryCandidate = candidates.items.find((candidate) => candidate.value === '新成人标签')
      expect(categoryCandidate).toMatchObject({ status: 'pending' })
      expect(categoryCandidate?.revision).toBeGreaterThan(0)

      const preview = await req(`/api/admin/content-rating-rule-candidates/${categoryCandidate!.id}/preview`, json('GET', undefined, adminToken))
      expect(preview.status).toBe(200)
      const previewBody = await jsonOf<{ affectedCount: number; prospectiveRuleVersion: string; items: Array<{ novelId: string; matchedFields: string[] }> }>(
        preview,
      )
      expect(previewBody.affectedCount).toBeGreaterThanOrEqual(1)
      expect(previewBody.items.some((item) => item.novelId === pendingBookId)).toBe(true)
      expect(previewBody.prospectiveRuleVersion).toMatch(/^restricted-rules-v2-/)

      const approved = await req(
        `/api/admin/content-rating-rule-candidates/${categoryCandidate!.id}/review`,
        json('POST', { decision: 'approve', expectedRevision: categoryCandidate!.revision, reason: '影响范围确认，批准作为分类自动规则' }, adminToken),
      )
      expect(approved.status).toBe(200)
      const approvedBody = await jsonOf<{ decision: string; ruleVersion: string; matchedCount: number; appliedCount: number; candidate: { status: string } }>(
        approved,
      )
      expect(approvedBody).toMatchObject({ decision: 'approve', candidate: { status: 'approved' } })
      expect(approvedBody.ruleVersion).toMatch(/^restricted-rules-v2-/)
      expect(approvedBody.matchedCount).toBeGreaterThanOrEqual(1)
      expect(approvedBody.appliedCount).toBeGreaterThanOrEqual(1)

      const applied = await jsonOf<{
        items: Array<{ id: string; contentRating: string; source: string; ruleVersion: string; evidence: Array<{ type: string; rule?: string }> }>
      }>(await req(`/api/admin/content-ratings?search=候选批准前仍待标注`, json('GET', undefined, adminToken)))
      expect(applied.items.find((item) => item.id === pendingBookId)).toMatchObject({ contentRating: 'restricted', source: 'prefill' })
      expect(applied.items.find((item) => item.id === pendingBookId)?.ruleVersion).toBe(approvedBody.ruleVersion)
      expect(applied.items.find((item) => item.id === pendingBookId)?.evidence.some((item) => item.type === 'rule-candidate')).toBe(true)

      const future = await req('/api/novels', json('POST', { title: '批准规则覆盖新作品', author: 'x', categories: ['新成人标签'] }, adminToken))
      const futureBody = await jsonOf<{ novel: Novel }>(future)
      expect(futureBody.novel.contentRating).toBe('restricted')
      const manualGeneral = await req(
        '/api/novels',
        json('POST', { title: '人工一般优先', author: 'x', categories: ['新成人标签'], contentRating: 'general' }, adminToken),
      )
      expect((await jsonOf<{ novel: Novel }>(manualGeneral)).novel.contentRating).toBe('general')

      const stale = await req(
        `/api/admin/content-rating-rule-candidates/${categoryCandidate!.id}/review`,
        json('POST', { decision: 'reject', expectedRevision: categoryCandidate!.revision, reason: '旧页面重复提交' }, adminToken),
      )
      expect(stale.status).toBe(409)
      expect((await jsonOf<{ code: string }>(stale)).code).toBe('rule_candidate_not_pending')

      const phraseSource = await req('/api/novels', json('POST', { title: '短语来源人工书', author: 'x', contentRating: 'restricted' }, adminToken))
      const phraseSourceId = (await jsonOf<{ novel: Novel }>(phraseSource)).novel.id
      const phraseCandidateResponse = await req(
        '/api/admin/content-rating-rule-candidates',
        json('POST', { novelId: phraseSourceId, kind: 'phrase', value: '星河密语', reason: '人工复核后确认该短语在本库语境下稳定指向限制级' }, adminToken),
      )
      expect(phraseCandidateResponse.status).toBe(201)
      const phraseCandidate = (await jsonOf<{ candidate: { id: string; revision: number } }>(phraseCandidateResponse)).candidate
      expect(phraseCandidate.revision).toBeGreaterThan(0)
      const stalePending = await req(
        `/api/admin/content-rating-rule-candidates/${phraseCandidate.id}/review`,
        json('POST', { decision: 'reject', expectedRevision: phraseCandidate.revision - 1, reason: '旧页面审核' }, adminToken),
      )
      expect(stalePending.status).toBe(409)
      expect((await jsonOf<{ code: string }>(stalePending)).code).toBe('rule_candidate_conflict')
      const rejected = await req(
        `/api/admin/content-rating-rule-candidates/${phraseCandidate.id}/review`,
        json('POST', { decision: 'reject', expectedRevision: phraseCandidate.revision, reason: '样本不足，暂不纳入规则' }, adminToken),
      )
      expect(rejected.status).toBe(200)
      const rejectedBody = await jsonOf<{ candidate: { status: string }; appliedCount: number }>(rejected)
      expect(rejectedBody.candidate.status).toBe('rejected')
      expect(rejectedBody.appliedCount).toBe(0)

      const rejectedFuture = await req('/api/novels', json('POST', { title: '被拒规则不应生效', author: 'x', description: '普通描述，星河密语' }, adminToken))
      expect((await jsonOf<{ novel: Novel }>(rejectedFuture)).novel.contentRating).toBe('unknown')
    })

    it('预填回滚只撤销原始自动批次，不能覆盖之后的人工修改', async () => {
      const created = await req('/api/novels', json('POST', { title: '18禁回滚隔离测试书', author: 'x' }, adminToken))
      const id = (await jsonOf<{ novel: Novel }>(created)).novel.id
      await t.db.query("UPDATE novels SET content_rating = 'unknown' WHERE id = $1", [id])

      const prefillResponse = await req('/api/novels', json('POST', { action: 'prefill-content-rating' }, adminToken))
      const prefill = await jsonOf<{ ids: string[]; operationId: string }>(prefillResponse)
      expect(prefill.ids).toContain(id)

      const beforeManual = await jsonOf<{ items: Array<{ id: string; revision: number }> }>(
        await req(`/api/admin/content-ratings?search=18禁回滚隔离测试书`, json('GET', undefined, adminToken)),
      )
      const item = beforeManual.items.find((entry) => entry.id === id)!
      const manual = await req(
        `/api/admin/content-ratings/${id}`,
        json('PUT', { contentRating: 'general', reason: '人工复核后确认不属于限制级', expectedRevision: item.revision }, adminToken),
      )
      expect(manual.status).toBe(200)

      const undo = await req('/api/novels', json('POST', { action: 'undo-prefill-content-rating', operationId: prefill.operationId }, adminToken))
      expect(undo.status).toBe(200)
      expect((await jsonOf<{ restored: number }>(undo)).restored).toBe(0)
      const after = await jsonOf<{ items: Array<{ id: string; contentRating: string; source: string }> }>(
        await req(`/api/admin/content-ratings?search=18禁回滚隔离测试书`, json('GET', undefined, adminToken)),
      )
      expect(after.items.find((entry) => entry.id === id)).toMatchObject({ contentRating: 'general', source: 'manual' })
    })
  })
})
