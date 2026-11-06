import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
const session = vi.hoisted(() => ({ role: 'admin' }))
vi.mock('@/context/SessionContext', () => ({ useSession: () => ({ user: { role: session.role } }) }))
vi.mock('./CenterView', () => ({ default: () => <p>抓取内容</p> }))
vi.mock('./ProxyView', () => ({ default: () => <p>代理配置内容</p> }))
import ScrapeTab from './index'

beforeEach(() => {
  session.role = 'admin'
  localStorage.clear()
  localStorage.setItem('scrape_active_view', 'proxy')
})
function mount() { render(<MemoryRouter initialEntries={['/admin/scrape']}><ScrapeTab /></MemoryRouter>) }
it('普通管理员忽略之前保存的代理子页，不渲染配置组件', () => {
  mount()
  expect(screen.getByText('抓取内容')).toBeInTheDocument()
  expect(screen.queryByText('代理配置内容')).not.toBeInTheDocument()
})
it('超级管理员仍能恢复已保存的代理子页', () => {
  session.role = 'super_admin'
  mount()
  expect(screen.getByText('代理配置内容')).toBeInTheDocument()
  expect(screen.queryByText('抓取内容')).not.toBeInTheDocument()
})
