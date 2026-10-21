import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ novels: vi.fn(), index: vi.fn(), chapters: vi.fn(), toast: vi.fn() }))
vi.mock('../../lib/api', () => ({
  adminApi: { novelIndex: mocks.index }, novelsApi: { list: mocks.novels }, chaptersApi: { list: mocks.chapters },
  scrapeApi: {}, authHeaders: () => ({}), url: (path: string) => path, newOperationId: () => 'test',
}))
vi.mock('../../components/feedback', () => ({ useToast: () => ({ toast: mocks.toast }), useConfirm: () => ({ confirm: vi.fn() }) }))
vi.mock('../../components/admin/BookImportDialog', () => ({ default: () => null }))
vi.mock('./AdminGate', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }))
vi.mock('./AdminShell', () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }))
vi.mock('./admin-registry', async (original) => {
  const registry = await original<typeof import('./admin-registry')>()
  const { default: NovelsTab } = await import('./NovelsTab')
  const { default: ChaptersTab } = await import('./ChaptersTab')
  return { ...registry, TAB_COMPONENTS: { ...registry.TAB_COMPONENTS, novels: NovelsTab, chapters: ChaptersTab } }
})
import Admin from './Admin'

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}{location.search}</output>
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.clearAllMocks()
  const novel = { id: 'book-1', title: '目标作品', author: '作者', categories: [], chapterCount: 1 }
  mocks.novels.mockResolvedValue({ novels: [novel], total: 1, totalPages: 1 })
  mocks.index.mockResolvedValue({ novels: [novel] })
  mocks.chapters.mockResolvedValue({ chapters: [{ id: 'c1', novelId: novel.id, title: '目标作品第一章', order: 1, wordCount: 100, createdAt: 1 }] })
})

it('小说管理的章节列表菜单经后台外壳进入目标章节页', async () => {
  const user = userEvent.setup()
  render(<MemoryRouter initialEntries={['/admin/novels']}><Routes><Route path="/admin/:tab?" element={<Admin />} /></Routes><LocationProbe /></MemoryRouter>)
  await user.click(await screen.findByRole('button', { name: '目标作品：更多操作' }))
  await user.click(screen.getByRole('menuitem', { name: '章节列表' }))
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/admin/chapters?novelId=book-1'))
  await waitFor(() => expect(mocks.chapters).toHaveBeenCalledWith('book-1'))
  expect((await screen.findAllByText('目标作品第一章')).length).toBeGreaterThan(0)
  expect(screen.getByTestId('location')).toHaveTextContent('/admin/chapters?novelId=book-1')
})

it('章节深链接优先于残留的旧版小说高亮指令', async () => {
  sessionStorage.setItem('adminEditNovel', JSON.stringify({ id: 'old-book' }))
  render(<MemoryRouter initialEntries={['/admin/chapters?novelId=book-1']}><Routes><Route path="/admin/:tab?" element={<Admin />} /></Routes><LocationProbe /></MemoryRouter>)
  await waitFor(() => expect(mocks.chapters).toHaveBeenCalledWith('book-1'))
  expect((await screen.findAllByText('目标作品第一章')).length).toBeGreaterThan(0)
  expect(screen.getByTestId('location')).toHaveTextContent('/admin/chapters?novelId=book-1')
  expect(sessionStorage.getItem('adminEditNovel')).toBeNull()
})
