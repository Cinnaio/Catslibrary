import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import Layout from '../components/Layout'
import Novel from './Novel'

const mocks = vi.hoisted(() => ({
  policy: { mode: 'adult', checking: false, policyError: '', adultContentEnabled: true, isAllowed: () => true, setMode: vi.fn(), refreshPolicy: vi.fn() },
  novel: vi.fn(),
}))
vi.mock('../context/SessionContext', () => ({ useSession: () => ({ user: null }) }))
vi.mock('../context/ContentPolicyContext', () => ({ useContentPolicy: () => mocks.policy }))
vi.mock('../components/feedback', () => ({ useToast: () => ({ toast: vi.fn() }), useConfirm: () => ({ confirm: vi.fn() }) }))
vi.mock('../hooks/useBookshelf', () => ({ useBookshelf: () => ({ inShelf: false, toggle: vi.fn() }) }))
vi.mock('../components/CatchupRecap', () => ({ default: () => null }))
vi.mock('../components/SiteHeader', () => ({ default: () => <nav aria-label="站点导航">站点导航</nav> }))
vi.mock('../components/SiteNotice', () => ({ default: () => <aside>站点公告</aside> }))
vi.mock('../lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/api')>(),
  novelsApi: { get: mocks.novel },
  chaptersApi: { list: vi.fn().mockResolvedValue({ chapters: [] }) },
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
  expect(screen.getByRole('navigation')).toBeInTheDocument()
  const requests = mocks.novel.mock.calls.length

  mocks.policy.policyError = '访问权限验证暂时失败，正在重试。'
  view.rerender(tree())
  expect(screen.getByRole('main')).toHaveClass('page-state')
  expect(screen.getByRole('heading', { level: 1, name: '内容模式检查暂时失败' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: '测试小说' })).not.toBeInTheDocument()
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  expect(screen.queryByText('站点公告')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  expect(mocks.policy.refreshPolicy).toHaveBeenCalledOnce()

  mocks.policy.policyError = ''
  view.rerender(tree())
  expect(screen.getByRole('heading', { name: '测试小说' })).toBeInTheDocument()
  expect(screen.getByRole('navigation')).toBeInTheDocument()
  expect(screen.getByText('站点公告')).toBeInTheDocument()
  expect(mocks.novel.mock.calls.length).toBe(requests)
})
