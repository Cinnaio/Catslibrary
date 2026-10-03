import { act, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import Layout from './Layout'
import PageState from './PageState'

vi.mock('./SiteHeader', () => ({ default: () => <nav aria-label="站点导航">站点导航</nav> }))
vi.mock('./SiteNotice', () => ({ default: () => <aside>站点公告</aside> }))

it('整页状态撤下导航与公告，离开状态页恢复正常布局', async () => {
  const router = createMemoryRouter([{ element: <Layout />, children: [
    { path: '/', element: <p>首页内容</p> },
    { path: '/blocked', element: <PageState title="内容已拦截" description="需要验证" /> },
  ] }], { initialEntries: ['/blocked'] })
  render(<RouterProvider router={router} />)
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('内容已拦截')
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  expect(screen.queryByText('站点公告')).not.toBeInTheDocument()
  await act(() => router.navigate('/'))
  expect(screen.getByRole('navigation')).toBeInTheDocument()
  expect(screen.getByText('站点公告')).toBeInTheDocument()
  expect(screen.getByText('首页内容')).toBeInTheDocument()
})

it('局部提示保留公开导航与公告，不创建整页 main', () => {
  const router = createMemoryRouter([{ element: <Layout />, children: [
    { path: '/', element: <PageState inline title="已隐藏部分作品" description="继续浏览" /> },
  ] }])
  render(<RouterProvider router={router} />)
  expect(screen.getByRole('navigation')).toBeInTheDocument()
  expect(screen.getByText('站点公告')).toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('已隐藏部分作品')
  expect(screen.getByRole('status')).toBeInTheDocument()
  expect(screen.queryByRole('main')).not.toBeInTheDocument()
})
