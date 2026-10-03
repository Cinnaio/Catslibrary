import { renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ get: vi.fn(), user: { id: 'shelf-user' } }))
vi.mock('../lib/api', () => ({ bookshelfApi: { get: mocks.get }, getToken: () => 'token' }))
vi.mock('../context/SessionContext', () => ({ useSession: () => ({ user: mocks.user }) }))
import { useBookshelf } from './useBookshelf'
import { setStorageUser } from '../lib/storage'
it('详情页按目标小说确认收藏，不能只从书架前 50 本判断', async () => {
  setStorageUser('shelf-user')
  mocks.get.mockResolvedValue({ favorites: [{ novelId: '51st' }] })
  const { result } = renderHook(() => useBookshelf('51st'))
  await waitFor(() => expect(result.current.synced).toBe(true))
  expect(mocks.get).toHaveBeenCalledWith({ novelId: '51st' })
  expect(result.current.inShelf).toBe(true)
})
