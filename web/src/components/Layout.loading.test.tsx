import { lazy } from 'react'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import Layout from './Layout'

vi.mock('./SiteHeader', () => ({ default: () => <header>固定页头</header> }))
vi.mock('./SiteNotice', () => ({ default: () => null }))

it('公开页面懒加载时保留页头，并在完成后替换内容区等待状态', async () => {
  let resolve!: (module: { default: () => React.JSX.Element }) => void
  const Page = lazy(
    () =>
      new Promise<{ default: () => React.JSX.Element }>((done) => {
        resolve = done
      }),
  )
  render(
    <MemoryRouter initialEntries={['/novel/book']}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/novel/:id" element={<Page />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
  const header = screen.getByText('固定页头')
  expect(screen.getByRole('status')).toHaveTextContent('正在加载')
  await act(async () => resolve({ default: () => <main>小说详情已加载</main> }))
  expect(await screen.findByText('小说详情已加载')).toBeInTheDocument()
  expect(screen.getByText('固定页头')).toBe(header)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})
