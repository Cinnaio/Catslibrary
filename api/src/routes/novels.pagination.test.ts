import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../app'
import { setDbForTests } from '../db/pool'
import { createTestDb, type TestDb } from '../test/db'

let t: TestDb
let adminToken: string

beforeAll(async () => {
  t = await createTestDb()
  await t.applyMigrations()
  setDbForTests(t.db)
  process.env.DATABASE_URL = 'postgres://test/test'
  const boot = await app.request('/api/auth/bootstrap-admin', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'pagination-admin', password: 'adminpass123' }),
  })
  expect(boot.status).toBe(201)
  adminToken = ((await boot.json()) as { token: string }).token
  // Alternate visible and restricted books in the actual sort order.
  for (let i = 0; i < 45; i++) {
    for (const restricted of [false, true]) {
      await t.db.query(
        `INSERT INTO novels (id, title, author, description, categories, content_rating, updated_at, created_at)
         VALUES ($1, $2, '作者', '', $3, $4, $5, $5)`,
        [`${restricted ? 'restricted' : 'visible'}-${i}`, `${i < 25 ? '你' : '山'}的故事${i}`,
          JSON.stringify([restricted ? 'h' : '现代']), restricted ? 'restricted' : i === 44 ? 'unknown' : 'general',
          1000 - i * 2 + Number(restricted)],
      )
    }
  }
})

afterAll(async () => {
  setDbForTests(null)
  delete process.env.DATABASE_URL
  await t.close()
})

interface List {
  novels: Array<{ id: string; contentRating: string }>
  total: number
  page: number
  totalPages: number
  hasMore: boolean
  availableCategories: string[]
  hiddenRestricted: boolean
}

async function list(query: string, admin = true): Promise<List> {
  const response = await app.request(`/api/novels?limit=20&sort=updated_at&order=desc&${query}`,
    admin ? { headers: { Authorization: `Bearer ${adminToken}` } } : undefined)
  expect(response.status).toBe(200)
  return response.json() as Promise<List>
}

describe('书库先筛选再分页', () => {
  it('管理员安全模式每页按可见作品补满，页数和分类使用相同可见范围', async () => {
    const pages = await Promise.all([1, 2, 3].map(page => list(`contentMode=safe&page=${page}`)))
    expect(pages.map(page => page.novels.length)).toEqual([20, 20, 5])
    expect(pages.map(page => page.total)).toEqual([45, 45, 45])
    expect(pages.map(page => page.totalPages)).toEqual([3, 3, 3])
    expect(pages.map(page => page.hasMore)).toEqual([true, true, false])
    const books = pages.flatMap(page => page.novels)
    expect(books.map(book => book.id)).toEqual(Array.from({ length: 45 }, (_, i) => `visible-${i}`))
    expect(books.at(-1)?.contentRating).toBe('unknown')
    expect(pages[0]!.availableCategories).not.toContain('h')
    expect(pages[0]!.hiddenRestricted).toBe(true)
  })

  it('安全模式中文搜索先筛选全部命中作品再分页', async () => {
    const first = await list('contentMode=safe&search=你&page=1')
    const second = await list('contentMode=safe&search=你&page=2')
    expect([first.novels.length, second.novels.length]).toEqual([20, 5])
    expect(first.total).toBe(25)
    expect(first.totalPages).toBe(2)
    expect(second.novels[0]?.id).toBe('visible-20')
  })

  it('不传模式保留后台全量列表，adult 参数不会绕过匿名访问限制', async () => {
    expect((await list('')).total).toBe(90)
    expect((await list('contentMode=adult')).total).toBe(90)
    const guest = await list('contentMode=adult', false)
    expect(guest.total).toBe(45)
    expect(guest.novels.some(book => book.contentRating === 'restricted')).toBe(false)
  })

  it('按目标 ID 定位所在页，并保持完整列表与相同排序', async () => {
    const full = await list('locateNovelId=visible-40&page=1')
    expect(full.page).toBe(5)
    expect(full.novels.some(book => book.id === 'visible-40')).toBe(true)
    expect(full.total).toBe(90)
    const safe = await list('contentMode=safe&locateNovelId=visible-40&page=1')
    expect(safe.page).toBe(3)
    expect(safe.novels.some(book => book.id === 'visible-40')).toBe(true)
    expect(safe.total).toBe(45)
  })

  it('定位不会绕过访问限制，目标不存在时仍返回正常列表', async () => {
    const guest = await list('locateNovelId=restricted-40', false)
    expect(guest.page).toBe(1)
    expect(guest.novels.some(book => book.id === 'restricted-40')).toBe(false)
    expect((await list('locateNovelId=missing-id')).total).toBe(90)
  })
})
