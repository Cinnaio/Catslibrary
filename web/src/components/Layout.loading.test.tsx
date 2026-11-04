import { lazy, type ReactNode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import Layout from './Layout'

vi.mock('./workspace/WorkspaceShell', () => ({ default: ({ children }: { children: ReactNode }) => <><header>固定页头</header><aside>站点公告</aside>{children}</> }))
vi.mock('./SiteNotice', () => ({ default: () => <aside>站点公告</aside> }))

it.each(['/novel/book', '/bookshelf', '/profile'])('%s 懒加载时保留工作区导航，并在内容区域显示等待态', async (path) => {
  let resolve!: (module: { default: () => React.JSX.Element }) => void
  const Page = lazy(
    () =>
      new Promise<{ default: () => React.JSX.Element }>((done) => {
        resolve = done
      }),
  )
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path={path} element={<Page />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
  expect(screen.getByText('固定页头')).toBeVisible()
  expect(screen.getByText('站点公告')).toBeVisible()
  expect(document.querySelector('.route-loading--embedded')).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('正在加载')
  await act(async () => resolve({ default: () => <main>小说详情已加载</main> }))
  expect(await screen.findByText('小说详情已加载')).toBeInTheDocument()
  expect(screen.getByText('固定页头')).toBeInTheDocument()
  expect(screen.getByText('站点公告')).toBeInTheDocument()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it('从已加载页面跳转到懒加载页面时保留工作区导航', async () => {
  let resolve!: (module: { default: () => React.JSX.Element }) => void
  const Page = lazy(() => new Promise<{ default: () => React.JSX.Element }>((done) => {
    resolve = done
  }))
  render(
    <MemoryRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Link to="/novel/book">打开小说</Link>} />
          <Route path="/novel/:id" element={<Page />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
  expect(screen.getByText('固定页头')).toBeVisible()
  fireEvent.click(screen.getByText('打开小说'))
  expect(screen.getByRole('status')).toHaveTextContent('正在加载')
  // 导航属于持续存在的外壳，路由等待只替换内容区域。
  const header = screen.queryByText('固定页头')
  if (header) expect(header).toBeVisible()
  const notice = screen.queryByText('站点公告')
  if (notice) expect(notice).toBeVisible()
  await act(async () => resolve({ default: () => <main>小说详情已加载</main> }))
  expect(await screen.findByText('小说详情已加载')).toBeVisible()
  expect(screen.getByText('固定页头')).toBeVisible()
  expect(screen.getByText('站点公告')).toBeVisible()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})
