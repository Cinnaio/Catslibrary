import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import type { BookSearchResponse } from '@shared/book-search'
const mocks = vi.hoisted(() => ({ search: vi.fn(), user: { id: 'a' }, mode: 'safe' }))
vi.mock('@/lib/api', () => ({ chaptersApi: { search: mocks.search }, getToken: () => mocks.user.id }))
vi.mock('@/lib/storage', () => ({ getStorageScope: () => `user:${mocks.user.id}` }))
vi.mock('@/context/SessionContext', () => ({ useSession: () => ({ user: mocks.user }) }))
vi.mock('@/context/ContentPolicyContext', () => ({ useContentPolicy: () => ({ mode: mocks.mode, adultContentEnabled: true }) }))
import BookSearch from './BookSearch'
const response = (overrides: Partial<BookSearchResponse> = {}): BookSearchResponse => ({
  novelId: 'n', query: '风', items: [{ chapterId: 'c', chapterTitle: '第一章', chapterOrder: 1, snippet: '晚风吹过窗前', matchCount: 1 }], scanned: 20, nextCursor: null, ...overrides,
})
beforeEach(() => { vi.clearAllMocks(); mocks.user = { id: 'a' }; mocks.mode = 'safe' })
function setup() {
  const select = vi.fn()
  const view = render(<MemoryRouter><BookSearch novelId="n" title="书" onSelect={select} /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: '书内正文搜索' }))
  return { ...view, select, input: screen.getByRole('searchbox', { name: '正文关键词' }) }
}
it('只搜索本书并展示纯文本命中，点击将关键词和章节交给阅读器', async () => {
  mocks.search.mockResolvedValue(response())
  const { input, select } = setup()
  fireEvent.change(input, { target: { value: '风' } }); fireEvent.submit(input.closest('form')!)
  await waitFor(() => expect(screen.getByText('第一章')).toBeTruthy())
  expect(mocks.search).toHaveBeenCalledWith('n', '风', 'safe', '')
  expect(document.querySelector('mark')?.textContent).toBe('风')
  fireEvent.click(screen.getByText('第一章'))
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ chapterId: 'c' }), '风')
})
it('部分无命中时显示继续检索，后续失败保留已经找到的内容', async () => {
  mocks.search.mockResolvedValueOnce(response({ items: [], scanned: 200, nextCursor: 'next' }))
    .mockResolvedValueOnce(response({ nextCursor: 'next-2' })).mockRejectedValueOnce(new Error('连接失败'))
  const { input } = setup()
  fireEvent.change(input, { target: { value: '风' } }); fireEvent.submit(input.closest('form')!)
  await waitFor(() => expect(screen.getByText('已检索的章节中没有匹配')).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: '继续检索后续章节' }))
  await waitFor(() => expect(screen.getByText('第一章')).toBeTruthy())
  expect(mocks.search).toHaveBeenLastCalledWith('n', '风', 'safe', 'next')
  fireEvent.click(screen.getByRole('button', { name: '继续检索后续章节' }))
  await waitFor(() => expect(screen.getByText('连接失败')).toBeTruthy())
  expect(screen.getByText('第一章')).toBeTruthy()
})
it('输入变化后拒绝旧请求覆盖新关键词', async () => {
  let resolve!: (value: BookSearchResponse) => void
  mocks.search.mockReturnValue(new Promise(r => { resolve = r }))
  const { input } = setup()
  fireEvent.change(input, { target: { value: '风' } }); fireEvent.submit(input.closest('form')!)
  fireEvent.change(input, { target: { value: '雨' } })
  await act(async () => resolve(response()))
  expect(screen.queryByText('第一章')).toBeNull()
})
it('账号变化关闭搜索并丢弃旧账号的延迟结果', async () => {
  let resolve!: (value: BookSearchResponse) => void
  mocks.search.mockReturnValue(new Promise(r => { resolve = r }))
  const { input, rerender } = setup()
  fireEvent.change(input, { target: { value: '风' } }); fireEvent.submit(input.closest('form')!)
  mocks.user = { id: 'b' }
  rerender(<MemoryRouter><BookSearch novelId="n" title="书" /></MemoryRouter>)
  await act(async () => resolve(response()))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.queryByText('第一章')).toBeNull()
})
