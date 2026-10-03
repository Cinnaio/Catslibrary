import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ query: vi.fn(), tx: vi.fn() }))
vi.mock('../db/pool', () => ({ getDb: () => ({ query: mocks.query }) }))
vi.mock('../db/query', () => ({ all: async () => [], withTx: async (_db: unknown, fn: (q: typeof mocks.query) => Promise<void>) => { mocks.tx(); await fn(mocks.query) } }))
vi.mock('../middlewares/auth', () => ({ requireUser: () => async (c: any, next: () => Promise<void>) => { c.set('user', { id: 'u1' }); await next() } }))
vi.mock('../services/content-access', () => ({ contentPolicyHeaders: () => ({}), resolveContentAccess: async () => ({ canViewRestricted: true }) }))
import { bookmarksRoutes } from './bookmarks'

beforeEach(() => { vi.clearAllMocks(); mocks.query.mockResolvedValue({ rows: [], rowCount: 0 }) })
describe('书签全量同步保护', () => {
  it.each(['not-json', '{}', 'null', '{"bookmarks":null}', '{"bookmarks":[{}]}', JSON.stringify({ bookmarks: Array(501).fill({ novelId: 'n', chapterId: 'c' }) })])('拒绝非法载荷且不进入删除事务：%s', async body => {
    const response = await bookmarksRoutes.request('/', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body })
    expect(response.status).toBe(400)
    expect(mocks.tx).not.toHaveBeenCalled()
    expect(mocks.query).not.toHaveBeenCalled()
  })
  it('明确传入空数组可以清空', async () => {
    const response = await bookmarksRoutes.request('/', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"bookmarks":[]}' })
    expect(response.status).toBe(200)
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM user_bookmarks'), ['u1', true])
  })
})
