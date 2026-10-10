import { lazy } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import Layout from './Layout'

vi.mock('./SiteHeader', () => ({ default: () => <header>固定页头</header> }))
vi.mock('./SiteNotice', () => ({ default: () => <aside>站点公告</aside> }))

it.each(['/novel/book', '/bookshelf', '/profile'])('%s 懒加载时隐藏页头与公告，完成后恢复布局', async (path) => {
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
  expect(screen.queryByText('固定页头')).not.toBeInTheDocument()
  expect(screen.queryByText('站点公告')).not.toBeInTheDocument()
  expect(document.querySelector('.route-loading--embedded')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('正在加载')
  await act(async () => resolve({ default: () => <main>小说详情已加载</main> }))
  expect(await screen.findByText('小说详情已加载')).toBeInTheDocument()
  expect(screen.getByText('固定页头')).toBeInTheDocument()
  expect(screen.getByText('站点公告')).toBeInTheDocument()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it('从已加载页面跳转到懒加载页面时隐藏旧页头，完成后恢复', async () => {
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
  // React 在暂停时可能保留旧 DOM，但它不应继续可见。
  const header = screen.queryByText('固定页头')
  if (header) expect(header).not.toBeVisible()
  const notice = screen.queryByText('站点公告')
  if (notice) expect(notice).not.toBeVisible()
  await act(async () => resolve({ default: () => <main>小说详情已加载</main> }))
  expect(await screen.findByText('小说详情已加载')).toBeVisible()
  expect(screen.getByText('固定页头')).toBeVisible()
  expect(screen.getByText('站点公告')).toBeVisible()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})
