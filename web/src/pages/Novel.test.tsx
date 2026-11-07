import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import Layout from '../components/Layout'
import Novel from './Novel'

const mocks = vi.hoisted(() => ({
  policy: { mode: 'adult', checking: false, policyError: '', adultContentEnabled: true, isAllowed: () => true, setMode: vi.fn(), refreshPolicy: vi.fn() },
  novel: vi.fn(),
  chapters: vi.fn().mockResolvedValue({ chapters: [] }),
  history: null as { chapterId: string; chapterOrder: number; timestamp: number } | null,
}))
vi.mock('../context/SessionContext', () => ({ useSession: () => ({ user: null }) }))
vi.mock('../context/ContentPolicyContext', () => ({ useContentPolicy: () => mocks.policy }))
vi.mock('../components/feedback', () => ({ useToast: () => ({ toast: vi.fn() }), useConfirm: () => ({ confirm: vi.fn() }) }))
vi.mock('../hooks/useBookshelf', () => ({ useBookshelf: () => ({ inShelf: false, toggle: vi.fn() }) }))
vi.mock('../components/CatchupRecap', () => ({ default: () => null }))
vi.mock('../components/workspace/WorkspaceShell', () => ({ default: ({ children, standalone }: { children: ReactNode; standalone?: boolean }) => <>{!standalone && <><nav aria-label="站点导航">站点导航</nav><aside>站点公告</aside></>}{children}</> }))
vi.mock('../components/SiteNotice', () => ({ default: () => <aside>站点公告</aside> }))
vi.mock('../lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/api')>(),
  novelsApi: { get: mocks.novel },
  chaptersApi: { list: mocks.chapters },
}))
vi.mock('../lib/storage', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/storage')>(),
  getNovelHistory: () => mocks.history,
}))

function tree() {
  return <MemoryRouter initialEntries={['/novel/book']}><Routes><Route element={<Layout />}>
    <Route path="/novel/:id" element={<Novel />} />
  </Route></Routes></MemoryRouter>
}

it('成人模式后台验证失败独立显示状态页，恢复后还原详情与站点导航', async () => {
  mocks.novel.mockResolvedValue({ novel: { id: 'book', title: '测试小说', author: '作者', categories: [], contentRating: 'restricted' } })
  const view = render(tree())
  await screen.findByRole('heading', { name: '测试小说' })
  expect(screen.getByRole('navigation', { name: '站点导航' })).toBeInTheDocument()
  const requests = mocks.novel.mock.calls.length

  mocks.policy.policyError = '访问权限验证暂时失败，正在重试。'
  view.rerender(tree())
  expect(screen.getByRole('main')).toHaveClass('page-state')
  expect(screen.getByRole('heading', { level: 1, name: '内容模式检查暂时失败' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: '测试小说' })).not.toBeInTheDocument()
  expect(screen.queryByRole('navigation', { name: '站点导航' })).not.toBeInTheDocument()
  expect(screen.queryByText('站点公告')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  expect(mocks.policy.refreshPolicy).toHaveBeenCalledOnce()

  mocks.policy.policyError = ''
  view.rerender(tree())
  expect(screen.getByRole('heading', { name: '测试小说' })).toBeInTheDocument()
  expect(screen.getByRole('navigation', { name: '站点导航' })).toBeInTheDocument()
  expect(screen.getByText('站点公告')).toBeInTheDocument()
  expect(mocks.novel.mock.calls.length).toBe(requests)
})

it('后台撤销私密授权后，返回页面清除书名和目录并显示普通 404', async () => {
  mocks.policy.checking = false
  mocks.policy.policyError = ''
  mocks.novel.mockResolvedValue({ novel: { id: 'book', title: '私密书名', author: '作者', description: '', categories: [], contentRating: 'general', visibility: 'selected' } })
  render(tree())
  await screen.findByRole('heading', { name: '私密书名' })
  expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, follow')
  mocks.novel.mockRejectedValueOnce(Object.assign(new Error('Novel not found'), { status: 404 }))
  fireEvent.focus(window)
  await waitFor(() => expect(screen.queryByRole('heading', { name: '私密书名' })).not.toBeInTheDocument())
  expect(screen.getByText('小说未找到')).toBeInTheDocument()
})

it('万章目录限制渲染数量，搜索整书和末页阅读位置仍可直达', async () => {
  mocks.policy.checking = false
  mocks.policy.policyError = ''
  mocks.novel.mockResolvedValue({ novel: { id: 'book', title: '万章小说', author: '作者', description: '', categories: [], contentRating: 'general' } })
  mocks.chapters.mockResolvedValue({ chapters: Array.from({ length: 10000 }, (_, i) => ({
    id: `ch-${i + 1}`, novelId: 'book', title: i === 9999 ? '最后的远方' : `章节 ${i + 1}`, order: i + 1,
  })) })
  mocks.history = { chapterId: 'ch-9999', chapterOrder: 9999, timestamp: Date.now() }
  render(tree())
  await screen.findByRole('heading', { name: '万章小说' })
  const rows = () => within(screen.getByRole('list', { name: '章节目录列表' }))
  expect(rows().getAllByRole('link')).toHaveLength(100)
  fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  await waitFor(() => expect(rows().getAllByRole('link')[0]).toHaveAttribute('href', '/read/book/ch-101'))
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索章节' }), { target: { value: '最后的远方' } })
  await waitFor(() => expect(rows().getAllByRole('link')).toHaveLength(1))
  expect(rows().getByRole('link')).toHaveAttribute('href', '/read/book/ch-10000')
  fireEvent.click(screen.getByRole('button', { name: '定位到阅读位置' }))
  await waitFor(() => expect(document.activeElement).toHaveAttribute('href', '/read/book/ch-9999'))
  expect(rows().getAllByRole('link')).toHaveLength(100)
  expect(screen.getByText('第 100 / 100 页')).toBeInTheDocument()
  mocks.history = null
  mocks.chapters.mockResolvedValue({ chapters: [] })
})
