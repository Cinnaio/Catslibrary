import type { ReactNode } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  let resolve!: () => void
  const ready = new Promise<void>((done) => {
    resolve = done
  })
  return { allowed: false, requested: vi.fn(), ready, resolve }
})
vi.mock('./AdminGate', () => ({
  default: ({ children }: { children: ReactNode }) => (mocks.allowed ? children : <div>需要管理员身份</div>),
}))
vi.mock('./AdminShell', () => ({
  default: ({ activeLabel, children }: { activeLabel: string; children: ReactNode }) => (
    <main>
      <h1>管理导航</h1>
      <section aria-label={activeLabel}>{children}</section>
    </main>
  ),
}))
vi.mock('./DashboardTab', async () => {
  mocks.requested()
  await mocks.ready
  return { default: () => <div>总览模块已加载</div> }
})

import Admin from './Admin'

function mount() {
  return render(
    <MemoryRouter initialEntries={['/admin/dashboard']}>
      <Routes>
        <Route path="/admin/:tab" element={<Admin />} />
      </Routes>
    </MemoryRouter>,
  )
}

it('鉴权拦截时不请求后台模块', () => {
  mocks.allowed = false
  mount()
  expect(screen.getByText('需要管理员身份')).toBeInTheDocument()
  expect(mocks.requested).not.toHaveBeenCalled()
})

it('模块下载期间保留管理导航，加载完成后只替换内容区', async () => {
  mocks.allowed = true
  mount()
  await waitFor(() => expect(mocks.requested).toHaveBeenCalledOnce())
  const shell = screen.getByRole('heading', { name: '管理导航' })
  expect(screen.getByRole('status')).toHaveTextContent('正在加载')
  expect(document.querySelector('.route-loading--embedded')).toBeInTheDocument()
  await act(async () => mocks.resolve())
  expect(await screen.findByText('总览模块已加载')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '管理导航' })).toBe(shell)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})
